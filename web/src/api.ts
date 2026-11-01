import type {
  Profile,
  Preferences,
  PlanResult,
  Course,
  Plan,
  Section,
} from "./types";
async function requestData<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(150000),
    });
  } catch (error) {
    if (
      error instanceof Error &&
      ["TimeoutError", "AbortError"].includes(error.name)
    ) {
      throw new Error(
        "Planning took too long. Try a nearer graduation target or fewer pinned courses.",
      );
    }
    throw new Error(
      "Cannot reach the planning service. Restart npm run dev and try again.",
    );
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    if (typeof data?.detail === "string") throw new Error(data.detail);
    if (response.status >= 500) {
      throw new Error(
        "The planning service is unavailable. Restart npm run dev and try again.",
      );
    }
    throw new Error("Check your profile, credit limits, and term selections.");
  }
  return response.json();
}
export const loadCatalog = (term: string, concentration: string) =>
  requestData<{ courses: Course[]; warnings: string[] }>(
    `/catalog?term=${term}&prefixes=${[...new Set(["CMSC", "MATH", "STAT", "ENGL", "HIST", "ECON", concentration])].join(",")}`,
  );
export const generate = (profile: Profile, preferences: Preferences) =>
  requestData<PlanResult>("/plans/generate", { profile, preferences });
export const validate = (
  profile: Profile,
  preferences: Preferences,
  plan: Plan,
) => requestData<PlanResult>("/plans/validate", { profile, preferences, plan });

export const loadInsights = (
  request: import("./insights/types").InsightRequest,
) =>
  requestData<import("./insights/types").InsightResponse>("/insights", request);
export const loadSections = (term: string, course: string) =>
  requestData<{ sections: Section[]; stale: boolean }>(
    `/sections?term=${term}&course=${course}`,
  );
