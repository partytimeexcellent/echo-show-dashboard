#!/usr/bin/env python3
"""Offline checks for the Home Assistant files in homeassistant/.

- every YAML file parses (HA tags like !input are accepted)
- every Jinja template in them parses
- the timer_finished blueprint finds a display's entities from its device

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

check_template((HA / "custom_templates" / "echo_climate.jinja").read_text(), "echo_climate.jinja")


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


env.tests["match"] = lambda v, p: re.match(p, str(v)) is not None

# timer_finished: the entities of the display whose timer rang.
bp = yaml.load((HA / "blueprints" / "automation" / "echo_show" / "timer_finished.yaml").read_text(), Loader=Loader)
picks = bp["actions"][1]["variables"]
ents = ["number.office_office_echo_show_8_media_volume", "number.office_office_echo_show_8_assistant_volume",
        "number.office_office_echo_show_8_volume", "button.office_office_echo_show_8_postpone_screensaver",
        "button.office_office_echo_show_8_reload_page", "select.office_office_echo_show_8_dashboard_view"]
want = {("vol", "assistant_volume"): "number.office_office_echo_show_8_assistant_volume",
        ("vol", "volume"): "number.office_office_echo_show_8_volume",
        ("btn", "volume"): "button.office_office_echo_show_8_postpone_screensaver",
        ("sel", "volume"): "select.office_office_echo_show_8_dashboard_view"}
for (key, which), exp in want.items():
    got = render(picks[key], ents=ents, which=which)
    if got != exp:
        failures.append(f"timer_finished {key} ({which}) = {got!r}, expected {exp!r}")
if render(picks["vol"], ents=[], which="assistant_volume") != "":
    failures.append("timer_finished vol without entities should be empty")

print(f"checked {len(yaml_files)} YAML files")
if failures:
    print("\nFAILED:")
    for f in failures:
        print(" -", f)
    sys.exit(1)
print("all good")
