"""Deterministic graduation planning. Infeasibility applies only to the loaded candidates."""
from ortools.sat.python import cp_model
from .models import Plan, PlanResult, Semester
from .rules import RULES, passed, canonical, supported


def terms_from(p):
    year=int(p.start_term[:4]); terms=[]; regular=0
    for y in range(year,year+8):
        for code in ['01','05','08','12']:
            t=f'{y}{code}'
            if t<p.start_term or (code=='05' and not p.summer) or (code=='12' and not p.winter):continue
            if p.target_term and t>p.target_term:return terms
            if code in ['01','08']:regular+=1
            if regular>12:return terms
            terms.append(t)
    return terms


def build_model(profile,p,courses,terms,forbidden=None,fixed=None):
    m=cp_model.CpModel(); labels={}
    def rule(constraint,label):
        a=m.new_bool_var(label); constraint.only_enforce_if(a);m.add_assumption(a);labels[a.index]=label
    available={c.id:c for c in courses if c.id not in passed(profile) and c.id not in p.excluded}
    x={(c,t):m.new_bool_var(f'{c}:{t}') for c in available for t in terms}
    chosen={c:m.new_bool_var(c) for c in available}
    done=passed(profile)
    existing={canonical(a.course):a for a in profile.attempts if canonical(a.course) in done}
    for c,course in available.items():
        m.add(sum(x[c,t] for t in terms)==chosen[c])
        for i,t in enumerate(terms):
            if fixed is not None:m.add(x[c,t]==int(c in fixed.get(t,[])))
            # The start term uses published offerings; later terms are conditional projections.
            if t==p.start_term and t not in course.terms:m.add(x[c,t]==0)
            groups=list(course.prerequisites)
            if c.startswith('CMSC') and int(c[4:7])>=400:
                groups += [['CMSC330'],['CMSC351']]
            for group in groups:
                if any(canonical(a) in done for a in group):continue
                prior=sum(x[a,pt] for a in group if a in available for pt in terms[:i])
                rule(m.add(x[c,t]<=prior),f'Prerequisites for {c}: {" or ".join(group)} must precede {t}')
    for c,t in p.pinned.items():
        if c in done:continue
        rule(m.add(x[c,t]==1) if (c,t) in x else m.add(False),f'Pinned {c} in {t} is unavailable or outside the horizon')
    if fixed is not None:
        for t,ids in fixed.items():
            for c in ids:
                if c not in available or t not in terms:rule(m.add(False),f'{c} in {t} is unavailable, repeated, or excluded')
    active=[]; loads=[]
    for t in terms:
        a=m.new_bool_var('active:'+t);active.append(a)
        load=sum(v.credits*x[c,t] for c,v in available.items());loads.append(load)
        rule(m.add(load<=p.max_credits*a),f'Maximum {p.max_credits} credits in {t}')
        rule(m.add(load>=max(1,p.min_credits)*a),f'Minimum {p.min_credits} credits in active term {t}')
    all_ids=set(available)|done
    used={c:chosen[c] if c in chosen else 1 for c in all_ids}
    for c in RULES['required']:
        rule(m.add(used.get(c,0)==1),f'Required course {c} is missing')
    # Pilot equivalencies for math requirements; unknown alternatives need reviewed override.
    stat=[c for c in all_ids if c.startswith('STAT4') and c not in ['STAT426']]
    rule(m.add(sum(used[c] for c in stat)>=1),'One qualifying STAT4xx course is required')
    math=[c for c in all_ids if c in ['MATH240','MATH241','MATH246','MATH340','MATH341','MATH401','MATH410','MATH461']]
    rule(m.add(sum(used[c] for c in math)>=1),'One qualifying additional math course is required')
    allocations={}; areas={}
    for area,ids in RULES['areas'].items():
        picks=[]
        for c in ids:
            if c not in all_ids:continue
            y=m.new_bool_var(f'area:{area}:{c}');m.add(y<=used[c]);allocations.setdefault(c,[]).append(y);picks.append(y)
        count=sum(picks); on=m.new_bool_var('area:'+area)
        m.add(count>=on);m.add(count<=3*on);areas[area]=on
    for picks in allocations.values():m.add(sum(picks)<=1)
    rule(m.add(sum(v for picks in allocations.values() for v in picks)==5),'Five distinct CS area courses are required')
    rule(m.add(sum(areas.values())>=3),'CS courses must cover at least three areas, at most three per area')
    electives=[]
    area_ids={c for ids in RULES['areas'].values() for c in ids}
    for c in all_ids & (area_ids|set(RULES['electives'])):
        e=m.new_bool_var('elective:'+c);m.add(e+sum(allocations.get(c,[]))<=used[c]);electives.append((c,e))
    credits=lambda c:available[c].credits if c in available else existing[c].credits
    rule(m.add(sum(int(credits(c))*e for c,e in electives)>=6),'Six CS elective credits must be separate from the five area courses')
    ulc=[]
    for c in all_ids:
        if not c.startswith(p.concentration) or not c[len(p.concentration):].isdigit():continue
        if not 300<=int(c[len(p.concentration):])<500:continue
        co=available.get(c)
        if co and (any(v.startswith('CMSC') for v in co.crosslisted) or any('CMSC' in r and 'Credit only' in r for r in co.restrictions)):continue
        if c in ['STAT400','MATH240'] or canonical(c).startswith('CMSC'):continue
        if c in existing and existing[c].transfer:continue # transfer ULC requires advisor review
        ulc.append(c)
    rule(m.add(sum(int(credits(c))*used[c] for c in ulc)>=12),f'12 eligible upper-level {p.concentration} concentration credits are required')
    gened_alloc={}
    for code,need in profile.gened_remaining.items():
        if not need:continue
        candidates=[]
        for c,co in available.items():
            if code not in co.geneds and not(code=='DSNS' and 'DSNL' in co.geneds) and not(code=='DVCC' and 'DVUP' in co.geneds):continue
            y=m.new_bool_var('gened:'+code+':'+c);m.add(y<=chosen[c]);gened_alloc[c,code]=y;candidates.append(y)
            if code=='DSSP' and c.startswith('CMSC'):m.add(y==0) # remaining DSSP conservatively outside major
        rule(m.add(sum(candidates)>=need),f'{need} remaining {code} course(s) must be satisfied')
    # A course may fill only one distributive category and one fundamental category.
    for c in available:
        for prefix in ['DS','FS','DV']:
            m.add(sum(v for (cid,code),v in gened_alloc.items() if cid==c and code.startswith(prefix))<=1)
    extra=sum(co.credits*chosen[c] for c,co in available.items())
    rule(m.add(extra+round(profile.credits_completed+profile.credits_in_progress)>=120),'At least 120 earned credits including planned courses are required')
    resident_ip=sum(a.credits for a in profile.attempts if a.status=='in_progress' and not a.transfer)
    rule(m.add(extra+round(profile.resident_credits+resident_ip)>=30),'At least 30 UMD residence credits are required')
    upper_ip=sum(a.credits for a in profile.attempts if a.status=='in_progress' and a.course[-3:].isdigit() and int(a.course[-3:])>=300)
    rule(m.add(sum(co.credits*chosen[c] for c,co in available.items() if int(c[len(''.join(filter(str.isalpha,c[:4]))):len(''.join(filter(str.isalpha,c[:4])))+3])>=300)+round(profile.upper_credits+upper_ip)>=15),'At least 15 upper-level credits are required')
    rule(m.add(sum(co.credits*chosen[c] for c,co in available.items() if c.startswith('CMSC') and int(c[4:7])>=300)+round(profile.major_upper_credits+sum(a.credits for a in profile.attempts if a.status=='in_progress' and a.course.startswith('CMSC') and int(a.course[4:7])>=300))>=12),'At least 12 upper-level major credits are required')
    for group in [['CMSC460','CMSC466']]:m.add(sum(used.get(c,0) for c in group)<=1)
    for co in available.values():
        for other in co.crosslisted:
            if other in used:m.add(chosen[co.id]+used[other]<=1)
    for combination in forbidden or []:
        m.add(sum(x[c,p.start_term] for c in combination if (c,p.start_term) in x)<=len(combination)-1)
    end=m.new_int_var(0,len(terms),'finish')
    for i,a in enumerate(active):m.add(end>=i+1).only_enforce_if(a)
    interest=sum(chosen[c] for c,co in available.items() if any(s.lower() in (co.title+' '+c).lower() for s in p.interests))
    gaps=sum(active)
    # Bounded lower-priority terms make objectives lexicographic for this candidate set.
    secondary=extra*1000 + sum((i+1)*loads[i] for i in range(len(terms)))*2-interest*10+gaps
    m.minimize((end*10_000_000 if not p.target_term else 0)+secondary)
    return m,x,available,allocations,gened_alloc,ulc,labels


def generate(profile,p,courses,forbidden=None,fixed=None,limit=3):
    terms=terms_from(p)
    if not profile.reviewed or not supported(profile):return PlanResult(status='needs_review',messages=['Confirm the import. Only program 07010, Fall 2025 CS general track is supported.'])
    if profile.gpa<2:return PlanResult(status='needs_review',messages=['Cumulative GPA is below 2.0. Graduation requires GPA recovery; future grades are not predicted.'])
    if not terms:return PlanResult(status='needs_review',messages=['Choose an enabled start term and a target within the planning horizon.'])
    if not courses:return PlanResult(status='needs_review',messages=['Course data is unavailable. Refresh offerings before planning.'])
    m,x,available,allocations,geneds,ulc,labels=build_model(profile,p,courses,terms,forbidden,fixed)
    plans=[];messages=[];status='timeout'
    for _ in range(limit):
        solver=cp_model.CpSolver();solver.parameters.max_time_in_seconds=4;solver.parameters.num_search_workers=4
        result=solver.solve(m)
        if result in (cp_model.OPTIMAL,cp_model.FEASIBLE):
            semesters=[Semester(term=t,courses=[c for c in available if solver.value(x[c,t])],credits=sum(co.credits*solver.value(x[c,t]) for c,co in available.items())) for t in terms]
            semesters=[s for s in semesters if s.courses]
            selected={c for s in semesters for c in s.courses}
            conditions=['In-progress courses must pass with required grades.','Concentration eligibility and 1.7 concentration GPA need advisor confirmation.','Gen Ed allocations use the reviewed audit remaining counts.','Special topics, STICs, and unmodeled math substitutions require advisor review.']
            if any(s.term!=p.start_term for s in semesters):conditions.append('Future-term offerings are unknown projections based on the loaded catalog; no future seats are guaranteed.')
            conditions+= [f'{c}: {r}' for c in sorted(selected) for r in available[c].restrictions]
            conditions+= [f'Override: {s}' for s in profile.overrides]
            coverage={area:[c for c,picks in allocations.items() if c in RULES['areas'][area] and any(solver.value(v) for v in picks) ] for area in RULES['areas']}
            coverage['Concentration']=[c for c in ulc if c in selected or c in passed(profile)]
            for (c,code),v in geneds.items():
                if solver.value(v):coverage.setdefault(code,[]).append(c)
            plans.append(Plan(semesters=semesters,coverage=coverage,conditions=sorted(set(conditions))))
            status='conditional'
            if fixed is not None:break
            picks=[x[c,s.term] for s in semesters for c in s.courses]
            if not picks:break
            m.add(sum(picks)<=len(picks)-1)
        elif result==cp_model.INFEASIBLE:
            if not plans:
                status='infeasible'
                messages=[labels.get(i,'Academic constraints conflict') for i in solver.sufficient_assumptions_for_infeasibility()]
                messages.append('No plan within the loaded candidate courses and horizon. Expand offerings, adjust credit limits/target, or review restrictions and concentration choices.')
            break
        else:
            messages.append('Search reached its time limit. No infeasibility conclusion can be drawn.');break
    return PlanResult(status=status,plans=plans,messages=list(dict.fromkeys(messages))[:18],sources=sorted(set(c.source for c in courses)),horizon=terms)
