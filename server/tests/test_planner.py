import pytest

from server.app.models import Attempt, Course, Meeting, Preferences, Profile, Section
from server.app.planner import generate
from server.app.scheduling import schedules


def course(code, credits=3, prerequisites=None, geneds=None):
    return Course(
        id=code,
        title=code,
        credits=credits,
        prerequisites=prerequisites or [],
        geneds=geneds or [],
        terms=["202701"],
        source="synthetic",
        fetched_at="2026-10-29T00:00:00Z",
    )


def fixture():
    done = [
        "CMSC131",
        "CMSC132",
        "CMSC216",
        "CMSC250",
        "CMSC330",
        "CMSC351",
        "MATH140",
        "MATH141",
        "MATH240",
        "STAT400",
    ]
    profile = Profile(
        credits_completed=90,
        credits_in_progress=0,
        gpa=3,
        resident_credits=30,
        upper_credits=15,
        major_upper_credits=12,
        reviewed=True,
        attempts=[
            Attempt(course=c, term="202608", credits=3, grade="A", status="completed") for c in done
        ],
    )
    courses = [
        course(c)
        for c in [
            "CMSC411",
            "CMSC420",
            "CMSC421",
            "CMSC430",
            "CMSC451",
            "CMSC320",
            "CMSC335",
            "HIST300",
            "HIST301",
            "HIST302",
            "HIST303",
        ]
    ]
    return (
        profile,
        Preferences(min_credits=0, max_credits=18, target_term="202708"),
        courses,
    )


def test_satisfies_five_area_courses_electives_and_concentration():
    p, prefs, courses = fixture()
    result = generate(p, prefs, courses, limit=1)
    assert result.status == "conditional"
    plan = result.plans[0]
    assert sum(s.credits for s in plan.semesters) == 33
    assert len(plan.coverage["Concentration"]) == 4
    assert (
        sum(
            len(plan.coverage.get(a, []))
            for a in [
                "Systems",
                "Information processing",
                "Software and languages",
                "Theory",
                "Numerical analysis",
            ]
        )
        == 5
    )


def test_graduation_term_infeasible_and_credit_blocker():
    p, prefs, courses = fixture()
    prefs.target_term = "202701"
    prefs.max_credits = 15
    result = generate(p, prefs, courses, limit=1)
    assert result.status == "infeasible"
    assert any("Maximum" in m for m in result.messages)


def test_prerequisite_cannot_be_concurrent():
    p, prefs, courses = fixture()
    courses[0].prerequisites = [["HIST300"]]
    prefs.pinned = {"CMSC411": "202701", "HIST300": "202701"}
    assert generate(p, prefs, courses, limit=1).status == "infeasible"


def test_unreviewed_or_wrong_catalog_needs_review():
    p, prefs, courses = fixture()
    p.reviewed = False
    assert generate(p, prefs, courses).status == "needs_review"
    p.reviewed = True
    p.catalog_year = "Fall 2026"
    assert generate(p, prefs, courses).status == "needs_review"


def test_fixed_plan_validated_and_invalid_move_rejected():
    p, prefs, courses = fixture()
    r = generate(p, prefs, courses, limit=1)
    fixed = {s.term: s.courses for s in r.plans[0].semesters}
    assert generate(p, prefs, courses, fixed=fixed, limit=1).plans
    fixed["202701"] = [c.id for c in courses]
    fixed["202708"] = []
    assert generate(p, prefs, courses, fixed=fixed, limit=1).status == "infeasible"


def test_gpa_and_minimum_grade():
    p, prefs, courses = fixture()
    p.gpa = 1.9
    assert generate(p, prefs, courses).status == "needs_review"
    p.gpa = 3
    p.attempts[0].grade = "D"
    assert generate(p, prefs, courses).status == "infeasible"


def section(c, id, start, seats=1):
    return Section(
        course=c,
        id=id,
        open_seats=seats,
        meetings=[Meeting(days="MWF", start=start, end=start + 50)],
        source="synthetic",
        fetched_at="2026-10-29",
    )


def test_linked_meetings_seats_and_pinned_sections():
    a = section("CMSC420", "0101", 600)
    a.meetings.append(Meeting(days="Tu", start=700, end=750))
    b = section("CMSC430", "0101", 700)
    b.meetings = [Meeting(days="Tu", start=700, end=750)]
    p = Preferences()
    result, _ = schedules(["CMSC420", "CMSC430"], {"CMSC420": [a], "CMSC430": [b]}, p)
    assert not result
    b.meetings = [Meeting(days="Tu", start=750, end=800)]
    b.open_seats = 0
    assert not schedules(["CMSC430"], {"CMSC430": [b]}, p)[0]
    p.allow_full = True
    assert schedules(["CMSC430"], {"CMSC430": [b]}, p)[0]
    p.pinned_sections = {"CMSC430": "9999"}
    assert not schedules(["CMSC430"], {"CMSC430": [b]}, p)[0]


def test_blocked_times():
    p = Preferences(blocked=[Meeting(days="MWF", start=590, end=610)])
    assert not schedules(["CMSC420"], {"CMSC420": [section("CMSC420", "0101", 600)]}, p)[0]


def test_tuesday_and_thursday_are_distinct_days():
    from server.app.scheduling import conflicts

    assert not conflicts(
        Meeting(days="Tu", start=600, end=660), Meeting(days="Th", start=600, end=660)
    )
    assert conflicts(
        Meeting(days="TuTh", start=600, end=660), Meeting(days="Th", start=650, end=700)
    )


def test_crosslisted_courses_do_not_double_count_credits():
    p, prefs, courses = fixture()
    courses[0].crosslisted = ["HIST300"]
    prefs.pinned = {"CMSC411": "202701", "HIST300": "202701"}
    assert generate(p, prefs, courses, limit=1).status == "infeasible"


def test_independent_research_does_not_automatically_satisfy_concentration():
    p, prefs, courses = fixture()
    courses[-1].title = "Independent Research"
    courses[-2].title = "Independent Research"
    assert generate(p, prefs, courses, limit=1).status == "infeasible"


@pytest.mark.parametrize(
    ("prefix", "excluded"),
    [("PSYC", "PSYC417"), ("BMGT", "BMGT402"), ("PHIL", "PHIL308F"), ("ENES", "ENES396")],
)
def test_expanded_concentrations_do_not_count_ineligible_courses(prefix, excluded):
    profile, prefs, courses = fixture()
    prefs.concentration = prefix
    courses = (
        [c for c in courses if not c.id.startswith("HIST")]
        + [course(f"{prefix}{n}") for n in [310, 311, 312]]
        + [course(excluded)]
    )
    assert generate(profile, prefs, courses, limit=1).status == "infeasible"

    courses.append(course(f"{prefix}313"))
    result = generate(profile, prefs, courses, limit=1)
    assert result.plans
    assert set(result.plans[0].coverage["Concentration"]) == {
        f"{prefix}{n}" for n in [310, 311, 312, 313]
    }


def test_letter_suffixed_upper_level_courses_count_toward_new_concentrations():
    profile, prefs, courses = fixture()
    prefs.concentration = "GVPT"
    courses = [c for c in courses if not c.id.startswith("HIST")] + [
        course(c) for c in ["GVPT300", "GVPT301", "GVPT302", "GVPT309A"]
    ]
    result = generate(profile, prefs, courses, limit=1)
    assert result.plans
    assert "GVPT309A" in result.plans[0].coverage["Concentration"]


def business_fixture(ids):
    profile, prefs, courses = fixture()
    prefs.concentration = "BMIN"
    courses = [c for c in courses if not c.id.startswith("HIST")] + [course(c) for c in ids]
    return profile, prefs, courses


def test_general_business_can_mix_bmin_courses_with_approved_bmgt_substitutes():
    ids = ["BMIN345", "BMGT350", "BMIN375", "BMGT364"]
    profile, prefs, courses = business_fixture(ids)
    result = generate(profile, prefs, courses, limit=1)
    assert result.plans
    assert set(result.plans[0].coverage["Concentration"]) == set(ids)


def test_renamed_business_courses_are_not_planned_again_after_completion():
    profile, prefs, courses = business_fixture(
        ["BMIN345", "BMGT340", "BMGT345", "BMIN355", "BMIN375", "BMIN395"]
    )
    profile.attempts.append(
        Attempt(course="BMGT345", term="202601", credits=3, grade="A", status="completed")
    )
    result = generate(profile, prefs, courses, limit=1)
    assert result.plans
    planned = {c for s in result.plans[0].semesters for c in s.courses}
    assert not planned & {"BMIN345", "BMGT340", "BMGT345"}
    assert "BMIN345" in result.plans[0].coverage["Concentration"]


def test_equivalent_business_options_cannot_supply_duplicate_concentration_credit():
    profile, prefs, courses = business_fixture(
        ["BMIN345", "BMGT340", "BMGT345", "BMIN355", "BMGT350", "BMGT355"]
    )
    assert generate(profile, prefs, courses, limit=1).status == "infeasible"


def test_general_business_minor_courses_do_not_all_count_as_upper_level_concentration():
    profile, prefs, courses = business_fixture(
        ["BMIN210", "BMIN305", "BMIN345", "BMIN355", "BMIN395", "BMGT301", "BMGT402"]
    )
    assert generate(profile, prefs, courses, limit=1).status == "infeasible"


def test_progress_must_precede_planned_semesters():
    p, prefs, courses = fixture()
    p.attempts[0].status = "in_progress"
    p.attempts[0].term = prefs.start_term
    assert generate(p, prefs, courses).status == "needs_review"


def test_math_requirement_cannot_double_count_toward_concentration():
    p, prefs, courses = fixture()
    prefs.concentration = "STAT"
    p.attempts = [a for a in p.attempts if a.course != "STAT400"]
    courses = [c for c in courses if not c.id.startswith("HIST")] + [
        course(f"STAT{n}") for n in [401, 410, 420, 430]
    ]
    assert generate(p, prefs, courses, limit=1).status == "infeasible"


def test_earliest_mode_uses_shortest_feasible_horizon():
    p, prefs, courses = fixture()
    prefs.target_term = None
    result = generate(p, prefs, courses, limit=1)
    assert result.plans[-1].semesters[-1].term == "202708"


def test_selected_graduation_semester_is_exact_and_keeps_regular_semesters_active():
    profile, prefs, courses = fixture()
    prefs.target_term = "202901"
    result = generate(profile, prefs, courses, limit=3)
    assert result.plans
    for plan in result.plans:
        assert [s.term for s in plan.semesters] == [
            "202701",
            "202708",
            "202801",
            "202808",
            "202901",
        ]
        assert all(s.courses for s in plan.semesters)


def test_exact_graduation_can_add_courses_to_meet_semester_credit_minimums():
    profile, prefs, courses = fixture()
    prefs.target_term = "202901"
    prefs.min_credits = prefs.max_credits = 12
    courses += [course(f"ENGL{n}") for n in range(300, 309)]
    result = generate(profile, prefs, courses, limit=1)
    assert result.plans
    plan = result.plans[0]
    assert plan.semesters[-1].term == "202901"
    assert len(plan.semesters) == 5
    assert all(s.credits == 12 for s in plan.semesters)
    assert sum(s.credits for s in plan.semesters) == 60


@pytest.mark.parametrize("target", ["202805", "202812"])
def test_explicit_summer_or_winter_graduation_is_included_without_optional_terms(target):
    profile, prefs, courses = fixture()
    prefs.target_term = target
    result = generate(profile, prefs, courses, limit=1)
    assert result.plans
    plan = result.plans[0]
    assert plan.semesters[-1].term == target
    assert all(s.term[4:] in ["01", "08"] or s.term == target for s in plan.semesters)


def test_out_of_horizon_graduation_is_not_silently_shortened():
    profile, prefs, courses = fixture()
    prefs.target_term = "203301"
    result = generate(profile, prefs, courses, limit=1)
    assert result.status == "needs_review" and not result.plans
    assert any("horizon" in message for message in result.messages)


def test_validation_rejects_a_plan_that_finishes_before_the_selected_semester():
    profile, prefs, courses = fixture()
    original = generate(profile, prefs, courses, limit=1).plans[0]
    fixed = {s.term: s.courses for s in original.semesters}
    prefs.target_term = "202901"
    result = generate(profile, prefs, courses, fixed=fixed, limit=1)
    assert result.status == "infeasible" and not result.plans


def test_transfer_concentration_credits_are_capped_at_six():
    p, prefs, courses = fixture()
    p.credits_completed = 120
    for i, c in enumerate(c for c in courses if c.id.startswith("HIST")):
        p.attempts.append(
            Attempt(
                course=c.id,
                term="202601",
                credits=3,
                grade="TA" if i < 2 else "A",
                status="completed",
                transfer=i < 2,
            )
        )
    assert generate(p, prefs, courses, limit=1).plans
    p.attempts[-2].transfer = True
    p.attempts[-2].grade = "TA"
    assert generate(p, prefs, courses, limit=1).status == "infeasible"


def integrated_options(courses):
    return {c.id: [section(c.id, "0101", 480 + (i % 6) * 60)] for i, c in enumerate(courses)}


def test_course_choice_accounts_for_sections_and_closed_courses():
    p, prefs, courses = fixture()
    options = integrated_options(courses)
    options["CMSC411"][0].open_seats = 0
    result = generate(p, prefs, courses, section_options=options, limit=1)
    assert result.plans
    first = result.plans[0].semesters[0]
    assert first.term == prefs.start_term and "CMSC411" not in first.courses
    assert result.plans[0].schedules
    assert {s.course for s in result.plans[0].schedules[0]} == set(first.courses)


def test_integrated_search_honors_blocked_times_and_section_pins():
    p, prefs, courses = fixture()
    options = integrated_options(courses)
    prefs.pinned_sections = {"CMSC411": "0101", "CMSC420": "0101"}
    options["CMSC420"][0].meetings = options["CMSC411"][0].meetings
    result = generate(p, prefs, courses, section_options=options, limit=1)
    assert result.status == "infeasible" and not result.plans
    prefs.pinned_sections = {"CMSC411": "0101"}
    prefs.blocked = options["CMSC411"][0].meetings
    result = generate(p, prefs, courses, section_options=options, limit=1)
    assert result.status == "infeasible"
    assert any("CMSC411" in m and "blocked times" in m for m in result.messages)


def test_unavailable_source_keeps_academic_plan_conditional():
    p, prefs, courses = fixture()
    options = integrated_options(courses)
    prefs.pinned = {"CMSC411": prefs.start_term}
    del options["CMSC411"]
    result = generate(p, prefs, courses, section_options=options, limit=1)
    assert result.plans and result.status == "conditional"
    assert not result.plans[0].schedules
    assert any("data unavailable" in c for c in result.plans[0].conditions)


def test_unknown_short_horizon_does_not_prevent_finding_a_later_plan(monkeypatch):
    from server.app.planner import cp_model

    original = cp_model.CpSolver.solve
    calls = 0

    def first_probe_unknown(self, model, *args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            return cp_model.UNKNOWN
        return original(self, model, *args, **kwargs)

    monkeypatch.setattr(cp_model.CpSolver, "solve", first_probe_unknown)
    profile, prefs, courses = fixture()
    prefs.target_term = None
    result = generate(profile, prefs, courses, limit=1)
    assert result.plans and result.plans[0].semesters[-1].term == "202708"
    assert any("not proven" in c for c in result.plans[0].conditions)


def test_closed_pinned_section_is_explained_without_relaxing_the_pin():
    profile, prefs, courses = fixture()
    options = integrated_options(courses)
    prefs.pinned_sections = {"CMSC411": "0101"}
    options["CMSC411"][0].open_seats = 0
    result = generate(profile, prefs, courses, section_options=options, limit=1)
    assert result.status == "infeasible" and not result.plans
    assert any("CMSC411" in m and "open seats" in m for m in result.messages)


def test_online_preference_ranks_async_then_online_and_preserves_section_pins():
    campus = section("CMSC420", "0101", 600)
    campus.delivery = "in_person"
    online = section("CMSC420", "0201", 600)
    online.delivery = "online"
    asynchronous = section("CMSC420", "0301", 600)
    asynchronous.delivery = "online"
    asynchronous.asynchronous = True
    asynchronous.meetings = []
    prefs = Preferences(prefer_online=True)
    options = {"CMSC420": [campus, online, asynchronous]}
    results, notes = schedules(["CMSC420"], options, prefs)
    assert [r[0].id for r in results] == ["0301", "0201", "0101"]
    assert not notes
    prefs.pinned_sections = {"CMSC420": "0101"}
    assert schedules(["CMSC420"], options, prefs)[0][0][0].id == "0101"


def test_online_preference_does_not_bypass_seats_or_scheduled_online_conflicts():
    online = section("CMSC420", "0101", 600)
    online.delivery = "online"
    asynchronous = section("CMSC420", "0201", 600, seats=0)
    asynchronous.delivery = "online"
    asynchronous.asynchronous = True
    asynchronous.meetings = []
    campus = section("CMSC420", "0301", 720)
    prefs = Preferences(prefer_online=True, blocked=[Meeting(days="MWF", start=600, end=650)])
    options = {"CMSC420": [online, asynchronous, campus]}
    assert schedules(["CMSC420"], options, prefs)[0][0][0].id == "0301"


def test_online_preference_affects_course_choice_without_adding_extra_credits():
    profile, prefs, courses = fixture()
    prefs.prefer_online = True
    courses.append(course("HIST304"))
    options = integrated_options(courses)
    options["HIST304"][0].delivery = "online"
    options["HIST304"][0].asynchronous = True
    options["HIST304"][0].meetings = []
    result = generate(profile, prefs, courses, section_options=options, limit=1)
    assert result.plans
    plan = result.plans[0]
    assert "HIST304" in plan.semesters[0].courses
    assert sum(s.credits for s in plan.semesters) == 33


def test_online_preference_does_not_add_unneeded_courses_or_delay_graduation():
    profile, prefs, courses = fixture()
    prefs.prefer_online = True
    prefs.target_term = None
    courses.append(course("ENGL300"))
    options = integrated_options(courses)
    options["ENGL300"][0].delivery = "online"
    options["ENGL300"][0].asynchronous = True
    options["ENGL300"][0].meetings = []
    result = generate(profile, prefs, courses, section_options=options, limit=1)
    assert result.plans
    plan = result.plans[0]
    assert plan.semesters[-1].term == "202708"
    assert sum(s.credits for s in plan.semesters) == 33
    assert all("ENGL300" not in s.courses for s in plan.semesters)
