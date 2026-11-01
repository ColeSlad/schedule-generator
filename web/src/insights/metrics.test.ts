import { expect, it } from "vitest";
import {
  calendarRange,
  scheduleMetrics,
  sortOptions,
  instructorNames,
  overlaps,
} from "./metrics";
import type { ScheduleOption } from "./metrics";
import type { Section } from "../types";
import type { CourseInsight } from "./types";
const section = (
  course: string,
  start = 600,
  end = 650,
  days = "TuTh",
): Section => ({
  course,
  id: "0101",
  instructors: "Synthetic Instructor",
  instructor_names: ["Synthetic Instructor"],
  open_seats: 4,
  meetings: [{ days, start, end, location: "" }],
  arranged: false,
  source: "synthetic",
  fetched_at: "2026-11-01",
});
const insight = (
  course: string,
  gpa: number | null,
  rating: number | null,
): CourseInsight => ({
  course,
  title: course,
  status: "available",
  source: "synthetic",
  average_gpa: gpa,
  grades: null,
  professors: [
    {
      requested_name: "Synthetic Instructor",
      name: "Synthetic Instructor",
      status: "available",
      source: "synthetic",
      average_rating: rating,
      review_count: 5,
      course_rating: null,
      course_review_count: 0,
      grades: null,
      recent_review: null,
      stale: false,
    },
  ],
  stale: false,
  fetched_at: "2026-11-01",
});
it("calculates days and total gaps, including linked meetings without double counting overlap", () => {
  const a = section("CMSC420"),
    b = section("CMSC430", 680, 730);
  const m = scheduleMetrics([a, b], {});
  expect(m.days).toBe(2);
  expect(m.gaps).toBe(60);
  expect(
    overlaps(a.meetings[0], { days: "Th", start: 640, end: 700, location: "" }),
  ).toBe(true);
  expect(
    overlaps(
      { days: "Tu", start: 600, end: 650, location: "" },
      { days: "Th", start: 600, end: 650, location: "" },
    ),
  ).toBe(false);
  expect(scheduleMetrics([a, section("CMSC430", 630, 700)], {}).gaps).toBe(0);
});
it("keeps a real zero GPA, ignores missing scores, and counts a shared professor once", () => {
  const data = {
    CMSC420: insight("CMSC420", 0, 4),
    CMSC430: insight("CMSC430", null, 4),
  };
  const m = scheduleMetrics([section("CMSC420"), section("CMSC430")], data);
  expect(m.gpa).toBe(0);
  expect(m.gpaCourses).toBe(1);
  expect(m.rating).toBe(4);
  expect(m.rated).toBe(1);
  const tba = {
    ...section("HIST300"),
    instructors: "TBA",
    instructor_names: [],
  };
  expect(scheduleMetrics([section("CMSC420"), tba], data).instructors).toBe(2);
  expect(instructorNames({ ...tba, instructor_names: ["Staff"] })).toEqual([]);
  expect(instructorNames({ ...tba, instructors: "Instructor: TBA" })).toEqual(
    [],
  );
});
it("sorts only existing options, keeps missing data last, and favors complete coverage", () => {
  const option = (
    planIndex: number,
    gpa: number | null,
    coverage: number,
  ): ScheduleOption => ({
    planIndex,
    scheduleIndex: 0,
    sections: [],
    metrics: {
      days: 3,
      gaps: 60,
      rating: null,
      rated: 0,
      instructors: 1,
      gpa,
      gpaCourses: coverage,
      courses: 2,
      arranged: false,
    },
  });
  const rows = [option(0, null, 0), option(1, 0, 2), option(2, 4, 1)];
  expect(sortOptions(rows, "gpa").map((o) => o.planIndex)).toEqual([1, 2, 0]);
  expect(sortOptions(rows, "original").map((o) => o.planIndex)).toEqual([
    0, 1, 2,
  ]);
  expect(rows[0].planIndex).toBe(0);
});

it("fits the calendar around early, late, and ordinary meetings", () => {
  const ordinary = calendarRange([section("CMSC420", 600, 650)]);
  expect(ordinary.start).toBe(540);
  expect(ordinary.end).toBe(720);
  expect(ordinary.height).toBeGreaterThanOrEqual(360);
  const extended = calendarRange([
    section("CMSC420", 360, 410),
    section("CMSC430", 1380, 1430),
  ]);
  expect(extended.start).toBeLessThanOrEqual(360);
  expect(extended.end).toBe(1440);
  expect(calendarRange([]).hours).toBeGreaterThan(0);
});
