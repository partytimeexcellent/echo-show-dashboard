#!/usr/bin/env python3
"""Echo Show Dashboard <-> Kiosk Satellite bridge for alarm settings.

Home Assistant runs this through `shell_command.echo_kiosk` (see
packages/echo_kiosk.yaml) so the dashboard's settings panel can read and change a
tablet's Kiosk Satellite alarm settings and add ringtones to it. A dashboard page
can't call the tablet's Remote API itself (it sends no CORS headers), and Home
Assistant can't join a !secret with a URL path or a "Bearer " prefix, so this
script reads the two secrets per tablet and makes the request:

    # secrets.yaml - one pair per tablet; <name> is part of its Kiosk Satellite device
    # name that no other tablet has ("kitchen_echo_show_8" for "Kitchen Echo Show 8").
    echo_kiosk_<name>_url: http://<tablet-ip>:2324
    echo_kiosk_<name>_token: <long-lived token from POST /api/login with ttl_days>

Usage: echo_kiosk.py <base64 kiosk name> <op> <base64 JSON data>
Prints one JSON object. Ops: get, set, test, stop, install_tones, devices, logs,
mic, mic_set.

Only the alarm settings (alarms.*) and the microphone mute (voice.mute, ops mic and
mic_set) can be read or changed through it. Standard
library only, so it runs inside the Home Assistant container as is.
"""
import base64
import io
import json
import math
import os
import random
import re
import struct
import sys
import urllib.error
import urllib.parse
import urllib.request
import wave

SECRETS = os.environ.get("ECHO_KIOSK_SECRETS", "/config/secrets.yaml")
TIMEOUT = 12

# The settings the panel may read and change.
KEYS = [
    "alarms.volume", "alarms.tone", "alarms.ease_in", "alarms.ease_in_seconds",
    "alarms.snooze_minutes", "alarms.silence_after_minutes", "alarms.sunrise_minutes",
    "alarms.phrase",
]
# Voice Satellite's "Mute microphone": on stops wake word listening and closes the mic.
MIC_KEY = "voice.mute"
TONE_PREFIX = "Echo "


def out(obj, code=0):
    sys.stdout.write(json.dumps(obj))
    sys.stdout.flush()
    sys.exit(code)


def b64(s):
    try:
        return base64.b64decode(s or "").decode("utf-8")
    except Exception:
        return ""


def norm(s):
    return re.sub(r"[^a-z0-9]+", "", str(s or "").lower())


# ---------- secrets ----------

def read_secrets():
    try:
        with open(SECRETS, encoding="utf-8") as f:
            text = f.read()
    except OSError as e:
        out({"ok": False, "error": "can't read secrets.yaml: %s" % e})
    secrets = {}
    for line in text.splitlines():
        m = re.match(r"^\s*(echo_kiosk_[A-Za-z0-9_]+)\s*:\s*(.*?)\s*$", line)
        if not m:
            continue
        v = m.group(2)
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
            v = v[1:-1]
        else:
            v = re.sub(r"\s+#.*$", "", v)
        secrets[m.group(1)] = v
    return secrets


def tablets():
    s = read_secrets()
    found = {}
    for k, v in s.items():
        m = re.match(r"^echo_kiosk_(.+)_url$", k)
        if m and s.get("echo_kiosk_%s_token" % m.group(1)):
            found[m.group(1)] = (v.rstrip("/"), s["echo_kiosk_%s_token" % m.group(1)])
    return found


def pick(kiosk):
    """The secrets pair for this display: the longest <name> found in its Kiosk Satellite
    name that belongs to it. A short <name> can match several displays ("kitchen" is in
    both "Kitchen Echo Show 8" and "Kitchen Echo Show 5"), so each candidate tablet is asked
    its own name and one that names a different display is skipped."""
    name = norm(kiosk)
    found = [(k, pair) for k, pair in tablets().items() if norm(k) and norm(k) in name]
    if not found:
        out({"ok": False, "error": "no_secrets",
             "message": "No echo_kiosk_<name>_url / _token pair in secrets.yaml matches \"%s\"." % kiosk})
    found.sort(key=lambda kp: -len(norm(kp[0])))
    others = []
    for key, (base, token) in found:
        real = tablet_name(base, token)
        if real is None or is_named(real, kiosk):
            return key, (base, token)
        others.append("echo_kiosk_%s_* is \"%s\"" % (key, real))
    out({"ok": False, "error": "wrong_tablet",
         "message": "None of the secrets.yaml pairs that match \"%s\" are for this display (%s). Add an "
                    "echo_kiosk_<name>_url / _token pair whose <name> only this display has, such as its full name."
                    % (kiosk, "; ".join(others))})


def is_named(real, kiosk):
    """kiosk is "<Kiosk Satellite name> <entity prefix>" from the dashboard (either may be missing)."""
    r = norm(real)
    return bool(r) and r in (norm(kiosk), norm(kiosk.rsplit(" ", 1)[0]), norm(kiosk.rsplit(" ", 1)[-1]))


def tablet_name(base, token):
    """The tablet's own device name from /api/info, or None when it can't tell."""
    url = base + "/api/info"
    req = urllib.request.Request(url)
    req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            info = json.loads(r.read().decode("utf-8") or "{}")
    except Exception:   # unreachable or refused: let the real request report it
        return None
    if not isinstance(info, dict):
        return None
    for d in (info, info.get("device") if isinstance(info.get("device"), dict) else {}):
        for k in ("deviceName", "name"):
            if isinstance(d.get(k), str) and d[k].strip():
                return d[k]
    return None


# ---------- the tablet's Remote API ----------

def call(base, token, method, path, body=None, raw=None, query=None):
    url = base + path + ("?" + urllib.parse.urlencode(query) if query else "")
    data, ctype = None, None
    if raw is not None:
        data, ctype = raw, "application/octet-stream"
    elif body is not None:
        data, ctype = json.dumps(body).encode("utf-8"), "application/json"
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + token)
    if ctype:
        req.add_header("Content-Type", ctype)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            txt = r.read().decode("utf-8") or "{}"
            return json.loads(txt)
    except urllib.error.HTTPError as e:
        if e.code == 401:
            out({"ok": False, "error": "unauthorized",
                 "message": "The tablet refused the token. Make a new one with /api/login and update secrets.yaml."})
        out({"ok": False, "error": "http_%d" % e.code, "message": e.read().decode("utf-8", "replace")[:300]})
    except Exception as e:  # unreachable, timeout, bad JSON
        out({"ok": False, "error": "unreachable",
             "message": "Can't reach the tablet at %s (%s). Is Remote management on?" % (base, e)})


def sounds(base, token):
    r = call(base, token, "POST", "/api/commands/listNotificationSounds", {})
    data = (r or {}).get("data") or {}
    return data.get("sounds") or []


def get_settings(base, token, keys=None):
    keys = KEYS if keys is None else keys
    r = call(base, token, "GET", "/api/settings")
    vals = {}
    for d in (r or {}).get("settings") or []:
        if d.get("key") in keys:
            vals[d["key"]] = d.get("value", d.get("default"))
    return vals


def truthy(v):
    if isinstance(v, str):
        return v.strip().lower() in ("1", "true", "on", "yes")
    return bool(v)


def mic_state(base, token):
    vals = get_settings(base, token, [MIC_KEY])
    if MIC_KEY not in vals:
        out({"ok": False, "error": "no_setting",
             "message": "This Kiosk Satellite version has no %s setting." % MIC_KEY})
    return truthy(vals[MIC_KEY])


# ---------- ringtones ----------
# Original tones made here, the same voices as the dashboard's timer sounds plus a few
# made for waking up. Each file is one cycle; Kiosk Satellite loops it while ringing.

RATE = 22050


class Track:
    def __init__(self, seconds, level=0.89):
        self.level = level                # peak; lower for dense tones so all sound about as loud
        self.n = int(seconds * RATE)
        self.buf = [0.0] * self.n

    def ping(self, t, f, dur, g, shape="sine", attack=0.012):
        """A partial with a quick attack and an exponential decay."""
        start = int(t * RATE)
        end = min(self.n, start + int((dur + 0.05) * RATE))
        k = math.log(0.0001 / 1.0) / dur
        w = 2 * math.pi * f / RATE
        for i in range(max(0, start), end):
            x = (i - start) / RATE
            env = (x / attack) if x < attack else math.exp(k * (x - attack))
            self.buf[i] += g * env * osc(shape, w * (i - start))

    def beep(self, t, f, length, g, shape="sine"):
        """A flat tone with soft edges."""
        start = int(t * RATE)
        end = min(self.n, start + int(length * RATE))
        edge = 0.02
        w = 2 * math.pi * f / RATE
        for i in range(max(0, start), end):
            x = (i - start) / RATE
            env = min(1.0, x / edge, (length - x) / edge)
            self.buf[i] += g * max(0.0, env) * osc(shape, w * (i - start))

    def bell(self, t, f, g, k=1.0):
        for mul, amp, dur in ((1, 1, 2.4), (2, 0.45, 1.5), (2.76, 0.3, 1.1), (5.4, 0.12, 0.6)):
            self.ping(t, f * mul, dur * k, g * amp)

    def wav(self):
        peak = max(1e-9, max(abs(v) for v in self.buf))
        scale = self.level / peak
        fade = int(0.01 * RATE)          # no click where the loop restarts
        frames = bytearray()
        for i, v in enumerate(self.buf):
            if i >= self.n - fade:
                v *= (self.n - i) / fade
            frames += struct.pack("<h", int(max(-1, min(1, v * scale)) * 32767))
        bio = io.BytesIO()
        w = wave.open(bio, "wb")
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(bytes(frames))
        w.close()
        return bio.getvalue()


def osc(shape, ph):
    s = math.sin(ph)
    if shape == "square":   # band-limited enough at these pitches
        return (s + math.sin(3 * ph) / 3 + math.sin(5 * ph) / 5) * 0.9
    if shape == "triangle":
        return s - math.sin(3 * ph) / 9 + math.sin(5 * ph) / 25
    return s


def tone_chime():
    t = Track(2.8)
    t.ping(0, 1318.5, 1.4, 0.5); t.ping(0, 2637, 0.5, 0.1)
    t.ping(0.5, 1046.5, 1.8, 0.5); t.ping(0.5, 2093, 0.6, 0.1)
    return t


def tone_marimba():
    t = Track(2.4)
    for i, f in enumerate((523.25, 659.25, 783.99, 1046.5)):
        t.ping(i * 0.17, f, 0.55, 0.55); t.ping(i * 0.17, f * 4, 0.12, 0.12)
    return t


def tone_bells():
    t = Track(3.4)
    t.bell(0, 660, 0.4); t.bell(0.8, 660, 0.4)
    return t


def tone_gentle():
    t = Track(2.2, 0.6)
    for i in range(3):
        t.beep(i * 0.32, 880, 0.16, 0.45)
    return t


def tone_kitchen():
    t = Track(2.6)
    for i in range(10):
        t.bell(i * 0.075, 1568, 0.16, 0.35)
    return t


def tone_classic():
    t = Track(1.6, 0.45)
    for i in range(4):
        t.beep(i * 0.22, 2000, 0.12, 0.3, "square")
    return t


def tone_sunrise():
    # A slow, soft major arpeggio climbing an octave and a half.
    t = Track(5.2)
    notes = (392.0, 493.88, 587.33, 783.99, 987.77, 1174.66)
    for i, f in enumerate(notes):
        t.ping(i * 0.55, f, 2.2, 0.32, "triangle", attack=0.06)
        t.ping(i * 0.55, f * 2, 0.8, 0.05)
    return t


def tone_harp():
    t = Track(3.0)
    notes = (523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98, 1318.5, 1046.5, 783.99)
    for i, f in enumerate(notes):
        t.ping(i * 0.11, f, 1.1, 0.32, "triangle", attack=0.004)
    return t


def tone_digital():
    # Four quick double-beeps, like a bedside clock.
    t = Track(2.0, 0.45)
    for i in range(4):
        t.beep(i * 0.25, 2093, 0.06, 0.28, "square")
        t.beep(i * 0.25 + 0.09, 2093, 0.06, 0.28, "square")
    return t


def tone_wind():
    # Pentatonic wind chimes, the same "random" pattern every time.
    rnd = random.Random(7)
    t = Track(4.0)
    scale = (1046.5, 1174.66, 1318.5, 1567.98, 1760.0, 2093.0)
    x = 0.0
    while x < 3.1:
        f = rnd.choice(scale)
        t.ping(x, f, 1.6, 0.22 + rnd.random() * 0.12)
        t.ping(x, f * 2.76, 0.4, 0.05)
        x += 0.12 + rnd.random() * 0.3
    return t


def tone_rise():
    # Soft pulses that climb in pitch, insistent without being harsh.
    t = Track(2.4, 0.6)
    for i in range(6):
        t.beep(i * 0.3, 660 * (2 ** (i / 12.0 * 2)), 0.18, 0.3, "triangle")
    return t


TONES = [
    ("Chime", tone_chime), ("Marimba", tone_marimba), ("Bells", tone_bells),
    ("Gentle Beep", tone_gentle), ("Kitchen Bell", tone_kitchen), ("Classic Alarm", tone_classic),
    ("Sunrise", tone_sunrise), ("Harp", tone_harp), ("Digital", tone_digital),
    ("Wind Chimes", tone_wind), ("Rising Pulse", tone_rise),
]


def install_tones(base, token, force):
    have = set(sounds(base, token))
    added = []
    for name, make in TONES:
        fname = TONE_PREFIX + name + ".wav"
        if fname in have and not force:
            continue
        r = call(base, token, "POST", "/api/files/upload", raw=make().wav(),
                 query={"root": "app", "path": "sounds/" + fname})
        if isinstance(r, dict) and r.get("error"):
            out({"ok": False, "error": "upload", "message": "%s: %s" % (fname, r.get("error"))})
        added.append(fname)
    return added


# ---------- main ----------

def main():
    if len(sys.argv) < 3:
        out({"ok": False, "error": "usage"})
    kiosk, op = b64(sys.argv[1]), sys.argv[2]
    try:
        data = json.loads(b64(sys.argv[3]) if len(sys.argv) > 3 else "{}") or {}
    except ValueError:
        data = {}
    if op == "devices":
        out({"ok": True, "devices": sorted(tablets().keys())})
    if op == "render" and os.environ.get("ECHO_KIOSK_DEV"):   # development only: write one tone to a file
        for name, make in TONES:
            if name == data.get("name"):
                with open(data.get("path", "/tmp/tone.wav"), "wb") as f:
                    f.write(make().wav())
                out({"ok": True})
        out({"ok": False, "error": "unknown tone"})
    key, (base, token) = pick(kiosk)
    if op == "get":
        out({"ok": True, "tablet": key, "settings": get_settings(base, token),
             "sounds": sounds(base, token), "tones": [TONE_PREFIX + n + ".wav" for n, _ in TONES]})
    if op == "set":
        patch = {k: v for k, v in data.items() if k in KEYS}
        if not patch:
            out({"ok": False, "error": "nothing to set"})
        r = call(base, token, "PATCH", "/api/settings", patch) or {}
        bad = r.get("rejected") or []
        out({"ok": not bad, "rejected": bad, "errors": r.get("errors") or {},
             "settings": get_settings(base, token)})
    if op == "mic":
        out({"ok": True, "tablet": key, "muted": mic_state(base, token)})
    if op == "mic_set":
        want = truthy(data.get("muted"))
        r = call(base, token, "PATCH", "/api/settings", {MIC_KEY: want}) or {}
        bad = r.get("rejected") or []
        muted = mic_state(base, token)
        out({"ok": not bad and muted == want, "muted": muted, "rejected": bad,
             "message": (r.get("errors") or {}).get(MIC_KEY) or ("" if muted == want else "The tablet kept the old setting.")})
    if op == "test":
        tone = str(data.get("tone", ""))
        call(base, token, "POST", "/api/commands/previewAlarmTone", {"tone": tone})
        out({"ok": True})
    if op == "stop":
        call(base, token, "POST", "/api/commands/stopAlarmTonePreview", {})
        out({"ok": True})
    if op == "logs":   # the tablet's recent log lines about alarms and sound, for troubleshooting
        r = call(base, token, "GET", "/api/logs") or {}
        want = re.compile(str(data.get("match") or "alarm|tone|ring|sound|audio"), re.I)
        lines = [e for e in (r.get("logs") or []) if want.search(json.dumps(e))]
        out({"ok": True, "logs": lines[-int(data.get("limit") or 40):]})
    if op == "install_tones":
        added = install_tones(base, token, bool(data.get("force")))
        out({"ok": True, "added": added, "sounds": sounds(base, token)})
    out({"ok": False, "error": "unknown op %s" % op})


if __name__ == "__main__":
    main()
