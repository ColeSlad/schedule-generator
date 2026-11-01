# Implementation notes

## Data flow

1. PDF.js groups PDF text by page coordinates. `audit.ts` strips repetitive chrome, extracts attempts, deduplicates repeated audit listings, associates requirement sections, and reconciles credit totals.
2. Students correct the academic profile and confirm it. IndexedDB stores only structured academic data and preferences, plus draft plan results.
3. The frontend posts the reviewed profile to FastAPI. Pydantic validates requests; Zod validates imported backups. Neither backend request models nor persisted frontend profiles include names, IDs, or raw audit text.
4. Source adapters fetch published term data, the two preceding regular semesters, and official-catalog descriptions of prerequisites and restrictions. Only public HTML enters SQLite.
5. CP-SAT chooses course/semester variables, distinct requirement allocations, and first-semester sections together. The initial feasibility search passes its solution forward as an optimization hint. A short-horizon timeout does not prevent searching later terms. Assumption-based diagnostics run separately, only after a proven infeasible result, with a bounded single-worker solver.
6. Published sections are fetched in batches of up to 25 courses with at most four concurrent requests. Course containers are parsed separately so section bundles cannot leak between courses. Known-empty sections exclude a course from the first semester; missing source data remains unverified. Each bundle includes its linked meetings. Seat filters, availability blocks, section pins, and inter-course time clashes constrain course selection directly. An optional search adds weekly alternatives; its timeout cannot discard the valid assignment already found.
7. Course moves call academic validation with fixed placements. Weekly sections are discarded after a move and refreshed by regeneration.

## Interfaces

`GET /catalog?term=202701&prefixes=CMSC,ENGL,HIST` returns published courses and warnings. `GET /sections?term=202701&course=CMSC420` returns bundles and staleness. `GET /rules` exposes the versioned rule pack.

`POST /plans/generate` takes `{profile, preferences}`. `POST /plans/validate` adds `{plan}`. Both return status, candidate plans, requirement coverage, conditions, source links, horizon, and course titles. API schemas are available at `/docs`; the same routes are available below `/api` for production static serving.

A result of `infeasible` applies to the loaded candidate set, supported constraints, and horizon. A timeout is never presented as proof of infeasibility. All successful pilot results remain conditional because advisor-managed requirements and unpublished semesters remain unresolved.

## Adding coverage

Add a new catalog-year/program rule pack rather than rewriting older requirements. Update program selection and importer recognition, test manually reviewed audits, and add meaningful rule-allocation regressions. Major/minor overlap requires explicit allocation rules before being supported. Do not infer official approval from matching course numbers.

## Operational limits

Use localhost for this pilot. Before a public release add request budgets/rate limits, bounded concurrency, request-size enforcement, source refresh jobs, monitoring without student payloads, and a documented source-access policy. Changes in upstream HTML should fail visibly; maintain synthetic markup fixtures when repairing adapters. No external UMD credentials or registration automation are used.

Current validation includes one supplied real PDF, synthetic unit/integration tests, live public-data requests, and desktop browser review. More real audits and small-screen/device QA remain part of pilot expansion.
