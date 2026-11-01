import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, LoaderCircle, RefreshCw, Star, X } from "lucide-react";
import type { Preferences, Section } from "../types";
import { termLabel } from "../types";
import { loadSections } from "../api";
import { useInsights } from "./InsightsProvider";
import { instructorNames, overlaps } from "./metrics";
import type { GradeSummary } from "./types";
const clock = (n: number) =>
  `${Math.floor(n / 60) % 12 || 12}:${String(n % 60).padStart(2, "0")}${n >= 720 ? "pm" : "am"}`;
const date = (s: string) =>
  Number.isNaN(Date.parse(s)) ? "" : new Date(s).toLocaleDateString();

function Distribution({ grades }: { grades: GradeSummary }) {
  const groups = [
    ["A", "A+", "A", "A-"],
    ["B", "B+", "B", "B-"],
    ["C", "C+", "C", "C-"],
    ["D", "D+", "D", "D-"],
    ["F", "F"],
    ["W", "W"],
    ["Other", "Other"],
  ].map(([label, ...keys]) => ({
    label,
    count: keys.reduce((a, k) => a + (grades.distribution[k] ?? 0), 0),
  }));
  const total = groups.reduce((a, g) => a + g.count, 0);
  return (
    <div className="grade-distribution">
      <div
        className="grade-bars"
        role="img"
        aria-label={groups.map((g) => `${g.label}: ${g.count}`).join(", ")}
      >
        {groups
          .filter((g) => g.count > 0)
          .map((g) => (
            <div
              key={g.label}
              className={`grade-${g.label}`}
              style={{ width: `${(g.count / total) * 100}%` }}
              title={`${g.label}: ${g.count} (${((g.count / total) * 100).toFixed(1)}%)`}
            />
          ))}
      </div>
      <div className="grade-legend">
        {groups
          .filter((g) => g.count > 0)
          .map((g) => (
            <span key={g.label}>
              <i className={`grade-${g.label}`} />
              {g.label} {Math.round((g.count / total) * 100)}%
            </span>
          ))}
      </div>
      <p className="small muted">
        {grades.graded_count.toLocaleString()} letter grades ·{" "}
        {grades.withdrawals.toLocaleString()} withdrawals
        {grades.first_term && grades.last_term
          ? ` · ${termLabel(grades.first_term)}–${termLabel(grades.last_term)}`
          : ""}
      </p>
    </div>
  );
}
export function CourseDetails({
  course,
  initialNames,
  preferences,
  currentSchedule,
  pinned,
  onPin,
  onClose,
}: {
  course: string;
  initialNames: string[];
  preferences: Preferences;
  currentSchedule: Section[];
  pinned: string | undefined;
  onPin: (section: Section) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const { records, pending, warnings, ensure } = useInsights();
  const [sections, setSections] = useState<Section[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [stale, setStale] = useState(false);
  const [sort, setSort] = useState("rating");
  const info = records[course];
  useEffect(() => {
    const node = ref.current;
    node?.showModal();
    return () => {
      node?.close();
    };
  }, []);
  useEffect(() => {
    let active = true;
    ensure({ courses: [course], instructors: { [course]: initialNames } });
    setLoading(true);
    loadSections(preferences.start_term, course)
      .then((r) => {
        if (!active) return;
        setSections(r.sections);
        setStale(r.stale);
        ensure({
          courses: [course],
          instructors: {
            [course]: [...new Set(r.sections.flatMap(instructorNames))].slice(
              0,
              10,
            ),
          },
        });
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [course, preferences.start_term, ensure]);
  const profFor = (name: string) =>
    info?.professors.find((p) => p.requested_name === name);
  const rating = (section: Section) => {
    const values = instructorNames(section)
      .map((n) => profFor(n)?.average_rating)
      .filter((n): n is number => n != null);
    return values.length
      ? values.reduce((a, b) => a + b, 0) / values.length
      : null;
  };
  const sorted = [...sections].sort((a, b) => {
    if (sort === "gpa") {
      const mean = (section: Section) => {
        const values = instructorNames(section)
          .map((n) => profFor(n)?.grades?.average_gpa)
          .filter((n): n is number => n != null);
        return values.length
          ? values.reduce((a, b) => a + b, 0) / values.length
          : -1;
      };
      return mean(b) - mean(a);
    }
    if (sort === "seats") return (b.open_seats ?? -1) - (a.open_seats ?? -1);
    if (sort === "time")
      return (
        Math.min(...a.meetings.map((m) => m.start), 1440) -
        Math.min(...b.meetings.map((m) => m.start), 1440)
      );
    return (rating(b) ?? -1) - (rating(a) ?? -1);
  });
  const reload = () =>
    ensure(
      {
        courses: [course],
        instructors: {
          [course]: [
            ...new Set([...initialNames, ...sections.flatMap(instructorNames)]),
          ].slice(0, 10),
        },
      },
      true,
    );
  return (
    <dialog
      ref={ref}
      className="insight-dialog"
      aria-labelledby="insight-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="card-heading">
        <div>
          <h2 id="insight-title">{course}</h2>
          <p className="muted">{info?.title}</p>
        </div>
        <button aria-label="Close course comparison" onClick={onClose}>
          <X size={22} />
        </button>
      </div>
      <div className="insight-headline">
        <div>
          <span>PlanetTerp GPA</span>
          <strong>
            {info?.average_gpa?.toFixed(2) ?? "—"}
            <small>/ 4.0</small>
          </strong>
        </div>
        <div>
          <span>Recorded letter grades</span>
          <strong>{info?.grades?.graded_count.toLocaleString() ?? "—"}</strong>
        </div>
        <a
          className="text-button"
          href={`https://planetterp.com/course/${course}`}
          target="_blank"
          rel="noreferrer"
        >
          PlanetTerp <ArrowUpRight size={14} />
        </a>
        <button
          className="text-button"
          disabled={pending.has(course)}
          onClick={reload}
          aria-label="Retry PlanetTerp data"
        >
          {pending.has(course) ? (
            <LoaderCircle size={15} className="spin" />
          ) : (
            <RefreshCw size={15} />
          )}
        </button>
      </div>
      {info?.grades ? (
        <Distribution grades={info.grades} />
      ) : (
        <p className="muted small">
          {pending.has(course)
            ? "Loading grade history…"
            : "No grade distribution available."}
        </p>
      )}
      {info?.grades && info.grades.graded_count < 30 && (
        <p className="data-note">Limited grade sample</p>
      )}
      <div className="section-heading">
        <h3>Sections · {termLabel(preferences.start_term)}</h3>
        <select
          aria-label="Sort course sections"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="rating">Professor rating</option>
          <option value="gpa">GPA with instructor</option>
          <option value="seats">Open seats</option>
          <option value="time">Start time</option>
        </select>
      </div>
      {loading && (
        <p role="status" className="muted">
          Loading sections…
        </p>
      )}
      {error && (
        <p role="alert" className="review-note">
          {error}
        </p>
      )}
      {stale && (
        <p className="review-note">
          Section availability is cached; confirm seats on Testudo.
        </p>
      )}
      {!loading && !sections.length && !error && (
        <p className="muted">No published sections for this term.</p>
      )}
      {!!sections.length && (
        <div className="table-wrap section-comparison">
          <table>
            <thead>
              <tr>
                <th>Section</th>
                <th>Instructor & reviews</th>
                <th>Course GPA with instructor</th>
                <th>Meetings</th>
                <th>Open seats</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sorted.map((s) => {
                const blocked = s.meetings.some((m) =>
                  preferences.blocked.some((b) => overlaps(m, b)),
                );
                const full =
                  !preferences.allow_full &&
                  (s.open_seats === null || s.open_seats <= 0);
                const collision = s.meetings.some((m) =>
                  currentSchedule
                    .filter((other) => other.course !== course)
                    .some((other) =>
                      other.meetings.some((n) => overlaps(m, n)),
                    ),
                );
                return (
                  <tr key={s.id}>
                    <td>{s.id}</td>
                    <td>
                      {instructorNames(s).length
                        ? instructorNames(s).map((name) => {
                            const p = profFor(name);
                            return (
                              <div key={name} className="instructor-cell">
                                {p?.source ? (
                                  <a
                                    href={p.source}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    {name} <ArrowUpRight size={10} />
                                  </a>
                                ) : (
                                  <span>{name}</span>
                                )}
                                {p?.average_rating != null ? (
                                  <small>
                                    <Star size={10} />
                                    {p.average_rating.toFixed(1)} / 5 ·{" "}
                                    {p.review_count ?? "—"} reviews
                                    {p.review_count != null &&
                                    p.review_count < 5
                                      ? " · Few reviews"
                                      : ""}
                                  </small>
                                ) : p ? (
                                  <small>Rating unavailable</small>
                                ) : (
                                  <button
                                    className="text-button"
                                    disabled={pending.has(course)}
                                    onClick={() =>
                                      ensure({
                                        courses: [course],
                                        instructors: { [course]: [name] },
                                      })
                                    }
                                  >
                                    Load rating
                                  </button>
                                )}
                              </div>
                            );
                          })
                        : "TBA"}
                    </td>
                    <td>
                      {instructorNames(s).map((name) => {
                        const g = profFor(name)?.grades;
                        return (
                          <div key={name}>
                            {g?.average_gpa?.toFixed(2) ?? "—"}
                            {g && <small>{g.graded_count} letter grades</small>}
                          </div>
                        );
                      })}
                    </td>
                    <td>
                      {s.meetings.map((m, i) => (
                        <div key={i}>
                          {m.days} {clock(m.start)}–{clock(m.end)}
                          <small>{m.location}</small>
                        </div>
                      ))}
                      {s.arranged && <small>TBA / arranged</small>}
                      {blocked && (
                        <small className="conflict-label">Blocked time</small>
                      )}
                      {collision && (
                        <small className="conflict-label">
                          Overlaps current schedule
                        </small>
                      )}
                    </td>
                    <td>{s.open_seats ?? "Unknown"}</td>
                    <td>
                      <button
                        className="text-button"
                        disabled={blocked || full}
                        title={
                          blocked
                            ? "Overlaps a blocked time"
                            : full
                              ? "No confirmed open seats; enable full sections to consider this option"
                              : "Regenerate after pinning to apply this section"
                        }
                        onClick={() => onPin(s)}
                      >
                        {pinned === s.id ? "Pinned" : "Pin"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {pinned && (
        <p className="data-note">
          Section {pinned} pinned. Generate plans to apply it.
        </p>
      )}
      {!!info?.professors.length && (
        <section className="professor-reviews">
          <h3>Professor reviews</h3>
          {info.professors.map((p) => (
            <article key={p.requested_name}>
              <div className="card-heading">
                <strong>{p.name}</strong>
                {p.average_rating != null && (
                  <span className="professor-score">
                    <Star size={13} />
                    {p.average_rating.toFixed(1)} / 5 · {p.review_count ?? "—"}{" "}
                    reviews
                  </span>
                )}
              </div>
              {p.course_review_count != null && p.course_review_count > 0 && (
                <p className="small muted">
                  {course}: {p.course_rating?.toFixed(1)} / 5 from{" "}
                  {p.course_review_count} reviews
                </p>
              )}
              {p.recent_review?.excerpt ? (
                <>
                  <blockquote>“{p.recent_review.excerpt}”</blockquote>
                  <p className="small muted">
                    {p.recent_review.rating} / 5 ·{" "}
                    {p.recent_review.course ?? "Course unspecified"}
                    {date(p.recent_review.created)
                      ? ` · ${date(p.recent_review.created)}`
                      : ""}
                  </p>
                </>
              ) : (
                <p className="small muted">
                  {p.status === "not_found"
                    ? "No exact PlanetTerp match found."
                    : "No review excerpt available."}
                </p>
              )}
              {p.source && (
                <a
                  className="text-button"
                  href={p.source}
                  target="_blank"
                  rel="noreferrer"
                >
                  Read all reviews <ArrowUpRight size={12} />
                </a>
              )}
            </article>
          ))}
        </section>
      )}
      <details className="metric-notes">
        <summary>
          Sources & methodology{info?.stale ? " · Cached data" : ""}
        </summary>
        <p>
          GPA uses PlanetTerp’s calculation, which includes withdrawals at zero
          points and excludes “Other.” The letter-grade-only average is{" "}
          {info?.grades?.letter_grade_gpa?.toFixed(2) ?? "unavailable"}. Sample
          counts refer to historical records, not this section’s enrollment.
        </p>
        <p>
          Professor ratings summarize student reviews. Reviews and grade history
          are separate signals and do not measure workload. Instructors are
          matched by name; unmatched instructors remain unscored.
        </p>
        <p>
          Retrieved {info?.fetched_at ? date(info.fetched_at) : "unavailable"} ·{" "}
          <a
            href={`https://planetterp.com/course/${course}`}
            target="_blank"
            rel="noreferrer"
          >
            PlanetTerp source
          </a>
        </p>
        {warnings.map((w) => (
          <p key={w}>{w}</p>
        ))}
      </details>
    </dialog>
  );
}
