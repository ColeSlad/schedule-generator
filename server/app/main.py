import re
from pathlib import Path

import httpx
from fastapi import APIRouter, FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles

from .data import get_catalog, get_planning_catalog, get_sections, get_sections_many
from .models import PlanRequest, PlanResult, ValidateRequest
from .planner import generate
from .rules import RULES
from .scheduling import schedules

app = FastAPI(title="Terp Path", version="0.1.0")
router = APIRouter()


@router.get("/health")
def health():
    return {"status": "ok", "rule_pack": RULES["id"]}


@router.get("/rules")
def rules():
    return RULES


@router.get("/catalog")
def catalog(
    term: str = Query(pattern=r"^20\d{2}(01|05|08|12)$"),
    prefixes: str = "CMSC,ENGL,HIST",
):
    parts = prefixes.split(",")
    if len(parts) > 8 or any(not re.fullmatch(r"[A-Z]{3,4}", s) for s in parts):
        raise HTTPException(422, "Choose up to 8 department prefixes.")
    courses, warnings = get_catalog(term, parts)
    return {"courses": courses, "warnings": warnings}


@router.get("/sections")
def sections(
    term: str = Query(pattern=r"^20\d{2}(01|05|08|12)$"),
    course: str = Query(pattern=r"^[A-Z]{3,4}\d{3}[A-Z]?$"),
):
    try:
        result, stale = get_sections(term, course)
        return {"sections": result, "stale": stale}
    except (httpx.HTTPError, ValueError):
        raise HTTPException(503, "UMD section data is unavailable. Try again later.")


def load(request):
    p = request.preferences
    prefixes = ["CMSC", "MATH", "STAT", "ENGL", "HIST", "ECON", p.concentration]
    prefixes += [re.match(r"[A-Z]+", c)[0] for c in p.pinned if re.match(r"[A-Z]+", c)]
    return get_planning_catalog(p.start_term, list(dict.fromkeys(prefixes))[:8])


@router.post("/plans/generate", response_model=PlanResult)
def plan(request: PlanRequest):
    courses, warnings = load(request)
    published = [c.id for c in courses if request.preferences.start_term in c.terms]
    options, section_warnings = get_sections_many(request.preferences.start_term, published)
    output = generate(
        request.profile, request.preferences, courses, section_options=options, limit=3
    )
    for candidate in output.plans:
        first = next(
            (s for s in candidate.semesters if s.term == request.preferences.start_term), None
        )
        if first and candidate.schedules:
            # The graduation solver already found a valid section assignment. Keep it
            # even if the optional search for more weekly alternatives times out.
            alternatives, notes = schedules(first.courses, options, request.preferences)
            if alternatives:
                candidate.schedules = alternatives
            candidate.conditions = sorted(set(candidate.conditions + notes))
    output.messages += list(dict.fromkeys(warnings + section_warnings))
    return output


@router.post("/plans/validate", response_model=PlanResult)
def validate(request: ValidateRequest):
    courses, warnings = load(request)
    fixed = {s.term: s.courses for s in request.plan.semesters}
    result = generate(request.profile, request.preferences, courses, fixed=fixed, limit=1)
    result.messages += warnings
    return result


app.include_router(router)
app.include_router(router, prefix="/api", include_in_schema=False)
_dist = Path(__file__).resolve().parents[2] / "dist"
if _dist.exists():
    app.mount("/", StaticFiles(directory=_dist, html=True), name="frontend")
