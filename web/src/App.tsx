import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  Download,
  FileText,
  Flag,
  GraduationCap,
  LayoutGrid,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type {
  Profile,
  Preferences,
  PlanResult,
  Course,
  Plan,
  Attempt,
  Section,
} from "./types";
import { defaultPreferences, termLabel } from "./types";
import { parseAudit } from "./audit";
import {
  restore,
  persist,
  forget,
  exportWorkspace,
  importWorkspace,
  preferencesSchema,
} from "./storage";
import { generate, loadCatalog, validate } from "./api";
import { demo } from "./demo";
import { concentrations } from "./concentrations";

import { InsightsProvider, useInsights } from "./insights/InsightsProvider";
import { instructorNames, calendarRange } from "./insights/metrics";
import {
  CourseBadges,
  ProfessorRating,
  ScheduleComparison,
} from "./insights/Comparison";
import { CourseDetails } from "./insights/CourseDetails";

type Tab = "overview" | "audit" | "plan" | "schedule";
const genedNames: Record<string, string> = {
  FSAW: "Academic writing",
  FSPW: "Professional writing",
  FSOC: "Oral communication",
  FSMA: "Mathematics",
  FSAR: "Analytic reasoning",
  DSHU: "Humanities",
  DSHS: "History & social sciences",
  DSNL: "Natural sciences with lab",
  DSNS: "Natural sciences",
  DSSP: "Scholarship in practice",
  SCIS: "I-Series",
  DVUP: "Plural society",
  DVCC: "Cultural competency",
};
const nextTerms = Array.from({ length: 8 }, (_, i) => 2026 + i).flatMap((y) =>
  ["01", "05", "08", "12"].map((t) => `${y}${t}`),
);
const minutes = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
const time = (n: number) =>
  `${Math.floor(n / 60) % 12 || 12}:${String(n % 60).padStart(2, "0")}${n >= 720 ? "pm" : "am"}`;

export default function App() {
  return (
    <InsightsProvider>
      <Workspace />
    </InsightsProvider>
  );
}
function Workspace() {
  const { records: courseInsights, ensure: ensureInsights } = useInsights();
  const [detailCourse, setDetailCourse] = useState<string | null>(null);
  const [browseLimit, setBrowseLimit] = useState(16);
  const [courseSort, setCourseSort] = useState("original");
  const [profile, setProfile] = useState<Profile | null>(null),
    [prefs, setPrefs] = useState<Preferences>(defaultPreferences),
    [ready, setReady] = useState(false),
    [tab, setTab] = useState<Tab>("overview");
  const [result, setResult] = useState<PlanResult | null>(null),
    [planIndex, setPlanIndex] = useState(0),
    [scheduleIndex, setScheduleIndex] = useState(0),
    [fingerprint, setFingerprint] = useState("");
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [courses, setCourses] = useState<Course[]>([]),
    [warnings, setWarnings] = useState<string[]>([]),
    [search, setSearch] = useState(""),
    [browse, setBrowse] = useState(false),
    [saveError, setSaveError] = useState("");
  const [allGeneds, setAllGeneds] = useState(false);
  const [pinTerm, setPinTerm] = useState("202701"),
    [blockedDay, setBlockedDay] = useState("MWF"),
    [blockedStart, setBlockedStart] = useState("09:00"),
    [blockedEnd, setBlockedEnd] = useState("10:00");
  const pdfInput = useRef<HTMLInputElement>(null),
    jsonInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [tab]);
  useEffect(() => {
    setCourses([]);
    setWarnings([]);
  }, [prefs.start_term, prefs.concentration]);
  useEffect(() => {
    restore()
      .then((w) => {
        setProfile(w.profile);
        setPrefs(w.preferences);
        setResult(w.result ?? null);
      })
      .catch(() =>
        setError(
          "Saved data could not be read. Import a backup or start with an audit.",
        ),
      )
      .finally(() => setReady(true));
  }, []);
  useEffect(() => {
    if (ready)
      persist(profile, prefs, result).catch(() =>
        setSaveError(
          "Browser storage unavailable. Export your work to keep a backup.",
        ),
      );
  }, [profile, prefs, result, ready]);
  const currentFingerprint = JSON.stringify({ profile, prefs });
  const stale = !!result && fingerprint !== currentFingerprint;
  const plan = result?.plans[planIndex];
  const schedules = plan?.schedules ?? [];
  const schedule = schedules[scheduleIndex] ?? [];
  const calendar = calendarRange(schedule);
  const calendarDays = [
    ["M", "Monday"],
    ["Tu", "Tuesday"],
    ["W", "Wednesday"],
    ["Th", "Thursday"],
    ["F", "Friday"],
    ...["Sa", "Su"]
      .filter((day) =>
        schedule.some((s) =>
          s.meetings.some((m) => dayTokens(m.days).includes(day)),
        ),
      )
      .map((day) => [day, day === "Sa" ? "Saturday" : "Sunday"]),
  ];
  useEffect(() => {
    if (!result) return;
    const instructors: Record<string, string[]> = {};
    for (const candidate of result.plans)
      for (const weekly of candidate.schedules)
        for (const section of weekly) {
          instructors[section.course] = [
            ...new Set([
              ...(instructors[section.course] ?? []),
              ...instructorNames(section),
            ]),
          ];
        }
    const codes = Object.keys(instructors);
    if (codes.length) ensureInsights({ courses: codes, instructors });
  }, [result, ensureInsights]);
  const matchingCourses = courses.filter((c) =>
    `${c.id} ${c.title} ${c.geneds.join(" ")} ${(c.aliases ?? []).join(" ")}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const visibleCourses = matchingCourses.slice(0, browseLimit);
  const visibleCodes = visibleCourses.map((c) => c.id).join(",");
  useEffect(() => {
    if (browse && visibleCodes)
      ensureInsights({ courses: visibleCodes.split(",") });
  }, [browse, visibleCodes, ensureInsights]);
  const displayedCourses =
    courseSort === "gpa"
      ? [...visibleCourses].sort(
          (a, b) =>
            (courseInsights[b.id]?.average_gpa ?? -1) -
            (courseInsights[a.id]?.average_gpa ?? -1),
        )
      : visibleCourses;
  function pinSection(section: Section) {
    setPrefs((p) => ({
      ...p,
      pinned_sections: { ...p.pinned_sections, [section.course]: section.id },
      pinned: { ...p.pinned, [section.course]: p.start_term },
      excluded: p.excluded.filter((c) => c !== section.course),
    }));
  }
  const changeProfile = (p: Profile) => setProfile({ ...p, reviewed: false });
  const preference = <K extends keyof Preferences>(
    key: K,
    value: Preferences[K],
  ) => setPrefs((p) => ({ ...p, [key]: value }));
  async function upload(file?: File) {
    if (!file) return;
    setBusy("Reading audit…");
    setError("");
    try {
      setProfile(parseAudit(await (await import("./pdf")).extractAudit(file)));
      setResult(null);
      setTab("audit");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
      if (pdfInput.current) pdfInput.current.value = "";
    }
  }
  async function catalog() {
    setBusy("Loading courses…");
    setError("");
    try {
      const r = await loadCatalog(prefs.start_term, prefs.concentration);
      setCourses(r.courses);
      setWarnings(r.warnings);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function run() {
    if (!profile) return;
    setBusy("Generating…");
    setError("");
    try {
      preferencesSchema.parse(prefs);
      const r = await generate(profile, prefs);
      setResult(r);
      setFingerprint(currentFingerprint);
      setPlanIndex(0);
      setScheduleIndex(0);
      setTab("plan");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function move(course: string, _from: string, to: string) {
    if (!plan || !profile) return;
    const moved: Plan = {
      ...plan,
      schedules: [],
      semesters: plan.semesters.map((s) => ({
        ...s,
        courses: s.courses.filter((c) => c !== course),
      })),
    };
    let target = moved.semesters.find((s) => s.term === to);
    if (!target) {
      target = { term: to, courses: [], credits: 0 };
      moved.semesters.push(target);
    }
    target.courses.push(course);
    moved.semesters = moved.semesters
      .filter((s) => s.courses.length)
      .sort((a, b) => a.term.localeCompare(b.term));
    setBusy(`Validating ${course} in ${termLabel(to)}…`);
    try {
      const r = await validate(profile, prefs, moved);
      if (r.plans.length) {
        setResult(r);
        setPlanIndex(0);
        setFingerprint(currentFingerprint);
        setError(
          "Move validated academically. Regenerate to refresh weekly sections.",
        );
      } else {
        setError(`Move rejected: ${r.messages.join(" ")}`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  const updateAttempt = (i: number, patch: Partial<Attempt>) => {
    if (profile)
      changeProfile({
        ...profile,
        attempts: profile.attempts.map((a, n) =>
          n === i ? { ...a, ...patch } : a,
        ),
      });
  };
  const statTotal = profile
    ? profile.credits_completed + profile.credits_in_progress
    : 0;
  const remainingGeneds = profile
    ? Object.values(profile.gened_remaining).reduce((a, b) => a + b, 0)
    : 0;
  const setCoursePin = (id: string, term: string) => {
    const pinned = { ...prefs.pinned };
    if (term) pinned[id] = term;
    else delete pinned[id];
    preference("pinned", pinned);
  };
  return (
    <div className="app-shell">
      <input
        ref={pdfInput}
        type="file"
        accept="application/pdf"
        hidden
        onChange={(e) => upload(e.target.files?.[0])}
      />
      <input
        ref={jsonInput}
        type="file"
        accept="application/json"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          try {
            const w = importWorkspace(await file.text());
            setProfile(w.profile);
            setPrefs(w.preferences);
            setResult(w.result ?? null);
            setFingerprint("");
            setError("");
            setTab("audit");
          } catch {
            setError(
              "Invalid backup. Choose a Terp Path version 1 JSON export.",
            );
          }
          e.target.value = "";
        }}
      />
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setTab("overview");
          }}
        >
          <span className="brand-icon">
            <GraduationCap size={25} />
          </span>
          <span>
            terp<span className="brand-light">path</span>
          </span>
        </a>
        <nav aria-label="Main navigation">
          {(
            [
              ["overview", "Overview", LayoutGrid],
              ["audit", "Degree audit", FileText],
              ["plan", "Graduation plan", Flag],
              ["schedule", "Weekly schedule", CalendarDays],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              className={tab === id ? "nav active" : "nav"}
              onClick={() => setTab(id)}
            >
              <Icon size={18} />
              {label}
              {id === "audit" && profile && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
      </aside>
      <main>
        <div className={`content${tab === "audit" ? " audit-content" : ""}`}>
          <div className="page-heading">
            <div>
              <h1>
                {
                  {
                    overview: "Overview",
                    audit: "Degree audit",
                    plan: "Graduation plan",
                    schedule: "Weekly schedule",
                  }[tab]
                }
              </h1>
            </div>
            <button
              className="button secondary"
              onClick={() => pdfInput.current?.click()}
              disabled={!!busy}
            >
              <Upload size={16} />
              {profile ? "Replace audit" : "Upload audit"}
            </button>
          </div>
          {error && (
            <div className="notice error" role="alert">
              <span>{error}</span>
              <button aria-label="Dismiss message" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {saveError && <div className="notice error">{saveError}</div>}
          {busy && (
            <div className="notice" role="status">
              <LoaderCircle size={17} className="spin" />
              {busy}
            </div>
          )}
          {stale && (tab === "plan" || tab === "schedule") && (
            <div className="notice compact-notice">
              Plan needs updating.
              <button
                className="text-button"
                disabled={!!busy || !profile?.reviewed}
                onClick={run}
              >
                Regenerate
              </button>
            </div>
          )}
          {tab === "overview" && (
            <>
              <section className="hero">
                <div className="hero-copy">
                  <h2>
                    Your degree.
                    <br />
                    Your direction.
                  </h2>
                  <button
                    className="button light"
                    onClick={() =>
                      profile ? setTab("plan") : pdfInput.current?.click()
                    }
                  >
                    {profile ? "Build my plan" : "Upload audit"}
                    <ArrowRight size={17} />
                  </button>
                </div>
                <div className="hero-graphic" aria-hidden="true">
                  <div className="orbit orbit-one" />
                  <div className="orbit orbit-two" />
                  <div className="path-line" />
                  <div className="milestone milestone-one">
                    <span>
                      <Check size={17} />
                    </span>
                    <div>Completed courses</div>
                  </div>
                  <div className="milestone milestone-two">
                    <span>
                      <BookOpen size={18} />
                    </span>
                    <div>Next semester</div>
                  </div>
                  <div className="milestone milestone-three">
                    <span>
                      <GraduationCap size={20} />
                    </span>
                    <div>Graduation</div>
                    <ArrowUpRight size={20} />
                  </div>
                </div>
              </section>
              <div className="stats">
                <Stat
                  label="Completed credits"
                  value={profile ? String(profile.credits_completed) : "—"}
                  icon={<BookOpen size={19} />}
                />
                <Stat
                  label="In progress"
                  value={profile ? String(profile.credits_in_progress) : "—"}
                  icon={<RefreshCw size={19} />}
                />
                <Stat
                  label="Gen Eds remaining"
                  value={profile ? String(remainingGeneds) : "—"}
                  icon={<LayoutGrid size={19} />}
                />
                <Stat
                  label="Graduation target"
                  value={
                    prefs.target_term ? termLabel(prefs.target_term) : "Not set"
                  }
                  icon={<Flag size={19} />}
                />
              </div>
              <div className="degree-summary">
                <section className="card">
                  <div className="degree-line">
                    <span className="degree-icon">
                      <GraduationCap size={28} />
                    </span>
                    <div>
                      <h3>Computer Science, B.S.</h3>
                      <p>General track · Fall 2025</p>
                    </div>
                  </div>
                  <div className="progress-label">
                    <span title="Completed and in-progress credits">
                      Credits
                    </span>
                    <strong>
                      {profile
                        ? `${statTotal} / 120`
                        : "Upload to see progress"}
                    </strong>
                  </div>
                  <div className="progress">
                    <span
                      style={{
                        width: `${Math.min(100, (statTotal / 120) * 100)}%`,
                      }}
                    />
                  </div>
                  <button
                    className="text-button"
                    onClick={() => setTab("audit")}
                  >
                    View audit <ArrowRight size={15} />
                  </button>
                </section>
              </div>
            </>
          )}
          {tab === "audit" &&
            (!profile ? (
              <section className="card empty">
                <FileText size={36} />
                <h2>Upload your degree audit</h2>
                <p>Use an expanded, printer-friendly uAchieve PDF.</p>
                <button
                  className="button primary"
                  onClick={() => pdfInput.current?.click()}
                >
                  <Upload size={16} />
                  Choose audit PDF
                </button>
                <button
                  className="text-button"
                  onClick={() => {
                    setProfile(structuredClone(demo));
                    setTab("audit");
                  }}
                >
                  Explore synthetic example
                </button>
              </section>
            ) : (
              <>
                {(profile.program !== "07010" ||
                  profile.catalog_year !== "Fall 2025") && (
                  <div className="notice">
                    This program or catalog year isn't supported yet.
                  </div>
                )}
                <section className="card">
                  <h3>
                    Credits
                    {profile.issues.some((issue) =>
                      issue.startsWith("Synthetic example:"),
                    ) && <span className="tag example-tag">Example</span>}
                  </h3>
                  <div className="form-grid audit-summary">
                    {(
                      [
                        ["credits_completed", "Completed"],
                        ["credits_in_progress", "In progress"],
                        ["gpa", "GPA"],
                      ] as const
                    ).map(([key, label]) => (
                      <label key={key}>
                        {label}
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          value={profile[key]}
                          onChange={(e) =>
                            changeProfile({
                              ...profile,
                              [key]: Number(e.target.value),
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>
                  <details className="audit-details">
                    <summary>Audit details</summary>
                    <div className="form-grid">
                      {(
                        [
                          ["resident_credits", "Residence credits"],
                          ["upper_credits", "Upper-level credits"],
                          ["major_upper_credits", "Major upper-level credits"],
                        ] as const
                      ).map(([key, label]) => (
                        <label key={key}>
                          {label}
                          <input
                            type="number"
                            step="0.1"
                            min="0"
                            value={profile[key]}
                            onChange={(e) =>
                              changeProfile({
                                ...profile,
                                [key]: Number(e.target.value),
                              })
                            }
                          />
                        </label>
                      ))}
                      <label>
                        Program
                        <input
                          value={profile.program}
                          onChange={(e) =>
                            changeProfile({
                              ...profile,
                              program: e.target.value,
                            })
                          }
                        />
                      </label>
                      <label>
                        Catalog year
                        <input
                          value={profile.catalog_year}
                          onChange={(e) =>
                            changeProfile({
                              ...profile,
                              catalog_year: e.target.value,
                            })
                          }
                        />
                      </label>
                    </div>
                  </details>
                  {profile.issues
                    .filter(
                      (issue) =>
                        !issue.startsWith("Confirm Gen Ed remaining counts") &&
                        !issue.startsWith("Synthetic example:"),
                    )
                    .map((issue) => (
                      <p className="review-note" key={issue}>
                        {issue}
                      </p>
                    ))}
                </section>
                <section className="card">
                  <div className="card-heading">
                    <h3>
                      Gen Eds
                      {remainingGeneds ? ` · ${remainingGeneds} remaining` : ""}
                    </h3>
                    <button
                      className="text-button"
                      aria-pressed={allGeneds}
                      onClick={() => setAllGeneds((v) => !v)}
                    >
                      {allGeneds ? "Remaining" : "Show all"}
                    </button>
                  </div>
                  {!remainingGeneds && !allGeneds && (
                    <span className="muted">Complete</span>
                  )}
                  <div className="gened-grid">
                    {Object.entries(genedNames)
                      .filter(
                        ([code]) =>
                          allGeneds || (profile.gened_remaining[code] ?? 0) > 0,
                      )
                      .map(([code, name]) => (
                        <label key={code}>
                          <span>{name}</span>
                          <input
                            aria-label={`${name} remaining`}
                            type="number"
                            min="0"
                            max="2"
                            value={profile.gened_remaining[code] ?? 0}
                            onChange={(e) =>
                              changeProfile({
                                ...profile,
                                gened_remaining: {
                                  ...profile.gened_remaining,
                                  [code]: Number(e.target.value),
                                },
                              })
                            }
                          />
                        </label>
                      ))}
                  </div>
                </section>
                <details className="card audit-history">
                  <summary>Courses ({profile.attempts.length})</summary>
                  <div className="card-heading">
                    <button
                      className="text-button"
                      onClick={() =>
                        changeProfile({
                          ...profile,
                          attempts: [
                            ...profile.attempts,
                            {
                              course: "NEW100",
                              term: "202608",
                              credits: 3,
                              grade: "A",
                              status: "completed",
                              transfer: false,
                              requirements: [],
                            },
                          ],
                        })
                      }
                    >
                      <Plus size={15} />
                      Add course
                    </button>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Course</th>
                          <th>Term</th>
                          <th>Credits</th>
                          <th>Grade</th>
                          <th>Status</th>
                          <th>Transfer/AP</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {profile.attempts.map((a, i) => (
                          <tr key={i}>
                            <td>
                              <input
                                aria-label={`Course ${i + 1}`}
                                value={a.course}
                                onChange={(e) =>
                                  updateAttempt(i, {
                                    course: e.target.value.toUpperCase(),
                                  })
                                }
                              />
                            </td>
                            <td>
                              <input
                                aria-label={`Term ${i + 1}`}
                                value={a.term}
                                onChange={(e) =>
                                  updateAttempt(i, { term: e.target.value })
                                }
                              />
                            </td>
                            <td>
                              <input
                                aria-label={`Credits ${i + 1}`}
                                type="number"
                                min="0"
                                max="30"
                                value={a.credits}
                                onChange={(e) =>
                                  updateAttempt(i, {
                                    credits: Number(e.target.value),
                                  })
                                }
                              />
                            </td>
                            <td>
                              <input
                                aria-label={`Grade ${i + 1}`}
                                value={a.grade}
                                onChange={(e) =>
                                  updateAttempt(i, { grade: e.target.value })
                                }
                              />
                            </td>
                            <td>
                              <select
                                aria-label={`Status ${i + 1}`}
                                value={a.status}
                                onChange={(e) =>
                                  updateAttempt(i, {
                                    status: e.target.value as Attempt["status"],
                                  })
                                }
                              >
                                <option value="completed">Completed</option>
                                <option value="in_progress">In progress</option>
                                <option value="unused">Unused</option>
                              </select>
                            </td>
                            <td>
                              <input
                                aria-label={`Transfer ${i + 1}`}
                                type="checkbox"
                                checked={a.transfer}
                                onChange={(e) =>
                                  updateAttempt(i, {
                                    transfer: e.target.checked,
                                  })
                                }
                              />
                            </td>
                            <td>
                              <button
                                aria-label={`Remove ${a.course}`}
                                onClick={() =>
                                  changeProfile({
                                    ...profile,
                                    attempts: profile.attempts.filter(
                                      (_, n) => n !== i,
                                    ),
                                  })
                                }
                              >
                                <X size={14} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
                <section className="card">
                  <details className="audit-notes">
                    <summary>Notes</summary>
                    <textarea
                      aria-label="Advisor notes"
                      rows={3}
                      placeholder="Advisor notes"
                      title="Notes do not change academic requirements"
                      value={profile.overrides.join("\n")}
                      onChange={(e) =>
                        changeProfile({
                          ...profile,
                          overrides: e.target.value.split("\n"),
                        })
                      }
                    />
                  </details>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={profile.reviewed}
                      onChange={(e) =>
                        setProfile({ ...profile, reviewed: e.target.checked })
                      }
                    />
                    I’ve checked my audit
                  </label>
                  <button
                    className="button primary"
                    disabled={!profile.reviewed}
                    onClick={() => setTab("plan")}
                  >
                    Continue <ArrowRight size={16} />
                  </button>
                </section>
              </>
            ))}
          {tab === "plan" && (
            <>
              <div className="planning-layout">
                <section className="card preferences">
                  <div className="card-heading">
                    <h3>Goals</h3>
                    <Settings2 size={17} />
                  </div>
                  <label>
                    First semester
                    <select
                      value={prefs.start_term}
                      onChange={(e) => preference("start_term", e.target.value)}
                    >
                      {nextTerms.map((t) => (
                        <option key={t} value={t}>
                          {termLabel(t)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Graduate by
                    <select
                      value={prefs.target_term ?? ""}
                      onChange={(e) =>
                        preference("target_term", e.target.value || null)
                      }
                    >
                      <option value="">Earliest available</option>
                      {nextTerms
                        .filter((t) => t >= prefs.start_term)
                        .map((t) => (
                          <option key={t} value={t}>
                            {termLabel(t)}
                          </option>
                        ))}
                    </select>
                  </label>
                  <div className="form-grid compact">
                    <label>
                      Min. credits
                      <CreditInput
                        min={0}
                        value={prefs.min_credits}
                        onChange={(value) => preference("min_credits", value)}
                      />
                    </label>
                    <label>
                      Max. credits
                      <CreditInput
                        min={1}
                        value={prefs.max_credits}
                        onChange={(value) => preference("max_credits", value)}
                      />
                    </label>
                  </div>
                  <label>
                    Concentration
                    <select
                      value={prefs.concentration}
                      onChange={(e) =>
                        preference("concentration", e.target.value)
                      }
                    >
                      {!concentrations.some(
                        ([code]) => code === prefs.concentration,
                      ) && (
                        <option value={prefs.concentration}>
                          {prefs.concentration}
                        </option>
                      )}
                      {concentrations.map(([code, name]) => (
                        <option key={code} value={code}>
                          {name} ({code})
                        </option>
                      ))}
                    </select>
                  </label>

                  <label>
                    Interests
                    <input
                      placeholder="e.g. history, design, security"
                      value={prefs.interests.join(",")}
                      onChange={(e) =>
                        preference(
                          "interests",
                          e.target.value.split(",").slice(0, 20),
                        )
                      }
                    />
                  </label>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={prefs.summer}
                      onChange={(e) => preference("summer", e.target.checked)}
                    />
                    Include summer
                  </label>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={prefs.winter}
                      onChange={(e) => preference("winter", e.target.checked)}
                    />
                    Include winter
                  </label>
                  <button
                    className="button primary full"
                    disabled={!!busy || !profile?.reviewed}
                    onClick={run}
                  >
                    {busy ? (
                      <LoaderCircle size={16} className="spin" />
                    ) : (
                      <Flag size={16} />
                    )}
                    Generate plans
                  </button>
                  {!profile?.reviewed && (
                    <button
                      className="text-button"
                      onClick={() => setTab("audit")}
                    >
                      Review your audit first <ArrowRight size={14} />
                    </button>
                  )}
                </section>
                <div className="plan-main">
                  <section className="card course-choices">
                    <div className="card-heading">
                      <button
                        className="text-button"
                        onClick={() => {
                          setBrowse(true);
                          if (!courses.length) void catalog();
                        }}
                      >
                        Browse courses <ArrowUpRight size={15} />
                      </button>
                    </div>
                    {Object.entries(prefs.pinned).map(([c, t]) => (
                      <div className="pin-row" key={c}>
                        <strong>{c}</strong>
                        <span>{termLabel(t)}</span>
                        <button
                          aria-label={`Unpin ${c}`}
                          onClick={() => setCoursePin(c, "")}
                        >
                          <X size={15} />
                        </button>
                      </div>
                    ))}
                    {prefs.excluded.length > 0 && (
                      <div className="chips">
                        {prefs.excluded.map((c) => (
                          <button
                            className="chip"
                            key={c}
                            onClick={() =>
                              preference(
                                "excluded",
                                prefs.excluded.filter((v) => v !== c),
                              )
                            }
                          >
                            {c} excluded <X size={12} />
                          </button>
                        ))}
                      </div>
                    )}
                  </section>
                  {!result ? (
                    <section className="card empty">
                      <Flag size={32} />
                      <h3>No plan yet</h3>
                    </section>
                  ) : (
                    <>
                      <div className="result-heading">
                        <div>
                          <h3>
                            {result.plans.length
                              ? "Plans"
                              : result.status === "timeout"
                                ? "Search timed out"
                                : result.status === "needs_review"
                                  ? "Review needed"
                                  : "No plan within these constraints"}
                          </h3>
                        </div>
                        {result.plans.length > 1 && (
                          <select
                            aria-label="Choose plan"
                            value={planIndex}
                            onChange={(e) => {
                              setPlanIndex(Number(e.target.value));
                              setScheduleIndex(0);
                            }}
                          >
                            {result.plans.map((_, i) => (
                              <option key={i} value={i}>
                                Plan {i + 1}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                      {!result.plans.length && result.messages.length > 0 && (
                        <div className="notice stack">
                          {result.messages.map((m, i) => (
                            <p key={i}>{m}</p>
                          ))}
                        </div>
                      )}
                      {plan && (
                        <>
                          {plan.semesters.map((s) => (
                            <section className="card semester" key={s.term}>
                              <div className="card-heading">
                                <h3>{termLabel(s.term)}</h3>
                                <span className="tag semester-credits">
                                  <strong>{s.credits}</strong> credits
                                  {s.term === prefs.start_term
                                    ? ""
                                    : " · Estimated"}
                                </span>
                              </div>
                              {s.courses.map((c) => (
                                <div className="planned-course" key={c}>
                                  <div>
                                    <button
                                      className="course-name"
                                      onClick={() => setDetailCourse(c)}
                                    >
                                      {c}
                                    </button>
                                    <span>
                                      {courses.find((v) => v.id === c)?.title ??
                                        result?.course_titles?.[c] ??
                                        ""}
                                    </span>
                                    <CourseBadges
                                      course={c}
                                      onOpen={() => setDetailCourse(c)}
                                    />
                                  </div>
                                  <select
                                    aria-label={`Move ${c}`}
                                    value={s.term}
                                    disabled={!!busy}
                                    onChange={(e) =>
                                      move(c, s.term, e.target.value)
                                    }
                                  >
                                    {result.horizon.map((t) => (
                                      <option key={t} value={t}>
                                        {termLabel(t)}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              ))}
                            </section>
                          ))}
                          <details className="card plan-coverage">
                            <summary>Requirements</summary>
                            <div className="coverage">
                              {Object.entries(plan.coverage).map(
                                ([name, ids]) =>
                                  ids.length > 0 && (
                                    <div key={name}>
                                      <CheckCircle2 size={15} />
                                      <span>
                                        {name}
                                        <small>{ids.join(", ")}</small>
                                      </span>
                                    </div>
                                  ),
                              )}
                            </div>
                          </details>
                          <details className="card">
                            <summary>Plan checks</summary>
                            <ul className="conditions">
                              {plan.conditions.map((c, i) => (
                                <li key={i}>{c}</li>
                              ))}
                              {result.messages.map((m, i) => (
                                <li key={`message-${i}`}>{m}</li>
                              ))}
                            </ul>
                          </details>
                          <button
                            className="button primary"
                            onClick={() => setTab("schedule")}
                          >
                            View schedule <ArrowRight size={16} />
                          </button>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            </>
          )}
          {tab === "schedule" && (
            <>
              <div className="schedule-tools">
                {result && (
                  <ScheduleComparison
                    plans={result.plans}
                    selectedPlan={planIndex}
                    selectedSchedule={scheduleIndex}
                    onSelect={(p, s) => {
                      setPlanIndex(p);
                      setScheduleIndex(s);
                    }}
                  />
                )}
                <details className="card availability">
                  <summary>Availability</summary>
                  <div className="card-heading">
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={prefs.allow_full}
                        onChange={(e) =>
                          preference("allow_full", e.target.checked)
                        }
                      />
                      Include full sections
                    </label>
                  </div>
                  <div className="block-controls">
                    <label>
                      Days
                      <select
                        value={blockedDay}
                        onChange={(e) => setBlockedDay(e.target.value)}
                      >
                        {["M", "Tu", "W", "Th", "F", "MWF", "TuTh"].map((d) => (
                          <option key={d}>{d}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      From
                      <input
                        type="time"
                        value={blockedStart}
                        onChange={(e) => setBlockedStart(e.target.value)}
                      />
                    </label>
                    <label>
                      Until
                      <input
                        type="time"
                        value={blockedEnd}
                        onChange={(e) => setBlockedEnd(e.target.value)}
                      />
                    </label>
                    <button
                      className="button secondary"
                      onClick={() => {
                        if (minutes(blockedEnd) <= minutes(blockedStart)) {
                          setError("End time must follow start time.");
                          return;
                        }
                        preference("blocked", [
                          ...prefs.blocked,
                          {
                            days: blockedDay,
                            start: minutes(blockedStart),
                            end: minutes(blockedEnd),
                            location: "",
                          },
                        ]);
                      }}
                    >
                      <Plus size={16} />
                      Block time
                    </button>
                  </div>
                  <div className="chips">
                    {prefs.blocked.map((m, i) => (
                      <button
                        key={i}
                        className="chip"
                        onClick={() =>
                          preference(
                            "blocked",
                            prefs.blocked.filter((_, j) => i !== j),
                          )
                        }
                      >
                        {m.days} {time(m.start)}–{time(m.end)}
                        <X size={13} />
                      </button>
                    ))}
                  </div>
                  <button
                    className="text-button"
                    disabled={!!busy || !profile?.reviewed}
                    onClick={run}
                  >
                    Apply <RefreshCw size={14} />
                  </button>
                </details>
              </div>
              {!schedules.length ? (
                <section className="card empty">
                  <CalendarDays size={34} />
                  <h3>No weekly schedule yet</h3>
                  <button
                    className="button secondary"
                    onClick={() => setTab("plan")}
                  >
                    Generate a plan <ArrowRight size={15} />
                  </button>
                </section>
              ) : (
                <>
                  <div className="section-heading">
                    <h3>{termLabel(prefs.start_term)}</h3>
                    <select
                      aria-label="Choose weekly schedule"
                      value={scheduleIndex}
                      onChange={(e) => setScheduleIndex(Number(e.target.value))}
                    >
                      {schedules.map((_, i) => (
                        <option key={i} value={i}>
                          Schedule {i + 1}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="calendar card">
                    <div
                      className="calendar-head"
                      style={{
                        gridTemplateColumns: `55px repeat(${calendarDays.length},1fr)`,
                      }}
                    >
                      <span />
                      {calendarDays.map(([day, label]) => (
                        <strong key={day}>{label}</strong>
                      ))}
                    </div>
                    <div
                      className="calendar-body"
                      style={{
                        height: calendar.height,
                        gridTemplateColumns: `55px repeat(${calendarDays.length},1fr)`,
                        background: `repeating-linear-gradient(to bottom,transparent 0,transparent ${calendar.height / calendar.hours - 1}px,#e9ede3 ${calendar.height / calendar.hours - 1}px,#e9ede3 ${calendar.height / calendar.hours}px)`,
                      }}
                    >
                      <div className="time-axis">
                        {Array.from({ length: calendar.hours }, (_, i) => (
                          <span
                            key={i}
                            style={{
                              top: (i * calendar.height) / calendar.hours + 4,
                            }}
                          >
                            {time(calendar.start + i * 60)}
                          </span>
                        ))}
                      </div>
                      {calendarDays.map(([day]) => (
                        <div className="day-column" key={day}>
                          {schedule.flatMap((s, i) =>
                            s.meetings
                              .filter((m) => dayTokens(m.days).includes(day))
                              .map((m, j) => (
                                <div
                                  key={`${s.course}-${j}`}
                                  className={`calendar-event color-${i % 5}`}
                                  style={{
                                    top: `${((m.start - calendar.start) / (calendar.end - calendar.start)) * 100}%`,
                                    height: `${((m.end - m.start) / (calendar.end - calendar.start)) * 100}%`,
                                  }}
                                >
                                  <strong>{s.course}</strong>
                                  <span>
                                    {time(m.start)}–{time(m.end)}
                                  </span>
                                  <small>{m.location}</small>
                                </div>
                              )),
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                  <section className="card schedule-courses">
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Course</th>
                            <th>Professor</th>
                            <th>GPA</th>
                            <th>Open seats</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {schedule.map((section) => (
                            <tr key={section.course}>
                              <td>
                                <button
                                  className="course-name"
                                  onClick={() =>
                                    setDetailCourse(section.course)
                                  }
                                >
                                  {section.course}
                                </button>
                                <small>{section.id}</small>
                              </td>
                              <td>
                                {instructorNames(section).length
                                  ? instructorNames(section).map((name) => (
                                      <div
                                        className="instructor-cell"
                                        key={name}
                                      >
                                        <span>{name}</span>
                                        <ProfessorRating
                                          course={section.course}
                                          name={name}
                                        />
                                      </div>
                                    ))
                                  : "TBA"}
                              </td>
                              <td>
                                <button
                                  className="text-button"
                                  onClick={() =>
                                    setDetailCourse(section.course)
                                  }
                                  aria-label={`Compare ${section.course} grades and professors`}
                                >
                                  {courseInsights[
                                    section.course
                                  ]?.average_gpa?.toFixed(2) ?? "—"}
                                </button>
                              </td>
                              <td
                                title={`Updated ${new Date(section.fetched_at).toLocaleString()}`}
                              >
                                {section.open_seats ?? "—"}
                              </td>
                              <td>
                                <button
                                  className="text-button"
                                  onClick={() =>
                                    setDetailCourse(section.course)
                                  }
                                >
                                  Sections
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </>
              )}
              {Object.entries(prefs.pinned_sections).map(([c, s]) => (
                <button
                  key={c}
                  className="chip"
                  onClick={() => {
                    const v = { ...prefs.pinned_sections };
                    delete v[c];
                    preference("pinned_sections", v);
                  }}
                >
                  {c} {s} pinned <X size={13} />
                </button>
              ))}
            </>
          )}
          <footer>
            <details className="workspace-tools">
              <summary>More</summary>
              <div>
                <button onClick={() => jsonInput.current?.click()}>
                  Import backup
                </button>
                <button onClick={() => exportWorkspace(profile, prefs, result)}>
                  <Download size={13} />
                  Export backup
                </button>
                <button onClick={() => window.print()}>Print plan</button>
                <button
                  onClick={async () => {
                    if (
                      window.confirm(
                        "Delete this device’s saved profile and preferences?",
                      )
                    ) {
                      await forget();
                      setProfile(null);
                      setPrefs(defaultPreferences);
                      setResult(null);
                    }
                  }}
                >
                  <Trash2 size={13} />
                  Delete data
                </button>
              </div>
            </details>
          </footer>
        </div>
      </main>
      {browse && !detailCourse && (
        <div className="modal-backdrop">
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Browse courses"
            className="course-modal"
          >
            <div className="card-heading">
              <div>
                <h2>Courses</h2>
              </div>
              <button
                aria-label="Close course browser"
                onClick={() => setBrowse(false)}
              >
                <X />
              </button>
            </div>
            <div className="search-box">
              <Search size={18} />
              <input
                aria-label="Search courses"
                placeholder="Search courses"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setBrowseLimit(16);
                }}
              />
              <button
                aria-label="Refresh courses"
                disabled={!!busy}
                onClick={catalog}
              >
                <RefreshCw size={16} />
              </button>
            </div>
            <label className="pin-select">
              Semester
              <select
                value={pinTerm}
                onChange={(e) => setPinTerm(e.target.value)}
              >
                {nextTerms
                  .filter((t) => t >= prefs.start_term)
                  .map((t) => (
                    <option value={t} key={t}>
                      {termLabel(t)}
                    </option>
                  ))}
              </select>
            </label>
            {warnings.map((w) => (
              <p key={w} className="review-note">
                {w}
              </p>
            ))}
            {!courses.length && (
              <p className="muted">
                {busy || "No course data loaded. Refresh to try again."}
              </p>
            )}
            <div className="course-browser-toolbar">
              <span>
                {Math.min(browseLimit, matchingCourses.length)} of{" "}
                {matchingCourses.length} courses
              </span>
              <select
                aria-label="Sort visible courses"
                value={courseSort}
                onChange={(e) => setCourseSort(e.target.value)}
              >
                <option value="original">Default</option>
                <option value="gpa">GPA</option>
              </select>
            </div>
            <div className="course-results">
              {displayedCourses.map((c) => (
                <article key={c.id}>
                  <div>
                    <button
                      className="course-name"
                      onClick={() => setDetailCourse(c.id)}
                    >
                      {c.id}
                    </button>
                    <span className="muted"> · {c.credits} credits</span>
                    <h4>{c.title}</h4>
                    <CourseBadges
                      course={c.id}
                      onOpen={() => setDetailCourse(c.id)}
                    />
                    <div className="chips">
                      {c.geneds.map((g) => (
                        <span className="tag" key={g}>
                          {g}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="course-actions">
                    <button
                      className="button secondary"
                      disabled={prefs.excluded.includes(c.id)}
                      onClick={() => setCoursePin(c.id, pinTerm)}
                    >
                      {prefs.pinned[c.id] ? "Pinned" : "+ Pin"}
                    </button>
                    <button
                      className="text-button muted"
                      onClick={() => {
                        setCoursePin(c.id, "");
                        preference(
                          "excluded",
                          Array.from(new Set([...prefs.excluded, c.id])),
                        );
                      }}
                    >
                      Exclude
                    </button>
                  </div>
                </article>
              ))}
              {browseLimit < matchingCourses.length && (
                <button
                  className="button secondary full"
                  onClick={() => setBrowseLimit((n) => n + 16)}
                >
                  Show more courses
                </button>
              )}
            </div>
          </section>
        </div>
      )}
      {detailCourse && (
        <CourseDetails
          key={detailCourse}
          course={detailCourse}
          initialNames={[
            ...new Set(
              result?.plans.flatMap((p) =>
                p.schedules.flatMap((w) =>
                  w
                    .filter((s) => s.course === detailCourse)
                    .flatMap(instructorNames),
                ),
              ) ?? [],
            ),
          ]}
          preferences={prefs}
          currentSchedule={schedule}
          pinned={prefs.pinned_sections[detailCourse]}
          onPin={pinSection}
          onClose={() => setDetailCourse(null)}
        />
      )}
    </div>
  );
}
function CreditInput({
  value,
  min,
  onChange,
}: {
  value: number;
  min: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      type="number"
      min={min}
      max={24}
      value={draft ?? value}
      onChange={(e) => {
        const text = e.target.value;
        setDraft(text);
        if (text !== "") onChange(Number(text));
      }}
      onBlur={() => {
        if (draft === "" && min === 0) onChange(0);
        setDraft(null);
      }}
    />
  );
}
function Stat({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <section className="stat card">
      <div>
        {label}
        {icon}
      </div>
      <strong>{value}</strong>
    </section>
  );
}
function dayTokens(days: string): string[] {
  return days.match(/Tu|Th|Sa|Su|M|W|F/g) ?? [];
}
