import pytest

from server.app.data import parse_catalog, parse_sections


def test_missing_seats_remain_unknown_and_linked_meetings_stay_together():
    html = """<div class="section"><span class="section-id">0101</span><div class="class-days-container"><div class="row"><span class="section-days">TuTh</span><span class="class-start-time">9:00am</span><span class="class-end-time">9:50am</span></div><div class="row"><span class="section-days">W</span><span class="class-start-time">2:00pm</span><span class="class-end-time">2:50pm</span></div></div></div>"""
    s = parse_sections(html, "CMSC420", "synthetic", "2026-10-29")[0]
    assert s.open_seats is None and len(s.meetings) == 2 and s.meetings[1].start == 840


def test_official_catalog_enforces_known_prerequisite_prefix_and_retains_permission():
    html = """<div class="courseblock"><p class="courseblocktitle">CMSC422 Introduction to Machine Learning (3 Credits)</p><p class="courseblockextra"><strong>Prerequisite:</strong> Minimum grade of C- in CMSC320, CMSC330, and CMSC351; and 1 course with a minimum grade of C- from (MATH240, MATH341); and permission of department.</p></div>"""
    c = parse_catalog(html, "synthetic", "2026-10-29")[0]
    assert ["CMSC320"] in c.prerequisites and ["CMSC351"] in c.prerequisites
    assert ["MATH240", "MATH341"] in c.prerequisites
    assert any("permission" in r for r in c.restrictions)
    assert c.credits == 3


def test_link_spacing_does_not_drop_required_courses():
    html = """<div class="courseblock"><p class="courseblocktitle">CMSC422 Machine Learning (3 Credits)</p><p class="courseblockextra"><strong>Prerequisite:</strong> Minimum grade of C- in <a>CMSC320</a>, <a>CMSC330</a>, and <a>CMSC351</a>; and permission of department.</p></div>"""
    c = parse_catalog(html, "synthetic", "2026-10-29")[0]
    assert c.prerequisites == [["CMSC320"], ["CMSC330"], ["CMSC351"]]


def test_bulk_section_response_keeps_courses_separate():
    html = """<div class="course-sections" id="CMSC420"><div class="section"><span class="section-id">0101</span><span class="open-seats-count">4</span></div></div><div class="course-sections" id="CMSC430"><div class="section"><span class="section-id">0201</span><span class="open-seats-count">0</span></div></div>"""
    first = parse_sections(html, "CMSC420", "synthetic", "2026-11-01")
    second = parse_sections(html, "CMSC430", "synthetic", "2026-11-01")
    assert [s.id for s in first] == ["0101"] and first[0].open_seats == 4
    assert [s.id for s in second] == ["0201"] and second[0].open_seats == 0
    assert not parse_sections(html, "CMSC451", "synthetic", "2026-11-01")


def test_bulk_fetch_bounds_batches_and_preserves_missing_data(monkeypatch):
    from server.app import data

    calls = []

    def fetch(url, ttl):
        calls.append(url)
        ids = url.split("=")[-1].split(",")
        return (
            "".join(
                f'<div class="course-sections" id="{c}"><div class="section"><span class="section-id">0101</span></div></div>'
                for c in ids
            ),
            "2026-11-01",
            False,
        )

    monkeypatch.setattr(data, "cached_get", fetch)
    result, warnings = data.get_sections_many("202701", [f"HIST{n}" for n in range(100, 151)])
    assert len(calls) == 3 and len(result) == 51 and not warnings
    assert all(len(url.split("=")[-1].split(",")) <= 25 for url in calls)
    monkeypatch.setattr(
        data, "cached_get", lambda *args: (_ for _ in ()).throw(ValueError("unavailable"))
    )
    result, warnings = data.get_sections_many("202701", ["CMSC420"])
    assert "CMSC420" not in result and warnings


def test_partial_bulk_response_does_not_treat_missing_course_as_closed(monkeypatch):
    from server.app import data

    html = '<div class="course-sections" id="CMSC420"></div>'
    monkeypatch.setattr(data, "cached_get", lambda *args: (html, "2026-11-01", False))
    result, warnings = data.get_sections_many("202701", ["CMSC420", "CMSC430"])
    assert result["CMSC420"] == [] and "CMSC430" not in result
    assert any("CMSC430" in warning for warning in warnings)


def test_multiple_instructors_are_extracted_as_separate_names():
    html = """<div class="section"><span class="section-id">0101</span><span class="section-instructors"><span class="section-instructor">Synthetic One</span><span class="section-instructor">Synthetic Two</span></span></div>"""
    section = parse_sections(html, "CMSC420", "synthetic", "2026-11-01")[0]
    assert section.instructor_names == ["Synthetic One", "Synthetic Two"]


@pytest.mark.parametrize(
    ("delivery", "rows", "expected_delivery", "asynchronous", "arranged", "meetings"),
    [
        ("delivery-online", "async", "online", True, False, 0),
        ("delivery-online", "timed", "online", False, False, 1),
        ("delivery-online", "async timed", "online", False, False, 1),
        ("delivery-blended", "async timed", "blended", False, False, 1),
        ("delivery-online", "unknown", "online", False, True, 0),
        ("", "async", "unknown", False, True, 0),
    ],
)
def test_delivery_markers_distinguish_async_from_scheduled_and_unresolved_meetings(
    delivery, rows, expected_delivery, asynchronous, arranged, meetings
):
    parts = {
        "async": '<span class="elms-class-message">Class time/details on ELMS</span><span class="class-room">ONLINE</span>',
        "timed": '<span class="section-days">TuTh</span><span class="class-start-time">10:00am</span><span class="class-end-time">10:50am</span>',
        "unknown": "TBA",
    }
    html = f'<div class="section {delivery}"><span class="section-id">0101</span><div class="class-days-container">'
    html += "".join(f'<div class="row">{parts[row]}</div>' for row in rows.split()) + "</div></div>"
    section = parse_sections(html, "BMIN345", "synthetic", "2026-11-01")[0]
    assert (section.delivery, section.asynchronous, section.arranged, len(section.meetings)) == (
        expected_delivery,
        asynchronous,
        arranged,
        meetings,
    )
