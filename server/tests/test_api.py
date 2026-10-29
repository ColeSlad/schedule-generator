from fastapi.testclient import TestClient
from test_planner import fixture

from server.app import main
from server.app.models import Meeting, Section

client = TestClient(main.app)


def test_end_to_end_generate_validate_and_input_rejection(monkeypatch):
    profile, prefs, courses = fixture()
    monkeypatch.setattr(main, "load", lambda request: (courses, []))

    def sections(term, course):
        i = [c.id for c in courses].index(course)
        return [
            Section(
                course=course,
                id="0101",
                open_seats=5,
                meetings=[
                    Meeting(
                        days="M" if i < 6 else "Tu",
                        start=420 + (i % 6) * 60,
                        end=470 + (i % 6) * 60,
                    )
                ],
                source="synthetic",
                fetched_at="2026-10-29",
            )
        ], False

    monkeypatch.setattr(main, "get_sections", sections)
    body = {"profile": profile.model_dump(), "preferences": prefs.model_dump()}
    r = client.post("/plans/generate", json=body)
    assert r.status_code == 200
    result = r.json()
    assert result["plans"][0]["schedules"]
    r = client.post("/plans/validate", json={**body, "plan": result["plans"][0]})
    assert r.status_code == 200 and r.json()["plans"]
    body["preferences"]["min_credits"] = 22
    body["preferences"]["max_credits"] = 12
    assert client.post("/plans/generate", json=body).status_code == 422
    assert client.get("/sections?term=202701&course=../../secrets").status_code == 422


def test_api_prefix_for_production():
    assert client.get("/api/health").status_code == 200
