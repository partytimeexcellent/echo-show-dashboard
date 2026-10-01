/*
 * echo-timer-card
 * Full-screen timers page for an Echo Show 8 kiosk (companion to echo-weather-card).
 * Shows up to three HA timer helpers side by side, each with a countdown ring,
 * pause/resume, adjust (drag to add/remove time) and cancel, plus an iOS-style
 * drag slider to start a new one. The alarm sound is synthesised with Web Audio.
 *
 * Plain JavaScript, no dependencies, no build step. ES5-ish for older Chromium.
 */
(function () {
  "use strict";

  var VERSION = "1.8.0";

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

  // ---------- card styles ----------

  var STYLE = [
    ":host{display:block;height:100vh;width:100%;overflow:hidden;font-family:var(--es-font,var(--ha-font-family-body,Roboto,'Helvetica Neue',Arial,sans-serif));color:#fff;-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none;}",
    ".root{position:relative;height:100vh;width:100%;overflow:hidden;box-sizing:border-box;background:var(--es-bg,radial-gradient(110% 90% at 0% 0%,#223567 0%,rgba(34,53,103,0) 60%),radial-gradient(90% 80% at 100% 100%,#0d3b4f 0%,rgba(13,59,79,0) 60%),#0a1022);}",
    ".content{position:relative;height:100vh;box-sizing:border-box;padding:2vh 2.5vh 2vh 2.5vh;display:flex;flex-direction:column;}",
    ".main{position:relative;flex:1 1 auto;min-height:0;display:flex;align-items:stretch;gap:2vh;}",
    /* one thing on screen: no tile frame, it sits straight on the background */
    ".main.solo .tile{background:none;border-color:transparent;box-shadow:none;}",
    ".main.solo .tile.done::before{border-radius:3.6vh;}",
    /* small round buttons in the top-right corner: "+" to add a timer, "x" to close the adder */
    ".corner{position:absolute;top:1.4vh;right:1.4vh;z-index:3;width:8vh;height:8vh;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;" +
      "background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.14);color:rgba(255,255,255,.92);}",
    ".corner.plus{background:rgba(var(--es-acc-rgb,255,159,10),.2);border-color:rgba(var(--es-acc-rgb,255,159,10),.5);color:var(--es-hi2,#ffc266);}",
    ".corner ha-icon{--mdc-icon-size:4.6vh;width:4.6vh;height:4.6vh;display:inline-flex;}",
    ".corner:active{transform:scale(.92);}",
    /* tiles */
    ".tile{position:relative;flex:1 1 0;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:space-between;box-sizing:border-box;padding:2.8vh 2vh 3vh;border-radius:3.6vh;overflow:hidden;" +
      "background:linear-gradient(180deg,rgba(255,255,255,.075),rgba(255,255,255,.03));border:1px solid rgba(255,255,255,.09);box-shadow:inset 0 1px 0 rgba(255,255,255,.06);}",
    ".tile::before{content:'';position:absolute;left:0;top:0;right:0;bottom:0;border-radius:inherit;background:linear-gradient(180deg,rgba(255,69,58,.32),rgba(255,69,58,.1));opacity:0;pointer-events:none;}",
    ".tile.done{border-color:rgba(255,99,88,.6);}",
    ".tile.done::before{animation:etc-glow 1.4s ease-in-out infinite;}",
    "@keyframes etc-glow{0%,100%{opacity:.35;}50%{opacity:1;}}",
    ".tile > *{position:relative;}",
    ".head{display:flex;align-items:center;justify-content:center;gap:1.2vh;max-width:100%;font-size:3.8vh;line-height:1.1;letter-spacing:.01em;}",
    ".head .nm{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
    ".head .dot{flex:0 0 auto;width:1.4vh;height:1.4vh;border-radius:50%;background:var(--es-acc,#ff9f0a);box-shadow:0 0 1.2vh rgba(var(--es-acc-rgb,255,159,10),.8);}",
    ".paused .head .dot{background:rgba(255,255,255,.45);box-shadow:none;}",
    ".done .head .dot{background:#ff453a;box-shadow:0 0 1.2vh rgba(255,69,58,.9);}",
    ".cap{font-size:2.6vh;letter-spacing:.12em;text-transform:uppercase;opacity:.55;}",
    /* ring */
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
    ".sub{font-size:2.7vh;opacity:.6;margin-top:1.4vh;display:flex;align-items:center;white-space:nowrap;}",
    ".sub ha-icon{--mdc-icon-size:2.7vh;width:2.7vh;height:2.7vh;display:inline-flex;margin-right:.6vh;}",
    ".done .clock{animation:etc-blink 1s steps(1) infinite;color:#ff7a70;}",
    "@keyframes etc-blink{50%{opacity:.25;}}",
    /* round controls */
    ".ctl{display:flex;gap:2.6vh;align-items:center;}",
    ".rb{width:10vh;height:10vh;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.08);}",
    ".rb ha-icon{--mdc-icon-size:5vh;width:5vh;height:5vh;display:inline-flex;}",
    ".rb.pause{background:rgba(var(--es-acc-rgb,255,159,10),.18);border-color:rgba(var(--es-acc-rgb,255,159,10),.35);color:var(--es-hi,#ffb340);}",
    ".rb.play{background:rgba(52,199,89,.18);border-color:rgba(52,199,89,.4);color:#5ee07f;}",
    ".rb:active,.chip:active,.go:active,.btn:active,.wide:active{transform:scale(.95);}",
    ".wide{height:10vh;border-radius:5vh;padding:0 3.6vh;display:flex;align-items:center;justify-content:center;font-size:3.6vh;cursor:pointer;white-space:nowrap;}",
    ".wide.dismiss{background:linear-gradient(180deg,#ff6259,#e5362c);box-shadow:0 .8vh 2.4vh rgba(255,69,58,.35);}",
    ".wide.more,.wide.cancel{background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.1);}",
    ".wide.apply{background:linear-gradient(180deg,var(--es-acc1,#ffab2e),var(--es-acc2,#ff8a00));color:var(--es-on-acc,#1a1000);}",
    /* adjust mode */
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
    /* new-timer tile */
    ".add .readout{font-size:7vh;font-weight:300;line-height:1;font-variant-numeric:tabular-nums;white-space:nowrap;}",
    ".add .row{display:flex;align-items:center;gap:2.6vh;}",
    ".slider{position:relative;width:var(--pillw,15vh);height:var(--pillh,40vh);border-radius:3.6vh;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.1);overflow:hidden;touch-action:none;cursor:ns-resize;}",
    ".slider .fill{position:absolute;left:0;right:0;bottom:0;height:100%;background:linear-gradient(0deg,var(--es-acc2,#ff8a00),var(--es-hi2,#ffc15e));transform-origin:bottom;}",
    ".slider ha-icon{position:absolute;left:50%;bottom:2vh;margin-left:-2.5vh;--mdc-icon-size:5vh;width:5vh;height:5vh;display:inline-flex;color:rgba(40,20,0,.7);pointer-events:none;}",
    ".chips{display:grid;grid-template-columns:repeat(2,var(--chipw,13vh));gap:1.3vh;}",
    ".chip{height:var(--chiph,8.8vh);border-radius:2.2vh;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.09);display:flex;align-items:center;justify-content:center;font-size:3.2vh;cursor:pointer;white-space:nowrap;}",
    ".chip.sel{background:rgba(var(--es-acc-rgb,255,159,10),.2);border-color:rgba(var(--es-acc-rgb,255,159,10),.65);color:var(--es-hi2,#ffc266);}",
    ".go{height:9vh;border-radius:4.5vh;background:linear-gradient(180deg,#3ad16a,#27a84f);box-shadow:0 .8vh 2.4vh rgba(39,168,79,.3);display:flex;align-items:center;justify-content:center;font-size:3.8vh;cursor:pointer;width:var(--gow,46vh);max-width:94%;}",
    ".go ha-icon{--mdc-icon-size:4.4vh;width:4.4vh;height:4.4vh;display:inline-flex;margin-right:1.2vh;}",
    /* bottom buttons (same look as echo-weather-card) */
    ".btns{display:flex;gap:1.5vh;margin-top:2vh;height:9vh;flex:0 0 auto;}",
    ".btn{flex:1 1 0;border-radius:1.6vh;background:rgba(255,255,255,.1);display:flex;align-items:center;justify-content:center;cursor:pointer;}",
    ".btn.active{background:rgba(255,255,255,.24);}",
    ".btn ha-icon{--mdc-icon-size:5vh;width:5vh;height:5vh;display:inline-flex;color:rgba(255,255,255,.9);}",
  ].join("");

  // ---------- the card ----------

  function EchoTimerCard() {
    var self = Reflect.construct(HTMLElement, [], EchoTimerCard);
    self._hass = null;
    self._config = null;
    self._sig = "";
    self._tick = null;
    self._minIdx = STOPS.indexOf(5);
    self._pending = {};
    self._adj = null;   // { slot, delta } while a timer is being adjusted
    // Keep touch gestures inside this card: stops the kiosk's swipe-between-views from
    // firing while dragging sliders (and on this page generally).
    ["touchstart", "touchmove", "touchend", "touchcancel"].forEach(function (type) {
      self.addEventListener(type, function (ev) { if (!self._config || self._config.block_swipe !== false) ev.stopPropagation(); });
    });
    return self;
  }
  EchoTimerCard.prototype = Object.create(HTMLElement.prototype);
  EchoTimerCard.prototype.constructor = EchoTimerCard;
  Object.setPrototypeOf(EchoTimerCard, HTMLElement);

  EchoTimerCard.prototype.setConfig = function (config) {
    this._raw = config || {};
    this._applyProfile(null);
    var self = this;
    echoDisplayName().then(function (name) {
      self._display = name;
      var prof = matchDisplay(self._raw.devices, name);
      if (!prof) return;
      self._applyProfile(prof);
      self._sig = "";
      if (self._built && self._hass) self._update();
    });
  };

  // Build the effective config: card config plus the matching per-display overrides.
  EchoTimerCard.prototype._applyProfile = function (prof) {
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
      alarm: config.alarm !== false,                 // sound the alarm in this browser while a timer is done
      tone_entity: config.tone_entity || "input_select.echo_timer_alarm_tone",
      satellite: config.satellite || null,           // assist_satellite.*: alarm pauses while it listens/talks
      idle_timeout: config.idle_timeout !== undefined ? config.idle_timeout : 180,  // seconds, 0 = off
      idle_path: config.idle_path || null,           // where to go after idle_timeout (only when no timers)
      settings: config.settings || {},               // options for the settings popup
      block_swipe: config.block_swipe !== false,     // stop touch gestures leaving the card
      tap_sound: !!config.tap_sound,                 // play a soft tick on button taps
    };
  };

  EchoTimerCard.prototype.getCardSize = function () { return 12; };

  Object.defineProperty(EchoTimerCard.prototype, "hass", {
    set: function (hass) {
      this._hass = hass;
      if (!this._config) return;
      if (!this._built) { this._build(); this._startIdle(); }
      this._update();
      if (this._settingsEl) this._settingsEl.hass = hass;
    },
    get: function () { return this._hass; },
  });

  EchoTimerCard.prototype.connectedCallback = function () {
    if (this._built) this._update();
    this._startIdle();
  };

  EchoTimerCard.prototype.disconnectedCallback = function () {
    this._stopTick();
    this._alarmStop();
    this._stopIdle();
    if (this._adj) { this._adj = null; this._sig = ""; }
    if (this._settingsEl) this._settingsEl.close();
  };

  // ---------- alarm loop ----------

  var VOICE_BUSY = { listening: 1, processing: 1, responding: 1 };

  EchoTimerCard.prototype._voiceBusy = function () {
    var sat = this._config.satellite && this._hass ? this._hass.states[this._config.satellite] : null;
    if (sat && VOICE_BUSY[sat.state]) return true;
    return !!(this._voiceHold && Date.now() < this._voiceHold);
  };

  EchoTimerCard.prototype._alarmCycle = function () {
    var self = this;
    if (!this._alarmOn) return;
    var tone = this._hass && this._hass.states[this._config.tone_entity] ? this._hass.states[this._config.tone_entity].state : "Chime";
    var len = Sound.cycle(tone);
    if (!this._voiceBusy()) len = Sound.play(tone, 1) || len;
    this._alarmTimer = setTimeout(function () { self._alarmCycle(); }, len * 1000);
  };

  EchoTimerCard.prototype._alarmStart = function () {
    if (this._alarmOn || !this._config.alarm) return;
    this._alarmOn = true;
    this._alarmCycle();
  };

  EchoTimerCard.prototype._alarmStop = function () {
    if (!this._alarmOn) return;
    this._alarmOn = false;
    if (this._alarmTimer) { clearTimeout(this._alarmTimer); this._alarmTimer = null; }
    Sound.hush();
  };

  // ---------- go back to the home view after a period without touches ----------
  // Only when no timer is running, paused or ringing.

  EchoTimerCard.prototype._touch = function () { this._lastAct = Date.now(); };

  EchoTimerCard.prototype._startIdle = function () {
    var self = this;
    this._touch();
    if (this._idleT || !this._config.idle_timeout || !this._config.idle_path) return;
    this._idleT = setInterval(function () {
      var busy = (self._items && self._items.length) || self._settingsEl || self._adj;
      if (busy) { self._touch(); return; }
      if (Date.now() - self._lastAct >= self._config.idle_timeout * 1000) {
        self._touch();
        navigate(self._config.idle_path);
      }
    }, 5000);
  };

  EchoTimerCard.prototype._stopIdle = function () {
    if (this._idleT) { clearInterval(this._idleT); this._idleT = null; }
  };

  // ---------- DOM ----------

  EchoTimerCard.prototype._build = function () {
    var root = this.attachShadow({ mode: "open" });
    var buttons = this._config.buttons;
    var btnHtml = "";
    for (var i = 0; i < buttons.length; i++) {
      btnHtml += '<div class="btn' + (buttons[i].active ? " active" : "") + '" role="button" data-i="' + i + '"><ha-icon icon="' + esc(buttons[i].icon || "mdi:help") + '"></ha-icon></div>';
    }
    root.innerHTML = "<style>" + STYLE + "</style>" +
      '<div class="root"><div class="content"><div class="main"></div>' +
      (buttons.length ? '<div class="btns">' + btnHtml + "</div>" : "") +
      "</div></div>";
    this._mainEl = root.querySelector(".main");
    var self = this;

    // Any touch counts as activity for the idle return.
    root.addEventListener("pointerdown", function () { self._touch(); }, true);
    // Optional tap feedback for anything button-like.
    root.addEventListener("click", function (ev) {
      if (self._config.tap_sound && ev.target.closest && ev.target.closest('[role="button"]')) Sound.tick();
    }, true);

    this._mainEl.addEventListener("click", function (ev) {
      var t = ev.target.closest ? ev.target.closest("[data-act]") : null;
      if (!t) return;
      self._action(t.getAttribute("data-act"), parseInt(t.getAttribute("data-slot"), 10), t);
    });

    // Drags: the new-timer pill (vertical) and the adjust track (horizontal).
    var drag = null;
    function newIdx(clientY) {
      var r = self._sliderEl.getBoundingClientRect();
      var f = Math.max(0, Math.min(1, (r.bottom - clientY) / r.height));
      return Math.min(STOPS.length - 1, Math.max(0, Math.round(f * (STOPS.length - 1))));
    }
    function down(x, y, target) {
      if (!target.closest) return false;
      if (target.closest(".slider") && self._sliderEl) { drag = "new"; self._setIdx(newIdx(y)); return true; }
      var tr = target.closest(".atrack");
      if (tr && self._adj) { drag = tr; self._adjFrom(tr, x); return true; }
      return false;
    }
    function move(x, y) {
      if (drag === "new") self._setIdx(newIdx(y));
      else if (drag) self._adjFrom(drag, x);
    }
    function up() { drag = null; }
    if (window.PointerEvent) {
      this._mainEl.addEventListener("pointerdown", function (ev) {
        if (down(ev.clientX, ev.clientY, ev.target)) {
          try { ev.target.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
          ev.preventDefault();
        }
      });
      this._mainEl.addEventListener("pointermove", function (ev) { if (drag) move(ev.clientX, ev.clientY); });
      this._mainEl.addEventListener("pointerup", up);
      this._mainEl.addEventListener("pointercancel", up);
    } else {
      this._mainEl.addEventListener("touchstart", function (ev) { if (down(ev.touches[0].clientX, ev.touches[0].clientY, ev.target)) ev.preventDefault(); }, { passive: false });
      this._mainEl.addEventListener("touchmove", function (ev) { if (drag) { move(ev.touches[0].clientX, ev.touches[0].clientY); ev.preventDefault(); } }, { passive: false });
      this._mainEl.addEventListener("touchend", up);
      this._mainEl.addEventListener("mousedown", function (ev) { down(ev.clientX, ev.clientY, ev.target); });
      window.addEventListener("mousemove", function (ev) { if (drag) move(ev.clientX, ev.clientY); });
      window.addEventListener("mouseup", up);
    }

    var btnEls = root.querySelectorAll(".btn");
    for (var b = 0; b < btnEls.length; b++) {
      btnEls[b].addEventListener("click", function (ev) {
        var i = parseInt(ev.currentTarget.getAttribute("data-i"), 10);
        var btn = buttons[i];
        if (!btn) return;
        if (btn.action === "settings" || btn.action === "timer-settings") {
          var sc = {}, k;
          for (k in (btn.settings || {})) sc[k] = btn.settings[k];
          for (k in (self._config.settings || {})) sc[k] = self._config.settings[k];
          sc.timers = self._config.slots.map(function (s) { return s.timer; });
          // The shared settings panel (echo-show-common); the old timer-only popup otherwise.
          if (window.EchoShow && window.EchoShow.openSettings) window.EchoShow.openSettings(self, { timers: sc.timers, alarm: sc });
          else window.EchoAlarmSettingsOpen(self, root.querySelector(".root"), sc);
        } else if (btn.navigation_path) {
          navigate(btn.navigation_path);
        } else if (btn.url) {
          window.open(btn.url, "_self");
        }
      });
    }
    this._built = true;
  };

  // ---------- state ----------

  EchoTimerCard.prototype._slots = function () {
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

  EchoTimerCard.prototype._item = function (slot) {
    var items = this._items || [];
    for (var i = 0; i < items.length; i++) if (items[i].slot === slot) return items[i];
    return null;
  };

  EchoTimerCard.prototype._left = function (it) {
    if (!it) return 0;
    if (it.state === "active") return Math.max(0, (it.finishes - Date.now()) / 1000);
    if (it.state === "paused") return it.remaining;
    return 0;
  };

  EchoTimerCard.prototype._update = function () {
    if (!this._hass) return;
    var slots = this._slots();
    var sig = JSON.stringify(slots);
    if (sig !== this._sig) {
      if (this._sig) this._touch(); // a timer was added/changed: counts as activity
      this._sig = sig;
      this._items = slots;
      // Leave adjust mode if that timer finished or went away.
      if (this._adj) {
        var a = this._item(this._adj.slot);
        if (!a || a.state === "done") this._adj = null;
      }
      this._render();
    }
    // Pause the alarm while the voice assistant is listening or answering (and briefly after).
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

  EchoTimerCard.prototype._startTick = function () {
    if (this._tick) return;
    var self = this;
    this._tick = setInterval(function () { self._paintTimes(); }, 1000);
  };

  EchoTimerCard.prototype._stopTick = function () {
    if (this._tick) { clearInterval(this._tick); this._tick = null; }
  };

  // ---------- render ----------

  EchoTimerCard.prototype._render = function () {
    var items = this._items || [];
    var canAdd = items.length < this._config.slots.length;
    if (!canAdd || !items.length) this._adding = false;
    // The new-timer setter shows when there are no timers, or after "+" is tapped.
    var showAdd = canAdd && (!items.length || this._adding);
    var cols = items.length + (showAdd ? 1 : 0);
    var host = this.shadowRoot.host;
    this._mainEl.className = "main" + (cols <= 1 ? " solo" : "");
    // Sizes scale with the number of columns.
    host.style.setProperty("--ring", (cols <= 1 ? (items.length ? 54 : 42) : cols === 2 ? 40 : 34) + "vh");
    host.style.setProperty("--clock", (cols >= 3 ? 8 : cols === 2 ? 9.5 : 12) + "vh");
    if (cols <= 1) {
      host.style.setProperty("--pillw", "16vh"); host.style.setProperty("--pillh", "42vh");
      host.style.setProperty("--chipw", "17vh"); host.style.setProperty("--chiph", "9.4vh");
      host.style.setProperty("--gow", "56vh");
    } else if (cols === 2) {
      host.style.setProperty("--pillw", "14vh"); host.style.setProperty("--pillh", "40vh");
      host.style.setProperty("--chipw", "14vh"); host.style.setProperty("--chiph", "9vh");
      host.style.setProperty("--gow", "46vh");
    } else {
      host.style.setProperty("--pillw", "11vh"); host.style.setProperty("--pillh", "38vh");
      host.style.setProperty("--chipw", "12.5vh"); host.style.setProperty("--chiph", "8.4vh");
      host.style.setProperty("--gow", "40vh");
    }

    var h = "";
    for (var i = 0; i < items.length; i++) {
      h += (this._adj && this._adj.slot === items[i].slot) ? this._adjustHtml(items[i]) : this._timerHtml(items[i]);
    }
    if (showAdd) h += this._adderHtml(items.length);
    if (canAdd && items.length && !showAdd) {
      h += '<div class="corner plus" role="button" data-act="add-open"><ha-icon icon="mdi:plus"></ha-icon></div>';
    } else if (showAdd && items.length) {
      h += '<div class="corner" role="button" data-act="add-close"><ha-icon icon="mdi:close"></ha-icon></div>';
    }
    this._mainEl.innerHTML = h;
    this._sliderEl = this._mainEl.querySelector(".slider");
    this._fillEl = this._mainEl.querySelector(".slider .fill");
    this._readEl = this._mainEl.querySelector(".add .readout");
    this._paintSlider();
    this._paintAdjust();
    this._paintTimes();
  };

  EchoTimerCard.prototype._timerHtml = function (it) {
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

  EchoTimerCard.prototype._adjustHtml = function (it) {
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

  EchoTimerCard.prototype._adderHtml = function (count) {
    var presets = this._config.presets;
    var chips = "";
    for (var i = 0; i < presets.length && i < 8; i++) {
      chips += '<div class="chip" role="button" data-act="preset" data-min="' + presets[i] + '">' + (presets[i] >= 60 && presets[i] % 60 === 0 ? presets[i] / 60 + " hr" : presets[i] + " min") + "</div>";
    }
    return '<div class="tile add">' +
      '<div class="cap">' + (count ? "Add a timer" : "New timer") + "</div>" +
      '<div class="readout"></div>' +
      '<div class="row"><div class="slider"><div class="fill"></div><ha-icon icon="mdi:timer-outline"></ha-icon></div>' +
      '<div class="chips">' + chips + "</div></div>" +
      '<div class="go" role="button" data-act="start"><ha-icon icon="mdi:play"></ha-icon>Start</div>' +
      "</div>";
  };

  EchoTimerCard.prototype._setIdx = function (idx) {
    if (idx === this._minIdx) return;
    this._minIdx = idx;
    this._paintSlider();
  };

  EchoTimerCard.prototype._paintSlider = function () {
    if (!this._fillEl) return;
    var min = STOPS[this._minIdx];
    var f = (this._minIdx + 1) / STOPS.length;
    this._fillEl.style.transform = "scaleY(" + f.toFixed(4) + ")";
    this._readEl.textContent = fmtMinutes(min);
    var chips = this._mainEl.querySelectorAll(".chip");
    for (var i = 0; i < chips.length; i++) {
      var on = parseInt(chips[i].getAttribute("data-min"), 10) === min;
      if (on !== chips[i].classList.contains("sel")) chips[i].classList.toggle("sel");
    }
  };

  // ---- adjust mode ----

  // Most time that may be removed (keeps at least 10 s on the clock), in minutes.
  EchoTimerCard.prototype._maxRemove = function () {
    var it = this._adj ? this._item(this._adj.slot) : null;
    return Math.max(0, Math.floor((this._left(it) - 10) / 60));
  };

  EchoTimerCard.prototype._adjFrom = function (track, clientX) {
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

  EchoTimerCard.prototype._paintAdjust = function () {
    if (!this._adj) return;
    var tile = this._mainEl.querySelector('.adj[data-slot="' + this._adj.slot + '"]');
    if (!tile) return;
    var d = this._adj.delta;
    // Knob position from the delta's place on the stop scale.
    var idx = 0;
    for (var i = 0; i < ADJ.length; i++) if (ADJ[i] <= Math.abs(d)) idx = i;
    var pos = (d < 0 ? -1 : 1) * idx / (ADJ.length - 1);   // -1..1
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

  EchoTimerCard.prototype._paintTimes = function () {
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

  // ---------- actions ----------

  EchoTimerCard.prototype._action = function (act, slot, el) {
    var hass = this._hass;
    if (!hass) return;
    var cfg = this._config;
    var timer = slot ? cfg.slots[slot - 1].timer : null;
    var scr = function (id) { return id.replace(/^script\./, ""); };
    if (act === "preset") {
      var min = parseInt(el.getAttribute("data-min"), 10);
      var idx = STOPS.indexOf(min);
      if (idx < 0) {
        STOPS.push(min); STOPS.sort(function (a, b) { return a - b; });
        idx = STOPS.indexOf(min);
      }
      this._minIdx = idx;
      this._paintSlider();
    } else if (act === "start") {
      var now = Date.now();
      if (this._pending.start && now - this._pending.start < 1500) return; // debounce double taps
      this._pending.start = now;
      this._adding = false;   // the new timer's tile replaces the setter
      hass.callService("script", scr(cfg.start_script), { duration: STOPS[this._minIdx] * 60, navigate: false, prefix: cfg.timer_prefix });
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
        // Restart the timer with the new remaining time (keeps it paused if it was paused).
        var secs = Math.max(10, Math.round(this._left(it) + d * 60));
        var p = hass.callService("timer", "start", { entity_id: timer, duration: secs });
        if (it.state === "paused" && p && p.then) {
          p.then(function () { hass.callService("timer", "pause", { entity_id: timer }); });
        }
      }
      this._render();
    }
  };

  if (!customElements.get("echo-timer-card")) {
    customElements.define("echo-timer-card", EchoTimerCard);
  }
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "echo-timer-card",
    name: "Echo Timer Card",
    description: "Full-screen timers (up to three) for wall tablets",
  });
  console.info("%c echo-timer-card " + VERSION + " ", "background:#ff9f0a;color:#000;border-radius:3px");
})();
