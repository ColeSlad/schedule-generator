import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  Download,
  FileText,
  Flag,
  GraduationCap,
  LayoutGrid,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type {
  Profile,
  Preferences,
  PlanResult,
  Course,
  Plan,
  Attempt,
} from "./types";
import { defaultPreferences, termLabel } from "./types";
import { parseAudit } from "./audit";
import {
  restore,
  persist,
  forget,
  exportWorkspace,
  importWorkspace,
  preferencesSchema,
} from "./storage";
import { generate, loadCatalog, validate } from "./api";
import { demo } from "./demo";

type Tab = "overview" | "audit" | "plan" | "schedule";
const genedNames: Record<string, string> = {
  FSAW: "Academic writing",
  FSPW: "Professional writing",
  FSOC: "Oral communication",
  FSMA: "Mathematics",
  FSAR: "Analytic reasoning",
  DSHU: "Humanities",
  DSHS: "History & social sciences",
  DSNL: "Natural sciences with lab",
  DSNS: "Natural sciences",
  DSSP: "Scholarship in practice",
  SCIS: "I-Series",
  DVUP: "Plural society",
  DVCC: "Cultural competency",
};
const nextTerms = Array.from({ length: 8 }, (_, i) => 2026 + i).flatMap((y) =>
  ["01", "05", "08", "12"].map((t) => `${y}${t}`),
);
const minutes = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
const time = (n: number) =>
  `${Math.floor(n / 60) % 12 || 12}:${String(n % 60).padStart(2, "0")}${n >= 720 ? "pm" : "am"}`;

export default function App() {
  const [profile, setProfile] = useState<Profile | null>(null),
    [prefs, setPrefs] = useState<Preferences>(defaultPreferences),
    [ready, setReady] = useState(false),
    [tab, setTab] = useState<Tab>("overview");
  const [result, setResult] = useState<PlanResult | null>(null),
    [planIndex, setPlanIndex] = useState(0),
    [scheduleIndex, setScheduleIndex] = useState(0),
    [fingerprint, setFingerprint] = useState("");
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [courses, setCourses] = useState<Course[]>([]),
    [warnings, setWarnings] = useState<string[]>([]),
    [search, setSearch] = useState(""),
    [browse, setBrowse] = useState(false),
    [saveError, setSaveError] = useState("");
  const [pinTerm, setPinTerm] = useState("202701"),
    [blockedDay, setBlockedDay] = useState("MWF"),
    [blockedStart, setBlockedStart] = useState("09:00"),
    [blockedEnd, setBlockedEnd] = useState("10:00");
  const pdfInput = useRef<HTMLInputElement>(null),
    jsonInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    restore()
      .then((w) => {
        setProfile(w.profile);
        setPrefs(w.preferences);
        setResult(w.result ?? null);
      })
      .catch(() =>
        setError(
          "Saved data could not be read. Import a backup or start with an audit.",
        ),
      )
      .finally(() => setReady(true));
  }, []);
  useEffect(() => {
    if (ready)
      persist(profile, prefs, result).catch(() =>
        setSaveError(
          "Browser storage unavailable. Export your work to keep a backup.",
        ),
      );
  }, [profile, prefs, result, ready]);
  const currentFingerprint = JSON.stringify({ profile, prefs });
  const stale = !!result && fingerprint !== currentFingerprint;
  const plan = result?.plans[planIndex];
  const schedules = plan?.schedules ?? [];
  const schedule = schedules[scheduleIndex] ?? [];
  const changeProfile = (p: Profile) => setProfile({ ...p, reviewed: false });
  const preference = <K extends keyof Preferences>(
    key: K,
    value: Preferences[K],
  ) => setPrefs((p) => ({ ...p, [key]: value }));
  async function upload(file?: File) {
    if (!file) return;
    setBusy("Reading your audit on this device…");
    setError("");
    try {
      setProfile(parseAudit(await (await import("./pdf")).extractAudit(file)));
      setResult(null);
      setTab("audit");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
      if (pdfInput.current) pdfInput.current.value = "";
    }
  }
  async function catalog() {
    setBusy("Refreshing published course offerings…");
    setError("");
    try {
      const r = await loadCatalog(prefs.start_term, prefs.concentration);
      setCourses(r.courses);
      setWarnings(r.warnings);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function run() {
    if (!profile) return;
    setBusy("Checking requirements and searching schedules…");
    setError("");
    try {
      preferencesSchema.parse(prefs);
      const r = await generate(profile, prefs);
      setResult(r);
      setFingerprint(currentFingerprint);
      setPlanIndex(0);
      setScheduleIndex(0);
      setTab("plan");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function move(course: string, _from: string, to: string) {
    if (!plan || !profile) return;
    const moved: Plan = {
      ...plan,
      schedules: [],
      semesters: plan.semesters.map((s) => ({
        ...s,
        courses: s.courses.filter((c) => c !== course),
      })),
    };
    let target = moved.semesters.find((s) => s.term === to);
    if (!target) {
      target = { term: to, courses: [], credits: 0 };
      moved.semesters.push(target);
    }
    target.courses.push(course);
    moved.semesters = moved.semesters
      .filter((s) => s.courses.length)
      .sort((a, b) => a.term.localeCompare(b.term));
    setBusy(`Validating ${course} in ${termLabel(to)}…`);
    try {
      const r = await validate(profile, prefs, moved);
      if (r.plans.length) {
        setResult(r);
        setPlanIndex(0);
        setFingerprint(currentFingerprint);
        setError(
          "Move validated academically. Regenerate to refresh weekly sections.",
        );
      } else {
        setError(`Move rejected: ${r.messages.join(" ")}`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  const updateAttempt = (i: number, patch: Partial<Attempt>) => {
    if (profile)
      changeProfile({
        ...profile,
        attempts: profile.attempts.map((a, n) =>
          n === i ? { ...a, ...patch } : a,
        ),
      });
  };
  const statTotal = profile
    ? profile.credits_completed + profile.credits_in_progress
    : 0;
  const remainingGeneds = profile
    ? Object.values(profile.gened_remaining).reduce((a, b) => a + b, 0)
    : 0;
  const remaining = profile
    ? Object.entries(profile.gened_remaining).filter(([, n]) => n > 0)
    : [];
  const setCoursePin = (id: string, term: string) => {
    const pinned = { ...prefs.pinned };
    if (term) pinned[id] = term;
    else delete pinned[id];
    preference("pinned", pinned);
  };
  return (
    <div className="app-shell">
      <input
        ref={pdfInput}
        type="file"
        accept="application/pdf"
        hidden
        onChange={(e) => upload(e.target.files?.[0])}
      />
      <input
        ref={jsonInput}
        type="file"
        accept="application/json"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          try {
            const w = importWorkspace(await file.text());
            setProfile(w.profile);
            setPrefs(w.preferences);
            setResult(w.result ?? null);
            setFingerprint("");
            setError("");
            setTab("audit");
          } catch {
            setError(
              "Invalid backup. Choose a Terp Path version 1 JSON export.",
            );
          }
          e.target.value = "";
        }}
      />
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setTab("overview");
          }}
        >
          <span className="brand-icon">
            <GraduationCap size={25} />
          </span>
          <span>
            terp<span className="brand-light">path</span>
            <small>YOUR NEXT CHAPTER</small>
          </span>
        </a>
        <div className="workspace-label">STUDENT WORKSPACE</div>
        <nav aria-label="Main navigation">
          {(
            [
              ["overview", "Overview", LayoutGrid],
              ["audit", "Degree audit", FileText],
              ["plan", "Graduation plan", Flag],
              ["schedule", "Weekly schedule", CalendarDays],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              className={tab === id ? "nav active" : "nav"}
              onClick={() => setTab(id)}
            >
              <Icon size={18} />
              {label}
              {id === "audit" && profile && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <ShieldCheck size={20} />
          <strong>Your audit stays yours.</strong>
          <p>
            PDFs are read on your device. Your reviewed coursework goes to the
            planning solver.
          </p>
          <span>No accounts. No AI.</span>
        </div>
        <div className="sidebar-bottom">
          <span className="umd-mark">M</span>
          <span>
            Made for Maryland<small>Independent student planning tool</small>
          </span>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <div>
            <span className="breadcrumb">WORKSPACE</span>
            <span className="separator">/</span>
            {
              {
                overview: "Overview",
                audit: "Degree audit",
                plan: "Graduation plan",
                schedule: "Weekly schedule",
              }[tab]
            }
          </div>
          <div className="local-status">
            <span />
            Saved on this device
          </div>
        </header>
        <div className="content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                UNIVERSITY OF MARYLAND · COLLEGE PARK
              </div>
              <h1>
                {tab === "overview"
                  ? "A clearer path to graduation."
                  : tab === "audit"
                    ? "Start with what you’ve earned."
                    : tab === "plan"
                      ? "Make every semester count."
                      : "Find your weekly rhythm."}
              </h1>
              <p>
                {tab === "overview"
                  ? "Your requirements, your schedule, your next step. All in one place."
                  : tab === "audit"
                    ? "Review your coursework so your plan starts on solid ground."
                    : tab === "plan"
                      ? "Build a course-by-course path around your goals."
                      : "Compare published sections and choose a schedule that fits."}
              </p>
            </div>
            <button
              className="button secondary"
              onClick={() => pdfInput.current?.click()}
              disabled={!!busy}
            >
              <Upload size={16} />
              {profile ? "Replace audit" : "Upload audit"}
            </button>
          </div>
          {error && (
            <div className="notice error" role="alert">
              <span>{error}</span>
              <button aria-label="Dismiss message" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {saveError && <div className="notice error">{saveError}</div>}
          {busy && (
            <div className="notice" role="status">
              <LoaderCircle size={17} className="spin" />
              {busy}
            </div>
          )}
          {stale && (
            <div className="notice">
              Your inputs changed. Regenerate before using the saved result.
            </div>
          )}
          {tab === "overview" && (
            <>
              <section className="hero">
                <div className="hero-copy">
                  <span className="pill">A PLAN THAT MOVES WITH YOU</span>
                  <h2>
                    Your degree.
                    <br />
                    Your direction.
                  </h2>
                  <p>
                    Turn your degree audit into a plan you can actually see.
                    Explore your options, then make your next move.
                  </p>
                  <button
                    className="button light"
                    onClick={() =>
                      profile ? setTab("plan") : pdfInput.current?.click()
                    }
                  >
                    {profile ? "Build my plan" : "Get started with your audit"}
                    <ArrowRight size={17} />
                  </button>
                  <div className="hero-foot">
                    <Check size={14} />
                    Free to explore <span>·</span> No sign-up needed
                  </div>
                </div>
                <div className="hero-graphic" aria-hidden="true">
                  <div className="orbit orbit-one" />
                  <div className="orbit orbit-two" />
                  <div className="path-line" />
                  <div className="milestone milestone-one">
                    <span>
                      <Check size={17} />
                    </span>
                    <div>
                      THE FOUNDATION<small>Credits you’ve earned</small>
                    </div>
                  </div>
                  <div className="milestone milestone-two">
                    <span>
                      <BookOpen size={18} />
                    </span>
                    <div>
                      THE NEXT STEP<small>A semester that fits</small>
                    </div>
                  </div>
                  <div className="milestone milestone-three">
                    <span>
                      <GraduationCap size={20} />
                    </span>
                    <div>
                      THE DESTINATION<small>Your graduation goal</small>
                    </div>
                    <ArrowUpRight size={20} />
                  </div>
                  <span className="graphic-caption">
                    GOOD PLANS START HERE.
                  </span>
                </div>
              </section>
              <div className="stats">
                <Stat
                  label="COMPLETED CREDITS"
                  value={profile ? String(profile.credits_completed) : "—"}
                  note="Toward your degree"
                  icon={<BookOpen size={19} />}
                />
                <Stat
                  label="IN PROGRESS"
                  value={profile ? String(profile.credits_in_progress) : "—"}
                  note="Counted conditionally"
                  icon={<RefreshCw size={19} />}
                />
                <Stat
                  label="GEN EDS REMAINING"
                  value={profile ? String(remainingGeneds) : "—"}
                  note="From your reviewed audit"
                  icon={<LayoutGrid size={19} />}
                />
                <Stat
                  label="GRADUATION TARGET"
                  value={
                    prefs.target_term
                      ? termLabel(prefs.target_term)
                      : "Your choice"
                  }
                  note="Explore what’s possible"
                  icon={<Flag size={19} />}
                />
              </div>
              <div className="two-columns">
                <section className="card">
                  <div className="card-heading">
                    <h3>Your degree at a glance</h3>
                    <span className="tag">CS GENERAL TRACK</span>
                  </div>
                  <div className="degree-line">
                    <span className="degree-icon">
                      <GraduationCap size={28} />
                    </span>
                    <div>
                      <h3>Computer Science, B.S.</h3>
                      <p>Fall 2025 catalog · Undergraduate pilot</p>
                    </div>
                  </div>
                  <div className="progress-label">
                    <span>Credit minimum</span>
                    <strong>
                      {profile
                        ? `${statTotal} / 120`
                        : "Upload to see progress"}
                    </strong>
                  </div>
                  <div className="progress">
                    <span
                      style={{
                        width: `${Math.min(100, (statTotal / 120) * 100)}%`,
                      }}
                    />
                  </div>
                  <p className="muted small">
                    Completed + in-progress credits. All degree requirements
                    must also be satisfied.
                  </p>
                  <button
                    className="text-button"
                    onClick={() => setTab("audit")}
                  >
                    Review degree requirements <ArrowRight size={15} />
                  </button>
                </section>
                <section className="card next-card">
                  <div className="eyebrow">ONE STEP AT A TIME</div>
                  <h3>
                    {profile
                      ? profile.reviewed
                        ? "Ready for your next semester?"
                        : "Give your audit a quick check."
                      : "Bring your progress with you."}
                  </h3>
                  <p>
                    {profile
                      ? "Confirm the details, set your preferences, and explore a plan built around your goals."
                      : "Export your expanded uAchieve audit as a PDF. We’ll organize the details so you can focus on what’s next."}
                  </p>
                  <button
                    className="button secondary"
                    onClick={() =>
                      profile
                        ? setTab(profile.reviewed ? "plan" : "audit")
                        : pdfInput.current?.click()
                    }
                  >
                    {profile ? "Continue planning" : "Upload degree audit"}
                    <ArrowRight size={16} />
                  </button>
                  {!profile && (
                    <button
                      className="text-button muted"
                      onClick={() => {
                        setProfile(structuredClone(demo));
                        setTab("audit");
                      }}
                    >
                      Or explore a synthetic example
                    </button>
                  )}
                </section>
              </div>
              <div className="section-heading">
                <h3>A little structure. A lot of possibility.</h3>
                <span>HOW IT WORKS</span>
              </div>
              <div className="steps">
                {[
                  [
                    "01",
                    "Bring your audit",
                    "Start with your completed courses and what’s left.",
                  ],
                  [
                    "02",
                    "Find your path",
                    "Balance requirements with your graduation goal.",
                  ],
                  [
                    "03",
                    "Make it fit",
                    "Compare actual sections for the next semester.",
                  ],
                ].map(([n, t, d]) => (
                  <div key={n}>
                    <span>{n}</span>
                    <h4>{t}</h4>
                    <p>{d}</p>
                  </div>
                ))}
              </div>
            </>
          )}
          {tab === "audit" &&
            (!profile ? (
              <section className="card empty">
                <FileText size={36} />
                <h2>Your progress starts here.</h2>
                <p>
                  Upload an expanded, printer-friendly uAchieve PDF.
                  <br />
                  Names and student IDs are never stored in your profile.
                </p>
                <button
                  className="button primary"
                  onClick={() => pdfInput.current?.click()}
                >
                  <Upload size={16} />
                  Choose audit PDF
                </button>
                <button
                  className="text-button"
                  onClick={() => {
                    setProfile(structuredClone(demo));
                    setTab("audit");
                  }}
                >
                  Explore synthetic example
                </button>
              </section>
            ) : (
              <>
                <div className="notice">
                  <ShieldCheck size={18} />
                  Only CS general track, program 07010, Fall 2025 is supported.
                  Verify your track and catalog year.
                </div>
                <section className="card">
                  <div className="card-heading">
                    <h3>Imported academic profile</h3>
                    <span className="tag">
                      {profile.attempts.length} COURSE ATTEMPTS
                    </span>
                  </div>
                  <div className="form-grid">
                    {(
                      [
                        ["credits_completed", "Completed credits"],
                        ["credits_in_progress", "In-progress credits"],
                        ["resident_credits", "Residence credits earned"],
                        ["upper_credits", "Upper-level credits earned"],
                        ["major_upper_credits", "Major upper-level earned"],
                        ["gpa", "Cumulative GPA"],
                      ] as const
                    ).map(([key, label]) => (
                      <label key={key}>
                        {label}
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          value={profile[key]}
                          onChange={(e) =>
                            changeProfile({
                              ...profile,
                              [key]: Number(e.target.value),
                            })
                          }
                        />
                      </label>
                    ))}
                    <label>
                      Program code
                      <input
                        value={profile.program}
                        onChange={(e) =>
                          changeProfile({ ...profile, program: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Catalog year
                      <input
                        value={profile.catalog_year}
                        onChange={(e) =>
                          changeProfile({
                            ...profile,
                            catalog_year: e.target.value,
                          })
                        }
                      />
                    </label>
                  </div>
                  {profile.issues.map((s) => (
                    <p className="review-note" key={s}>
                      {s}
                    </p>
                  ))}
                </section>
                <section className="card">
                  <h3>Remaining Gen Ed courses</h3>
                  <p className="muted">
                    Counts already account for courses in progress. Adjust these
                    to match the audit.
                  </p>
                  <div className="gened-grid">
                    {Object.entries(genedNames).map(([code, name]) => (
                      <label key={code}>
                        <span>
                          {name}
                          <small>{code}</small>
                        </span>
                        <input
                          aria-label={`${name} remaining`}
                          type="number"
                          min="0"
                          max="2"
                          value={profile.gened_remaining[code] ?? 0}
                          onChange={(e) =>
                            changeProfile({
                              ...profile,
                              gened_remaining: {
                                ...profile.gened_remaining,
                                [code]: Number(e.target.value),
                              },
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>
                </section>
                <section className="card">
                  <div className="card-heading">
                    <h3>Course history</h3>
                    <button
                      className="text-button"
                      onClick={() =>
                        changeProfile({
                          ...profile,
                          attempts: [
                            ...profile.attempts,
                            {
                              course: "NEW100",
                              term: "202608",
                              credits: 3,
                              grade: "A",
                              status: "completed",
                              transfer: false,
                              requirements: [],
                            },
                          ],
                        })
                      }
                    >
                      <Plus size={15} />
                      Add course
                    </button>
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Course</th>
                          <th>Term</th>
                          <th>Credits</th>
                          <th>Grade</th>
                          <th>Status</th>
                          <th>Transfer/AP</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {profile.attempts.map((a, i) => (
                          <tr key={i}>
                            <td>
                              <input
                                aria-label={`Course ${i + 1}`}
                                value={a.course}
                                onChange={(e) =>
                                  updateAttempt(i, {
                                    course: e.target.value.toUpperCase(),
                                  })
                                }
                              />
                            </td>
                            <td>
                              <input
                                aria-label={`Term ${i + 1}`}
                                value={a.term}
                                onChange={(e) =>
                                  updateAttempt(i, { term: e.target.value })
                                }
                              />
                            </td>
                            <td>
                              <input
                                aria-label={`Credits ${i + 1}`}
                                type="number"
                                min="0"
                                max="30"
                                value={a.credits}
                                onChange={(e) =>
                                  updateAttempt(i, {
                                    credits: Number(e.target.value),
                                  })
                                }
                              />
                            </td>
                            <td>
                              <input
                                aria-label={`Grade ${i + 1}`}
                                value={a.grade}
                                onChange={(e) =>
                                  updateAttempt(i, { grade: e.target.value })
                                }
                              />
                            </td>
                            <td>
                              <select
                                aria-label={`Status ${i + 1}`}
                                value={a.status}
                                onChange={(e) =>
                                  updateAttempt(i, {
                                    status: e.target.value as Attempt["status"],
                                  })
                                }
                              >
                                <option value="completed">Completed</option>
                                <option value="in_progress">In progress</option>
                                <option value="unused">Unused</option>
                              </select>
                            </td>
                            <td>
                              <input
                                aria-label={`Transfer ${i + 1}`}
                                type="checkbox"
                                checked={a.transfer}
                                onChange={(e) =>
                                  updateAttempt(i, {
                                    transfer: e.target.checked,
                                  })
                                }
                              />
                            </td>
                            <td>
                              <button
                                aria-label={`Remove ${a.course}`}
                                onClick={() =>
                                  changeProfile({
                                    ...profile,
                                    attempts: profile.attempts.filter(
                                      (_, n) => n !== i,
                                    ),
                                  })
                                }
                              >
                                <X size={14} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
                <section className="card">
                  <h3>Advisor notes and exceptions</h3>
                  <p className="muted">
                    Notes travel with your plan. They do not automatically waive
                    solver constraints.
                  </p>
                  <textarea
                    aria-label="Advisor notes"
                    rows={3}
                    placeholder="Record confirmed exceptions or questions for your advisor, one per line."
                    value={profile.overrides.join("\n")}
                    onChange={(e) =>
                      changeProfile({
                        ...profile,
                        overrides: e.target.value.split("\n"),
                      })
                    }
                  />
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={profile.reviewed}
                      onChange={(e) =>
                        setProfile({ ...profile, reviewed: e.target.checked })
                      }
                    />
                    I’ve reviewed the imported information and remaining
                    requirements.
                  </label>
                  <button
                    className="button primary"
                    disabled={!profile.reviewed}
                    onClick={() => setTab("plan")}
                  >
                    Set my planning goals <ArrowRight size={16} />
                  </button>
                </section>
              </>
            ))}
          {tab === "plan" && (
            <>
              <div className="planning-layout">
                <section className="card preferences">
                  <div className="card-heading">
                    <h3>Planning goals</h3>
                    <Settings2 size={17} />
                  </div>
                  <label>
                    First semester
                    <select
                      value={prefs.start_term}
                      onChange={(e) => preference("start_term", e.target.value)}
                    >
                      {nextTerms.map((t) => (
                        <option key={t} value={t}>
                          {termLabel(t)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Graduation goal
                    <select
                      value={prefs.target_term ?? ""}
                      onChange={(e) =>
                        preference("target_term", e.target.value || null)
                      }
                    >
                      <option value="">Earliest feasible graduation</option>
                      {nextTerms
                        .filter((t) => t >= prefs.start_term)
                        .map((t) => (
                          <option key={t} value={t}>
                            {termLabel(t)}
                          </option>
                        ))}
                    </select>
                  </label>
                  <div className="form-grid compact">
                    <label>
                      Min. credits
                      <input
                        type="number"
                        min="0"
                        max="24"
                        value={prefs.min_credits}
                        onChange={(e) =>
                          preference("min_credits", Number(e.target.value))
                        }
                      />
                    </label>
                    <label>
                      Max. credits
                      <input
                        type="number"
                        min="1"
                        max="24"
                        value={prefs.max_credits}
                        onChange={(e) =>
                          preference("max_credits", Number(e.target.value))
                        }
                      />
                    </label>
                  </div>
                  <label>
                    Concentration discipline
                    <select
                      value={prefs.concentration}
                      onChange={(e) =>
                        preference("concentration", e.target.value)
                      }
                    >
                      {["HIST", "ENGL", "MATH", "STAT", "ECON"].map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </label>
                  <p className="small muted">
                    12 upper-level credits, subject to advisor confirmation.
                    Courses and prerequisites vary by discipline.
                  </p>
                  <label>
                    Subjects you’re interested in
                    <input
                      placeholder="e.g. history, design, security"
                      value={prefs.interests.join(",")}
                      onChange={(e) =>
                        preference(
                          "interests",
                          e.target.value.split(",").slice(0, 20),
                        )
                      }
                    />
                  </label>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={prefs.summer}
                      onChange={(e) => preference("summer", e.target.checked)}
                    />
                    Include summer
                  </label>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={prefs.winter}
                      onChange={(e) => preference("winter", e.target.checked)}
                    />
                    Include winter
                  </label>
                  <button
                    className="button primary full"
                    disabled={!!busy || !profile?.reviewed}
                    onClick={run}
                  >
                    {busy ? (
                      <LoaderCircle size={16} className="spin" />
                    ) : (
                      <Flag size={16} />
                    )}
                    Generate plans
                  </button>
                  {!profile?.reviewed && (
                    <button
                      className="text-button"
                      onClick={() => setTab("audit")}
                    >
                      Review your audit first <ArrowRight size={14} />
                    </button>
                  )}
                </section>
                <div className="plan-main">
                  <section className="card">
                    <div className="card-heading">
                      <h3>Make room for what matters</h3>
                      <button
                        className="text-button"
                        onClick={() => {
                          setBrowse(true);
                          if (!courses.length) void catalog();
                        }}
                      >
                        Browse courses <ArrowUpRight size={15} />
                      </button>
                    </div>
                    <p className="muted">
                      Pin courses to a semester or exclude them from your plan.
                    </p>
                    {Object.entries(prefs.pinned).map(([c, t]) => (
                      <div className="pin-row" key={c}>
                        <strong>{c}</strong>
                        <span>{termLabel(t)}</span>
                        <button
                          aria-label={`Unpin ${c}`}
                          onClick={() => setCoursePin(c, "")}
                        >
                          <X size={15} />
                        </button>
                      </div>
                    ))}
                    {prefs.excluded.length > 0 && (
                      <div className="chips">
                        {prefs.excluded.map((c) => (
                          <button
                            className="chip"
                            key={c}
                            onClick={() =>
                              preference(
                                "excluded",
                                prefs.excluded.filter((v) => v !== c),
                              )
                            }
                          >
                            {c} excluded <X size={12} />
                          </button>
                        ))}
                      </div>
                    )}
                    {!Object.keys(prefs.pinned).length &&
                      !prefs.excluded.length && (
                        <div className="soft-empty">
                          <BookOpen size={20} />
                          Keep your options open, or choose a few must-takes.
                        </div>
                      )}
                  </section>
                  {!result ? (
                    <section className="card empty">
                      <Flag size={32} />
                      <h3>A path built around your goals.</h3>
                      <p>
                        Confirm your audit, choose your preferences,
                        <br />
                        and generate your first graduation plan.
                      </p>
                      <span className="tag">
                        UP TO 12 FUTURE FALL / SPRING TERMS
                      </span>
                    </section>
                  ) : (
                    <>
                      <div className="result-heading">
                        <div>
                          <span className="eyebrow">PLANNING RESULT</span>
                          <h3>
                            {result.plans.length
                              ? `${result.plans.length} paths to explore`
                              : result.status === "timeout"
                                ? "More search needed"
                                : result.status === "needs_review"
                                  ? "A few details need review"
                                  : "No plan within these constraints"}
                          </h3>
                        </div>
                        {result.plans.length > 1 && (
                          <select
                            aria-label="Choose plan"
                            value={planIndex}
                            onChange={(e) => {
                              setPlanIndex(Number(e.target.value));
                              setScheduleIndex(0);
                            }}
                          >
                            {result.plans.map((_, i) => (
                              <option key={i} value={i}>
                                Option {i + 1}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                      {result.messages.length > 0 && (
                        <div className="notice stack">
                          {result.messages.map((m, i) => (
                            <p key={i}>{m}</p>
                          ))}
                        </div>
                      )}
                      {plan && (
                        <>
                          <div className="notice">
                            <ShieldCheck size={18} />
                            Conditional plan ·{" "}
                            {stale
                              ? "Inputs changed"
                              : "Advisor and future-offering checks remain"}
                          </div>
                          {plan.semesters.map((s, i) => (
                            <section className="card semester" key={s.term}>
                              <div className="card-heading">
                                <h3>
                                  <span className="semester-number">
                                    {String(i + 1).padStart(2, "0")}
                                  </span>
                                  {termLabel(s.term)}
                                </h3>
                                <span className="tag">
                                  {s.credits} CREDITS ·{" "}
                                  {s.term === prefs.start_term
                                    ? "PUBLISHED"
                                    : "PROJECTED"}
                                </span>
                              </div>
                              {s.courses.map((c) => (
                                <div className="planned-course" key={c}>
                                  <div>
                                    <strong>{c}</strong>
                                    <span>
                                      {courses.find((v) => v.id === c)?.title ??
                                        result?.course_titles?.[c] ??
                                        "See Testudo for course details"}
                                    </span>
                                  </div>
                                  <select
                                    aria-label={`Move ${c}`}
                                    value={s.term}
                                    disabled={!!busy}
                                    onChange={(e) =>
                                      move(c, s.term, e.target.value)
                                    }
                                  >
                                    {result.horizon.map((t) => (
                                      <option key={t} value={t}>
                                        {termLabel(t)}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              ))}
                            </section>
                          ))}
                          <section className="card">
                            <h3>What this plan covers</h3>
                            <div className="coverage">
                              {Object.entries(plan.coverage).map(
                                ([name, ids]) =>
                                  ids.length > 0 && (
                                    <div key={name}>
                                      <CheckCircle2 size={15} />
                                      <span>
                                        {name}
                                        <small>{ids.join(", ")}</small>
                                      </span>
                                    </div>
                                  ),
                              )}
                            </div>
                          </section>
                          <details className="card">
                            <summary>
                              Assumptions & items to confirm{" "}
                              <ChevronDown size={16} />
                            </summary>
                            <ul className="conditions">
                              {plan.conditions.map((c, i) => (
                                <li key={i}>{c}</li>
                              ))}
                            </ul>
                          </details>
                          <button
                            className="button primary"
                            onClick={() => setTab("schedule")}
                          >
                            Explore weekly schedules <ArrowRight size={16} />
                          </button>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            </>
          )}
          {tab === "schedule" && (
            <>
              <section className="card">
                <div className="card-heading">
                  <h3>When are you unavailable?</h3>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={prefs.allow_full}
                      onChange={(e) =>
                        preference("allow_full", e.target.checked)
                      }
                    />
                    Include full / waitlisted sections
                  </label>
                </div>
                <div className="block-controls">
                  <label>
                    Days
                    <select
                      value={blockedDay}
                      onChange={(e) => setBlockedDay(e.target.value)}
                    >
                      {["M", "Tu", "W", "Th", "F", "MWF", "TuTh"].map((d) => (
                        <option key={d}>{d}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    From
                    <input
                      type="time"
                      value={blockedStart}
                      onChange={(e) => setBlockedStart(e.target.value)}
                    />
                  </label>
                  <label>
                    Until
                    <input
                      type="time"
                      value={blockedEnd}
                      onChange={(e) => setBlockedEnd(e.target.value)}
                    />
                  </label>
                  <button
                    className="button secondary"
                    onClick={() => {
                      if (minutes(blockedEnd) <= minutes(blockedStart)) {
                        setError("End time must follow start time.");
                        return;
                      }
                      preference("blocked", [
                        ...prefs.blocked,
                        {
                          days: blockedDay,
                          start: minutes(blockedStart),
                          end: minutes(blockedEnd),
                          location: "",
                        },
                      ]);
                    }}
                  >
                    <Plus size={16} />
                    Block time
                  </button>
                </div>
                <div className="chips">
                  {prefs.blocked.map((m, i) => (
                    <button
                      key={i}
                      className="chip"
                      onClick={() =>
                        preference(
                          "blocked",
                          prefs.blocked.filter((_, j) => i !== j),
                        )
                      }
                    >
                      {m.days} {time(m.start)}–{time(m.end)}
                      <X size={13} />
                    </button>
                  ))}
                </div>
                <button
                  className="text-button"
                  disabled={!!busy || !profile?.reviewed}
                  onClick={run}
                >
                  Regenerate with these preferences <RefreshCw size={14} />
                </button>
              </section>
              {!schedules.length ? (
                <section className="card empty">
                  <CalendarDays size={34} />
                  <h3>Your week is taking shape.</h3>
                  <p>
                    Generate a graduation plan with courses in a published term
                    <br />
                    to see compatible section schedules here.
                  </p>
                  <button
                    className="button secondary"
                    onClick={() => setTab("plan")}
                  >
                    Go to graduation plan <ArrowRight size={15} />
                  </button>
                </section>
              ) : (
                <>
                  <div className="section-heading">
                    <h3>{termLabel(prefs.start_term)}</h3>
                    <select
                      aria-label="Choose weekly schedule"
                      value={scheduleIndex}
                      onChange={(e) => setScheduleIndex(Number(e.target.value))}
                    >
                      {schedules.map((_, i) => (
                        <option key={i} value={i}>
                          Schedule {i + 1}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="calendar card">
                    <div className="calendar-head">
                      <span />
                      {[
                        "Monday",
                        "Tuesday",
                        "Wednesday",
                        "Thursday",
                        "Friday",
                      ].map((d) => (
                        <strong key={d}>{d}</strong>
                      ))}
                    </div>
                    <div className="calendar-body">
                      <div className="time-axis">
                        {Array.from({ length: 15 }, (_, i) => (
                          <span key={i}>{time((i + 7) * 60)}</span>
                        ))}
                      </div>
                      {["M", "Tu", "W", "Th", "F"].map((day) => (
                        <div className="day-column" key={day}>
                          {schedule.flatMap((s, i) =>
                            s.meetings
                              .filter((m) => dayTokens(m.days).includes(day))
                              .map((m, j) => (
                                <div
                                  key={`${s.course}-${j}`}
                                  className={`calendar-event color-${i % 5}`}
                                  style={{
                                    top: `${((m.start - 420) / 900) * 100}%`,
                                    height: `${((m.end - m.start) / 900) * 100}%`,
                                  }}
                                >
                                  <strong>{s.course}</strong>
                                  <span>
                                    {time(m.start)}–{time(m.end)}
                                  </span>
                                  <small>{m.location}</small>
                                </div>
                              )),
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="section-list">
                    {schedule.map((s) => (
                      <section className="card" key={s.course}>
                        <div className="card-heading">
                          <h3>
                            {s.course}
                            <span className="muted"> · {s.id}</span>
                          </h3>
                          <span className="tag">
                            {s.open_seats === null
                              ? "SEATS UNKNOWN"
                              : `${s.open_seats} OPEN`}
                          </span>
                        </div>
                        <p>{s.instructors || "Instructor TBA"}</p>
                        {s.arranged && (
                          <p className="review-note">
                            Arranged or TBA meetings need manual conflict
                            checks.
                          </p>
                        )}
                        <p className="small muted">
                          Fetched {new Date(s.fetched_at).toLocaleString()}.
                          Seats may change.
                        </p>
                        <div className="card-heading">
                          <a
                            className="text-button"
                            target="_blank"
                            rel="noreferrer"
                            href={`https://app.testudo.umd.edu/soc/${prefs.start_term}/${s.course.replace(/\d.*$/, "")}/${s.course}`}
                          >
                            View on Testudo <ArrowUpRight size={14} />
                          </a>
                          <button
                            className="text-button"
                            onClick={() =>
                              preference("pinned_sections", {
                                ...prefs.pinned_sections,
                                [s.course]: s.id,
                              })
                            }
                          >
                            Pin section
                          </button>
                        </div>
                      </section>
                    ))}
                  </div>
                </>
              )}
              {Object.entries(prefs.pinned_sections).map(([c, s]) => (
                <button
                  key={c}
                  className="chip"
                  onClick={() => {
                    const v = { ...prefs.pinned_sections };
                    delete v[c];
                    preference("pinned_sections", v);
                  }}
                >
                  {c} {s} pinned <X size={13} />
                </button>
              ))}
            </>
          )}
          <footer>
            <span>Plan with confidence. Confirm with your advisor.</span>
            <div>
              <button onClick={() => jsonInput.current?.click()}>
                Import backup
              </button>
              <button onClick={() => exportWorkspace(profile, prefs, result)}>
                <Download size={13} />
                Export backup
              </button>
              <button onClick={() => window.print()}>Print plan</button>
              <button
                onClick={async () => {
                  if (
                    window.confirm(
                      "Delete this device’s saved profile and preferences?",
                    )
                  ) {
                    await forget();
                    setProfile(null);
                    setPrefs(defaultPreferences);
                    setResult(null);
                  }
                }}
              >
                <Trash2 size={13} />
                Delete data
              </button>
            </div>
          </footer>
        </div>
      </main>
      {browse && (
        <div className="modal-backdrop">
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Browse courses"
            className="course-modal"
          >
            <div className="card-heading">
              <div>
                <div className="eyebrow">
                  PUBLISHED OFFERINGS · {termLabel(prefs.start_term)}
                </div>
                <h2>Find your next course.</h2>
              </div>
              <button
                aria-label="Close course browser"
                onClick={() => setBrowse(false)}
              >
                <X />
              </button>
            </div>
            <div className="search-box">
              <Search size={18} />
              <input
                aria-label="Search courses"
                placeholder="Search course code, title, or Gen Ed…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button
                aria-label="Refresh courses"
                disabled={!!busy}
                onClick={catalog}
              >
                <RefreshCw size={16} />
              </button>
            </div>
            <label className="pin-select">
              Pin selected courses to
              <select
                value={pinTerm}
                onChange={(e) => setPinTerm(e.target.value)}
              >
                {nextTerms
                  .filter((t) => t >= prefs.start_term)
                  .map((t) => (
                    <option value={t} key={t}>
                      {termLabel(t)}
                    </option>
                  ))}
              </select>
            </label>
            {warnings.map((w) => (
              <p key={w} className="review-note">
                {w}
              </p>
            ))}
            {!courses.length && (
              <p className="muted">
                {busy || "No course data loaded. Refresh to try again."}
              </p>
            )}
            <div className="course-results">
              {courses
                .filter((c) =>
                  `${c.id} ${c.title} ${c.geneds.join(" ")}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .map((c) => (
                  <article key={c.id}>
                    <div>
                      <strong>
                        {c.id}
                        <span className="muted"> · {c.credits} credits</span>
                      </strong>
                      <h4>{c.title}</h4>
                      <div className="chips">
                        {c.geneds.map((g) => (
                          <span className="tag" key={g}>
                            {g}
                          </span>
                        ))}
                      </div>
                      <a
                        href={c.source}
                        target="_blank"
                        rel="noreferrer"
                        className="small text-button"
                      >
                        Course details <ArrowUpRight size={12} />
                      </a>
                    </div>
                    <div className="course-actions">
                      <button
                        className="button secondary"
                        disabled={prefs.excluded.includes(c.id)}
                        onClick={() => setCoursePin(c.id, pinTerm)}
                      >
                        {prefs.pinned[c.id] ? "Pinned" : "+ Pin"}
                      </button>
                      <button
                        className="text-button muted"
                        onClick={() => {
                          setCoursePin(c.id, "");
                          preference(
                            "excluded",
                            Array.from(new Set([...prefs.excluded, c.id])),
                          );
                        }}
                      >
                        Exclude
                      </button>
                    </div>
                  </article>
                ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
function Stat({
  label,
  value,
  note,
  icon,
}: {
  label: string;
  value: string;
  note: string;
  icon: React.ReactNode;
}) {
  return (
    <section className="stat card">
      <div>
        {label}
        {icon}
      </div>
      <strong>{value}</strong>
      <span>{note}</span>
    </section>
  );
}
function dayTokens(days: string): string[] {
  return days.match(/Tu|Th|Sa|Su|M|W|F/g) ?? [];
}
