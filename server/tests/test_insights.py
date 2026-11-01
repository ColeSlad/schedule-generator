import sqlite3
import time

import httpx
import pytest
from fastapi.testclient import TestClient

from server.app import data, insights, main
from server.app.insights import CachedJson, grade_summary, professor_insight


def test_grade_aggregation_matches_planetterp_and_reports_letter_only_average():
    rows = [
        {"A": 2, "F": 1, "W": 1, "Other": 8, "semester": "202401"},
        {"B": 2, "W": 1, "semester": "202508"},
    ]
    g = grade_summary(rows)
    assert g.graded_count == 5 and g.withdrawals == 2 and g.other_count == 8
    assert g.average_gpa == pytest.approx(14 / 7)
    assert g.letter_grade_gpa == pytest.approx(14 / 5)
    assert g.first_term == "202401" and g.last_term == "202508"
    assert grade_summary([]).average_gpa is None
    assert grade_summary([{"F": 3}]).average_gpa == 0


def test_professor_matching_reviews_sample_size_and_course_specific_grades():
    reviews = [
        {"course": "MATH140", "rating": 5, "created": "2026-10-01", "review": "Another course."},
        {"course": "CMSC420", "rating": 2, "created": "2025-01-01", "review": "Old course review."},
        {
            "course": "CMSC420",
            "rating": 4,
            "created": "2026-01-01",
            "review": " ".join(["word"] * 60),
        },
    ]
    result = CachedJson(
        {"name": "Jane O’Brien", "slug": "obrien", "average_rating": 4.1, "reviews": reviews},
        "2026-11-01",
    )
    p = professor_insight(
        "Jane O'Brien",
        "CMSC420",
        [{"professor": "Jane O'Brien", "A": 4}, {"professor": "Other", "F": 100}],
        result,
    )
    assert p.status == "available" and p.review_count == 3 and p.course_review_count == 2
    assert p.course_rating == 3 and p.grades.average_gpa == 4
    assert p.recent_review.created == "2026-01-01" and len(p.recent_review.excerpt.split()) == 24
    assert professor_insight("Jane Smith", "CMSC420", [], result).average_rating is None
    missing = professor_insight("Jane", "CMSC420", [], CachedJson(None, None, status="not_found"))
    assert missing.status == "not_found" and missing.review_count is None


@pytest.fixture
def isolated_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(data, "CACHE", tmp_path / "public.sqlite")
    monkeypatch.setattr(insights, "REQUEST_GAP", 0)
    monkeypatch.setattr(insights, "_cooldown", 0)
    monkeypatch.setattr(insights, "_next_request", 0)


def test_public_cache_reuses_responses_and_falls_back_to_stale(isolated_cache, monkeypatch):
    calls = []

    def get(url, **kwargs):
        calls.append(url)
        return httpx.Response(
            200, json={"name": "CMSC420", "average_gpa": 3.2}, request=httpx.Request("GET", url)
        )

    monkeypatch.setattr(insights.httpx, "get", get)
    a = insights.cached_json("course", {"name": "CMSC420"}, time.monotonic() + 5)
    b = insights.cached_json("course", {"name": "CMSC420"}, time.monotonic() + 5)
    assert a.payload == b.payload and len(calls) == 1
    with sqlite3.connect(data.CACHE) as db:
        db.execute("UPDATE insight_cache SET fetched=?", (time.time() - 90000,))
    monkeypatch.setattr(
        insights.httpx,
        "get",
        lambda *args, **kwargs: (_ for _ in ()).throw(httpx.ConnectError("offline")),
    )
    stale = insights.cached_json("course", {"name": "CMSC420"}, time.monotonic() + 5)
    assert stale.stale and stale.payload["average_gpa"] == 3.2
    missing = insights.cached_json("course", {"name": "HIST100"}, time.monotonic() + 5)
    assert missing.status == "unavailable" and missing.payload is None


def test_rate_limit_uses_backoff_instead_of_hammering_provider(isolated_cache, monkeypatch):
    calls = []

    def get(url, **kwargs):
        calls.append(url)
        return httpx.Response(429, request=httpx.Request("GET", url))

    monkeypatch.setattr(insights.httpx, "get", get)
    assert (
        insights.cached_json("course", {"name": "CMSC420"}, time.monotonic() + 5).status
        == "unavailable"
    )
    assert (
        insights.cached_json("course", {"name": "CMSC430"}, time.monotonic() + 5).status
        == "unavailable"
    )
    assert len(calls) == 1


def test_insights_endpoint_is_optional_and_preserves_missing_values(monkeypatch):
    def fake(endpoint, params, deadline):
        if endpoint == "course":
            return CachedJson(
                {"name": params["name"], "average_gpa": 0, "title": "Synthetic"}, "2026-11-01"
            )
        if endpoint == "grades":
            return CachedJson(
                [
                    {
                        "course": params["course"],
                        "professor": "Synthetic Person",
                        "F": 5,
                        "W": 1,
                        "semester": "202508",
                    }
                ],
                "2026-11-01",
            )
        return CachedJson(None, None, status="not_found")

    monkeypatch.setattr(insights, "cached_json", fake)
    client = TestClient(main.app)
    r = client.post(
        "/api/insights",
        json={"courses": ["CMSC420"], "instructors": {"CMSC420": ["Synthetic Person"]}},
    )
    assert r.status_code == 200
    c = r.json()["courses"]["CMSC420"]
    assert c["average_gpa"] == 0 and c["professors"][0]["average_rating"] is None
    assert c["grades"]["graded_count"] == 5
    assert client.post("/api/insights", json={"courses": ["../../secrets"]}).status_code == 422
    assert (
        client.post(
            "/api/insights", json={"courses": ["CMSC420"], "profile": {"private": "not accepted"}}
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/insights", json={"courses": ["CMSC420"], "instructors": {"HIST100": ["Person"]}}
        ).status_code
        == 422
    )
