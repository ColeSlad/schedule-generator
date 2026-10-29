from server.app.models import Profile,Preferences,Course,Attempt,Meeting,Section
from server.app.planner import generate
from server.app.scheduling import schedules

def course(code,credits=3,prerequisites=None,geneds=None):
    return Course(id=code,title=code,credits=credits,prerequisites=prerequisites or [],geneds=geneds or [],terms=['202701'],source='synthetic',fetched_at='2026-10-29T00:00:00Z')

def fixture():
    done=['CMSC131','CMSC132','CMSC216','CMSC250','CMSC330','CMSC351','MATH140','MATH141','MATH240','STAT400']
    profile=Profile(credits_completed=90,credits_in_progress=0,gpa=3,resident_credits=30,upper_credits=15,major_upper_credits=12,reviewed=True,attempts=[Attempt(course=c,term='202608',credits=3,grade='A',status='completed') for c in done])
    courses=[course(c) for c in ['CMSC411','CMSC420','CMSC421','CMSC430','CMSC451','CMSC320','CMSC335','HIST300','HIST301','HIST302','HIST303']]
    return profile,Preferences(min_credits=0,max_credits=18,target_term='202708'),courses

def test_satisfies_five_area_courses_electives_and_concentration():
    p,prefs,courses=fixture();result=generate(p,prefs,courses,limit=1)
    assert result.status=='conditional'
    plan=result.plans[0]; assert sum(s.credits for s in plan.semesters)==33
    assert len(plan.coverage['Concentration'])==4
    assert sum(len(plan.coverage.get(a,[])) for a in ['Systems','Information processing','Software and languages','Theory','Numerical analysis'])==5

def test_deadline_infeasible_and_credit_blocker():
    p,prefs,courses=fixture();prefs.target_term='202701';prefs.max_credits=15
    result=generate(p,prefs,courses,limit=1)
    assert result.status=='infeasible'
    assert any('Maximum' in m for m in result.messages)

def test_prerequisite_cannot_be_concurrent():
    p,prefs,courses=fixture();courses[0].prerequisites=[['HIST300']];prefs.pinned={'CMSC411':'202701','HIST300':'202701'}
    assert generate(p,prefs,courses,limit=1).status=='infeasible'

def test_unreviewed_or_wrong_catalog_needs_review():
    p,prefs,courses=fixture();p.reviewed=False
    assert generate(p,prefs,courses).status=='needs_review'
    p.reviewed=True;p.catalog_year='Fall 2026'
    assert generate(p,prefs,courses).status=='needs_review'

def test_fixed_plan_validated_and_invalid_move_rejected():
    p,prefs,courses=fixture();r=generate(p,prefs,courses,limit=1)
    fixed={s.term:s.courses for s in r.plans[0].semesters}
    assert generate(p,prefs,courses,fixed=fixed,limit=1).plans
    fixed['202701']=[c.id for c in courses];fixed['202708']=[]
    assert generate(p,prefs,courses,fixed=fixed,limit=1).status=='infeasible'

def test_gpa_and_minimum_grade():
    p,prefs,courses=fixture();p.gpa=1.9
    assert generate(p,prefs,courses).status=='needs_review'
    p.gpa=3;p.attempts[0].grade='D'
    assert generate(p,prefs,courses).status=='infeasible'

def section(c,id,start,seats=1):
    return Section(course=c,id=id,open_seats=seats,meetings=[Meeting(days='MWF',start=start,end=start+50)],source='synthetic',fetched_at='2026-10-29')

def test_linked_meetings_seats_and_pinned_sections():
    a=section('CMSC420','0101',600);a.meetings.append(Meeting(days='Tu',start=700,end=750))
    b=section('CMSC430','0101',700);b.meetings=[Meeting(days='Tu',start=700,end=750)]
    p=Preferences();result,_=schedules(['CMSC420','CMSC430'],{'CMSC420':[a],'CMSC430':[b]},p);assert not result
    b.meetings=[Meeting(days='Tu',start=750,end=800)];b.open_seats=0
    assert not schedules(['CMSC430'],{'CMSC430':[b]},p)[0]
    p.allow_full=True;assert schedules(['CMSC430'],{'CMSC430':[b]},p)[0]
    p.pinned_sections={'CMSC430':'9999'};assert not schedules(['CMSC430'],{'CMSC430':[b]},p)[0]

def test_blocked_times():
    p=Preferences(blocked=[Meeting(days='MWF',start=590,end=610)])
    assert not schedules(['CMSC420'],{'CMSC420':[section('CMSC420','0101',600)]},p)[0]

def test_tuesday_and_thursday_are_distinct_days():
    from server.app.scheduling import conflicts
    assert not conflicts(Meeting(days='Tu',start=600,end=660),Meeting(days='Th',start=600,end=660))
    assert conflicts(Meeting(days='TuTh',start=600,end=660),Meeting(days='Th',start=650,end=700))

def test_crosslisted_courses_do_not_double_count_credits():
    p,prefs,courses=fixture();courses[0].crosslisted=['HIST300'];prefs.pinned={'CMSC411':'202701','HIST300':'202701'}
    assert generate(p,prefs,courses,limit=1).status=='infeasible'

def test_independent_research_does_not_automatically_satisfy_concentration():
    p,prefs,courses=fixture();courses[-1].title='Independent Research'
    assert generate(p,prefs,courses,limit=1).status=='infeasible'
