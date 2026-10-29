import { expect, it } from "vitest";
import { importWorkspace, preferencesSchema } from "./storage";
import { defaultPreferences } from "./types";
import { demo } from "./demo";
it("accepts versioned backups and preserves planned semesters", () => {
  const result = {
    status: "conditional",
    plans: [
      {
        semesters: [{ term: "202701", courses: ["CMSC420"], credits: 3 }],
        coverage: {},
        conditions: ["Advisor confirmation"],
        schedules: [],
      },
    ],
    messages: [],
    sources: [],
    horizon: ["202701"],
  };
  expect(
    importWorkspace(
      JSON.stringify({
        version: 1,
        profile: demo,
        preferences: defaultPreferences,
        result,
      }),
    ).result?.plans[0].semesters[0].courses,
  ).toEqual(["CMSC420"]);
});
it("rejects invalid limits and arbitrary backup shapes", () => {
  expect(() =>
    preferencesSchema.parse({
      ...defaultPreferences,
      min_credits: 20,
      max_credits: 10,
    }),
  ).toThrow();
  expect(() => importWorkspace('{"version":9}')).toThrow();
});
