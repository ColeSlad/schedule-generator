import { useState, useRef } from "react";
import { Star, ArrowUpRight, LoaderCircle } from "lucide-react";
import type { Plan } from "../types";
import { useInsights } from "./InsightsProvider";
import { scheduleOptions, sortOptions } from "./metrics";
import type { ScheduleSort } from "./metrics";

export function ProfessorRating({
  course,
  name,
}: {
  course: string;
  name: string;
}) {
  const { records, pending, ensure } = useInsights();
  const p = records[course]?.professors.find((p) => p.requested_name === name);
  return (
    <div className="rating-inline">
      {p?.average_rating != null ? (
        <span
          className="professor-score"
          title={`${p.review_count ?? "Unknown number of"} reviews`}
        >
          <Star size={12} />
          {p.average_rating.toFixed(1)}
        </span>
      ) : (
        <span className="muted">—</span>
      )}
      {p?.source && (
        <a
          className="text-button"
          href={p.source}
          target="_blank"
          rel="noreferrer"
          aria-label={`Read all reviews for ${name}`}
        >
          Reviews <ArrowUpRight size={11} />
        </a>
      )}
      {!p && !pending.has(course) && (
        <button
          className="text-button"
          onClick={() =>
            ensure({ courses: [course], instructors: { [course]: [name] } })
          }
          aria-label={`Load rating for ${name}`}
        >
          Load
        </button>
      )}
    </div>
  );
}
export function CourseBadges({
  course,
  onOpen,
}: {
  course: string;
  onOpen: () => void;
}) {
  const { records, pending } = useInsights();
  const info = records[course];
  if (info?.average_gpa == null && !pending.has(course)) return null;
  return (
    <div className="course-insights">
      <button
        className="insight-link"
        onClick={onOpen}
        aria-label={`Compare ${course} grades and professors`}
      >
        {pending.has(course) && !info ? (
          <LoaderCircle size={12} className="spin" aria-label="Loading GPA" />
        ) : (
          <>GPA {info?.average_gpa?.toFixed(2) ?? "—"}</>
        )}
      </button>
    </div>
  );
}
export function ScheduleComparison({
  plans,
  selectedPlan,
  selectedSchedule,
  onSelect,
}: {
  plans: Plan[];
  selectedPlan: number;
  selectedSchedule: number;
  onSelect: (p: number, s: number) => void;
}) {
  const { records } = useInsights();
  const panel = useRef<HTMLDetailsElement>(null);
  const [sort, setSort] = useState<ScheduleSort>("original");
  const options = sortOptions(scheduleOptions(plans, records), sort);
  if (options.length < 2) return null;
  return (
    <details ref={panel} className="card schedule-comparison">
      <summary>Compare schedules</summary>
      <div className="comparison-controls">
        <select
          aria-label="Sort schedule options"
          value={sort}
          onChange={(e) => setSort(e.target.value as ScheduleSort)}
        >
          <option value="original">Default</option>
          <option value="rating">Rating</option>
          <option value="gpa">GPA</option>
          <option value="days">Days on campus</option>
          <option value="gaps">Gaps</option>
        </select>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Schedule</th>
              <th>Rating</th>
              <th>GPA</th>
              <th>Days</th>
              <th>Gaps</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {options.map((o) => (
              <tr
                key={`${o.planIndex}-${o.scheduleIndex}`}
                className={
                  o.planIndex === selectedPlan &&
                  o.scheduleIndex === selectedSchedule
                    ? "selected-schedule"
                    : ""
                }
              >
                <td>
                  Plan {o.planIndex + 1} · {o.scheduleIndex + 1}
                </td>
                <td
                  title={`${o.metrics.rated} of ${o.metrics.instructors} instructors rated`}
                >
                  {o.metrics.rating !== null ? (
                    <span className="professor-score">
                      <Star size={11} />
                      {o.metrics.rating.toFixed(1)}
                    </span>
                  ) : (
                    "—"
                  )}
                </td>
                <td
                  title={`GPA available for ${o.metrics.gpaCourses} of ${o.metrics.courses} courses`}
                >
                  {o.metrics.gpa?.toFixed(2) ?? "—"}
                </td>
                <td>
                  {o.metrics.days}
                  {o.metrics.arranged ? " + TBA" : ""}
                </td>
                <td>
                  {o.metrics.gaps} min{o.metrics.arranged ? " + TBA" : ""}
                </td>
                <td>
                  <button
                    className="text-button"
                    onClick={() => {
                      onSelect(o.planIndex, o.scheduleIndex);
                      if (panel.current) panel.current.open = false;
                    }}
                  >
                    {o.planIndex === selectedPlan &&
                    o.scheduleIndex === selectedSchedule
                      ? "Selected"
                      : "View"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
