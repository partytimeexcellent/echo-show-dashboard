#!/usr/bin/env python3
"""Scenario tests for custom_templates/echo_climate.jinja (the climate plan).

Renders echo_climate_plan() with a stubbed set of Home Assistant template functions and
checks what it decides in a few situations. Run:  python3 test/climate_plan.py
"""
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import jinja2

ROOT = Path(__file__).resolve().parent.parent
TZ = timezone(timedelta(hours=-7))


def _float(v, default=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _int(v, default=0):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return default


class World:
    def __init__(self, now, states, attrs):
        self.now, self.states, self.attrs = now, states, attrs

    def env(self):
        e = jinja2.Environment(loader=jinja2.FileSystemLoader(str(ROOT / "homeassistant" / "custom_templates")),
                               extensions=["jinja2.ext.loopcontrols", "jinja2.ext.do"])
        e.filters.update({"to_json": lambda v: json.dumps(v, default=str), "from_json": json.loads,
                          "float": _float, "int": _int})
        e.globals.update({
            "now": lambda: self.now,
            "timedelta": timedelta,
            "states": lambda eid: self.states.get(eid, "unknown"),
            "state_attr": lambda eid, a: self.attrs.get(eid, {}).get(a),
            "has_value": lambda eid: self.states.get(eid, "unknown") not in ("unknown", "unavailable"),
            "as_datetime": lambda v: datetime.fromisoformat(v) if isinstance(v, str) else v,
        })
        return e

    def plan(self):
        out = self.env().from_string(
            "{% from 'echo_climate.jinja' import echo_climate_plan %}{{ echo_climate_plan('climate.t') }}"
        ).render()
        return json.loads(out)


WD = [{"t": "06:30", "p": "wake"}, {"t": "08:30", "p": "home"}, {"t": "22:30", "p": "sleep"}]
PROFILES = {
    "home": {"name": "Home", "low": 68, "high": 76, "sensors": ["thermostat"]},
    "wake": {"name": "Wake", "low": 69, "high": 75, "sensors": ["thermostat"]},
    "sleep": {"name": "Sleep", "low": 64, "high": 72, "sensors": ["bedroom"]},
    "away": {"name": "Away", "low": 62, "high": 80, "sensors": ["thermostat"]},
    "vacation": {"name": "Vacation", "low": 55, "high": 85, "sensors": ["thermostat"]},
}
ROOMS = [{"key": "thermostat", "name": "Thermostat", "entity": "climate.t"},
         {"key": "bedroom", "name": "Bedroom", "entity": "sensor.bed"}]


def world(hhmm, day=2, hv="heat_cool", temp=70, house="home", hold=None, bed="unavailable", options=None):
    # 2026-09-30 is a Wednesday; day=2 -> Wednesday
    base = datetime(2026, 9, 28, tzinfo=TZ) + timedelta(days=day)
    h, m = map(int, hhmm.split(":"))
    now = base.replace(hour=h, minute=m)
    store = {"profiles": PROFILES, "week": {k: WD for k in ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]},
             "hold": hold or {"type": "none"}, "options": options or {}, "learn": {"heat_rate": 4, "cool_rate": 3},
             "rooms": ROOMS}
    return World(now, {"climate.t": hv, "sensor.echo_house_mode": house, "sensor.bed": bed},
                 {"climate.t": {"current_temperature": temp, "min_temp": 40, "max_temp": 90, "hvac_action": "idle"},
                  "sensor.echo_climate_settings": store})


failures = []


def check(name, p, **want):
    for k, v in want.items():
        got = p
        for part in k.split("__"):
            got = got.get(part) if isinstance(got, dict) else None
        if got != v:
            failures.append(f"{name}: {k.replace('__', '.')} = {got!r}, expected {v!r}")


p = world("07:00").plan()
check("wake period", p, source="schedule", profile="wake", set_low=69, set_high=75, control=True,
      next__profile="home", period__profile="wake")
if not (p["next"]["start"] or "").startswith("2026-09-30T08:30"):
    failures.append(f"wake period: next.start = {p['next']['start']}")

p = world("03:00").plan()
check("night", p, source="schedule", profile="sleep", set_low=64, rooms_used=["thermostat"], offset=0)

# 64 -> 69 at 4 deg/h is 75 min: at 05:30 (60 min before 06:30) it has started
p = world("05:30", temp=64).plan()
check("preheat", p, source="preheat", profile="wake", set_low=69, preheat__active=True)
p = world("05:00", temp=64).plan()
check("not yet", p, source="schedule", profile="sleep", preheat__active=False)
p = world("05:30", temp=64, options={"preheat": False}).plan()
check("preheat off", p, source="schedule")

# bedroom sensor online: thermostat 70, bedroom 66 -> +4 (capped at 4)
p = world("23:00", temp=70, bed="66").plan()
check("compensate", p, profile="sleep", room=66.0, offset=4, set_low=68, set_high=76, rooms_used=["bedroom"])
p = world("23:00", temp=70, bed="68.6").plan()
check("compensate rounded", p, offset=1, set_low=65)

hold = {"type": "next", "until": "2026-09-30T08:30:00-07:00", "low": 71, "high": 76}
p = world("07:00", hold=hold).plan()
check("hold", p, source="hold", control=False, hold__active=True)
p = world("09:00", hold=hold).plan()
check("hold over", p, source="schedule", control=True, hold__active=False)

p = world("12:00", house="away", hold=hold).plan()
check("away", p, source="away", profile="away", set_low=62, set_high=80)
p = world("12:00", house="away", hold={"type": "permanent", "low": 70, "high": 75}).plan()
check("permanent beats away", p, source="hold")
p = world("12:00", house="vacation", hold={"type": "permanent"}).plan()
check("vacation", p, source="vacation", set_low=55)
p = world("12:00", hv="off").plan()
check("off", p, source="off", control=False)

# heat_cool keeps the differential
PROFILES["home"]["high"] = 69
p = world("12:00").plan()
check("differential", p, set_low=68, set_high=71)
PROFILES["home"]["high"] = 76

# Sunday 23:30 rolls over to Monday's first period
p = world("23:30", day=6).plan()
check("week wrap", p, profile="sleep", next__profile="wake")
if not (p["next"]["start"] or "").startswith("2026-10-05T06:30"):
    failures.append(f"week wrap: next.start = {p['next']['start']}")

if failures:
    print("FAILED:")
    for f in failures:
        print(" -", f)
    sys.exit(1)
print("climate plan: all scenarios pass")
