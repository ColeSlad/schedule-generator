import json
import re
from pathlib import Path

RULES = json.loads((Path(__file__).resolve().parents[2] / "rules/cs-general-2025.json").read_text())
PASSING = {"A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "TP", "TA"}


def canonical(course):
    for primary, aliases in RULES["equivalents"].items():
        if course in aliases:
            return primary
    return course


def course_aliases(course):
    primary = canonical(course)
    return [c for c in [primary, *RULES["equivalents"].get(primary, [])] if c != course]


def concentration_departments(concentration):
    return RULES["concentration_departments"].get(concentration, [concentration])


def catalog_prefixes(concentration, pinned=()):
    # Keep the chosen area and explicitly pinned departments ahead of optional Gen Ed pools.
    prefixes = ["CMSC", "MATH", "STAT", "ENGL", *concentration_departments(concentration)]
    prefixes += [m[0] for code in pinned if (m := re.match(r"[A-Z]{3,4}(?=\d)", code))]
    return list(dict.fromkeys(prefixes + ["HIST", "ECON"]))[:8]


def concentration_course(course, concentration):
    match = re.fullmatch(r"([A-Z]{3,4})(\d{3})[A-Z]?", course)
    if not match or not 300 <= int(match[2]) < 500:
        return False
    code = canonical(course)
    if (
        course in RULES["concentration_excluded_courses"]
        or code in RULES["concentration_excluded_courses"]
    ):
        return False
    allowed = RULES["concentration_courses"].get(concentration)
    if allowed is not None:
        return code in allowed
    return match[1] in concentration_departments(concentration)


def passed(profile, include_progress=True):
    return {
        canonical(a.course)
        for a in profile.attempts
        if (a.status == "completed" and a.grade in PASSING)
        or (include_progress and a.status == "in_progress")
    }


def supported(profile):
    return profile.program == RULES["program"] and profile.catalog_year == RULES["catalog_year"]
