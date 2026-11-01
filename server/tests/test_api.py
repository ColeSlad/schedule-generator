from fastapi.testclient import TestClient
from test_planner import course, fixture

from server.app import main
from server.app.models import Meeting, PlanRequest, Section

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

    monkeypatch.setattr(
        main,
        "get_sections_many",
        lambda term, codes: ({c: sections(term, c)[0] for c in codes}, []),
    )
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


def test_general_business_browsing_and_planning_load_both_departments(monkeypatch):
    profile, prefs, _ = fixture()
    prefs.concentration = "BMIN"
    prefs.pinned = {"PSYC300": "202701"}
    calls = []

    def catalog(term, prefixes):
        calls.append(prefixes)
        return [course("BMIN345")], []

    monkeypatch.setattr(main, "get_catalog", catalog)
    monkeypatch.setattr(main, "get_planning_catalog", catalog)
    response = client.get("/api/catalog?term=202701&concentration=BMIN")
    assert response.status_code == 200
    assert {"BMGT345", "BMGT340"} <= set(response.json()["courses"][0]["aliases"])
    main.load(PlanRequest(profile=profile, preferences=prefs))
    assert len(calls) == 2
    assert all({"BMIN", "BMGT"} <= set(prefixes) and len(prefixes) <= 8 for prefixes in calls)
    assert "PSYC" in calls[1]
    assert client.get("/api/catalog?term=202701&concentration=../bad").status_code == 422


def test_valid_schedule_survives_optional_alternative_search_timeout(monkeypatch):
    profile, prefs, courses = fixture()
    monkeypatch.setattr(main, "load", lambda request: (courses, []))

    def sections(term, codes):
        return {
            c: [
                Section(
                    course=c,
                    id="0101",
                    open_seats=1,
                    meetings=[
                        Meeting(
                            days="M" if i < 6 else "Tu",
                            start=420 + (i % 6) * 60,
                            end=470 + (i % 6) * 60,
                        )
                    ],
                    source="synthetic",
                    fetched_at="2026-11-01",
                )
            ]
            for i, c in enumerate(codes)
        }, []

    monkeypatch.setattr(main, "get_sections_many", sections)
    monkeypatch.setattr(main, "schedules", lambda *args: ([], ["Section search timed out."]))
    result = client.post(
        "/plans/generate", json={"profile": profile.model_dump(), "preferences": prefs.model_dump()}
    ).json()
    assert result["plans"]
    for plan in result["plans"]:
        assert plan["schedules"]
        first = next(s for s in plan["semesters"] if s["term"] == prefs.start_term)
        assert {s["course"] for s in plan["schedules"][0]} == set(first["courses"])
