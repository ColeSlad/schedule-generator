"""Optional public PlanetTerp enrichment, isolated from academic plan generation."""

import html
import json
import re
import sqlite3
import threading
import time
import unicodedata
from dataclasses import dataclass
from datetime import UTC, datetime
from urllib.parse import quote, urlencode

import httpx
from pydantic import BaseModel, Field, model_validator

from . import data

BASE = "https://planetterp.com/api/v1"
REQUEST_GAP = 0.35
_request_lock = threading.Lock()
_next_request = 0.0
_cooldown = 0.0
POINTS = {
    "A+": 4,
    "A": 4,
    "A-": 3.7,
    "B+": 3.3,
    "B": 3,
    "B-": 2.7,
    "C+": 2.3,
    "C": 2,
    "C-": 1.7,
    "D+": 1.3,
    "D": 1,
    "D-": 0.7,
    "F": 0,
}


class InsightRequest(BaseModel):
    model_config = {"extra": "forbid"}
    courses: list[str] = Field(min_length=1, max_length=20)
    instructors: dict[str, list[str]] = Field(default_factory=dict)

    @model_validator(mode="after")
    def bounded(self):
        if any(not re.fullmatch(r"[A-Z]{3,4}\d{3}[A-Z]?", c) for c in self.courses):
            raise ValueError("Invalid course code")
        if any(c not in self.courses for c in self.instructors):
            raise ValueError("Instructor courses must be included in courses")
        if sum(len(v) for v in self.instructors.values()) > 40:
            raise ValueError("Request at most 40 instructors at a time")
        if any(
            not 1 <= len(n.strip()) <= 100 for names in self.instructors.values() for n in names
        ):
            raise ValueError("Invalid instructor name")
        return self


class GradeSummary(BaseModel):
    average_gpa: float | None = None
    letter_grade_gpa: float | None = None
    graded_count: int = 0
    withdrawals: int = 0
    other_count: int = 0
    distribution: dict[str, int] = Field(default_factory=dict)
    first_term: str | None = None
    last_term: str | None = None


class ReviewExcerpt(BaseModel):
    course: str | None = None
    rating: float | None = None
    created: str = ""
    excerpt: str


class ProfessorInsight(BaseModel):
    requested_name: str
    name: str
    status: str
    source: str | None = None
    average_rating: float | None = None
    review_count: int | None = None
    course_rating: float | None = None
    course_review_count: int | None = None
    grades: GradeSummary | None = None
    recent_review: ReviewExcerpt | None = None
    stale: bool = False


class CourseInsight(BaseModel):
    course: str
    title: str = ""
    status: str
    source: str
    average_gpa: float | None = None
    grades: GradeSummary | None = None
    professors: list[ProfessorInsight] = Field(default_factory=list)
    fetched_at: str | None = None
    stale: bool = False


class InsightResponse(BaseModel):
    courses: dict[str, CourseInsight]
    warnings: list[str] = Field(default_factory=list)


@dataclass
class CachedJson:
    payload: object | None
    fetched_at: str | None
    stale: bool = False
    status: str = "available"


def normalized(name):
    return re.sub(
        r"[^a-z0-9]",
        "",
        unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower(),
    )


def number(value, minimum, maximum):
    if (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and minimum <= value <= maximum
    ):
        return float(value)
    return None


def cached_json(endpoint, params, deadline):
    """Cache public responses; serialize/rate-limit misses and reuse stale data on outages."""
    global _next_request, _cooldown
    url = f"{BASE}/{endpoint}?{urlencode(params)}"
    with sqlite3.connect(data.CACHE) as db:
        db.execute(
            "CREATE TABLE IF NOT EXISTS insight_cache (url TEXT PRIMARY KEY, body TEXT, fetched REAL)"
        )
        row = db.execute("SELECT body,fetched FROM insight_cache WHERE url=?", (url,)).fetchone()
    if row:
        payload = json.loads(row[0])
        not_found = payload == {"__not_found": True}
        stamp = datetime.fromtimestamp(row[1], UTC).isoformat()
        if time.time() - row[1] < (3600 if not_found else 86400):
            return CachedJson(
                None if not_found else payload,
                stamp,
                status="not_found" if not_found else "available",
            )

    def fallback():
        if row and json.loads(row[0]) != {"__not_found": True}:
            return CachedJson(
                json.loads(row[0]), datetime.fromtimestamp(row[1], UTC).isoformat(), True
            )
        return CachedJson(None, None, status="unavailable")

    with _request_lock:
        # Recheck under the lock so simultaneous UI panels don't duplicate a request.
        with sqlite3.connect(data.CACHE) as db:
            fresh = db.execute(
                "SELECT body,fetched FROM insight_cache WHERE url=?", (url,)
            ).fetchone()
        if fresh and (not row or fresh[1] != row[1]):
            payload = json.loads(fresh[0])
            missing = payload == {"__not_found": True}
            return CachedJson(
                None if missing else payload,
                datetime.fromtimestamp(fresh[1], UTC).isoformat(),
                status="not_found" if missing else "available",
            )
        remaining = deadline - time.monotonic()
        if remaining <= 0 or _cooldown > time.monotonic():
            return fallback()
        pause = max(0, _next_request - time.monotonic())
        if pause >= remaining:
            return fallback()
        if pause:
            time.sleep(pause)
        try:
            response = httpx.get(
                url,
                timeout=min(6, max(0.1, deadline - time.monotonic())),
                headers={"User-Agent": "TerpPath/0.1 (public course comparisons)"},
                follow_redirects=True,
            )
            _next_request = time.monotonic() + REQUEST_GAP
            if response.status_code == 429:
                _cooldown = time.monotonic() + 60
                return fallback()
            payload = response.json()
            if response.status_code in (400, 404) and "not found" in str(payload).lower():
                payload = {"__not_found": True}
            else:
                response.raise_for_status()
                if (
                    not isinstance(payload, (dict, list))
                    or isinstance(payload, dict)
                    and "error" in payload
                ):
                    raise ValueError("Unexpected PlanetTerp response")
            stamp = time.time()
            with sqlite3.connect(data.CACHE) as db:
                db.execute(
                    "INSERT OR REPLACE INTO insight_cache VALUES (?,?,?)",
                    (url, json.dumps(payload), stamp),
                )
            missing = payload == {"__not_found": True}
            return CachedJson(
                None if missing else payload,
                datetime.fromtimestamp(stamp, UTC).isoformat(),
                status="not_found" if missing else "available",
            )
        except (httpx.HTTPError, ValueError):
            _cooldown = time.monotonic() + 10
            return fallback()


def grade_summary(rows):
    counts = {grade: 0 for grade in [*POINTS, "W", "Other"]}
    terms = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        for grade in counts:
            count = row.get(grade, 0)
            if isinstance(count, int) and not isinstance(count, bool) and count >= 0:
                counts[grade] += count
        term = row.get("semester")
        if isinstance(term, str) and re.fullmatch(r"\d{6}", term):
            terms.append(term)
    graded = sum(counts[g] for g in POINTS)
    points = sum(counts[g] * v for g, v in POINTS.items())
    # Match PlanetTerp's published aggregation: W is in its GPA denominator;
    # also expose conventional letter-only GPA so that distinction is explicit.
    return GradeSummary(
        average_gpa=points / (graded + counts["W"]) if graded + counts["W"] else None,
        letter_grade_gpa=points / graded if graded else None,
        graded_count=graded,
        withdrawals=counts["W"],
        other_count=counts["Other"],
        distribution=counts,
        first_term=min(terms) if terms else None,
        last_term=max(terms) if terms else None,
    )


def professor_insight(name, course, rows, result):
    payload = result.payload
    if (
        not isinstance(payload, dict)
        or normalized(str(payload.get("name", ""))) != normalized(name)
        or not re.fullmatch(r"[\w’'\-]+", str(payload.get("slug", "")))
    ):
        return ProfessorInsight(
            requested_name=name,
            name=name,
            status="not_found" if result.status == "not_found" else "unavailable",
        )
    raw_reviews = payload.get("reviews")
    reviews = [
        r
        for r in (raw_reviews if isinstance(raw_reviews, list) else [])
        if isinstance(r, dict) and number(r.get("rating"), 1, 5) is not None
    ]
    specific = [r for r in reviews if r.get("course") == course]
    newest = sorted(specific or reviews, key=lambda r: str(r.get("created", "")), reverse=True)
    excerpt = None
    if newest:
        review = newest[0]
        words = html.unescape(re.sub(r"<[^>]+>", " ", str(review.get("review", "")))).split()
        excerpt = ReviewExcerpt(
            course=review.get("course"),
            rating=number(review.get("rating"), 1, 5),
            created=str(review.get("created", "")),
            excerpt=" ".join(words[:24]) + ("…" if len(words) > 24 else ""),
        )
    matched_rows = [
        r for r in rows if normalized(str(r.get("professor") or "")) == normalized(payload["name"])
    ]
    return ProfessorInsight(
        requested_name=name,
        name=payload["name"],
        status="available",
        source=f"https://planetterp.com/professor/{quote(payload['slug'])}",
        average_rating=number(payload.get("average_rating"), 1, 5),
        review_count=len(reviews) if isinstance(raw_reviews, list) else None,
        course_rating=sum(r["rating"] for r in specific) / len(specific) if specific else None,
        course_review_count=len(specific) if isinstance(raw_reviews, list) else None,
        grades=grade_summary(matched_rows) if matched_rows else None,
        recent_review=excerpt,
        stale=result.stale,
    )


def get_insights(request):
    deadline = time.monotonic() + 24
    results = {}
    warnings = []
    professors = {}
    for code in dict.fromkeys(request.courses):
        meta = cached_json("course", {"name": code}, deadline)
        grades = cached_json("grades", {"course": code}, deadline)
        metadata = (
            meta.payload
            if isinstance(meta.payload, dict) and meta.payload.get("name") == code
            else {}
        )
        rows = (
            [r for r in grades.payload if isinstance(r, dict) and r.get("course") == code]
            if isinstance(grades.payload, list)
            else []
        )
        instructor_data = []
        for name in dict.fromkeys(request.instructors.get(code, [])):
            if normalized(name) in ("", "tba", "staff", "instructortba"):
                continue
            if name not in professors:
                professors[name] = cached_json(
                    "professor", {"name": name, "reviews": "true"}, deadline
                )
            instructor_data.append(professor_insight(name, code, rows, professors[name]))
        stamps = [r.fetched_at for r in [meta, grades] if r.fetched_at]
        status = (
            "available"
            if metadata or rows
            else "not_found"
            if meta.status == "not_found"
            else "unavailable"
        )
        results[code] = CourseInsight(
            course=code,
            title=str(metadata.get("title", "")),
            status=status,
            source=f"https://planetterp.com/course/{code}",
            average_gpa=number(metadata.get("average_gpa"), 0, 4),
            grades=grade_summary(rows) if rows else None,
            professors=instructor_data,
            fetched_at=min(stamps) if stamps else None,
            stale=meta.stale or grades.stale or any(p.stale for p in instructor_data),
        )
        if (
            status == "unavailable"
            or grades.status == "unavailable"
            or any(p.status == "unavailable" for p in instructor_data)
        ):
            warnings.append(
                "Some PlanetTerp data is unavailable. You can retry without regenerating your schedule."
            )
        if results[code].stale:
            warnings.append("Showing cached PlanetTerp data because a refresh failed.")
    return InsightResponse(courses=results, warnings=list(dict.fromkeys(warnings)))
