import type { Plan, Section, Meeting } from "../types";
import type { CourseInsight } from "./types";
export const days = (value: string): string[] =>
  value.match(/Tu|Th|Sa|Su|M|W|F/g) ?? [];
export const instructorNames = (s: Section) =>
  s.instructor_names?.length
    ? s.instructor_names.filter(
        (name) => !/^(staff|tba|instructor\s*:?\s*tba)$/i.test(name.trim()),
      )
    : s.instructors &&
        !/^(staff|tba|instructor\s*:?\s*tba)$/i.test(s.instructors.trim())
      ? [s.instructors.trim()]
      : [];
export const overlaps = (a: Meeting, b: Meeting) =>
  days(a.days).some((d) => days(b.days).includes(d)) &&
  a.start < b.end &&
  b.start < a.end;
export function scheduleMetrics(
  sections: Section[],
  insights: Record<string, CourseInsight>,
) {
  const intervals: Record<string, { start: number; end: number }[]> = {};
  const campusDays = new Set<string>();
  const ratings = new Map<string, number>();
  const requested = new Set<string>();
  const gpas: number[] = [];
  for (const s of sections) {
    const info = insights[s.course];
    if (info?.average_gpa != null) gpas.push(info.average_gpa);
    const names = instructorNames(s);
    if (!names.length) requested.add(`Unassigned:${s.course}`);
    for (const name of names) {
      requested.add(name);
      const p = info?.professors.find((p) => p.requested_name === name);
      if (p?.average_rating != null) ratings.set(name, p.average_rating);
    }
    for (const m of s.meetings)
      for (const d of days(m.days)) {
        (intervals[d] ??= []).push(m);
        if (s.delivery !== "online" && !/\bONLINE\b/i.test(m.location))
          campusDays.add(d);
      }
  }
  let gaps = 0;
  for (const list of Object.values(intervals)) {
    list.sort((a, b) => a.start - b.start);
    let end = list[0].end;
    for (const next of list.slice(1)) {
      gaps += Math.max(0, next.start - end);
      end = Math.max(end, next.end);
    }
  }
  return {
    days: campusDays.size,
    gaps,
    rating: ratings.size
      ? [...ratings.values()].reduce((a, b) => a + b, 0) / ratings.size
      : null,
    rated: ratings.size,
    instructors: requested.size,
    gpa: gpas.length ? gpas.reduce((a, b) => a + b, 0) / gpas.length : null,
    gpaCourses: gpas.length,
    courses: sections.length,
    arranged: sections.some((s) => s.arranged),
  };
}
export interface ScheduleOption {
  planIndex: number;
  scheduleIndex: number;
  sections: Section[];
  metrics: ReturnType<typeof scheduleMetrics>;
}
export function scheduleOptions(
  plans: Plan[],
  insights: Record<string, CourseInsight>,
) {
  return plans.flatMap((p, planIndex) =>
    p.schedules.map((sections, scheduleIndex) => ({
      planIndex,
      scheduleIndex,
      sections,
      metrics: scheduleMetrics(sections, insights),
    })),
  );
}
export type ScheduleSort = "original" | "rating" | "gpa" | "days" | "gaps";
export function sortOptions(options: ScheduleOption[], sort: ScheduleSort) {
  return [...options].sort((a, b) => {
    if (sort === "original")
      return a.planIndex - b.planIndex || a.scheduleIndex - b.scheduleIndex;
    if (sort === "days" || sort === "gaps")
      return (
        Number(a.metrics.arranged) - Number(b.metrics.arranged) ||
        a.metrics[sort] - b.metrics[sort] ||
        a.planIndex - b.planIndex ||
        a.scheduleIndex - b.scheduleIndex
      );
    const x = a.metrics[sort],
      y = b.metrics[sort];
    if (x === null) return y === null ? 0 : 1;
    if (y === null) return -1;
    const coverage =
      sort === "rating"
        ? b.metrics.rated / Math.max(1, b.metrics.instructors) -
          a.metrics.rated / Math.max(1, a.metrics.instructors)
        : b.metrics.gpaCourses / b.metrics.courses -
          a.metrics.gpaCourses / a.metrics.courses;
    return (
      coverage ||
      y - x ||
      a.planIndex - b.planIndex ||
      a.scheduleIndex - b.scheduleIndex
    );
  });
}

export function calendarRange(sections: Section[]) {
  const meetings = sections.flatMap((s) => s.meetings);
  const start = meetings.length
    ? Math.max(
        0,
        Math.floor(Math.min(...meetings.map((m) => m.start)) / 60) - 1,
      ) * 60
    : 480;
  const end = meetings.length
    ? Math.min(
        1440,
        (Math.ceil(Math.max(...meetings.map((m) => m.end)) / 60) + 1) * 60,
      )
    : 1080;
  const hours = (end - start) / 60;
  return { start, end, hours, height: Math.max(360, hours * 48) };
}
