"""Public Testudo adapter with bounded requests and disk caching; no student data."""

import os
import re
import sqlite3
import time
from datetime import UTC, datetime
from pathlib import Path

import httpx
from bs4 import BeautifulSoup

from .models import Course, Meeting, Section

BASE = "https://app.testudo.umd.edu/soc"
CACHE = Path(os.getenv("UMD_CACHE_PATH", "/tmp/umd-planner-cache.sqlite"))


def now():
    return datetime.now(UTC).isoformat()


def cached_get(url, ttl):
    with sqlite3.connect(CACHE) as db:
        db.execute(
            "CREATE TABLE IF NOT EXISTS pages (url TEXT PRIMARY KEY, body TEXT, fetched REAL)"
        )
        row = db.execute("SELECT body,fetched FROM pages WHERE url=?", (url,)).fetchone()
        if row and time.time() - row[1] < ttl:
            return row[0], datetime.fromtimestamp(row[1], UTC).isoformat(), False
        try:
            response = httpx.get(
                url,
                timeout=20,
                follow_redirects=True,
                headers={"User-Agent": "TerpPath-Pilot/0.1 (public academic planning)"},
            )
            response.raise_for_status()
            body = response.text
            if "course" not in body.lower():
                raise ValueError("Unrecognized UMD response")
            stamp = time.time()
            db.execute("INSERT OR REPLACE INTO pages VALUES (?,?,?)", (url, body, stamp))
            return body, datetime.fromtimestamp(stamp, UTC).isoformat(), False
        except (httpx.HTTPError, ValueError):
            if row:
                return row[0], datetime.fromtimestamp(row[1], UTC).isoformat(), True
            raise


def value(node, selector):
    item = node.select_one(selector)
    return item.get_text(" ", strip=True) if item else ""


def parse_courses(html, term, url, stamp):
    soup = BeautifulSoup(html, "html.parser")
    courses = []
    for node in soup.select(".course"):
        code = node.get("id", "")
        if (
            not re.fullmatch(r"[A-Z]{3,4}\d{3}[A-Z]?", code)
            or not 100 <= int(re.search(r"\d{3}", code)[0]) < 500
        ):
            continue
        credit = value(node, ".course-min-credits") or value(node, ".course-credits")
        if not credit:
            m = re.search(r"Credits:\s*(\d+)", node.get_text(" ", strip=True))
            credit = m[1] if m else ""
        if not credit.isdigit() or not 1 <= int(credit) <= 6:
            continue
        text = " ".join(
            n.parent.get_text(" ", strip=True) for n in node.select(".approved-course-text strong")
        )
        if not text:
            text = node.get_text(" ", strip=True)
        prereq = re.search(
            r"Prerequisite:\s*(.*?)(?=Restriction:|Corequisite:|Credit only|Cross-listed|$)",
            text,
        )
        restrictions = []
        groups = []
        if prereq:
            p = prereq[1].strip()
            # Only simple conjunctions are machine-validated; preserve complex language as conditions.
            if re.fullmatch(
                r"(?:Minimum grade of C- in )?[A-Z]{3,4}\d{3}(?:\s*(?:;|,|and)\s*[A-Z]{3,4}\d{3})*\.?",
                p,
            ):
                groups = [[c] for c in re.findall(r"[A-Z]{3,4}\d{3}", p)]
            else:
                restrictions.append("Confirm prerequisite: " + p)
                # Safe required simple prefix (e.g. CMSC351; and ...); do not guess OR precedence.
                first = re.match(
                    r"(?:Minimum grade of C- in )?((?:[A-Z]{3,4}\d{3})(?:(?:,? and |, )[A-Z]{3,4}\d{3})*);",
                    p,
                )
                if first:
                    groups = [[c] for c in re.findall(r"[A-Z]{3,4}\d{3}", first[1])]
                for alternatives in re.findall(r"1 course[^;]*?from \(([^)]+)\)", p):
                    groups.append(re.findall(r"[A-Z]{3,4}\d{3}", alternatives))
        for label in ["Restriction", "Corequisite", "Credit only granted for"]:
            m = re.search(
                label
                + r":\s*(.*?)(?=Prerequisite:|Restriction:|Corequisite:|Credit only|Cross-listed|$)",
                text,
            )
            if m:
                restrictions.append(label + ": " + m[1].strip())
        if node.select_one(".perm-req-message"):
            restrictions.append("Department permission required")
        cross = re.search(r"Cross-listed with:\s*([^.]*)", text)
        courses.append(
            Course(
                id=code,
                title=value(node, ".course-title"),
                credits=int(credit),
                geneds=sorted(
                    set(
                        re.findall(
                            r"\b(?:FS[A-Z]{2}|DS[A-Z]{2}|DV[A-Z]{2}|SCIS)\b",
                            value(node, ".course-gen-ed-codes") or node.get_text(" ", strip=True),
                        )
                    )
                ),
                prerequisites=groups,
                restrictions=restrictions,
                crosslisted=re.findall(r"[A-Z]{3,4}\d{3}", cross[1]) if cross else [],
                terms=[term],
                source=url,
                fetched_at=stamp,
            )
        )
    return courses


def get_catalog(term, prefixes):
    courses = {}
    warnings = []
    for prefix in sorted(set(prefixes)):
        if not re.fullmatch(r"[A-Z]{3,4}", prefix):
            continue
        url = f"{BASE}/{term}/{prefix}"
        try:
            body, stamp, stale = cached_get(url, 86400)
            items = parse_courses(body, term, url, stamp)
            for course in items:
                courses[course.id] = course
            if stale:
                warnings.append(f"{prefix}: cached offerings are stale; refresh failed.")
            if not items:
                warnings.append(f"{prefix}: no published offerings found for {term}.")
        except (httpx.HTTPError, ValueError) as exc:
            warnings.append(f"{prefix}: offerings unavailable ({type(exc).__name__}).")
    return list(courses.values()), warnings


def minutes(text):
    return (
        int(datetime.strptime(text.strip().lower(), "%I:%M%p").hour) * 60
        + datetime.strptime(text.strip().lower(), "%I:%M%p").minute
    )


def parse_sections(html, course, url, stamp):
    soup = BeautifulSoup(html, "html.parser")
    sections = []
    for node in soup.select(".section"):
        code = value(node, ".section-id")
        if not code:
            continue
        meetings = []
        arranged = False
        for row in node.select(".class-days-container .row"):
            days = value(row, ".section-days")
            start = value(row, ".class-start-time")
            end = value(row, ".class-end-time")
            if days and start and end:
                try:
                    meetings.append(
                        Meeting(
                            days=days,
                            start=minutes(start),
                            end=minutes(end),
                            location=value(row, ".class-building"),
                        )
                    )
                except ValueError:
                    arranged = True
            else:
                arranged = True
        if not meetings:
            arranged = True
        seats = value(node, ".open-seats-count")
        sections.append(
            Section(
                course=course,
                id=code,
                instructors=value(node, ".section-instructors"),
                open_seats=int(seats) if seats.isdigit() else None,
                meetings=meetings,
                arranged=arranged,
                source=url,
                fetched_at=stamp,
            )
        )
    return sections


def get_sections(term, course):
    url = f"{BASE}/{term}/sections?courseIds={course}"
    body, stamp, stale = cached_get(url, 300)
    return parse_sections(body, course, url, stamp), stale


def get_planning_catalog(term, prefixes):
    """Combine published target offerings with two preceding regular terms as candidates."""
    current, warnings = get_catalog(term, prefixes)
    merged = {c.id: c for c in current}
    y = int(term[:4])
    code = term[4:]
    previous = [f"{y - 1}08", f"{y - 1}01"] if code == "01" else [f"{y}01", f"{y - 1}08"]
    for historic in previous:
        items, notes = get_catalog(historic, prefixes)
        if notes:
            warnings.append(f"Historical candidate coverage for {historic} is incomplete.")
        for course in items:
            if course.id in merged:
                merged[course.id].terms.append(historic)
            else:
                merged[course.id] = course
    enriched, notes = enrich_catalog(list(merged.values()), prefixes)
    return enriched, list(dict.fromkeys(warnings + notes))


def parse_catalog(html, url, stamp):
    """Reuse the term parser after translating official catalog course blocks."""
    soup = BeautifulSoup(html, "html.parser")
    translated = BeautifulSoup("", "html.parser")
    for block in soup.select(".courseblock"):
        title = value(block, ".courseblocktitle")
        m = re.match(r"([A-Z]{3,4}\d{3}[A-Z]?)\s+(.+?)\s*\((\d+) Credits?\)", title)
        if not m:
            continue  # Variable credits need explicit student/advisor selection.
        node = translated.new_tag("div", attrs={"class": "course", "id": m[1]})
        for cls, text in [("course-title", m[2]), ("course-min-credits", m[3])]:
            child = translated.new_tag("span", attrs={"class": cls})
            child.string = text
            node.append(child)
        for extra in block.select(".courseblockextra"):
            child = translated.new_tag("div", attrs={"class": "approved-course-text"})
            label = extra.select_one("strong")
            if label:
                strong = translated.new_tag("strong")
                strong.string = label.get_text().replace(
                    "Credit Only Granted for", "Credit only granted for"
                )
                child.append(strong)
                child.append(
                    extra.get_text(" ", strip=True).removeprefix(label.get_text(" ", strip=True))
                )
                node.append(child)
        translated.append(node)
    return parse_courses(str(translated), "", url, stamp)


def enrich_catalog(courses, prefixes):
    result = {c.id: c for c in courses}
    warnings = []
    for prefix in sorted(set(prefixes)):
        url = f"https://academiccatalog.umd.edu/undergraduate/approved-courses/{prefix.lower()}/"
        try:
            body, stamp, stale = cached_get(url, 86400)
            for course in parse_catalog(body, url, stamp):
                course.terms = [t for t in course.terms if t]
                if course.id in result:
                    current = result[course.id]
                    current.prerequisites = course.prerequisites or current.prerequisites
                    current.crosslisted = sorted(set(current.crosslisted + course.crosslisted))
                    current.restrictions = sorted(set(current.restrictions + course.restrictions))
                else:
                    result[course.id] = course
            if stale:
                warnings.append(f"{prefix}: official catalog cache is stale.")
        except (httpx.HTTPError, ValueError):
            warnings.append(f"{prefix}: official catalog unavailable; using term data.")
    return list(result.values()), warnings
