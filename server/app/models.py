"""Public request/response contracts. Never include names, IDs, or raw audit text."""

from typing import Literal

from pydantic import BaseModel, Field, model_validator


class Attempt(BaseModel):
    course: str = Field(pattern=r"^[A-Z][A-Z0-9 /-]{2,30}$")
    term: str
    credits: float = Field(ge=0, le=30)
    grade: str
    status: Literal["completed", "in_progress", "unused"]
    transfer: bool = False
    requirements: list[str] = Field(default_factory=list)


class Profile(BaseModel):
    program: str = "07010"
    catalog_year: str = "Fall 2025"
    credits_completed: float = Field(ge=0, le=400)
    credits_in_progress: float = Field(ge=0, le=40)
    gpa: float = Field(ge=0, le=4.3)
    resident_credits: float = Field(default=0, ge=0, le=400)
    upper_credits: float = Field(default=0, ge=0, le=400)
    major_upper_credits: float = Field(default=0, ge=0, le=400)
    gened_remaining: dict[str, int] = Field(default_factory=dict)
    attempts: list[Attempt] = Field(max_length=250)
    issues: list[str] = Field(default_factory=list)
    reviewed: bool = False
    overrides: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def geneds(self):
        valid = {
            "FSAW",
            "FSPW",
            "FSOC",
            "FSMA",
            "FSAR",
            "DSHU",
            "DSHS",
            "DSNL",
            "DSNS",
            "DSSP",
            "SCIS",
            "DVUP",
            "DVCC",
        }
        if any(k not in valid or not 0 <= v <= 2 for k, v in self.gened_remaining.items()):
            raise ValueError("Unknown Gen Ed category or invalid remaining count")
        return self


class Meeting(BaseModel):
    days: str = Field(pattern=r"^(?:M|Tu|W|Th|F|Sa|Su)+$")
    start: int = Field(ge=0, lt=1440)
    end: int = Field(gt=0, le=1440)
    location: str = ""

    @model_validator(mode="after")
    def ordered(self):
        if self.end <= self.start:
            raise ValueError("Meeting end must follow start")
        return self


class Preferences(BaseModel):
    start_term: str = Field(default="202701", pattern=r"^20\d{2}(01|05|08|12)$")
    target_term: str | None = Field(default=None, pattern=r"^20\d{2}(01|05|08|12)$")
    min_credits: int = Field(default=12, ge=0, le=24)
    max_credits: int = Field(default=15, ge=1, le=24)
    summer: bool = False
    winter: bool = False
    concentration: str = Field(default="HIST", pattern=r"^[A-Z]{3,4}$")
    interests: list[str] = Field(default_factory=list, max_length=20)
    excluded: list[str] = Field(default_factory=list, max_length=100)
    pinned: dict[str, str] = Field(default_factory=dict)
    pinned_sections: dict[str, str] = Field(default_factory=dict)
    blocked: list[Meeting] = Field(default_factory=list, max_length=30)
    allow_full: bool = False

    @model_validator(mode="after")
    def limits(self):
        if self.min_credits > self.max_credits:
            raise ValueError("Minimum credits cannot exceed maximum")
        if self.target_term and self.target_term < self.start_term:
            raise ValueError("Target term cannot precede start term")
        if any(c in self.excluded for c in self.pinned):
            raise ValueError("A pinned course cannot also be excluded")
        return self


class Course(BaseModel):
    id: str
    title: str
    credits: int
    geneds: list[str] = Field(default_factory=list)
    prerequisites: list[list[str]] = Field(default_factory=list)  # AND of OR groups
    restrictions: list[str] = Field(default_factory=list)
    crosslisted: list[str] = Field(default_factory=list)
    terms: list[str] = Field(default_factory=list)
    source: str
    fetched_at: str


class Section(BaseModel):
    course: str
    id: str
    instructors: str = ""
    open_seats: int | None = None
    meetings: list[Meeting] = Field(default_factory=list)
    arranged: bool = False
    source: str
    fetched_at: str


class PlanRequest(BaseModel):
    profile: Profile
    preferences: Preferences


class Semester(BaseModel):
    term: str
    courses: list[str]
    credits: int


class Plan(BaseModel):
    semesters: list[Semester]
    coverage: dict[str, list[str]]
    conditions: list[str]
    schedules: list[list[Section]] = Field(default_factory=list)


class PlanResult(BaseModel):
    status: Literal["feasible", "conditional", "infeasible", "timeout", "needs_review"]
    plans: list[Plan] = Field(default_factory=list)
    messages: list[str] = Field(default_factory=list)
    sources: list[str] = Field(default_factory=list)
    horizon: list[str] = Field(default_factory=list)


class ValidateRequest(PlanRequest):
    plan: Plan

    @model_validator(mode="after")
    def unique_terms(self):
        if len({s.term for s in self.plan.semesters}) != len(self.plan.semesters):
            raise ValueError("Each semester must appear once")
        return self
