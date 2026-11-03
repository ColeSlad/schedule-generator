"""Workload proxies based on course structure, never historical GPA or reviews."""

import re
from itertools import combinations

from .rules import canonical, concentration_departments


def technical_course(code):
    match = re.fullmatch(r"([A-Z]{3,4})(\d{3})[A-Z]?", canonical(code))
    return bool(match and int(match[2]) >= 300 and match[1] in ["CMSC", "MATH", "STAT", "AMSC"])


def semester_balance(model, x, available, terms, active, preferences):
    """Compare enrolled terms; inactive optional terms do not count as light loads.

    Technical credits, concentration credits, total credits, and course counts
    are structural proxies for a useful mix. They do not estimate difficulty.
    A smaller total course count also avoids packing a credit target with many
    one-credit classes merely to earn more online-preference points.
    """
    limit = preferences.max_credits
    departments = set(concentration_departments(preferences.concentration))
    groups = [
        ("technical", 4, lambda c: technical_course(c.id), True),
        ("concentration", 2, lambda c: re.match(r"[A-Z]+", c.id)[0] in departments, True),
        ("credits", 1, lambda c: True, True),
        ("courses", 2, lambda c: True, False),
    ]
    cost = 2 * sum(x[c, t] for c in available for t in terms)
    bound = 2 * min(len(available), limit * len(terms))
    for name, weight, include, use_credits in groups:
        loads = []
        for t in terms:
            load = model.new_int_var(0, limit, f"balance:{name}:{t}")
            model.add(
                load
                == sum(
                    (co.credits if use_credits else 1) * x[c, t]
                    for c, co in available.items()
                    if include(co)
                )
            )
            loads.append(load)
        if name == "technical":
            # A convex penalty spreads the required load without rewarding
            # additional technical electives just to make lighter terms equal.
            for t, load in zip(terms, loads):
                squared = model.new_int_var(0, limit * limit, f"balance:technical-square:{t}")
                model.add_element(load, [n * n for n in range(limit + 1)], squared)
                cost += weight * squared
                bound += weight * limit * limit
            continue
        for i, j in combinations(range(len(terms)), 2):
            difference = model.new_int_var(0, limit, f"balance:{name}:{terms[i]}:{terms[j]}")
            model.add(difference >= loads[i] - loads[j]).only_enforce_if([active[i], active[j]])
            model.add(difference >= loads[j] - loads[i]).only_enforce_if([active[i], active[j]])
            model.add(difference == 0).only_enforce_if(active[i].Not())
            model.add(difference == 0).only_enforce_if(active[j].Not())
            cost += weight * difference
            bound += weight * limit
    return cost, bound
