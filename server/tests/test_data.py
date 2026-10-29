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
