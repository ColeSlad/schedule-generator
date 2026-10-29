import type { Attempt, Profile } from "./types";
const geneds = [
  "FSAW",
  "FSPW",
  "FSOC",
  "FSMA",
  "FSAR",
  "DSHU",
  "DSHS",
  "DSNL",
  "DSNS",
  "DSSP",
  "SCIS",
  "DVUP",
  "DVCC",
];
const number = (text: string, re: RegExp, fallback = 0) =>
  Number(text.match(re)?.[1] ?? fallback);
export function parseAudit(raw: string): Profile {
  const text = raw
    .replace(/\u00a0/g, " ")
    .split("\n")
    .filter(
      (l) =>
        !/^https?:|^\d+\/\d+\/\d+,|My Audit - Audit Results Tab|^\d+\/\d+$/.test(
          l.trim(),
        ),
    )
    .join("\n");
  if (!text.includes("CREDITS COMPLETED") || !text.includes("Catalog Year"))
    throw new Error(
      "Audit format not recognized. Use an expanded uAchieve printer-friendly export.",
    );
  const issues: string[] = [];
  const summary = text.slice(0, text.indexOf("Major GPA"));
  const completed = number(summary, /Cumulative Credits\*?:\s*(\d+(?:\.\d+)?)/);
  const inProgress = number(summary, /IN-P\s*-+>\s*(\d+(?:\.\d+)?)\s*CREDITS/);
  const attempts = new Map<string, Attempt>();
  let group = "";
  let unused = false;
  const lines = text.split("\n");
  // Rows can contain multiple course attempts after coordinate-based line grouping.
  const courseRow =
    /(Sp|Fa|Su|Wi)(\d{2})\s+([A-Z][A-Z0-9 /-]*?)\s+(\d+\.\d{2})\s+((?:(?:MA|MS)\s+)?(?:IP|TP|TA|[ABCDF][+-]?|P|W|I|S)(?:\s+tna)?)(?=\s|$)/g;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes("Unused Courses")) {
      unused = true;
      group = "unused";
    }
    if (
      line.includes("[UNIV] Transfer Courses") ||
      line.includes("Total UG Cumulative Credits Course Listing")
    ) {
      unused = false;
      group = "total";
    }
    if (line.includes("General Elective Courses")) {
      group = "elective";
      unused = false;
    }
    const codes = geneds.filter(
      (c) => line.includes(`(${c}`) || line.includes(` ${c})`),
    );
    if (codes.length) group = codes.join(",");
    if (
      /Upper Level Concentration|Lower Level Requirements|Upper Level Requirements|CMSC Electives|Major GPA/.test(
        line,
      )
    )
      group = line.trim();
    for (const m of line.matchAll(courseRow)) {
      const course = m[3].replace(/\s+/g, " ").trim();
      const credits = Number(m[4]);
      const grade = m[5];
      const term = `20${m[2]}${({ Sp: "01", Su: "05", Fa: "08", Wi: "12" } as Record<string, string>)[m[1]]}`;
      const key = `${term}:${course}:${credits}:${grade}`;
      const prior = attempts.get(key);
      if (prior) {
        if (group && !prior.requirements.includes(group))
          prior.requirements.push(group);
        continue;
      }
      attempts.set(key, {
        course,
        term,
        credits,
        grade,
        status:
          unused || credits === 0 || grade.includes("tna")
            ? "unused"
            : grade.includes("IP")
              ? "in_progress"
              : "completed",
        transfer: /T[AP]/.test(grade),
        requirements: group ? [group] : [],
      });
    }
  }
  const values = [...attempts.values()];
  const earned = values
    .filter((a) => a.status === "completed" && !/^(F|W|I)$/.test(a.grade))
    .reduce((s, a) => s + a.credits, 0);
  const active = values
    .filter((a) => a.status === "in_progress")
    .reduce((s, a) => s + a.credits, 0);
  if (Math.abs(earned - completed) > 0.1)
    issues.push(
      `Completed credits need review: rows total ${earned}; summary reports ${completed}.`,
    );
  if (Math.abs(active - inProgress) > 0.1)
    issues.push(
      `In-progress credits need review: rows total ${active}; summary reports ${inProgress}.`,
    );
  const remaining: Record<string, number> = {};
  for (const code of geneds) {
    const start = lines.findIndex(
      (l) => l.includes(`(${code}`) || l.includes(` ${code})`),
    );
    if (start < 0) {
      remaining[code] = 0;
      continue;
    }
    let end = start + 1;
    while (
      end < lines.length &&
      !geneds.some(
        (c) => lines[end].includes(`(${c}`) || lines[end].includes(` ${c})`),
      ) &&
      !/\[GenEd\]|General Elective Courses|\[UNIV\]/.test(lines[end])
    )
      end++;
    remaining[code] = number(
      lines.slice(start, end).join("\n"),
      /NEEDS:\s*(\d+)\s*COURSE/,
    );
  }
  // DSNS is an alternative to a second DSNL, and DVCC to a second DVUP; audit grouping is authoritative.
  if (!text.includes("END OF ANALYSIS"))
    issues.push("Audit may be incomplete. Export all expanded sections.");
  issues.push(
    "Confirm Gen Ed remaining counts and concentration with your audit; advisor-entered exceptions are not inferred.",
  );
  const resident = number(
    summary,
    /30 credits in residence\s*[^\d]*(\d+\.\d+)\s*CREDITS TAKEN/,
  );
  const upper = number(
    summary,
    /minimum of 15 credits[\s\S]*?\(\s*(\d+\.\d+)\s*CREDITS TAKEN/,
  );
  const major = number(
    summary,
    /minimum of 12 upper level credits[\s\S]*?\(\s*(\d+\.\d+)\s*CREDITS TAKEN/,
  );
  return {
    program: text.match(/Program Code\s*(\d+)/)?.[1] ?? "",
    catalog_year:
      text.match(/Catalog Year\s*((?:Fall|Spring)\s*\d{4})/)?.[1] ?? "",
    credits_completed: completed,
    credits_in_progress: inProgress,
    gpa: number(summary, /Cumulative GPA:\s*(\d+\.\d+)/),
    resident_credits: resident,
    upper_credits: upper,
    major_upper_credits: major,
    gened_remaining: remaining,
    attempts: values,
    issues,
    reviewed: false,
    overrides: [],
  };
}
