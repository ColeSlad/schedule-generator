import { useState } from "react";
import { Star, ArrowUpRight, LoaderCircle } from "lucide-react";
import type { Plan } from "../types";
import { useInsights } from "./InsightsProvider";
import { scheduleOptions, sortOptions } from "./metrics";
import type { ScheduleSort } from "./metrics";

export function CourseBadges({
  course,
  names = [],
  onOpen,
}: {
  course: string;
  names?: string[];
  onOpen: () => void;
}) {
  const { records, pending } = useInsights();
  const info = records[course];
  return (
    <div className="course-insights">
      <button
        className="insight-link"
        onClick={onOpen}
        aria-label={`Compare ${course} grades and professors`}
      >
        {pending.has(course) && !info ? (
          <>
            <LoaderCircle size={12} className="spin" />
            Loading stats
          </>
        ) : (
          <>
            GPA {info?.average_gpa != null ? info.average_gpa.toFixed(2) : "—"}
          </>
        )}
        <ArrowUpRight size={12} />
      </button>
      {names.map((name) => {
        const prof = info?.professors.find((p) => p.requested_name === name);
        return prof?.average_rating != null ? (
          <span
            key={name}
            className="professor-score"
            title={`${name}: ${prof.average_rating.toFixed(2)}/5 from ${prof.review_count ?? "unknown"} reviews`}
          >
            <Star size={11} />
            {prof.average_rating.toFixed(1)}
            <span className="muted">({prof.review_count ?? "—"})</span>
          </span>
        ) : null;
      })}
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
  const { records, pending, warnings } = useInsights();
  const [sort, setSort] = useState<ScheduleSort>("original");
  const options = sortOptions(scheduleOptions(plans, records), sort);
  if (!options.length) return null;
  return (
    <section className="card schedule-comparison">
      <div className="card-heading">
        <h3>Compare schedules</h3>
        <select
          aria-label="Sort schedule options"
          value={sort}
          onChange={(e) => setSort(e.target.value as ScheduleSort)}
        >
          <option value="original">Schedule order</option>
          <option value="rating">Higher professor rating</option>
          <option value="gpa">Higher historical GPA</option>
          <option value="days">Fewer campus days</option>
          <option value="gaps">Less time between classes</option>
        </select>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Option</th>
              <th>Professor rating</th>
              <th>Course GPA</th>
              <th>Days</th>
              <th>Gaps / week</th>
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
                  Plan {o.planIndex + 1} · Schedule {o.scheduleIndex + 1}
                </td>
                <td>
                  {o.metrics.rating?.toFixed(1) ?? "—"}
                  {o.metrics.rating !== null && " / 5"}
                  <small>
                    {o.metrics.rated}/{o.metrics.instructors} instructors rated
                  </small>
                </td>
                <td>
                  {o.metrics.gpa?.toFixed(2) ?? "—"}
                  <small>
                    {o.metrics.gpaCourses}/{o.metrics.courses} courses
                  </small>
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
                    onClick={() => onSelect(o.planIndex, o.scheduleIndex)}
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
      <details className="metric-notes">
        <summary>
          About these numbers
          {pending.size > 0 ? " · Loading PlanetTerp data…" : ""}
        </summary>
        <p>
          Ratings average the available instructor scores. Course GPA averages
          available PlanetTerp course averages, including withdrawals in
          PlanetTerp’s calculation. Coverage is shown for both. Missing scores
          are not zero. Days and gaps use published meeting times; TBA meetings
          need checking.
        </p>
        <p>
          Historical grades and student reviews do not predict your grade or
          course workload.{" "}
          <a
            target="_blank"
            rel="noreferrer"
            href="https://planetterp.com/about"
          >
            About PlanetTerp
          </a>
        </p>
        {warnings.map((w) => (
          <p key={w}>{w}</p>
        ))}
      </details>
    </section>
  );
}
