#!/usr/bin/env python3
"""Offline checks for the Home Assistant files in homeassistant/.

- every YAML file parses (HA tags like !input are accepted)
- every Jinja template in them parses, with echo_timers.jinja importable
- the voice-parsing macros give the expected results for sample phrases

HA's template filters are stubbed just enough to render the macros; this does not
replace testing on a real Home Assistant.  Run:  python3 test/validate_ha.py
"""
import json
import math
import re
import sys
from pathlib import Path

import jinja2
import yaml

ROOT = Path(__file__).resolve().parent.parent
HA = ROOT / "homeassistant"
failures = []


# ---------- YAML ----------
class Loader(yaml.SafeLoader):
    pass


def _tag(loader, suffix, node):
    if isinstance(node, yaml.ScalarNode):
        return {"__tag__": suffix, "value": loader.construct_scalar(node)}
    if isinstance(node, yaml.SequenceNode):
        return loader.construct_sequence(node)
    return loader.construct_mapping(node)


Loader.add_multi_constructor("!", _tag)


# ---------- Jinja with HA-ish filters ----------
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


def _py_re(pattern):
    return pattern


env = jinja2.Environment(
    loader=jinja2.FileSystemLoader(str(HA / "custom_templates")),
    extensions=["jinja2.ext.loopcontrols", "jinja2.ext.do"],
)
env.filters.update(
    {
        "regex_replace": lambda s, find="", repl="": re.sub(_py_re(find), repl.replace("\\", "\\"), str(s)),
        "regex_findall": lambda s, find="": re.findall(_py_re(find), str(s)),
        "to_json": json.dumps,
        "from_json": json.loads,
        "float": _float,
        "int": _int,
        "slugify": lambda v: re.sub(r"[^a-z0-9]+", "_", str(v).lower()).strip("_"),
    }
)
FAKE_STATES = {}
env.globals.update(
    {
        "states": lambda e: FAKE_STATES.get(e, "unknown"),
        "is_state": lambda e, s: FAKE_STATES.get(e) == s,
        "state_attr": lambda e, a: None,
        "as_timestamp": lambda v, d=0: d,
        "now": lambda: 0,
        "device_entities": lambda d: {"sat-office": ["assist_satellite.office_echo"]}.get(d, []),
        "device_attr": lambda d, a: {"sat-office": "Office Echo Show 8", "sat-new": "Kitchen Echo Show 5"}.get(d) if a == "name" else None,
    }
)


def check_template(text, where):
    try:
        env.parse(text)
    except jinja2.TemplateSyntaxError as e:
        failures.append(f"{where}: {e}")


def walk(obj, where):
    if isinstance(obj, dict):
        for k, v in obj.items():
            walk(v, f"{where}.{k}")
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            walk(v, f"{where}[{i}]")
    elif isinstance(obj, str) and ("{{" in obj or "{%" in obj):
        check_template(obj, where)


yaml_files = sorted(HA.rglob("*.yaml"))
for f in yaml_files:
    try:
        data = yaml.load(f.read_text(), Loader=Loader)
    except yaml.YAMLError as e:
        failures.append(f"{f.relative_to(ROOT)}: YAML error: {e}")
        continue
    walk(data, str(f.relative_to(ROOT)))

check_template((HA / "custom_templates" / "echo_timers.jinja").read_text(), "echo_timers.jinja")
check_template((HA / "custom_templates" / "echo_climate.jinja").read_text(), "echo_climate.jinja")
check_template((HA / "custom_templates" / "voice.jinja").read_text(), "voice.jinja")


# A `variables:` block must not use another key of the same block: Home Assistant saves UI
# scripts and automations with their keys sorted, so the order in the file is not kept.
# Keys must also be strings (YAML reads a bare `off:` / `on:` / `yes:` as a boolean).
def check_vars(obj, where):
    if isinstance(obj, dict):
        for k, v in obj.items():
            if not isinstance(k, str):
                failures.append(f"{where}: key {k!r} is not a string (quote it)")
            if k == "variables" and isinstance(v, dict):
                names = set(v)
                for name, val in v.items():
                    used = set(re.findall(r"[A-Za-z_][A-Za-z0-9_]*", re.sub(r"\.\w+|'[^']*'", "", json.dumps(val)))) & (names - {name})
                    if used:
                        failures.append(f"{where}.variables.{name} uses {sorted(used)} from the same block")
            check_vars(v, f"{where}.{k}")
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            check_vars(v, f"{where}[{i}]")


for f in sorted((HA / "packages").glob("*.yaml")):
    try:
        check_vars(yaml.load(f.read_text(), Loader=Loader), str(f.relative_to(ROOT)))
    except yaml.YAMLError:
        pass


# ---------- macro behaviour ----------
def render(src, **kw):
    return env.from_string(src).render(**kw).strip()


cases = {
    "ten minutes": 600,
    "10 minutes": 600,
    "an hour and a half": 5400,
    "1 hour and a half": 5400,
    "twenty five minutes": 1500,
    "half an hour": 1800,
    "90 seconds": 90,
    "2 hours 15 minutes": 8100,
    "a couple of minutes": 120,
    "5": 300,
}
for phrase, want in cases.items():
    got = render("{% from 'echo_timers.jinja' import timer_seconds %}{{ timer_seconds(p) }}", p=phrase)
    if str(want) != got:
        failures.append(f"timer_seconds({phrase!r}) = {got}, expected {want}")

for raw, want in {"the pasta timer": "Pasta", "my eggs": "Eggs", "": ""}.items():
    got = render("{% from 'echo_timers.jinja' import clean_name %}{{ clean_name(n) }}", n=raw)
    if got != want:
        failures.append(f"clean_name({raw!r}) = {got!r}, expected {want!r}")

got = render("{% from 'echo_timers.jinja' import speak_duration %}{{ speak_duration(5400) }}")
if got != "1 hour and 30 minutes":
    failures.append(f"speak_duration(5400) = {got!r}")

displays = [{"satellite": "assist_satellite.kitchen_echo", "timer_prefix": "echo_timer"},
            {"satellite": "assist_satellite.office_echo", "timer_prefix": "office_timer"}]
for dev, want in {"sat-office": "1", None: "0", "unknown-device": "-1"}.items():
    got = render("{% from 'echo_timers.jinja' import display_index %}{{ display_index(d, ds) }}", d=dev, ds=displays)
    if got != want:
        failures.append(f"display_index({dev!r}) = {got!r}, expected {want}")
got = render("{% from 'echo_timers.jinja' import display_index %}{{ display_index(d, []) }}", d="sat-office")
if got != "-1":
    failures.append(f"display_index with no displays = {got!r}, expected -1")

# Each display's own timer set, found from its device name.
FAKE_STATES.update({"timer.office_echo_show_8_timer_1": "idle"})
for dev, want in {"sat-office": "office_echo_show_8_timer", "sat-new": "echo_timer", None: "echo_timer"}.items():
    got = render("{% from 'echo_timers.jinja' import prefix_for_device %}{{ prefix_for_device(d) }}", d=dev)
    if got != want:
        failures.append(f"prefix_for_device({dev!r}) = {got!r}, expected {want}")
for pfx, want in {"kitchen_echo_show_5_timer": "kitchen_echo_show_5", "echo_timer": "", "office_timer": "office"}.items():
    got = render("{% from 'echo_timers.jinja' import slug_for_prefix %}{{ slug_for_prefix(p) }}", p=pfx)
    if got != want:
        failures.append(f"slug_for_prefix({pfx!r}) = {got!r}, expected {want!r}")

FAKE_STATES.update({"timer.echo_timer_1": "active", "input_text.echo_timer_1_name": "Pasta",
                    "timer.echo_timer_2": "idle", "input_text.echo_timer_2_name": "Eggs",
                    "timer.echo_timer_3": "idle", "input_text.echo_timer_3_name": ""})
got = json.loads(render("{% from 'echo_timers.jinja' import slots_json %}{{ slots_json('echo_timer') }}"))
if [(x["i"], x["s"], x["n"]) for x in got] != [(1, "active", "Pasta"), (2, "done", "Eggs")]:
    failures.append(f"slots_json = {got}")

# Spoken numbers for Assist's answers (voice.jinja).
env.filters["abs"] = abs
FAKE_ATTRS = {"sensor.bed": {"unit_of_measurement": "°F"}, "weather.home": {"temperature": 69.4},
              "climate.t": {"current_temperature": 73.5}}
FAKE_STATES.update({"sensor.bed": "73.688", "weather.home": "partlycloudy", "climate.t": "heat_cool",
                    "person.me": "not_home"})
env.globals.update({"is_number": lambda v: _float(v, None) is not None,
                    "state_attr": lambda e, a: FAKE_ATTRS.get(e, {}).get(a)})
speech = {
    "say_value(73.4, '°F')": "73 degrees", "say_value('1', '°')": "1 degree", "say_value(45.2, '%')": "45 percent",
    "say_value(1.04, 'kWh')": "1 kilowatt hour", "say_value(2.46, 'kWh')": "2.5 kilowatt hours",
    "say_value(29.921, 'inHg')": "29.92 inches of mercury", "say_value(12.6, 'widgets')": "13 widgets",
    "say_value(0.04, 'in')": "0.04 inches", "say_state('sensor.bed')": "74 degrees",
    "say_state('person.me')": "away", "say_state('climate.t')": "heat and cool",
    "say_weather('weather.home')": "69 degrees and partly cloudy", "say_climate('climate.t')": "74 degrees",
}
for call, want in speech.items():
    name = call.split("(")[0]
    got = render("{% from 'voice.jinja' import " + name + " %}{{ " + call + " }}")
    if got != want:
        failures.append(f"{call} = {got!r}, expected {want!r}")

print(f"checked {len(yaml_files)} YAML files, {len(cases)} duration phrases")
if failures:
    print("\nFAILED:")
    for f in failures:
        print(" -", f)
    sys.exit(1)
print("all good")
