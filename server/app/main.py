from functools import lru_cache
import re
import httpx
from fastapi import FastAPI, HTTPException, Query
from .models import PlanRequest, PlanResult, ValidateRequest
from .data import get_catalog,get_sections
from .planner import generate
from .rules import RULES
from .scheduling import schedules

app=FastAPI(title='Terp Path',version='0.1.0')

@app.get('/health')
def health():return {'status':'ok','rule_pack':RULES['id']}

@app.get('/rules')
def rules():return RULES

@app.get('/catalog')
def catalog(term:str=Query(pattern=r'^20\d{2}(01|05|08|12)$'),prefixes:str='CMSC,ENGL,HIST'):
    parts=prefixes.split(',')
    if len(parts)>8 or any(not re.fullmatch(r'[A-Z]{3,4}',s) for s in parts):raise HTTPException(422,'Choose up to 8 department prefixes.')
    courses,warnings=get_catalog(term,parts)
    return {'courses':courses,'warnings':warnings}

@app.get('/sections')
def sections(term:str=Query(pattern=r'^20\d{2}(01|05|08|12)$'),course:str=Query(pattern=r'^[A-Z]{3,4}\d{3}[A-Z]?$')):
    try:
        result,stale=get_sections(term,course)
        return {'sections':result,'stale':stale}
    except (httpx.HTTPError,ValueError):raise HTTPException(503,'UMD section data is unavailable. Try again later.')


def load(request):
    p=request.preferences
    prefixes=['CMSC','MATH','STAT','ENGL','HIST','ECON',p.concentration]
    prefixes+= [re.match(r'[A-Z]+',c)[0] for c in p.pinned if re.match(r'[A-Z]+',c)]
    return get_catalog(p.start_term,prefixes[:8])

@app.post('/plans/generate',response_model=PlanResult)
def plan(request:PlanRequest):
    courses,warnings=load(request)
    forbidden=[];output=None
    for _ in range(4):
        output=generate(request.profile,request.preferences,courses,forbidden=forbidden,limit=3)
        retry=False
        for plan in output.plans:
            first=next((s for s in plan.semesters if s.term==request.preferences.start_term),None)
            if first is None:continue
            options={};missing=False
            for course in first.courses:
                try:
                    options[course],stale=get_sections(first.term,course)
                    if stale:plan.conditions.append(f'{course}: section data is stale; availability must be refreshed.')
                except (httpx.HTTPError,ValueError):missing=True
            if missing:
                plan.conditions.append('Section data unavailable; the weekly schedule remains unverified.')
                continue
            plan.schedules,notes=schedules(first.courses,options,request.preferences)
            plan.conditions+=notes
            if not plan.schedules:
                forbidden.append(first.courses);retry=True
        if not retry:break
    output.messages+=warnings
    if retry:
        output.plans=[p for p in output.plans if p.schedules or not any(s.term==request.preferences.start_term for s in p.semesters)]
        if not output.plans:
            output.status='timeout';output.messages.append('No compatible weekly schedule among the searched course combinations. Broaden availability or change pinned courses; other combinations may exist.')
    return output

@app.post('/plans/validate',response_model=PlanResult)
def validate(request:ValidateRequest):
    courses,warnings=load(request)
    fixed={s.term:s.courses for s in request.plan.semesters}
    result=generate(request.profile,request.preferences,courses,fixed=fixed,limit=1)
    result.messages+=warnings
    return result
