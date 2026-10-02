/*
 * echo-clock-card (also registered as echo-timer-card)
 * Full-screen Clock page for an Echo Show 8 kiosk, laid out like the iOS Clock app:
 *  - Alarms: the Kiosk Satellite app's own alarms. They live on the tablet and ring with no
 *    Home Assistant, network or dashboard; the card lists, adds, edits and switches them.
 *  - Stopwatch: start/stop, laps (best and worst marked), kept per display across reloads.
 *  - Timers: up to three HA timer helpers with countdown rings, pause/resume, adjust and
 *    cancel; new ones are picked on hour/minute/second wheels. Rings with Web Audio.
 *
 * Plain JavaScript, no dependencies, no build step. ES5-ish for older Chromium.
 */
(function () {
  "use strict";

  var VERSION = "2.1.0";

  // Slider stops, in minutes.
  var STOPS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 75, 90, 105, 120, 150, 180];
  var DEFAULT_PRESETS = [1, 3, 5, 10, 15, 20, 30, 60];
  // Adjust slider stops (minutes either side of zero).
  var ADJ = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 30, 40, 50, 60];
  var CIRC = 2 * Math.PI * 45;

  function esc(s) {
    return String(s === undefined || s === null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // "H:MM:SS" (optionally "N day(s), H:MM:SS") -> seconds
  function parseDur(s) {
    if (s === undefined || s === null) return 0;
    if (typeof s === "number") return s;
    s = String(s);
    var days = 0;
    var m = s.match(/^(\d+) days?, (.*)$/);
    if (m) { days = parseInt(m[1], 10); s = m[2]; }
    var p = s.split(":");
    if (p.length !== 3) return 0;
    return days * 86400 + parseInt(p[0], 10) * 3600 + parseInt(p[1], 10) * 60 + parseFloat(p[2]);
  }

  function fmtClock(sec) {
    sec = Math.max(0, Math.ceil(sec));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    var ss = (s < 10 ? "0" : "") + s;
    if (h > 0) return h + ":" + (m < 10 ? "0" : "") + m + ":" + ss;
    return m + ":" + ss;
  }

  function fmtMinutes(min) {
    if (min < 60) return min + " min";
    var h = Math.floor(min / 60), m = min % 60;
    return h + " hr" + (m ? " " + m + " min" : "");
  }

  function fmtEnds(ts) {
    var d = new Date(ts);
    var h = d.getHours(), m = d.getMinutes();
    var ap = h >= 12 ? "PM" : "AM";
    h = h % 12; if (h === 0) h = 12;
    return h + ":" + (m < 10 ? "0" : "") + m + " " + ap;
  }


  // ---------- which display is this? ----------
  // One dashboard serves several Echo Shows. Each card can carry per-display overrides
  // (devices: [{match: "office", ...}]) chosen by the Kiosk Satellite device name.
  // "?echo_display=<name>" in the URL (remembered in this browser) overrides it.

  function echoDisplayName() {
    if (window.__echoDisplayP) return window.__echoDisplayP;
    var forced = null;
    try {
      var m = /[?&]echo_display=([^&]+)/.exec(window.location.search);
      if (m) window.localStorage.setItem("echo-display", decodeURIComponent(m[1]));
      forced = window.localStorage.getItem("echo-display");
    } catch (e) { /* storage unavailable */ }
    if (forced) window.__echoDisplayP = Promise.resolve(forced);
    else if (window.kioskSatellite && window.kioskSatellite.getDeviceInfo) {
      window.__echoDisplayP = window.kioskSatellite.getDeviceInfo().then(function (d) {
        return d ? String(d.name || d.model || "") : "";
      }, function () { return ""; });
    } else window.__echoDisplayP = Promise.resolve("");
    return window.__echoDisplayP;
  }

  function matchDisplay(devices, name) {
    if (!devices || !name) return null;
    var n = String(name).toLowerCase();
    for (var i = 0; i < devices.length; i++) {
      var mt = devices[i].match;
      if (mt && n.indexOf(String(mt).toLowerCase()) !== -1) return devices[i];
    }
    return null;
  }

  function navigate(path) {
    window.history.pushState(null, "", path);
    window.dispatchEvent(new Event("location-changed", { bubbles: true, composed: true }));
  }

  // ---------- alarm sound engine (Web Audio) ----------
  // The audio context is suspended whenever nothing is playing, so the tablet's own
  // audio (touch sounds, the voice assistant) isn't held up by an idle open stream.

  var Sound = (function () {
    var ctx = null, suspendT = null;
    function get() {
      if (!ctx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        try { ctx = new AC(); } catch (e) { return null; }
      }
      if (suspendT) { clearTimeout(suspendT); suspendT = null; }
      if (ctx.state === "suspended" && ctx.resume) ctx.resume();
      return ctx;
    }
    function releaseAfter(sec) {
      if (suspendT) clearTimeout(suspendT);
      suspendT = setTimeout(function () {
        suspendT = null;
        if (ctx && ctx.state === "running" && ctx.suspend) ctx.suspend();
      }, sec * 1000 + 400);
    }
    // One partial with a quick attack and exponential decay (bell / mallet style).
    function ping(c, t, f, dur, g, type) {
      var o = c.createOscillator(), a = c.createGain();
      o.type = type || "sine";
      o.frequency.setValueAtTime(f, t);
      a.gain.setValueAtTime(0.0001, t);
      a.gain.linearRampToValueAtTime(g, t + 0.012);
      a.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(a); a.connect(c.destination);
      o.start(t); o.stop(t + dur + 0.05);
    }
    // A flat beep with soft edges.
    function beep(c, t, f, len, g, type) {
      var o = c.createOscillator(), a = c.createGain();
      o.type = type || "sine";
      o.frequency.setValueAtTime(f, t);
      a.gain.setValueAtTime(0.0001, t);
      a.gain.linearRampToValueAtTime(g, t + 0.02);
      a.gain.setValueAtTime(g, t + len - 0.03);
      a.gain.linearRampToValueAtTime(0.0001, t + len);
      o.connect(a); a.connect(c.destination);
      o.start(t); o.stop(t + len + 0.05);
    }
    function bell(c, t, f, g, len) {
      var k = len || 1;
      var parts = [[1, 1, 2.4], [2, 0.45, 1.5], [2.76, 0.3, 1.1], [5.4, 0.12, 0.6]];
      for (var i = 0; i < parts.length; i++) ping(c, t, f * parts[i][0], parts[i][2] * k, g * parts[i][1]);
    }
    var TONES = {
      "Chime": { cycle: 2.8, play: function (c, t, g) {
        ping(c, t, 1318.5, 1.4, g * 0.5); ping(c, t, 2637, 0.5, g * 0.1);
        ping(c, t + 0.5, 1046.5, 1.8, g * 0.5); ping(c, t + 0.5, 2093, 0.6, g * 0.1);
      } },
      "Marimba": { cycle: 2.4, play: function (c, t, g) {
        var n = [523.25, 659.25, 783.99, 1046.5];
        for (var i = 0; i < n.length; i++) {
          ping(c, t + i * 0.17, n[i], 0.55, g * 0.55);
          ping(c, t + i * 0.17, n[i] * 4, 0.12, g * 0.12);
        }
      } },
      "Bells": { cycle: 3.4, play: function (c, t, g) {
        bell(c, t, 660, g * 0.4); bell(c, t + 0.8, 660, g * 0.4);
      } },
      "Gentle beep": { cycle: 2.2, play: function (c, t, g) {
        for (var i = 0; i < 3; i++) beep(c, t + i * 0.32, 880, 0.16, g * 0.45);
      } },
      // A wind-up kitchen timer: a short burst of quick strikes on a small bell.
      "Kitchen bell": { cycle: 2.6, play: function (c, t, g) {
        for (var i = 0; i < 10; i++) bell(c, t + i * 0.075, 1568, g * 0.16, 0.35);
      } },
      "Classic alarm": { cycle: 1.6, play: function (c, t, g) {
        for (var i = 0; i < 4; i++) beep(c, t + i * 0.22, 2000, 0.12, g * 0.3, "square");
      } },
    };
    return {
      names: ["Chime", "Marimba", "Bells", "Gentle beep", "Kitchen bell", "Classic alarm"],
      cycle: function (name) { return (TONES[name] || TONES.Chime).cycle; },
      play: function (name, gain) {
        var c = get();
        if (!c) return 0;
        var tn = TONES[name] || TONES.Chime;
        tn.play(c, c.currentTime + 0.05, gain === undefined ? 1 : gain);
        releaseAfter(tn.cycle);
        return tn.cycle;
      },
      // Short, soft tap feedback.
      tick: function () {
        var c = get();
        if (!c) return;
        ping(c, c.currentTime + 0.005, 1900, 0.05, 0.22);
        releaseAfter(0.1);
      },
      // Silence immediately (e.g. the voice assistant started listening).
      hush: function () {
        if (suspendT) { clearTimeout(suspendT); suspendT = null; }
        if (ctx && ctx.state === "running" && ctx.suspend) ctx.suspend();
      },
    };
  })();
  window.EchoAlarmSound = Sound;

  // ---------- alarm settings popup (<echo-alarm-settings>) ----------
  // Opened from the timer page's settings button. Everything is stored in HA helpers so
  // the settings are shared by every screen and by the "alarm when finished" automation.

  var SET_DEFAULTS = {
    volume_entity: "input_number.echo_timer_alarm_volume",   // device volume while ringing
    tone_entity: "input_select.echo_timer_alarm_tone",
    device_volume_entity: null,                               // e.g. number.<tablet>_volume (for Test)
    timers: ["timer.echo_timer_1", "timer.echo_timer_2", "timer.echo_timer_3"],
  };

  var SET_STYLE = [
    ":host{position:absolute;left:0;top:0;right:0;bottom:0;z-index:20;display:flex;align-items:center;justify-content:center;background:rgba(3,6,14,.6);font-family:var(--es-font,var(--ha-font-family-body,Roboto,'Helvetica Neue',Arial,sans-serif));color:#fff;-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none;}",
    ".bd{position:absolute;left:0;top:0;right:0;bottom:0;}",
    ".panel{position:relative;background:linear-gradient(180deg,var(--es-pan1,#1c2540),var(--es-pan2,#141b30));border:1px solid rgba(255,255,255,.1);border-radius:3.2vh;padding:3vh 3.5vh;width:74vw;box-sizing:border-box;box-shadow:0 20px 50px rgba(0,0,0,.55);}",
    ".hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:2.4vh;}",
    ".hd h2{margin:0;font-size:4.4vh;font-weight:400;letter-spacing:.01em;}",
    ".done{font-size:3.4vh;padding:1.4vh 3.4vh;border-radius:3.5vh;background:rgba(255,255,255,.12);cursor:pointer;}",
    ".lbl{display:flex;justify-content:space-between;font-size:2.8vh;letter-spacing:.08em;text-transform:uppercase;opacity:.6;margin-bottom:1.2vh;}",
    ".vrow{display:flex;align-items:center;gap:2.4vh;margin-bottom:3.2vh;}",
    ".vrow ha-icon{--mdc-icon-size:4.6vh;width:4.6vh;height:4.6vh;display:inline-flex;opacity:.7;}",
    ".track{position:relative;flex:1 1 auto;height:8vh;border-radius:4vh;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.08);overflow:hidden;touch-action:none;cursor:ew-resize;}",
    ".fill{position:absolute;left:0;top:0;bottom:0;width:100%;background:linear-gradient(90deg,var(--es-acc2,#ff8a00),var(--es-hi,#ffb340));transform-origin:left;}",
    ".tones{display:grid;grid-template-columns:repeat(3,1fr);gap:1.6vh;margin-bottom:2.8vh;}",
    ".tone{height:9vh;border-radius:2.2vh;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.08);display:flex;align-items:center;justify-content:center;font-size:3.3vh;cursor:pointer;}",
    ".tone.sel{background:rgba(var(--es-acc-rgb,255,159,10),.2);border-color:rgba(var(--es-acc-rgb,255,159,10),.65);color:var(--es-hi2,#ffc266);}",
    ".test{height:9vh;border-radius:4.5vh;background:linear-gradient(180deg,#3ad16a,#27a84f);display:flex;align-items:center;justify-content:center;font-size:3.6vh;cursor:pointer;}",
    ".test ha-icon{--mdc-icon-size:4.4vh;width:4.4vh;height:4.4vh;display:inline-flex;margin-right:1.2vh;}",
    ".tone:active,.test:active,.done:active{transform:scale(.96);}",
    ".dev{margin-top:2vh;text-align:center;font-size:2.4vh;opacity:.45;}",
  ].join("");
  // Inside the shared settings panel: no backdrop, frame or header of its own.
  var SET_EMBED = ":host{position:static;display:block;background:none;z-index:auto;}.bd,.hd,.dev{display:none;}" +
    ".panel{width:auto;background:none;border:none;box-shadow:none;padding:0;border-radius:0;}";

  function EchoAlarmSettings() {
    var self = Reflect.construct(HTMLElement, [], EchoAlarmSettings);
    self._cfg = SET_DEFAULTS;
    self._hass = null;
    self._vol = null;      // local slider value while dragging / until HA confirms
    self._restore = null;  // device volume to put back after a test
    return self;
  }
  EchoAlarmSettings.prototype = Object.create(HTMLElement.prototype);
  EchoAlarmSettings.prototype.constructor = EchoAlarmSettings;
  Object.setPrototypeOf(EchoAlarmSettings, HTMLElement);

  Object.defineProperty(EchoAlarmSettings.prototype, "config", {
    set: function (c) {
      var o = {};
      for (var k in SET_DEFAULTS) o[k] = (c && c[k] !== undefined) ? c[k] : SET_DEFAULTS[k];
      this._cfg = o;
    },
  });

  Object.defineProperty(EchoAlarmSettings.prototype, "hass", {
    set: function (h) { this._hass = h; if (this._built) this._paint(); else this._build(); },
    get: function () { return this._hass; },
  });

  EchoAlarmSettings.prototype._state = function (id) {
    var s = id && this._hass ? this._hass.states[id] : null;
    return s ? s.state : null;
  };

  EchoAlarmSettings.prototype._build = function () {
    if (!this._hass) return;
    var root = this.attachShadow({ mode: "open" });
    var tones = "";
    for (var i = 0; i < Sound.names.length; i++) tones += '<div class="tone" role="button" data-t="' + esc(Sound.names[i]) + '">' + esc(Sound.names[i]) + "</div>";
    root.innerHTML = "<style>" + SET_STYLE + (this.embedded ? SET_EMBED : "") + "</style>" +
      '<div class="bd"></div><div class="panel"><div class="hd"><h2>Timer alarm</h2><div class="done" role="button">Done</div></div>' +
      '<div class="lbl"><span>Volume</span><span class="vv"></span></div>' +
      '<div class="vrow"><ha-icon icon="mdi:volume-low"></ha-icon><div class="track"><div class="fill"></div></div><ha-icon icon="mdi:volume-high"></ha-icon></div>' +
      '<div class="lbl"><span>Tone</span></div><div class="tones">' + tones + "</div>" +
      '<div class="test" role="button"><ha-icon icon="mdi:play"></ha-icon>Test</div>' +
      '<div class="dev"></div></div>';
    this._fill = root.querySelector(".fill");
    this._vv = root.querySelector(".vv");
    var self = this;
    // Show which display this is (Kiosk Satellite app), handy for per-device setup.
    var devEl = root.querySelector(".dev");
    echoDisplayName().then(function (name) { if (name) devEl.textContent = "This display: " + name; });
    // Keep touch gestures inside this card: stops the kiosk's swipe-between-views from
    // firing while dragging sliders (and on this page generally).
    if (!this.embedded) ["touchstart", "touchmove", "touchend", "touchcancel"].forEach(function (type) {
      self.addEventListener(type, function (ev) { ev.stopPropagation(); });
    });

    root.querySelector(".bd").addEventListener("click", function () { self.close(); });
    root.querySelector(".panel").addEventListener("click", function (ev) {
      var t = ev.target.closest ? ev.target.closest(".tone,.test,.done") : null;
      if (!t) return;
      if (t.classList.contains("done")) self.close();
      else if (t.classList.contains("test")) self._test(self._tone());
      else {
        var name = t.getAttribute("data-t");
        if (self._cfg.tone_entity) self._hass.callService("input_select", "select_option", { entity_id: self._cfg.tone_entity, option: name });
        self._toneLocal = name;
        self._paint();
        self._test(name);
      }
    });
    var track = root.querySelector(".track"), drag = false;
    function setFrom(x) {
      var r = track.getBoundingClientRect();
      var f = Math.max(0, Math.min(1, (x - r.left) / r.width));
      self._vol = Math.round((10 + f * 90) / 5) * 5;
      self._paint();
    }
    function commit() {
      if (!drag) return;
      drag = false;
      if (self._cfg.volume_entity && self._vol !== null) {
        self._hass.callService("input_number", "set_value", { entity_id: self._cfg.volume_entity, value: self._vol });
      }
    }
    track.addEventListener("pointerdown", function (ev) {
      drag = true;
      try { track.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
      setFrom(ev.clientX);
      ev.preventDefault();
    });
    track.addEventListener("pointermove", function (ev) { if (drag) setFrom(ev.clientX); });
    track.addEventListener("pointerup", commit);
    track.addEventListener("pointercancel", commit);
    this._built = true;
    this._paint();
  };

  EchoAlarmSettings.prototype._volume = function () {
    if (this._vol !== null) return this._vol;
    var v = parseFloat(this._state(this._cfg.volume_entity));
    return isNaN(v) ? 70 : v;
  };

  EchoAlarmSettings.prototype._tone = function () {
    return this._toneLocal || this._state(this._cfg.tone_entity) || "Chime";
  };

  EchoAlarmSettings.prototype._paint = function () {
    if (!this._fill) return;
    var v = this._volume();
    this._fill.style.transform = "scaleX(" + ((v - 10) / 90).toFixed(3) + ")";
    this._vv.textContent = Math.round(v) + "%";
    var tone = this._tone();
    var els = this.shadowRoot.querySelectorAll(".tone");
    for (var i = 0; i < els.length; i++) {
      var on = els[i].getAttribute("data-t") === tone;
      if (on !== els[i].classList.contains("sel")) els[i].classList.toggle("sel");
    }
  };

  EchoAlarmSettings.prototype._ringing = function () {
    var st = this._hass.states, list = this._cfg.timers || [];
    for (var i = 0; i < list.length; i++) {
      var t = st[list[i]], n = st["input_text." + list[i].split(".")[1] + "_name"];
      if (t && t.state === "idle" && n && n.state && n.state !== "unknown" && n.state !== "unavailable") return true;
    }
    return false;
  };

  // Play one cycle of a tone at the alarm volume (temporarily setting the tablet's
  // volume to the alarm level when device_volume_entity is configured).
  EchoAlarmSettings.prototype._test = function (name) {
    var self = this, dv = this._cfg.device_volume_entity, h = this._hass;
    var level = this._volume();
    var cur = parseFloat(this._state(dv));
    var delay = 0;
    if (dv && !isNaN(cur) && !this._ringing()) {
      if (this._restore === null) this._restore = cur;
      if (cur !== level) { h.callService("number", "set_value", { entity_id: dv, value: level }); delay = 350; }
    }
    setTimeout(function () {
      var len = Sound.play(name, 1);
      if (self._restoreT) clearTimeout(self._restoreT);
      self._restoreT = setTimeout(function () { self._putBack(); }, (len + 0.6) * 1000);
    }, delay);
  };

  EchoAlarmSettings.prototype._putBack = function () {
    if (this._restoreT) { clearTimeout(this._restoreT); this._restoreT = null; }
    if (this._restore !== null && this._cfg.device_volume_entity && this._hass && !this._ringing()) {
      this._hass.callService("number", "set_value", { entity_id: this._cfg.device_volume_entity, value: this._restore });
    }
    this._restore = null;
  };

  EchoAlarmSettings.prototype.close = function () {
    this._putBack();
    Sound.hush();
    if (this.parentNode) this.parentNode.removeChild(this);
    if (this.onclose) this.onclose();
  };

  if (!customElements.get("echo-alarm-settings")) customElements.define("echo-alarm-settings", EchoAlarmSettings);

  // Open the popup inside a card (for a button with action: timer-settings).
  window.EchoAlarmSettingsOpen = function (card, container, settingsCfg) {
    if (card._settingsEl) return card._settingsEl;
    var el = document.createElement("echo-alarm-settings");
    el.config = settingsCfg || {};
    el.onclose = function () { card._settingsEl = null; };
    container.appendChild(el);
    el.hass = card._hass;
    card._settingsEl = el;
    return el;
  };

  // ---------- rolling wheel picker (iOS style) ----------
  // A drum of values you drag, flick, tap or scroll. Plain DOM, no custom element, so it can
  // live inside any shadow root. Seven rows are drawn; the middle one is the value.

  var WR = 3;                         // rows drawn either side of the middle
  var WTH = 21 * Math.PI / 180;       // angle between rows on the drum

  function Wheel(o) {
    this.values = o.values;
    this.n = o.values.length;
    this.loop = o.loop !== false;
    this.p = o.index || 0;            // fractional row under the middle
    this.onChange = o.onChange || null;
    this.onSpin = o.onSpin || null;
    var el = document.createElement("div");
    el.className = "wheel" + (o.cls ? " " + o.cls : "");
    this.items = [];
    for (var i = 0; i < 2 * WR + 1; i++) {
      var d = document.createElement("div");
      d.className = "wi";
      el.appendChild(d);
      this.items.push(d);
    }
    if (o.unit) {
      var u = document.createElement("div");
      u.className = "wu";
      u.textContent = o.unit;
      el.appendChild(u);
    }
    this.el = el;
    this._last = this.value();
    this._bind();
  }

  Wheel.prototype._h = function () {
    var h = this.el.clientHeight / 5;
    if (h > 0) this.H = h;
    return this.H || 48;
  };

  Wheel.prototype._mod = function (i) { return ((i % this.n) + this.n) % this.n; };

  Wheel.prototype.value = function () {
    var i = Math.round(this.p);
    return this.loop ? this._mod(i) : Math.max(0, Math.min(this.n - 1, i));
  };

  Wheel.prototype.paint = function () {
    var H = this._h(), rad = H / WTH, c = Math.round(this.p);
    for (var k = -WR; k <= WR; k++) {
      var it = this.items[k + WR], idx = c + k, d = idx - this.p, a = d * WTH;
      if ((!this.loop && (idx < 0 || idx >= this.n)) || Math.abs(a) >= Math.PI / 2) {
        it.style.visibility = "hidden";
        continue;
      }
      it.style.visibility = "";
      var txt = String(this.values[this._mod(idx)]);
      if (it.textContent !== txt) it.textContent = txt;
      it.style.height = H + "px";
      it.style.lineHeight = H + "px";
      it.style.marginTop = (-H / 2) + "px";
      it.style.transform = "translateY(" + (rad * Math.sin(a)).toFixed(2) + "px) scaleY(" + Math.cos(a).toFixed(3) + ")";
      var ad = Math.abs(d);
      it.style.opacity = (ad < 0.5 ? 1 : Math.max(0.1, 0.6 - ad * 0.13)).toFixed(2);
      var sel = ad < 0.5;
      if (sel !== it.classList.contains("sel")) it.classList.toggle("sel");
    }
    var v = this.value();
    if (v !== this._spun) { this._spun = v; if (this.onSpin) this.onSpin(v); }
  };

  // Go to a value (by index), the short way round on a looping wheel.
  Wheel.prototype.set = function (i, animate) {
    var base = Math.round(this.p), target = i;
    if (this.loop) {
      var d = i - this._mod(base);
      if (d > this.n / 2) d -= this.n;
      if (d < -this.n / 2) d += this.n;
      target = base + d;
    }
    if (animate) this._animTo(target, 320);
    else { this._stop(); this.p = target; this._last = this.value(); this.paint(); }
  };

  Wheel.prototype._stop = function () {
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
  };

  Wheel.prototype._animTo = function (target, ms) {
    var self = this, from = this.p, t0 = null;
    if (!this.loop) target = Math.max(0, Math.min(this.n - 1, target));
    this._stop();
    function step(t) {
      if (t0 === null) t0 = t;
      var f = Math.min(1, (t - t0) / ms);
      var e = 1 - Math.pow(1 - f, 3);
      self.p = from + (target - from) * e;
      self.paint();
      if (f < 1) { self._raf = requestAnimationFrame(step); return; }
      self._raf = null;
      self.p = target;
      self.paint();
      var v = self.value();
      if (v !== self._last) { self._last = v; if (self.onChange) self.onChange(v); }
    }
    this._raf = requestAnimationFrame(step);
  };

  Wheel.prototype._bind = function () {
    var self = this, el = this.el, drag = null;
    el.addEventListener("pointerdown", function (ev) {
      if (ev.button > 0) return;
      self._stop();
      drag = { y: ev.clientY, p: self.p, moved: false, s: [[Date.now(), ev.clientY]] };
      self.dragging = true;
      try { el.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
      ev.preventDefault();
      ev.stopPropagation();
    });
    el.addEventListener("pointermove", function (ev) {
      if (!drag) return;
      var dy = ev.clientY - drag.y;
      if (Math.abs(dy) > 6) drag.moved = true;
      var p = drag.p - dy / self._h();
      if (!self.loop) {             // rubber band past the ends
        if (p < 0) p = p * 0.35;
        if (p > self.n - 1) p = self.n - 1 + (p - self.n + 1) * 0.35;
      }
      self.p = p;
      self.paint();
      var now = Date.now();
      drag.s.push([now, ev.clientY]);
      while (drag.s.length > 2 && now - drag.s[0][0] > 120) drag.s.shift();
    });
    function end(ev, cancelled) {
      if (!drag) return;
      var d = drag, H = self._h();
      drag = null;
      self.dragging = false;
      if (cancelled) { self._animTo(Math.round(self.p), 200); return; }
      if (!d.moved) {
        // A tap on a row above or below the middle rolls to it.
        var r = el.getBoundingClientRect();
        var off = (ev.clientY - (r.top + r.height / 2)) / (H / WTH);
        var rows = Math.round(Math.asin(Math.max(-1, Math.min(1, off))) / WTH);
        self._animTo(Math.round(self.p) + rows, 260);
        return;
      }
      var a = d.s[0], b = d.s[d.s.length - 1], dt = Math.max(16, b[0] - a[0]);
      var v = -(b[1] - a[1]) / dt / H;      // rows per ms
      if (Date.now() - b[0] > 80) v = 0;     // held still before letting go
      var target = Math.round(self.p + v * 300);
      var ms = Math.max(240, Math.min(900, 220 + Math.abs(target - self.p) * 55));
      self._animTo(target, ms);
    }
    el.addEventListener("pointerup", function (ev) { end(ev, false); });
    el.addEventListener("pointercancel", function (ev) { end(ev, true); });
    var acc = 0;
    el.addEventListener("wheel", function (ev) {
      ev.preventDefault();
      acc += ev.deltaY;
      if (Math.abs(acc) < 30) return;
      var step = acc > 0 ? 1 : -1;
      acc = 0;
      self._animTo(Math.round(self.p) + step, 160);
    }, { passive: false });
  };

  function range(a, b, pad) {
    var out = [];
    for (var i = a; i <= b; i++) out.push(pad && i < 10 ? "0" + i : String(i));
    return out;
  }

  // ---------- Kiosk Satellite alarms ----------
  // Kiosk Satellite keeps its alarms on the tablet as Android alarm clocks: they ring with no
  // Home Assistant, network or dashboard (kiosksatellite.com/docs/alarms). The page can't reach
  // them through window.kioskSatellite, so the card asks the kiosk over Home Assistant the same
  // way Kiosk Satellite's alarm script does: it fires `kiosk_satellite_alarm` naming this
  // display, and the kiosk answers with `kiosk_satellite_alarm_result`. Changing alarms needs
  // Home Assistant; ringing never does.

  function alarmRequest(hass, kiosk, data, script) {
    var req = {
      action: data.action,
      time: data.time || "",
      days: data.days || [],
      label: data.label || "",
      kiosk: kiosk,
    };
    if (script) {
      // A script made from Kiosk Satellite's blueprint: works for non-admin dashboard users.
      return hass.callWS({ type: "call_service", domain: "script", service: String(script).replace(/^script\./, ""), service_data: req, return_response: true })
        .then(function (r) { return (r && r.response) || { ok: false, error: "no response" }; },
          function (e) { return { ok: false, error: (e && e.message) || "script failed" }; });
    }
    req.id = Date.now() + "-" + Math.floor(Math.random() * 1e6);
    return new Promise(function (resolve) {
      var done = false, unsub = null;
      var timer = setTimeout(function () { finish({ ok: false, error: "timeout" }); }, 8000);
      function finish(r) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (unsub) { try { var u = unsub(); if (u && u.catch) u.catch(function () {}); } catch (e) { /* ignore */ } }
        resolve(r);
      }
      hass.connection.subscribeEvents(function (ev) {
        if (ev && ev.data && ev.data.id === req.id) finish(ev.data);
      }, "kiosk_satellite_alarm_result").then(function (u) {
        unsub = u;
        if (done) { finish({}); return; }
        return hass.callWS({ type: "fire_event", event_type: "kiosk_satellite_alarm", event_data: req });
      }).catch(function (e) {
        finish({ ok: false, refused: true, error: (e && e.message) || "refused" });
      });
    });
  }

  var DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  var DAY_SHORT = { sun: "Sun", mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat" };
  var DAY_LETTER = ["S", "M", "T", "W", "T", "F", "S"];

  function daysOf(a) { return a && a.days && a.days !== "once" && a.days.length ? a.days : []; }

  function daysText(days) {
    if (!days.length) return "";
    var set = {};
    days.forEach(function (d) { set[d] = 1; });
    var n = days.length;
    if (n === 7) return "Every day";
    if (n === 5 && !set.sat && !set.sun) return "Weekdays";
    if (n === 2 && set.sat && set.sun) return "Weekends";
    return DAY_KEYS.filter(function (d) { return set[d]; }).map(function (d) { return DAY_SHORT[d]; }).join(" ");
  }

  // "Monday 2026-10-05 06:30" (the kiosk's local time) -> ms
  function parseNextRing(s) {
    var m = /(\d{4})-(\d{2})-(\d{2})\D+(\d{1,2}):(\d{2})/.exec(s || "");
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime() : 0;
  }

  function fmtIn(ms) {
    var min = Math.max(1, Math.round(ms / 60000));
    if (min < 60) return "in " + min + " min";
    var h = Math.floor(min / 60), m = min % 60;
    if (h < 24) return "in " + h + " hr" + (m ? " " + m + " min" : "");
    var dd = Math.round(h / 24);
    return "in " + dd + " day" + (dd > 1 ? "s" : "");
  }

  function dayWord(ts) {
    var d = new Date(ts), t = new Date();
    var a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    var b = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
    var diff = Math.round((a - b) / 86400000);
    if (diff === 0) return "Today";
    if (diff === 1) return "Tomorrow";
    return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][d.getDay()];
  }

  // ---------- recently used timer lengths (per display) ----------

  var REC_KEY = "echo-timer-recents";
  function recentsLoad() {
    try {
      var r = JSON.parse(window.localStorage.getItem(REC_KEY) || "[]");
      return r && r.filter ? r.filter(function (x) { return typeof x === "number" && x > 0; }) : [];
    } catch (e) { return []; }
  }
  function recentsAdd(secs) {
    var r = recentsLoad().filter(function (x) { return x !== secs; });
    r.unshift(secs);
    try { window.localStorage.setItem(REC_KEY, JSON.stringify(r.slice(0, 8))); } catch (e) { /* ignore */ }
  }
  // 90 -> "1 min 30 sec", 3600 -> "1 hr", 45 -> "45 sec"
  function fmtLen(sec) {
    var h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60, out = [];
    if (h) out.push(h + " hr");
    if (m) out.push(m + " min");
    if (s) out.push(s + " sec");
    return out.slice(0, 2).join(" ") || "0 sec";
  }

  // ---------- stopwatch state (per display, survives page changes and reloads) ----------

  var SW_KEY = "echo-stopwatch";
  function swLoad() {
    try {
      var s = JSON.parse(window.localStorage.getItem(SW_KEY) || "null");
      if (s && typeof s.acc === "number" && s.laps && s.laps.length !== undefined) return s;
    } catch (e) { /* storage unavailable */ }
    return { start: null, acc: 0, laps: [] };
  }
  function swSave(s) {
    try { window.localStorage.setItem(SW_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
  }
  function swElapsed(s) { return s.acc + (s.start ? Date.now() - s.start : 0); }
  function fmtSw(ms) {
    ms = Math.max(0, Math.floor(ms));
    var cs = Math.floor(ms / 10) % 100, sec = Math.floor(ms / 1000), h = Math.floor(sec / 3600);
    var m = Math.floor(sec / 60) % 60, s = sec % 60;
    var t = (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s + "." + (cs < 10 ? "0" : "") + cs;
    return h ? h + ":" + t : t;
  }

  // ---------- card styles ----------

  var STYLE = [
    ":host{display:block;height:100vh;width:100%;overflow:hidden;font-family:var(--es-font,var(--ha-font-family-body,Roboto,'Helvetica Neue',Arial,sans-serif));color:#fff;-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none;}",
    ".root{position:relative;height:100vh;width:100%;overflow:hidden;box-sizing:border-box;background:var(--es-bg,radial-gradient(110% 90% at 0% 0%,#223567 0%,rgba(34,53,103,0) 60%),radial-gradient(90% 80% at 100% 100%,#0d3b4f 0%,rgba(13,59,79,0) 60%),#0a1022);}",
    ".content{position:relative;height:100vh;box-sizing:border-box;padding:2vh 2.5vh 2vh 2.5vh;display:flex;flex-direction:column;}",
    "ha-icon{display:inline-flex;}",
    /* top bar: segmented control in the middle, a context button on the right */
    ".top{flex:0 0 auto;display:flex;align-items:center;justify-content:center;position:relative;height:8vh;margin-bottom:1.6vh;}",
    ".seg{display:flex;padding:.6vh;border-radius:3.4vh;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.08);}",
    ".sg{position:relative;min-width:21vh;height:6.4vh;padding:0 2.6vh;border-radius:2.8vh;display:flex;align-items:center;justify-content:center;font-size:3vh;color:rgba(255,255,255,.66);cursor:pointer;box-sizing:border-box;}",
    ".sg ha-icon{--mdc-icon-size:3.2vh;width:3.2vh;height:3.2vh;margin-right:1vh;}",
    ".sg.sel{background:rgba(255,255,255,.16);color:#fff;box-shadow:0 .3vh 1vh rgba(0,0,0,.25);}",
    ".sg .bdg{position:absolute;top:1vh;right:1.4vh;width:1.2vh;height:1.2vh;border-radius:50%;background:var(--es-acc,#ff9f0a);display:none;}",
    ".sg .bdg.on{display:block;}.sg .bdg.red{background:#ff453a;}",
    ".tb{position:absolute;right:0;top:0;width:8vh;height:8vh;border-radius:50%;display:none;align-items:center;justify-content:center;cursor:pointer;background:rgba(var(--es-acc-rgb,255,159,10),.2);border:1px solid rgba(var(--es-acc-rgb,255,159,10),.5);color:var(--es-hi2,#ffc266);}",
    ".tb ha-icon{--mdc-icon-size:4.6vh;width:4.6vh;height:4.6vh;}",
    ".root[data-tab=alarms] .tb.add-alarm{display:flex;}",
    ".tb:active,.sg:active{transform:scale(.95);}",
    /* panes */
    ".pane{position:relative;flex:1 1 auto;min-height:0;display:none;}",
    ".root[data-tab=alarms] .p-alarms,.root[data-tab=stopwatch] .p-sw,.root[data-tab=timers] .p-timers{display:flex;}",
    /* ===== wheels ===== */
    ".wheels{position:relative;display:flex;justify-content:center;align-items:center;gap:1vh;}",
    ".wheels::before{content:'';position:absolute;left:0;right:0;top:50%;height:var(--wrow,6.6vh);margin-top:calc(var(--wrow,6.6vh) / -2);border-radius:1.8vh;background:rgba(255,255,255,.1);pointer-events:none;}",
    ".wheel{position:relative;height:calc(var(--wrow,6.6vh) * 5);width:var(--ww,13vh);touch-action:none;cursor:ns-resize;overflow:hidden;" +
      "-webkit-mask-image:linear-gradient(180deg,transparent 0,#000 30%,#000 70%,transparent 100%);mask-image:linear-gradient(180deg,transparent 0,#000 30%,#000 70%,transparent 100%);}",
    ".wi{position:absolute;left:0;right:0;top:50%;text-align:center;font-size:var(--wfs,4.4vh);font-variant-numeric:tabular-nums;color:rgba(255,255,255,.9);will-change:transform;}",
    ".wi.sel{color:#fff;}",
    ".wheel.unitd .wi{text-align:right;padding-right:calc(var(--ww,13vh) * .5);box-sizing:border-box;}",
    ".wu{position:absolute;top:50%;left:56%;transform:translateY(-50%);font-size:calc(var(--wfs,4.4vh) * .5);font-weight:500;color:rgba(255,255,255,.9);pointer-events:none;white-space:nowrap;}",
    ".wheel.hrs{width:calc(var(--ww,13vh) * 1.2);}",
    ".wheel.hrs.unitd .wi{padding-right:calc(var(--ww,13vh) * .62);}",
    ".wheel.hrs .wu{left:52%;}",
    ".wheel.ampm{width:11vh;}",
    /* ===== timers (HA timer helpers) ===== */
    ".main{position:relative;flex:1 1 auto;min-height:0;display:flex;align-items:stretch;gap:2vh;width:100%;}",
    ".main.solo .tile{background:none;border-color:transparent;box-shadow:none;}",
    ".main.solo .tile.done::before{border-radius:3.6vh;}",
    ".corner{position:absolute;top:-9.6vh;right:0;z-index:3;width:8vh;height:8vh;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;" +
      "background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.14);color:rgba(255,255,255,.92);}",
    ".corner.plus{background:rgba(var(--es-acc-rgb,255,159,10),.2);border-color:rgba(var(--es-acc-rgb,255,159,10),.5);color:var(--es-hi2,#ffc266);}",
    ".corner ha-icon{--mdc-icon-size:4.6vh;width:4.6vh;height:4.6vh;}",
    ".corner:active{transform:scale(.92);}",
    ".tile{position:relative;flex:1 1 0;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:space-between;box-sizing:border-box;padding:2vh 2vh 2.2vh;border-radius:3.6vh;overflow:hidden;" +
      "background:linear-gradient(180deg,rgba(255,255,255,.075),rgba(255,255,255,.03));border:1px solid rgba(255,255,255,.09);box-shadow:inset 0 1px 0 rgba(255,255,255,.06);}",
    ".tile::before{content:'';position:absolute;left:0;top:0;right:0;bottom:0;border-radius:inherit;background:linear-gradient(180deg,rgba(255,69,58,.32),rgba(255,69,58,.1));opacity:0;pointer-events:none;}",
    ".tile.done{border-color:rgba(255,99,88,.6);}",
    ".tile.done::before{animation:etc-glow 1.4s ease-in-out infinite;}",
    "@keyframes etc-glow{0%,100%{opacity:.35;}50%{opacity:1;}}",
    ".tile > *{position:relative;}",
    ".head{display:flex;align-items:center;justify-content:center;gap:1.2vh;max-width:100%;font-size:3.6vh;line-height:1.1;letter-spacing:.01em;}",
    ".head .nm{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
    ".head .dot{flex:0 0 auto;width:1.4vh;height:1.4vh;border-radius:50%;background:var(--es-acc,#ff9f0a);box-shadow:0 0 1.2vh rgba(var(--es-acc-rgb,255,159,10),.8);}",
    ".paused .head .dot{background:rgba(255,255,255,.45);box-shadow:none;}",
    ".done .head .dot{background:#ff453a;box-shadow:0 0 1.2vh rgba(255,69,58,.9);}",
    ".cap{font-size:2.6vh;letter-spacing:.12em;text-transform:uppercase;opacity:.55;}",
    ".ring{position:relative;width:var(--ring,40vh);height:var(--ring,40vh);cursor:pointer;}",
    ".ring > svg{position:absolute;left:0;top:0;width:100%;height:100%;}",
    ".ring .trk{fill:none;stroke:rgba(255,255,255,.08);stroke-width:3.2;}",
    ".ring .arc{fill:none;stroke-width:3.2;stroke-linecap:round;}",
    ".paused .ring .arc{opacity:.45;}",
    ".done .ring{animation:etc-pulse 1.4s ease-in-out infinite;}",
    "@keyframes etc-pulse{0%,100%{transform:scale(1);}50%{transform:scale(1.03);}}",
    ".ring .mid{position:absolute;left:0;top:0;right:0;bottom:0;display:flex;flex-direction:column;align-items:center;justify-content:center;}",
    ".clock{font-size:var(--clock,10vh);font-weight:300;line-height:1;font-variant-numeric:tabular-nums;letter-spacing:-.02em;}",
    ".clock.long{font-size:calc(var(--clock,10vh) * .78);}",
    ".sub{font-size:2.6vh;opacity:.6;margin-top:1.4vh;display:flex;align-items:center;white-space:nowrap;}",
    ".sub ha-icon{--mdc-icon-size:2.6vh;width:2.6vh;height:2.6vh;margin-right:.6vh;}",
    ".done .clock{animation:etc-blink 1s steps(1) infinite;color:#ff7a70;}",
    "@keyframes etc-blink{50%{opacity:.25;}}",
    ".ctl{display:flex;gap:2.6vh;align-items:center;}",
    ".rb{width:9.6vh;height:9.6vh;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.08);}",
    ".rb ha-icon{--mdc-icon-size:4.8vh;width:4.8vh;height:4.8vh;}",
    ".rb.pause{background:rgba(var(--es-acc-rgb,255,159,10),.18);border-color:rgba(var(--es-acc-rgb,255,159,10),.35);color:var(--es-hi,#ffb340);}",
    ".rb.play{background:rgba(52,199,89,.18);border-color:rgba(52,199,89,.4);color:#5ee07f;}",
    ".rb:active,.chip:active,.go:active,.btn:active,.wide:active,.circ:active,.arow:active,.sbtn:active,.dchip:active,.abtn:active{transform:scale(.95);}",
    ".wide{height:9.6vh;border-radius:4.8vh;padding:0 3.6vh;display:flex;align-items:center;justify-content:center;font-size:3.4vh;cursor:pointer;white-space:nowrap;}",
    ".wide.dismiss{background:linear-gradient(180deg,#ff6259,#e5362c);box-shadow:0 .8vh 2.4vh rgba(255,69,58,.35);}",
    ".wide.more,.wide.cancel{background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.1);}",
    ".wide.apply{background:linear-gradient(180deg,var(--es-acc1,#ffab2e),var(--es-acc2,#ff8a00));color:var(--es-on-acc,#1a1000);}",
    ".adj .delta{font-size:3.2vh;margin-top:1.2vh;padding:.6vh 2vh;border-radius:2.4vh;background:rgba(255,255,255,.08);}",
    ".adj .delta.up{background:rgba(52,199,89,.2);color:#7ff09a;}",
    ".adj .delta.down{background:rgba(255,69,58,.2);color:#ff8f87;}",
    ".adj .big{font-size:var(--clock,10vh);font-weight:300;line-height:1;font-variant-numeric:tabular-nums;}",
    ".adj .mid2{display:flex;flex-direction:column;align-items:center;}",
    ".atrack{position:relative;width:100%;height:9vh;border-radius:4.5vh;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.09);touch-action:none;cursor:ew-resize;overflow:hidden;}",
    ".atrack .afill{position:absolute;top:0;bottom:0;left:50%;width:0;}",
    ".atrack .afill.up{background:linear-gradient(90deg,rgba(52,199,89,.15),rgba(52,199,89,.55));}",
    ".atrack .afill.down{background:linear-gradient(270deg,rgba(255,69,58,.15),rgba(255,69,58,.55));}",
    ".atrack .zero{position:absolute;left:50%;top:1.6vh;bottom:1.6vh;width:2px;margin-left:-1px;background:rgba(255,255,255,.35);}",
    ".atrack .knob{position:absolute;top:50%;left:50%;width:6.4vh;height:6.4vh;margin:-3.2vh 0 0 -3.2vh;border-radius:50%;background:#fff;box-shadow:0 .4vh 1.4vh rgba(0,0,0,.4);}",
    ".atrack .lm,.atrack .lp{position:absolute;top:0;bottom:0;display:flex;align-items:center;font-size:4vh;opacity:.55;}",
    ".atrack .lm{left:2.4vh;}.atrack .lp{right:2.4vh;}",
    ".ahint{font-size:2.5vh;opacity:.5;margin-top:1vh;}",
    ".awrap{width:100%;display:flex;flex-direction:column;align-items:center;}",
    /* new timer: wheels + quick picks + start */
    ".chips{display:flex;flex-wrap:wrap;justify-content:center;gap:1.2vh;max-width:100%;}",
    ".recents{display:flex;flex-direction:column;align-items:center;gap:1vh;max-width:100%;}",
    ".rlbl{font-size:2.1vh;letter-spacing:.12em;text-transform:uppercase;opacity:.45;}",
    ".chip{height:6.4vh;min-width:10vh;padding:0 1.8vh;box-sizing:border-box;border-radius:3.2vh;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.09);display:flex;align-items:center;justify-content:center;font-size:2.7vh;cursor:pointer;white-space:nowrap;}",
    ".chip.sel{background:rgba(var(--es-acc-rgb,255,159,10),.2);border-color:rgba(var(--es-acc-rgb,255,159,10),.65);color:var(--es-hi2,#ffc266);}",
    ".go{height:9vh;border-radius:4.5vh;background:linear-gradient(180deg,#3ad16a,#27a84f);box-shadow:0 .8vh 2.4vh rgba(39,168,79,.3);display:flex;align-items:center;justify-content:center;font-size:3.6vh;cursor:pointer;width:var(--gow,46vh);max-width:94%;}",
    ".go.off{opacity:.35;pointer-events:none;}",
    ".go ha-icon{--mdc-icon-size:4.4vh;width:4.4vh;height:4.4vh;margin-right:1.2vh;}",
    /* ===== stopwatch ===== */
    ".p-sw{gap:3vh;}",
    ".swl{flex:1.25 1 0;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6vh;}",
    ".swd{font-size:17vh;font-weight:200;line-height:1;font-variant-numeric:tabular-nums;letter-spacing:-.01em;white-space:nowrap;}",
    ".swd.long{font-size:13.5vh;}",
    ".swb{display:flex;justify-content:space-between;width:min(92%,66vh);}",
    ".circ{width:17vh;height:17vh;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:3.4vh;cursor:pointer;box-sizing:border-box;" +
      "box-shadow:0 0 0 .5vh rgba(0,0,0,.35),0 0 0 .8vh currentColor;}",
    ".circ.grey{background:rgba(255,255,255,.16);color:rgba(255,255,255,.95);}",
    ".circ.grey.off{opacity:.4;pointer-events:none;}",
    ".circ.green{background:rgba(48,209,88,.24);color:#4cd964;}",
    ".circ.red{background:rgba(255,69,58,.26);color:#ff6961;}",
    ".swr{flex:1 1 0;min-width:0;display:flex;flex-direction:column;border-radius:3.6vh;background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.025));border:1px solid rgba(255,255,255,.08);overflow:hidden;}",
    ".swr .lh{flex:0 0 auto;padding:2.2vh 3vh 1.2vh;font-size:2.4vh;letter-spacing:.12em;text-transform:uppercase;opacity:.5;}",
    ".laps{flex:1 1 auto;overflow-y:auto;padding:0 3vh 2vh;touch-action:pan-y;-webkit-overflow-scrolling:touch;}",
    ".lap{display:flex;justify-content:space-between;align-items:center;height:7vh;border-top:1px solid rgba(255,255,255,.08);font-size:3.2vh;font-variant-numeric:tabular-nums;}",
    ".lap:first-child{border-top:none;}",
    ".lap.best{color:#4cd964;}.lap.worst{color:#ff6961;}",
    ".lap .ln{opacity:.85;}",
    ".lapnone{height:100%;display:flex;align-items:center;justify-content:center;font-size:2.8vh;opacity:.35;text-align:center;}",
    /* ===== alarms ===== */
    ".p-alarms{flex-direction:column;}",
    ".anext{flex:0 0 auto;display:flex;align-items:center;gap:1.4vh;font-size:3vh;margin:0 .4vh 1.6vh;min-height:4vh;color:rgba(255,255,255,.75);}",
    ".anext ha-icon{--mdc-icon-size:3.6vh;width:3.6vh;height:3.6vh;color:var(--es-hi,#ffb340);}",
    ".anext b{font-weight:500;color:#fff;}",
    ".anext .off{margin-left:auto;display:flex;align-items:center;gap:.8vh;font-size:2.4vh;color:rgba(255,255,255,.5);}",
    ".anext .off ha-icon{--mdc-icon-size:2.8vh;width:2.8vh;height:2.8vh;color:rgba(255,255,255,.5);}",
    ".aring{flex:0 0 auto;display:none;align-items:center;gap:2vh;padding:2vh 2.6vh;margin-bottom:1.6vh;border-radius:3vh;background:linear-gradient(90deg,rgba(255,69,58,.35),rgba(255,69,58,.15));border:1px solid rgba(255,99,88,.6);}",
    ".aring.on{display:flex;}",
    ".aring .at{flex:1 1 auto;font-size:3.4vh;}",
    ".aring ha-icon{--mdc-icon-size:5vh;width:5vh;height:5vh;animation:etc-blink 1s steps(1) infinite;}",
    ".abtn{height:8vh;padding:0 3.4vh;border-radius:4vh;display:flex;align-items:center;font-size:3vh;cursor:pointer;background:rgba(255,255,255,.16);}",
    ".abtn.stop{background:#fff;color:#c4271d;font-weight:500;}",
    ".alist{flex:1 1 auto;min-height:0;overflow-y:auto;touch-action:pan-y;-webkit-overflow-scrolling:touch;display:grid;grid-template-columns:1fr 1fr;grid-auto-rows:min-content;gap:1.6vh;align-content:start;}",
    ".alist.one{grid-template-columns:1fr;}",
    ".arow{display:flex;align-items:center;gap:2vh;padding:2vh 2.8vh;border-radius:3vh;cursor:pointer;background:linear-gradient(180deg,rgba(255,255,255,.075),rgba(255,255,255,.03));border:1px solid rgba(255,255,255,.09);}",
    ".arow .ab{flex:1 1 auto;min-width:0;}",
    ".arow .tm{font-size:9vh;font-weight:300;line-height:1;font-variant-numeric:tabular-nums;letter-spacing:-.02em;}",
    ".arow .tm small{font-size:3.4vh;font-weight:400;margin-left:.8vh;letter-spacing:0;}",
    ".arow .lb{font-size:2.7vh;margin-top:.8vh;opacity:.75;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
    ".arow.off .tm,.arow.off .lb{opacity:.38;}",
    ".arow.busy{opacity:.6;pointer-events:none;}",
    ".sw{flex:0 0 auto;position:relative;width:11.6vh;height:7vh;border-radius:3.5vh;background:rgba(255,255,255,.18);transition:background .2s;cursor:pointer;}",
    ".sw::after{content:'';position:absolute;top:.6vh;left:.6vh;width:5.8vh;height:5.8vh;border-radius:50%;background:#fff;box-shadow:0 .3vh .8vh rgba(0,0,0,.35);transition:transform .2s;}",
    ".sw.on{background:#34c759;}",
    ".sw.on::after{transform:translateX(4.6vh);}",
    ".aempty{grid-column:1 / -1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1.6vh;padding-top:9vh;text-align:center;font-size:3vh;color:rgba(255,255,255,.55);}",
    ".aempty ha-icon{--mdc-icon-size:12vh;width:12vh;height:12vh;opacity:.4;}",
    ".aempty b{font-size:4vh;font-weight:400;color:rgba(255,255,255,.85);}",
    ".aempty .msg{max-width:80vh;line-height:1.35;}",
    ".aempty .retry{margin-top:1vh;height:7vh;padding:0 3.4vh;border-radius:3.5vh;display:flex;align-items:center;background:rgba(255,255,255,.12);color:#fff;cursor:pointer;}",
    ".afoot{flex:0 0 auto;margin-top:1.4vh;display:flex;align-items:center;justify-content:center;gap:1vh;font-size:2.3vh;color:rgba(255,255,255,.45);}",
    ".afoot ha-icon{--mdc-icon-size:2.6vh;width:2.6vh;height:2.6vh;}",
    /* alarm editor sheet */
    ".sheet{position:absolute;left:0;top:0;right:0;bottom:0;z-index:30;display:flex;align-items:center;justify-content:center;background:rgba(3,6,14,.62);}",
    ".sbox{width:90vw;max-height:92vh;box-sizing:border-box;display:flex;flex-direction:column;background:linear-gradient(180deg,var(--es-pan1,#1c2540),var(--es-pan2,#141b30));border:1px solid rgba(255,255,255,.1);border-radius:3.4vh;box-shadow:0 20px 60px rgba(0,0,0,.6);overflow:hidden;}",
    ".shd{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;padding:2.4vh 2.8vh 1vh;}",
    ".shd h2{margin:0;font-size:3.8vh;font-weight:500;}",
    ".sbtn{font-size:3.2vh;padding:1.4vh 2.6vh;border-radius:3.2vh;cursor:pointer;color:var(--es-hi,#ffb340);justify-self:start;}",
    ".sbtn.save{justify-self:end;background:linear-gradient(180deg,var(--es-acc1,#ffab2e),var(--es-acc2,#ff8a00));color:var(--es-on-acc,#1a1000);font-weight:500;padding:1.4vh 3.6vh;}",
    ".sbtn.wait{opacity:.5;pointer-events:none;}",
    ".sbody{display:flex;gap:4vh;padding:1vh 3.4vh 3vh;align-items:center;}",
    ".sbody .wheels{flex:0 0 auto;--ww:14vh;--wrow:7.6vh;--wfs:5.4vh;padding:0 1vh;}",
    ".sopts{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2.6vh;}",
    ".olbl{font-size:2.3vh;letter-spacing:.1em;text-transform:uppercase;opacity:.55;margin-bottom:1.2vh;}",
    ".days{display:flex;gap:1.1vh;}",
    ".dchip{width:7.4vh;height:7.4vh;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:3vh;cursor:pointer;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.1);}",
    ".dchip.on{background:var(--es-acc,#ff9f0a);border-color:transparent;color:var(--es-on-acc,#1a1000);font-weight:500;}",
    ".qdays{display:flex;gap:1.1vh;margin-top:1.2vh;}",
    ".qdays .chip{height:5.6vh;font-size:2.4vh;min-width:0;}",
    ".lin{width:100%;box-sizing:border-box;height:8vh;border-radius:2vh;border:1px solid rgba(255,255,255,.14);background:rgba(0,0,0,.2);color:#fff;font:inherit;font-size:3.2vh;padding:0 2.2vh;outline:none;-webkit-user-select:text;user-select:text;}",
    ".lin:focus{border-color:rgba(var(--es-acc-rgb,255,159,10),.7);}",
    ".srow{display:flex;align-items:center;gap:2vh;}",
    ".sdel{height:7.4vh;padding:0 3vh;border-radius:3.7vh;display:flex;align-items:center;gap:1vh;font-size:3vh;cursor:pointer;color:#ff6961;background:rgba(255,69,58,.12);}",
    ".sdel ha-icon{--mdc-icon-size:3.4vh;width:3.4vh;height:3.4vh;}",
    ".snote{font-size:2.3vh;line-height:1.35;opacity:.5;}",
    ".serr{font-size:2.6vh;color:#ff8f87;min-height:3vh;}",
    /* toast */
    ".toast{position:absolute;left:50%;bottom:17vh;z-index:40;transform:translate(-50%,2vh);max-width:80vw;padding:2vh 3.2vh;border-radius:2.4vh;background:rgba(20,24,38,.96);border:1px solid rgba(255,255,255,.14);font-size:2.8vh;line-height:1.3;opacity:0;pointer-events:none;transition:opacity .25s,transform .25s;box-shadow:0 1vh 3vh rgba(0,0,0,.5);}",
    ".toast.on{opacity:1;transform:translate(-50%,0);}",
    /* bottom buttons (same look as echo-weather-card) */
    ".btns{display:flex;gap:1.5vh;margin-top:2vh;height:9vh;flex:0 0 auto;}",
    ".btn{flex:1 1 0;border-radius:1.6vh;background:rgba(255,255,255,.1);display:flex;align-items:center;justify-content:center;cursor:pointer;}",
    ".btn.active{background:rgba(255,255,255,.24);}",
    ".btn ha-icon{--mdc-icon-size:5vh;width:5vh;height:5vh;color:rgba(255,255,255,.9);}",
  ].join("");

  var TABS = [
    { id: "alarms", icon: "mdi:alarm", label: "Alarms" },
    { id: "stopwatch", icon: "mdi:timer-outline", label: "Stopwatch" },
    { id: "timers", icon: "mdi:timer-sand", label: "Timers" },
  ];

  // ---------- the card ----------

  function initCard(self) {
    self._hass = null;
    self._config = null;
    self._sig = "";
    self._tick = null;
    self._pending = {};
    self._adj = null;                       // { slot, delta } while a timer is being adjusted
    self._tw = { h: 0, m: 5, s: 0 };        // the new-timer wheels
    self._sw = swLoad();
    self._alarms = null;                    // last list from the kiosk
    self._alarmBusy = {};
    self._aq = Promise.resolve();
    // Keep touch gestures inside this card: stops the kiosk's swipe-between-views from
    // firing while spinning wheels and dragging sliders.
    ["touchstart", "touchmove", "touchend", "touchcancel"].forEach(function (type) {
      self.addEventListener(type, function (ev) { if (!self._config || self._config.block_swipe !== false) ev.stopPropagation(); });
    });
  }

  function EchoClockCard() {
    var self = Reflect.construct(HTMLElement, [], new.target || EchoClockCard);
    initCard(self);
    return self;
  }
  EchoClockCard.prototype = Object.create(HTMLElement.prototype);
  EchoClockCard.prototype.constructor = EchoClockCard;
  Object.setPrototypeOf(EchoClockCard, HTMLElement);

  EchoClockCard.prototype.setConfig = function (config) {
    this._raw = config || {};
    this._applyProfile(null);
    var self = this;
    echoDisplayName().then(function (name) {
      self._display = name;
      var prof = matchDisplay(self._raw.devices, name);
      if (prof) {
        self._applyProfile(prof);
        self._sig = "";
        if (self._built && self._hass) self._update();
      }
      if (self._built) self._alarmsShow();
    });
  };

  EchoClockCard.prototype._applyProfile = function (prof) {
    var config = {}, k;
    for (k in this._raw) config[k] = this._raw[k];
    if (prof) for (k in prof) if (k !== "match") config[k] = prof[k];
    var prefix = config.timer_prefix || "echo_timer";
    var slots = config.slots;
    if (!slots) {
      slots = [];
      for (var i = 1; i <= 3; i++) slots.push({ timer: "timer." + prefix + "_" + i, name: "input_text." + prefix + "_" + i + "_name" });
    }
    this._config = {
      timer_prefix: prefix,
      slots: slots,
      start_script: config.start_script || "script.echo_timer_start",
      cancel_script: config.cancel_script || "script.echo_timer_cancel",
      presets: config.presets || DEFAULT_PRESETS,
      buttons: config.buttons || [],
      alarm: config.alarm !== false,                 // sound the timer alarm in this browser
      tone_entity: config.tone_entity || "input_select.echo_timer_alarm_tone",
      satellite: config.satellite || null,           // assist_satellite.*: timer alarm pauses while it listens
      idle_timeout: config.idle_timeout !== undefined ? config.idle_timeout : 180,
      idle_path: config.idle_path || null,
      settings: config.settings || {},
      block_swipe: config.block_swipe !== false,
      tap_sound: !!config.tap_sound,
      tabs: config.tabs || ["alarms", "stopwatch", "timers"],
      default_tab: config.default_tab || null,
      alarms: config.alarms !== false,               // Kiosk Satellite alarms tab
      kiosk: config.kiosk || null,                   // Kiosk Satellite device name (default: this display's)
      alarm_script: config.alarm_script || null,     // script from Kiosk Satellite's alarms blueprint
      time_format: config.time_format || null,       // "12" or "24" (default: HA profile)
    };
    if (!this._config.alarms) this._config.tabs = this._config.tabs.filter(function (t) { return t !== "alarms"; });
  };

  EchoClockCard.prototype.getCardSize = function () { return 12; };

  Object.defineProperty(EchoClockCard.prototype, "hass", {
    set: function (hass) {
      var first = !this._hass;
      this._hass = hass;
      if (!this._config) return;
      if (!this._built) { this._build(); this._startIdle(); }
      this._update();
      this._alarmState();
      if (first) { this._alarmsShow(); this._subscribeAlarmEvents(); }
      if (this._settingsEl) this._settingsEl.hass = hass;
    },
    get: function () { return this._hass; },
  });

  EchoClockCard.prototype.connectedCallback = function () {
    this._sw = swLoad();                 // another page may have used it
    if (this._built) {
      this._pickTabOnShow();
      this._update();
      this._paintSw();
      this._alarmsShow();
    }
    this._startIdle();
    this._subscribeAlarmEvents();
  };

  EchoClockCard.prototype.disconnectedCallback = function () {
    this._stopTick();
    this._alarmStop();
    this._stopIdle();
    this._swStopRaf();
    this._closeSheet();
    if (this._alarmUnsub) {
      var u = this._alarmUnsub; this._alarmUnsub = null;
      u.then(function (f) { if (f) { var r = f(); if (r && r.catch) r.catch(function () {}); } }, function () {});
    }
    if (this._adj) { this._adj = null; this._sig = ""; }
    if (this._settingsEl) this._settingsEl.close();
  };

  // ---------- timer alarm loop ----------

  var VOICE_BUSY = { listening: 1, processing: 1, responding: 1 };

  EchoClockCard.prototype._voiceBusy = function () {
    var sat = this._config.satellite && this._hass ? this._hass.states[this._config.satellite] : null;
    if (sat && VOICE_BUSY[sat.state]) return true;
    return !!(this._voiceHold && Date.now() < this._voiceHold);
  };

  EchoClockCard.prototype._alarmCycle = function () {
    var self = this;
    if (!this._alarmOn) return;
    var tone = this._hass && this._hass.states[this._config.tone_entity] ? this._hass.states[this._config.tone_entity].state : "Chime";
    var len = Sound.cycle(tone);
    if (!this._voiceBusy()) len = Sound.play(tone, 1) || len;
    this._alarmTimer = setTimeout(function () { self._alarmCycle(); }, len * 1000);
  };

  EchoClockCard.prototype._alarmStart = function () {
    if (this._alarmOn || !this._config.alarm) return;
    this._alarmOn = true;
    this._alarmCycle();
  };

  EchoClockCard.prototype._alarmStop = function () {
    if (!this._alarmOn) return;
    this._alarmOn = false;
    if (this._alarmTimer) { clearTimeout(this._alarmTimer); this._alarmTimer = null; }
    Sound.hush();
  };

  // ---------- go back to the home view after a period without touches ----------
  // Not while a timer exists, the stopwatch runs or the alarm editor is open.

  EchoClockCard.prototype._touch = function () { this._lastAct = Date.now(); };

  EchoClockCard.prototype._startIdle = function () {
    var self = this;
    this._touch();
    if (this._idleT || !this._config || !this._config.idle_timeout || !this._config.idle_path) return;
    this._idleT = setInterval(function () {
      var busy = (self._items && self._items.length) || self._settingsEl || self._adj || self._sheet || self._sw.start;
      if (busy) { self._touch(); return; }
      if (Date.now() - self._lastAct >= self._config.idle_timeout * 1000) {
        self._touch();
        navigate(self._config.idle_path);
      }
    }, 5000);
  };

  EchoClockCard.prototype._stopIdle = function () {
    if (this._idleT) { clearInterval(this._idleT); this._idleT = null; }
  };

  // ---------- DOM ----------

  EchoClockCard.prototype._build = function () {
    var root = this.shadowRoot || this.attachShadow({ mode: "open" });
    var cfg = this._config, buttons = cfg.buttons;
    var btnHtml = "";
    for (var i = 0; i < buttons.length; i++) {
      btnHtml += '<div class="btn' + (buttons[i].active ? " active" : "") + '" role="button" data-i="' + i + '"><ha-icon icon="' + esc(buttons[i].icon || "mdi:help") + '"></ha-icon></div>';
    }
    var seg = "";
    TABS.forEach(function (t) {
      if (cfg.tabs.indexOf(t.id) === -1) return;
      seg += '<div class="sg" role="button" data-tab="' + t.id + '"><ha-icon icon="' + t.icon + '"></ha-icon>' + t.label + '<span class="bdg"></span></div>';
    });
    root.innerHTML = "<style>" + STYLE + "</style>" +
      '<div class="root"><div class="content">' +
      '<div class="top">' + (cfg.tabs.length > 1 ? '<div class="seg">' + seg + "</div>" : "") +
      '<div class="tb add-alarm" role="button"><ha-icon icon="mdi:plus"></ha-icon></div></div>' +
      '<div class="pane p-alarms"><div class="anext"></div><div class="aring"></div><div class="alist"></div>' +
      '<div class="afoot"><ha-icon icon="mdi:shield-check-outline"></ha-icon>Alarms ring from this display’s own clock, even when Home Assistant or Wi-Fi is down.</div></div>' +
      '<div class="pane p-sw"><div class="swl"><div class="swd">00:00.00</div><div class="swb">' +
      '<div class="circ grey" role="button" data-sw="left">Lap</div><div class="circ green" role="button" data-sw="right">Start</div></div></div>' +
      '<div class="swr"><div class="lh">Laps</div><div class="laps"></div></div></div>' +
      '<div class="pane p-timers"><div class="main"></div></div>' +
      (buttons.length ? '<div class="btns">' + btnHtml + "</div>" : "") +
      '</div><div class="toast"></div></div>';
    this._rootEl = root.querySelector(".root");
    this._mainEl = root.querySelector(".main");
    this._toastEl = root.querySelector(".toast");
    this._swD = root.querySelector(".swd");
    this._lapsEl = root.querySelector(".laps");
    this._aNext = root.querySelector(".anext");
    this._aRing = root.querySelector(".aring");
    this._aList = root.querySelector(".alist");
    var self = this;

    root.addEventListener("pointerdown", function () { self._touch(); }, true);
    root.addEventListener("click", function (ev) {
      if (self._config.tap_sound && ev.target.closest && ev.target.closest('[role="button"]')) Sound.tick();
    }, true);

    // tabs
    var segEl = root.querySelector(".seg");
    if (segEl) segEl.addEventListener("click", function (ev) {
      var t = ev.target.closest ? ev.target.closest(".sg") : null;
      if (t) self._setTab(t.getAttribute("data-tab"), true);
    });
    root.querySelector(".add-alarm").addEventListener("click", function () { self._openSheet(null); });

    // stopwatch
    root.querySelector(".swb").addEventListener("click", function (ev) {
      var t = ev.target.closest ? ev.target.closest("[data-sw]") : null;
      if (t) self._swAction(t.getAttribute("data-sw"));
    });

    // alarms
    this._aList.addEventListener("click", function (ev) {
      var t = ev.target.closest ? ev.target.closest("[data-a]") : null;
      if (!t) return;
      var act = t.getAttribute("data-a");
      if (act === "retry") { self._alarmsLoad(true); return; }
      var a = self._alarms && self._alarms[parseInt(t.getAttribute("data-k"), 10)];
      if (!a) return;
      if (act === "toggle") { ev.stopPropagation(); self._alarmToggle(a); }
      else if (act === "edit") self._openSheet(a);
    });
    this._aRing.addEventListener("click", function (ev) {
      var t = ev.target.closest ? ev.target.closest("[data-press]") : null;
      if (t && self._hass) self._hass.callService("button", "press", { entity_id: t.getAttribute("data-press") });
    });

    // timers
    this._mainEl.addEventListener("click", function (ev) {
      var t = ev.target.closest ? ev.target.closest("[data-act]") : null;
      if (!t) return;
      self._action(t.getAttribute("data-act"), parseInt(t.getAttribute("data-slot"), 10), t);
    });
    var drag = null;
    this._mainEl.addEventListener("pointerdown", function (ev) {
      var tr = ev.target.closest ? ev.target.closest(".atrack") : null;
      if (!tr || !self._adj) return;
      drag = tr;
      self._adjFrom(tr, ev.clientX);
      try { tr.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
      ev.preventDefault();
    });
    this._mainEl.addEventListener("pointermove", function (ev) { if (drag) self._adjFrom(drag, ev.clientX); });
    this._mainEl.addEventListener("pointerup", function () { drag = null; });
    this._mainEl.addEventListener("pointercancel", function () { drag = null; });

    var btnEls = root.querySelectorAll(".btn");
    for (var b = 0; b < btnEls.length; b++) {
      btnEls[b].addEventListener("click", function (ev) {
        var i = parseInt(ev.currentTarget.getAttribute("data-i"), 10);
        self._buttonTap(buttons[i]);
      });
    }
    this._built = true;
    this._pickTabOnShow();
    this._paintSw();
  };

  EchoClockCard.prototype._buttonTap = function (btn) {
    if (!btn) return;
    var self = this;
    if (btn.action === "settings" || btn.action === "timer-settings") {
      var sc = {}, k;
      for (k in (btn.settings || {})) sc[k] = btn.settings[k];
      for (k in (self._config.settings || {})) sc[k] = self._config.settings[k];
      sc.timers = self._config.slots.map(function (s) { return s.timer; });
      if (window.EchoShow && window.EchoShow.openSettings) window.EchoShow.openSettings(self, { timers: sc.timers, alarm: sc });
      else window.EchoAlarmSettingsOpen(self, self._rootEl, sc);
    } else if (btn.navigation_path) {
      navigate(btn.navigation_path);
    } else if (btn.url) {
      window.open(btn.url, "_self");
    }
  };

  // ---------- tabs ----------

  EchoClockCard.prototype._setTab = function (id, user) {
    if (this._config.tabs.indexOf(id) === -1) id = this._config.tabs[this._config.tabs.length - 1];
    if (user && window.EchoShow && window.EchoShow.prefs) window.EchoShow.prefs.set("clock_tab", id);
    if (this._tab === id) return;
    this._tab = id;
    this._rootEl.setAttribute("data-tab", id);
    var sgs = this.shadowRoot.querySelectorAll(".sg");
    for (var i = 0; i < sgs.length; i++) {
      var on = sgs[i].getAttribute("data-tab") === id;
      if (on !== sgs[i].classList.contains("sel")) sgs[i].classList.toggle("sel");
    }
    if (id === "timers") { this._render(); }
    if (id === "stopwatch") this._paintSw();
    else this._swStopRaf();
    if (id === "alarms") this._alarmsShow();
  };

  // Which tab a visit opens on: Timers when one is ringing or just started (by voice, say),
  // otherwise the tab last used on this display.
  EchoClockCard.prototype._pickTabOnShow = function () {
    var items = this._hass ? this._slots() : [];
    var now = Date.now(), want = null;
    for (var i = 0; i < items.length; i++) {
      if (items[i].state === "done") want = "timers";
      if (items[i].state === "active" && items[i].duration && now - (items[i].finishes - items[i].duration * 1000) < 15000) want = "timers";
    }
    if (!want) {
      var p = window.EchoShow && window.EchoShow.prefs ? window.EchoShow.prefs.get("clock_tab") : null;
      want = p || this._config.default_tab || (items.length ? "timers" : this._config.tabs[0]);
    }
    this._tab = null;
    this._setTab(want, false);
  };

  EchoClockCard.prototype._badges = function () {
    var sgs = this.shadowRoot ? this.shadowRoot.querySelectorAll(".sg .bdg") : [];
    for (var i = 0; i < sgs.length; i++) {
      var id = sgs[i].parentNode.getAttribute("data-tab"), on = false, red = false;
      if (id === "timers") {
        (this._items || []).forEach(function (it) { on = true; if (it.state === "done") red = true; });
      } else if (id === "stopwatch") on = !!this._sw.start;
      else if (id === "alarms") { on = !!this._ringing; red = !!this._ringing; }
      if (on !== sgs[i].classList.contains("on")) sgs[i].classList.toggle("on");
      if (red !== sgs[i].classList.contains("red")) sgs[i].classList.toggle("red");
    }
  };

  EchoClockCard.prototype._toast = function (msg) {
    var el = this._toastEl;
    if (!el) return;
    el.textContent = msg;
    el.classList.add("on");
    if (this._toastT) clearTimeout(this._toastT);
    this._toastT = setTimeout(function () { el.classList.remove("on"); }, 4200);
  };

  EchoClockCard.prototype._h24 = function () {
    if (this._config.time_format) return String(this._config.time_format) === "24";
    var loc = this._hass && this._hass.locale;
    if (loc && loc.time_format === "24") return true;
    if (loc && loc.time_format === "12") return false;
    try {
      return !/[ap]m/i.test(new Date(2020, 0, 1, 15).toLocaleTimeString((loc && loc.language) || undefined));
    } catch (e) { return false; }
  };

  // ---------- stopwatch ----------

  EchoClockCard.prototype._swAction = function (which) {
    var s = this._sw, now = Date.now();
    if (which === "right") {
      if (s.start) { s.acc += now - s.start; s.start = null; }
      else s.start = now;
    } else if (s.start) {
      var sum = 0;
      s.laps.forEach(function (l) { sum += l; });
      s.laps.push(swElapsed(s) - sum);
    } else if (s.acc > 0) {
      s.acc = 0; s.laps = [];
    }
    swSave(s);
    this._paintSw();
    this._badges();
  };

  EchoClockCard.prototype._swStopRaf = function () {
    if (this._swRaf) { cancelAnimationFrame(this._swRaf); this._swRaf = null; }
  };

  EchoClockCard.prototype._paintSw = function () {
    if (!this._built) return;
    var s = this._sw, self = this;
    var left = this.shadowRoot.querySelector('[data-sw="left"]'), right = this.shadowRoot.querySelector('[data-sw="right"]');
    var el = swElapsed(s);
    left.textContent = s.start || !el ? "Lap" : "Reset";
    left.className = "circ grey" + (!s.start && !el ? " off" : "");
    right.textContent = s.start ? "Stop" : "Start";
    right.className = "circ " + (s.start ? "red" : "green");
    // laps: the running lap on top, then the finished ones newest first
    var sum = 0, best = -1, worst = -1, h = "";
    s.laps.forEach(function (l, i) {
      sum += l;
      if (best < 0 || l < s.laps[best]) best = i;
      if (worst < 0 || l > s.laps[worst]) worst = i;
    });
    if (el > 0) h += '<div class="lap cur"><span class="ln">Lap ' + (s.laps.length + 1) + '</span><span class="lt"></span></div>';
    for (var i = s.laps.length - 1; i >= 0; i--) {
      var cls = s.laps.length > 1 ? (i === best ? " best" : i === worst ? " worst" : "") : "";
      h += '<div class="lap' + cls + '"><span class="ln">Lap ' + (i + 1) + "</span><span>" + fmtSw(s.laps[i]) + "</span></div>";
    }
    if (!h) h = '<div class="lapnone">Tap Start, then Lap to<br>split the time</div>';
    this._lapsEl.innerHTML = h;
    this._swCurLap = this._lapsEl.querySelector(".lap.cur .lt");
    this._swSum = sum;
    function frame() {
      var e = swElapsed(self._sw);
      var t = fmtSw(e);
      if (self._swD.textContent !== t) {
        self._swD.textContent = t;
        var long = t.length > 8;
        if (long !== self._swD.classList.contains("long")) self._swD.classList.toggle("long");
      }
      if (self._swCurLap) self._swCurLap.textContent = fmtSw(e - self._swSum);
      self._swRaf = self._sw.start && self._tab === "stopwatch" ? requestAnimationFrame(frame) : null;
    }
    this._swStopRaf();
    frame();
  };

  // ---------- alarms (Kiosk Satellite) ----------

  EchoClockCard.prototype._kiosk = function () {
    return this._config.kiosk || this._display || "";
  };

  EchoClockCard.prototype._alarmScript = function () {
    var h = this._hass;
    if (this._config.alarm_script) return this._config.alarm_script;
    if (h && h.user && h.user.is_admin === false && h.states["script.kiosk_satellite_alarms"]) return "script.kiosk_satellite_alarms";
    return null;
  };

  EchoClockCard.prototype._cacheKey = function () { return "echo-clock-alarms:" + this._kiosk().toLowerCase(); };

  // One request at a time, like the kiosk itself handles them.
  EchoClockCard.prototype._req = function (data) {
    var self = this;
    var p = this._aq.then(function () {
      if (!self._hass || !self._hass.connection) return { ok: false, error: "offline" };
      return alarmRequest(self._hass, self._kiosk(), data, self._alarmScript());
    });
    this._aq = p.then(function () {}, function () {});
    return p;
  };

  EchoClockCard.prototype._errText = function (r) {
    var e = (r && r.error) || "";
    if (e === "offline") return "Home Assistant isn’t connected. Alarms still ring; changes need a connection.";
    if (e === "timeout" || /No kiosk answered/i.test(e)) {
      return "“" + this._kiosk() + "” didn’t answer. In Kiosk Satellite, Settings › Home Assistant needs a token from an administrator user, and the name must match this display.";
    }
    if (r && r.refused) return "This dashboard’s user can’t send alarm requests. Use an administrator, or create a script from Kiosk Satellite’s alarms blueprint and set alarm_script on the card.";
    if (e === "duplicate") return "There’s already an alarm at that time on those days.";
    if (/several alarms match/i.test(e)) return "More than one alarm has that time. Give them different labels, or change it in the display’s own alarm list.";
    if (/no matching alarm/i.test(e)) return "That alarm is gone already.";
    return e || "Something went wrong.";
  };

  // Show what we know right away (cached), then ask the kiosk.
  EchoClockCard.prototype._alarmsShow = function () {
    if (!this._built || !this._config.alarms || this._tab !== "alarms") return;
    if (this._alarms === null) {
      try {
        var c = JSON.parse(window.localStorage.getItem(this._cacheKey()) || "null");
        if (c && c.alarms) { this._alarms = c.alarms; this._alarmsStale = true; }
      } catch (e) { /* ignore */ }
    }
    this._paintAlarms();
    if (!this._lastLoad || Date.now() - this._lastLoad > 20000) this._alarmsLoad(false);
    var self = this;
    if (!this._nextT) this._nextT = setInterval(function () {
      if (!self.isConnected) { clearInterval(self._nextT); self._nextT = null; return; }
      if (self._tab === "alarms") self._paintNext();
    }, 30000);
  };

  EchoClockCard.prototype._alarmsLoad = function (force) {
    var self = this;
    if (!this._kiosk() || !this._hass) { this._paintAlarms(); return; }
    if (this._loading && !force) return;
    this._loading = true;
    this._lastLoad = Date.now();
    if (force) { this._alarmErr = null; this._paintAlarms(); }
    this._req({ action: "list" }).then(function (r) {
      self._loading = false;
      if (r && r.ok && r.alarms) {
        self._alarms = r.alarms.slice().sort(function (a, b) { return a.time < b.time ? -1 : a.time > b.time ? 1 : 0; });
        self._alarmsStale = false;
        self._alarmErr = null;
        try { window.localStorage.setItem(self._cacheKey(), JSON.stringify({ at: Date.now(), alarms: self._alarms })); } catch (e) { /* ignore */ }
      } else {
        self._alarmErr = self._errText(r);
        self._alarmsStale = true;
      }
      self._paintAlarms();
    });
  };

  // Any change from voice, the kiosk screen or the remote admin shows up here too.
  EchoClockCard.prototype._subscribeAlarmEvents = function () {
    var self = this, h = this._hass;
    if (this._alarmUnsub || !h || !h.connection || !this._config || !this._config.alarms) return;
    if (h.user && h.user.is_admin === false) return;   // HA only lets admins follow custom events
    this._alarmUnsub = h.connection.subscribeEvents(function () {
      if (self._evT) clearTimeout(self._evT);
      self._evT = setTimeout(function () { if (!self._sheet) self._alarmsLoad(true); else self._lastLoad = 0; }, 600);
    }, "esphome.kiosk_satellite_alarm");
    if (this._alarmUnsub && this._alarmUnsub.catch) this._alarmUnsub.catch(function () { self._alarmUnsub = null; });
  };

  EchoClockCard.prototype._fmtTime = function (hhmm, html) {
    var m = /^(\d{1,2}):(\d{2})/.exec(hhmm || "");
    if (!m) return esc(hhmm);
    var h = parseInt(m[1], 10);
    if (this._h24()) return (h < 10 ? "0" : "") + h + ":" + m[2];
    var ap = h >= 12 ? "PM" : "AM";
    h = h % 12; if (h === 0) h = 12;
    return h + ":" + m[2] + (html ? "<small>" + ap + "</small>" : " " + ap);
  };

  EchoClockCard.prototype._paintNext = function () {
    var el = this._aNext, list = this._alarms || [], best = 0, bestA = null;
    list.forEach(function (a) {
      if (!a.on) return;
      var t = parseNextRing(a.next_ring);
      if (t && (!best || t < best)) { best = t; bestA = a; }
    });
    var h = "";
    if (bestA && best > Date.now() - 60000) {
      h = '<ha-icon icon="mdi:alarm"></ha-icon><span>Next alarm <b>' + dayWord(best) + " " + this._fmtTime(bestA.time) + "</b> · " + fmtIn(best - Date.now()) + "</span>";
    } else if (list.length) {
      h = '<ha-icon icon="mdi:alarm-off"></ha-icon><span>No alarms on</span>';
    }
    if (this._alarmsStale && list.length) h += '<span class="off"><ha-icon icon="mdi:cloud-off-outline"></ha-icon>Last known list</span>';
    else if (this._loading) h += '<span class="off">Updating…</span>';
    if (el.getAttribute("data-h") !== h) { el.innerHTML = h; el.setAttribute("data-h", h); }
  };

  EchoClockCard.prototype._paintAlarms = function () {
    if (!this._built) return;
    var list = this._alarms, h = "", self = this;
    if (!this._kiosk()) {
      h = '<div class="aempty"><ha-icon icon="mdi:tablet"></ha-icon><b>Not on a Kiosk Satellite display</b>' +
        '<div class="msg">Alarms live on the tablet. Open this page on the Echo Show, or set <b>kiosk:</b> on the card to the Kiosk Satellite device name.</div></div>';
    } else if (list === null) {
      h = this._alarmErr
        ? '<div class="aempty"><ha-icon icon="mdi:alarm-note-off"></ha-icon><b>Can’t reach the alarms</b><div class="msg">' + esc(this._alarmErr) + '</div><div class="retry" role="button" data-a="retry">Try again</div></div>'
        : '<div class="aempty"><ha-icon icon="mdi:alarm"></ha-icon><div class="msg">Loading alarms…</div></div>';
    } else if (!list.length) {
      h = '<div class="aempty"><ha-icon icon="mdi:alarm-plus"></ha-icon><b>No alarms</b><div class="msg">Tap + to set one.</div>' +
        (this._alarmErr ? '<div class="msg">' + esc(this._alarmErr) + '</div><div class="retry" role="button" data-a="retry">Try again</div>' : "") + "</div>";
    } else {
      list.forEach(function (a, k) {
        var d = daysText(daysOf(a));
        var lb = (a.label || "Alarm") + (d ? ", " + d : "");
        h += '<div class="arow' + (a.on ? "" : " off") + (self._alarmBusy[a.time + "|" + (a.label || "")] ? " busy" : "") + '" role="button" data-a="edit" data-k="' + k + '">' +
          '<div class="ab"><div class="tm">' + self._fmtTime(a.time, true) + '</div><div class="lb">' + esc(lb) + "</div></div>" +
          '<div class="sw' + (a.on ? " on" : "") + '" role="switch" data-a="toggle" data-k="' + k + '"></div></div>';
      });
    }
    this._aList.className = "alist" + (!list || list.length < 3 ? " one" : "");
    this._aList.innerHTML = h;
    this._paintNext();
    this._badges();
  };

  // Ringing / snoozed, from the kiosk's ESPHome entities.
  EchoClockCard.prototype._alarmState = function () {
    var self = this, h = this._hass, ES = window.EchoShow;
    if (!h || !this._built || !ES || !ES.deviceSlug) return;
    if (this._devSlug === undefined) {
      this._devSlug = null;
      ES.deviceSlug(h).then(function (s) { self._devSlug = s || null; self._alarmState(); });
      return;
    }
    var slug = this._devSlug, ring = null, snooze = null, stopB = null, snoozeB = null;
    if (slug) {
      ring = h.states[ES.devEnt(h, slug, "binary_sensor", "alarm_ringing")];
      snooze = h.states[ES.devEnt(h, slug, "sensor", "alarm_snoozed_until")];
      stopB = ES.devEnt(h, slug, "button", "stop_alarm");
      snoozeB = ES.devEnt(h, slug, "button", "snooze_alarm");
    }
    var ringing = !!(ring && ring.state === "on");
    var snoozedTs = snooze && snooze.state && !/unknown|unavailable/.test(snooze.state) ? Date.parse(snooze.state) : 0;
    var html = "";
    if (ringing) {
      html = '<ha-icon icon="mdi:alarm-bell"></ha-icon><div class="at">Alarm ringing</div>' +
        (snoozeB ? '<div class="abtn" role="button" data-press="' + esc(snoozeB) + '">Snooze</div>' : "") +
        (stopB ? '<div class="abtn stop" role="button" data-press="' + esc(stopB) + '">Stop</div>' : "");
    } else if (snoozedTs > Date.now()) {
      html = '<ha-icon icon="mdi:alarm-snooze"></ha-icon><div class="at">Snoozed until ' + this._fmtTime(fmtHM(snoozedTs)) + "</div>" +
        (stopB ? '<div class="abtn stop" role="button" data-press="' + esc(stopB) + '">Stop</div>' : "");
    }
    if (this._aRing.getAttribute("data-h") !== html) {
      this._aRing.innerHTML = html;
      this._aRing.setAttribute("data-h", html);
      this._aRing.className = "aring" + (html ? " on" : "");
    }
    if (ringing !== !!this._ringing) {
      this._ringing = ringing;
      if (!ringing && this._wasRinging) this._lastLoad = 0;   // a one-time alarm turned itself off
      this._wasRinging = ringing;
      this._badges();
    }
  };

  function fmtHM(ts) {
    var d = new Date(ts);
    return (d.getHours() < 10 ? "0" : "") + d.getHours() + ":" + (d.getMinutes() < 10 ? "0" : "") + d.getMinutes();
  }

  EchoClockCard.prototype._alarmToggle = function (a) {
    var self = this, key = a.time + "|" + (a.label || "");
    if (this._alarmBusy[key]) return;
    this._alarmBusy[key] = true;
    var was = a.on;
    a.on = !was;                      // show it at once
    this._paintAlarms();
    this._req({ action: was ? "turn_off" : "turn_on", time: a.time, label: a.label || "" }).then(function (r) {
      delete self._alarmBusy[key];
      if (r && r.ok) {
        if (r.alarm) for (var k in r.alarm) a[k] = r.alarm[k];
        if (!r.alarm || r.alarm.next_ring === undefined) delete a.next_ring;
        if (a.on && a.next_ring) self._toast("Alarm set for " + dayWord(parseNextRing(a.next_ring)).toLowerCase() + " " + self._fmtTime(a.time) + ", " + fmtIn(parseNextRing(a.next_ring) - Date.now()) + ".");
      } else {
        a.on = was;
        self._toast(self._errText(r));
      }
      self._paintAlarms();
      self._alarmsLoad(true);
    });
  };

  // ----- alarm editor sheet -----

  EchoClockCard.prototype._openSheet = function (a) {
    if (this._sheet) return;
    if (!this._kiosk()) { this._toast("This isn’t a Kiosk Satellite display."); return; }
    var self = this, h24 = this._h24();
    var hh = 7, mm = 0;
    if (a) {
      var m = /^(\d{1,2}):(\d{2})/.exec(a.time || "");
      if (m) { hh = parseInt(m[1], 10); mm = parseInt(m[2], 10); }
    }
    var st = { days: daysOf(a).slice(), label: a ? a.label || "" : "" };
    var sh = document.createElement("div");
    sh.className = "sheet";
    var dchips = "";
    for (var i = 1; i <= 7; i++) {
      var d = DAY_KEYS[i % 7];   // Monday first
      dchips += '<div class="dchip" role="button" data-day="' + d + '">' + DAY_LETTER[i % 7] + "</div>";
    }
    sh.innerHTML = '<div class="sbox"><div class="shd"><div class="sbtn" role="button" data-s="cancel">Cancel</div>' +
      "<h2>" + (a ? "Edit Alarm" : "Add Alarm") + '</h2><div class="sbtn save" role="button" data-s="save">Save</div></div>' +
      '<div class="sbody"><div class="wheels"></div><div class="sopts">' +
      '<div><div class="olbl">Repeat</div><div class="days">' + dchips + '</div>' +
      '<div class="qdays"><div class="chip" role="button" data-q="once">Once</div><div class="chip" role="button" data-q="wk">Weekdays</div>' +
      '<div class="chip" role="button" data-q="we">Weekends</div><div class="chip" role="button" data-q="all">Every day</div></div></div>' +
      '<div><div class="olbl">Label</div><input class="lin" maxlength="40" placeholder="Alarm" value="' + esc(st.label) + '"></div>' +
      '<div class="serr"></div>' +
      '<div class="srow">' + (a ? '<div class="sdel" role="button" data-s="delete"><ha-icon icon="mdi:delete-outline"></ha-icon>Delete</div>' : "") +
      '<div class="snote">Sound, volume, snooze and sunrise follow the display’s Alarm settings in Kiosk Satellite.</div></div>' +
      "</div></div></div>";
    this._rootEl.appendChild(sh);
    this._sheet = sh;

    // wheels: hour, minute (and AM/PM)
    var wh = sh.querySelector(".wheels");
    var hourW, minW, apW = null;
    if (h24) {
      hourW = new Wheel({ values: range(0, 23, true), index: hh });
    } else {
      hourW = new Wheel({ values: range(1, 12), index: ((hh + 11) % 12) });
      apW = new Wheel({ values: ["AM", "PM"], index: hh >= 12 ? 1 : 0, loop: false, cls: "ampm" });
    }
    minW = new Wheel({ values: range(0, 59, true), index: mm });
    wh.appendChild(hourW.el);
    wh.appendChild(minW.el);
    if (apW) wh.appendChild(apW.el);
    var wheels = [hourW, minW].concat(apW ? [apW] : []);
    requestAnimationFrame(function () { wheels.forEach(function (w) { w.paint(); }); });

    var input = sh.querySelector(".lin"), err = sh.querySelector(".serr");
    // HA's keyboard shortcuts must not eat the typing.
    ["keydown", "keyup", "keypress"].forEach(function (t) { input.addEventListener(t, function (ev) { ev.stopPropagation(); }); });
    input.addEventListener("pointerdown", function (ev) { ev.stopPropagation(); });

    function paintDays() {
      var set = {};
      st.days.forEach(function (d) { set[d] = 1; });
      var ds = sh.querySelectorAll(".dchip");
      for (var i = 0; i < ds.length; i++) {
        var on = !!set[ds[i].getAttribute("data-day")];
        if (on !== ds[i].classList.contains("on")) ds[i].classList.toggle("on");
      }
      var q = !st.days.length ? "once" : daysText(st.days) === "Weekdays" ? "wk" : daysText(st.days) === "Weekends" ? "we" : st.days.length === 7 ? "all" : "";
      var qs = sh.querySelectorAll(".qdays .chip");
      for (var j = 0; j < qs.length; j++) {
        var sel = qs[j].getAttribute("data-q") === q;
        if (sel !== qs[j].classList.contains("sel")) qs[j].classList.toggle("sel");
      }
    }
    paintDays();

    function timeStr() {
      var hr = hourW.value(), mn = minW.value();
      if (!h24) hr = (hr + 1) % 12 + (apW.value() === 1 ? 12 : 0);
      return (hr < 10 ? "0" : "") + hr + ":" + (mn < 10 ? "0" : "") + mn;
    }
    function busy(on) {
      var bs = sh.querySelectorAll(".sbtn.save,.sdel");
      for (var i = 0; i < bs.length; i++) if (on !== bs[i].classList.contains("wait")) bs[i].classList.toggle("wait");
    }

    sh.addEventListener("click", function (ev) {
      var t = ev.target.closest ? ev.target.closest("[data-s],[data-day],[data-q]") : null;
      if (!t) { if (ev.target === sh) self._closeSheet(); return; }
      if (t.hasAttribute("data-day")) {
        var dd = t.getAttribute("data-day"), ix = st.days.indexOf(dd);
        if (ix === -1) st.days.push(dd); else st.days.splice(ix, 1);
        st.days = DAY_KEYS.filter(function (k) { return st.days.indexOf(k) !== -1; });
        paintDays();
        return;
      }
      if (t.hasAttribute("data-q")) {
        var q = t.getAttribute("data-q");
        st.days = q === "once" ? [] : q === "wk" ? ["mon", "tue", "wed", "thu", "fri"] : q === "we" ? ["sat", "sun"] : DAY_KEYS.slice();
        st.days = DAY_KEYS.filter(function (k) { return st.days.indexOf(k) !== -1; });
        paintDays();
        return;
      }
      var s = t.getAttribute("data-s");
      if (s === "cancel") { self._closeSheet(); return; }
      err.textContent = "";
      busy(true);
      var label = input.value.replace(/\s+/g, " ").trim();
      var time = timeStr();
      var steps = [];
      if (a && (s === "delete" || time !== a.time || label !== (a.label || "") || daysText(st.days) !== daysText(daysOf(a)))) {
        // No edit on the kiosk side: an edit is delete + set (as Kiosk Satellite's own docs suggest).
        steps.push({ action: "delete", time: a.time, label: a.label || "" });
      }
      if (s === "save" && (!a || steps.length || !a.on)) steps.push({ action: "set", time: time, days: st.days, label: label });
      var last = null, chain = Promise.resolve({ ok: true });
      steps.forEach(function (stp) {
        chain = chain.then(function (r) {
          if (r && r.ok === false) return r;
          return self._req(stp).then(function (rr) { last = rr; return rr; });
        });
      });
      chain.then(function (r) {
        busy(false);
        if (r && r.ok === false) { err.textContent = self._errText(r); self._alarmsLoad(true); return; }
        self._closeSheet();
        if (s === "save" && last && last.alarm && last.alarm.next_ring) {
          var t2 = parseNextRing(last.alarm.next_ring);
          self._toast("Alarm set for " + dayWord(t2).toLowerCase() + " " + self._fmtTime(time) + ", " + fmtIn(t2 - Date.now()) + ".");
        } else if (s === "delete") self._toast("Alarm deleted.");
        self._alarmsLoad(true);
      });
    });
  };

  EchoClockCard.prototype._closeSheet = function () {
    if (!this._sheet) return;
    if (this._sheet.parentNode) this._sheet.parentNode.removeChild(this._sheet);
    this._sheet = null;
  };

  // ---------- timers (HA timer helpers) ----------

  EchoClockCard.prototype._slots = function () {
    var out = [];
    var st = this._hass.states;
    for (var i = 0; i < this._config.slots.length; i++) {
      var cfg = this._config.slots[i];
      var t = st[cfg.timer];
      if (!t) continue;
      var n = st[cfg.name] ? st[cfg.name].state : "";
      if (n === "unknown" || n === "unavailable") n = "";
      var s = t.state;
      if (s === "idle" && !n) continue; // free slot
      var a = t.attributes || {};
      out.push({
        slot: i + 1,
        timer: cfg.timer,
        name: n || "Timer",
        state: s === "idle" ? "done" : s,
        duration: parseDur(a.duration),
        remaining: parseDur(a.remaining),
        finishes: a.finishes_at ? Date.parse(a.finishes_at) : 0,
      });
    }
    return out;
  };

  EchoClockCard.prototype._item = function (slot) {
    var items = this._items || [];
    for (var i = 0; i < items.length; i++) if (items[i].slot === slot) return items[i];
    return null;
  };

  EchoClockCard.prototype._left = function (it) {
    if (!it) return 0;
    if (it.state === "active") return Math.max(0, (it.finishes - Date.now()) / 1000);
    if (it.state === "paused") return it.remaining;
    return 0;
  };

  EchoClockCard.prototype._update = function () {
    if (!this._hass) return;
    var slots = this._slots();
    var sig = JSON.stringify(slots);
    if (sig !== this._sig) {
      var wasDone = (this._items || []).some(function (x) { return x.state === "done"; });
      if (this._sig) this._touch();
      this._sig = sig;
      this._items = slots;
      if (this._adj) {
        var a = this._item(this._adj.slot);
        if (!a || a.state === "done") this._adj = null;
      }
      var nowDone = slots.some(function (x) { return x.state === "done"; });
      if (nowDone && !wasDone && this._tab !== "timers" && !this._sheet) this._setTab("timers", false);
      else this._render();
      this._badges();
    }
    var sat = this._config.satellite ? this._hass.states[this._config.satellite] : null;
    if (sat && VOICE_BUSY[sat.state]) {
      if (this._alarmOn) Sound.hush();
      this._voiceHold = Date.now() + 4000;
    }
    var ticking = false, ringing = false;
    for (var i = 0; i < slots.length; i++) {
      if (slots[i].state === "active") ticking = true;
      if (slots[i].state === "done") ringing = true;
    }
    if (ticking) this._startTick(); else this._stopTick();
    if (ringing) this._alarmStart(); else this._alarmStop();
  };

  EchoClockCard.prototype._startTick = function () {
    if (this._tick) return;
    var self = this;
    this._tick = setInterval(function () { self._paintTimes(); }, 1000);
  };

  EchoClockCard.prototype._stopTick = function () {
    if (this._tick) { clearInterval(this._tick); this._tick = null; }
  };

  EchoClockCard.prototype._render = function () {
    if (!this._built || this._tab !== "timers") return;
    if (this._wheelBusy()) { this._renderLater = true; return; }
    var items = this._items || [];
    var canAdd = items.length < this._config.slots.length;
    if (!canAdd || !items.length) this._adding = false;
    var showAdd = canAdd && (!items.length || this._adding);
    var cols = items.length + (showAdd ? 1 : 0);
    var host = this.shadowRoot.host;
    this._mainEl.className = "main" + (cols <= 1 ? " solo" : "");
    host.style.setProperty("--ring", (cols <= 1 ? 50 : cols === 2 ? 38 : 31) + "vh");
    host.style.setProperty("--clock", (cols >= 3 ? 7.4 : cols === 2 ? 9 : 11.5) + "vh");
    host.style.setProperty("--gow", (cols <= 1 ? 52 : cols === 2 ? 44 : 36) + "vh");
    // Tall wheels: big rows are easier to flick and to land on with a finger.
    host.style.setProperty("--ww", (cols <= 1 ? 20 : cols === 2 ? 15 : 11.6) + "vh");
    host.style.setProperty("--wrow", (cols <= 1 ? 9 : cols === 2 ? 8.2 : 7.4) + "vh");
    host.style.setProperty("--wfs", (cols <= 1 ? 6 : cols === 2 ? 5.2 : 4.6) + "vh");

    var h = "";
    for (var i = 0; i < items.length; i++) {
      h += (this._adj && this._adj.slot === items[i].slot) ? this._adjustHtml(items[i]) : this._timerHtml(items[i]);
    }
    if (showAdd) h += this._adderHtml(items.length, cols);
    if (canAdd && items.length && !showAdd) {
      h += '<div class="corner plus" role="button" data-act="add-open"><ha-icon icon="mdi:plus"></ha-icon></div>';
    } else if (showAdd && items.length) {
      h += '<div class="corner" role="button" data-act="add-close"><ha-icon icon="mdi:close"></ha-icon></div>';
    }
    this._mainEl.innerHTML = h;
    this._mountTimerWheels();
    this._paintAdjust();
    this._paintTimes();
  };

  EchoClockCard.prototype._wheelBusy = function () {
    var w = this._twWheels || [];
    for (var i = 0; i < w.length; i++) if (w[i].dragging || w[i]._raf) return true;
    return false;
  };

  EchoClockCard.prototype._timerHtml = function (it) {
    var ctl;
    if (it.state === "done") {
      ctl = '<div class="ctl">' +
        '<div class="wide more" role="button" data-act="more" data-slot="' + it.slot + '">+1 min</div>' +
        '<div class="wide dismiss" role="button" data-act="cancel" data-slot="' + it.slot + '">Dismiss</div></div>';
    } else {
      var paused = it.state === "paused";
      ctl = '<div class="ctl">' +
        '<div class="rb" role="button" data-act="cancel" data-slot="' + it.slot + '"><ha-icon icon="mdi:close"></ha-icon></div>' +
        '<div class="rb" role="button" data-act="adjust" data-slot="' + it.slot + '"><ha-icon icon="mdi:plus-minus-variant"></ha-icon></div>' +
        '<div class="rb ' + (paused ? "play" : "pause") + '" role="button" data-act="' + (paused ? "resume" : "pause") + '" data-slot="' + it.slot + '">' +
        '<ha-icon icon="' + (paused ? "mdi:play" : "mdi:pause") + '"></ha-icon></div></div>';
    }
    var gid = "g" + it.slot;
    var c1 = it.state === "done" ? "#ff7a70" : "var(--es-hi2,#ffc15e)", c2 = it.state === "done" ? "#ff3b30" : "var(--es-acc2,#ff8a00)";
    return '<div class="tile tcol ' + it.state + '" data-slot="' + it.slot + '">' +
      '<div class="head"><span class="dot"></span><span class="nm">' + esc(it.name) + "</span></div>" +
      '<div class="ring"' + (it.state === "done" ? "" : ' data-act="adjust" data-slot="' + it.slot + '"') + '>' +
      '<svg viewBox="0 0 100 100"><defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" style="stop-color:' + c1 + '"/><stop offset="1" style="stop-color:' + c2 + '"/></linearGradient></defs>' +
      '<circle class="trk" cx="50" cy="50" r="45"/>' +
      '<circle class="arc" cx="50" cy="50" r="45" stroke="url(#' + gid + ')" transform="rotate(-90 50 50)" stroke-dasharray="' + CIRC.toFixed(2) + '" stroke-dashoffset="0"/></svg>' +
      '<div class="mid"><div class="clock"></div><div class="sub"></div></div></div>' +
      ctl + "</div>";
  };

  EchoClockCard.prototype._adjustHtml = function (it) {
    return '<div class="tile adj ' + it.state + '" data-slot="' + it.slot + '">' +
      '<div class="head"><span class="nm">Adjust ' + esc(it.name === "Timer" ? "timer" : it.name) + "</span></div>" +
      '<div class="mid2"><div class="big"></div><div class="delta"></div></div>' +
      '<div class="awrap"><div class="atrack"><div class="afill"></div><div class="zero"></div>' +
      '<div class="lm">−</div><div class="lp">+</div><div class="knob"></div></div>' +
      '<div class="ahint">Drag to add or remove time</div></div>' +
      '<div class="ctl"><div class="wide cancel" role="button" data-act="adj-cancel" data-slot="' + it.slot + '">Cancel</div>' +
      '<div class="wide apply" role="button" data-act="adj-apply" data-slot="' + it.slot + '">Apply</div></div>' +
      "</div>";
  };

  EchoClockCard.prototype._adderHtml = function (count, cols) {
    // Recently used lengths, newest first (like iOS); the configured presets until there are any.
    var rec = recentsLoad(), list = rec.length ? rec : this._config.presets.map(function (m) { return m * 60; });
    var chips = "", max = cols >= 3 ? 2 : cols === 2 ? 3 : 6;
    for (var i = 0; i < list.length && i < max; i++) {
      chips += '<div class="chip" role="button" data-act="preset" data-sec="' + list[i] + '">' + esc(fmtLen(list[i])) + "</div>";
    }
    return '<div class="tile add">' +
      '<div class="cap">' + (count ? "Add a timer" : "New timer") + "</div>" +
      '<div class="wheels tw"></div>' +
      '<div class="recents"><div class="rlbl">' + (rec.length ? "Recents" : "Quick picks") + '</div><div class="chips">' + chips + "</div></div>" +
      '<div class="go" role="button" data-act="start"><ha-icon icon="mdi:play"></ha-icon>Start</div>' +
      "</div>";
  };

  EchoClockCard.prototype._mountTimerWheels = function () {
    var host = this._mainEl.querySelector(".wheels.tw"), self = this;
    this._twWheels = [];
    if (!host) return;
    var tw = this._tw;
    function onSpin() {
      tw.h = self._twWheels[0].value(); tw.m = self._twWheels[1].value(); tw.s = self._twWheels[2].value();
      self._paintAdder();
    }
    function onSettle() { onSpin(); if (self._renderLater) { self._renderLater = false; self._render(); } }
    var opts = [["h", 0, 23, "hours", " hrs"], ["m", 0, 59, "min", ""], ["s", 0, 59, "sec", ""]];
    opts.forEach(function (o) {
      var w = new Wheel({ values: range(o[1], o[2]), index: tw[o[0]], unit: o[3], cls: "unitd" + o[4], onSpin: function () { if (self._twWheels.length === 3) onSpin(); }, onChange: onSettle });
      host.appendChild(w.el);
      self._twWheels.push(w);
    });
    requestAnimationFrame(function () { self._twWheels.forEach(function (w) { w.paint(); }); });
    this._paintAdder();
  };

  EchoClockCard.prototype._twSecs = function () { return this._tw.h * 3600 + this._tw.m * 60 + this._tw.s; };

  EchoClockCard.prototype._paintAdder = function () {
    var secs = this._twSecs();
    var chips = this._mainEl.querySelectorAll(".chip");
    for (var i = 0; i < chips.length; i++) {
      var on = parseInt(chips[i].getAttribute("data-sec"), 10) === secs;
      if (on !== chips[i].classList.contains("sel")) chips[i].classList.toggle("sel");
    }
    var go = this._mainEl.querySelector(".go");
    if (go && (secs === 0) !== go.classList.contains("off")) go.classList.toggle("off");
  };

  // ---- adjust mode ----

  EchoClockCard.prototype._maxRemove = function () {
    var it = this._adj ? this._item(this._adj.slot) : null;
    return Math.max(0, Math.floor((this._left(it) - 10) / 60));
  };

  EchoClockCard.prototype._adjFrom = function (track, clientX) {
    var r = track.getBoundingClientRect();
    var f = ((clientX - r.left) / r.width) * 2 - 1;
    f = Math.max(-1, Math.min(1, f));
    var idx = Math.round(Math.abs(f) * (ADJ.length - 1));
    var d = (f < 0 ? -1 : 1) * ADJ[idx];
    if (d < 0) d = -Math.min(-d, this._maxRemove());
    if (d !== this._adj.delta) {
      this._adj.delta = d;
      this._paintAdjust();
    }
  };

  EchoClockCard.prototype._paintAdjust = function () {
    if (!this._adj) return;
    var tile = this._mainEl.querySelector('.adj[data-slot="' + this._adj.slot + '"]');
    if (!tile) return;
    var d = this._adj.delta;
    var idx = 0;
    for (var i = 0; i < ADJ.length; i++) if (ADJ[i] <= Math.abs(d)) idx = i;
    var pos = (d < 0 ? -1 : 1) * idx / (ADJ.length - 1);
    var pct = 50 + pos * 50;
    var knob = tile.querySelector(".knob"), fill = tile.querySelector(".afill");
    knob.style.left = "calc(" + pct.toFixed(2) + "% + " + (-pos * 3.8).toFixed(2) + "vh)";
    fill.className = "afill" + (d > 0 ? " up" : d < 0 ? " down" : "");
    fill.style.left = (d < 0 ? pct : 50) + "%";
    fill.style.width = Math.abs(pct - 50) + "%";
    var delta = tile.querySelector(".delta");
    delta.className = "delta" + (d > 0 ? " up" : d < 0 ? " down" : "");
    delta.textContent = d === 0 ? "No change" : (d > 0 ? "+" : "−") + fmtMinutes(Math.abs(d));
    this._paintTimes();
  };

  EchoClockCard.prototype._paintTimes = function () {
    if (this._tab !== "timers") return;
    var items = this._items || [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var left = this._left(it);
      if (this._adj && this._adj.slot === it.slot) {
        var big = this._mainEl.querySelector('.adj[data-slot="' + it.slot + '"] .big');
        if (big) {
          var nt = fmtClock(Math.max(10, left + this._adj.delta * 60));
          if (big.textContent !== nt) big.textContent = nt;
        }
        continue;
      }
      var col = this._mainEl.querySelector('.tcol[data-slot="' + it.slot + '"]');
      if (!col) continue;
      var total = it.duration > 0 ? it.duration : Math.max(left, 1);
      var frac = it.state === "done" ? 1 : Math.max(0, Math.min(1, left / total));
      var clock = col.querySelector(".clock");
      var txt = it.state === "done" ? "0:00" : fmtClock(left);
      if (clock.textContent !== txt) {
        clock.textContent = txt;
        var long = txt.length > 5;
        if (long !== clock.classList.contains("long")) clock.classList.toggle("long");
      }
      col.querySelector(".arc").setAttribute("stroke-dashoffset", (CIRC * (1 - frac)).toFixed(2));
      var sub = col.querySelector(".sub");
      var subHtml;
      if (it.state === "active") subHtml = '<ha-icon icon="mdi:bell-outline"></ha-icon>' + fmtEnds(it.finishes);
      else if (it.state === "paused") subHtml = "Paused";
      else subHtml = "Done";
      if (sub.getAttribute("data-h") !== subHtml) { sub.innerHTML = subHtml; sub.setAttribute("data-h", subHtml); }
    }
  };

  // ---------- timer actions ----------

  EchoClockCard.prototype._action = function (act, slot, el) {
    var hass = this._hass;
    if (!hass) return;
    var cfg = this._config;
    var timer = slot ? cfg.slots[slot - 1].timer : null;
    var scr = function (id) { return id.replace(/^script\./, ""); };
    if (act === "preset") {
      var sec = parseInt(el.getAttribute("data-sec"), 10);
      this._tw = { h: Math.floor(sec / 3600), m: Math.floor(sec / 60) % 60, s: sec % 60 };
      var tw = this._tw, w = this._twWheels || [];
      if (w.length === 3) { w[0].set(tw.h, true); w[1].set(tw.m, true); w[2].set(tw.s, true); }
      this._paintAdder();
    } else if (act === "start") {
      var now = Date.now(), secs = this._twSecs();
      if (!secs) return;
      if (this._pending.start && now - this._pending.start < 1500) return; // debounce double taps
      this._pending.start = now;
      this._adding = false;
      recentsAdd(secs);
      hass.callService("script", scr(cfg.start_script), { duration: secs, navigate: false, prefix: cfg.timer_prefix });
    } else if (act === "pause") {
      hass.callService("timer", "pause", { entity_id: timer });
    } else if (act === "resume") {
      hass.callService("timer", "start", { entity_id: timer });
    } else if (act === "cancel") {
      hass.callService("script", scr(cfg.cancel_script), { slot: slot, prefix: cfg.timer_prefix });
    } else if (act === "more") {
      hass.callService("timer", "start", { entity_id: timer, duration: 60 });
    } else if (act === "add-open") {
      this._adding = true;
      this._render();
    } else if (act === "add-close") {
      this._adding = false;
      this._render();
    } else if (act === "adjust") {
      this._adj = { slot: slot, delta: 0 };
      this._render();
    } else if (act === "adj-cancel") {
      this._adj = null;
      this._render();
    } else if (act === "adj-apply") {
      var it = this._item(slot), d = this._adj ? this._adj.delta : 0;
      this._adj = null;
      if (it && d) {
        var s2 = Math.max(10, Math.round(this._left(it) + d * 60));
        var p = hass.callService("timer", "start", { entity_id: timer, duration: s2 });
        if (it.state === "paused" && p && p.then) {
          p.then(function () { hass.callService("timer", "pause", { entity_id: timer }); });
        }
      }
      this._render();
    }
  };

  // The same card under its old name, so existing dashboards keep working.
  function EchoTimerCardAlias() {
    var self = Reflect.construct(HTMLElement, [], new.target || EchoTimerCardAlias);
    initCard(self);
    return self;
  }
  EchoTimerCardAlias.prototype = Object.create(EchoClockCard.prototype);
  EchoTimerCardAlias.prototype.constructor = EchoTimerCardAlias;
  Object.setPrototypeOf(EchoTimerCardAlias, HTMLElement);

  if (!customElements.get("echo-clock-card")) customElements.define("echo-clock-card", EchoClockCard);
  if (!customElements.get("echo-timer-card")) customElements.define("echo-timer-card", EchoTimerCardAlias);
  window.EchoClockWheel = Wheel;
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "echo-clock-card",
    name: "Echo Clock Card",
    description: "Full-screen clock for wall tablets: Kiosk Satellite alarms, stopwatch and timers",
  });
  console.info("%c echo-clock-card " + VERSION + " ", "background:#ff9f0a;color:#000;border-radius:3px");
})();
