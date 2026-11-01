import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { loadInsights } from "../api";
import type { CourseInsight, InsightRequest } from "./types";
interface Context {
  records: Record<string, CourseInsight>;
  pending: Set<string>;
  warnings: string[];
  ensure: (request: InsightRequest, force?: boolean) => void;
}
const InsightsContext = createContext<Context | null>(null);
export function InsightsProvider({ children }: { children: ReactNode }) {
  const [records, setRecords] = useState<Record<string, CourseInsight>>({}),
    [pending, setPending] = useState<Set<string>>(new Set()),
    [warnings, setWarnings] = useState<string[]>([]);
  const attempted = useRef(new Set<string>()),
    queue = useRef(Promise.resolve()),
    counts = useRef(new Map<string, number>());
  const ensure = useCallback((request: InsightRequest, force = false) => {
    const courses = [...new Set(request.courses)].filter((c) => {
      const key =
        c + "|" + [...(request.instructors?.[c] ?? [])].sort().join("|");
      if (!force && attempted.current.has(key)) return false;
      attempted.current.add(key);
      return true;
    });
    for (let i = 0; i < courses.length; i += 4) {
      const chunk = courses.slice(i, i + 4);
      for (const c of chunk)
        counts.current.set(c, (counts.current.get(c) ?? 0) + 1);
      setPending(new Set(counts.current.keys()));
      const instructors = Object.fromEntries(
        chunk.map((c) => [
          c,
          [...new Set(request.instructors?.[c] ?? [])].slice(0, 10),
        ]),
      );
      queue.current = queue.current.then(async () => {
        try {
          const r = await loadInsights({ courses: chunk, instructors });
          setRecords((prev) => {
            const next = { ...prev };
            for (const [c, value] of Object.entries(r.courses)) {
              const profs = new Map(
                (prev[c]?.professors ?? []).map((p) => [p.requested_name, p]),
              );
              for (const p of value.professors) profs.set(p.requested_name, p);
              next[c] = { ...value, professors: [...profs.values()] };
            }
            return next;
          });
          setWarnings(r.warnings);
        } catch {
          setWarnings([
            "PlanetTerp data could not be loaded. Your generated schedule is still available.",
          ]);
        } finally {
          for (const c of chunk) {
            const n = (counts.current.get(c) ?? 1) - 1;
            if (n) counts.current.set(c, n);
            else counts.current.delete(c);
          }
          setPending(new Set(counts.current.keys()));
        }
      });
    }
  }, []);
  return (
    <InsightsContext.Provider value={{ records, pending, warnings, ensure }}>
      {children}
    </InsightsContext.Provider>
  );
}
export function useInsights() {
  const value = useContext(InsightsContext);
  if (!value) throw new Error("Missing insights provider");
  return value;
}
