import re

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


def schedules(course_ids, sections, p, limit=3):
    """Each Testudo section includes its own linked lecture/discussion/lab meetings."""
    model = cp_model.CpModel()
    picks = {}
    options = {}
    notes = []
    for course in course_ids:
        options[course] = [
            s
            for s in sections.get(course, [])
            if (p.allow_full or (s.open_seats is not None and s.open_seats > 0))
            and not any(conflicts(a, b) for a in s.meetings for b in p.blocked)
        ]
        pinned = p.pinned_sections.get(course)
        if pinned:
            options[course] = [s for s in options[course] if s.id == pinned]
        if not options[course]:
            return [], [
                f"{course}: no sections match seat, pinned-section, and availability constraints."
            ]
        for i, s in enumerate(options[course]):
            picks[course, i] = model.new_bool_var(course + ":" + s.id)
        model.add(sum(picks[course, i] for i in range(len(options[course]))) == 1)
    keys = list(picks)
    for index, (course, i) in enumerate(keys):
        for other, j in keys[index + 1 :]:
            if course != other and any(
                conflicts(a, b)
                for a in options[course][i].meetings
                for b in options[other][j].meetings
            ):
                model.add(picks[course, i] + picks[other, j] <= 1)
    model.minimize(sum((10000 if options[c][i].arranged else 0) * v for (c, i), v in picks.items()))
    results = []
    for _ in range(limit):
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = 2
        status = solver.solve(model)
        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            if not results:
                notes.append(
                    "No compatible section combination found."
                    if status == cp_model.INFEASIBLE
                    else "Section search timed out."
                )
            break
        selected = [(c, i) for c, i in keys if solver.value(picks[c, i])]
        result = [options[c][i] for c, i in selected]
        results.append(result)
        if any(s.arranged for s in result):
            notes.append("Arranged/TBA meetings require manual conflict checks.")
        model.add(sum(picks[k] for k in selected) <= len(selected) - 1)
    return results, notes
