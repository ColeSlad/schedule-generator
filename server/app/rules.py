import json
from pathlib import Path

RULES = json.loads((Path(__file__).resolve().parents[2] / "rules/cs-general-2025.json").read_text())
PASSING = {"A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "TP", "TA"}


def canonical(course):
    for primary, aliases in RULES["equivalents"].items():
        if course in aliases:
            return primary
    return course


def passed(profile, include_progress=True):
    return {
        canonical(a.course)
        for a in profile.attempts
        if (a.status == "completed" and a.grade in PASSING)
        or (include_progress and a.status == "in_progress")
    }


def supported(profile):
    return profile.program == RULES["program"] and profile.catalog_year == RULES["catalog_year"]
