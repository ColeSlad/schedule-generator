import { z } from "zod";
export const attemptSchema = z.object({
  course: z.string().regex(/^[A-Z][A-Z0-9 /-]{2,30}$/),
  term: z.string(),
  credits: z.number().min(0).max(30),
  grade: z.string(),
  status: z.enum(["completed", "in_progress", "unused"]),
  transfer: z.boolean(),
  requirements: z.array(z.string()),
});
export const profileSchema = z.object({
  program: z.string(),
  catalog_year: z.string(),
  credits_completed: z.number().min(0).max(400),
  credits_in_progress: z.number().min(0).max(40),
  gpa: z.number().min(0).max(4.3),
  resident_credits: z.number().min(0),
  upper_credits: z.number().min(0),
  major_upper_credits: z.number().min(0),
  gened_remaining: z.record(z.string(), z.number().int().min(0).max(2)),
  attempts: z.array(attemptSchema).max(250),
  issues: z.array(z.string()),
  reviewed: z.boolean(),
  overrides: z.array(z.string()),
});
export type Profile = z.infer<typeof profileSchema>;
export type Attempt = z.infer<typeof attemptSchema>;
export interface Meeting {
  days: string;
  start: number;
  end: number;
  location: string;
}
export interface Preferences {
  start_term: string;
  target_term: string | null;
  min_credits: number;
  max_credits: number;
  summer: boolean;
  winter: boolean;
  concentration: string;
  interests: string[];
  excluded: string[];
  pinned: Record<string, string>;
  pinned_sections: Record<string, string>;
  blocked: Meeting[];
  allow_full: boolean;
}
export interface Course {
  id: string;
  title: string;
  credits: number;
  geneds: string[];
  prerequisites: string[][];
  restrictions: string[];
  crosslisted: string[];
  terms: string[];
  source: string;
  fetched_at: string;
}
export interface Section {
  course: string;
  id: string;
  instructors: string;
  open_seats: number | null;
  meetings: Meeting[];
  arranged: boolean;
  source: string;
  fetched_at: string;
}
export interface Plan {
  semesters: { term: string; courses: string[]; credits: number }[];
  coverage: Record<string, string[]>;
  conditions: string[];
  schedules: Section[][];
}
export interface PlanResult {
  status:
    "feasible" | "conditional" | "infeasible" | "timeout" | "needs_review";
  plans: Plan[];
  messages: string[];
  sources: string[];
  horizon: string[];
  course_titles?: Record<string, string>;
}
export const defaultPreferences: Preferences = {
  start_term: "202701",
  target_term: null,
  min_credits: 12,
  max_credits: 15,
  summer: false,
  winter: false,
  concentration: "HIST",
  interests: [],
  excluded: [],
  pinned: {},
  pinned_sections: {},
  blocked: [],
  allow_full: false,
};
export const termLabel = (term: string) =>
  `${({ "01": "Spring", "05": "Summer", "08": "Fall", "12": "Winter" } as Record<string, string>)[term.slice(4)] ?? term} ${term.slice(0, 4)}`;
