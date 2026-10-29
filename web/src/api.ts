import type { Profile, Preferences, PlanResult, Course, Plan } from "./types";
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(150000),
  });
  if (!response.ok) {
    const data = await response
      .json()
      .catch(() => ({ detail: response.statusText }));
    throw new Error(
      typeof data.detail === "string"
        ? data.detail
        : "Check your profile, credit limits, and term selections.",
    );
  }
  return response.json();
}
export const loadCatalog = (term: string, concentration: string) =>
  request<{ courses: Course[]; warnings: string[] }>(
    `/catalog?term=${term}&prefixes=${[...new Set(["CMSC", "MATH", "STAT", "ENGL", "HIST", "ECON", concentration])].join(",")}`,
  );
export const generate = (profile: Profile, preferences: Preferences) =>
  request<PlanResult>("/plans/generate", { profile, preferences });
export const validate = (
  profile: Profile,
  preferences: Preferences,
  plan: Plan,
) => request<PlanResult>("/plans/validate", { profile, preferences, plan });
