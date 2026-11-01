import { afterEach, expect, it, vi } from "vitest";
import { generate } from "./api";
import { demo } from "./demo";
import { defaultPreferences } from "./types";
afterEach(() => vi.unstubAllGlobals());
it("replaces blank proxy failures with actionable service guidance", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response("", { status: 500, statusText: "Internal Server Error" }),
      ),
  );
  await expect(generate(demo, defaultPreferences)).rejects.toThrow(
    "Restart npm run dev",
  );
});
it("preserves structured backend-unavailable errors", async () => {
  const detail =
    "The planning backend is unavailable. Restart npm run dev to start both services.";
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ detail }, { status: 503 })),
  );
  await expect(generate(demo, defaultPreferences)).rejects.toThrow(detail);
});
it("explains connection failures and timeouts", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
  );
  await expect(generate(demo, defaultPreferences)).rejects.toThrow(
    "Cannot reach the planning service",
  );
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new DOMException("Timed out", "TimeoutError")),
  );
  await expect(generate(demo, defaultPreferences)).rejects.toThrow(
    "Planning took too long",
  );
});
