import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, X } from "lucide-react";
import type { Preferences, Section } from "../types";
import { termLabel } from "../types";
import { loadSections } from "../api";
import { useInsights } from "./InsightsProvider";
import { instructorNames, overlaps } from "./metrics";
import { ProfessorRating } from "./Comparison";
import type { GradeSummary } from "./types";
const clock = (n: number) =>
  `${Math.floor(n / 60) % 12 || 12}:${String(n % 60).padStart(2, "0")}${n >= 720 ? "pm" : "am"}`;

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
              title={`${g.label}: ${g.count}`}
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
  const score = (section: Section, kind: "rating" | "gpa") => {
    const values = instructorNames(section)
      .map((n) =>
        kind === "rating"
          ? profFor(n)?.average_rating
          : profFor(n)?.grades?.average_gpa,
      )
      .filter((n): n is number => n != null);
    return values.length
      ? values.reduce((a, b) => a + b, 0) / values.length
      : -1;
  };
  const sorted = [...sections].sort((a, b) =>
    sort === "seats"
      ? (b.open_seats ?? -1) - (a.open_seats ?? -1)
      : sort === "time"
        ? Math.min(...a.meetings.map((m) => m.start), 1440) -
          Math.min(...b.meetings.map((m) => m.start), 1440)
        : score(b, sort === "gpa" ? "gpa" : "rating") -
          score(a, sort === "gpa" ? "gpa" : "rating"),
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
      <div className="course-overview">
        <span title="Historical GPA from PlanetTerp; withdrawals are included in its calculation.">
          GPA <strong>{info?.average_gpa?.toFixed(2) ?? "—"}</strong>
        </span>
        {info?.stale && <span className="muted">Cached</span>}
      </div>
      {info?.grades && (
        <details className="grade-details">
          <summary>Grade distribution</summary>
          <Distribution grades={info.grades} />
        </details>
      )}
      {warnings.length > 0 && !pending.has(course) && (
        <button
          className="text-button"
          onClick={() =>
            ensure(
              {
                courses: [course],
                instructors: {
                  [course]: [
                    ...new Set([
                      ...initialNames,
                      ...sections.flatMap(instructorNames),
                    ]),
                  ],
                },
              },
              true,
            )
          }
        >
          Retry stats
        </button>
      )}
      <div className="section-heading">
        <h3>{termLabel(preferences.start_term)}</h3>
        <select
          aria-label="Sort course sections"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="rating">Rating</option>
          <option value="gpa">GPA</option>
          <option value="seats">Open seats</option>
          <option value="time">Time</option>
        </select>
      </div>
      {loading && (
        <p role="status" className="muted">
          Loading…
        </p>
      )}
      {error && (
        <p role="alert" className="review-note">
          {error}
        </p>
      )}
      {stale && <p className="data-note">Cached seats</p>}
      {!loading && !sections.length && !error && (
        <p className="muted">No sections available.</p>
      )}
      {!!sections.length && (
        <div className="table-wrap section-comparison">
          <table>
            <thead>
              <tr>
                <th>Section</th>
                <th>Professor</th>
                <th title="Historical course GPA with this professor">GPA</th>
                <th>Time</th>
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
                        ? instructorNames(s).map((name) => (
                            <div key={name} className="instructor-cell">
                              <span>{name}</span>
                              <ProfessorRating course={course} name={name} />
                            </div>
                          ))
                        : "TBA"}
                    </td>
                    <td>
                      {instructorNames(s).map((name) => {
                        const g = profFor(name)?.grades;
                        return (
                          <div
                            key={name}
                            title={
                              g
                                ? `${g.graded_count} historical letter grades`
                                : undefined
                            }
                          >
                            {g?.average_gpa?.toFixed(2) ?? "—"}
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
                      {s.arranged && <small>TBA</small>}
                      {blocked && (
                        <small className="conflict-label">Unavailable</small>
                      )}
                      {collision && (
                        <small className="conflict-label">Overlaps</small>
                      )}
                    </td>
                    <td>{s.open_seats ?? "—"}</td>
                    <td>
                      <button
                        className="text-button"
                        disabled={blocked || full}
                        title={
                          blocked
                            ? "Overlaps a blocked time"
                            : full
                              ? "No confirmed open seats"
                              : "Regenerate after pinning"
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
      <div className="course-detail-footer">
        {pinned && (
          <span className="data-note">Pinned · Regenerate to apply</span>
        )}
        <a
          className="text-button"
          href={`https://planetterp.com/course/${course}`}
          target="_blank"
          rel="noreferrer"
        >
          PlanetTerp <ArrowUpRight size={12} />
        </a>
      </div>
    </dialog>
  );
}
