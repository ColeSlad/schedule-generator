import re
from dataclasses import dataclass, field

from ortools.sat.python import cp_model


def conflicts(a, b):
    return (
        bool(
            set(re.findall(r"Tu|Th|Sa|Su|M|W|F", a.days))
            & set(re.findall(r"Tu|Th|Sa|Su|M|W|F", b.days))
        )
        and a.start < b.end
        and b.start < a.end
    )


def delivery_score(section):
    if section.arranged:
        return 0
    if section.delivery == "online":
        return 3 if section.asynchronous else 2
    return 1 if section.delivery == "blended" else 0


def matching_sections(course, sections, preferences):
    """Apply only explicit seat, section-pin and availability constraints."""
    if not sections:
        return [], f"{course}: no published sections were returned."
    pinned = preferences.pinned_sections.get(course)
    if pinned:
        sections = [s for s in sections if s.id == pinned]
        if not sections:
            return [], f"{course}: pinned section {pinned} is not published."
    if not preferences.allow_full:
        sections = [s for s in sections if s.open_seats is not None and s.open_seats > 0]
        if not sections:
            return [], f"{course}: no sections have confirmed open seats."
    sections = [
        s
        for s in sections
        if not any(conflicts(a, b) for a in s.meetings for b in preferences.blocked)
    ]
    if not sections:
        return [], f"{course}: all eligible sections overlap your blocked times."
    return sections, None


@dataclass
class SectionSelection:
    options: dict = field(default_factory=dict)
    variables: dict = field(default_factory=dict)
    reasons: dict = field(default_factory=dict)

    def delivery_score(self):
        return sum(
            delivery_score(self.options[c][i]) * variable
            for (c, i), variable in self.variables.items()
        )

    def selected(self, solver):
        return [
            self.options[c][i]
            for (c, i), variable in self.variables.items()
            if solver.value(variable)
        ]


def add_section_constraints(model, course_variables, sections, preferences):
    """Use the same section constraints for course choice and weekly alternatives.

    A missing key means source data is unavailable. An empty list is a known
    absence of sections; those cases must not be treated as equivalent.
    """
    result = SectionSelection()
    meetings = {}
    for course, course_variable in course_variables.items():
        if course not in sections:
            continue
        options, reason = matching_sections(course, sections[course], preferences)
        result.options[course] = options
        if reason:
            result.reasons[course] = reason
        for i, section in enumerate(options):
            variable = model.new_bool_var(f"section:{course}:{section.id}")
            result.variables[course, i] = variable
            for meeting in section.meetings:
                for day in set(re.findall(r"Tu|Th|Sa|Su|M|W|F", meeting.days)):
                    meetings.setdefault(day, []).append((meeting.start, meeting.end, course, i))
        model.add(sum(result.variables[course, i] for i in range(len(options))) == course_variable)

    # Sweep each day instead of comparing every pair of sections in the catalog.
    clashes = set()
    for intervals in meetings.values():
        active = []
        for start, end, course, i in sorted(intervals):
            active = [entry for entry in active if entry[0] > start]
            for _, other, j in active:
                if course != other:
                    clashes.add(tuple(sorted(((course, i), (other, j)))))
            active.append((end, course, i))
    for first, second in clashes:
        model.add(result.variables[first] + result.variables[second] <= 1)
    return result


def schedules(course_ids, sections, p, limit=3):
    """Each Testudo section includes its own linked lecture/discussion/lab meetings."""
    missing = [course for course in course_ids if course not in sections]
    if missing:
        return [], [f"Section data is unavailable for {', '.join(missing)}."]
    model = cp_model.CpModel()
    selection = add_section_constraints(model, dict.fromkeys(course_ids, 1), sections, p)
    if selection.reasons:
        return [], list(selection.reasons.values())
    # Unresolved meeting times stay lower priority than confirmed formats.
    model.minimize(
        sum(
            (10000 if selection.options[c][i].arranged else 0) * variable
            for (c, i), variable in selection.variables.items()
        )
        - (selection.delivery_score() if p.prefer_online else 0)
    )
    results = []
    notes = []
    for _ in range(limit):
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = 2
        status = solver.solve(model)
        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            if not results:
                notes.append(
                    "The eligible sections for these courses overlap each other."
                    if status == cp_model.INFEASIBLE
                    else "Section search timed out."
                )
            break
        selected = selection.selected(solver)
        results.append(selected)
        if any(s.arranged for s in selected):
            notes.append("Arranged/TBA meetings require manual conflict checks.")
        picks = [variable for variable in selection.variables.values() if solver.value(variable)]
        model.add(sum(picks) <= len(picks) - 1)
    return results, list(dict.fromkeys(notes))
