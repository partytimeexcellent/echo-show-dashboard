/*!
 * Echo Show Dashboard 1.13.0
 * https://github.com/partytimeexcellent/echo-show-dashboard
 * echo-show-common 1.8.0, echo-weather-card 1.7.3, echo-clock-card 2.3.0, echo-media-card 1.14.0, echo-climate-card 1.0.2, echo-notify 1.3.0
 * License: MIT
 * Built from src/ by build.js. Edit the files in src/, not this one.
 */

/* ===== echo-show-common.js ===== */
/*
 * echo-show-common
 * Shared pieces of the Echo Show dashboard, used by every card:
 *
 *  - Settings panel (<echo-show-settings>): opened by the gear button on every page.
 *    Tabs for this display (microphone, camera, brightness, volume, screensaver, voice),
 *    weather, timers, media, alerts and about. Device controls come from the Kiosk
 *    Satellite app's Home Assistant entities and only show when they exist.
 *  - Timer overlay (<echo-timer-overlay>): a large countdown on the other pages while a
 *    timer is running.
 *  - Per-display preferences (stored in this browser) that the cards read.
 *
 * Dashboard config (optional, top level of the raw dashboard config):
 *   echo_show:
 *     device: kitchen_echo_show_8      # Kiosk Satellite entity prefix; auto-detected
 *     devices:                          # per-display overrides, matched on the device name
 *       - match: office
 *         device: office_echo_show_8
 *
 * Plain JavaScript, no dependencies, no build step. ES5-ish for older Chromium.
 */
(function () {
  "use strict";

  var VERSION = "1.8.0";
  if (window.EchoShow && window.EchoShow.version) return;  // loaded twice

  function esc(s) {
    return String(s === undefined || s === null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function num(v) { var n = parseFloat(v); return isNaN(n) ? null : n; }

  function navigate(path) {
    window.history.pushState(null, "", path);
    window.dispatchEvent(new Event("location-changed", { bubbles: true, composed: true }));
  }

  // ---------- which display is this? (same rules as the cards) ----------
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

  // ---------- per-display preferences (this browser only) ----------
  var PREF_KEY = "echo-show-prefs";
  var PREF_DEFAULTS = {
    overlay: "auto",             // timer overlay position: auto (per page)/top-right/top-left/bottom-right/bottom-left/off
    weather_animations: null,    // null = card config
    weather_wind: true,          // wind row in the hourly chart
    media_room: null,            // entity of this display's room; null = card config
    media_follow: null,          // follow whatever is playing; null = card config
    notify_sound: null,          // alert chime on this display; null = dashboard config
    theme: "midnight",           // colour theme (THEMES below)
    theme_night: "",             // another theme while the sun is down ("" = same)
    weather_sky: null,           // live sky colours behind the weather; null = theme default
    clock_tab: null,             // Clock page tab last used here (alarms/stopwatch/timers)
    climate_tab: null,           // Climate page tab last used here (now/schedule/comfort/insights)
    volume_hud: "on",            // show volume changes on screen (on/off)
  };
  var Prefs = {
    all: function () {
      var o = {}, k, s = {};
      try { s = JSON.parse(window.localStorage.getItem(PREF_KEY) || "{}") || {}; } catch (e) { s = {}; }
      for (k in PREF_DEFAULTS) o[k] = s[k] !== undefined ? s[k] : PREF_DEFAULTS[k];
      return o;
    },
    get: function (k) { return this.all()[k]; },
    set: function (k, v) {
      var s = {};
      try { s = JSON.parse(window.localStorage.getItem(PREF_KEY) || "{}") || {}; } catch (e) { s = {}; }
      if (v === null || v === undefined) delete s[k]; else s[k] = v;
      try { window.localStorage.setItem(PREF_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
      window.dispatchEvent(new CustomEvent("echo-show-prefs", { detail: { key: k, value: v } }));
    },
  };

  // ---------- themes ----------
  // Every card's colours are CSS variables (--es-*) with the Midnight look as fallback.
  // A theme sets them on <html>; custom properties inherit into the cards' shadow roots.
  function rg(a, b, base) {
    return "radial-gradient(110% 90% at 0% 0%," + a + " 0%,transparent 60%),radial-gradient(90% 80% at 100% 100%," + b + " 0%,transparent 60%)," + base;
  }
  var THEMES = [
    { id: "midnight", name: "Midnight", sub: "Navy and amber (default)", sky: true },
    { id: "black", name: "Black", sub: "True black, amber accents", sky: false,
      bg: "#000", base: "#000", shade: "0,0,0", pan1: "#181818", pan2: "#0c0c0c", ov: "rgba(10,10,10,1)" },
    { id: "ocean", name: "Ocean", sub: "Deep teal and cyan", sky: true,
      bg: rg("#0f4c6e", "#0a5f66", "#04131f"), base: "#04131f", shade: "4,19,31", pan1: "#12304a", pan2: "#0b1f31", ov: "rgba(6,22,36,1)",
      acc: "#2ec7ff", acc1: "#5fd6ff", acc2: "#0aa2e0", hi: "#5fd6ff", hi2: "#92e4ff", onAcc: "#001521" },
    { id: "forest", name: "Forest", sub: "Pine green and mint", sky: true,
      bg: rg("#1f4d33", "#3a4618", "#07140d"), base: "#07140d", shade: "7,20,13", pan1: "#173326", pan2: "#0e2118", ov: "rgba(9,24,16,1)",
      acc: "#6fdc8c", acc1: "#8ce6a3", acc2: "#3fbf62", hi: "#8ce6a3", hi2: "#b0f0c0", onAcc: "#04200d" },
    { id: "aurora", name: "Aurora", sub: "Violet and teal glow", sky: false,
      bg: rg("#4b1d6b", "#0f5a5a", "#0c0a1e"), base: "#0c0a1e", shade: "12,10,30", pan1: "#2a1a45", pan2: "#1a1030", ov: "rgba(20,12,38,1)",
      acc: "#c77dff", acc1: "#d69bff", acc2: "#a855f7", hi: "#d69bff", hi2: "#e6c2ff", onAcc: "#1d0533" },
    { id: "ember", name: "Ember", sub: "Warm sunset coral", sky: false,
      bg: rg("#7a2e1d", "#5e1a3d", "#1a0b0b"), base: "#1a0b0b", shade: "26,11,11", pan1: "#3a1d1d", pan2: "#241111", ov: "rgba(34,14,14,1)",
      acc: "#ff7a59", acc1: "#ff9a7f", acc2: "#f0552f", hi: "#ff9a7f", hi2: "#ffc0ad", onAcc: "#2a0a00" },
    { id: "graphite", name: "Graphite", sub: "Minimal grey, narrow type", sky: false,
      bg: "linear-gradient(180deg,#2a2c30,#17181b)", base: "#17181b", shade: "20,20,22", pan1: "#2d2f33", pan2: "#202124", ov: "rgba(30,31,34,1)",
      acc: "#e6e6e6", acc1: "#f4f4f4", acc2: "#cccccc", hi: "#ffffff", hi2: "#ffffff", onAcc: "#111111",
      font: "'Roboto Condensed','sans-serif-condensed',Roboto,sans-serif" },
    { id: "nightred", name: "Night red", sub: "Black and dim red, easy on eyes in the dark", sky: false,
      bg: "#000", base: "#000", shade: "0,0,0", pan1: "#1a0606", pan2: "#0d0303", ov: "rgba(14,3,3,1)",
      acc: "#e0352b", acc1: "#ff5a4e", acc2: "#b8221a", hi: "#ff6b5e", hi2: "#ff8f85", onAcc: "#1a0000" },
    { id: "terminal", name: "Terminal", sub: "Retro green phosphor", sky: false,
      bg: "radial-gradient(120% 100% at 50% 40%,#0b2a12 0%,#020a04 70%)", base: "#020a04", shade: "2,10,4", pan1: "#0c2312", pan2: "#061409", ov: "rgba(4,16,7,1)",
      acc: "#39ff6a", acc1: "#6bff90", acc2: "#1fd14b", hi: "#6bff90", hi2: "#a6ffbd", onAcc: "#001a07",
      font: "'Droid Sans Mono','Roboto Mono',monospace" },
  ];
  function themeById(id) {
    for (var i = 0; i < THEMES.length; i++) if (THEMES[i].id === id) return THEMES[i];
    return THEMES[0];
  }
  function hexRgb(h) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h || "");
    return m ? parseInt(m[1], 16) + "," + parseInt(m[2], 16) + "," + parseInt(m[3], 16) : null;
  }
  var lastHass = null;
  function findHass() {
    var ha = document.querySelector("home-assistant");
    return (ha && ha.hass) || lastHass;
  }
  function isNight() {
    var h = findHass(), s = h && h.states["sun.sun"];
    return !!s && s.state === "below_horizon";
  }
  var activeTheme = null;
  function applyTheme() {
    var p = Prefs.all(), id = p.theme || "midnight";
    if (p.theme_night && isNight()) id = p.theme_night;
    var t = themeById(id);
    if (activeTheme === t.id) return;
    activeTheme = t.id;
    var vars = {
      "--es-bg": t.bg, "--es-base": t.base, "--es-shade-rgb": t.shade, "--es-pan1": t.pan1, "--es-pan2": t.pan2, "--es-ov": t.ov,
      "--es-acc": t.acc, "--es-acc-rgb": hexRgb(t.acc), "--es-acc1": t.acc1, "--es-acc2": t.acc2, "--es-acc2-rgb": hexRgb(t.acc2),
      "--es-hi": t.hi, "--es-hi2": t.hi2, "--es-on-acc": t.onAcc, "--es-font": t.font,
    };
    var st = document.documentElement.style;
    for (var k in vars) { if (vars[k]) st.setProperty(k, vars[k]); else st.removeProperty(k); }
    window.dispatchEvent(new CustomEvent("echo-show-prefs", { detail: { key: "theme_active", value: t.id } }));
  }
  window.addEventListener("echo-show-prefs", function (ev) {
    var k = ev.detail && ev.detail.key;
    if (k === "theme" || k === "theme_night") applyTheme();
  });
  applyTheme();
  setInterval(applyTheme, 60000);   // switches at sunset / sunrise when a night theme is set

  // ---------- dashboard config (top-level echo_show block + the cards in it) ----------
  var dashCache = {};
  function dashboardConfig(hass) {
    var dash = window.location.pathname.split("/")[1] || "lovelace";
    if (!dashCache[dash]) {
      dashCache[dash] = hass.callWS({ type: "lovelace/config", url_path: dash === "lovelace" ? null : dash })
        .then(function (c) { return c || {}; }, function () { delete dashCache[dash]; return {}; });
    }
    return dashCache[dash];
  }
  function cardsOfType(cfg, type) {
    var out = [];
    function walk(o) {
      if (!o || typeof o !== "object") return;
      if (Array.isArray(o)) { o.forEach(walk); return; }
      if (o.type === type) out.push(o);
      ["views", "cards", "sections", "card"].forEach(function (k) { if (o[k]) walk(o[k]); });
    }
    walk(cfg.views || []);
    return out;
  }

  // ---------- Kiosk Satellite device entities ----------
  function slugify(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  }
  // switch.<slug>_<suffix>; Kiosk Satellite sometimes adds the area again (switch.kitchen_kitchen_echo_show_8_x).
  function devEnt(hass, slug, domain, suffix) {
    if (!slug || !hass) return null;
    var direct = domain + "." + slug + "_" + suffix;
    if (hass.states[direct]) return direct;
    var tail = slug + "_" + suffix, pre = domain + ".";
    for (var id in hass.states) {
      if (id.indexOf(pre) === 0 && id.length > tail.length && id.slice(-tail.length - 1) === "_" + tail) return id;
    }
    return null;
  }
  function hasDevice(hass, slug) {
    for (var id in hass.states) {
      var o = id.slice(id.indexOf(".") + 1);
      if (o.indexOf(slug + "_") === 0 || o.indexOf("_" + slug + "_") !== -1) return true;
    }
    return false;
  }
  // The display's entity prefix: a matching devices entry, else derived from the Kiosk Satellite
  // name, else the configured default (which would otherwise steer every display to one tablet).
  function resolveDevice(hass, name, esCfg) {
    var prof = esCfg ? matchDisplay(esCfg.devices, name) : null;
    if (prof && prof.device) return prof.device;
    var slug = slugify(name);
    if (slug && hasDevice(hass, slug)) return slug;
    if (name) {
      var ln = String(name).toLowerCase();
      for (var id in hass.states) {
        if (id.indexOf("assist_satellite.") === 0 && String(hass.states[id].attributes.friendly_name || "").toLowerCase() === ln) return id.split(".")[1];
      }
    }
    return (esCfg && esCfg.device) || null;
  }

  // ---------- this display's own timer set: timer.<device>_timer_1..3 + input_text.<device>_timer_N_name ----------
  var ownSlug;                          // undefined until asked, then the device slug (or null)
  function timerSetOf(slug) { return slug ? slug + "_timer" : null; }
  function hasTimerSet(hass, prefix) { return !!(prefix && hass && hass.states["timer." + prefix + "_1"]); }
  // The display's own timer prefix when its helpers exist, else null (cards then use their configured timers).
  // Synchronous for render code: the first call starts the lookup and the next hass update has the answer.
  function ownTimerPrefix(hass) {
    if (!hass) return null;
    if (ownSlug === undefined) {
      ownSlug = null;
      Promise.all([echoDisplayName(), dashboardConfig(hass)]).then(function (r) {
        ownSlug = resolveDevice(hass, r[0], (r[1] || {}).echo_show) || null;
        // Cards re-render with their own timers and area once this is known.
        if (ownSlug) window.dispatchEvent(new CustomEvent("echo-show-device", { detail: { device: ownSlug } }));
      }, function () { /* stays null */ });
    }
    var p = timerSetOf(ownSlug);
    return hasTimerSet(hass, p) ? p : null;
  }
  // The Home Assistant area of an entity (its own, else its device's).
  function areaOf(hass, id) {
    var e = hass && hass.entities ? hass.entities[id] : null;
    if (!e) return null;
    return e.area_id || (e.device_id && hass.devices && hass.devices[e.device_id] ? hass.devices[e.device_id].area_id || null : null);
  }
  // This display's area: the first of its Kiosk Satellite entities that has one.
  function ownArea(hass) {
    ownTimerPrefix(hass);               // starts the device lookup
    if (!ownSlug || !hass || !hass.entities) return null;
    for (var id in hass.entities) {
      var o = id.slice(id.indexOf(".") + 1) + "_";
      if (o.indexOf(ownSlug + "_") !== 0 && o.indexOf("_" + ownSlug + "_") === -1) continue;
      var a = areaOf(hass, id);
      if (a) return a;
    }
    return null;
  }

  // ---------- settings panel ----------
  var TABS = [
    { id: "general", icon: "mdi:tablet", label: "General" },
    { id: "display", icon: "mdi:brightness-6", label: "Display" },
    { id: "look", icon: "mdi:palette-outline", label: "Look" },
    { id: "weather", icon: "mdi:weather-partly-cloudy", label: "Weather" },
    { id: "timers", icon: "mdi:timer-sand", label: "Timers" },
    { id: "alarms", icon: "mdi:alarm", label: "Alarms" },
    { id: "media", icon: "mdi:speaker-multiple", label: "Media" },
    { id: "alerts", icon: "mdi:alert-outline", label: "Alerts" },
    { id: "about", icon: "mdi:information-outline", label: "About" },
  ];

  var SET_STYLE = [
    ":host{position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147482000;display:flex;align-items:center;justify-content:center;background:rgba(3,6,14,.66);font-family:var(--es-font,var(--ha-font-family-body,Roboto,'Helvetica Neue',Arial,sans-serif));color:#fff;-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none;}",
    "ha-icon{display:inline-flex;}",
    ".panel{position:relative;display:flex;width:94vw;height:90vh;box-sizing:border-box;background:linear-gradient(180deg,var(--es-pan1,#1c2540),var(--es-pan2,#121829));border:1px solid rgba(255,255,255,.1);border-radius:3.4vh;box-shadow:0 20px 60px rgba(0,0,0,.6);overflow:hidden;}",
    /* left rail */
    ".rail{flex:0 0 25vw;box-sizing:border-box;padding:3vh 1.6vh 2vh;background:rgba(0,0,0,.18);border-right:1px solid rgba(255,255,255,.06);display:flex;flex-direction:column;overflow-y:auto;}",
    ".rail h1{margin:0 1.4vh 2.2vh;font-size:4.4vh;font-weight:400;}",
    ".tab{display:flex;align-items:center;height:8.2vh;padding:0 1.8vh;border-radius:2vh;font-size:3vh;cursor:pointer;color:rgba(255,255,255,.75);flex:0 0 auto;}",
    ".tab + .tab{margin-top:.6vh;}",
    ".tab ha-icon{--mdc-icon-size:3.8vh;width:3.8vh;height:3.8vh;margin-right:1.6vh;opacity:.8;}",
    ".tab.sel{background:rgba(var(--es-acc-rgb,255,159,10),.18);color:var(--es-hi2,#ffc266);}",
    ".tab.sel ha-icon{opacity:1;}",
    /* right side */
    ".side{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;}",
    ".hd{display:flex;align-items:center;padding:3vh 3.2vh 1.6vh;flex:0 0 auto;}",
    ".hd h2{margin:0;font-size:4.2vh;font-weight:400;flex:1 1 auto;}",
    ".done{font-size:3.2vh;padding:1.4vh 3.6vh;border-radius:3.5vh;background:linear-gradient(180deg,var(--es-acc1,#ffab2e),var(--es-acc2,#ff8a00));color:var(--es-on-acc,#1a1000);font-weight:500;cursor:pointer;}",
    ".body{flex:1 1 auto;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:0 3.2vh 3vh;touch-action:pan-y;}",
    ".body::-webkit-scrollbar{width:.6vh;}",
    ".body::-webkit-scrollbar-thumb{background:rgba(255,255,255,.2);border-radius:.3vh;}",
    ".sec{font-size:2.4vh;letter-spacing:.12em;text-transform:uppercase;opacity:.55;margin:2.6vh 0 1.3vh;}",
    ".sec:first-child{margin-top:.4vh;}",
    ".note{font-size:2.5vh;opacity:.6;line-height:1.4;margin:1vh 0;}",
    /* toggle tiles */
    ".tiles{display:grid;grid-template-columns:repeat(4,1fr);grid-gap:1.6vh;}",
    ".tiles.c3{grid-template-columns:repeat(3,1fr);}",
    ".tl{position:relative;height:15vh;border-radius:2.4vh;padding:1.8vh 2vh;box-sizing:border-box;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);cursor:pointer;display:flex;flex-direction:column;justify-content:space-between;}",
    ".tl ha-icon{--mdc-icon-size:4.6vh;width:4.6vh;height:4.6vh;opacity:.75;}",
    ".tl .n{font-size:2.9vh;line-height:1.15;}",
    ".tl .s{font-size:2.2vh;opacity:.55;margin-top:.3vh;}",
    ".tl.on{background:rgba(var(--es-acc-rgb,255,159,10),.18);border-color:rgba(var(--es-acc-rgb,255,159,10),.55);}",
    ".tl.on ha-icon{color:var(--es-hi,#ffb340);opacity:1;}",
    ".tl.on .s{color:var(--es-hi2,#ffc266);opacity:.9;}",
    ".tl.alert{background:rgba(255,80,70,.14);border-color:rgba(255,90,80,.5);}",
    ".tl.alert ha-icon,.tl.alert .s{color:#ff8a80;opacity:1;}",
    ".tl.na{opacity:.35;pointer-events:none;}",
    /* sliders */
    ".sl{display:flex;align-items:center;margin-bottom:1.6vh;}",
    ".sl ha-icon{--mdc-icon-size:4.2vh;width:4.2vh;height:4.2vh;opacity:.7;flex:0 0 auto;margin-right:2vh;}",
    ".sl .lb{flex:0 0 22vh;font-size:2.9vh;}",
    ".track{position:relative;flex:1 1 auto;height:7.6vh;border-radius:3.8vh;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.08);overflow:hidden;touch-action:none;cursor:ew-resize;}",
    ".fill{position:absolute;left:0;top:0;bottom:0;width:100%;background:linear-gradient(90deg,rgba(var(--es-acc2-rgb,255,138,0),.85),var(--es-hi,#ffb340));transform-origin:left;}",
    ".track .v{position:absolute;right:2.2vh;top:0;bottom:0;display:flex;align-items:center;font-size:2.6vh;font-variant-numeric:tabular-nums;text-shadow:0 0 .6vh rgba(0,0,0,.6);}",
    /* chips */
    ".chips{display:flex;flex-wrap:wrap;gap:1.2vh;}",
    ".chip{height:6.6vh;padding:0 2.6vh;border-radius:3.3vh;display:flex;align-items:center;font-size:2.7vh;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);cursor:pointer;white-space:nowrap;}",
    ".chip.sel{background:rgba(var(--es-acc-rgb,255,159,10),.2);border-color:rgba(var(--es-acc-rgb,255,159,10),.6);color:var(--es-hi2,#ffc266);}",
    /* list rows */
    ".row{display:flex;align-items:center;min-height:8.4vh;padding:0 2vh;border-radius:2vh;background:rgba(255,255,255,.045);cursor:pointer;}",
    ".row + .row{margin-top:1vh;}",
    ".row .t{flex:1 1 auto;min-width:0;font-size:2.9vh;}",
    ".row .t small{display:block;font-size:2.2vh;opacity:.55;margin-top:.3vh;}",
    ".row .r{font-size:2.6vh;opacity:.75;margin-left:2vh;white-space:nowrap;}",
    ".row.sel{background:rgba(var(--es-acc-rgb,255,159,10),.16);}",
    ".row.sel .r{color:var(--es-hi,#ffb340);opacity:1;}",
    ".row.static{cursor:default;}",
    /* switch (on/off pill) */
    ".sw{flex:0 0 auto;width:9vh;height:5vh;border-radius:2.5vh;background:rgba(255,255,255,.18);position:relative;margin-left:2vh;transition:background .2s;}",
    ".sw::after{content:'';position:absolute;left:.5vh;top:.5vh;width:4vh;height:4vh;border-radius:50%;background:#fff;transition:transform .2s;}",
    ".sw.on{background:var(--es-acc,#ff9f0a);}",
    ".sw.on::after{transform:translateX(4vh);}",
    /* buttons */
    ".btns{display:flex;flex-wrap:wrap;gap:1.4vh;}",
    ".bt{height:8vh;padding:0 3.2vh;border-radius:4vh;display:flex;align-items:center;font-size:2.9vh;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.1);cursor:pointer;}",
    ".bt ha-icon{--mdc-icon-size:3.6vh;width:3.6vh;height:3.6vh;margin-right:1.2vh;}",
    ".bt.go{background:linear-gradient(180deg,#3ad16a,#27a84f);border-color:transparent;}",
    ".tl:active,.chip:active,.row:active,.bt:active,.done:active,.tab:active{transform:scale(.97);}",
    /* alarm tones (Kiosk Satellite) */
    ".tgrid{display:grid;grid-template-columns:repeat(3,1fr);grid-gap:1.2vh;}",
    ".tn{height:8.4vh;border-radius:2vh;padding:0 2vh;display:flex;align-items:center;font-size:2.7vh;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);cursor:pointer;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;}",
    ".tn ha-icon{--mdc-icon-size:3.2vh;width:3.2vh;height:3.2vh;margin-right:1.2vh;opacity:.6;flex:0 0 auto;}",
    ".tn.sel{background:rgba(var(--es-acc-rgb,255,159,10),.2);border-color:rgba(var(--es-acc-rgb,255,159,10),.6);color:var(--es-hi2,#ffc266);}",
    ".tn.sel ha-icon{opacity:1;color:var(--es-hi,#ffb340);}",
    ".tn:active{transform:scale(.97);}",
    ".pin{width:100%;box-sizing:border-box;height:8vh;border-radius:2vh;border:1px solid rgba(255,255,255,.14);background:rgba(0,0,0,.2);color:#fff;font:inherit;font-size:2.9vh;padding:0 2.2vh;outline:none;-webkit-user-select:text;user-select:text;}",
    ".pin:focus{border-color:rgba(var(--es-acc-rgb,255,159,10),.7);}",
    ".note.warn{color:#ff9d94;opacity:1;}",
    ".bt.busy{opacity:.5;pointer-events:none;}",
    ".slrow{display:flex;align-items:center;gap:1.6vh;}",
    ".slrow .sl{flex:1 1 auto;margin-bottom:0;}",
    /* info grid */
    ".info{display:grid;grid-template-columns:1fr 1fr;grid-gap:1vh 2.4vh;}",
    ".kv{display:flex;justify-content:space-between;font-size:2.6vh;padding:1.2vh 0;border-bottom:1px solid rgba(255,255,255,.06);}",
    ".kv span:first-child{opacity:.55;}",
    ".kv span:last-child{text-align:right;margin-left:2vh;word-break:break-all;}",
    ".upd{color:var(--es-hi2,#ffc266);}",
    /* cleaning mode */
    /* theme picker */
    ".themes{display:grid;grid-template-columns:repeat(3,1fr);grid-gap:1.6vh;}",
    ".th{position:relative;height:17vh;border-radius:2.4vh;overflow:hidden;cursor:pointer;border:.3vh solid rgba(255,255,255,.1);box-sizing:border-box;color:#fff;}",
    ".th.sel{border-color:#fff;}",
    ".th .pv{position:absolute;left:0;top:0;right:0;bottom:0;}",
    ".th .pill{position:absolute;right:1.8vh;top:1.8vh;width:7vh;height:3.4vh;border-radius:1.7vh;}",
    ".th .bar{position:absolute;left:1.8vh;top:2.4vh;width:9vh;height:1vh;border-radius:.5vh;opacity:.9;}",
    ".th .bar2{top:4.4vh;width:6vh;opacity:.35;background:#fff;}",
    ".th .nm{position:absolute;left:1.8vh;bottom:1.4vh;right:1.8vh;font-size:2.9vh;line-height:1.1;}",
    ".th .nm small{display:block;font-size:2vh;opacity:.65;margin-top:.3vh;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
    ".th .ck{position:absolute;right:1.8vh;bottom:1.6vh;font-size:3vh;}",
    ".th:active{transform:scale(.97);}",
    ".clean{position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483600;background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;}",
    ".clean ha-icon{--mdc-icon-size:12vh;width:12vh;height:12vh;opacity:.6;}",
    ".clean .big{font-size:12vh;font-weight:300;margin-top:2vh;font-variant-numeric:tabular-nums;}",
    ".clean .sm{font-size:3vh;opacity:.6;margin-top:1vh;}",
  ].join("");

  function EchoShowSettings() {
    var self = Reflect.construct(HTMLElement, [], EchoShowSettings);
    self._hass = null;
    self._ctx = {};
    self._tab = "general";
    self._drag = null;
    self._local = {};      // entity -> value shown while waiting for HA after a change
    return self;
  }
  EchoShowSettings.prototype = Object.create(HTMLElement.prototype);
  EchoShowSettings.prototype.constructor = EchoShowSettings;
  Object.setPrototypeOf(EchoShowSettings, HTMLElement);

  Object.defineProperty(EchoShowSettings.prototype, "hass", {
    set: function (h) {
      this._hass = h;
      if (this._alarmEl) this._alarmEl.hass = h;
      if (this._built) this._refresh(false);
    },
    get: function () { return this._hass; },
  });

  EchoShowSettings.prototype._st = function (id) { return id && this._hass ? this._hass.states[id] : null; };
  EchoShowSettings.prototype._dev = function (domain, suffix) { return devEnt(this._hass, this._device, domain, suffix); };

  EchoShowSettings.prototype.open = function (hass, ctx) {
    var self = this;
    this._hass = hass;
    lastHass = hass || lastHass;
    this._ctx = ctx || {};
    this._mic = null;                   // re-read the tablet's microphone mute on every open
    if (this._ctx.tab) this._tab = this._ctx.tab;
    this._build();
    document.body.appendChild(this);
    Promise.all([echoDisplayName(), dashboardConfig(hass)]).then(function (r) {
      self._name = r[0];
      self._dash = r[1] || {};
      self._es = self._dash.echo_show || {};
      self._device = resolveDevice(self._hass, self._name, self._es);
      self._paintTabs();
      self._refresh(true);
    });
  };

  EchoShowSettings.prototype._build = function () {
    if (this._built) return;
    var self = this, root = this.attachShadow({ mode: "open" });
    root.innerHTML = "<style>" + SET_STYLE + "</style>" +
      '<div class="panel"><div class="rail"><h1>Settings</h1><div class="tabs"></div></div>' +
      '<div class="side"><div class="hd"><h2></h2><div class="done" role="button">Done</div></div><div class="body"></div></div></div>';
    this._tabsEl = root.querySelector(".tabs");
    this._bodyEl = root.querySelector(".body");
    this._titleEl = root.querySelector(".hd h2");
    // Keep touches here: no swipe-between-views underneath.
    ["touchstart", "touchmove", "touchend", "touchcancel", "pointerdown", "mousedown", "wheel"].forEach(function (t) {
      self.addEventListener(t, function (ev) { ev.stopPropagation(); }, { passive: true });
    });
    this.addEventListener("click", function (ev) {
      var path = ev.composedPath ? ev.composedPath() : [];
      if (path[0] === self) self.close();  // backdrop
    });
    root.querySelector(".done").addEventListener("click", function () { self.close(); });
    this._tabsEl.addEventListener("click", function (ev) {
      var t = ev.target.closest ? ev.target.closest(".tab") : null;
      if (!t) return;
      self._tab = t.getAttribute("data-t");
      self._paintTabs();
      self._refresh(true);
    });
    this._bodyEl.addEventListener("click", function (ev) {
      var t = ev.target.closest ? ev.target.closest("[data-a]") : null;
      if (t) self._act(t.getAttribute("data-a"), t);
    });
    // Sliders: drag to set, sent on release.
    this._bodyEl.addEventListener("pointerdown", function (ev) {
      var tr = ev.target.closest ? ev.target.closest(".track") : null;
      if (!tr) return;
      self._drag = { el: tr, id: tr.getAttribute("data-id") };
      try { tr.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
      self._slide(ev.clientX);
      ev.preventDefault();
    });
    this._bodyEl.addEventListener("pointermove", function (ev) { if (self._drag) self._slide(ev.clientX); });
    var end = function () { if (self._drag) { self._commitSlide(); self._drag = null; } };
    this._bodyEl.addEventListener("pointerup", end);
    this._bodyEl.addEventListener("pointercancel", end);
    this._built = true;
    this._paintTabs();
  };

  // Which tabs make sense on this dashboard / display.
  EchoShowSettings.prototype._tabsShown = function () {
    var d = this._dash || {}, has = {};
    has.general = true;
    has.display = true;
    has.look = true;
    has.weather = cardsOfType(d, "custom:echo-weather-card").length > 0;
    has.timers = cardsOfType(d, "custom:echo-timer-card").length + cardsOfType(d, "custom:echo-clock-card").length > 0;
    has.alarms = cardsOfType(d, "custom:echo-timer-card").concat(cardsOfType(d, "custom:echo-clock-card")).some(function (c) { return c.alarms !== false; });
    has.media = cardsOfType(d, "custom:echo-media-card").length > 0;
    has.alerts = !!d.echo_notify;
    has.about = true;
    if (!this._dash) { has.weather = has.timers = has.alarms = has.media = true; }
    return TABS.filter(function (t) { return has[t.id]; });
  };

  EchoShowSettings.prototype._paintTabs = function () {
    var tabs = this._tabsShown(), h = "", self = this;
    if (!tabs.some(function (t) { return t.id === self._tab; })) this._tab = "general";
    tabs.forEach(function (t) {
      h += '<div class="tab' + (t.id === self._tab ? " sel" : "") + '" role="button" data-t="' + t.id + '"><ha-icon icon="' + t.icon + '"></ha-icon>' + t.label + "</div>";
    });
    this._tabsEl.innerHTML = h;
    var cur = TABS.filter(function (t) { return t.id === self._tab; })[0];
    this._titleEl.textContent = cur ? cur.label : "";
  };

  // Re-render the open tab when something it shows changed (not while dragging).
  EchoShowSettings.prototype._refresh = function (force) {
    if (!this._built || !this._hass || this._drag) return;
    if (this._tab === "alarms" && !this._ks) this._ksLoad();
    if (this._tab === "general" && this._device && !this._mic && !this._micEntity()) this._micLoad();
    var ae = this.shadowRoot.activeElement;
    if (ae && ae.tagName === "INPUT") return;      // don't wipe what is being typed
    var html = this["_tab_" + this._tab] ? this["_tab_" + this._tab]() : "";
    if (!force && html === this._html) return;
    this._html = html;
    var top = force ? 0 : this._bodyEl.scrollTop;
    if (this._tab !== "timers" && this._alarmEl) { this._alarmEl._putBack && this._alarmEl._putBack(); this._alarmEl = null; }
    this._bodyEl.innerHTML = html;
    this._bodyEl.scrollTop = top;
    if (this._tab === "timers") this._mountAlarm();
    if (this._tab === "alarms") this._bindPhrase();
  };

  // --- small builders ---
  EchoShowSettings.prototype._tile = function (id, icon, label, on, sub, act) {
    if (!id) return "";
    var st = this._st(id), na = id.indexOf(".") > 0 && (!st || st.state === "unavailable");   // ids without a dot aren't entities
    return '<div class="tl' + (on ? " on" : "") + (na ? " na" : "") + '" role="button" data-a="' + (act || "toggle") + '" data-id="' + esc(id) + '">' +
      '<ha-icon icon="' + icon + '"></ha-icon><div><div class="n">' + esc(label) + '</div><div class="s">' + esc(na ? "Unavailable" : sub) + "</div></div></div>";
  };
  EchoShowSettings.prototype._isOn = function (id) {
    if (this._local[id] && this._local[id].until > Date.now()) return this._local[id].v === "on";
    var s = this._st(id);
    return !!s && s.state === "on";
  };
  EchoShowSettings.prototype._slider = function (id, icon, label, val, min, max, unit, kind) {
    if (!id) return "";
    var f = max > min ? clamp((val - min) / (max - min), 0, 1) : 0;
    return '<div class="sl"><ha-icon icon="' + icon + '"></ha-icon><div class="lb">' + esc(label) + "</div>" +
      '<div class="track" data-id="' + esc(id) + '" data-kind="' + kind + '" data-min="' + min + '" data-max="' + max + '" data-unit="' + esc(unit) + '">' +
      '<div class="fill" style="transform:scaleX(' + f.toFixed(3) + ')"></div><div class="v">' + Math.round(val) + esc(unit) + "</div></div></div>";
  };
  EchoShowSettings.prototype._chips = function (opts, cur, act, extra) {
    var h = '<div class="chips">';
    opts.forEach(function (o) {
      var v = typeof o === "object" ? o.v : o, l = typeof o === "object" ? o.l : o;
      h += '<div class="chip' + (String(v) === String(cur) ? " sel" : "") + '" role="button" data-a="' + act + '" data-v="' + esc(v) + '"' + (extra || "") + ">" + esc(l) + "</div>";
    });
    return h + "</div>";
  };
  EchoShowSettings.prototype._switchRow = function (title, sub, on, act, data) {
    return '<div class="row" role="button" data-a="' + act + '"' + (data || "") + '><div class="t">' + esc(title) + (sub ? "<small>" + esc(sub) + "</small>" : "") +
      '</div><div class="sw' + (on ? " on" : "") + '"></div></div>';
  };
  EchoShowSettings.prototype._noDevice = function () {
    return '<div class="note">This display isn\'t linked to its Kiosk Satellite controls' + (this._name ? ' ("' + esc(this._name) + '")' : "") +
      ". Add <b>echo_show: device: &lt;entity prefix&gt;</b> to the dashboard's raw config, e.g. <b>kitchen_echo_show_8</b> for switch.kitchen_echo_show_8_mute.</div>";
  };

  // --- Microphone: Kiosk Satellite's "Mute microphone" (setting voice.mute) ---
  // switch.<dev>_vs_mute is that setting itself (Settings > ESPHome > Expose kiosk entities), so any
  // display that exposes it works with no per-tablet setup. Without it, the setting is changed over
  // the tablet's Remote API through shell_command.echo_kiosk, the same route as the Alarms tab.
  // switch.<dev>_mute is the old dashboard Voice Satellite's mute and doesn't stop the native wake
  // word, so it is only a last resort.
  EchoShowSettings.prototype._micEntity = function () {
    var vs = this._dev("switch", "vs_mute"), st = vs && this._st(vs);
    return st && st.state !== "unavailable" ? vs : null;
  };
  EchoShowSettings.prototype._micLoad = function () {
    var self = this;
    this._mic = { loading: true };
    this._ksCall("mic").then(function (r) {
      self._mic = r && r.ok ? { api: true, muted: !!r.muted } : { api: false, why: (r && (r.message || r.error)) || "" };
      if (self._tab === "general") self._refresh(false);
    });
  };
  EchoShowSettings.prototype._micState = function () {
    var m = this._mic || {}, vs = this._micEntity(), old = this._dev("switch", "mute");
    var hold = this._local.mic && this._local.mic.until > Date.now() ? this._local.mic.v : undefined;
    if (vs) return { muted: hold !== undefined ? hold : this._isOn(vs), via: "entity", id: vs };
    if (m.api) return { muted: hold !== undefined ? hold : m.muted, via: "api" };
    if (m.loading) return { muted: hold !== undefined ? hold : null, via: "wait" };
    if (old) return { muted: hold !== undefined ? hold : this._isOn(old), via: "entity", id: old, legacy: true };
    return null;
  };
  EchoShowSettings.prototype._micHelp = function () {
    return "Turn on <b>Expose kiosk entities</b> under Settings &gt; ESPHome in Kiosk Satellite on this display, so Home Assistant gets its VS Mute switch." +
      (this._mic && this._mic.why ? " (Remote API: " + esc(this._mic.why) + ")" : "");
  };
  EchoShowSettings.prototype._micToggle = function () {
    var self = this, ms = this._micState();
    if (!ms || ms.muted === null || ms.via === "wait") return;
    var want = !ms.muted;
    this._local.mic = { v: want, until: Date.now() + 8000 };
    if (this._mic) this._mic.msg = null;
    this._refresh(false);
    if (ms.via === "entity") {
      this._hass.callService("switch", want ? "turn_on" : "turn_off", { entity_id: ms.id });
      return;
    }
    this._ksCall("mic_set", { muted: want }).then(function (r) {
      var m = self._mic || (self._mic = { api: true });
      if (r && typeof r.muted === "boolean") m.muted = r.muted;
      if (!r || !r.ok) {
        m.msg = "Couldn't " + (want ? "turn the microphone off" : "turn the microphone on") + ": " + ((r && (r.message || r.error)) || "no answer from the tablet.");
        self._local.mic = null;
      } else self._local.mic = { v: r.muted, until: Date.now() + 4000 };
      if (self._tab === "general") self._refresh(false);
    });
  };

  // --- tabs ---
  EchoShowSettings.prototype._tab_general = function () {
    if (!this._device) return this._noDevice();
    var cam = this._dev("switch", "camera_enabled");
    var wake = this._dev("switch", "vs_chimes") || this._dev("switch", "wake_sound"), sat = this._dev("switch", "voice_satellite");
    var vol = this._dev("number", "volume"), avol = this._dev("number", "assistant_volume"), mvol = this._dev("number", "media_volume");
    var sens = this._dev("select", "vs_wake_word_sensitivity") || this._dev("select", "wake_word_sensitivity");
    var h = '<div class="sec">Privacy</div><div class="tiles">';
    var ms = this._micState();
    if (ms) {
      var muted = ms.muted, mt = this._tile("mic", muted ? "mdi:microphone-off" : "mdi:microphone", "Microphone", muted === false,
        muted === null ? "…" : muted ? "Off · not listening" : "On", "mic");
      h += muted ? mt.replace('class="tl', 'class="tl alert') : mt;
    }
    if (cam) { var c = this._isOn(cam); h += this._tile(cam, c ? "mdi:camera" : "mdi:camera-off", "Camera", c, c ? "On" : "Off · motion wake off too", "toggle"); }
    var rtsp = this._dev("switch", "rtsp_streaming");
    if (rtsp) { var rs = this._isOn(rtsp); h += this._tile(rtsp, rs ? "mdi:cctv" : "mdi:cctv-off", "Video stream", rs, rs ? "Streaming to the network" : "Off", "toggle"); }
    if (sat) { var s = this._isOn(sat); h += this._tile(sat, s ? "mdi:account-voice" : "mdi:account-voice-off", "Voice assistant", s, s ? "On" : "Off", "toggle"); }
    if (wake) { var w = this._isOn(wake); h += this._tile(wake, w ? "mdi:bullhorn" : "mdi:bullhorn-outline", "Wake sound", w, w ? "Beep when listening" : "Silent", "toggle"); }
    h += "</div>";
    if (this._mic && this._mic.msg) h += '<div class="note warn">' + esc(this._mic.msg) + "</div>";
    else if (ms && ms.legacy) h += '<div class="note warn">Microphone is using the old mute switch, which may not stop the wake word. ' + this._micHelp() + "</div>";
    else if (!ms && this._mic && !this._mic.loading) h += '<div class="note warn">No microphone control for this display. ' + this._micHelp() + "</div>";
    if (vol || avol || mvol) {
      h += '<div class="sec">Volume</div>';
      if (vol) h += this._slider(vol, "mdi:volume-high", "Device", this._numVal(vol), 0, 100, "%", "number");
      if (avol) h += this._slider(avol, "mdi:account-voice", "Assistant", this._numVal(avol), 0, 100, "%", "number");
      if (mvol) h += this._slider(mvol, "mdi:music-note", "Media", this._numVal(mvol), 0, 100, "%", "number");
    }
    if (sens) {
      var ss = this._st(sens);
      h += '<div class="sec">Wake word sensitivity</div>' + this._chips((ss && ss.attributes.options) || [], this._selVal(sens), "select", ' data-id="' + esc(sens) + '"');
    }
    return h;
  };

  EchoShowSettings.prototype._tab_display = function () {
    var h = "";
    if (this._device) {
      var scr = this._dev("light", "screen"), adapt = this._dev("switch", "adaptive_brightness");
      var keep = this._dev("switch", "keep_screen_on"), sto = this._dev("number", "screensaver_timeout");
      var smode = this._dev("select", "screensaver_mode");
      if (scr || adapt || keep) {
        h += '<div class="sec">Screen</div>';
        if (scr) {
          var st = this._st(scr), b = this._local[scr] && this._local[scr].until > Date.now() ? this._local[scr].v : (st && st.attributes.brightness !== undefined && st.attributes.brightness !== null ? st.attributes.brightness / 2.55 : 0);
          h += this._slider(scr, "mdi:brightness-6", "Brightness", b, 0, 100, "%", "light");
        }
        h += '<div class="tiles c3">';
        if (adapt) { var a = this._isOn(adapt); h += this._tile(adapt, "mdi:brightness-auto", "Auto brightness", a, a ? "Follows room light" : "Off", "toggle"); }
        if (keep) { var k = this._isOn(keep); h += this._tile(keep, "mdi:lightbulb-on-outline", "Keep screen on", k, k ? "On" : "Off", "toggle"); }
        h += '<div class="tl" role="button" data-a="clean"><ha-icon icon="mdi:spray-bottle"></ha-icon><div><div class="n">Clean screen</div><div class="s">Locks touch for 30 s</div></div></div>';
        h += "</div>";
      }
      if (sto) {
        var t = this._numVal(sto);
        h += '<div class="sec">Screensaver after</div>' + this._chips([{ v: 60, l: "1 min" }, { v: 120, l: "2 min" }, { v: 300, l: "5 min" }, { v: 600, l: "10 min" }, { v: 900, l: "15 min" }, { v: 1800, l: "30 min" }, { v: 3600, l: "1 hr" }], Math.round(t), "number", ' data-id="' + esc(sto) + '"');
      }
      var mot = this._dev("switch", "screensaver_motion_detection"), face = this._dev("switch", "screensaver_face_detection");
      if (mot || face) {
        h += '<div class="sec">Wake from screensaver</div><div class="tiles c3">';
        if (mot) { var mo = this._isOn(mot); h += this._tile(mot, "mdi:motion-sensor", "Motion", mo, mo ? "Wakes when you walk up" : "Off", "toggle"); }
        if (face) { var fo = this._isOn(face); h += this._tile(face, "mdi:face-recognition", "Face", fo, fo ? "Wakes when it sees a face" : "Off", "toggle"); }
        h += "</div>";
      }
      if (smode) {
        var sm = this._st(smode);
        var opts = ((sm && sm.attributes.options) || []).filter(function (o) { return /^(Dim|Black|Clock|Weather Mood|Photo Gallery)$/.test(o) || o === (sm && sm.state); });
        h += '<div class="sec">Screensaver style</div>' + this._chips(opts, this._selVal(smode), "select", ' data-id="' + esc(smode) + '"');
      }
    } else {
      h += this._noDevice();
      h += '<div class="btns" style="margin:1vh 0 2vh"><div class="bt" role="button" data-a="clean"><ha-icon icon="mdi:spray-bottle"></ha-icon>Clean screen (30 s)</div></div>';
    }
    var ov = Prefs.get("overlay");
    h += '<div class="sec">Timer countdown on other pages</div>' + this._chips([{ v: "auto", l: "Automatic" }, { v: "top-right", l: "Top right" }, { v: "top-left", l: "Top left" }, { v: "bottom-right", l: "Bottom right" }, { v: "bottom-left", l: "Bottom left" }, { v: "off", l: "Off" }], ov, "pref", ' data-k="overlay"');
    if (this._device) h += '<div class="sec">Volume level when it changes</div>' + this._chips([{ v: "on", l: "Show" }, { v: "off", l: "Off" }], Prefs.get("volume_hud"), "pref", ' data-k="volume_hud"');
    return h;
  };

  EchoShowSettings.prototype._tab_look = function () {
    var p = Prefs.all(), cur = p.theme || "midnight", h = '<div class="sec">Theme</div><div class="themes">';
    THEMES.forEach(function (t) {
      var bg = t.bg || "radial-gradient(110% 90% at 0% 0%,#223567 0%,transparent 60%),radial-gradient(90% 80% at 100% 100%,#0d3b4f 0%,transparent 60%),#0a1022";
      var acc = t.acc || "#ff9f0a", acc2 = t.acc2 || "#ff8a00";
      h += '<div class="th' + (t.id === cur ? " sel" : "") + '" role="button" data-a="pref" data-k="theme" data-v="' + t.id + '"' + (t.font ? ' style="font-family:' + esc(t.font) + '"' : "") + ">" +
        '<div class="pv" style="background:' + esc(bg) + '"></div><div class="bar" style="background:' + acc + '"></div><div class="bar bar2"></div>' +
        '<div class="pill" style="background:linear-gradient(180deg,' + (t.acc1 || "#ffab2e") + "," + acc2 + ')"></div>' +
        '<div class="nm">' + esc(t.name) + "<small>" + esc(t.sub) + "</small></div>" + (t.id === cur ? '<div class="ck">✓</div>' : "") + "</div>";
    });
    h += "</div>";
    h += '<div class="sec">After sunset</div>' + this._chips([{ v: "", l: "Keep the same theme" }].concat(THEMES.filter(function (t) { return t.id !== cur; }).map(function (t) { return { v: t.id, l: t.name }; })), p.theme_night || "", "pref", ' data-k="theme_night"');
    h += '<div class="note">Switches automatically between sunset and sunrise (from Home Assistant\'s sun.sun).</div>';
    if (cardsOfType(this._dash || {}, "custom:echo-weather-card").length || !this._dash) {
      var th = themeById(activeTheme || cur), sky = p.weather_sky === null || p.weather_sky === undefined ? th.sky !== false : p.weather_sky;
      h += '<div class="sec">Weather page</div>' + this._switchRow("Live sky background", "Blue by day, dark at night and grey when it rains. Off uses the theme's background.", sky, "prefbool", ' data-k="weather_sky" data-v="' + (sky ? "0" : "1") + '"');
    }
    return h;
  };

  EchoShowSettings.prototype._tab_weather = function () {
    var cards = cardsOfType(this._dash || {}, "custom:echo-weather-card"), c = cards[0];
    if (!c) return '<div class="note">There\'s no weather page on this dashboard.</div>';
    var key = "echo-weather-card:source:" + (c.storage_key || "default"), cur = 0;
    try { cur = parseInt(window.localStorage.getItem(key), 10) || 0; } catch (e) { cur = 0; }
    var h = '<div class="sec">Weather source</div>', self = this;
    (c.sources || []).forEach(function (s, i) {
      var st = s.entity ? self._st(s.entity) : self._st(s.temperature);
      var temp = st ? (s.entity && s.entity.indexOf("weather.") === 0 ? num(st.attributes.temperature) : num(st.state)) : null;
      var sub = s.entity && s.entity.indexOf("weather.") === 0 ? (st ? "Forecast + current conditions" : "Unavailable") : "Current temperature only";
      h += '<div class="row' + (i === cur ? " sel" : "") + '" role="button" data-a="wsource" data-k="' + esc(key) + '" data-v="' + i + '"><div class="t">' + esc(s.name || s.entity || "Source " + (i + 1)) + "<small>" + esc(sub) + '</small></div><div class="r">' + (temp === null ? "" : Math.round(temp) + "°") + (i === cur ? " ✓" : "") + "</div></div>";
    });
    var p = Prefs.all();
    var anim = p.weather_animations === null ? c.animations !== false : p.weather_animations;
    h += '<div class="sec">Display</div>';
    h += this._switchRow("Animated weather", "Rain, snow, clouds and sun effects", anim, "prefbool", ' data-k="weather_animations" data-v="' + (anim ? "0" : "1") + '"');
    h += this._switchRow("Wind in the hourly forecast", "Speed and direction under each hour", p.weather_wind !== false, "prefbool", ' data-k="weather_wind" data-v="' + (p.weather_wind !== false ? "0" : "1") + '"');
    return h;
  };

  EchoShowSettings.prototype._tab_timers = function () {
    var h = "", p = timerSetOf(this._device), ts = this._tset || {};
    if (this._device && !hasTimerSet(this._hass, p)) {
      h += '<div class="sec">This display\'s timers</div>' +
        '<div class="note warn">This display is using the shared timers, so its timers also show on other displays that have no set of their own.</div>' +
        '<div class="btns"><div class="bt go' + (ts.busy ? " busy" : "") + '" role="button" data-a="tset"><ha-icon icon="mdi:timer-plus-outline"></ha-icon>' +
        (ts.busy ? "Setting up…" : "Set up timers for this display") + "</div></div>" +
        (ts.err ? '<div class="note warn">' + esc(ts.err) + "</div>" : "");
    } else if (ts.done) {
      h += '<div class="note">This display now has its own timers (timer.' + esc(p) + "_1 to _3).</div>";
    }
    return h + '<div class="sec">Alarm</div><div class="alarm"></div>' +
      '<div class="note">Volume and tone are shared by every display and by the "alarm when finished" automation.</div>';
  };
  // Creates timer.<device>_timer_1..3 and input_text.<device>_timer_1..3_name. Home Assistant only lets an
  // administrator create helpers, so a display signed in as another user gets told what to create instead.
  EchoShowSettings.prototype._timerSetup = function () {
    var self = this, h = this._hass, slug = this._device, p = timerSetOf(slug);
    if (!slug || (this._tset && this._tset.busy)) return;
    var label = slugify(this._name) === slug ? String(this._name) : slug.replace(/_/g, " ").replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); });
    this._tset = { busy: true };
    this._refresh(false);
    var steps = [];
    [1, 2, 3].forEach(function (i) {
      if (!h.states["timer." + p + "_" + i]) steps.push({ type: "timer/create", name: label + " Timer " + i, icon: "mdi:timer-outline", duration: "00:05:00", restore: true });
      if (!h.states["input_text." + p + "_" + i + "_name"]) steps.push({ type: "input_text/create", name: label + " Timer " + i + " Name", icon: "mdi:label-outline", min: 0, max: 40, mode: "text" });
    });
    steps.reduce(function (pr, msg) { return pr.then(function () { return h.callWS(msg); }); }, Promise.resolve()).then(function () {
      self._tset = { done: true };
      if (self._tab === "timers") self._refresh(true);
    }, function (e) {
      var m = (e && (e.message || e.code)) || "";
      self._tset = { err: /unauthor|admin|permission/i.test(m) || (e && e.code === "unauthorized")
        ? "Only a Home Assistant administrator can create timers. Sign this display in as an admin once and tap the button again, or create timer." + p + "_1 to _3 and input_text." + p + "_1_name to _3_name under Settings › Devices & services › Helpers."
        : "Couldn't create the timers: " + (m || "no answer from Home Assistant.") };
      if (self._tab === "timers") self._refresh(false);
    });
  };
  EchoShowSettings.prototype._mountAlarm = function () {
    var host = this._bodyEl.querySelector(".alarm");
    if (!host || !customElements.get("echo-alarm-settings")) return;
    var el = document.createElement("echo-alarm-settings");
    var cfg = {}, k;
    if (this._ctx.alarm) {
      for (k in this._ctx.alarm) cfg[k] = this._ctx.alarm[k];   // the timer card's own (per-display) settings
    } else {
      var tc = cardsOfType(this._dash || {}, "custom:echo-clock-card")[0] || cardsOfType(this._dash || {}, "custom:echo-timer-card")[0] || {};
      (tc.buttons || []).forEach(function (b) { if (b.settings) for (k in b.settings) if (k !== "device_volume_entity") cfg[k] = b.settings[k]; });
    }
    var es = (this._es && this._es.timers) || {};
    for (k in es) cfg[k] = es[k];
    // "Test" plays at the alarm volume on this display's own speaker.
    var dv = this._device ? this._dev("number", "volume") : null;
    if (dv) cfg.device_volume_entity = dv;
    if (this._ctx.timers) cfg.timers = this._ctx.timers;
    el.embedded = true;
    el.config = cfg;
    host.appendChild(el);
    el.hass = this._hass;
    this._alarmEl = el;
  };

  // --- Alarms: Kiosk Satellite's own alarm settings, through shell_command.echo_kiosk ---
  // (homeassistant/packages/echo_kiosk.yaml). The tablet's Remote API can't be called from
  // the page, so Home Assistant runs a small script that reads the tablet's URL and token
  // from secrets.yaml and makes the request.
  var KS_SNOOZE = ["5", "10", "15", "20", "25", "30"], KS_SILENCE = ["5", "10", "15", "20", "30"];
  var KS_SUNRISE = ["10", "15", "20", "25", "30"], KS_EASE = [10, 15, 20, 30, 45, 60, 90, 120];
  var KS_TONE_PREFIX = "Echo ";

  function toneLabel(f) {
    if (!f) return "Built-in";
    return String(f).replace(/\.[a-z0-9]+$/i, "").replace(new RegExp("^" + KS_TONE_PREFIX), "");
  }

  EchoShowSettings.prototype._ksKey = function (id) { return id; };

  EchoShowSettings.prototype._ksCall = function (op, data) {
    var h = this._hass, kiosk = ((this._name || "") + " " + (this._device || "")).trim();
    return h.callWS({ type: "call_service", domain: "shell_command", service: "echo_kiosk", service_data: { kiosk: kiosk, op: op, data: data || {} }, return_response: true })
      .then(function (r) {
        var res = (r && r.response) || {};
        try { return JSON.parse(res.stdout || ""); } catch (e) {
          return { ok: false, error: "bad_output", message: String(res.stderr || res.stdout || "The helper script gave no answer.").slice(0, 300) };
        }
      }, function (e) {
        var m = (e && e.message) || "";
        return /not found|unknown|echo_kiosk/i.test(m) || (e && e.code === "service_not_found")
          ? { ok: false, error: "no_service", message: "Home Assistant has no shell_command.echo_kiosk yet. Add packages/echo_kiosk.yaml and custom_templates/echo_kiosk.py, then restart Home Assistant." }
          : { ok: false, error: "call_failed", message: m || "The call failed." };
      });
  };

  EchoShowSettings.prototype._ksLoad = function () {
    var self = this;
    var keep = this._ks && this._ks.settings ? this._ks : null;
    this._ks = keep || { loading: true };
    this._ks.loading = true;
    this._ksCall("get").then(function (r) {
      if (r && r.ok) self._ks = { settings: r.settings || {}, sounds: r.sounds || [], tones: r.tones || [], tablet: r.tablet };
      else self._ks = keep ? (keep.loading = false, keep.msg = r.message || r.error, keep) : { err: (r && (r.message || r.error)) || "No answer." };
      if (self._tab === "alarms") self._refresh(false);
    });
  };

  EchoShowSettings.prototype._ksSet = function (key, value) {
    var self = this, ks = this._ks;
    if (!ks || !ks.settings) return;
    var patch = {};
    patch[key] = value;
    ks.settings[key] = value;           // show it now
    ks.msg = null;
    this._refresh(false);
    return this._ksCall("set", patch).then(function (r) {
      if (r && r.ok && r.settings) ks.settings = r.settings;
      else {
        ks.msg = (r && (r.errors && r.errors[key] || r.message || r.error)) || "The tablet didn't take that change.";
        if (r && r.settings) ks.settings = r.settings;
      }
      if (self._tab === "alarms") self._refresh(false);
      return r;
    });
  };

  EchoShowSettings.prototype._ksAct = function (a, el) {
    var self = this, ks = this._ks || {}, k = el.getAttribute("data-k"), v = el.getAttribute("data-v");
    if (a === "ks-retry") { this._ks = null; this._refresh(true); return; }
    if (!ks.settings) return;
    if (a === "ks-sel") this._ksSet(k, v);
    else if (a === "ks-num") this._ksSet(k, parseFloat(v));
    else if (a === "ks-bool") this._ksSet(k, !ks.settings[k]);
    else if (a === "ks-tone") {
      // Picking a tone plays it once at the alarm volume, like Kiosk Satellite does.
      var p = this._ksSet("alarms.tone", v);
      if (p) p.then(function () { self._ksCall("test", { tone: v || "builtin" }); });
    } else if (a === "ks-test") {
      this._ksCall("test", { tone: ks.settings["alarms.tone"] || "builtin" });
    } else if (a === "ks-install") {
      ks.installing = true;
      ks.msg = null;
      this._refresh(false);
      this._ksCall("install_tones").then(function (r) {
        ks.installing = false;
        if (r && r.ok) ks.sounds = r.sounds || ks.sounds;
        else ks.msg = (r && (r.message || r.error)) || "Couldn't add the tones.";
        if (self._tab === "alarms") self._refresh(false);
      });
    }
  };

  EchoShowSettings.prototype._bindPhrase = function () {
    var self = this, inp = this._bodyEl.querySelector(".pin");
    if (!inp) return;
    ["keydown", "keyup", "keypress"].forEach(function (t) {
      inp.addEventListener(t, function (ev) {
        ev.stopPropagation();
        if (t === "keydown" && ev.key === "Enter") inp.blur();
      });
    });
    inp.addEventListener("change", function () {
      var val = inp.value.trim();
      if (self._ks && self._ks.settings && val !== self._ks.settings["alarms.phrase"]) self._ksSet("alarms.phrase", val);
    });
    inp.addEventListener("blur", function () { setTimeout(function () { self._refresh(false); }, 50); });
  };

  EchoShowSettings.prototype._tab_alarms = function () {
    var ks = this._ks || { loading: true }, self = this;
    if (!ks.settings) {
      if (ks.err) return '<div class="note warn">' + esc(ks.err) + '</div><div class="btns"><div class="bt" role="button" data-a="ks-retry"><ha-icon icon="mdi:refresh"></ha-icon>Try again</div></div>' +
        '<div class="note">These are Kiosk Satellite\'s alarm settings on this tablet. See the Alarms section of the README for the one-time setup.</div>';
      return '<div class="note">Asking the tablet for its alarm settings\u2026</div>';
    }
    var s = ks.settings, h = "";
    if (ks.msg) h += '<div class="note warn">' + esc(ks.msg) + "</div>";
    var vol = Math.round((parseFloat(s["alarms.volume"]) || 0.7) * 100);
    h += '<div class="sec">Volume</div><div class="slrow">' + this._slider("alarms.volume", "mdi:alarm-light-outline", "Alarm", vol, 5, 100, "%", "ks") +
      '<div class="bt" role="button" data-a="ks-test"><ha-icon icon="mdi:play"></ha-icon>Test</div></div>';
    // tones: ours first, then the tablet's other sounds
    var cur = s["alarms.tone"] || "", sounds = ks.sounds || [], tones = ks.tones || [];
    var mine = sounds.filter(function (f) { return f.indexOf(KS_TONE_PREFIX) === 0; });
    var other = sounds.filter(function (f) { return f.indexOf(KS_TONE_PREFIX) !== 0; });
    var list = [""].concat(mine, other);
    h += '<div class="sec">Tone</div><div class="tgrid">';
    list.forEach(function (f) {
      h += '<div class="tn' + (f === cur ? " sel" : "") + '" role="button" data-a="ks-tone" data-v="' + esc(f) + '"><ha-icon icon="' + (f === cur ? "mdi:music-note" : "mdi:music-note-outline") + '"></ha-icon>' + esc(toneLabel(f)) + "</div>";
    });
    h += "</div>";
    var missing = tones.filter(function (t) { return sounds.indexOf(t) === -1; }).length;
    if (missing) {
      h += '<div class="btns" style="margin-top:1.4vh"><div class="bt go' + (ks.installing ? " busy" : "") + '" role="button" data-a="ks-install"><ha-icon icon="mdi:music-note-plus"></ha-icon>' +
        (ks.installing ? "Adding tones\u2026" : "Add " + missing + " more tone" + (missing > 1 ? "s" : "")) + "</div></div>";
    }
    h += '<div class="note">Picking a tone plays it once on the tablet at the alarm volume.</div>';
    function chips(key, opts, unit) {
      return self._chips(opts.map(function (o) { return { v: o, l: o + " " + unit }; }), s[key], "ks-sel", ' data-k="' + key + '"');
    }
    h += '<div class="sec">Snooze length</div>' + chips("alarms.snooze_minutes", KS_SNOOZE, "min");
    h += '<div class="sec">Stop ringing after</div>' + chips("alarms.silence_after_minutes", KS_SILENCE, "min");
    h += '<div class="sec">Ease in</div>' + this._switchRow("Start quiet and get louder", "For alarms that haven\u2019t chosen for themselves", !!s["alarms.ease_in"], "ks-bool", ' data-k="alarms.ease_in"');
    if (s["alarms.ease_in"]) {
      h += '<div style="margin-top:1.2vh">' + this._chips(KS_EASE.map(function (o) { return { v: o, l: o < 60 ? o + " s" : Math.floor(o / 60) + " min" + (o % 60 ? " " + (o % 60) + " s" : "") }; }),
        String(parseFloat(s["alarms.ease_in_seconds"])), "ks-num", ' data-k="alarms.ease_in_seconds"') + "</div>";
    }
    h += '<div class="sec">Sunrise length</div>' + chips("alarms.sunrise_minutes", KS_SUNRISE, "min") +
      '<div class="note">How long the screen brightens before an alarm that has Sunrise on.</div>';
    h += '<div class="sec">Spoken phrase</div><input class="pin" maxlength="120" value="' + esc(s["alarms.phrase"] || "") + '" placeholder="It\'s {time}. {label}">' +
      '<div class="note">Said between the rings by alarms with Speak when it rings on. {time}, {label} and {day} are filled in.</div>';
    h += '<div class="note">These are Kiosk Satellite\u2019s alarm settings on ' + esc(ks.tablet ? "the " + ks.tablet + " tablet" : "this tablet") + ' and apply to all of its alarms.</div>';
    return h;
  };

  EchoShowSettings.prototype._tab_media = function () {
    var c = cardsOfType(this._dash || {}, "custom:echo-media-card")[0];
    if (!c) return '<div class="note">There\'s no media page on this dashboard.</div>';
    var p = Prefs.all(), self = this;
    var prof = matchDisplay(c.devices, this._name) || {};
    var cfgRoom = prof.default_player !== undefined ? prof.default_player : c.default_player;
    var room = p.media_room !== null ? p.media_room : cfgRoom;
    var h = '<div class="sec">This display controls</div>';
    (c.players || []).forEach(function (pl) {
      if (typeof pl === "string") pl = { entity: pl };
      var st = self._st(pl.entity);
      var sub = st ? (st.state === "playing" ? "Playing · " + (st.attributes.media_title || "") : st.state === "paused" ? "Paused" : "Idle") : "Unavailable";
      h += '<div class="row' + (room === pl.entity ? " sel" : "") + '" role="button" data-a="mroom" data-v="' + esc(pl.entity) + '"><div class="t">' + esc(pl.name || (st && st.attributes.friendly_name) || pl.entity) +
        "<small>" + esc(sub) + '</small></div><div class="r">' + (room === pl.entity ? "✓" : "") + "</div></div>";
    });
    var lpe = c.local_player !== false && this._device ? "media_player." + this._device : null, lst = lpe ? this._st(lpe) : null;
    if (lst) h += '<div class="row' + (room === lpe ? " sel" : "") + '" role="button" data-a="mroom" data-v="' + esc(lpe) + '"><div class="t">This display<small>' + esc(lst.state === "playing" ? "Playing \u00b7 " + (lst.attributes.media_title || "") : lst.state === "paused" ? "Paused" : lst.state === "unavailable" ? "Unavailable" : "Idle") +
      '</small></div><div class="r">' + (room === lpe ? "\u2713" : "") + "</div></div>";
    h += '<div class="row' + (!room ? " sel" : "") + '" role="button" data-a="mroom" data-v=""><div class="t">No fixed room<small>Show whatever is playing</small></div><div class="r">' + (!room ? "✓" : "") + "</div></div>";
    var follow = p.media_follow !== null ? p.media_follow : c.follow_playing !== false;
    h += '<div class="sec">Behaviour</div>' + this._switchRow("Follow what's playing", "When this room is quiet, show another room that's playing", follow, "prefbool", ' data-k="media_follow" data-v="' + (follow ? "0" : "1") + '"');
    var ms = window.EchoShow.mediaStatus ? window.EchoShow.mediaStatus() : null;
    if (c.ma_url && c.ma_token) {
      h += '<div class="sec">Music Assistant</div><div class="row static"><div class="t">Live queue<small>' + esc(ms ? ms.detail : "Opens when the media page is first shown") +
        '</small></div><div class="r">' + esc(ms ? ms.label : "—") + "</div></div>";
    }
    return h;
  };

  EchoShowSettings.prototype._tab_alerts = function () {
    var n = window.echoNotify, d = (this._dash && this._dash.echo_notify) || {}, p = Prefs.all();
    var snd = p.notify_sound !== null ? p.notify_sound : d.sound !== false;
    var h = '<div class="sec">On this display</div>' + this._switchRow("Chime for new alerts", "Severe alerts can repeat until dismissed", snd, "prefbool", ' data-k="notify_sound" data-v="' + (snd ? "0" : "1") + '"');
    var st = n && n.status ? n.status() : null;
    if (st && st.nws) {
      h += '<div class="sec">National Weather Service</div><div class="row static"><div class="t">' + (st.nws.ok ? "Working" : "Can't reach weather.gov") +
        "<small>Last checked " + esc(new Date(st.nws.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })) + '</small></div><div class="r">' + (st.nws.ok ? st.nws.count + " active" : "") + "</div></div>";
    }
    h += '<div class="sec">Test</div><div class="btns">' +
      '<div class="bt" role="button" data-a="ntest"><ha-icon icon="mdi:bell-ring-outline"></ha-icon>Show a test alert here</div>' +
      '<div class="bt" role="button" data-a="nreset"><ha-icon icon="mdi:restore"></ha-icon>Show dismissed alerts again</div></div>' +
      '<div class="note">The test alert only appears on this display and doesn\'t chime.</div>';
    return h;
  };

  EchoShowSettings.prototype._tab_about = function () {
    var self = this, h = "";
    function kv(k, v, cls) { return v === null || v === undefined || v === "" ? "" : '<div class="kv"><span>' + esc(k) + '</span><span class="' + (cls || "") + '">' + esc(v) + "</span></div>"; }
    function sv(suffix, dom, fmt) { var id = self._dev(dom || "sensor", suffix), s = self._st(id); return s && s.state !== "unknown" && s.state !== "unavailable" ? (fmt ? fmt(s) : s.state) : null; }
    h += '<div class="sec">This display</div><div class="info">';
    h += kv("Name", this._name || "Unknown");
    h += kv("Linked as", this._device || "Not linked");
    if (this._device) {
      h += kv("IP address", sv("ipv4_address"));
      h += kv("Battery", sv("battery", "sensor", function (s) { return Math.round(num(s.state)) + "%"; }));
      h += kv("CPU temperature", sv("cpu_temperature", "sensor", function (s) { return Math.round(num(s.state)) + (s.attributes.unit_of_measurement || "°"); }));
      h += kv("Memory free", sv("ram_available", "sensor", function (s) { return Math.round(num(s.state)) + " MB"; }));
      h += kv("Android", sv("android_version"));
      var up = this._st(this._dev("update", "update"));
      if (up) {
        h += kv("Kiosk Satellite", up.attributes.installed_version);
        if (up.state === "on") h += kv("Update available", up.attributes.latest_version, "upd");
      }
    }
    h += "</div>";
    var esd = window.EchoShowDashboard;
    h += '<div class="sec">Dashboard</div><div class="info">' + kv("Echo Show Dashboard", esd ? esd.version : VERSION);
    if (esd && esd.cards) esd.cards.forEach(function (c) { var p = c.split(" "); h += kv(p[0], p[1]); });
    h += "</div>";
    if (this._device) {
      var cc = this._dev("button", "clear_cache"), ra = this._dev("button", "restart_app");
      h += '<div class="sec">Maintenance</div><div class="btns">';
      h += '<div class="bt" role="button" data-a="reload"><ha-icon icon="mdi:refresh"></ha-icon>Reload page</div>';
      if (cc) h += '<div class="bt" role="button" data-a="press" data-id="' + esc(cc) + '"><ha-icon icon="mdi:broom"></ha-icon>Clear cache</div>';
      if (ra) h += '<div class="bt" role="button" data-a="press" data-id="' + esc(ra) + '"><ha-icon icon="mdi:restart"></ha-icon>Restart app</div>';
      h += "</div>";
    } else {
      h += '<div class="sec">Maintenance</div><div class="btns"><div class="bt" role="button" data-a="reload"><ha-icon icon="mdi:refresh"></ha-icon>Reload page</div></div>';
    }
    return h;
  };

  // --- values ---
  EchoShowSettings.prototype._numVal = function (id) {
    if (this._local[id] && this._local[id].until > Date.now()) return this._local[id].v;
    var s = this._st(id), v = s ? num(s.state) : null;
    return v === null ? 0 : v;
  };
  EchoShowSettings.prototype._selVal = function (id) {
    if (this._local[id] && this._local[id].until > Date.now()) return this._local[id].v;
    var s = this._st(id);
    return s ? s.state : "";
  };
  EchoShowSettings.prototype._hold = function (id, v) { this._local[id] = { v: v, until: Date.now() + 4000 }; };

  // --- actions ---
  EchoShowSettings.prototype._act = function (a, el) {
    var h = this._hass, id = el.getAttribute("data-id"), v = el.getAttribute("data-v"), k = el.getAttribute("data-k");
    if (a === "mic") {
      this._micToggle();
    } else if (a === "toggle" && id) {
      var on = this._isOn(id);
      this._hold(id, on ? "off" : "on");
      h.callService(id.split(".")[0] === "light" ? "light" : "switch", on ? "turn_off" : "turn_on", { entity_id: id });
    } else if (a === "select" && id) {
      this._hold(id, v);
      h.callService("select", "select_option", { entity_id: id, option: v });
    } else if (a === "number" && id) {
      this._hold(id, parseFloat(v));
      h.callService("number", "set_value", { entity_id: id, value: parseFloat(v) });
    } else if (a === "press" && id) {
      h.callService("button", "press", { entity_id: id });
    } else if (a === "tset") {
      this._timerSetup();
    } else if (a === "reload") {
      var rl = this._device ? this._dev("button", "reload_page") : null;
      if (rl) h.callService("button", "press", { entity_id: rl }); else window.location.reload();
    } else if (a === "pref") {
      Prefs.set(k, v);
    } else if (a === "prefbool") {
      Prefs.set(k, v === "1");
    } else if (a === "wsource") {
      try { window.localStorage.setItem(k, v); } catch (e) { /* ignore */ }
      window.dispatchEvent(new CustomEvent("echo-show-prefs", { detail: { key: "weather_source", value: parseInt(v, 10) } }));
    } else if (a === "mroom") {
      Prefs.set("media_room", v || "");
    } else if (a === "ntest") {
      if (window.echoNotify) {
        this.close();
        window.echoNotify.show({ title: "Test alert", kicker: "Echo Show Dashboard", severity: "moderate", sound: false, message: "This is what an alert looks like on this display.\n\nTap Dismiss to close it." });
      }
      return;
    } else if (a === "nreset") {
      if (window.echoNotify) window.echoNotify.resetDismissed();
    } else if (a === "clean") {
      this._clean();
      return;
    } else if (a.indexOf("ks-") === 0) {
      this._ksAct(a, el);
      return;
    }
    this._refresh(true);
  };

  EchoShowSettings.prototype._slide = function (x) {
    var d = this._drag, tr = d.el, r = tr.getBoundingClientRect();
    var min = parseFloat(tr.getAttribute("data-min")), max = parseFloat(tr.getAttribute("data-max"));
    var f = clamp((x - r.left) / r.width, 0, 1);
    var v = Math.round((min + f * (max - min)) / 5) * 5;
    d.v = v;
    tr.querySelector(".fill").style.transform = "scaleX(" + ((v - min) / (max - min)).toFixed(3) + ")";
    tr.querySelector(".v").textContent = v + tr.getAttribute("data-unit");
  };
  EchoShowSettings.prototype._commitSlide = function () {
    var d = this._drag, kind = d.el.getAttribute("data-kind");
    if (d.v === undefined) return;
    if (kind !== "ks") this._hold(d.id, d.v);
    if (kind === "ks") { this._ksSet(this._ksKey(d.id), d.v / 100); return; }
    if (kind === "light") {
      if (d.v <= 0) this._hass.callService("light", "turn_on", { entity_id: d.id, brightness: 1 });
      else this._hass.callService("light", "turn_on", { entity_id: d.id, brightness_pct: d.v });
    } else {
      this._hass.callService("number", "set_value", { entity_id: d.id, value: d.v });
    }
  };

  // Cleaning mode: black screen that swallows touches for 30 s.
  EchoShowSettings.prototype._clean = function () {
    var self = this, el = document.createElement("div"), left = 30;
    el.className = "clean";
    el.innerHTML = '<ha-icon icon="mdi:spray-bottle"></ha-icon><div class="big">30</div><div class="sm">Touch is off while you clean the screen</div>';
    this.shadowRoot.appendChild(el);
    var big = el.querySelector(".big");
    var t = setInterval(function () {
      left--;
      big.textContent = left;
      if (left <= 0) { clearInterval(t); el.remove(); self.close(); }
    }, 1000);
  };

  EchoShowSettings.prototype.close = function () {
    if (this._alarmEl && this._alarmEl._putBack) this._alarmEl._putBack();
    if (window.EchoAlarmSound && window.EchoAlarmSound.hush) window.EchoAlarmSound.hush();
    this._alarmEl = null;
    if (this.parentNode) this.parentNode.removeChild(this);
    current = null;
    if (this.onclose) this.onclose();
  };

  if (!customElements.get("echo-show-settings")) customElements.define("echo-show-settings", EchoShowSettings);

  var current = null;
  // Open the settings panel from a card. ctx: { tab, timers: [timer ids] }.
  function openSettings(card, ctx) {
    if (current) return current;
    var el = document.createElement("echo-show-settings");
    current = el;
    el.onclose = function () { if (card) card._settingsEl = null; };
    el.open(card._hass, ctx);
    if (card) card._settingsEl = el;
    return el;
  }

  // ---------- timer overlay ----------
  // A big countdown floating over the weather / media pages while timers run. The card
  // puts one inside its root element and calls update(hass, [timer ids]) on changes.

  var OV_STYLE = [
    ":host{position:absolute;z-index:6;display:block;pointer-events:auto;font-family:var(--es-font,var(--ha-font-family-body,Roboto,'Helvetica Neue',Arial,sans-serif));color:#fff;-webkit-tap-highlight-color:transparent;}",
    ":host([hidden]){display:none;}",
    ":host(.top-right){top:2.4vh;right:2.6vh;}",
    ":host(.top-left){top:2.4vh;left:2.6vh;}",
    ":host(.bottom-right){bottom:13.5vh;right:2.6vh;}",
    ":host(.bottom-left){bottom:13.5vh;left:2.6vh;}",
    ":host(.media){top:11vh;left:1.4vh;}",
    ".box{min-width:27vw;max-width:34vw;background:var(--es-ov,rgba(10,14,28,1));border:1px solid rgba(255,255,255,.14);border-radius:2.8vh;box-shadow:0 1.6vh 4vh rgba(0,0,0,.5);padding:1vh 2.2vh;box-sizing:border-box;cursor:pointer;}",
    ".t{display:flex;align-items:center;padding:1vh 0;}",
    ".t + .t{border-top:1px solid rgba(255,255,255,.1);}",
    ".ring{flex:0 0 auto;width:7vh;height:7vh;margin-right:1.8vh;}",
    ".ring circle{fill:none;stroke-width:9;}",
    ".tx{flex:1 1 auto;min-width:0;}",
    ".nm{font-size:2.6vh;opacity:.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
    ".tm{font-size:6.4vh;line-height:1.05;font-weight:400;font-variant-numeric:tabular-nums;letter-spacing:.01em;}",
    ".t.paused .tm{opacity:.55;}",
    ".t.done .tm{color:#ff6b61;animation:eto-blink 1s steps(1) infinite;}",
    ".t.done .nm{color:#ff8a80;opacity:1;}",
    "@keyframes eto-blink{50%{opacity:.3;}}",
  ].join("");

  function fmtClock(sec) {
    sec = Math.max(0, Math.ceil(sec));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    var ss = (s < 10 ? "0" : "") + s;
    return h > 0 ? h + ":" + (m < 10 ? "0" : "") + m + ":" + ss : m + ":" + ss;
  }
  function parseDur(s) {
    if (s === undefined || s === null) return 0;
    var days = 0, m = String(s).match(/^(\d+) days?, (.*)$/);
    if (m) { days = parseInt(m[1], 10); s = m[2]; }
    var p = String(s).split(":");
    if (p.length !== 3) return 0;
    return days * 86400 + parseInt(p[0], 10) * 3600 + parseInt(p[1], 10) * 60 + parseFloat(p[2]);
  }

  function EchoTimerOverlay() {
    var self = Reflect.construct(HTMLElement, [], EchoTimerOverlay);
    self._items = [];
    return self;
  }
  EchoTimerOverlay.prototype = Object.create(HTMLElement.prototype);
  EchoTimerOverlay.prototype.constructor = EchoTimerOverlay;
  Object.setPrototypeOf(EchoTimerOverlay, HTMLElement);

  EchoTimerOverlay.prototype.connectedCallback = function () {
    var self = this;
    if (!this.shadowRoot) {
      var root = this.attachShadow({ mode: "open" });
      root.innerHTML = "<style>" + OV_STYLE + '</style><div class="box" role="button"></div>';
      this._box = root.querySelector(".box");
      this._box.addEventListener("click", function (ev) { ev.stopPropagation(); if (self.path) navigate(self.path); });
      this._onPrefs = function () { self._place(); self._paint(); };
    }
    window.addEventListener("echo-show-prefs", this._onPrefs);
    this._place();
  };
  EchoTimerOverlay.prototype.disconnectedCallback = function () {
    window.removeEventListener("echo-show-prefs", this._onPrefs);
    if (this._tick) { clearInterval(this._tick); this._tick = null; }
  };
  // "auto" lets each page pick a spot that doesn't cover its controls (attribute auto-pos).
  EchoTimerOverlay.prototype._place = function () {
    var pos = Prefs.get("overlay");
    if (pos === "auto" || !pos) pos = this.getAttribute("auto-pos") || "top-right";
    ["top-right", "top-left", "bottom-right", "bottom-left", "media"].forEach(function (c) { this.classList.toggle(c, c === pos); }, this);
  };

  // timers: [timer ids]; each may have input_text.<id>_name with its label.
  EchoTimerOverlay.prototype.update = function (hass, timers) {
    if (hass && !lastHass) { lastHass = hass; activeTheme = null; applyTheme(); }
    lastHass = hass || lastHass;
    var st = hass.states, items = [];
    (timers || []).forEach(function (id) {
      var t = st[id];
      if (!t) return;
      var nmE = st["input_text." + id.split(".")[1] + "_name"];
      var nm = nmE && nmE.state && nmE.state !== "unknown" && nmE.state !== "unavailable" ? nmE.state : "";
      var dur = parseDur(t.attributes.duration);
      if (t.state === "active" && t.attributes.finishes_at) items.push({ s: "active", n: nm || "Timer", end: Date.parse(t.attributes.finishes_at), dur: dur });
      else if (t.state === "paused") items.push({ s: "paused", n: nm || "Timer", rem: parseDur(t.attributes.remaining), dur: dur });
      else if (t.state === "idle" && nm) items.push({ s: "done", n: nm, dur: dur });
    });
    var order = { done: 0, active: 1, paused: 2 };
    items.sort(function (a, b) { return (order[a.s] - order[b.s]) || ((a.end || 0) - (b.end || 0)); });
    this._items = items;
    this._paint();
    var self = this, live = items.some(function (i) { return i.s === "active"; });
    if (live && !this._tick) this._tick = setInterval(function () { self._paint(); }, 1000);
    if (!live && this._tick) { clearInterval(this._tick); this._tick = null; }
  };

  EchoTimerOverlay.prototype._paint = function () {
    if (!this._box) return;
    var show = this._items.length && Prefs.get("overlay") !== "off";
    if (!show) { this.setAttribute("hidden", ""); return; }
    this.removeAttribute("hidden");
    var h = "", now = Date.now();
    var R = 40, C = 2 * Math.PI * R;
    this._items.forEach(function (it) {
      var rem = it.s === "active" ? (it.end - now) / 1000 : it.s === "paused" ? it.rem : 0;
      var f = it.dur > 0 ? clamp(rem / it.dur, 0, 1) : 0;
      var col = it.s === "done" ? "#ff6b61" : it.s === "paused" ? "rgba(255,255,255,.45)" : "var(--es-hi,#ffb340)";
      h += '<div class="t ' + it.s + '"><svg class="ring" viewBox="0 0 100 100"><circle cx="50" cy="50" r="' + R + '" stroke="rgba(255,255,255,.14)"/>' +
        '<circle cx="50" cy="50" r="' + R + '" style="stroke:' + col + '" stroke-linecap="round" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + (C * (1 - (it.s === "done" ? 1 : f))).toFixed(1) + '" transform="rotate(-90 50 50)"/></svg>' +
        '<div class="tx"><div class="nm">' + esc(it.s === "paused" ? it.n + " · paused" : it.s === "done" ? it.n + " · done" : it.n) + '</div><div class="tm">' + (it.s === "done" ? "Done" : fmtClock(rem)) + "</div></div></div>";
    });
    if (h !== this._last) { this._box.innerHTML = h; this._last = h; }
  };

  if (!customElements.get("echo-timer-overlay")) customElements.define("echo-timer-overlay", EchoTimerOverlay);

  // ---------- volume level on screen ----------
  // Kiosk Satellite changes the volume without Android's own volume panel (for example from the
  // Echo Volume Buttons plugin in ks-plugin/, a voice command or an automation), so this shows
  // a short level bar whenever this display's number.<device>_volume / _assistant_volume /
  // _media_volume changes. Not while the settings panel (which has the sliders) is open.
  var HUD_CH = [
    { s: "volume", n: "Device volume", i: "mdi:volume-high" },
    { s: "assistant_volume", n: "Assistant volume", i: "mdi:account-voice" },
    { s: "media_volume", n: "Media volume", i: "mdi:music-note" },
  ];
  var HUD_STYLE = [
    ":host{position:fixed;z-index:9999;top:3vh;left:50%;transform:translate(-50%,-2vh);opacity:0;pointer-events:none;transition:opacity .18s ease,transform .18s ease;font-family:var(--es-font,var(--ha-font-family-body,Roboto,'Helvetica Neue',Arial,sans-serif));color:#fff;}",
    ":host(.on){opacity:1;transform:translate(-50%,0);}",
    ".box{display:flex;align-items:center;gap:2vh;min-width:42vw;padding:1.8vh 3vh;box-sizing:border-box;background:var(--es-ov,rgba(10,14,28,1));border:1px solid rgba(255,255,255,.14);border-radius:4vh;box-shadow:0 1.6vh 4vh rgba(0,0,0,.5);}",
    "ha-icon{--mdc-icon-size:4.4vh;width:4.4vh;height:4.4vh;display:inline-flex;color:var(--es-hi,#ffb340);flex:0 0 auto;}",
    ".mid{flex:1 1 auto;min-width:0;}",
    ".nm{font-size:2.3vh;opacity:.75;margin-bottom:1vh;}",
    ".tr{height:1.2vh;border-radius:.6vh;background:rgba(255,255,255,.16);overflow:hidden;}",
    ".fill{height:100%;border-radius:.6vh;background:linear-gradient(90deg,var(--es-acc1,#ffab2e),var(--es-acc2,#ff8a00));transition:width .12s linear;}",
    ".pc{font-size:3.6vh;font-variant-numeric:tabular-nums;min-width:8vh;text-align:right;}",
  ].join("");
  function EchoVolumeHud() { return Reflect.construct(HTMLElement, [], EchoVolumeHud); }
  EchoVolumeHud.prototype = Object.create(HTMLElement.prototype);
  EchoVolumeHud.prototype.constructor = EchoVolumeHud;
  Object.setPrototypeOf(EchoVolumeHud, HTMLElement);
  EchoVolumeHud.prototype.connectedCallback = function () {
    if (this.shadowRoot) return;
    var root = this.attachShadow({ mode: "open" });
    root.innerHTML = "<style>" + HUD_STYLE + '</style><div class="box"><ha-icon></ha-icon><div class="mid"><div class="nm"></div><div class="tr"><div class="fill"></div></div></div><div class="pc"></div></div>';
  };
  EchoVolumeHud.prototype.show = function (ch, pct) {
    var r = this.shadowRoot;
    if (!r) return;
    pct = Math.round(clamp(pct, 0, 100));
    r.querySelector("ha-icon").setAttribute("icon", ch.s === "volume" && pct === 0 ? "mdi:volume-off" : ch.i);
    r.querySelector(".nm").textContent = ch.n;
    r.querySelector(".fill").style.width = pct + "%";
    r.querySelector(".pc").textContent = pct + "%";
    this.classList.add("on");
    var self = this;
    clearTimeout(this._t);
    this._t = setTimeout(function () { self.classList.remove("on"); }, 1600);
  };
  if (!customElements.get("echo-volume-hud")) customElements.define("echo-volume-hud", EchoVolumeHud);

  var hud = { slug: undefined, seen: {}, el: null };
  function watchVolume() {
    var hass = findHass();
    if (!hass || !hass.states) return;
    if (hud.slug === undefined) {
      hud.slug = null;
      window.EchoShow.deviceSlug(hass).then(function (s) { hud.slug = s || null; });
      return;
    }
    if (!hud.slug) return;
    HUD_CH.forEach(function (ch) {
      var id = devEnt(hass, hud.slug, "number", ch.s), st = id && hass.states[id];
      if (!st) return;
      var prev = hud.seen[id];
      hud.seen[id] = st;
      // First sighting, the same object, or a reconnect replaying an old change: nothing to show.
      if (!prev || prev === st || prev.state === st.state) return;
      var v = num(st.state);
      if (v === null || num(prev.state) === null) return;
      if (Math.abs(Date.now() - Date.parse(st.last_changed)) > 10000) return;
      if (current || document.hidden || Prefs.get("volume_hud") === "off") return;
      if (!hud.el || !hud.el.isConnected) { hud.el = document.createElement("echo-volume-hud"); document.body.appendChild(hud.el); }
      hud.el.show(ch, v);
    });
  }
  setInterval(watchVolume, 200);

  // ---------- public API ----------
  window.EchoShow = {
    version: VERSION,
    prefs: Prefs,
    openSettings: openSettings,
    settingsOpen: function () { return !!current; },
    displayName: echoDisplayName,
    devEnt: devEnt,
    ownTimerPrefix: ownTimerPrefix,
    ownArea: ownArea,
    areaOf: areaOf,
    // This display's Kiosk Satellite entity prefix (Promise), as the settings panel finds it.
    deviceSlug: function (hass) {
      return Promise.all([echoDisplayName(), dashboardConfig(hass)]).then(function (r) {
        return resolveDevice(hass, r[0], (r[1] || {}).echo_show);
      }, function () { return null; });
    },
    mediaStatus: null,            // set by echo-media-card
    theme: function () { return themeById(activeTheme); },
    themes: THEMES,
  };
  if (window.console && console.info) console.info("echo-show-common " + VERSION);
})();

/* ===== echo-weather-card.js ===== */
/*
 * echo-weather-card
 * A lightweight, full-screen weather card built for an Echo Show 8 kiosk.
 * Plain JavaScript, no dependencies, no build step. Everything is drawn with
 * HTML/CSS and one SVG, and all animations use transform/opacity only.
 *
 * Written to run on older Chromium-based browsers: no optional chaining,
 * no nullish coalescing, no class fields.
 */
(function () {
  "use strict";

  var VERSION = "1.7.3";


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

  // This display's own timer set (timer.<device>_timer_N) when Home Assistant has one.
  function ownTimers(hass) { var ES = window.EchoShow; return ES && ES.ownTimerPrefix ? ES.ownTimerPrefix(hass) : null; }
  function matchDisplay(devices, name) {
    if (!devices || !name) return null;
    var n = String(name).toLowerCase();
    for (var i = 0; i < devices.length; i++) {
      var mt = devices[i].match;
      if (mt && n.indexOf(String(mt).toLowerCase()) !== -1) return devices[i];
    }
    return null;
  }

  // ---------- small helpers ----------

  function num(v) {
    var n = parseFloat(v);
    return isNaN(n) ? null : n;
  }

  function esc(s) {
    return String(s === undefined || s === null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function hexToRgb(h) {
    h = h.replace("#", "");
    return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
  }

  function rgbToHex(c) {
    return "#" + c.map(function (x) {
      var s = Math.round(x).toString(16);
      return s.length === 1 ? "0" + s : s;
    }).join("");
  }

  var CONDITION_LABELS = {
    "clear-night": "Clear",
    cloudy: "Cloudy",
    exceptional: "Alert",
    fog: "Fog",
    hail: "Hail",
    lightning: "Lightning",
    "lightning-rainy": "Storms",
    partlycloudy: "Partly cloudy",
    pouring: "Pouring",
    rainy: "Rainy",
    snowy: "Snowy",
    "snowy-rainy": "Sleet",
    sunny: "Sunny",
    windy: "Windy",
    "windy-variant": "Windy",
  };

  var WET = ["rainy", "pouring", "lightning", "lightning-rainy", "hail", "snowy", "snowy-rainy", "fog", "exceptional"];

  // Temperature (°F) -> colour, used for the high-temperature line.
  var TEMP_STOPS = [
    [20, "#7e57c2"],
    [32, "#2196f3"],
    [45, "#4fc3f7"],
    [58, "#8bc34a"],
    [70, "#ffc107"],
    [82, "#ff9800"],
    [95, "#f44336"],
  ];

  function tempColor(tF) {
    if (tF === null) return "#ffffff";
    if (tF <= TEMP_STOPS[0][0]) return TEMP_STOPS[0][1];
    for (var i = 1; i < TEMP_STOPS.length; i++) {
      if (tF <= TEMP_STOPS[i][0]) {
        var a = TEMP_STOPS[i - 1], b = TEMP_STOPS[i];
        var t = (tF - a[0]) / (b[0] - a[0]);
        var ca = hexToRgb(a[1]), cb = hexToRgb(b[1]);
        return rgbToHex([lerp(ca[0], cb[0], t), lerp(ca[1], cb[1], t), lerp(ca[2], cb[2], t)]);
      }
    }
    return TEMP_STOPS[TEMP_STOPS.length - 1][1];
  }

  function feelsColor(tF) {
    if (tF === null) return "#ffc107";
    if (tF <= 32) return "#2979ff";
    if (tF <= 45) return "#4fc3f7";
    if (tF <= 55) return "#80deea";
    if (tF <= 65) return "#8bc34a";
    if (tF <= 75) return "#ffc107";
    if (tF <= 85) return "#ff9800";
    return "#f44336";
  }

  function aqiColor(a) {
    if (a === null) return "#9e9e9e";
    if (a <= 50) return "#4caf50";
    if (a <= 100) return "#ffeb3b";
    if (a <= 150) return "#ff9800";
    if (a <= 200) return "#f44336";
    if (a <= 300) return "#9c27b0";
    return "#7e0023";
  }

  function toF(t, unit) {
    if (t === null) return null;
    return unit && unit.indexOf("C") !== -1 ? t * 9 / 5 + 32 : t;
  }

  // Feels-like for sources that don't provide it (NWS formulas, °F / mph).
  function computeFeels(tF, rh, windMph) {
    if (tF === null) return null;
    if (tF <= 50 && windMph !== null && windMph > 3) {
      var v = Math.pow(windMph, 0.16);
      return 35.74 + 0.6215 * tF - 35.75 * v + 0.4275 * tF * v;
    }
    if (tF >= 80 && rh !== null) {
      var T = tF, R = rh;
      return -42.379 + 2.04901523 * T + 10.14333127 * R - 0.22475541 * T * R -
        0.00683783 * T * T - 0.05481717 * R * R + 0.00122874 * T * T * R +
        0.00085282 * T * R * R - 0.00000199 * T * T * R * R;
    }
    return tF;
  }

  var COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

  // ---------- weather icons (drawn in a 100x100 box) ----------

  var CLOUD = '<circle cx="36" cy="60" r="15"/><circle cx="55" cy="48" r="21"/><circle cx="73" cy="61" r="14"/><rect x="22" y="58" width="65" height="18" rx="9"/>';

  function cloud(fill, dx, dy, scale) {
    return '<g transform="translate(' + dx + " " + dy + ") scale(" + scale + ')" fill="' + fill + '">' + CLOUD + "</g>";
  }

  function sun(cx, cy, r) {
    return '<circle cx="' + cx + '" cy="' + cy + '" r="' + (r * 1.45) + '" fill="#ffd54f" opacity="0.25"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="#ffd54f"/>';
  }

  function moonShape(cx, cy, r) {
    return '<path d="M' + (cx + r * 0.2) + " " + (cy - r) + " A " + r + " " + r + " 0 1 0 " + (cx + r * 0.95) + " " + (cy + r * 0.35) +
      " A " + (r * 0.8) + " " + (r * 0.8) + " 0 0 1 " + (cx + r * 0.2) + " " + (cy - r) + ' Z" fill="#fff3c4"/>';
  }

  function drops(n, color, heavy) {
    var out = "";
    var xs = n === 3 ? [38, 52, 66] : [32, 43, 54, 65, 76];
    for (var i = 0; i < xs.length; i++) {
      var y = 82 + (i % 2) * 5;
      out += '<line x1="' + xs[i] + '" y1="' + y + '" x2="' + (xs[i] - 4) + '" y2="' + (y + (heavy ? 13 : 9)) +
        '" stroke="' + color + '" stroke-width="' + (heavy ? 4 : 3.5) + '" stroke-linecap="round"/>';
    }
    return out;
  }

  function flakes() {
    var out = "";
    var pts = [[38, 86], [52, 92], [66, 86], [45, 97], [60, 99]];
    for (var i = 0; i < pts.length; i++) {
      out += '<circle cx="' + pts[i][0] + '" cy="' + pts[i][1] + '" r="3.2" fill="#ffffff"/>';
    }
    return out;
  }

  function bolt() {
    return '<polygon points="54,70 42,88 51,88 46,102 62,82 53,82 58,70" fill="#ffd740"/>';
  }

  function fogLines() {
    return '<g stroke="#e3e8ef" stroke-width="4" stroke-linecap="round"><line x1="24" y1="84" x2="80" y2="84"/><line x1="30" y1="93" x2="74" y2="93"/></g>';
  }

  function windLines() {
    return '<g fill="none" stroke="#e3e8ef" stroke-width="5" stroke-linecap="round">' +
      '<path d="M14 42 H62 a10 10 0 1 0 -10 -10"/><path d="M14 58 H78 a10 10 0 1 1 -10 10"/><path d="M14 74 H48"/></g>';
  }

  function weatherIcon(cond, night) {
    var light = "#f5f8fc", shade = "#b8c4d4", dark = "#8a96a8";
    switch (cond) {
      case "sunny":
        return night ? moonShape(46, 50, 26) : sun(50, 50, 24);
      case "clear-night":
        return moonShape(46, 50, 26);
      case "partlycloudy":
        return (night ? moonShape(62, 32, 17) : sun(66, 34, 17)) + cloud(light, -4, 6, 0.92);
      case "cloudy":
        return cloud(shade, 12, -8, 0.8) + cloud(light, -4, 4, 0.95);
      case "rainy":
        return cloud(light, 0, -6, 1) + drops(3, "#64b5f6", false);
      case "pouring":
        return cloud(dark, 0, -6, 1) + drops(5, "#42a5f5", true);
      case "lightning":
        return cloud(dark, 0, -8, 1) + bolt();
      case "lightning-rainy":
        return cloud(dark, 0, -8, 1) + bolt() + '<g transform="translate(-14 0)">' + drops(3, "#64b5f6", false).split("<line").slice(0, 2).join("<line") + "</g>";
      case "snowy":
        return cloud(light, 0, -6, 1) + flakes();
      case "snowy-rainy":
        return cloud(light, 0, -6, 1) + '<line x1="40" y1="84" x2="36" y2="94" stroke="#64b5f6" stroke-width="3.5" stroke-linecap="round"/><line x1="64" y1="84" x2="60" y2="94" stroke="#64b5f6" stroke-width="3.5" stroke-linecap="round"/><circle cx="52" cy="92" r="3.2" fill="#fff"/>';
      case "hail":
        return cloud(light, 0, -6, 1) + '<g fill="#dbeafe"><circle cx="40" cy="88" r="4"/><circle cx="54" cy="95" r="4"/><circle cx="66" cy="87" r="4"/></g>';
      case "fog":
        return cloud(shade, 0, -12, 0.95) + fogLines();
      case "windy":
        return windLines();
      case "windy-variant":
        return cloud(light, 6, -14, 0.8) + '<g transform="translate(0 20)">' + windLines() + "</g>";
      default:
        return '<circle cx="50" cy="50" r="30" fill="none" stroke="#ffd740" stroke-width="6"/><rect x="47" y="32" width="6" height="22" rx="3" fill="#ffd740"/><circle cx="50" cy="64" r="4" fill="#ffd740"/>';
    }
  }

  function iconSvg(cond, night, cls) {
    return '<svg class="' + (cls || "") + '" viewBox="0 0 100 110" preserveAspectRatio="xMidYMid meet">' + weatherIcon(cond, night) + "</svg>";
  }

  // Moon with the correct lit fraction (illum 0..1). Northern hemisphere: waxing is lit on the right.
  function moonPhaseSvg(illum, waxing) {
    var r = 45, cx = 50, cy = 50;
    var rx = Math.abs(1 - 2 * illum) * r;
    var gibbous = illum > 0.5;
    var lit = "M" + cx + " " + (cy - r) +
      " A " + r + " " + r + " 0 0 1 " + cx + " " + (cy + r) +
      " A " + rx + " " + r + " 0 0 " + (gibbous ? 1 : 0) + " " + cx + " " + (cy - r) + " Z";
    return '<svg viewBox="0 0 100 100"><defs><radialGradient id="ewcMoonGlow"><stop offset="60%" stop-color="#fffbe6" stop-opacity="0.35"/><stop offset="100%" stop-color="#fffbe6" stop-opacity="0"/></radialGradient></defs>' +
      '<circle cx="50" cy="50" r="50" fill="url(#ewcMoonGlow)"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="#2a3246" opacity="0.55"/>' +
      '<path d="' + lit + '" fill="#f4f1e4" transform="' + (waxing ? "" : "translate(100 0) scale(-1 1)") + '"/>' +
      '<g fill="#d8d3c0" opacity="0.5"><circle cx="38" cy="36" r="7"/><circle cx="60" cy="58" r="9"/><circle cx="44" cy="66" r="5"/><circle cx="66" cy="32" r="4"/></g>' +
      "</svg>";
  }

  // ---------- animated background tiles (data-URI SVG) ----------

  function svgUri(svg) {
    return "url('data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg).replace(/'/g, "%27") + "')";
  }

  function rainTile(color, count, len) {
    var s = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240">';
    var seed = 7;
    for (var i = 0; i < count; i++) {
      seed = (seed * 9301 + 49297) % 233280;
      var x = (seed / 233280) * 240;
      seed = (seed * 9301 + 49297) % 233280;
      var y = (seed / 233280) * 240;
      s += '<line x1="' + x.toFixed(1) + '" y1="' + y.toFixed(1) + '" x2="' + x.toFixed(1) + '" y2="' + (y + len).toFixed(1) +
        '" stroke="' + color + '" stroke-width="2" stroke-linecap="round"/>';
    }
    return svgUri(s + "</svg>");
  }

  function dotTile(color, count, rMin, rMax, size) {
    var s = '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size + '">';
    var seed = 13;
    for (var i = 0; i < count; i++) {
      seed = (seed * 9301 + 49297) % 233280;
      var x = (seed / 233280) * size;
      seed = (seed * 9301 + 49297) % 233280;
      var y = (seed / 233280) * size;
      seed = (seed * 9301 + 49297) % 233280;
      var r = rMin + (seed / 233280) * (rMax - rMin);
      s += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + r.toFixed(2) + '" fill="' + color + '"/>';
    }
    return svgUri(s + "</svg>");
  }

  var TILE_RAIN_A = rainTile("rgba(170,210,255,0.55)", 26, 22);
  var TILE_RAIN_B = rainTile("rgba(170,210,255,0.35)", 20, 14);
  var TILE_SNOW_A = dotTile("rgba(255,255,255,0.9)", 22, 2, 4, 260);
  var TILE_SNOW_B = dotTile("rgba(255,255,255,0.6)", 30, 1.2, 2.4, 200);
  var TILE_STARS = dotTile("rgba(255,255,255,0.85)", 40, 0.6, 1.6, 320);

  var CLOUD_SVG_WHITE = svgUri('<svg xmlns="http://www.w3.org/2000/svg" viewBox="4 14 97 74"><defs><filter id="b" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.2"/></filter></defs><g fill="white" filter="url(#b)">' + CLOUD + "</g></svg>");

  // ---------- styles ----------

  var STYLE = [
    ":host{display:block;height:100vh;width:100%;overflow:hidden;font-family:var(--es-font,var(--ha-font-family-body,Roboto,'Helvetica Neue',Arial,sans-serif));color:#fff;-webkit-tap-highlight-color:transparent;}",
    ".root{position:relative;height:100vh;width:100%;overflow:hidden;box-sizing:border-box;}",
    ".bg{position:absolute;left:0;top:0;right:0;bottom:0;transition:background 2s;}",
    ".fx{position:absolute;left:0;top:0;right:0;bottom:0;overflow:hidden;pointer-events:none;}",
    ".content{position:relative;z-index:1;height:100vh;box-sizing:border-box;padding:1.5vh 2.5vh 2vh 2.5vh;display:flex;flex-direction:column;}",
    ".shadow .top{text-shadow:0 1px 2px rgba(0,0,0,.6),0 0 6px rgba(0,0,0,.4);}",
    ".shadow .temp{text-shadow:0 2px 4px rgba(0,0,0,.5),0 0 12px rgba(0,0,0,.35);}",
    /* top row */
    ".top{display:flex;align-items:center;height:25vh;padding-bottom:2.5vh;border-bottom:1px solid rgba(255,255,255,.35);margin:0 1vh;}",
    ".col{flex:1 1 0;min-width:0;display:flex;justify-content:center;align-items:center;}",
    ".now{flex-direction:column;cursor:pointer;}",
    ".now .cond{font-size:4.6vh;font-weight:500;line-height:1.05;text-align:center;max-width:17vw;}",
    ".now svg{width:15vh;height:16.5vh;margin-top:-.5vh;margin-bottom:-1.5vh;}",
    ".now .src{font-size:2.2vh;opacity:.7;margin-top:.2vh;white-space:nowrap;}",
    ".temp{font-size:17vh;font-weight:400;line-height:1;letter-spacing:-.02em;}",
    ".stack{display:inline-flex;flex-direction:column;gap:2vh;}",
    ".item{display:flex;align-items:center;font-size:4.5vh;line-height:1;white-space:nowrap;}",
    ".item ha-icon{--mdc-icon-size:5.5vh;width:5.5vh;height:5.5vh;margin-right:1.2vh;display:inline-flex;}",
    /* forecast */
    ".fc{flex:1 1 auto;min-height:0;margin-top:3vh;position:relative;cursor:pointer;}",
    ".scroller{position:absolute;left:0;top:0;right:0;bottom:0;overflow-x:auto;overflow-y:hidden;-webkit-overflow-scrolling:touch;scrollbar-width:none;}",
    ".scroller::-webkit-scrollbar{display:none;}",
    ".fc svg text{font-family:inherit;}",
    ".mode{position:absolute;right:1vh;top:0;font-size:2.4vh;opacity:.6;pointer-events:none;}",
    /* buttons */
    ".btns{display:flex;gap:1.5vh;margin-top:1.5vh;height:9vh;flex:0 0 auto;}",
    ".btn{flex:1 1 0;border-radius:1.6vh;background:rgba(255,255,255,.1);display:flex;align-items:center;justify-content:center;cursor:pointer;}",
    ".btn.active{background:rgba(255,255,255,.24);}",
    ".btn ha-icon{--mdc-icon-size:5vh;width:5vh;height:5vh;display:inline-flex;color:rgba(255,255,255,.9);}",
    ".btn .bdg{margin-left:1.2vh;font-size:3.8vh;line-height:1;font-variant-numeric:tabular-nums;color:var(--es-hi,#ffb340);white-space:nowrap;}",
    ".btn .bdg:empty{display:none;}",
    ".btn .bdg.done{color:#ff6b61;animation:ewc-blink 1s steps(1) infinite;}",
    "@keyframes ewc-blink{50%{opacity:.3;}}",
    /* popup */
    ".pop{position:absolute;left:0;top:0;right:0;bottom:0;z-index:5;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;}",
    ".pop.hidden{display:none;}",
    ".panel{background:rgba(22,28,44,.96);border-radius:2.5vh;padding:2.5vh 3vh;min-width:60vw;max-width:80vw;box-shadow:0 8px 30px rgba(0,0,0,.5);}",
    ".panel h2{margin:0 0 1.5vh 0;font-size:4.2vh;font-weight:500;}",
    ".row{display:flex;align-items:center;padding:1.6vh 1.5vh;border-radius:1.6vh;cursor:pointer;font-size:4vh;}",
    ".row + .row{margin-top:.6vh;}",
    ".row.sel{background:rgba(255,255,255,.14);}",
    ".row svg{width:7vh;height:7.7vh;flex:0 0 auto;margin-right:2vh;}",
    ".row .nm{flex:1 1 auto;}",
    ".row .nm small{display:block;font-size:2.6vh;opacity:.65;margin-top:.4vh;}",
    ".row .tv{font-size:5vh;margin-left:2vh;}",
    ".row .ck{width:4vh;margin-left:2vh;text-align:center;opacity:.9;}",
    /* animations */
    ".layer{position:absolute;left:0;right:0;will-change:transform;}",
    ".rain{top:-260px;bottom:0;animation-timing-function:linear;animation-iteration-count:infinite;transform:translate3d(0,0,0);}",
    ".f200{animation-name:ewc-f200;}.f240{animation-name:ewc-f240;}.f260{animation-name:ewc-f260;}",
    ".slant{position:absolute;left:-10%;right:-10%;top:0;bottom:0;transform:rotate(8deg);}",
    "@keyframes ewc-f200{from{transform:translate3d(0,0,0);}to{transform:translate3d(0,200px,0);}}",
    "@keyframes ewc-f240{from{transform:translate3d(0,0,0);}to{transform:translate3d(0,240px,0);}}",
    "@keyframes ewc-f260{from{transform:translate3d(0,0,0);}to{transform:translate3d(0,260px,0);}}",
    ".cloudf{position:absolute;background-repeat:no-repeat;background-size:contain;will-change:transform;animation:ewc-drift linear infinite;}",
    "@keyframes ewc-drift{from{transform:translate3d(-40vw,0,0);}to{transform:translate3d(140vw,0,0);}}",
    ".stars{position:absolute;left:0;top:0;right:0;height:60%;animation:ewc-twinkle 6s ease-in-out infinite alternate;}",
    "@keyframes ewc-twinkle{from{opacity:.45;}to{opacity:.95;}}",
    ".sunglow{position:absolute;width:70vh;height:70vh;right:-12vh;top:-34vh;border-radius:50%;background:radial-gradient(circle,rgba(255,236,150,.55) 0%,rgba(255,220,120,.18) 38%,rgba(255,220,120,0) 70%);}",
    ".moon{position:absolute;width:15vh;height:15vh;left:calc(60% - 7.5vh);top:-5vh;opacity:.95;}",
    ".moon svg{width:100%;height:100%;}",
    ".flash{position:absolute;left:0;top:0;right:0;bottom:0;background:#fff;opacity:0;animation:ewc-flash 9s infinite;}",
    "@keyframes ewc-flash{0%,86%,100%{opacity:0;}87%{opacity:.55;}88%{opacity:.05;}90%{opacity:.4;}93%{opacity:0;}}",
    ".fogband{position:absolute;left:-50%;width:200%;height:22vh;background:linear-gradient(to bottom,rgba(255,255,255,0),rgba(255,255,255,.14),rgba(255,255,255,0));animation:ewc-fog 40s ease-in-out infinite alternate;}",
    "@keyframes ewc-fog{from{transform:translate3d(-10%,0,0);}to{transform:translate3d(10%,0,0);}}",
  ].join("\n");

  // ---------- the card ----------

  function EchoWeatherCard() {
    var self = Reflect.construct(HTMLElement, [], EchoWeatherCard);
    self._hass = null;
    self._config = null;
    self._mode = "daily";
    self._forecasts = {};
    self._subs = [];
    self._subEntity = null;
    self._subGen = 0;
    self._subRetry = null;
    self._subDelay = 0;
    self._fcLastMsg = 0;
    self._fcWasDown = false;
    self._conn = null;
    self._sig = "";
    self._fxSig = "";
    self._chartSig = "";
    self._built = false;
    self._sourceIndex = 0;
    self._ro = null;
    // Keep touch gestures inside this card so the kiosk's swipe-between-views doesn't fire.
    ["touchstart", "touchmove", "touchend", "touchcancel"].forEach(function (type) {
      self.addEventListener(type, function (ev) { if (!self._config || self._config.block_swipe !== false) ev.stopPropagation(); });
    });
    return self;
  }
  EchoWeatherCard.prototype = Object.create(HTMLElement.prototype);
  EchoWeatherCard.prototype.constructor = EchoWeatherCard;
  Object.setPrototypeOf(EchoWeatherCard, HTMLElement);

  EchoWeatherCard.prototype.setConfig = function (config) {
    if (!config || !config.sources || !config.sources.length) {
      throw new Error("echo-weather-card: add at least one entry under 'sources'");
    }
    var hasWeather = false;
    for (var i = 0; i < config.sources.length; i++) {
      if (config.sources[i].entity && config.sources[i].entity.indexOf("weather.") === 0) hasWeather = true;
    }
    if (!hasWeather) throw new Error("echo-weather-card: at least one source must be a weather.* entity");
    this._config = config;
    this._sourceIndex = this._loadSource();
    if (!this._devL) {   // this display's device (own timers, area) becomes known after the first render
      this._devL = true;
      var me = this;
      window.addEventListener("echo-show-device", function () { if (me._hass) { me._badgeSig = ""; me._sig = ""; me.hass = me._hass; } });
    }
    var self = this;
    echoDisplayName().then(function (name) {
      var prof = matchDisplay(config.devices, name);
      self._timerPrefix = prof && prof.timer_prefix ? prof.timer_prefix : null;
      self._badgeSig = "";
      self._runSeen = null;
      self._doneSeen = null;
      if (self._built && self._hass) self._updateBadges();
    });
  };

  // Timers a button tracks (per-display prefix overrides the configured list).
  EchoWeatherCard.prototype._timersFor = function (btn) {
    if (!btn.timers) return null;
    var pfx = this._timerPrefix || ownTimers(this._hass);
    if (!pfx) return btn.timers;
    var out = [];
    for (var i = 1; i <= 3; i++) out.push("timer." + pfx + "_" + i);
    return out;
  };

  EchoWeatherCard.prototype.getCardSize = function () {
    return 12;
  };

  EchoWeatherCard.prototype._storageKey = function () {
    return "echo-weather-card:source:" + (this._config.storage_key || "default");
  };

  EchoWeatherCard.prototype._loadSource = function () {
    try {
      var v = window.localStorage.getItem(this._storageKey());
      var i = parseInt(v, 10);
      if (!isNaN(i) && i >= 0 && i < this._config.sources.length) return i;
    } catch (e) { /* storage unavailable */ }
    return 0;
  };

  EchoWeatherCard.prototype._saveSource = function (i) {
    try { window.localStorage.setItem(this._storageKey(), String(i)); } catch (e) { /* ignore */ }
  };

  // The weather entity that supplies the forecast (and any fields the current source lacks).
  EchoWeatherCard.prototype._forecastEntity = function () {
    var src = this._config.sources[this._sourceIndex];
    if (src && src.entity && src.entity.indexOf("weather.") === 0) return src.entity;
    for (var i = 0; i < this._config.sources.length; i++) {
      var s = this._config.sources[i];
      if (s.entity && s.entity.indexOf("weather.") === 0) return s.entity;
    }
    return null;
  };

  Object.defineProperty(EchoWeatherCard.prototype, "hass", {
    set: function (hass) {
      this._hass = hass;
      if (!this._config) return;
      if (!this._built) this._build();
      this._watchConnection();
      this._checkForecastHealth();
      this._ensureSubscriptions();
      this._update();
      this._updateBadges();
      this._updateOverlay();
      if (this._settingsEl) this._settingsEl.hass = hass;
    },
    get: function () {
      return this._hass;
    },
  });

  EchoWeatherCard.prototype.connectedCallback = function () {
    if (this._hass && this._config) {
      this._watchConnection();
      this._ensureSubscriptions();
    }
    var self = this;
    // Settings panel changes (source, animations, hourly wind).
    if (!this._onPrefs) this._onPrefs = function (ev) {
      if (!self._config || !self._built) return;
      if (ev.detail && ev.detail.key === "weather_source") { self._sourceIndex = self._loadSource(); self._ensureSubscriptions(); }
      self._sig = ""; self._fxSig = ""; self._chartSig = "";
      self._update();
      self._renderChart();
    };
    window.addEventListener("echo-show-prefs", this._onPrefs);
    if (window.ResizeObserver && this._built && !this._ro) {
      this._ro = new ResizeObserver(function () { self._chartSig = ""; self._renderChart(); });
      this._ro.observe(this._fcEl);
    }
  };

  EchoWeatherCard.prototype.disconnectedCallback = function () {
    if (this._onPrefs) window.removeEventListener("echo-show-prefs", this._onPrefs);
    this._runSeen = null; this._doneSeen = null;
    this._unsubscribe();
    this._unwatchConnection();
    if (this._subRetry) { clearTimeout(this._subRetry); this._subRetry = null; }
    if (this._badgeTick) { clearInterval(this._badgeTick); this._badgeTick = null; }
    if (this._settingsEl) this._settingsEl.close();
    if (this._ro) { this._ro.disconnect(); this._ro = null; }
  };

  // ---------- build static DOM ----------

  EchoWeatherCard.prototype._build = function () {
    var root = this.attachShadow({ mode: "open" });
    var btnHtml = "";
    var buttons = this._config.buttons || [];
    for (var i = 0; i < buttons.length; i++) {
      btnHtml += '<div class="btn' + (buttons[i].active ? " active" : "") + '" role="button" data-i="' + i + '"><ha-icon icon="' + esc(buttons[i].icon || "mdi:help") + '"></ha-icon>' +
        (buttons[i].timers ? '<span class="bdg" data-i="' + i + '"></span>' : "") + "</div>";
    }
    root.innerHTML =
      "<style>" + STYLE + "</style>" +
      '<div class="root">' +
      '<div class="bg"></div><div class="fx"></div>' +
      '<div class="content">' +
      '<div class="top">' +
      '<div class="col now" role="button"></div>' +
      '<div class="col"><div class="temp"></div></div>' +
      '<div class="col"><div class="stack s1"></div></div>' +
      '<div class="col"><div class="stack s2"></div></div>' +
      '<div class="col"><div class="stack s3"></div></div>' +
      "</div>" +
      '<div class="fc" role="button"><div class="scroller"></div><div class="mode"></div></div>' +
      (buttons.length ? '<div class="btns">' + btnHtml + "</div>" : "") +
      "</div>" +
      '<echo-timer-overlay hidden auto-pos="top-right"></echo-timer-overlay>' +
      '<div class="pop hidden"></div>' +
      "</div>";

    this._rootEl = root.querySelector(".root");
    this._ovEl = root.querySelector("echo-timer-overlay");
    this._bgEl = root.querySelector(".bg");
    this._fxEl = root.querySelector(".fx");
    this._nowEl = root.querySelector(".now");
    this._tempEl = root.querySelector(".temp");
    this._s1 = root.querySelector(".s1");
    this._s2 = root.querySelector(".s2");
    this._s3 = root.querySelector(".s3");
    this._fcEl = root.querySelector(".fc");
    this._scrollEl = root.querySelector(".scroller");
    this._modeEl = root.querySelector(".mode");
    this._popEl = root.querySelector(".pop");

    var self = this;
    // Optional tap feedback (uses the sound engine from echo-timer-card.js).
    root.addEventListener("click", function (ev) {
      if (self._config.tap_sound && window.EchoAlarmSound && window.EchoAlarmSound.tick &&
          ev.target.closest && ev.target.closest('[role="button"]')) window.EchoAlarmSound.tick();
    }, true);
    this._nowEl.addEventListener("click", function () { self._openPicker(); });
    this._fcEl.addEventListener("click", function () {
      self._mode = self._mode === "daily" ? "hourly" : "daily";
      self._chartSig = "";
      self._scrollEl.scrollLeft = 0;
      self._renderChart();
    });
    this._popEl.addEventListener("click", function (ev) {
      var row = ev.target.closest ? ev.target.closest(".row") : null;
      if (row) {
        var i = parseInt(row.getAttribute("data-i"), 10);
        self._selectSource(i);
      }
      self._popEl.classList.add("hidden");
    });
    var btnEls = root.querySelectorAll(".btn");
    for (var b = 0; b < btnEls.length; b++) {
      btnEls[b].addEventListener("click", function (ev) {
        var i = parseInt(ev.currentTarget.getAttribute("data-i"), 10);
        self._buttonTap(buttons[i]);
      });
    }
    if (window.ResizeObserver) {
      this._ro = new ResizeObserver(function () { self._chartSig = ""; self._renderChart(); });
      this._ro.observe(this._fcEl);
    }
    this._built = true;
  };

  EchoWeatherCard.prototype._buttonTap = function (btn) {
    if (!btn) return;
    if (btn.action === "settings" || btn.action === "timer-settings") {
      // Shared settings panel (echo-show-common); the old timer-only popup otherwise.
      if (window.EchoShow && window.EchoShow.openSettings) window.EchoShow.openSettings(this, { timers: this._overlayTimers() });
      else if (window.EchoAlarmSettingsOpen) window.EchoAlarmSettingsOpen(this, this._rootEl, btn.settings);
    } else if (btn.navigation_path) {
      window.history.pushState(null, "", btn.navigation_path);
      var ev = new Event("location-changed", { bubbles: true, composed: true });
      window.dispatchEvent(ev);
    } else if (btn.url) {
      window.open(btn.url, "_self");
    }
  };

  // ---------- timer countdown badges on nav buttons ----------
  // A button with `timers: [timer.x, ...]` shows the soonest countdown next to its icon.
  // A timer counts as "done" when it is idle but its companion input_text.<id>_name is set.

  function parseHms(s) {
    var p = String(s || "").split(":");
    if (p.length !== 3) return 0;
    return parseInt(p[0], 10) * 3600 + parseInt(p[1], 10) * 60 + parseFloat(p[2]);
  }

  function fmtCountdown(sec) {
    sec = Math.max(0, Math.ceil(sec));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (h > 0 ? h + ":" + (m < 10 ? "0" : "") + m : String(m)) + ":" + (s < 10 ? "0" : "") + s;
  }

  EchoWeatherCard.prototype._updateBadges = function () {
    var buttons = this._config.buttons || [];
    var st = this._hass.states;
    var info = [];
    var sig = "";
    for (var i = 0; i < buttons.length; i++) {
      if (!buttons[i].timers) continue;
      var b = { i: i, done: false, finishes: 0, paused: 0, running: [] };
      var list = this._timersFor(buttons[i]);
      for (var j = 0; j < list.length; j++) {
        var t = st[list[j]];
        if (!t) continue;
        var nm = st["input_text." + list[j].split(".")[1] + "_name"];
        var named = nm && nm.state && nm.state !== "unknown" && nm.state !== "unavailable";
        if (t.state === "active" || t.state === "paused") b.running.push(list[j] + "@" + (t.attributes.duration || ""));
        if (t.state === "active" && t.attributes.finishes_at) {
          var f = Date.parse(t.attributes.finishes_at);
          if (!b.finishes || f < b.finishes) b.finishes = f;
        } else if (t.state === "paused") {
          var r = parseHms(t.attributes.remaining);
          if (!b.paused || r < b.paused) b.paused = r;
        } else if (t.state === "idle" && named) {
          b.done = true;
        }
        sig += list[j] + t.last_updated + (nm ? nm.state : "") + "|";
      }
      info.push(b);
    }
    if (!info.length) return;
    // open_on_done / open_on_start: jump to the button's page when one of its timers
    // finishes, or when a new timer starts (e.g. by voice).
    // Only react to changes seen while this page is showing: the first update after the
    // page opens just takes a snapshot (a timer started on another page isn't "new").
    var armed = !!this._runSeen && this.isConnected;
    if (!this.isConnected) { this._runSeen = null; this._doneSeen = null; }
    else if (!armed) { this._runSeen = {}; this._doneSeen = {}; }
    for (var q = 0; this.isConnected && q < info.length; q++) {
      var bt = buttons[info[q].i];
      var prevRun = this._runSeen[info[q].i];
      var started = false;
      if (prevRun) {
        for (var r2 = 0; r2 < info[q].running.length; r2++) {
          var id = info[q].running[r2].split("@")[0];
          var was = false;
          for (var r3 = 0; r3 < prevRun.length; r3++) if (prevRun[r3].split("@")[0] === id) was = true;
          if (!was) started = true;
        }
      }
      if (armed && bt.navigation_path && ((info[q].done && !this._doneSeen[info[q].i] && bt.open_on_done) || (started && bt.open_on_start))) {
        this._buttonTap(bt);
      }
      this._doneSeen[info[q].i] = info[q].done;
      this._runSeen[info[q].i] = info[q].running;
    }
    if (sig !== this._badgeSig) {
      this._badgeSig = sig;
      this._badges = info;
      this._paintBadges();
    }
    var anyActive = false;
    for (var k = 0; k < info.length; k++) if (info[k].finishes) anyActive = true;
    var self = this;
    if (anyActive && !this._badgeTick) this._badgeTick = setInterval(function () { self._paintBadges(); }, 1000);
    if (!anyActive && this._badgeTick) { clearInterval(this._badgeTick); this._badgeTick = null; }
  };

  // The big countdown over this page (echo-show-common's <echo-timer-overlay>).
  EchoWeatherCard.prototype._overlayTimers = function () {
    var buttons = this._config.buttons || [];
    for (var i = 0; i < buttons.length; i++) if (buttons[i].timers) return this._timersFor(buttons[i]);
    return [];
  };
  EchoWeatherCard.prototype._updateOverlay = function () {
    var el = this._ovEl;
    if (!el || !el.update) return;
    var buttons = this._config.buttons || [];
    for (var i = 0; i < buttons.length; i++) if (buttons[i].timers) { el.path = buttons[i].navigation_path || null; break; }
    el.update(this._hass, this._overlayTimers());
  };

  EchoWeatherCard.prototype._paintBadges = function () {
    var info = this._badges || [];
    for (var i = 0; i < info.length; i++) {
      var el = this.shadowRoot.querySelector('.bdg[data-i="' + info[i].i + '"]');
      if (!el) continue;
      var b = info[i];
      var txt = b.done ? "Done" : b.finishes ? fmtCountdown((b.finishes - Date.now()) / 1000) : b.paused ? fmtCountdown(b.paused) : "";
      if (el.textContent !== txt) el.textContent = txt;
      if (b.done !== el.classList.contains("done")) el.classList.toggle("done");
    }
  };

  // ---------- forecast subscriptions ----------

  EchoWeatherCard.prototype._supports = function (entityId) {
    var st = this._hass.states[entityId];
    var f = st ? (st.attributes.supported_features || 0) : 0;
    return { daily: (f & 1) !== 0, hourly: (f & 2) !== 0, twice: (f & 4) !== 0 };
  };

  // The forecast arrives over a websocket subscription. Three things can silently kill it, and each
  // used to leave the chart blank until the page was reloaded:
  //  - HA restarts: the frontend reconnects before the weather integration has loaded, the library's
  //    automatic resubscribe fails ("entity not found") and nothing retries it;
  //  - the first subscribe is rejected (same cause), and the rejected promise blocked any retry;
  //  - the weather integration reloads: the entity is recreated and the old subscription never fires again.
  // So: we resubscribe ourselves on reconnect, retry failures with backoff, resubscribe when the entity
  // comes back from unavailable, and resubscribe if no forecast has arrived for too long.

  EchoWeatherCard.prototype._watchConnection = function () {
    var conn = this._hass && this._hass.connection;
    if (!conn || conn === this._conn || !conn.addEventListener) return;
    var hadConn = !!this._conn;
    this._unwatchConnection();
    var self = this;
    this._conn = conn;
    if (hadConn) { this._subGen++; this._subs = []; this._subEntity = null; } // new connection object: old subs are gone
    this._onConnDown = function () {
      // Old subscription ids die with the socket (and get reused on the new one): forget them, don't unsubscribe.
      self._subGen++;
      self._subs = [];
      self._subEntity = null;
    };
    this._onConnReady = function () {
      if (!self.isConnected) return;
      self._subDelay = 0;
      self._ensureSubscriptions();
    };
    conn.addEventListener("disconnected", this._onConnDown);
    conn.addEventListener("ready", this._onConnReady);
  };

  EchoWeatherCard.prototype._unwatchConnection = function () {
    if (this._conn && this._conn.removeEventListener) {
      this._conn.removeEventListener("disconnected", this._onConnDown);
      this._conn.removeEventListener("ready", this._onConnReady);
    }
    this._conn = null;
  };

  EchoWeatherCard.prototype._resubscribe = function () {
    this._unsubscribe();
    this._ensureSubscriptions();
  };

  EchoWeatherCard.prototype._checkForecastHealth = function () {
    var ent = this._forecastEntity();
    var st = ent ? this._state(ent) : null;
    var down = !st || st.state === "unavailable" || st.state === "unknown";
    var wasDown = this._fcWasDown;
    this._fcWasDown = down;
    if (down || !this._subs.length) return;
    // Back from unavailable (integration reloaded): the old entity's subscription is dead.
    if (wasDown) { this._resubscribe(); return; }
    // Nothing for 90 minutes although providers push every 10-60: assume it's dead.
    if (this._fcLastMsg && Date.now() - this._fcLastMsg > 90 * 60 * 1000) this._resubscribe();
  };

  EchoWeatherCard.prototype._ensureSubscriptions = function () {
    var ent = this._forecastEntity();
    if (!ent || !this._hass || !this._hass.connection) return;
    if (this._subEntity === ent && this._subs.length) return;
    if (this._subRetry) return; // a retry is already scheduled
    this._unsubscribe();
    var sup = this._supports(ent);
    var types = [];
    if (sup.daily) types.push("daily");
    else if (sup.twice) types.push("twice_daily");
    if (sup.hourly) types.push("hourly");
    if (!types.length) return; // entity not loaded yet; try again on the next update
    this._subEntity = ent;
    var self = this;
    var gen = this._subGen;
    this._fcLastMsg = Date.now();
    types.forEach(function (type) {
      var p = self._hass.connection.subscribeMessage(function (msg) {
        if (gen !== self._subGen) return;
        self._fcLastMsg = Date.now();
        self._subDelay = 0;
        var list = msg.forecast || [];
        var key = ent + "|" + type;
        // A provider hiccup sends an empty forecast; keep showing the last good one.
        if (!list.length && self._forecasts[key] && self._forecasts[key].length) return;
        self._forecasts[key] = list;
        self._chartSig = "";
        self._renderChart();
      }, { type: "weather/subscribe_forecast", forecast_type: type, entity_id: ent }, { resubscribe: false });
      p.catch(function () {
        if (gen !== self._subGen) return;
        self._unsubscribe();
        self._scheduleRetry();
      });
      self._subs.push(p);
    });
  };

  EchoWeatherCard.prototype._scheduleRetry = function () {
    if (this._subRetry) return;
    var self = this;
    this._subDelay = Math.min(Math.max(this._subDelay * 2, 5000), 60000);
    this._subRetry = setTimeout(function () {
      self._subRetry = null;
      if (self.isConnected) self._ensureSubscriptions();
    }, this._subDelay);
  };

  EchoWeatherCard.prototype._unsubscribe = function () {
    this._subGen++;
    this._subs.forEach(function (p) {
      Promise.resolve(p).then(function (unsub) { if (typeof unsub === "function") return unsub(); }).catch(function () {});
    });
    this._subs = [];
    this._subEntity = null;
  };

  // ---------- current values ----------

  EchoWeatherCard.prototype._state = function (id) {
    return id && this._hass.states[id] ? this._hass.states[id] : null;
  };

  EchoWeatherCard.prototype._isNight = function () {
    var s = this._state("sun.sun");
    return s ? s.state === "below_horizon" : false;
  };

  EchoWeatherCard.prototype._current = function () {
    var cfg = this._config;
    var src = cfg.sources[this._sourceIndex] || cfg.sources[0];
    var fcEnt = this._forecastEntity();
    var w = this._state(src.entity && src.entity.indexOf("weather.") === 0 ? src.entity : fcEnt);
    var base = this._state(fcEnt);
    var a = w ? w.attributes : {};
    var ba = base ? base.attributes : {};
    var tUnit = a.temperature_unit || ba.temperature_unit || "°F";
    var cur = {
      name: src.name || (w ? w.attributes.friendly_name : ""),
      condition: w ? w.state : "exceptional",
      temp: num(a.temperature),
      humidity: num(a.humidity),
      wind: num(a.wind_speed),
      bearing: num(a.wind_bearing),
      windUnit: a.wind_speed_unit || ba.wind_speed_unit || "mph",
      feels: num(a.apparent_temperature),
      tUnit: tUnit,
    };
    // Sensor-based source: override what it provides.
    if (!(src.entity && src.entity.indexOf("weather.") === 0)) {
      var ts = this._state(src.temperature);
      var hs = this._state(src.humidity);
      if (ts) { cur.temp = num(ts.state); cur.tUnit = ts.attributes.unit_of_measurement || tUnit; }
      if (hs) cur.humidity = num(hs.state);
      cur.feels = null;
    }
    if (cur.feels === null) {
      var tF = toF(cur.temp, cur.tUnit);
      var wMph = cur.wind === null ? null : (cur.windUnit.indexOf("km") !== -1 ? cur.wind / 1.609 : cur.wind);
      var fF = computeFeels(tF, cur.humidity, wMph);
      cur.feels = fF === null ? null : (cur.tUnit.indexOf("C") !== -1 ? (fF - 32) * 5 / 9 : fF);
    }
    return cur;
  };

  EchoWeatherCard.prototype._fmtTime = function (iso) {
    if (!iso) return "--";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "--";
    var opts = { hour: "numeric", minute: "2-digit" };
    var tz = this._hass.config && this._hass.config.time_zone;
    if (tz) opts.timeZone = tz;
    try { return new Intl.DateTimeFormat("en-US", opts).format(d); } catch (e) { return d.toLocaleTimeString(); }
  };

  // ---------- update (cheap; runs on every hass change but bails if nothing relevant moved) ----------

  EchoWeatherCard.prototype._update = function () {
    var cfg = this._config;
    var ids = ["sun.sun", cfg.sunrise, cfg.sunset, cfg.aqi, cfg.moon, this._forecastEntity()];
    cfg.sources.forEach(function (s) { ids.push(s.entity, s.temperature, s.humidity); });
    var sig = String(this._sourceIndex);
    for (var i = 0; i < ids.length; i++) {
      var st = this._state(ids[i]);
      if (st) sig += "|" + st.last_updated;
    }
    if (sig === this._sig) return;
    this._sig = sig;
    this._renderTop();
    this._renderFx();
    if (!this._chartSig) this._renderChart();
  };

  EchoWeatherCard.prototype._renderTop = function () {
    var cfg = this._config;
    var cur = this._current();
    var night = this._isNight();
    var label = CONDITION_LABELS[cur.condition] || cur.condition;
    var srcCount = cfg.sources.length;

    this._nowEl.innerHTML =
      '<div class="cond">' + esc(label) + "</div>" +
      iconSvg(cur.condition, night, "") +
      (srcCount > 1 ? '<div class="src">' + esc(cur.name) + "</div>" : "");

    this._tempEl.textContent = cur.temp === null ? "--" : Math.round(cur.temp) + "°";

    var rise = this._state(cfg.sunrise), set = this._state(cfg.sunset);
    this._s1.innerHTML =
      '<div class="item"><ha-icon icon="mdi:weather-sunset-up" style="color:#ff9800"></ha-icon>' + esc(this._fmtTime(rise ? rise.state : null)) + "</div>" +
      '<div class="item"><ha-icon icon="mdi:weather-sunset-down" style="color:#ff6d3a"></ha-icon>' + esc(this._fmtTime(set ? set.state : null)) + "</div>";

    var aqiSt = this._state(cfg.aqi);
    var aqi = aqiSt ? num(aqiSt.state) : null;
    this._s2.innerHTML =
      '<div class="item"><ha-icon icon="mdi:water-percent" style="color:#4fc3f7"></ha-icon>' + (cur.humidity === null ? "--" : Math.round(cur.humidity) + "%") + "</div>" +
      (cfg.aqi ? '<div class="item"><ha-icon icon="mdi:air-filter" style="color:' + aqiColor(aqi) + '"></ha-icon>AQI ' + (aqi === null ? "--" : Math.round(aqi)) + "</div>" : "");

    var feelsF = toF(cur.feels, cur.tUnit);
    var dir = cur.bearing === null ? "" : " " + COMPASS[Math.round(((cur.bearing % 360) + 360) % 360 / 45) % 8];
    this._s3.innerHTML =
      '<div class="item"><ha-icon icon="mdi:thermometer" style="color:' + feelsColor(feelsF) + '"></ha-icon>Feels ' + (cur.feels === null ? "--" : Math.round(cur.feels) + "°") + "</div>" +
      '<div class="item"><ha-icon icon="mdi:weather-windy" style="color:#4fc3f7"></ha-icon>' + (cur.wind === null ? "--" : Math.round(cur.wind) + dir) + "</div>";
  };

  // ---------- background + animations (rebuilt only when the scene changes) ----------

  EchoWeatherCard.prototype._renderFx = function () {
    var cur = this._current();
    var night = this._isNight();
    var c = cur.condition;
    var wet = WET.indexOf(c) !== -1;
    var cloudyish = c === "cloudy" || c === "partlycloudy" || c === "windy-variant";
    var pAnim = window.EchoShow ? window.EchoShow.prefs.get("weather_animations") : null;
    var anim = pAnim !== null && pAnim !== undefined ? !!pAnim : this._config.animations !== false;

    var moonSt = this._state(this._config.moon);
    var illum = 0.5, waxing = true;
    if (moonSt) {
      var f = num(moonSt.attributes.illumination_fraction);
      if (f !== null) illum = f > 1 ? f / 100 : f;
      waxing = moonSt.state.indexOf("waning") !== -1 || moonSt.state === "last_quarter" ? false : true;
    }

    var sig = [c, night, anim, Math.round(illum * 50), waxing, window.EchoShow && window.EchoShow.theme ? window.EchoShow.theme().id : "", window.EchoShow ? window.EchoShow.prefs.get("weather_sky") : ""].join("|");
    if (sig === this._fxSig) return;
    this._fxSig = sig;

    var ES = window.EchoShow, th = ES && ES.theme ? ES.theme() : null;
    var skyP = ES ? ES.prefs.get("weather_sky") : null;
    var sky = skyP !== null && skyP !== undefined ? !!skyP : !th || th.sky !== false;
    var bg;
    if (!sky) {
      bg = "var(--es-bg,#0a1022)";
    } else if (night) {
      bg = wet || c === "cloudy" ? "linear-gradient(170deg,#0e131c 0%,#19212e 55%,#263041 100%)"
        : "linear-gradient(170deg,#0a1128 0%,#141e44 55%,#22305f 100%)";
    } else if (wet) {
      bg = "linear-gradient(170deg,#3a4556 0%,#525f75 55%,#6b7890 100%)";
    } else if (c === "cloudy") {
      bg = "linear-gradient(170deg,#4a5d7a 0%,#6a7e9b 55%,#8a9cb5 100%)";
    } else {
      bg = "linear-gradient(170deg,#1d5bb0 0%,#377fd2 55%,#64a5e8 100%)";
    }
    this._bgEl.style.background = bg;
    var wantShadow = anim && cloudyish && !night;
    if (wantShadow !== this._rootEl.classList.contains("shadow")) this._chartSig = "";
    this._rootEl.classList.toggle("shadow", wantShadow);

    if (!anim) { this._fxEl.innerHTML = ""; return; }

    var h = "";
    if (night && !wet && c !== "cloudy") {
      h += '<div class="stars" style="background-image:' + TILE_STARS + '"></div>';
    }
    if (night && !wet && c !== "cloudy") {
      h += '<div class="moon">' + moonPhaseSvg(illum, waxing) + "</div>";
    }
    if (!night && (c === "sunny" || c === "partlycloudy")) {
      h += '<div class="sunglow"></div>';
    }
    if (cloudyish || wet) {
      var n = c === "partlycloudy" ? 3 : 5;
      var op = night ? 0.14 : (wet ? 0.28 : (c === "cloudy" ? 0.6 : 0.5));
      for (var i = 0; i < n; i++) {
        var w = 28 + (i * 13) % 22;
        var top = -4 + (i * 11) % 30;
        var dur = 70 + i * 17;
        var delay = -(i * 23 + 7);
        h += '<div class="cloudf" style="width:' + w + "vw;height:" + (w * 0.55) + "vw;top:" + top + "vh;opacity:" + op +
          ";background-image:" + CLOUD_SVG_WHITE + ";animation-duration:" + dur + "s;animation-delay:" + delay + 's"></div>';
      }
    }
    if (c === "rainy" || c === "pouring" || c === "lightning-rainy" || c === "snowy-rainy") {
      var fast = c === "pouring" ? 0.7 : 1.1;
      h += '<div class="slant"><div class="layer rain f240" style="background-image:' + TILE_RAIN_A + ";animation-duration:" + fast + 's"></div>' +
        '<div class="layer rain f240" style="background-image:' + TILE_RAIN_B + ";animation-duration:" + (fast * 1.6) + 's"></div></div>';
    }
    if (c === "snowy" || c === "snowy-rainy" || c === "hail") {
      h += '<div class="layer rain f260" style="background-image:' + TILE_SNOW_A + ';animation-duration:14s"></div>' +
        '<div class="layer rain f200" style="background-image:' + TILE_SNOW_B + ';animation-duration:22s"></div>';
    }
    if (c === "lightning" || c === "lightning-rainy") {
      h += '<div class="flash"></div>';
    }
    if (c === "fog") {
      h += '<div class="fogband" style="top:30vh"></div><div class="fogband" style="top:60vh;animation-duration:55s"></div>';
    }
    this._fxEl.innerHTML = h;
  };

  // ---------- forecast processing ----------

  EchoWeatherCard.prototype._dayKey = function (d) {
    var tz = this._hass.config && this._hass.config.time_zone;
    var opts = { year: "numeric", month: "2-digit", day: "2-digit" };
    if (tz) opts.timeZone = tz;
    try { return new Intl.DateTimeFormat("en-US", opts).format(d); } catch (e) { return d.toDateString(); }
  };

  EchoWeatherCard.prototype._fmt = function (d, opts) {
    var tz = this._hass.config && this._hass.config.time_zone;
    if (tz) opts.timeZone = tz;
    try { return new Intl.DateTimeFormat("en-US", opts).format(d); } catch (e) { return ""; }
  };

  EchoWeatherCard.prototype._dailyData = function () {
    var ent = this._forecastEntity();
    var list = this._forecasts[ent + "|daily"];
    var days = this._config.daily_days || 7;
    var out = [];
    var self = this;
    if (list && list.length) {
      list.slice(0, days).forEach(function (f) {
        var d = new Date(f.datetime);
        out.push({
          date: d,
          top: self._fmt(d, { weekday: "short" }),
          sub: self._fmt(d, { day: "numeric" }),
          condition: f.condition,
          night: false,
          hi: num(f.temperature),
          lo: num(f.templow),
          precip: num(f.precipitation),
          prob: num(f.precipitation_probability),
        });
      });
      return out;
    }
    var twice = this._forecasts[ent + "|twice_daily"];
    if (!twice || !twice.length) return out;
    var byDay = {}, order = [];
    twice.forEach(function (f) {
      var d = new Date(f.datetime);
      var k = self._dayKey(d);
      if (!byDay[k]) { byDay[k] = { date: d, day: null, night: null }; order.push(k); }
      if (f.is_daytime === false) byDay[k].night = f; else byDay[k].day = f;
    });
    order.slice(0, days).forEach(function (k) {
      var e = byDay[k], day = e.day, nt = e.night;
      var p1 = day ? num(day.precipitation) : null, p2 = nt ? num(nt.precipitation) : null;
      var q1 = day ? num(day.precipitation_probability) : null, q2 = nt ? num(nt.precipitation_probability) : null;
      out.push({
        date: e.date,
        top: self._fmt(e.date, { weekday: "short" }),
        sub: self._fmt(e.date, { day: "numeric" }),
        condition: day ? day.condition : nt.condition,
        night: !day,
        hi: day ? num(day.temperature) : null,
        lo: nt ? num(nt.temperature) : null,
        precip: p1 === null && p2 === null ? null : (p1 || 0) + (p2 || 0),
        prob: q1 === null && q2 === null ? null : Math.max(q1 || 0, q2 || 0),
      });
    });
    return out;
  };

  EchoWeatherCard.prototype._nightAt = function (d) {
    // Compare the time of day against today's sunrise/sunset.
    var rise = this._state(this._config.sunrise), set = this._state(this._config.sunset);
    if (!rise || !set) return false;
    var r = new Date(rise.state), s = new Date(set.state);
    function mins(x) { return x.getUTCHours() * 60 + x.getUTCMinutes(); }
    var m = mins(d), mr = mins(r), ms = mins(s);
    // Work in UTC minutes of day; handle wrap-around.
    if (mr < ms) return m < mr || m >= ms;
    return m >= ms && m < mr;
  };

  EchoWeatherCard.prototype._hourlyData = function () {
    var ent = this._forecastEntity();
    var list = this._forecasts[ent + "|hourly"];
    if (!list || !list.length) return [];
    var g = this._config.hourly_group || 2;
    var hours = this._config.hourly_hours || 48;
    var now = Date.now() - 3600 * 1000;
    list = list.filter(function (f) { return new Date(f.datetime).getTime() >= now; }).slice(0, hours);
    var out = [], self = this, lastDay = "";
    for (var i = 0; i < list.length; i += g) {
      var grp = list.slice(i, i + g);
      var d = new Date(grp[0].datetime);
      var t = 0, tn = 0, p = null, q = null, ws = 0, wn = 0, ux = 0, uy = 0;
      grp.forEach(function (f) {
        var v = num(f.temperature);
        if (v !== null) { t += v; tn++; }
        var w = num(f.wind_speed), wb = num(f.wind_bearing);
        if (w !== null) { ws += w; wn++; }
        if (wb !== null) { var wr = wb * Math.PI / 180, wwt = w === null ? 1 : Math.max(w, 0.1); ux += Math.sin(wr) * wwt; uy += Math.cos(wr) * wwt; }
        var pv = num(f.precipitation);
        if (pv !== null) p = (p || 0) + pv;
        var qv = num(f.precipitation_probability);
        if (qv !== null) q = Math.max(q || 0, qv);
      });
      var dk = self._fmt(d, { weekday: "short" });
      var cond = grp[0].condition;
      var nightSlot = self._nightAt(d);
      if (nightSlot && cond === "sunny") cond = "clear-night";
      out.push({
        date: d,
        top: self._fmt(d, { hour: "numeric" }),
        sub: dk !== lastDay ? dk : "",
        condition: cond,
        night: nightSlot,
        hi: tn ? t / tn : null,
        lo: null,
        precip: p,
        prob: q,
        wind: wn ? ws / wn : null,
        bearing: ux || uy ? (Math.atan2(ux, uy) * 180 / Math.PI + 360) % 360 : null,
      });
      lastDay = dk;
    }
    return out;
  };

  // ---------- chart ----------

  function smoothPath(pts) {
    // Catmull-Rom -> cubic Bezier through the given [x,y] points.
    if (pts.length < 2) return "";
    var d = "M" + pts[0][0].toFixed(1) + " " + pts[0][1].toFixed(1);
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      var c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
      var c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += " C" + c1x.toFixed(1) + " " + c1y.toFixed(1) + " " + c2x.toFixed(1) + " " + c2y.toFixed(1) + " " + p2[0].toFixed(1) + " " + p2[1].toFixed(1);
    }
    return d;
  }

  function segments(vals, xs, yOf) {
    var segs = [], cur = [];
    for (var i = 0; i < vals.length; i++) {
      if (vals[i] === null) { if (cur.length) segs.push(cur); cur = []; }
      else cur.push([xs[i], yOf(vals[i])]);
    }
    if (cur.length) segs.push(cur);
    return segs;
  }

  EchoWeatherCard.prototype._renderChart = function () {
    if (!this._built || !this._hass) return;
    var W = this._fcEl.clientWidth, H = this._fcEl.clientHeight;
    if (!W || !H) return;
    var data = this._mode === "hourly" ? this._hourlyData() : this._dailyData();
    if (this._mode === "hourly" && !data.length) { this._mode = "daily"; data = this._dailyData(); }
    var ent = this._forecastEntity();
    var shadowOn = this._rootEl.classList.contains("shadow");
    var sig = [this._mode, W, H, ent, shadowOn, data.length,
      JSON.stringify(data.map(function (d) { return [d.hi, d.lo, d.precip, d.prob, d.condition, d.top, d.wind, d.bearing]; }))].join("|");
    if (sig === this._chartSig) return;
    this._chartSig = sig;

    if (!data.length) { this._scrollEl.innerHTML = ""; return; }

    var st = this._state(ent);
    var tUnit = st ? st.attributes.temperature_unit || "°F" : "°F";
    var pUnit = st ? st.attributes.precipitation_unit || "in" : "in";

    var vh = window.innerHeight / 100;
    var colW = W / 7;
    var n = data.length;
    var totalW = Math.max(W, colW * n);
    var fs = 3.4 * vh;            // chart label font
    var topFs = (this._mode === "hourly" ? 3.8 : 4.5) * vh;
    var subFs = 3 * vh;
    var iconS = 8 * vh;

    var yTop = topFs * 0.95;
    var ySub = yTop + subFs * 1.2;
    var yIcon = ySub + 0.8 * vh;
    var chartTop = yIcon + iconS + 0.6 * vh;

    var yPrecipText = H - 2.2 * vh;
    var barBottom = yPrecipText - fs * 1.05;
    var barBand = 4.5 * vh;
    var barTop = barBottom - barBand;
    // Hourly view: a wind row (direction arrow + speed) between the lines and the rain bars.
    var pWind = window.EchoShow ? window.EchoShow.prefs.get("weather_wind") : true;
    var showWind = this._mode === "hourly" && pWind !== false && data.some(function (d) { return d.wind !== null && d.wind !== undefined; });
    var wFs = 3.4 * vh, yWind = barTop - 1.4 * vh;
    var lineTop = chartTop + fs * 1.3;
    var lineBottom = (showWind ? yWind - wFs * 1.25 : barTop) - fs * 1.35;
    if (lineBottom - lineTop < 4 * vh) lineBottom = lineTop + 4 * vh;

    var his = data.map(function (d) { return d.hi; });
    var los = data.map(function (d) { return d.lo; });
    var all = his.concat(los).filter(function (v) { return v !== null; });
    var minT = Math.min.apply(null, all), maxT = Math.max.apply(null, all);
    if (!all.length) { minT = 0; maxT = 1; }
    if (maxT - minT < 8) { var mid = (maxT + minT) / 2; minT = mid - 4; maxT = mid + 4; }
    function yOf(t) { return lineBottom - (t - minT) / (maxT - minT) * (lineBottom - lineTop); }

    var xs = data.map(function (d, i) { return colW * i + colW / 2; });

    var t = "";
    var s = '<svg width="' + totalW + '" height="' + H + '" viewBox="0 0 ' + totalW + " " + H + '" xmlns="http://www.w3.org/2000/svg">';

    // gradient for the high line, coloured by temperature at each point
    var toFf = function (v) { return toF(v, tUnit); };
    s += '<defs><linearGradient id="ewcHi" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="' + totalW + '" y2="0">';
    for (var i = 0; i < n; i++) {
      if (his[i] !== null) s += '<stop offset="' + (xs[i] / totalW).toFixed(4) + '" stop-color="' + tempColor(toFf(his[i])) + '"/>';
    }
    s += '</linearGradient><linearGradient id="ewcLo" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="' + totalW + '" y2="0">';
    for (i = 0; i < n; i++) {
      if (los[i] !== null) s += '<stop offset="' + (xs[i] / totalW).toFixed(4) + '" stop-color="' + tempColor(toFf(los[i])) + '"/>';
    }
    s += '</linearGradient><filter id="ewcTs" x="-20%" y="-40%" width="140%" height="180%"><feDropShadow dx="0" dy="1.5" stdDeviation="2.5" flood-color="#000" flood-opacity="0.85"/></filter></defs>';

    // header: day/time, date, icon
    for (i = 0; i < n; i++) {
      var d = data[i];
      t += '<text x="' + xs[i] + '" y="' + yTop + '" text-anchor="middle" font-size="' + topFs + '" fill="#fff">' + esc(d.top) + "</text>";
      if (d.sub) t += '<text x="' + xs[i] + '" y="' + ySub + '" text-anchor="middle" font-size="' + subFs + '" fill="rgba(255,255,255,0.85)">' + esc(d.sub) + "</text>";
      s += '<svg x="' + (xs[i] - iconS / 2) + '" y="' + yIcon + '" width="' + iconS + '" height="' + (iconS * 1.1) + '" viewBox="0 0 100 110">' + weatherIcon(d.condition, d.night) + "</svg>";
    }

    // precipitation bars + labels (own band at the bottom, never overlapping the temperature labels)
    var useAmount = data.some(function (d) { return d.precip !== null; });
    var maxP = 0;
    data.forEach(function (d) { if (d.precip !== null && d.precip > maxP) maxP = d.precip; });
    var scaleP = Math.max(maxP, pUnit === "mm" ? 6 : 0.25);
    for (i = 0; i < n; i++) {
      var dd = data[i], label = "", frac = 0;
      if (useAmount) {
        var minShow = pUnit === "mm" ? 0.5 : 0.01;
        if (dd.precip !== null && dd.precip >= minShow) {
          label = pUnit === "in" ? dd.precip.toFixed(2) + "″" : dd.precip.toFixed(1) + " mm";
          frac = dd.precip / scaleP;
        }
      } else if (dd.prob !== null && dd.prob >= 10) {
        label = Math.round(dd.prob) + "%";
        frac = dd.prob / 100;
      }
      if (label) {
        var bh = Math.max(0.5 * vh, Math.min(1, frac) * barBand);
        var bw = colW * 0.34;
        s += '<rect x="' + (xs[i] - bw / 2) + '" y="' + (barBottom - bh) + '" width="' + bw + '" height="' + bh + '" rx="' + Math.min(bw / 4, 0.8 * vh) + '" fill="rgba(90,150,255,0.85)"/>';
        t += '<text x="' + xs[i] + '" y="' + yPrecipText + '" text-anchor="middle" font-size="' + fs + '" fill="#9fd3ff">' + esc(label) + "</text>";
      }
    }

    // temperature lines
    var hiSegs = segments(his, xs, yOf);
    hiSegs.forEach(function (seg) {
      s += '<path d="' + smoothPath(seg) + '" fill="none" stroke="url(#ewcHi)" stroke-width="' + (0.55 * vh) + '" stroke-linecap="round"/>';
    });
    var loSegs = segments(los, xs, yOf);
    loSegs.forEach(function (seg) {
      s += '<path d="' + smoothPath(seg) + '" fill="none" stroke="url(#ewcLo)" stroke-width="' + (0.45 * vh) + '" stroke-linecap="round"/>';
    });

    // points + labels
    for (i = 0; i < n; i++) {
      if (his[i] !== null) {
        var y = yOf(his[i]);
        s += '<circle cx="' + xs[i] + '" cy="' + y + '" r="' + (0.65 * vh) + '" fill="' + tempColor(toFf(his[i])) + '"/>';
        t += '<text x="' + xs[i] + '" y="' + (y - 1.3 * vh) + '" text-anchor="middle" font-size="' + fs + '" fill="#fff">' + Math.round(his[i]) + "°</text>";
      }
      if (los[i] !== null) {
        var yl = yOf(los[i]);
        s += '<circle cx="' + xs[i] + '" cy="' + yl + '" r="' + (0.55 * vh) + '" fill="' + tempColor(toFf(los[i])) + '"/>';
        t += '<text x="' + xs[i] + '" y="' + (yl + fs * 1.05) + '" text-anchor="middle" font-size="' + fs + '" fill="rgba(255,255,255,0.85)">' + Math.round(los[i]) + "°</text>";
      }
    }

    if (showWind) {
      // Just the number: the unit is the same in every column (mph, km/h... as the source reports).
      var aS = 2.9 * vh;
      for (i = 0; i < n; i++) {
        var wd = data[i];
        if (wd.wind === null || wd.wind === undefined) continue;
        var spd = String(Math.round(wd.wind));
        var tw = (spd.length * 0.56 + 0.4) * wFs;
        var ax = xs[i] - tw / 2 - aS * 0.45, ay = yWind - wFs * 0.35;
        if (wd.bearing !== null && wd.bearing !== undefined) {
          // Arrow points the way the wind blows (bearing is where it comes from).
          s += '<g transform="translate(' + ax.toFixed(1) + " " + ay.toFixed(1) + ") rotate(" + ((wd.bearing + 180) % 360).toFixed(0) + ')">' +
            '<path d="M0 ' + (-aS / 2) + " L" + (aS * 0.38) + " " + (aS / 2) + " L0 " + (aS * 0.24) + " L" + (-aS * 0.38) + " " + (aS / 2) + ' Z" fill="#9be7ff"/></g>';
        }
        t += '<text x="' + (xs[i] + aS * 0.35) + '" y="' + yWind + '" text-anchor="middle" font-size="' + wFs + '" fill="#cdeffd">' + esc(spd) + "</text>";
      }
    }

    s += '<g class="txt"' + (shadowOn ? ' filter="url(#ewcTs)"' : "") + ">" + t + "</g></svg>";
    this._scrollEl.innerHTML = s;
  };

  // ---------- source picker ----------

  EchoWeatherCard.prototype._openPicker = function () {
    var cfg = this._config;
    if (cfg.sources.length < 2) return;
    var night = this._isNight();
    var h = '<div class="panel"><h2>Weather source</h2>';
    for (var i = 0; i < cfg.sources.length; i++) {
      var s = cfg.sources[i];
      var isW = s.entity && s.entity.indexOf("weather.") === 0;
      var st, temp = null, cond = null, note = "";
      if (isW) {
        st = this._state(s.entity);
        if (st) { temp = num(st.attributes.temperature); cond = st.state; }
        else note = "unavailable";
      } else {
        st = this._state(s.temperature);
        if (st) temp = num(st.state);
        var hs = this._state(s.humidity);
        note = "Temperature" + (hs ? " & humidity" : "") + " only";
      }
      if (isW && st && cond) note = CONDITION_LABELS[cond] || cond;
      h += '<div class="row' + (i === this._sourceIndex ? " sel" : "") + '" role="button" data-i="' + i + '">' +
        (cond ? iconSvg(cond, night, "") : '<svg viewBox="0 0 100 110"></svg>') +
        '<div class="nm">' + esc(s.name || (st ? st.attributes.friendly_name : s.entity)) + "<small>" + esc(note) + "</small></div>" +
        '<div class="tv">' + (temp === null ? "--" : Math.round(temp) + "°") + "</div>" +
        '<div class="ck">' + (i === this._sourceIndex ? "✓" : "") + "</div></div>";
    }
    h += "</div>";
    this._popEl.innerHTML = h;
    this._popEl.classList.remove("hidden");
  };

  EchoWeatherCard.prototype._selectSource = function (i) {
    if (isNaN(i) || i === this._sourceIndex) return;
    this._sourceIndex = i;
    this._saveSource(i);
    this._sig = "";
    this._fxSig = "";
    this._chartSig = "";
    this._ensureSubscriptions();
    this._update();
    this._renderChart();
  };

  if (!customElements.get("echo-weather-card")) {
    customElements.define("echo-weather-card", EchoWeatherCard);
  }
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "echo-weather-card",
    name: "Echo Weather Card",
    description: "Full-screen, low-overhead weather display for wall tablets",
  });
  if (window.console && console.info) console.info("echo-weather-card " + VERSION);
})();

/* ===== echo-clock-card.js ===== */
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

  var VERSION = "2.3.0";

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
    ".tbl{position:absolute;left:0;top:.8vh;height:6.4vh;padding:0 3vh;border-radius:3.2vh;display:none;align-items:center;font-size:3vh;cursor:pointer;color:var(--es-hi,#ffb340);background:rgba(255,255,255,.08);}",
    ".root[data-tab=alarms] .tbl.edit-alarms.has{display:flex;}",
    ".tbl:active{transform:scale(.95);}",
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
    /* swipe-to-delete: the row slides left over a red Delete button */
    ".aw{position:relative;border-radius:3vh;overflow:hidden;}",
    ".adel{position:absolute;right:0;top:0;bottom:0;width:20vh;display:flex;align-items:center;justify-content:center;gap:1vh;background:#ff3b30;color:#fff;font-size:3vh;font-weight:500;cursor:pointer;opacity:0;}",
    ".adel ha-icon{--mdc-icon-size:3.6vh;width:3.6vh;height:3.6vh;}",
    ".aw.reveal .adel{opacity:1;}",
    ".aw .arow{position:relative;touch-action:pan-y;transition:transform .22s ease;background:linear-gradient(180deg,rgba(255,255,255,.075),rgba(255,255,255,.03)),var(--es-pan2,#141b30);}",
    ".aw.drag .arow{transition:none;}",
    ".ax{display:none;flex:0 0 auto;width:7vh;height:7vh;margin-right:-.4vh;align-items:center;justify-content:center;color:#ff453a;cursor:pointer;}",
    ".ax ha-icon{--mdc-icon-size:5.4vh;width:5.4vh;height:5.4vh;}",
    ".alist.editing .ax{display:flex;}",
    ".alist.editing .sw{display:none;}",
    ".ax:active{transform:scale(.9);}",
    /* alarm volume row */
    ".avol{flex:0 0 auto;display:none;align-items:center;gap:1.6vh;margin:0 .4vh 1.6vh;}",
    ".avol.on{display:flex;}",
    ".avol > ha-icon{--mdc-icon-size:3.6vh;width:3.6vh;height:3.6vh;color:rgba(255,255,255,.7);}",
    ".avol .vl{font-size:2.8vh;color:rgba(255,255,255,.75);white-space:nowrap;}",
    ".vtrack{position:relative;flex:1 1 auto;height:6.4vh;border-radius:3.2vh;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.08);overflow:hidden;touch-action:none;cursor:ew-resize;}",
    ".vfill{position:absolute;left:0;top:0;bottom:0;width:100%;background:linear-gradient(90deg,var(--es-acc2,#ff8a00),var(--es-hi,#ffb340));transform-origin:left;}",
    ".vv{position:absolute;right:2vh;top:0;bottom:0;display:flex;align-items:center;font-size:2.5vh;font-variant-numeric:tabular-nums;text-shadow:0 0 .6vh rgba(0,0,0,.6);}",
    ".vtest{flex:0 0 auto;width:6.4vh;height:6.4vh;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;background:rgba(52,199,89,.2);border:1px solid rgba(52,199,89,.45);color:#5ee07f;}",
    ".vtest ha-icon{--mdc-icon-size:3.6vh;width:3.6vh;height:3.6vh;}",
    ".vtest:active{transform:scale(.92);}",
    ".avol.wait .vtrack{opacity:.5;}",
    /* toast action */
    ".toast .tact{margin-left:2.4vh;color:var(--es-hi,#ffb340);font-weight:500;cursor:pointer;pointer-events:auto;}",
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
    if (!this._devL) {   // this display's device (own timers, area) becomes known after the first render
      this._devL = true;
      var me = this;
      window.addEventListener("echo-show-device", function () { if (me._hass) { me._badgeSig = ""; me._sig = ""; me.hass = me._hass; } });
    }
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
    this._prof = prof;
    for (k in this._raw) config[k] = this._raw[k];
    if (prof) for (k in prof) if (k !== "match") config[k] = prof[k];
    // A configured timer_prefix wins; else this display's own set (timer.<device>_timer_N), else the shared one.
    this._fixedPrefix = !!(config.timer_prefix || config.slots);
    var prefix = config.timer_prefix || this._ownPrefix || "echo_timer";
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
      if (!this._fixedPrefix) {
        var ES = window.EchoShow, own = ES && ES.ownTimerPrefix ? ES.ownTimerPrefix(hass) : null;
        if (own && own !== this._ownPrefix) { this._ownPrefix = own; this._applyProfile(this._prof || null); this._sig = ""; }
      }
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

  // The assist satellite to watch: this display's native Kiosk Satellite one
  // (assist_satellite.<device>_assist_satellite) when it has one, else the configured one. The configured
  // one used to come first, so every display paused its timer alarm while the configured display listened.
  EchoClockCard.prototype._satState = function () {
    var h = this._hass, st = h ? h.states : null, id = this._config.satellite;
    if (!st) return null;
    var slug = this._devSlug;
    if (slug) {
      if (this._satAuto && st[this._satAuto] && st[this._satAuto].state !== "unavailable") return st[this._satAuto];
      this._satAuto = null;
      for (var k in st) {
        if (k.indexOf("assist_satellite.") !== 0 || st[k].state === "unavailable") continue;
        var o = k.slice(17);   // assist_satellite.<area>_<device>_assist_satellite, or assist_satellite.<device>
        if ((o.indexOf(slug) !== -1 && /_assist_satellite$/.test(o)) || o === slug || o.slice(-slug.length - 1) === "_" + slug) { this._satAuto = k; return st[k]; }
      }
    }
    return id ? st[id] || null : null;
  };

  EchoClockCard.prototype._voiceBusy = function () {
    var sat = this._satState();
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
      '<div class="tbl edit-alarms" role="button">Edit</div>' +
      '<div class="tb add-alarm" role="button"><ha-icon icon="mdi:plus"></ha-icon></div></div>' +
      '<div class="pane p-alarms"><div class="anext"></div>' +
      '<div class="avol"><ha-icon icon="mdi:volume-high"></ha-icon><span class="vl">Alarm volume</span>' +
      '<div class="vtrack"><div class="vfill"></div><div class="vv"></div></div>' +
      '<div class="vtest" role="button"><ha-icon icon="mdi:play"></ha-icon></div></div>' +
      '<div class="aring"></div><div class="alist"></div>' +
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
      if (Date.now() - (self._swipedAt || 0) < 400) return;      // the end of a swipe, not a tap
      var t = ev.target.closest ? ev.target.closest("[data-a]") : null;
      if (!t) return;
      var act = t.getAttribute("data-a");
      if (act === "retry") { self._alarmsLoad(true); return; }
      var a = self._alarms && self._alarms[parseInt(t.getAttribute("data-k"), 10)];
      if (!a) return;
      if (act === "del") { ev.stopPropagation(); self._alarmDelete(a); return; }
      if (self._swOpen) { self._swClose(); return; }               // a tap elsewhere closes an open row
      if (act === "toggle") { ev.stopPropagation(); self._alarmToggle(a); }
      else if (act === "edit" && !self._editing) self._openSheet(a);
    });
    this._bindSwipe();
    root.querySelector(".edit-alarms").addEventListener("click", function () {
      self._editing = !self._editing;
      self._swClose();
      self._paintAlarms();
    });
    this._bindVolume();
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
    else if (this._editing) { this._editing = false; this._paintAlarms(); }
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

  EchoClockCard.prototype._toast = function (msg, actLabel, act) {
    var el = this._toastEl;
    if (!el) return;
    el.textContent = msg;
    if (actLabel) {
      var b = document.createElement("span");
      b.className = "tact";
      b.setAttribute("role", "button");
      b.textContent = actLabel;
      b.addEventListener("click", function () { el.classList.remove("on"); act(); });
      el.appendChild(b);
    }
    el.classList.add("on");
    if (this._toastT) clearTimeout(this._toastT);
    this._toastT = setTimeout(function () { el.classList.remove("on"); }, actLabel ? 6500 : 4200);
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
    this._volLoad();
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
        h += '<div class="aw" data-k="' + k + '"><div class="adel" role="button" data-a="del" data-k="' + k + '"><ha-icon icon="mdi:delete-outline"></ha-icon>Delete</div>' +
          '<div class="arow' + (a.on ? "" : " off") + (self._alarmBusy[a.time + "|" + (a.label || "")] ? " busy" : "") + '" role="button" data-a="edit" data-k="' + k + '">' +
          '<div class="ax" role="button" data-a="del" data-k="' + k + '"><ha-icon icon="mdi:close-circle"></ha-icon></div>' +
          '<div class="ab"><div class="tm">' + self._fmtTime(a.time, true) + '</div><div class="lb">' + esc(lb) + "</div></div>" +
          '<div class="sw' + (a.on ? " on" : "") + '" role="switch" data-a="toggle" data-k="' + k + '"></div></div></div>';
      });
    }
    if (!list || !list.length) this._editing = false;
    this._aList.className = "alist" + (!list || list.length < 3 ? " one" : "") + (this._editing ? " editing" : "");
    this._aList.innerHTML = h;
    this._swOpen = null;
    var eb = this.shadowRoot.querySelector(".edit-alarms");
    if (eb) {
      eb.textContent = this._editing ? "Done" : "Edit";
      var has = !!(list && list.length);
      if (has !== eb.classList.contains("has")) eb.classList.toggle("has");
    }
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

  // ----- swipe to delete -----

  EchoClockCard.prototype._swClose = function () {
    var w = this._swOpen;
    this._swOpen = null;
    if (!w) return;
    var row = w.querySelector(".arow");
    row.style.transform = "";
    setTimeout(function () { w.classList.remove("reveal"); }, 230);
  };

  EchoClockCard.prototype._bindSwipe = function () {
    var self = this, list = this._aList, d = null;
    list.addEventListener("pointerdown", function (ev) {
      if (self._editing || ev.button > 0) return;
      var w = ev.target.closest ? ev.target.closest(".aw") : null;
      if (!w || (ev.target.closest && ev.target.closest(".sw,.adel"))) return;
      if (self._swOpen && self._swOpen !== w) self._swClose();
      var del = w.querySelector(".adel").getBoundingClientRect().width;
      d = { w: w, row: w.querySelector(".arow"), x: ev.clientX, y: ev.clientY, base: self._swOpen === w ? -del : 0, max: del, horiz: null, id: ev.pointerId };
    });
    list.addEventListener("pointermove", function (ev) {
      if (!d || ev.pointerId !== d.id) return;
      var dx = ev.clientX - d.x, dy = ev.clientY - d.y;
      if (d.horiz === null) {
        if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
          d.horiz = true;
          d.w.classList.add("drag", "reveal");
          try { d.row.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
        } else if (Math.abs(dy) > 10) { d = null; return; }
      }
      if (!d.horiz) return;
      var x = Math.max(-d.max * 1.25, Math.min(0, d.base + dx));
      d.row.style.transform = "translateX(" + x + "px)";
      ev.preventDefault();
    });
    function end(ev) {
      if (!d) return;
      var dd = d;
      d = null;
      if (!dd.horiz) return;
      self._swipedAt = Date.now();
      dd.w.classList.remove("drag");
      var x = parseFloat((dd.row.style.transform.match(/-?[\d.]+/) || [0])[0]);
      if (x < -dd.max / 2) {
        dd.row.style.transform = "translateX(" + (-dd.max) + "px)";
        self._swOpen = dd.w;
      } else {
        self._swOpen = dd.w;
        self._swClose();
      }
    }
    list.addEventListener("pointerup", end);
    list.addEventListener("pointercancel", end);
  };

  // ----- delete, with Undo -----

  EchoClockCard.prototype._alarmDelete = function (a) {
    var self = this, key = a.time + "|" + (a.label || "");
    if (this._alarmBusy[key]) return;
    this._alarmBusy[key] = true;
    this._swOpen = null;
    var copy = { time: a.time, days: daysOf(a).slice(), label: a.label || "", on: a.on };
    this._req({ action: "delete", time: a.time, label: a.label || "" }).then(function (r) {
      delete self._alarmBusy[key];
      if (r && r.ok) {
        if (self._alarms) self._alarms = self._alarms.filter(function (x) { return x !== a; });
        self._paintAlarms();
        self._toast((copy.label || "Alarm") + " at " + self._fmtTime(copy.time) + " deleted.", "Undo", function () { self._alarmRestore(copy); });
      } else {
        self._toast(self._errText(r));
        self._paintAlarms();
      }
      self._alarmsLoad(true);
    });
  };

  EchoClockCard.prototype._alarmRestore = function (c) {
    var self = this;
    this._req({ action: "set", time: c.time, days: c.days, label: c.label }).then(function (r) {
      if (r && r.ok && !c.on) return self._req({ action: "turn_off", time: c.time, label: c.label });
      return r;
    }).then(function (r) {
      if (r && r.ok === false) self._toast(self._errText(r));
      self._alarmsLoad(true);
    });
  };

  // ----- alarm volume (Kiosk Satellite's alarms.volume, through shell_command.echo_kiosk) -----

  EchoClockCard.prototype._ksAvail = function () {
    var sv = this._hass && this._hass.services;
    return !!(sv && sv.shell_command && sv.shell_command.echo_kiosk) && !!this._kiosk();
  };

  EchoClockCard.prototype._ksCall = function (op, data) {
    var kiosk = (this._kiosk() + " " + (this._devSlug || "")).trim();
    return this._hass.callWS({ type: "call_service", domain: "shell_command", service: "echo_kiosk", service_data: { kiosk: kiosk, op: op, data: data || {} }, return_response: true })
      .then(function (r) {
        try { return JSON.parse(((r && r.response) || {}).stdout || ""); } catch (e) { return { ok: false }; }
      }, function () { return { ok: false }; });
  };

  EchoClockCard.prototype._volLoad = function () {
    var self = this;
    if (!this._ksAvail()) { this._paintVol(); return; }
    if (this._volBusy || (this._volAt && Date.now() - this._volAt < 15000)) { this._paintVol(); return; }
    this._volBusy = true;
    this._ksCall("get").then(function (r) {
      self._volBusy = false;
      self._volAt = Date.now();
      if (r && r.ok && r.settings) {
        self._vol = Math.round((parseFloat(r.settings["alarms.volume"]) || 0.7) * 100);
        self._volTone = r.settings["alarms.tone"] || "";
      }
      self._paintVol();
    });
  };

  EchoClockCard.prototype._paintVol = function () {
    var el = this.shadowRoot && this.shadowRoot.querySelector(".avol");
    if (!el) return;
    var show = this._ksAvail() && this._vol !== undefined;
    if (show !== el.classList.contains("on")) el.classList.toggle("on");
    if (!show) return;
    var v = this._volDrag !== undefined ? this._volDrag : this._vol;
    el.querySelector(".vfill").style.transform = "scaleX(" + ((v - 5) / 95).toFixed(3) + ")";
    el.querySelector(".vv").textContent = v + "%";
  };

  EchoClockCard.prototype._bindVolume = function () {
    var self = this, el = this.shadowRoot.querySelector(".avol"), tr = el.querySelector(".vtrack"), drag = false;
    function at(x) {
      var r = tr.getBoundingClientRect();
      var f = Math.max(0, Math.min(1, (x - r.left) / r.width));
      self._volDrag = Math.round((5 + f * 95) / 5) * 5;
      self._paintVol();
    }
    tr.addEventListener("pointerdown", function (ev) {
      drag = true;
      try { tr.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
      at(ev.clientX);
      ev.preventDefault();
    });
    tr.addEventListener("pointermove", function (ev) { if (drag) at(ev.clientX); });
    function end() {
      if (!drag) return;
      drag = false;
      var v = self._volDrag;
      self._volDrag = undefined;
      if (v === undefined) return;
      self._vol = v;
      self._paintVol();
      el.classList.add("wait");
      // Save, then play the tone once at the new volume so you can hear it.
      self._ksCall("set", { "alarms.volume": v / 100 }).then(function (r) {
        el.classList.remove("wait");
        if (!r || !r.ok) { self._toast("The tablet didn\u2019t take the new volume."); self._volAt = 0; self._volLoad(); return; }
        self._volAt = Date.now();
        self._ksCall("test", { tone: self._volTone || "builtin" });
      });
    }
    tr.addEventListener("pointerup", end);
    tr.addEventListener("pointercancel", end);
    el.querySelector(".vtest").addEventListener("click", function () {
      self._ksCall("test", { tone: self._volTone || "builtin" });
    });
  };

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
    var sat = this._satState();
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

/* ===== echo-media-card.js ===== */
/*
 * echo-media-card
 * Full-screen Sonos "now playing" page for an Echo Show 8 kiosk (companion to
 * echo-weather-card and echo-timer-card). Controls Sonos speakers exposed in Home
 * Assistant; nothing is ever played on the tablet itself, so the Kiosk Satellite's
 * voice assistant (and its audio ducking) is never interrupted by this card.
 *
 *  - Now playing: album art left, info + controls right. Without art the info block
 *    re-centres and grows to fill the screen.
 *  - Speakers panel: group / ungroup rooms, per-speaker volume and mute.
 *  - Browse: radio (with a SomaFM station menu), the Music Assistant library and Spotify.
 *  - Queue: live from the Music Assistant server when ma_url + ma_token are set.
 *  - Goes back to the home view after a timeout, but never while music is playing.
 *
 * Plain JavaScript, no dependencies, no build step. ES5-ish for older Chromium.
 */
(function () {
  "use strict";

  var VERSION = "1.14.0";

  // media_player supported_features bits
  var F_PAUSE = 1, F_SEEK = 2, F_VOLUME = 4, F_MUTE = 8, F_PREV = 16, F_NEXT = 32, F_SHUFFLE = 32768, F_REPEAT = 262144;
  var PLAYING = { playing: 1, buffering: 1 };
  var ACTIVE = { playing: 1, paused: 1, buffering: 1 };

  function esc(s) {
    return String(s === undefined || s === null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (h ? h + ":" + (m < 10 ? "0" : "") : "") + m + ":" + (s < 10 ? "0" : "") + s;
  }

  function fmtCountdown(sec) {
    sec = Math.max(0, Math.ceil(sec));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (h > 0 ? h + ":" + (m < 10 ? "0" : "") + m : String(m)) + ":" + (s < 10 ? "0" : "") + s;
  }

  function parseHms(s) {
    var p = String(s || "").split(":");
    if (p.length !== 3) return 0;
    return parseInt(p[0], 10) * 3600 + parseInt(p[1], 10) * 60 + parseFloat(p[2]);
  }

  function navigate(path) {
    window.history.pushState(null, "", path);
    window.dispatchEvent(new Event("location-changed", { bubbles: true, composed: true }));
  }

  // ---------- which display is this? (same scheme as the weather/timer cards) ----------

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

  // This display's own timer set (timer.<device>_timer_N) when Home Assistant has one.
  function ownTimers(hass) { var ES = window.EchoShow; return ES && ES.ownTimerPrefix ? ES.ownTimerPrefix(hass) : null; }
  function matchDisplay(devices, name) {
    if (!devices || !name) return null;
    var n = String(name).toLowerCase();
    for (var i = 0; i < devices.length; i++) {
      var mt = devices[i].match;
      if (mt && n.indexOf(String(mt).toLowerCase()) !== -1) return devices[i];
    }
    return null;
  }

  // ---------- styles ----------

  var STYLE = [
    ":host{display:block;height:100vh;width:100%;overflow:hidden;font-family:var(--es-font,var(--ha-font-family-body,Roboto,'Helvetica Neue',Arial,sans-serif));color:#fff;-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none;}",
    ".root{position:relative;height:100vh;width:100%;overflow:hidden;box-sizing:border-box;background:var(--es-base,#0a1022);}",
    ".bg0{position:absolute;left:0;top:0;right:0;bottom:0;background:var(--es-bg,radial-gradient(110% 90% at 0% 0%,#223567 0%,rgba(34,53,103,0) 60%),radial-gradient(90% 80% at 100% 100%,#0d3b4f 0%,rgba(13,59,79,0) 60%),#0a1022);}",
    ".bgart{position:absolute;left:-10%;top:-10%;right:-10%;bottom:-10%;background-size:cover;background-position:center;filter:blur(60px) saturate(1.3);opacity:0;transition:opacity 1.2s;}",
    ".bgart.on{opacity:.55;}",
    ".bgshade{position:absolute;left:0;top:0;right:0;bottom:0;background:linear-gradient(180deg,rgba(var(--es-shade-rgb,6,10,22),.35),rgba(var(--es-shade-rgb,6,10,22),.7));}",
    ".content{position:relative;z-index:1;height:100vh;box-sizing:border-box;padding:2vh 2.5vh 2vh 2.5vh;display:flex;flex-direction:column;}",
    ".main{position:relative;flex:1 1 auto;min-height:0;}",
    "ha-icon{display:inline-flex;}",
    /* ---- now playing ---- */
    ".np{position:absolute;left:0;top:0;right:0;bottom:0;display:flex;align-items:center;padding:0 1vh;box-sizing:border-box;}",
    ".art{flex:0 0 auto;width:74vh;height:74vh;margin-right:5vh;border-radius:2.6vh;overflow:hidden;background:rgba(255,255,255,.06);box-shadow:0 2.4vh 6vh rgba(0,0,0,.55);position:relative;}",
    ".art img{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;}",
    ".info{flex:1 1 auto;min-width:0;height:100%;display:flex;flex-direction:column;justify-content:space-between;padding:1vh 0 1.4vh;box-sizing:border-box;}",
    ".np.noart .art{display:none;}",
    ".np.noart .info{max-width:130vh;margin:0 auto;align-items:stretch;}",
    ".np.noart .meta{text-align:center;align-items:center;flex:1 1 auto;justify-content:center;padding:2vh 0;}",
    ".np.noart .ttl{font-size:8vh;-webkit-line-clamp:2;}",
    ".np.noart .by{font-size:4.4vh;}",
    ".np.noart .alb{font-size:3.2vh;}",
    ".np.noart .tp{justify-content:center;}",
    ".np.noart .prog.hide{display:none;}",
    ".np.noart .vol{margin-top:3.5vh;}",
    ".np.noart .tp .tb{margin:0 2vh;}",
    ".np.noart .hdr .grow{flex:1 1 auto;}",
    /* header */
    ".hdr{display:flex;align-items:center;flex:0 0 auto;}",
    ".grow{flex:1 1 auto;}",
    ".chip{height:7.4vh;border-radius:3.7vh;padding:0 2.2vh 0 1.8vh;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.1);display:flex;align-items:center;font-size:3.1vh;cursor:pointer;max-width:70%;box-sizing:border-box;}",
    ".chip ha-icon{--mdc-icon-size:3.8vh;width:3.8vh;height:3.8vh;margin-right:1.2vh;opacity:.85;}",
    ".chip .rn{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
    ".chip .rc{margin-left:1.2vh;font-size:2.4vh;padding:.4vh 1.2vh;border-radius:2vh;background:rgba(var(--es-acc-rgb,255,159,10),.25);color:var(--es-hi2,#ffc266);white-space:nowrap;}",
    ".chip .rc:empty{display:none;}",
    ".chip .chev{margin:0 0 0 .8vh;opacity:.6;}",
    ".ib{flex:0 0 auto;width:7.4vh;height:7.4vh;border-radius:50%;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.1);display:flex;align-items:center;justify-content:center;cursor:pointer;box-sizing:border-box;margin-left:1.4vh;}",
    ".ib ha-icon{--mdc-icon-size:4vh;width:4vh;height:4vh;}",
    ".ib.plain{background:none;border-color:transparent;}",
    /* meta */
    ".meta{display:flex;flex-direction:column;align-items:center;text-align:center;min-width:0;}",
    ".src{font-size:2.3vh;letter-spacing:.14em;text-transform:uppercase;opacity:.55;margin-bottom:1.2vh;display:flex;align-items:center;justify-content:center;}",
    ".src ha-icon{--mdc-icon-size:2.6vh;width:2.6vh;height:2.6vh;margin-right:.8vh;}",
    ".src:empty{display:none;}",
    ".ttl{font-size:5.6vh;font-weight:500;line-height:1.14;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word;}",
    ".by{font-size:3.7vh;opacity:.88;margin-top:1.2vh;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;}",
    ".alb{font-size:2.8vh;opacity:.55;margin-top:.8vh;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;}",
    ".by:empty,.alb:empty{display:none;}",
    /* progress */
    ".prog{flex:0 0 auto;}",
    ".prog.hide{visibility:hidden;}",
    ".bar{position:relative;padding:1.6vh 0;cursor:pointer;touch-action:none;}",
    ".bar .trk{height:1vh;border-radius:.5vh;background:rgba(255,255,255,.16);overflow:hidden;}",
    ".bar .pf{height:100%;width:100%;background:rgba(255,255,255,.9);transform-origin:left;transform:scaleX(0);}",
    ".times{display:flex;justify-content:space-between;font-size:2.3vh;opacity:.6;font-variant-numeric:tabular-nums;margin-top:-.4vh;}",
    /* transport */
    ".tp{display:flex;align-items:center;justify-content:space-between;flex:0 0 auto;}",
    ".tb{width:11vh;height:11vh;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;}",
    ".tb ha-icon{--mdc-icon-size:7vh;width:7vh;height:7vh;}",
    ".tb.big{width:15vh;height:15vh;background:#fff;color:#0d1322;box-shadow:0 1vh 3vh rgba(0,0,0,.35);}",
    ".tb.big ha-icon{--mdc-icon-size:8.5vh;width:8.5vh;height:8.5vh;}",
    ".tb.sm ha-icon{--mdc-icon-size:4.6vh;width:4.6vh;height:4.6vh;}",
    ".tb.sm{opacity:.5;}",
    ".tb.sm.on{opacity:1;color:var(--es-hi,#ffb340);}",
    ".tb.dis{opacity:.2 !important;pointer-events:none;}",
    ".tb:active,.ib:active,.chip:active,.btn:active,.go:active,.tab:active,.fc:active,.gbtn:active,.wide:active,.tile:active,.so:active{transform:scale(.95);}",
    /* volume */
    ".vol{display:flex;align-items:center;flex:0 0 auto;}",
    ".vol .ib{margin-left:0;}",
    ".vol .ib.last{margin-left:1.8vh;}",
    ".vtrack{position:relative;flex:1 1 auto;height:7.4vh;border-radius:3.7vh;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.08);overflow:hidden;touch-action:none;cursor:ew-resize;margin-left:1.8vh;box-sizing:border-box;}",
    ".vfill{position:absolute;left:0;top:0;bottom:0;width:100%;background:linear-gradient(90deg,rgba(255,255,255,.5),rgba(255,255,255,.82));transform-origin:left;transform:scaleX(0);}",
    ".vtrack.muted .vfill{background:rgba(255,255,255,.22);}",
    ".vv{position:absolute;right:2.2vh;top:0;bottom:0;display:flex;align-items:center;font-size:2.6vh;font-variant-numeric:tabular-nums;color:rgba(255,255,255,.85);text-shadow:0 0 .6vh rgba(0,0,0,.5);pointer-events:none;}",
    ".vlab{position:absolute;left:2.2vh;top:0;bottom:0;display:flex;align-items:center;font-size:2.4vh;letter-spacing:.1em;text-transform:uppercase;color:rgba(10,16,34,.75);pointer-events:none;}",
    ".vlab:empty{display:none;}",
    /* ---- nothing playing ---- */
    ".idle{position:absolute;left:0;top:0;right:0;bottom:0;display:none;flex-direction:column;padding:1vh 1vh 0;box-sizing:border-box;}",
    ".main.isidle .np{display:none;}",
    ".main.isidle .idle{display:flex;}",
    ".ic{flex:1 1 auto;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;}",
    ".ic .big{--mdc-icon-size:13vh;width:13vh;height:13vh;opacity:.3;}",
    ".ic h2{margin:1.6vh 0 0;font-size:5vh;font-weight:400;}",
    ".ic .sub{font-size:2.8vh;opacity:.55;margin-top:1vh;}",
    ".go{margin-top:3.4vh;height:9vh;border-radius:4.5vh;padding:0 4.4vh;background:linear-gradient(180deg,var(--es-acc1,#ffab2e),var(--es-acc2,#ff8a00));color:var(--es-on-acc,#1a1000);display:flex;align-items:center;justify-content:center;font-size:3.4vh;font-weight:500;cursor:pointer;}",
    ".go ha-icon{--mdc-icon-size:4.4vh;width:4.4vh;height:4.4vh;margin-right:1.4vh;}",
    ".qf{width:100%;flex:0 0 auto;padding-bottom:1vh;}",
    ".qf .sh{margin:0 0 1.6vh;}",
    ".qfg{display:grid;grid-template-columns:repeat(8,1fr);grid-gap:2vh;}",
    ".qf:empty{display:none;}",
    /* ---- overlays ---- */
    ".ov{position:absolute;left:0;top:0;right:0;bottom:0;z-index:5;border-radius:3vh;background:#0c1224;border:1px solid rgba(255,255,255,.08);box-shadow:0 2vh 6vh rgba(0,0,0,.5);display:flex;flex-direction:column;padding:2.4vh 2.8vh;box-sizing:border-box;}",
    ".hidden{display:none !important;}",
    ".ovh{display:flex;align-items:center;flex:0 0 auto;}",
    ".ovh h2{margin:0;font-size:4.2vh;font-weight:400;}",
    ".tab{height:7vh;padding:0 3vh;margin-right:1.4vh;border-radius:3.5vh;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.08);display:flex;align-items:center;font-size:3vh;cursor:pointer;white-space:nowrap;box-sizing:border-box;}",
    ".tab ha-icon{--mdc-icon-size:3.6vh;width:3.6vh;height:3.6vh;margin-right:1.1vh;}",
    ".tab.sel{background:rgba(var(--es-acc-rgb,255,159,10),.2);border-color:rgba(var(--es-acc-rgb,255,159,10),.6);color:var(--es-hi2,#ffc266);}",
    ".tgt{height:7vh;padding:0 2vh 0 2.2vh;border-radius:3.5vh;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.12);font-size:2.6vh;white-space:nowrap;overflow:hidden;margin-left:1vh;display:flex;align-items:center;cursor:pointer;box-sizing:border-box;flex:0 1 auto;min-width:0;}",
    ".tgt b{font-weight:500;margin-left:.8vh;overflow:hidden;text-overflow:ellipsis;}",
    ".tgt ha-icon{--mdc-icon-size:3vh;width:3vh;height:3vh;margin-right:.8vh;flex:0 0 auto;}",
    ".tgt .chev{margin:0 0 0 .6vh;opacity:.6;}",
    ".tgt:active{transform:scale(.95);}",
    ".spn h3{margin:0 0 1.6vh;font-size:3.4vh;font-weight:400;}",
    ".so .sx{flex:1 1 auto;min-width:0;}",
    ".so .sx div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
    ".so .sx .ss{font-size:2.1vh;opacity:.55;margin-top:.2vh;}",
    ".so.cur{background:rgba(var(--es-acc-rgb,255,159,10),.18);color:var(--es-hi2,#ffc266);}",
    ".so.na{opacity:.35;pointer-events:none;}",
    ".ovf{display:flex;align-items:center;margin-top:2vh;flex:0 0 auto;}",
    ".ovf:empty{display:none;}",
    ".srch{flex:0 1 56vh;min-width:20vh;height:6.6vh;border-radius:3.3vh;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);display:flex;align-items:center;padding:0 2.2vh;box-sizing:border-box;margin-right:1.6vh;}",
    ".srch ha-icon{--mdc-icon-size:3.4vh;width:3.4vh;height:3.4vh;opacity:.6;margin-right:1.2vh;}",
    ".srch input{flex:1 1 auto;min-width:0;background:none;border:none;outline:none;color:#fff;font-size:2.8vh;font-family:inherit;}",
    ".srch input::placeholder{color:rgba(255,255,255,.45);}",
    ".srch .clr{opacity:.6;cursor:pointer;margin:0 0 0 1vh;}",
    ".fc{height:6vh;padding:0 2.3vh;margin-right:1.1vh;border-radius:3vh;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);display:flex;align-items:center;font-size:2.6vh;cursor:pointer;white-space:nowrap;box-sizing:border-box;}",
    ".fc.sel{background:rgba(255,255,255,.2);border-color:rgba(255,255,255,.3);}",
    ".fc.sort{margin-left:auto;margin-right:0;}",
    ".fc.sort ha-icon{--mdc-icon-size:3vh;width:3vh;height:3vh;margin-right:.8vh;}",
    ".ah{flex:1 1 auto;min-width:0;display:flex;align-items:center;}",
    ".ah .ib{margin:0 1.8vh 0 0;}",
    ".ah .av{flex:0 0 auto;width:7vh;height:7vh;border-radius:50%;background:rgba(255,255,255,.08) center/cover no-repeat;margin-right:1.8vh;}",
    ".ah .an{font-size:3.6vh;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
    ".ah .as{font-size:2.2vh;opacity:.55;margin-top:.3vh;}",
    ".go.mix{margin:0 0 0 1.6vh;height:6.8vh;font-size:2.8vh;padding:0 3.2vh;flex:0 0 auto;}",
    ".go.mix.alt{background:rgba(255,255,255,.12);color:#fff;border:1px solid rgba(255,255,255,.12);box-sizing:border-box;}",
    ".ah .av.sq{border-radius:1.2vh;}",
    ".trow{grid-column:1/-1;display:flex;align-items:center;height:8.4vh;padding:0 1.6vh;border-radius:1.6vh;cursor:pointer;background:rgba(255,255,255,.035);}",
    ".trow + .trow{margin-top:-1.4vh;}",
    ".trow:active{background:rgba(255,255,255,.1);}",
    ".trow .tn{flex:0 0 5vh;font-size:2.6vh;opacity:.5;font-variant-numeric:tabular-nums;}",
    ".trow .tx{flex:1 1 auto;min-width:0;}",
    ".trow .tt1{font-size:2.9vh;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
    ".trow .ts1{font-size:2.1vh;opacity:.55;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
    ".trow .ts1:empty{display:none;}",
    ".trow .more{position:static;flex:0 0 auto;background:none;}",
    ".trow.cur{background:rgba(var(--es-acc-rgb,255,159,10),.14);}",
    ".trow.cur .tn{color:var(--es-hi,#ffb340);opacity:1;}",
    ".trow.static{cursor:default;}",
    ".trow .qi{flex:0 0 auto;width:6vh;height:6vh;border-radius:.8vh;background:rgba(255,255,255,.08) center/cover no-repeat;margin-right:1.8vh;}",
    ".trow .du{flex:0 0 auto;font-size:2.3vh;opacity:.5;font-variant-numeric:tabular-nums;margin-left:1.6vh;}",
    ".qmeta{font-size:2.4vh;opacity:.6;margin-left:2.4vh;white-space:nowrap;}",
    ".qlive{font-size:2.2vh;margin-left:1.6vh;padding:.5vh 1.4vh;border-radius:2vh;background:rgba(48,209,88,.16);color:#6fe38f;white-space:nowrap;}",
    ".qlive.off{background:rgba(255,255,255,.08);color:rgba(255,255,255,.55);}",
    ".trow.past{opacity:.42;}",
    ".go.mix ha-icon{--mdc-icon-size:3.6vh;width:3.6vh;height:3.6vh;margin-right:1vh;}",
    ".grid{flex:1 1 auto;min-height:0;margin-top:2vh;overflow-y:auto;-webkit-overflow-scrolling:touch;display:grid;grid-template-columns:repeat(6,1fr);grid-gap:2.2vh 2vh;align-content:start;padding-right:.6vh;}",
    ".grid::-webkit-scrollbar{width:.6vh;}",
    ".grid::-webkit-scrollbar-thumb{background:rgba(255,255,255,.2);border-radius:.3vh;}",
    ".sh{grid-column:1/-1;font-size:2.4vh;letter-spacing:.14em;text-transform:uppercase;opacity:.55;margin-top:1vh;}",
    ".sh:first-child{margin-top:0;}",
    ".msg{grid-column:1/-1;text-align:center;padding:6vh 2vh;font-size:3vh;opacity:.6;}",
    ".tile{position:relative;cursor:pointer;min-width:0;}",
    ".ti{position:relative;padding-top:100%;border-radius:1.6vh;overflow:hidden;background:rgba(255,255,255,.07);}",
    ".ti ha-icon{position:absolute;left:50%;top:50%;margin:-3vh 0 0 -3vh;--mdc-icon-size:6vh;width:6vh;height:6vh;opacity:.3;}",
    ".ti img{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover;background:#1a2238;}",
    ".tile.round .ti{border-radius:50%;}",
    ".tt{font-size:2.35vh;line-height:1.25;margin-top:1vh;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word;}",
    ".tile.round .tt{text-align:center;}",
    ".ts{font-size:2vh;opacity:.55;margin-top:.3vh;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
    ".tile.round .ts{text-align:center;}",
    ".ts:empty{display:none;}",
    ".more{position:absolute;right:.8vh;top:.8vh;width:5.8vh;height:5.8vh;border-radius:50%;background:rgba(8,12,24,.7);display:flex;align-items:center;justify-content:center;}",
    ".more ha-icon{--mdc-icon-size:3.4vh;width:3.4vh;height:3.4vh;}",
    ".tile.round .more{right:0;top:0;}",
    /* action sheet */
    ".sheet{position:absolute;left:0;top:0;right:0;bottom:0;z-index:8;background:rgba(3,6,14,.6);display:flex;align-items:center;justify-content:center;border-radius:3vh;}",
    ".spn{width:64vh;background:linear-gradient(180deg,var(--es-pan1,#1c2540),var(--es-pan2,#141b30));border:1px solid rgba(255,255,255,.1);border-radius:3vh;padding:2.4vh;box-sizing:border-box;box-shadow:0 2vh 5vh rgba(0,0,0,.55);}",
    ".spn .st{display:flex;align-items:center;margin-bottom:1.6vh;}",
    ".spn .st img{width:10vh;height:10vh;border-radius:1.2vh;object-fit:cover;margin-right:2vh;flex:0 0 auto;}",
    ".spn .st .n{font-size:3.2vh;line-height:1.2;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}",
    ".spn .st .s{font-size:2.3vh;opacity:.55;margin-top:.4vh;}",
    ".so{height:8vh;border-radius:1.8vh;display:flex;align-items:center;padding:0 2vh;font-size:3.1vh;cursor:pointer;}",
    ".so + .so{margin-top:.8vh;}",
    ".so{background:rgba(255,255,255,.06);}",
    ".so ha-icon{--mdc-icon-size:4vh;width:4vh;height:4vh;margin-right:2vh;opacity:.85;}",
    /* speakers */
    ".slist{flex:1 1 auto;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;margin-top:2vh;}",
    ".srow{display:flex;align-items:center;padding:1.4vh 1.8vh;border-radius:2.2vh;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.06);box-sizing:border-box;}",
    ".srow + .srow{margin-top:1.4vh;}",
    ".srow.in{background:rgba(var(--es-acc-rgb,255,159,10),.09);border-color:rgba(var(--es-acc-rgb,255,159,10),.35);}",
    ".srow.na{opacity:.4;pointer-events:none;}",
    ".sname{flex:0 0 36vh;min-width:0;cursor:pointer;padding-right:1vh;}",
    ".sname .n{font-size:3.2vh;display:flex;align-items:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
    ".sname .n ha-icon{--mdc-icon-size:3vh;width:3vh;height:3vh;margin-left:1vh;color:var(--es-hi,#ffb340);}",
    ".sname .s{font-size:2.2vh;opacity:.55;margin-top:.4vh;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
    ".srow .ib{width:6.6vh;height:6.6vh;margin-left:0;}",
    ".srow .vtrack{height:6.6vh;border-radius:3.3vh;}",
    ".gbtn{flex:0 0 auto;height:6.6vh;width:19vh;margin-left:1.8vh;border-radius:3.3vh;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.1);display:flex;align-items:center;justify-content:center;font-size:2.6vh;cursor:pointer;padding:0 2vh;box-sizing:border-box;white-space:nowrap;}",
    ".gbtn ha-icon{--mdc-icon-size:3.2vh;width:3.2vh;height:3.2vh;margin-right:.8vh;}",
    ".gbtn.on{background:linear-gradient(180deg,var(--es-acc1,#ffab2e),var(--es-acc2,#ff8a00));border-color:transparent;color:var(--es-on-acc,#1a1000);}",
    ".gbtn.busy{opacity:.45;pointer-events:none;}",
    ".solo .gbtn,.solo .wide[data-act=group-all],.solo .wide[data-act=ungroup-all]{display:none;}",
    ".gbtn.fixed{background:none;border-color:transparent;opacity:.55;pointer-events:none;}",
    ".sfoot{display:flex;align-items:center;margin-top:2vh;flex:0 0 auto;}",
    ".wide{height:8vh;border-radius:4vh;padding:0 3.6vh;display:flex;align-items:center;justify-content:center;font-size:3vh;cursor:pointer;white-space:nowrap;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.1);box-sizing:border-box;margin-right:1.6vh;}",
    ".wide ha-icon{--mdc-icon-size:3.8vh;width:3.8vh;height:3.8vh;margin-right:1.2vh;}",
    ".wide.done{margin:0 0 0 auto;background:linear-gradient(180deg,var(--es-acc1,#ffab2e),var(--es-acc2,#ff8a00));color:var(--es-on-acc,#1a1000);border-color:transparent;}",
    /* toast */
    ".toast{position:absolute;left:50%;bottom:15vh;z-index:30;transform:translateX(-50%);background:rgba(28,37,64,.97);border:1px solid rgba(255,255,255,.12);padding:1.8vh 3.4vh;border-radius:3.4vh;font-size:2.8vh;white-space:nowrap;max-width:80vw;overflow:hidden;text-overflow:ellipsis;opacity:0;transition:opacity .25s;pointer-events:none;box-shadow:0 1vh 3vh rgba(0,0,0,.4);}",
    ".toast.show{opacity:1;}",
    /* bottom buttons (same look as the weather/timer cards) */
    ".btns{display:flex;gap:1.5vh;margin-top:2vh;height:9vh;flex:0 0 auto;}",
    ".btn{flex:1 1 0;border-radius:1.6vh;background:rgba(255,255,255,.1);display:flex;align-items:center;justify-content:center;cursor:pointer;}",
    ".btn.active{background:rgba(255,255,255,.24);}",
    ".btn ha-icon{--mdc-icon-size:5vh;width:5vh;height:5vh;display:inline-flex;color:rgba(255,255,255,.9);}",
    ".btn .bdg{margin-left:1.2vh;font-size:3.8vh;line-height:1;font-variant-numeric:tabular-nums;color:var(--es-hi,#ffb340);white-space:nowrap;}",
    ".btn .bdg:empty{display:none;}",
    ".btn .bdg.done{color:#ff6b61;animation:emc-blink 1s steps(1) infinite;}",
    "@keyframes emc-blink{50%{opacity:.25;}}",
  ].join("");

  // Music Assistant media types shown as filter chips in the Library tab.
  var LIB_TYPES = [
    { t: "playlist", label: "Playlists" },
    { t: "artist", label: "Artists" },
    { t: "album", label: "Albums" },
    { t: "track", label: "Tracks" },
    { t: "podcast", label: "Podcasts" },
  ];
  // Spotify tab: what has been saved from Spotify into the Music Assistant library.
  var SPOT_TYPES = [
    { t: "playlist", label: "Playlists" },
    { t: "album", label: "Albums" },
    { t: "artist", label: "Artists" },
    { t: "liked", label: "Liked songs" },
    { t: "recent", label: "Recently played" },
  ];
  var SPOT_IMG = /scdn\.co|spotifycdn/;
  // SomaFM stations ("SomaFM: Groove Salad") get their own menu behind one tile in the Radio tab.
  var SOMA = /^soma\s*fm\b\s*:?\s*/i;
  var SOMA_URI = /^somafm/i;
  var TYPE_ICON = { playlist: "mdi:playlist-music", artist: "mdi:account-music", album: "mdi:album", track: "mdi:music-note", radio: "mdi:radio", somafm: "mdi:radio", podcast: "mdi:podcast", audiobook: "mdi:book-music", favorite: "mdi:star" };
  var SEARCH_SECTIONS = [["tracks", "Songs"], ["albums", "Albums"], ["artists", "Artists"], ["playlists", "Playlists"], ["radio", "Radio"], ["podcasts", "Podcasts"], ["audiobooks", "Audiobooks"]];

  // ---------- direct Music Assistant connection (live queue) ----------
  // Home Assistant only relays Music Assistant's current / next song, so for the queue the
  // card talks to the Music Assistant server itself (its WebSocket API, with a long-lived
  // token). One connection per page, shared by every card and kept open between views.

  var MA_CONNS = {};

  function maConn(urls, token) {
    var key = urls.join(",") + "|" + token;
    if (!MA_CONNS[key]) MA_CONNS[key] = new MaClient(urls, token);
    return MA_CONNS[key];
  }

  function MaClient(urls, token) {
    this.urls = urls;
    this.token = token;
    this.state = "idle";      // idle | connecting | ready | down
    this.error = "";
    this.base = null;         // http(s) base of the server we're connected to (for images)
    this.ws = null;
    this.seq = 0;
    this.pending = {};
    this.queues = {};         // queue_id -> PlayerQueue
    this.items = {};          // queue_id -> Promise<QueueItem[]>
    this.listeners = [];
    this.urlIdx = 0;
    this.retry = 0;
    this.authFailed = false;
  }

  MaClient.prototype.start = function () {
    if (this.state === "idle") this._connect();
  };

  MaClient.prototype.on = function (fn) {
    var l = this.listeners;
    l.push(fn);
    return function () { var i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); };
  };

  MaClient.prototype._emit = function (qid) {
    var l = this.listeners.slice();
    for (var i = 0; i < l.length; i++) { try { l[i](qid); } catch (e) { /* listener error */ } }
  };

  MaClient.prototype._connect = function () {
    var self = this;
    var base = String(this.urls[this.urlIdx % this.urls.length] || "").replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(base)) base = "http://" + base;
    var wsUrl = base.replace(/^http/i, "ws") + "/ws";
    this.state = "connecting";
    this.authFailed = false;
    var ws, authed = false, gotInfo = false;
    try { ws = new WebSocket(wsUrl); } catch (e) {
      this.error = "Can't open " + wsUrl;
      this._closed(false);
      return;
    }
    this.ws = ws;
    var guard = setTimeout(function () { if (!authed) { try { ws.close(); } catch (e) { /* ignore */ } } }, 10000);
    ws.onmessage = function (ev) {
      var m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (!gotInfo && m.server_id) {
        gotInfo = true;
        self._send("auth", { token: self.token }).then(function () {
          authed = true;
          clearTimeout(guard);
          self.base = base;
          self.state = "ready";
          self.error = "";
          self.retry = 0;
          return self._loadAll();
        }, function (err) {
          self.authFailed = true;
          self.error = "Music Assistant didn't accept the token (" + (err && err.message ? err.message : "error") + ")";
          try { ws.close(); } catch (e) { /* ignore */ }
        });
        return;
      }
      if (m.event) { self._event(m); return; }
      var p = m.message_id !== undefined ? self.pending[m.message_id] : null;
      if (!p) return;
      if (m.error_code !== undefined) {
        delete self.pending[m.message_id];
        p.rej(new Error(m.details || ("error " + m.error_code)));
      } else if (m.partial) {
        p.acc = (p.acc || []).concat(m.result || []);
      } else {
        delete self.pending[m.message_id];
        p.res(p.acc ? p.acc.concat(m.result || []) : m.result);
      }
    };
    ws.onerror = function () { /* onclose follows */ };
    ws.onclose = function () {
      clearTimeout(guard);
      if (!authed && !self.authFailed && !self.error) self.error = "Can't reach Music Assistant at " + base;
      self._closed(authed);
    };
  };

  MaClient.prototype._closed = function (wasReady) {
    var self = this;
    this.ws = null;
    this.state = "down";
    for (var id in this.pending) { try { this.pending[id].rej(new Error("disconnected")); } catch (e) { /* ignore */ } }
    this.pending = {};
    this.items = {};
    this._emit(null);
    var delay;
    if (this.authFailed) delay = 300000;                       // bad token: don't hammer the server
    else if (wasReady) { delay = 2000; } // dropped: reconnect to the same server
    else {
      this.urlIdx++;
      // Try the other addresses straight away, then back off.
      delay = this.urlIdx % this.urls.length !== 0 ? 300 : Math.min(60000, 3000 * Math.pow(2, this.retry++));
    }
    setTimeout(function () { self._connect(); }, delay);
  };

  MaClient.prototype._send = function (command, args) {
    var self = this, ws = this.ws;
    if (!ws || ws.readyState !== 1) return Promise.reject(new Error("Not connected to Music Assistant"));
    var id = "emc" + (++this.seq);
    return new Promise(function (res, rej) {
      self.pending[id] = { res: res, rej: rej };
      ws.send(JSON.stringify({ message_id: id, command: command, args: args || {} }));
      setTimeout(function () {
        if (self.pending[id]) { delete self.pending[id]; rej(new Error("Music Assistant didn't answer")); }
      }, 15000);
    });
  };

  MaClient.prototype.call = function (command, args) {
    if (this.state !== "ready") return Promise.reject(new Error(this.error || "Not connected to Music Assistant"));
    return this._send(command, args);
  };

  MaClient.prototype._loadAll = function () {
    var self = this;
    return this._send("player_queues/all", {}).then(function (list) {
      self.queues = {};
      (list || []).forEach(function (q) { if (q && q.queue_id) self.queues[q.queue_id] = q; });
      self.items = {};
      self._emit(null);
    }, function () { self._emit(null); });
  };

  MaClient.prototype._event = function (m) {
    var d = m.data, qid = m.object_id || (d && d.queue_id);
    if (m.event === "queue_updated" || m.event === "queue_added") {
      if (d && d.queue_id) this.queues[d.queue_id] = d;
      this._emit(qid);
    } else if (m.event === "queue_items_updated") {
      if (d && d.queue_id) this.queues[d.queue_id] = d;
      delete this.items[qid];
      this._emit(qid);
    }
  };

  MaClient.prototype.getItems = function (qid) {
    var self = this;
    if (!this.items[qid]) {
      this.items[qid] = this.call("player_queues/items", { queue_id: qid, limit: 1000, offset: 0 })
        .then(function (r) { return r || []; }, function (e) { delete self.items[qid]; throw e; });
    }
    return this.items[qid];
  };

  MaClient.prototype.imageUrl = function (img, size) {
    if (!img) return "";
    if (img.proxy_id && this.base) return this.base + "/imageproxy/" + encodeURIComponent(img.proxy_id) + "?size=" + (size || 128);
    if (img.remotely_accessible && /^https?:\/\//.test(String(img.path || ""))) return img.path;
    return "";
  };

  // ---------- the card ----------

  function EchoMediaCard() {
    var self = Reflect.construct(HTMLElement, [], EchoMediaCard);
    self._hass = null;
    self._config = null;
    self._sel = -1;          // index of the room being shown
    self._manual = false;    // true once the user picked a room (until the view is left)
    self._volLocal = {};     // entity -> { v, until } while dragging / waiting for HA
    self._pendGroup = {};    // room index -> timestamp of a join/unjoin in flight
    self._localSlug = null;  // this display's Kiosk Satellite name; its own player becomes a room of its own
    self._br = { tab: "radio", ltype: "playlist", stype: "playlist", sort: "name", q: "", items: [], offset: 0, more: false, loading: false, req: 0, stack: [] };
    self._stCache = null;
    // Keep touch gestures inside this card so the kiosk's swipe-between-views doesn't fire.
    ["touchstart", "touchmove", "touchend", "touchcancel"].forEach(function (type) {
      self.addEventListener(type, function (ev) { if (!self._config || self._config.block_swipe) ev.stopPropagation(); });
    });
    return self;
  }
  EchoMediaCard.prototype = Object.create(HTMLElement.prototype);
  EchoMediaCard.prototype.constructor = EchoMediaCard;
  Object.setPrototypeOf(EchoMediaCard, HTMLElement);

  EchoMediaCard.prototype.setConfig = function (config) {
    if (!config || !config.players || !config.players.length) {
      throw new Error("echo-media-card: add your speakers under 'players'");
    }
    this._raw = config;
    this._applyProfile(null);
    if (!this._devL) {   // this display's device (own timers, area) becomes known after the first render
      this._devL = true;
      var me = this;
      window.addEventListener("echo-show-device", function () { if (me._hass) { me._badgeSig = ""; me._sig = ""; me.hass = me._hass; } });
    }
    var self = this;
    echoDisplayName().then(function (name) {
      var prof = matchDisplay(config.devices, name);
      if (!prof) return;
      self._applyProfile(prof);
      self._badgeSig = "";
      if (!self._manual) self._sel = -1;
      if (self._built && self._hass) self._update(true);
    });
  };

  // Card config plus the matching per-display overrides.
  EchoMediaCard.prototype._applyProfile = function (prof) {
    this._prof = prof;
    var c = {}, k;
    for (k in this._raw) c[k] = this._raw[k];
    if (prof) for (k in prof) if (k !== "match") c[k] = prof[k];
    var rooms = [];
    for (var i = 0; i < c.players.length; i++) {
      var p = c.players[i];
      if (typeof p === "string") p = { entity: p };
      var slug = String(p.name || String(p.entity).split(".")[1] || "").toLowerCase().replace(/_sonos$/, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
      rooms.push({ i: i, entity: p.entity, ma: p.ma_entity || null, name: p.name || null, icon: p.icon || "mdi:speaker",
        src: p.queue_helper || ("input_text.echo_media_src_" + slug), maId: p.ma_player_id || null });
    }
    // This display's own player (its Music Assistant entity): a target of its own that is never grouped
    // with the speakers, and the only Echo Show offered (not the other displays).
    var lp = c.local_player !== false && this._localSlug ? "media_player." + this._localSlug : null;
    if (lp && this._hass && this._hass.states[lp]) {
      var have = false;
      for (var j = 0; j < rooms.length; j++) if (rooms[j].entity === lp || rooms[j].ma === lp) have = true;
      if (!have) rooms.push({ i: rooms.length, entity: lp, ma: lp, name: c.local_name || null, icon: "mdi:tablet-dashboard",
        src: "input_text.echo_media_src_" + this._localSlug, maId: null, local: true });
    }
    this._rooms = rooms;
    this._timerPrefix = c.timer_prefix || null;
    this._config = {
      ma_config_entry: c.ma_config_entry || null,
      default_player: c.default_player || null,
      follow_playing: c.follow_playing !== false,
      idle_timeout: c.idle_timeout !== undefined ? c.idle_timeout : 180,
      idle_path: c.idle_path || null,
      stay_while: c.stay_while || "shown",          // "shown" | "any": what counts as playing for the idle return
      buttons: c.buttons || [],
      settings: c.settings || {},
      block_swipe: c.block_swipe !== false,
      tap_sound: !!c.tap_sound,
      page_size: c.page_size || 60,
      quick_favorites: c.quick_favorites !== undefined ? c.quick_favorites : 8,
      spotify_prefix: c.spotify_prefix || "spotify",
      somafm: c.somafm !== false,
      somafm_logo: c.somafm_logo || "/local/resources/radio-logos/SomaFM-logo.png",
      local_volume: c.local_volume === "media" ? "media" : "device",
      ma_urls: c.ma_url ? [].concat(c.ma_url) : [],
      ma_token: c.ma_token || null,
    };
    // A default room set for this display (devices entry or settings panel) beats the area guess.
    this._defFixed = !!(prof && prof.default_player !== undefined);
    // This display's choices from the settings panel.
    var P = window.EchoShow ? window.EchoShow.prefs : null;
    if (P) {
      var room = P.get("media_room"), fol = P.get("media_follow");
      if (room !== null && room !== undefined) { this._config.default_player = room || null; this._defFixed = true; }
      if (fol !== null && fol !== undefined) this._config.follow_playing = !!fol;
    }
  };

  EchoMediaCard.prototype.getCardSize = function () { return 12; };

  // Which Kiosk Satellite display this is, to offer its own player as a room.
  EchoMediaCard.prototype._findLocal = function (hass) {
    var ES = window.EchoShow, self = this;
    if (this._localAsked || !ES || !ES.deviceSlug) return;
    this._localAsked = true;
    ES.deviceSlug(hass).then(function (slug) {
      if (!slug || slug === self._localSlug) return;
      self._localSlug = slug;
      self._applyProfile(self._prof || null);
      if (self._built && self._hass) self._update(true);
    });
  };

  Object.defineProperty(EchoMediaCard.prototype, "hass", {
    set: function (hass) {
      this._hass = hass;
      if (!this._config) return;
      this._findLocal(hass);
      if (!this._built) { this._build(); this._startIdle(); }
      this._update(false);
      this._maHook();
      if (this._settingsEl) this._settingsEl.hass = hass;
    },
    get: function () { return this._hass; },
  });

  EchoMediaCard.prototype.connectedCallback = function () {
    var self = this;
    if (!this._onPrefs) this._onPrefs = function (ev) {
      var k = ev.detail && ev.detail.key;
      if (k !== "media_room" && k !== "media_follow") return;
      self._applyProfile(self._prof || null);
      if (!self._manual) self._sel = -1;
      if (self._built && self._hass) self._update(true);
    };
    window.addEventListener("echo-show-prefs", this._onPrefs);
    if (this._built) { this._startIdle(); this._update(true); }
  };

  EchoMediaCard.prototype.disconnectedCallback = function () {
    if (this._onPrefs) window.removeEventListener("echo-show-prefs", this._onPrefs);
    this._runSeen = null; this._doneSeen = null;
    this._stopIdle();
    this._stopTick();
    if (this._badgeTick) { clearInterval(this._badgeTick); this._badgeTick = null; }
    this._closeOverlays();
    if (this._maOff) { this._maOff(); this._maOff = null; }
    if (this._settingsEl) this._settingsEl.close();
    // Next time the page opens, pick the room again (follow whatever is playing).
    this._manual = false;
    this._sel = -1;
  };

  // ---------- state helpers ----------

  EchoMediaCard.prototype._st = function (id) { return id && this._hass ? this._hass.states[id] : null; };

  EchoMediaCard.prototype._roomName = function (r) {
    if (r.name) return r.name;
    var s = this._st(r.entity) || this._st(r.ma);
    return s ? s.attributes.friendly_name || r.entity : r.entity;
  };

  EchoMediaCard.prototype._roomOf = function (entityId) {
    for (var i = 0; i < this._rooms.length; i++) {
      if (this._rooms[i].entity === entityId || this._rooms[i].ma === entityId) return this._rooms[i];
    }
    return null;
  };

  EchoMediaCard.prototype._available = function (r) {
    var s = this._st(r.entity);
    return !!s && s.state !== "unavailable" && s.state !== "unknown";
  };

  // Group leader (Sonos coordinator) of a room.
  EchoMediaCard.prototype._coordOf = function (r) {
    if (r.local) return r;
    var s = this._st(r.entity);
    var gm = s && s.attributes.group_members;
    if (gm && gm.length && gm[0] !== r.entity) return this._roomOf(gm[0]) || r;
    return r;
  };

  // Rooms in the same group as the leader (leader first).
  EchoMediaCard.prototype._membersOf = function (coord) {
    if (coord.local) return [coord];
    var s = this._st(coord.entity);
    var gm = (s && s.attributes.group_members) || [];
    var out = [coord];
    for (var i = 0; i < gm.length; i++) {
      var r = this._roomOf(gm[i]);
      if (r && !r.local && out.indexOf(r) === -1) out.push(r);
    }
    return out;
  };

  // The entity that is really driving playback in a room: Music Assistant when it is
  // playing through it, otherwise the Sonos entity (radio, Sonos app, AirPlay, ...).
  EchoMediaCard.prototype._activeOf = function (r) {
    var m = this._st(r.ma), n = this._st(r.entity);
    if (m && PLAYING[m.state]) return m;
    if (n && ACTIVE[n.state] && m && this._maOwns(n, m)) {
      // Music Assistant's stream is on the Sonos, but MA reports its player idle and stops
      // updating it (its title/position go stale). Show the Sonos' live track info and play
      // state, but send the controls to MA, which owns the queue (shuffle, repeat, next ...).
      var na = n.attributes, ma = m.attributes, attrs = {}, k;
      for (k in na) attrs[k] = na[k];
      var same = !!ma.media_title && ma.media_title === na.media_title;
      attrs.shuffle = ma.shuffle;
      attrs.repeat = ma.repeat;
      attrs.supported_features = ma.supported_features || na.supported_features;
      attrs.app_id = "music_assistant";
      attrs.media_content_id = same ? ma.media_content_id : "";
      // Artwork: the Sonos' own first; MA's only if it is about the same song.
      attrs._art = [na.entity_picture, na.entity_picture_local].concat(same ? [ma.entity_picture, ma.entity_picture_local] : []);
      return { entity_id: m.entity_id, state: n.state, attributes: attrs, merged: true };
    }
    if (n && PLAYING[n.state]) return n;
    if (m && m.state === "paused" && m.attributes.media_title) return m;
    if (n && ACTIVE[n.state]) return n;
    return null;
  };

  // Is the Sonos playing a Music Assistant stream?
  EchoMediaCard.prototype._maOwns = function (n, m) {
    var id = String(n.attributes.media_content_id || "");
    if (/:8097\//.test(id) || /\/(single|flow)\/[^/]+\/RINCON_/.test(id)) return true;
    var t = m.attributes.media_title;
    return !!t && t === n.attributes.media_title;
  };

  EchoMediaCard.prototype._isPlaying = function (r) {
    var a = this._activeOf(r);
    return !!a && !!PLAYING[a.state];
  };

  EchoMediaCard.prototype._room = function () {
    if (this._sel < 0 || this._sel >= this._rooms.length) this._autoSelect();
    return this._rooms[this._sel] || this._rooms[0];
  };
  EchoMediaCard.prototype._coord = function () { return this._coordOf(this._room()); };
  EchoMediaCard.prototype._members = function () { return this._membersOf(this._coord()); };

  // Pick the room to show: this display's room, unless it is quiet and another room is
  // playing (then show that one). Stays put once the user has chosen a room.
  EchoMediaCard.prototype._autoSelect = function () {
    var def = 0, dp = this._config.default_player;
    if (!this._defFixed) { var ar = this._areaRoom(); if (ar) dp = ar.entity; }
    if (dp) {
      var d = this._roomOf(dp);
      if (d) def = d.i;
    }
    var pick = def;
    if (this._config.follow_playing && this._hass && !this._isPlaying(this._coordOf(this._rooms[def]))) {
      for (var i = 0; i < this._rooms.length; i++) {
        if (this._isPlaying(this._coordOf(this._rooms[i]))) { pick = this._coordOf(this._rooms[i]).i; break; }
      }
    }
    this._sel = pick;
  };

  // The speaker in this display's Home Assistant area, if exactly one of the rooms is there.
  EchoMediaCard.prototype._areaRoom = function () {
    var ES = window.EchoShow, h = this._hass;
    if (!ES || !ES.ownArea || !h) return null;
    var area = ES.ownArea(h), hit = [];
    if (!area) return null;
    for (var i = 0; i < this._rooms.length; i++) if (!this._rooms[i].local && ES.areaOf(h, this._rooms[i].entity) === area) hit.push(this._rooms[i]);
    return hit.length === 1 ? hit[0] : null;
  };

  // This display's own player follows the tablet's Device volume (what its volume buttons change),
  // not Kiosk Satellite's separate Media volume. Returns the number entity, else null.
  EchoMediaCard.prototype._devVolEnt = function (entityId) {
    var ES = window.EchoShow, r = this._roomOf(entityId);
    if (!r || !r.local || this._config.local_volume !== "device" || !ES || !ES.devEnt || !this._localSlug) return null;
    return ES.devEnt(this._hass, this._localSlug, "number", "volume");
  };

  EchoMediaCard.prototype._volOf = function (entityId) {
    var l = this._volLocal[entityId];
    if (l && (l.drag || l.until > Date.now())) return l.v;
    var dv = this._devVolEnt(entityId), ds = dv ? this._st(dv) : null;
    if (ds && !isNaN(parseFloat(ds.state))) return clamp(parseFloat(ds.state) / 100, 0, 1);
    var s = this._st(entityId);
    var v = s ? s.attributes.volume_level : null;
    return typeof v === "number" ? v : 0;
  };

  EchoMediaCard.prototype._mutedOf = function (entityId) {
    var s = this._st(entityId);
    return !!(s && s.attributes.is_volume_muted);
  };

  function srcLabel(st) {
    if (!st) return null;
    var a = st.attributes, id = String(a.media_content_id || "");
    if (a.app_id === "music_assistant" || a.mass_player_type) {
      if (/^spotify/.test(id)) return ["mdi:spotify", "Spotify"];
      if (/^(tunein|radiobrowser|somafm)/.test(id) || a.media_content_type === "radio") return ["mdi:radio", "Radio"];
      if (/^library:\/\/radio/.test(id)) return ["mdi:radio", "Radio"];
      if (/^library/.test(id)) return ["mdi:bookshelf", "Library"];
      if (/^(filesystem|smb)/.test(id)) return ["mdi:folder-music", "Library"];
      return ["mdi:music-box-multiple", "Music Assistant"];
    }
    if (/spotify/.test(id)) return ["mdi:spotify", "Spotify"];
    if (/^x-file-cifs|^x-smb/.test(id)) return ["mdi:folder-music", "Music library"];
    if (/x-rincon-stream|line-in/i.test(id) || a.source === "Line-in") return ["mdi:audio-input-rca", "Line-in"];
    if (/x-sonos-htastream/.test(id)) return ["mdi:television", "TV"];
    if (/airconnect|airplay/i.test(String(a.media_title || "")) || /x-sonos-vli/.test(id)) return ["mdi:cast-audio-variant", "AirPlay"];
    if (a.media_channel || /^(aac|x-rincon-mp3radio|x-sonosapi-stream|x-sonosapi-radio|hls-radio)/.test(id)) return ["mdi:radio", "Radio"];
    return null;
  }

  // Artwork URLs to try, best first. A station logo from /local/ comes as http://<ip>:8123/..., which
  // an https dashboard blocks, so it goes through fixImg like the Browse tiles.
  function artUrls(st) {
    if (!st) return [];
    var a = st.attributes;
    var list = a._art || [a.entity_picture_local, a.entity_picture];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var u = fixImg(list[i]);
      if (u && out.indexOf(u) === -1) out.push(u);
    }
    return out;
  }

  // ---------- DOM ----------

  function volRow(key, extraBtn) {
    return '<div class="vol"><div class="ib" role="button" data-act="mute" data-k="' + key + '"><ha-icon icon="mdi:volume-high"></ha-icon></div>' +
      '<div class="vtrack" data-vol="' + key + '"><div class="vfill"></div><div class="vlab"></div><div class="vv"></div></div>' +
      (extraBtn || "") + "</div>";
  }

  function headerHtml(withQueue) {
    return '<div class="hdr"><div class="chip" role="button" data-act="speakers"><ha-icon icon="mdi:speaker"></ha-icon><span class="rn"></span><span class="rc"></span><ha-icon class="chev" icon="mdi:chevron-down"></ha-icon></div>' +
      '<div class="grow"></div>' +
      (withQueue ? '<div class="ib" role="button" data-act="queue"><ha-icon icon="mdi:playlist-music"></ha-icon></div>' : "") +
      '<div class="ib" role="button" data-act="browse"><ha-icon icon="mdi:music-box-multiple-outline"></ha-icon></div></div>';
  }

  EchoMediaCard.prototype._build = function () {
    var root = this.attachShadow({ mode: "open" });
    var buttons = this._config.buttons;
    var btnHtml = "";
    for (var i = 0; i < buttons.length; i++) {
      btnHtml += '<div class="btn' + (buttons[i].active ? " active" : "") + '" role="button" data-i="' + i + '"><ha-icon icon="' + esc(buttons[i].icon || "mdi:help") + '"></ha-icon>' +
        (buttons[i].timers ? '<span class="bdg" data-i="' + i + '"></span>' : "") + "</div>";
    }
    root.innerHTML = "<style>" + STYLE + "</style>" +
      '<div class="root"><div class="bg0"></div><div class="bgart"></div><div class="bgshade"></div>' +
      '<div class="content"><div class="main">' +
      // now playing
      '<div class="np noart"><div class="art"><img alt=""></div><div class="info">' + headerHtml(true) +
      '<div class="meta"><div class="src"></div><div class="ttl"></div><div class="by"></div><div class="alb"></div></div>' +
      '<div class="prog"><div class="bar"><div class="trk"><div class="pf"></div></div></div><div class="times"><span class="pos"></span><span class="dur"></span></div></div>' +
      '<div class="tp">' +
      '<div class="tb sm" role="button" data-act="shuffle"><ha-icon icon="mdi:shuffle-variant"></ha-icon></div>' +
      '<div class="tb" role="button" data-act="prev"><ha-icon icon="mdi:skip-previous"></ha-icon></div>' +
      '<div class="tb big" role="button" data-act="playpause"><ha-icon icon="mdi:play"></ha-icon></div>' +
      '<div class="tb" role="button" data-act="next"><ha-icon icon="mdi:skip-next"></ha-icon></div>' +
      '<div class="tb sm" role="button" data-act="repeat"><ha-icon icon="mdi:repeat-off"></ha-icon></div></div>' +
      volRow("main", '<div class="ib last" role="button" data-act="speakers"><ha-icon icon="mdi:tune-vertical-variant"></ha-icon></div>') +
      "</div></div>" +
      // nothing playing
      '<div class="idle">' + headerHtml() +
      '<div class="ic"><ha-icon class="big" icon="mdi:speaker-off"></ha-icon><h2>Nothing playing</h2><div class="sub"></div>' +
      '<div class="go" role="button" data-act="browse"><ha-icon icon="mdi:music-box-multiple-outline"></ha-icon>Browse music</div></div>' +
      '<div class="qf"></div></div>' +
      // overlays
      // timer countdown: below the panels (z-index 5), so browse / speakers / queue cover it
      '<echo-timer-overlay hidden auto-pos="media" style="z-index:4"></echo-timer-overlay>' +
      '<div class="ov browse hidden"></div>' +
      '<div class="ov spk hidden"></div>' +
      '<div class="ov queue hidden"></div>' +
      "</div>" +
      (buttons.length ? '<div class="btns">' + btnHtml + "</div>" : "") +
      '</div><div class="toast"></div></div>';

    this._rootEl = root.querySelector(".root");
    this._mainEl = root.querySelector(".main");
    this._npEl = root.querySelector(".np");
    this._artEl = root.querySelector(".art");
    this._imgEl = root.querySelector(".art img");
    this._bgArt = root.querySelector(".bgart");
    this._brEl = root.querySelector(".ov.browse");
    this._spEl = root.querySelector(".ov.spk");
    this._quEl = root.querySelector(".ov.queue");
    this._ovEl = root.querySelector("echo-timer-overlay");
    this._toastEl = root.querySelector(".toast");
    var self = this;

    root.addEventListener("pointerdown", function () { self._touch(); }, true);
    root.addEventListener("click", function (ev) {
      if (self._config.tap_sound && window.EchoAlarmSound && window.EchoAlarmSound.tick &&
          ev.target.closest && ev.target.closest('[role="button"]')) window.EchoAlarmSound.tick();
    }, true);

    // Taps on anything with data-act (now playing, idle page, overlays).
    this._mainEl.addEventListener("click", function (ev) {
      var t = ev.target.closest ? ev.target.closest("[data-act]") : null;
      if (!t || !self._mainEl.contains(t)) return;
      self._action(t.getAttribute("data-act"), t, ev);
    });

    // Volume sliders + seek bar (pointer drags).
    this._mainEl.addEventListener("pointerdown", function (ev) {
      if (!ev.target.closest) return;
      var tr = ev.target.closest(".vtrack");
      if (tr) {
        self._volStart(tr, ev.clientX);
        try { tr.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
        ev.preventDefault();
        return;
      }
      var bar = ev.target.closest(".bar");
      if (bar) self._seek(bar, ev.clientX);
    });
    this._mainEl.addEventListener("pointermove", function (ev) { if (self._vdrag) self._volMove(ev.clientX); });
    this._mainEl.addEventListener("pointerup", function () { self._volEnd(); });
    this._mainEl.addEventListener("pointercancel", function () { self._volEnd(); });

    // Album art loading (fall back to the centred layout if it fails).
    this._imgEl.addEventListener("load", function () { if (self._imgEl.getAttribute("src") === self._artUrl) self._setArt(true); });
    this._imgEl.addEventListener("error", function () {
      if (self._imgEl.getAttribute("src") !== self._artUrl) return;
      // Try the next candidate before giving up and switching to the no-art layout.
      self._artIdx++;
      if (self._artList && self._artIdx < self._artList.length) { self._artUrl = self._artList[self._artIdx]; self._imgEl.setAttribute("src", self._artUrl); self._artWait(); }
      else self._setArt(false);
    });

    var btnEls = root.querySelectorAll(".btn");
    for (var b = 0; b < btnEls.length; b++) {
      btnEls[b].addEventListener("click", function (ev) {
        var i2 = parseInt(ev.currentTarget.getAttribute("data-i"), 10);
        self._buttonTap(buttons[i2]);
      });
    }

    if (window.ResizeObserver) {
      this._ro = new ResizeObserver(function () { self._layoutArt(); });
      this._ro.observe(this._npEl);
    } else {
      window.addEventListener("resize", function () { self._layoutArt(); });
    }
    this._built = true;
  };

  // Square art as tall as the page allows, but never more than ~47% of the width.
  EchoMediaCard.prototype._layoutArt = function () {
    var h = this._npEl.clientHeight, w = this._npEl.clientWidth;
    if (!h || !w) return;
    var size = Math.floor(Math.min(h - 8, w * 0.47));
    this._artEl.style.width = size + "px";
    this._artEl.style.height = size + "px";
  };

  EchoMediaCard.prototype._buttonTap = function (btn) {
    if (!btn) return;
    if ((btn.action === "settings" || btn.action === "timer-settings") && window.EchoShow && window.EchoShow.openSettings) {
      window.EchoShow.openSettings(this, { timers: this._overlayTimers() });
    } else if (btn.action === "timer-settings") {
      if (!window.EchoAlarmSettingsOpen) return; // provided by echo-timer-card.js
      var sc = {}, k;
      for (k in (btn.settings || {})) sc[k] = btn.settings[k];
      for (k in (this._config.settings || {})) sc[k] = this._config.settings[k];
      window.EchoAlarmSettingsOpen(this, this._rootEl, sc);
    } else if (btn.navigation_path) {
      navigate(btn.navigation_path);
    } else if (btn.url) {
      window.open(btn.url, "_self");
    }
  };

  // ---------- update / paint ----------

  EchoMediaCard.prototype._update = function (force) {
    if (!this._hass || !this._built) return;
    // Only repaint when one of our speakers changed (hass updates arrive for every entity).
    var changed = !!force, st = this._hass.states;
    this._refs = this._refs || {};
    for (var i = 0; i < this._rooms.length; i++) {
      var r = this._rooms[i];
      if (st[r.entity] !== this._refs[r.entity]) { this._refs[r.entity] = st[r.entity]; changed = true; }
      if (r.ma && st[r.ma] !== this._refs[r.ma]) { this._refs[r.ma] = st[r.ma]; changed = true; }
      var dvn = r.local ? this._devVolEnt(r.entity) : null;   // the tablet's volume buttons moved
      if (dvn && st[dvn] !== this._refs[dvn]) { this._refs[dvn] = st[dvn]; changed = true; }
      // Another display saved a new "playing from": only the open queue needs it.
      if (r.src && st[r.src] !== this._refs[r.src]) { this._refs[r.src] = st[r.src]; if (this._quEl && !this._quEl.classList.contains("hidden")) changed = true; }
    }
    if (force && !this._manual) this._sel = -1;
    if (changed) this._paint();
    this._updateBadges();
    this._updateOverlay();
  };

  EchoMediaCard.prototype._paint = function () {
    var room = this._room();
    var coord = this._coordOf(room);
    var members = this._membersOf(coord);
    var act = this._activeOf(coord);
    var root = this.shadowRoot;

    // header chip(s)
    var nm = this._roomName(coord);
    var extra = members.length > 1 ? "+" + (members.length - 1) : "";
    var rns = root.querySelectorAll(".rn"), rcs = root.querySelectorAll(".rc");
    for (var i = 0; i < rns.length; i++) { if (rns[i].textContent !== nm) rns[i].textContent = nm; if (rcs[i].textContent !== extra) rcs[i].textContent = extra; }

    var idle = !act;
    if (idle !== this._mainEl.classList.contains("isidle")) this._mainEl.classList.toggle("isidle");
    if (idle) {
      this._paintIdle(members);
      this._wantArt([]);
    } else {
      this._paintNowPlaying(act);
    }
    this._paintVolumes();
    if (!this._spEl.classList.contains("hidden")) this._renderSpeakers(false);
    if (!this._brEl.classList.contains("hidden")) this._paintTarget();
    // Queue open and the song changed: refresh it.
    if (!this._quEl.classList.contains("hidden") && this._qKey(coord, act) !== this._qTitle) this._renderQueue();
    this._layoutArt();
  };

  EchoMediaCard.prototype._paintIdle = function (members) {
    var names = [];
    for (var i = 0; i < members.length; i++) names.push(this._roomName(members[i]));
    var sub = this.shadowRoot.querySelector(".ic .sub");
    var txt = "on " + names.join(", ");
    if (sub.textContent !== txt) sub.textContent = txt;
    this._stopTick();
    // Quick-start row of the radio stations in the Music Assistant library.
    var qn = this._config.quick_favorites;
    var qf = this.shadowRoot.querySelector(".qf");
    if (!qn || !this._config.ma_config_entry) { qf.innerHTML = ""; return; }
    var self = this;
    this._loadStations().then(function (items) {
      var list = items.slice(0, qn);
      var sig = list.map(function (x) { return x.id; }).join("|");
      if (qf.getAttribute("data-sig") === sig) return;
      qf.setAttribute("data-sig", sig);
      self._quick = list;
      if (!list.length) { qf.innerHTML = ""; return; }
      var h = '<div class="sh">Radio</div><div class="qfg">';
      for (var k = 0; k < list.length; k++) h += self._tileHtml(list[k], "q" + k, false);
      qf.innerHTML = h + "</div>";
    }, function () { /* library unavailable */ });
  };

  EchoMediaCard.prototype._paintNowPlaying = function (st) {
    var a = st.attributes, root = this.shadowRoot;
    var title = a.media_title || a.media_channel || "Unknown";
    var by = a.media_artist || (a.media_channel && a.media_channel !== title ? a.media_channel : "") || "";
    var album = a.media_album_name || "";
    var src = srcLabel(st);
    var srcHtml = src ? '<ha-icon icon="' + src[0] + '"></ha-icon>' + esc(src[1]) : "";
    var srcEl = root.querySelector(".src");
    if (srcEl.getAttribute("data-h") !== srcHtml) { srcEl.innerHTML = srcHtml; srcEl.setAttribute("data-h", srcHtml); }
    var set = function (sel, v) { var el = root.querySelector(sel); if (el.textContent !== v) el.textContent = v; };
    set(".ttl", title);
    set(".by", by);
    set(".alb", album !== title ? album : "");
    this._wantArt(this._withLogo(st, artUrls(st)));

    // transport
    var f = a.supported_features || 0;
    var playing = !!PLAYING[st.state];
    var pp = root.querySelector('[data-act="playpause"] ha-icon');
    var ppIcon = playing ? ((f & F_PAUSE) ? "mdi:pause" : "mdi:stop") : "mdi:play";
    if (pp.getAttribute("icon") !== ppIcon) pp.setAttribute("icon", ppIcon);
    this._flag('[data-act="prev"]', "dis", !(f & F_PREV));
    this._flag('[data-act="next"]', "dis", !(f & F_NEXT));
    this._flag('[data-act="shuffle"]', "dis", !(f & F_SHUFFLE));
    this._flag('[data-act="repeat"]', "dis", !(f & F_REPEAT));
    var shuf = this._optimistic("shuffle", !!a.shuffle);
    this._flag('[data-act="shuffle"]', "on", shuf);
    var rp = this._optimistic("repeat", a.repeat || "off");
    this._flag('[data-act="repeat"]', "on", rp !== "off");
    var ri = root.querySelector('[data-act="repeat"] ha-icon');
    var rIcon = rp === "one" ? "mdi:repeat-once" : rp === "all" ? "mdi:repeat" : "mdi:repeat-off";
    if (ri.getAttribute("icon") !== rIcon) ri.setAttribute("icon", rIcon);

    // progress
    this._prog = { st: st, dur: a.media_duration || 0, pos: a.media_position || 0, at: a.media_position_updated_at ? Date.parse(a.media_position_updated_at) : Date.now(), playing: playing, seek: !!(f & F_SEEK) };
    this._flag(".prog", "hide", !(this._prog.dur > 0));
    this._paintProgress();
    if (playing && this._prog.dur > 0) this._startTick(); else this._stopTick();
  };

  // Shuffle / repeat show the new setting straight away, until HA reports it (or 5 s).
  EchoMediaCard.prototype._optimistic = function (key, real) {
    var o = this._optim && this._optim[key];
    if (!o) return real;
    if (o.v === real || Date.now() > o.until) { delete this._optim[key]; return real; }
    return o.v;
  };

  EchoMediaCard.prototype._setOptimistic = function (key, v) {
    var self = this;
    this._optim = this._optim || {};
    this._optim[key] = { v: v, until: Date.now() + 5000 };
    this._paint();
    setTimeout(function () { self._paint(); }, 5200);
  };

  EchoMediaCard.prototype._flag = function (sel, cls, on) {
    var el = this.shadowRoot.querySelector(sel);
    if (el && on !== el.classList.contains(cls)) el.classList.toggle(cls);
  };

  EchoMediaCard.prototype._paintProgress = function () {
    var p = this._prog;
    if (!p || !(p.dur > 0)) return;
    var pos = p.pos + (p.playing ? (Date.now() - p.at) / 1000 : 0);
    pos = clamp(pos, 0, p.dur);
    var root = this.shadowRoot;
    root.querySelector(".pf").style.transform = "scaleX(" + (pos / p.dur).toFixed(4) + ")";
    var a = fmtTime(pos), b = fmtTime(p.dur);
    var pe = root.querySelector(".pos"), de = root.querySelector(".dur");
    if (pe.textContent !== a) pe.textContent = a;
    if (de.textContent !== b) de.textContent = b;
  };

  EchoMediaCard.prototype._startTick = function () {
    if (this._tick) return;
    var self = this;
    this._tick = setInterval(function () { self._paintProgress(); }, 1000);
  };
  EchoMediaCard.prototype._stopTick = function () {
    if (this._tick) { clearInterval(this._tick); this._tick = null; }
  };

  // Music Assistant radio: until it has found the song's album art, its picture is the station
  // logo fetched through its own image proxy, which can stall. The logo straight from the
  // library (as Browse shows it) goes last in the list, so it shows instead.
  EchoMediaCard.prototype._withLogo = function (st, list) {
    var id = String(st.attributes.media_content_id || "");
    if (!/^library:\/\/radio\//.test(id) || !this._config.ma_config_entry) return list;
    var self = this;
    // (Re)read the stations when there are none yet, or when this one was added since (at most once a minute).
    var known = this._logos && this._logos[id] !== undefined;
    if (!known && !(this._logosAt > Date.now() - (this._logos ? 60000 : 300000))) {
      this._logosAt = Date.now();
      this._maCall("get_library", { media_type: "radio", limit: 500, offset: 0 }).then(function (r) {
        var m = {};
        (r.items || []).forEach(function (x) { if (x.uri) m[x.uri] = typeof x.image === "string" && x.image ? fixImg(x.image) : ""; });
        self._logos = m;
        if (self._hass && self._built) self._paint();
      }, function () { /* try again in a few minutes */ });
    }
    var u = this._logos && this._logos[id];
    return u && list.indexOf(u) === -1 ? list.concat([u]) : list;
  };

  // Album art: preload, then switch layouts only once we know whether it loads.
  EchoMediaCard.prototype._wantArt = function (list) {
    var key = list.join("|");
    if (key === this._artKey) return;
    this._artKey = key;
    this._artList = list;
    this._artIdx = 0;
    this._artUrl = list[0] || "";
    if (!this._artUrl) { this._setArt(false); this._imgEl.removeAttribute("src"); return; }
    this._imgEl.setAttribute("src", this._artUrl);
    this._artWait();
  };

  // A picture that hasn't loaded after a few seconds is skipped for the next one, if any.
  EchoMediaCard.prototype._artWait = function () {
    var self = this, url = this._artUrl;
    clearTimeout(this._artTimer);
    this._artTimer = setTimeout(function () {
      var img = self._imgEl;
      if (self._artUrl !== url || (img.complete && img.naturalWidth) || !self._artList || self._artIdx + 1 >= self._artList.length) return;
      self._artUrl = self._artList[++self._artIdx];
      img.setAttribute("src", self._artUrl);
      self._artWait();
    }, 4000);
  };

  EchoMediaCard.prototype._setArt = function (ok) {
    if (ok === this._npEl.classList.contains("noart")) this._npEl.classList.toggle("noart");
    if (ok) {
      this._bgArt.style.backgroundImage = 'url("' + String(this._artUrl).replace(/"/g, "%22") + '")';
      this._bgArt.classList.add("on");
      this._layoutArt();
    } else {
      this._bgArt.classList.remove("on");
    }
  };

  // ---------- volume ----------

  // Volume sliders: "main" (whole group; scales every speaker proportionally) or
  // "r<i>" (one room). Values are shown immediately and sent to HA at most ~4x/second.
  EchoMediaCard.prototype._volTargets = function (key) {
    if (key === "main") return this._members();
    var r = this._rooms[parseInt(key.slice(1), 10)];
    return r ? [r] : [];
  };

  EchoMediaCard.prototype._paintVolumes = function () {
    var tracks = this.shadowRoot.querySelectorAll(".vtrack");
    for (var i = 0; i < tracks.length; i++) {
      var key = tracks[i].getAttribute("data-vol");
      var rooms = this._volTargets(key);
      if (!rooms.length) continue;
      var sum = 0, muted = true;
      for (var j = 0; j < rooms.length; j++) { sum += this._volOf(rooms[j].entity); if (!this._mutedOf(rooms[j].entity)) muted = false; }
      var v = sum / rooms.length;
      tracks[i].querySelector(".vfill").style.transform = "scaleX(" + v.toFixed(3) + ")";
      var vv = tracks[i].querySelector(".vv"), txt = muted ? "Muted" : Math.round(v * 100) + "%";
      if (vv.textContent !== txt) vv.textContent = txt;
      if (muted !== tracks[i].classList.contains("muted")) tracks[i].classList.toggle("muted");
      var lab = tracks[i].querySelector(".vlab");
      var lt = key === "main" && rooms.length > 1 ? "Group" : "";
      if (lab && lab.textContent !== lt) lab.textContent = lt;
      var mb = tracks[i].parentNode.querySelector('[data-act="mute"] ha-icon');
      var ic = muted ? "mdi:volume-off" : v < 0.34 ? "mdi:volume-low" : v < 0.67 ? "mdi:volume-medium" : "mdi:volume-high";
      if (mb && mb.getAttribute("icon") !== ic) mb.setAttribute("icon", ic);
    }
  };

  EchoMediaCard.prototype._volStart = function (track, x) {
    var key = track.getAttribute("data-vol");
    var rooms = this._volTargets(key);
    if (!rooms.length) return;
    var base = {}, sum = 0;
    for (var i = 0; i < rooms.length; i++) { base[rooms[i].entity] = this._volOf(rooms[i].entity); sum += base[rooms[i].entity]; }
    this._vdrag = { key: key, track: track, rooms: rooms, base: base, avg: sum / rooms.length, sent: 0, pend: null, timer: null };
    this._volMove(x);
  };

  EchoMediaCard.prototype._volMove = function (x) {
    var d = this._vdrag;
    if (!d) return;
    var r = d.track.getBoundingClientRect();
    var f = clamp((x - r.left) / r.width, 0, 1);
    f = Math.round(f * 100) / 100;
    var vols = {};
    for (var i = 0; i < d.rooms.length; i++) {
      var e = d.rooms[i].entity;
      vols[e] = d.rooms.length === 1 || d.avg < 0.01 ? f : clamp(d.base[e] * f / d.avg, 0, 1);  // keep the speakers' balance
      vols[e] = Math.round(vols[e] * 100) / 100;
      this._volLocal[e] = { v: vols[e], drag: true, until: 0 };
    }
    this._paintVolumes();
    d.pend = vols;
    var now = Date.now(), self = this;
    if (now - d.sent >= 280) this._volFlush();
    else if (!d.timer) d.timer = setTimeout(function () { d.timer = null; self._volFlush(); }, 280 - (now - d.sent));
  };

  EchoMediaCard.prototype._volFlush = function () {
    var d = this._vdrag;
    if (!d || !d.pend) return;
    var vols = d.pend;
    d.pend = null;
    d.sent = Date.now();
    for (var e in vols) {
      var dv = this._devVolEnt(e);
      if (dv) { this._hass.callService("number", "set_value", { entity_id: dv, value: Math.round(vols[e] * 100) }); continue; }
      var s = this._st(e);
      if (s && Math.abs((s.attributes.volume_level || 0) - vols[e]) < 0.005) continue;
      this._hass.callService("media_player", "volume_set", { entity_id: e, volume_level: vols[e] });
    }
  };

  EchoMediaCard.prototype._volEnd = function () {
    var d = this._vdrag;
    if (!d) return;
    if (d.timer) { clearTimeout(d.timer); d.timer = null; }
    this._volFlush();
    this._vdrag = null;
    var until = Date.now() + 2500;
    for (var i = 0; i < d.rooms.length; i++) {
      var l = this._volLocal[d.rooms[i].entity];
      if (l) { l.drag = false; l.until = until; }
    }
  };

  EchoMediaCard.prototype._toggleMute = function (key) {
    var rooms = this._volTargets(key);
    var anyOn = false;
    for (var i = 0; i < rooms.length; i++) if (!this._mutedOf(rooms[i].entity)) anyOn = true;
    for (var j = 0; j < rooms.length; j++) {
      this._hass.callService("media_player", "volume_mute", { entity_id: rooms[j].entity, is_volume_muted: anyOn });
    }
  };

  EchoMediaCard.prototype._seek = function (bar, x) {
    var p = this._prog;
    if (!p || !p.seek || !(p.dur > 0)) return;
    var r = bar.getBoundingClientRect();
    var pos = clamp((x - r.left) / r.width, 0, 1) * p.dur;
    this._hass.callService("media_player", "media_seek", { entity_id: p.st.entity_id, seek_position: Math.round(pos) });
    p.pos = pos; p.at = Date.now();
    this._paintProgress();
  };

  // ---------- actions ----------

  EchoMediaCard.prototype._action = function (act, el, ev) {
    var hass = this._hass;
    if (!hass) return;
    var coord = this._coord();
    var st = this._activeOf(coord);
    var target = st ? st.entity_id : coord.entity;
    var i;
    switch (act) {
      case "playpause":
        if (st && PLAYING[st.state]) hass.callService("media_player", (st.attributes.supported_features & F_PAUSE) ? "media_pause" : "media_stop", { entity_id: target });
        else hass.callService("media_player", "media_play", { entity_id: target });
        break;
      case "next": hass.callService("media_player", "media_next_track", { entity_id: target }); break;
      case "prev": hass.callService("media_player", "media_previous_track", { entity_id: target }); break;
      case "shuffle":
        var sh = !this._optimistic("shuffle", !!(st && st.attributes.shuffle));
        hass.callService("media_player", "shuffle_set", { entity_id: target, shuffle: sh });
        this._setOptimistic("shuffle", sh);
        break;
      case "repeat":
        var rp = this._optimistic("repeat", (st && st.attributes.repeat) || "off");
        var nr = rp === "off" ? "all" : rp === "all" ? "one" : "off";
        hass.callService("media_player", "repeat_set", { entity_id: target, repeat: nr });
        this._setOptimistic("repeat", nr);
        break;
      case "mute": this._toggleMute(el.getAttribute("data-k")); break;
      case "speakers": this._openSpeakers(); break;
      case "browse": this._openBrowse(); break;
      case "queue": this._openQueue(); break;
      case "qitem": this._queuePlayFrom(parseInt(el.getAttribute("data-k"), 10)); break;
      case "qplay": this._maPlayItem(el.getAttribute("data-k"), el.getAttribute("data-t")); break;
      case "close": this._closeOverlays(); break;
      // speakers panel
      case "pick":
        i = parseInt(el.getAttribute("data-i"), 10);
        this._sel = i; this._manual = true;
        this._closeOverlays();
        this._paint();
        break;
      case "group": this._toggleGroup(parseInt(el.getAttribute("data-i"), 10)); break;
      case "group-all": this._groupAll(); break;
      case "ungroup-all": this._ungroupAll(); break;
      // browse
      case "tab": this._br.stack = []; this._br.tab = el.getAttribute("data-t"); this._br.q = ""; this._renderBrowse(true); break;
      case "ltype": this._br.stack = []; this._br.ltype = el.getAttribute("data-t"); this._renderBrowse(true); break;
      case "stype": this._br.stack = []; this._br.stype = el.getAttribute("data-t"); this._renderBrowse(true); break;
      case "sort": this._br.stack = []; this._br.sort = this._br.sort === "name" ? "last_played_desc" : "name"; this._renderBrowse(true); break;
      case "clear": this._br.stack = []; this._br.q = ""; this._renderBrowse(true); break;
      case "view-back": this._closeView(); break;
      case "view-play": var vw = this._view(); if (vw) this._playView(vw, false); break;
      case "view-shuffle": var vs = this._view(); if (vs) this._playView(vs, true); break;
      case "item":
        var it = this._itemFor(el.getAttribute("data-k"));
        if (!it) break;
        if (ev && ev.target.closest && ev.target.closest(".more")) this._openSheet(it);
        else if (it.kind === "ma" && (it.mtype === "artist" || it.mtype === "album")) this._openView(it);
        else if (it.mtype === "somafm") this._openView(it);
        else if (it.row) this._playFrom(parseInt(el.getAttribute("data-k").slice(1), 10));
        else this._play(it, null, false);
        break;
      case "sheet-close": this._closeSheet(); break;
      case "target-pick": this._openTargetPicker(); break;
      case "target":
        this._closeSheet();
        this._sel = parseInt(el.getAttribute("data-i"), 10); this._manual = true;
        this._paint();
        this._paintTarget();
        break;
      case "target-group": this._closeSheet(); this._openSpeakers(); break;
      case "sheet":
        var o = el.getAttribute("data-o"), s = this._sheetItem;
        this._closeSheet();
        if (s) this._play(s, o === "radio" ? null : o, o === "radio");
        break;
    }
  };

  EchoMediaCard.prototype._toast = function (msg) {
    var t = this._toastEl, self = this;
    t.textContent = msg;
    t.classList.add("show");
    if (this._toastT) clearTimeout(this._toastT);
    this._toastT = setTimeout(function () { self._toastEl.classList.remove("show"); }, 2600);
  };

  EchoMediaCard.prototype._closeOverlays = function () {
    if (this._brEl) this._brEl.classList.add("hidden");
    if (this._spEl) this._spEl.classList.add("hidden");
    if (this._quEl) this._quEl.classList.add("hidden");
    this._closeSheet();
  };

  // ---------- queue ----------
  // Home Assistant only exposes Music Assistant's current + next song and the queue length,
  // so the full list shown is the album / playlist last started from any of these screens.
  // It is kept in a per-room input_text helper (shared by every display); without the
  // helper it falls back to this browser's storage.

  EchoMediaCard.prototype._srcMap = function () {
    if (this._qsrc) return this._qsrc;
    try { this._qsrc = JSON.parse(window.localStorage.getItem("echo-media-qsrc") || "{}") || {}; } catch (e) { this._qsrc = {}; }
    return this._qsrc;
  };

  EchoMediaCard.prototype._roomOfMa = function (ma) {
    for (var i = 0; i < this._rooms.length; i++) if (this._rooms[i].ma === ma) return this._rooms[i];
    return null;
  };

  EchoMediaCard.prototype._srcHelper = function (ma) {
    var r = this._roomOfMa(ma);
    return r && r.src && this._hass && this._hass.states[r.src] ? r.src : null;
  };

  EchoMediaCard.prototype._getSrc = function (ma) {
    var h = this._srcHelper(ma);
    if (h) {
      var v = this._hass.states[h].state;
      if (!v || v === "unknown" || v === "unavailable" || v.charAt(0) !== "{") return null;
      try {
        var o = JSON.parse(v);
        return { mtype: o.m, id: o.id || null, title: o.t || "", sub: o.s || "" };
      } catch (e) { return null; }
    }
    return this._srcMap()[ma] || null;
  };

  // Compact JSON that fits the helper's 255 characters.
  function packSrc(src) {
    var o = { m: src.mtype };
    if (src.id) o.id = src.id;
    var t = String(src.title || ""), s = String(src.sub || "");
    for (var n = 0; n < 4; n++) {
      o.t = t; if (s) o.s = s; else delete o.s;
      var j = JSON.stringify(o);
      if (j.length <= 255) return j;
      if (s.length > 40) s = s.slice(0, 39) + "…";
      else if (t.length > 60) t = t.slice(0, 59) + "…";
      else { s = ""; t = t.slice(0, 30); }
    }
    delete o.s; o.t = "";
    return JSON.stringify(o).slice(0, 255);
  }

  EchoMediaCard.prototype._setSrc = function (ma, src) {
    var h = this._srcHelper(ma);
    if (h) {
      this._hass.callService("input_text", "set_value", { entity_id: h, value: src ? packSrc(src) : "" });
      return;
    }
    var m = this._srcMap();
    if (src) m[ma] = src; else delete m[ma];
    try { window.localStorage.setItem("echo-media-qsrc", JSON.stringify(m)); } catch (e) { /* storage unavailable */ }
  };

  // Changes when the song or the saved "playing from" changes (from any display).
  EchoMediaCard.prototype._qKey = function (coord, act) {
    var h = coord && coord.ma ? this._srcHelper(coord.ma) : null;
    var n = coord ? this._st(coord.entity) : null;
    return (act ? act.attributes.media_title || "" : "") + "|" + (h ? this._hass.states[h].state : "") + "|" + (n ? n.attributes.media_content_id || "" : "");
  };

  EchoMediaCard.prototype._openQueue = function () {
    this._brEl.classList.add("hidden");
    this._spEl.classList.add("hidden");
    this._quEl.classList.remove("hidden");
    this._renderQueue();
  };

  // "Song (2011 Remaster)" / "Song - Live" / "Song [feat. X]" all compare as "song".
  function normTitle(t) {
    return String(t || "").toLowerCase().replace(/\s*[\(\[][^\)\]]*[\)\]]/g, "").replace(/\s+-\s+.*$/, "").replace(/[^a-z0-9]+/g, " ").trim();
  }

  // Scroll a list so an item sits in the middle (scrollIntoView would also scroll the page).
  function centerIn(box, item) {
    if (!box || !item) return;
    var b = box.getBoundingClientRect(), r = item.getBoundingClientRect();
    box.scrollTop += (r.top - b.top) - (b.height - r.height) / 2;
  }

  function splitName(name) {
    var t = String(name || ""), cut = t.indexOf(" - ");
    return cut > 0 ? { t: t.slice(cut + 3), s: t.slice(0, cut) } : { t: t, s: "" };
  }

  function qRow(cls, num, img, title, sub, dur, act, key) {
    return '<div class="trow ' + cls + '"' + (act ? ' role="button" data-act="' + act + '" data-k="' + key + '"' : "") + ">" +
      (num !== null ? '<div class="tn">' + num + "</div>" : "") +
      '<div class="qi"' + (img ? ' style="background-image:url(&quot;' + esc(img) + '&quot;)"' : "") + "></div>" +
      '<div class="tx"><div class="tt1">' + esc(title) + '</div><div class="ts1">' + esc(sub || "") + "</div></div>" +
      (dur ? '<div class="du">' + fmtTime(dur) + "</div>" : "") + "</div>";
  }

  EchoMediaCard.prototype._renderQueue = function () {
    var self = this, el = this._quEl, coord = this._coord(), act = this._activeOf(coord);
    this._qTitle = this._qKey(coord, act);
    var req = this._qReq = (this._qReq || 0) + 1;
    var head = '<div class="ovh"><h2>Queue</h2><div class="qmeta"></div><div class="grow"></div>' +
      '<div class="ib" role="button" data-act="close"><ha-icon icon="mdi:close"></ha-icon></div></div>';
    var viaMa = !!coord.ma && !!act && (act.merged || act.attributes.app_id === "music_assistant");
    if (!viaMa) {
      el.innerHTML = head + '<div class="grid"><div class="msg">' + (act ?
        "This music isn't playing through Music Assistant (for example a Sonos favorite or the Sonos app), so there's no queue to show here." :
        "Nothing is playing.") + "</div></div>";
      return;
    }
    var mc = this._ma(), ref = this._maQueueRef(coord);
    if (mc && mc.state === "ready" && ref.qid && mc.queues[ref.qid]) { this._renderLiveQueue(mc, ref, act, head, req); return; }
    this._liveSig = null;
    if (mc) head = head.replace('<div class="grow">', '<span class="qlive off">' + (mc.state === "connecting" || mc.state === "idle" ? "Connecting to Music Assistant…" : "Not live") + '</span><div class="grow">');
    if (!el.querySelector(".grid") || this._qWasLive) el.innerHTML = head + '<div class="grid"><div class="msg">Loading…</div></div>';
    this._qWasLive = false;
    var src = this._getSrc(coord.ma);
    var qp = this._hass.callWS({ type: "call_service", domain: "music_assistant", service: "get_queue", target: { entity_id: coord.ma }, return_response: true })
      .then(function (r) { return (r && r.response && r.response[coord.ma]) || {}; }, function () { return {}; });
    var lp;
    if (src && src.mtype === "tracks") lp = Promise.resolve(src.items || []);
    else if (src && src.id && (src.mtype === "album" || src.mtype === "playlist")) {
      lp = this._hass.callWS({ type: "media_player/browse_media", entity_id: coord.ma, media_content_type: src.mtype, media_content_id: src.id }).then(function (r) {
        return (r.children || []).filter(function (c) { return c.can_play; }).map(function (c) {
          var n = splitName(c.title);
          return { t: n.t, s: n.s, id: c.media_content_id, img: c.thumbnail || "" };
        });
      }, function () { return []; });
    } else lp = Promise.resolve(null);
    Promise.all([qp, lp]).then(function (res) {
      if (req !== self._qReq || el.classList.contains("hidden")) return;
      // Music Assistant's "next_item" is not kept up to date for these Sonos players, so it
      // is not used. "Now playing" comes from the Sonos (live); "Up next" from the known list.
      var q = res[0], list = res[1];
      var cur = q.current_item;
      var curUri = cur && cur.media_item ? cur.media_item.uri : "";
      var a = act.attributes, nowT = a.media_title || "";
      var h = '<div class="sh">Now playing</div>' +
        qRow("static cur", null, artUrls(act)[0] || "", nowT || "Unknown", a.media_artist || "", a.media_duration || 0);
      var ci = -1;
      if (list) {
        // The Sonos title is live; Music Assistant's current item can lag, so it's only a fallback.
        for (var k2 = 0; k2 < list.length && ci < 0; k2++) if (nowT && list[k2].t.toLowerCase() === nowT.toLowerCase()) ci = k2;
        var nn = normTitle(nowT);
        for (var k3 = 0; k3 < list.length && ci < 0; k3++) if (nn && normTitle(list[k3].t) === nn) ci = k3;
        for (var k = 0; k < list.length && ci < 0 && !nowT; k++) if (curUri && list[k].id === curUri) ci = k;
      }
      var shuffled = !!(q.shuffle_enabled || a.shuffle);
      if (list && list.length && ci >= 0 && !shuffled) {
        var nx = list[ci + 1] || (q.repeat_mode === "all" ? list[0] : null);
        h += '<div class="sh">Up next</div>' + (nx ? qRow("static", null, nx.img, nx.t, nx.s, 0) : '<div class="msg" style="padding:2vh">End of the list</div>');
      } else if (list && list.length && shuffled) {
        h += '<div class="sh">Up next</div><div class="msg" style="padding:2vh">Shuffle is on, so the next song is picked at random</div>';
      }
      // A saved list that doesn't contain the current song is from earlier music: don't show it.
      if (list && list.length && ci < 0) { list = null; src = null; }
      self._qList = list;
      if (list && list.length) {
        h += '<div class="sh">Playing from · ' + esc(src.title) + (src.sub ? " · " + esc(src.sub) : "") + "</div>";
        for (var i = 0; i < list.length; i++) {
          h += qRow("trk" + (i === ci ? " cur" : ""), i + 1, list[i].img, list[i].t, list[i].s, 0, "qitem", i);
        }
      } else if (src && src.title) {
        h += '<div class="msg">Playing from ' + esc(src.title) + ". The full song list isn't available for " +
          (src.mtype === "artist" ? "artist mixes" : src.mtype === "radio" ? "radio" : "this") + ".</div>";
      } else {
        h += '<div class="msg">This music was started outside these screens (for example the Music Assistant or Sonos app, or by voice), so its song list isn\'t available here.</div>';
      }
      if (mc && mc.state !== "ready" && mc.error) h += '<div class="msg" style="padding:2vh;font-size:2.4vh">' + esc(mc.error) + "</div>";
      var meta = (q.items ? q.items + " song" + (q.items === 1 ? "" : "s") : "") + (q.shuffle_enabled ? " · Shuffle on" : "") +
        (q.repeat_mode && q.repeat_mode !== "off" ? " · Repeat " + q.repeat_mode : "");
      el.innerHTML = head + '<div class="grid">' + h + "</div>";
      el.querySelector(".qmeta").textContent = meta;
      centerIn(el.querySelector(".grid"), el.querySelector(".trk.cur"));
    });
  };

  // Tap a song in the "Playing from" list: play the list from that song on.
  EchoMediaCard.prototype._queuePlayFrom = function (idx) {
    var list = this._qList || [], coord = this._coord();
    if (!list[idx] || !coord.ma) return;
    var uris = [];
    for (var i = idx; i < list.length; i++) uris.push(list[i].id);
    var src = this._getSrc(coord.ma) || {};
    this._hass.callService("media_player", "shuffle_set", { entity_id: coord.ma, shuffle: false });
    this._hass.callService("music_assistant", "play_media", { entity_id: coord.ma, media_id: uris, media_type: "track", enqueue: "replace" });
    // The saved source (album / playlist) still describes this list, so it stays as it is.
    if (!src.id) this._setSrc(coord.ma, { title: src.title || list[idx].t, sub: src.sub || "", mtype: "tracks", items: list.slice(idx) });
    this._toast("Playing " + list[idx].t);
    var self = this;
    setTimeout(function () { if (!self._quEl.classList.contains("hidden")) self._renderQueue(); }, 1500);
  };

  // ---------- live queue (direct Music Assistant connection) ----------

  EchoMediaCard.prototype._ma = function () {
    var c = this._config;
    if (!c || !c.ma_token || !c.ma_urls.length) return null;
    var m = maConn(c.ma_urls, c.ma_token);
    m.start();
    return m;
  };

  EchoMediaCard.prototype._maHook = function () {
    if (this._maOff) return;
    var mc = this._ma(), self = this;
    if (!mc) return;
    if (window.EchoShow) window.EchoShow.mediaStatus = function () {
      return mc.state === "ready" ? { label: "Connected", detail: "Connected to " + mc.base }
        : { label: mc.state === "down" ? "Not connected" : "Connecting", detail: mc.error || "Connecting to Music Assistant…" };
    };
    this._maOff = mc.on(function (qid) {
      if (!self._quEl || self._quEl.classList.contains("hidden")) return;
      if (qid && qid !== self._maQueueRef(self._coord()).qid) return;
      // Events come in bursts: redraw once they settle.
      if (self._maT) clearTimeout(self._maT);
      self._maT = setTimeout(function () { self._maT = null; self._renderQueue(); }, 250);
    });
  };

  // Which Music Assistant queue is playing on this room, and which item of it. The Sonos'
  // stream address names both (".../single/<session>/<queue>/<item>/<player>.flac"), which is
  // live even when Music Assistant's own "current song" has gone stale.
  EchoMediaCard.prototype._maQueueRef = function (coord) {
    var n = this._st(coord.entity), m = this._st(coord.ma), ref = { qid: null, item: null };
    var id = n ? String(n.attributes.media_content_id || "") : "";
    var mm = /\/(single|flow)\/[^/]+\/([^/]+)\/([^/]+)\/[^/?]+\.\w+/.exec(id);
    if (mm) {
      ref.qid = decodeURIComponent(mm[2]);
      if (mm[1] === "single") ref.item = decodeURIComponent(mm[3]);
    }
    if (!ref.qid && m && m.attributes.active_queue) ref.qid = m.attributes.active_queue;
    if (!ref.qid) ref.qid = coord.maId || null;
    return ref;
  };

  function qiTitle(it) {
    return it.media_item && it.media_item.name ? it.media_item.name : splitName(it.name).t;
  }

  function qiArtist(it) {
    var mi = it.media_item;
    if (mi && mi.artists && mi.artists.length) return artistNames(mi);
    return splitName(it.name).s;
  }

  EchoMediaCard.prototype._renderLiveQueue = function (mc, ref, act, head, req) {
    var self = this, el = this._quEl;
    var liveHead = head.replace('<div class="grow">', '<span class="qlive">● Live</span><div class="grow">');
    if (!this._qWasLive) el.innerHTML = liveHead + '<div class="grid"><div class="msg">Loading…</div></div>';
    this._qWasLive = true;
    mc.getItems(ref.qid).then(function (items) {
      if (req !== self._qReq || el.classList.contains("hidden")) return;
      var q = mc.queues[ref.qid] || {};
      var a = act.attributes, nowT = a.media_title || "";
      var ci = -1, k;
      if (ref.item) for (k = 0; k < items.length && ci < 0; k++) if (items[k].queue_item_id === ref.item) ci = k;
      if (ci < 0 && nowT) {
        var nn = normTitle(nowT), start = typeof q.current_index === "number" ? q.current_index : 0;
        // closest match to where Music Assistant thinks it is (albums can repeat a title)
        var best = -1;
        for (k = 0; k < items.length; k++) {
          if (normTitle(qiTitle(items[k])) === nn && (best < 0 || Math.abs(k - start) < Math.abs(best - start))) best = k;
        }
        ci = best;
      }
      // Music Assistant's own position is only a last resort (it can lag far behind the Sonos).
      if (ci < 0 && !ref.item && typeof q.current_index === "number" && items[q.current_index]) ci = q.current_index;
      var rep = q.repeat_mode || "off";
      var sig = ref.qid + "|" + ci + "|" + items.length + "|" + (items[0] ? items[0].queue_item_id : "") + "|" +
        (items.length ? items[items.length - 1].queue_item_id : "") + "|" + !!q.shuffle_enabled + "|" + rep + "|" + nowT;
      if (sig === self._liveSig && el.querySelector(".trk")) return;
      self._liveSig = sig;

      var h = '<div class="sh">Now playing</div>' +
        qRow("static cur", null, artUrls(act)[0] || "", nowT || "Unknown", a.media_artist || "", a.media_duration || 0);
      var nx = ci >= 0 ? (rep === "one" ? items[ci] : items[ci + 1] || (rep === "all" ? items[0] : null)) : null;
      if (items.length) {
        h += '<div class="sh">Up next</div>' + (nx ?
          qRow("static", null, mc.imageUrl(nx.image || (nx.media_item && nx.media_item.image), 128), qiTitle(nx), qiArtist(nx), nx.duration || 0) :
          '<div class="msg" style="padding:2vh">' + (ci >= 0 ? "End of the queue" + (q.autoplay_enabled ? " · Music Assistant will keep going with similar songs" : "") : "Not sure where in the queue this is") + "</div>");
      }
      var src = q.sources && q.sources.length ? q.sources[0] : null;
      h += '<div class="sh">' + (src && src.name ? "Playing from · " + esc(src.name) : "Queue") + "</div>";
      if (!items.length) h += '<div class="msg">The queue is empty.</div>';
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        h += qRow("trk" + (i === ci ? " cur" : ci >= 0 && i < ci ? " past" : ""), i + 1,
          mc.imageUrl(it.image || (it.media_item && it.media_item.image), 128), qiTitle(it), qiArtist(it), it.duration || 0, "qplay", esc(it.queue_item_id)).replace(
          'data-act="qplay"', 'data-act="qplay" data-t="' + esc(qiTitle(it)) + '"');
      }
      var meta = items.length + " song" + (items.length === 1 ? "" : "s") + (q.shuffle_enabled ? " · Shuffle on" : "") +
        (rep !== "off" ? " · Repeat " + rep : "");
      el.innerHTML = liveHead + '<div class="grid">' + h + "</div>";
      el.querySelector(".qmeta").textContent = meta;
      centerIn(el.querySelector(".grid"), el.querySelector(".trk.cur"));
    }, function (err) {
      if (req !== self._qReq || el.classList.contains("hidden")) return;
      self._liveSig = null;
      el.innerHTML = liveHead + '<div class="grid"><div class="msg">Couldn\'t load the queue: ' + esc(err && err.message ? err.message : "error") + "</div></div>";
    });
  };

  // Tap a song in the live queue: jump to it (the rest of the queue stays as it is).
  EchoMediaCard.prototype._maPlayItem = function (itemId, title) {
    var mc = this._ma(), coord = this._coord(), ref = this._maQueueRef(coord), self = this;
    if (!mc || !ref.qid || !itemId) return;
    mc.call("player_queues/play_index", { queue_id: ref.qid, index: itemId }).then(function () {
      self._toast("Playing " + (title || "song"));
    }, function (e) { self._toast("Couldn't play: " + (e && e.message ? e.message : "error")); });
  };

  // ---------- speakers (grouping + per-room volume) ----------

  EchoMediaCard.prototype._openSpeakers = function () {
    this._brEl.classList.add("hidden");
    this._quEl.classList.add("hidden");
    this._spEl.classList.remove("hidden");
    this._renderSpeakers(true);
  };

  EchoMediaCard.prototype._renderSpeakers = function (full) {
    var coord = this._coord(), members = this._membersOf(coord);
    var order = members.slice();
    for (var i = 0; i < this._rooms.length; i++) if (order.indexOf(this._rooms[i]) === -1) order.push(this._rooms[i]);
    var now = Date.now();
    for (var p in this._pendGroup) if (now - this._pendGroup[p] > 6000) delete this._pendGroup[p];
    var sig = order.map(function (r) { return r.i; }).join(",") + "/" + coord.i + "/" + members.length;
    if (!full && sig === this._spSig && !this._vdrag) { this._paintSpeakerRows(order, members, coord); this._paintVolumes(); return; }
    if (this._vdrag && !full) { this._paintVolumes(); return; }
    this._spSig = sig;
    // This display's own player is on its own: no grouping while it is the one shown.
    this._spEl.classList.toggle("solo", !!coord.local);
    var h = '<div class="ovh"><h2>Speakers</h2><div class="grow"></div><div class="ib" role="button" data-act="close"><ha-icon icon="mdi:close"></ha-icon></div></div><div class="slist">';
    for (var j = 0; j < order.length; j++) {
      var r = order[j];
      h += '<div class="srow' + (r.local ? " loc" : "") + '" data-i="' + r.i + '">' +
        '<div class="sname" role="button" data-act="pick" data-i="' + r.i + '"><div class="n"></div><div class="s"></div></div>' +
        volRow("r" + r.i, r.local ? "" : '<div class="gbtn" role="button" data-act="group" data-i="' + r.i + '"></div>') + "</div>";
    }
    h += '</div><div class="sfoot">' +
      '<div class="wide" role="button" data-act="group-all"><ha-icon icon="mdi:speaker-multiple"></ha-icon>Group all</div>' +
      '<div class="wide" role="button" data-act="ungroup-all"><ha-icon icon="mdi:link-variant-off"></ha-icon>Ungroup all</div>' +
      '<div class="wide done" role="button" data-act="close">Done</div></div>';
    this._spEl.innerHTML = h;
    // .vol rows inside speaker rows are flattened: the mute/slider/group sit in the row itself
    var vols = this._spEl.querySelectorAll(".srow .vol");
    for (var k = 0; k < vols.length; k++) { vols[k].style.flex = "1 1 auto"; vols[k].style.minWidth = "0"; }
    this._paintSpeakerRows(order, members, coord);
    this._paintVolumes();
  };

  EchoMediaCard.prototype._paintSpeakerRows = function (order, members, coord) {
    for (var j = 0; j < order.length; j++) {
      var r = order[j];
      var row = this._spEl.querySelector('.srow[data-i="' + r.i + '"]');
      if (!row) continue;
      var inG = members.indexOf(r) !== -1;
      var avail = this._available(r);
      if (inG !== row.classList.contains("in")) row.classList.toggle("in");
      if (!avail !== row.classList.contains("na")) row.classList.toggle("na");
      var nHtml = esc(this._roomName(r)) + (r === this._room() ? '<ha-icon icon="mdi:check-circle"></ha-icon>' : "");
      var nEl = row.querySelector(".n");
      if (nEl.getAttribute("data-h") !== nHtml) { nEl.innerHTML = nHtml; nEl.setAttribute("data-h", nHtml); }
      var s;
      if (!avail) s = "Unavailable";
      else {
        var rc = this._coordOf(r);
        var a = this._activeOf(rc);
        if (rc !== r) s = "Grouped with " + this._roomName(rc);
        else if (a && PLAYING[a.state]) s = "Playing · " + (a.attributes.media_title || a.attributes.media_channel || "");
        else if (a) s = "Paused · " + (a.attributes.media_title || a.attributes.media_channel || "");
        else s = "Idle";
      }
      if (r.local) s = "This display · " + s;
      var sEl = row.querySelector(".s");
      if (sEl.textContent !== s) sEl.textContent = s;
      var g = row.querySelector(".gbtn"), gh, gc;
      if (!g) continue;
      if (inG && members.length === 1) { gh = "This room"; gc = "gbtn fixed"; }
      else if (inG) { gh = '<ha-icon icon="mdi:check"></ha-icon>In group'; gc = "gbtn on"; }
      else { gh = '<ha-icon icon="mdi:plus"></ha-icon>Add'; gc = "gbtn"; }
      if (this._pendGroup[r.i]) gc += " busy";
      if (g.getAttribute("data-h") !== gh) { g.innerHTML = gh; g.setAttribute("data-h", gh); }
      if (g.className !== gc) g.className = gc;
    }
  };

  EchoMediaCard.prototype._toggleGroup = function (i) {
    var r = this._rooms[i];
    if (!r || r.local) return;
    var coord = this._coord(), members = this._membersOf(coord);
    if (coord.local) return;
    var inG = members.indexOf(r) !== -1;
    if (inG && members.length === 1) return;
    this._pendGroup[i] = Date.now();
    if (inG) {
      // Keep controlling the rest of the group if the shown room is the one leaving.
      if (r === this._room()) {
        for (var k = 0; k < members.length; k++) if (members[k] !== r) { this._sel = members[k].i; this._manual = true; break; }
      }
      this._hass.callService("media_player", "unjoin", { entity_id: r.entity });
    } else {
      this._hass.callService("media_player", "join", { entity_id: coord.entity, group_members: [r.entity] });
    }
    this._renderSpeakers(false);
  };

  EchoMediaCard.prototype._groupAll = function () {
    var coord = this._coord(), members = this._membersOf(coord), add = [];
    if (coord.local) return;
    for (var i = 0; i < this._rooms.length; i++) {
      var r = this._rooms[i];
      if (!r.local && members.indexOf(r) === -1 && this._available(r)) { add.push(r.entity); this._pendGroup[r.i] = Date.now(); }
    }
    if (add.length) this._hass.callService("media_player", "join", { entity_id: coord.entity, group_members: add });
    this._renderSpeakers(false);
  };

  EchoMediaCard.prototype._ungroupAll = function () {
    var coord = this._coord(), members = this._membersOf(coord);
    if (coord.local) return;
    for (var i = 0; i < members.length; i++) {
      if (members[i] === coord) continue;
      this._pendGroup[members[i].i] = Date.now();
      this._hass.callService("media_player", "unjoin", { entity_id: members[i].entity });
    }
    this._sel = coord.i; this._manual = true;
    this._renderSpeakers(false);
  };

  // ---------- browse ----------

  EchoMediaCard.prototype._openBrowse = function () {
    this._spEl.classList.add("hidden");
    this._quEl.classList.add("hidden");
    this._brEl.classList.remove("hidden");
    if (!this._brBuilt) this._buildBrowse();
    this._renderBrowse(!this._br.items.length);
  };

  EchoMediaCard.prototype._buildBrowse = function () {
    var self = this;
    this._brEl.innerHTML =
      '<div class="ovh">' +
      '<div class="tab" role="button" data-act="tab" data-t="radio"><ha-icon icon="mdi:radio"></ha-icon>Radio</div>' +
      '<div class="tab" role="button" data-act="tab" data-t="lib"><ha-icon icon="mdi:bookshelf"></ha-icon>Local library</div>' +
      '<div class="tab" role="button" data-act="tab" data-t="spot"><ha-icon icon="mdi:spotify"></ha-icon>Spotify</div>' +
      '<div class="grow"></div><div class="tgt" role="button" data-act="target-pick"></div>' +
      '<div class="ib" role="button" data-act="close"><ha-icon icon="mdi:close"></ha-icon></div></div>' +
      '<div class="ovf"></div><div class="grid"></div>';
    this._gridEl = this._brEl.querySelector(".grid");
    this._ovfEl = this._brEl.querySelector(".ovf");
    this._gridEl.addEventListener("scroll", function () {
      var g = self._gridEl;
      if (self._br.more && !self._br.loading && g.scrollTop + g.clientHeight > g.scrollHeight - 400) self._loadPage(false);
    });
    // Broken artwork: show the placeholder icon instead.
    this._brEl.addEventListener("error", function (ev) {
      if (ev.target && ev.target.tagName === "IMG") ev.target.style.visibility = "hidden";
    }, true);
    this.shadowRoot.querySelector(".qf").addEventListener("error", function (ev) {
      if (ev.target && ev.target.tagName === "IMG") ev.target.style.visibility = "hidden";
    }, true);
    this._brBuilt = true;
  };

  EchoMediaCard.prototype._paintTarget = function () {
    var el = this._brEl.querySelector(".tgt");
    if (!el) return;
    var coord = this._coord(), n = this._membersOf(coord).length;
    var h = '<ha-icon icon="mdi:speaker"></ha-icon>Play on <b>' + esc(this._roomName(coord)) + (n > 1 ? " +" + (n - 1) : "") + '</b><ha-icon class="chev" icon="mdi:chevron-down"></ha-icon>';
    if (el.getAttribute("data-h") !== h) { el.innerHTML = h; el.setAttribute("data-h", h); }
  };

  EchoMediaCard.prototype._renderBrowse = function (reload) {
    var br = this._br, self = this;
    var tabs = this._brEl.querySelectorAll(".tab");
    for (var i = 0; i < tabs.length; i++) {
      var on = tabs[i].getAttribute("data-t") === br.tab;
      if (on !== tabs[i].classList.contains("sel")) tabs[i].classList.toggle("sel");
    }
    this._paintTarget();
    // filter row
    var f = "";
    var vw = this._view();
    if (vw) {
      var ar = vw.item, isArtist = ar.mtype === "artist", srcName = /^library:/.test(ar.id) ? "Library" : "Spotify";
      if (ar.mtype === "somafm") f = '<div class="ah"><div class="ib" role="button" data-act="view-back"><ha-icon icon="mdi:arrow-left"></ha-icon></div>' +
        '<div class="av sq"' + (ar.img ? ' style="background-image:url(&quot;' + esc(ar.img) + '&quot;)"' : "") + '></div>' +
        '<div style="min-width:0"><div class="an">' + esc(ar.title) + '</div><div class="as">' + esc(ar.sub) + "</div></div></div>";
      else f = '<div class="ah"><div class="ib" role="button" data-act="view-back"><ha-icon icon="mdi:arrow-left"></ha-icon></div>' +
        '<div class="av' + (isArtist ? "" : " sq") + '"' + (ar.img ? ' style="background-image:url(&quot;' + esc(ar.img) + '&quot;)"' : "") + '></div>' +
        '<div style="min-width:0"><div class="an">' + esc(ar.title) + '</div><div class="as">' +
        esc(isArtist ? "Artist · " + srcName : (ar.artist ? ar.artist + " · " : "") + "Album · " + srcName) + "</div></div></div>" +
        (isArtist ? '<div class="go mix" role="button" data-act="view-play"><ha-icon icon="mdi:shuffle-variant"></ha-icon>Play artist mix</div>' :
          '<div class="go mix alt" role="button" data-act="view-shuffle"><ha-icon icon="mdi:shuffle-variant"></ha-icon>Shuffle</div>' +
          '<div class="go mix" role="button" data-act="view-play"><ha-icon icon="mdi:play"></ha-icon>Play album</div>');
    } else {
      f += '<div class="srch"><ha-icon icon="mdi:magnify"></ha-icon><input type="search" enterkeyhint="search" placeholder="' +
        (br.tab === "spot" ? "Search Spotify" : br.tab === "radio" ? "Search radio stations" : "Search your library") + '" value="' + esc(br.q) + '">' +
        (br.q ? '<ha-icon class="clr" role="button" data-act="clear" icon="mdi:close-circle"></ha-icon>' : "") + "</div>";
    }
    if (br.tab === "lib" && !vw) {
      for (var t = 0; t < LIB_TYPES.length; t++) {
        f += '<div class="fc' + (LIB_TYPES[t].t === br.ltype ? " sel" : "") + '" role="button" data-act="ltype" data-t="' + LIB_TYPES[t].t + '">' + LIB_TYPES[t].label + "</div>";
      }
      f += '<div class="fc sort" role="button" data-act="sort"><ha-icon icon="' + (br.sort === "name" ? "mdi:sort-alphabetical-ascending" : "mdi:history") + '"></ha-icon>' + (br.sort === "name" ? "A–Z" : "Recent") + "</div>";
    }
    if (br.tab === "spot" && !vw && !br.q) {
      for (var u = 0; u < SPOT_TYPES.length; u++) {
        f += '<div class="fc' + (SPOT_TYPES[u].t === br.stype ? " sel" : "") + '" role="button" data-act="stype" data-t="' + SPOT_TYPES[u].t + '">' + SPOT_TYPES[u].label + "</div>";
      }
    }
    var fSig = br.tab + "|" + br.ltype + "|" + br.stype + "|" + br.sort + "|" + (br.q ? 1 : 0) + "|" + (vw ? vw.item.id : "");
    if (this._ovfEl.getAttribute("data-sig") !== fSig) {
      this._ovfEl.innerHTML = f;
      this._ovfEl.setAttribute("data-sig", fSig);
      var inp = this._ovfEl.querySelector("input");
      if (inp) {
        inp.addEventListener("input", function () {
          self._touch();
          if (self._qT) clearTimeout(self._qT);
          self._qT = setTimeout(function () {
            var q = inp.value.trim();
            if (q === self._br.q || (q.length === 1)) return;
            self._br.q = q;
            self._renderBrowse(true);
          }, 700);
        });
        inp.addEventListener("keydown", function (ev) {
          if (ev.key === "Enter") { if (self._qT) clearTimeout(self._qT); self._br.q = inp.value.trim(); self._renderBrowse(true); inp.blur(); }
        });
      }
    }
    if (reload) this._loadPage(true);
  };

  // Load (or append) the grid for the current tab / filter.
  EchoMediaCard.prototype._loadPage = function (reset) {
    var br = this._br, self = this;
    if (reset) { br.items = []; br.offset = 0; br.more = false; this._gridEl.scrollTop = 0; }
    br.loading = true;
    var req = ++br.req;
    if (reset) this._gridEl.innerHTML = '<div class="msg">Loading…</div>';
    var p;
    var top = this._view();
    if (top) p = top.item.mtype === "somafm" ? this._somaList() : top.item.mtype === "artist" ? this._artistAlbums(top.item) : this._albumTracks(top.item);
    else if (br.tab === "radio") p = this._radioList(br.q);
    else if (br.tab === "lib") p = br.q ? this._maSearch(br.q, "library") : this._maLibrary(br.ltype, br.offset, br.sort, "");
    else p = br.q ? this._maSearch(br.q, "spotify") : this._spotifyLib(br.stype, br.offset);
    p.then(function (res) {
      if (req !== br.req) return;
      br.loading = false;
      br.items = br.items.concat(res.items);
      br.offset += res.count || res.items.length;
      br.more = !!res.more;
      self._renderGrid(!reset, res.items);
      // Spotify pages are filtered down from the whole library: keep going while the grid is short.
      if (res.soma) res.soma.then(function (tile) {
        // SomaFM found through Music Assistant search after the stations were shown: put its tile first.
        if (!tile || req !== br.req || self._view()) return;
        br.items.unshift(tile);
        self._renderGrid(false, []);
      });
      if (br.tab === "spot" && br.more && br.items.length < 18 && (br.chain = (reset ? 0 : br.chain || 0) + 1) < 6) self._loadPage(false);
    }, function (err) {
      if (req !== br.req) return;
      br.loading = false;
      var msg = err && err.message ? err.message : "Couldn't load";
      self._gridEl.innerHTML = '<div class="msg">' + esc(msg) + "</div>";
    });
  };

  EchoMediaCard.prototype._renderGrid = function (append, added) {
    var br = this._br, h = "";
    if (!append) {
      if (!br.items.length && br.more) { this._gridEl.innerHTML = '<div class="msg">Loading…</div>'; return; }
      if (!br.items.length) {
        var vn = this._view();
        var none = vn && vn.item.mtype === "somafm" ? "No SomaFM stations found in Music Assistant" : vn ? (vn.item.mtype === "artist" ? "No albums found for " : "No songs found on ") + vn.item.title : br.q ? "No results for “" + br.q + "”" :
          br.tab === "spot" ? "Nothing from Spotify here yet. Save music in Spotify, or search for it above." : "Nothing here yet";
        this._gridEl.innerHTML = '<div class="msg">' + esc(none) + "</div>";
        return;
      }
      for (var i = 0; i < br.items.length; i++) h += this._tileHtml(br.items[i], "b" + i, true);
      this._gridEl.innerHTML = h;
    } else {
      var start = br.items.length - added.length;
      for (var j = 0; j < added.length; j++) h += this._tileHtml(added[j], "b" + (start + j), true);
      this._gridEl.insertAdjacentHTML("beforeend", h);
    }
  };

  // ---- artist page: their albums, plus a "Play artist mix" button ----

  // Drill-down pages (artist -> albums, album -> songs) are a stack; Back pops one level
  // and restores the list (and scroll position) underneath.
  EchoMediaCard.prototype._view = function () {
    var st = this._br.stack;
    return st && st.length ? st[st.length - 1] : null;
  };

  EchoMediaCard.prototype._openView = function (it) {
    var br = this._br;
    var parent = this._view();
    if (it.mtype === "album" && !it.artist && parent && parent.item.mtype === "artist") it.artist = parent.item.title;
    br.stack.push({ item: it, saved: { items: br.items, more: br.more, offset: br.offset, scroll: this._gridEl.scrollTop } });
    this._renderBrowse(true);
  };

  EchoMediaCard.prototype._closeView = function () {
    var br = this._br, v = br.stack.pop();
    br.req++;
    this._renderBrowse(false);
    if (v && v.saved) {
      br.items = v.saved.items; br.more = v.saved.more; br.offset = v.saved.offset; br.loading = false;
      this._renderGrid(false, []);
      this._gridEl.scrollTop = v.saved.scroll;
    } else this._loadPage(true);
  };

  // Play the open artist (mix) or album (optionally shuffled).
  EchoMediaCard.prototype._playView = function (v, shuffle) {
    var coord = this._coord();
    if (shuffle && coord.ma) this._hass.callService("media_player", "shuffle_set", { entity_id: coord.ma, shuffle: true });
    else if (!shuffle && coord.ma && v.item.mtype === "album") this._hass.callService("media_player", "shuffle_set", { entity_id: coord.ma, shuffle: false });
    this._play(v.item, null, false);
  };

  // Tap a song in an album: play the album from that song on.
  EchoMediaCard.prototype._playFrom = function (idx) {
    var items = this._br.items, uris = [], first = items[idx];
    if (!first) return;
    for (var i = idx; i < items.length; i++) if (items[i].row) uris.push(items[i].id);
    var coord = this._coord();
    if (!coord.ma) { this._toast("No Music Assistant player set for " + this._roomName(coord)); return; }
    this._hass.callService("media_player", "shuffle_set", { entity_id: coord.ma, shuffle: false });
    var p = this._hass.callService("music_assistant", "play_media", { entity_id: coord.ma, media_id: uris, media_type: "track", enqueue: "replace" });
    var vw0 = this._view(), rows = [];
    if (vw0 && vw0.item.id && (vw0.item.mtype === "album" || vw0.item.mtype === "playlist")) {
      // Save the album itself; the queue shows the whole album with the current song marked.
      this._setSrc(coord.ma, { title: vw0.item.title, sub: vw0.item.artist || "", id: vw0.item.id, mtype: vw0.item.mtype });
    } else {
      for (var j = idx; j < items.length; j++) if (items[j].row) rows.push({ t: items[j].title, s: items[j].sub, id: items[j].id, img: items[j].img });
      this._setSrc(coord.ma, { title: vw0 ? vw0.item.title : first.title, sub: vw0 ? vw0.item.artist || "" : "", mtype: "tracks", items: rows });
    }
    var n = this._membersOf(coord).length, self = this;
    this._toast("Playing on " + this._roomName(coord) + (n > 1 ? " +" + (n - 1) : "") + " · " + first.title);
    if (p && p.then) p.then(null, function (e) { self._toast("Couldn't play: " + (e && e.message ? e.message : "error")); });
    setTimeout(function () { self._closeOverlays(); }, 700);
  };

  // Songs on an album (library or Spotify), via Music Assistant's browse.
  EchoMediaCard.prototype._albumTracks = function (al) {
    var ma = this._coord().ma;
    for (var i = 0; !ma && i < this._rooms.length; i++) ma = this._rooms[i].ma;
    if (!ma) return Promise.reject(new Error("No Music Assistant player configured"));
    return this._hass.callWS({ type: "media_player/browse_media", entity_id: ma, media_content_type: al.mtype === "playlist" ? "playlist" : "album", media_content_id: al.id }).then(function (r) {
      var n = 0;
      var list = (r.children || []).filter(function (c) { return c.can_play; }).map(function (c) {
        // MA titles songs "Artist - Song"
        var t = String(c.title || ""), by = "", cut = t.indexOf(" - ");
        if (cut > 0) { by = t.slice(0, cut); t = t.slice(cut + 3); }
        n++;
        return { kind: "ma", row: true, n: n, title: t, sub: by, img: c.thumbnail || "", id: c.media_content_id, mtype: "track" };
      });
      if (!al.img && list.length && list[0].img) al.img = list[0].img;
      return { items: list, more: false };
    });
  };

  function albumSections(list) {
    var albums = [], singles = [], out = [];
    list.forEach(function (a) { (/single|ep/i.test(a.version || a.album_type || "") ? singles : albums).push(a); });
    if (albums.length) { out.push({ section: "Albums" }); albums.forEach(function (a) { out.push(a); }); }
    if (singles.length) { out.push({ section: "Singles & EPs" }); singles.forEach(function (a) { out.push(a); }); }
    return out;
  }

  EchoMediaCard.prototype._artistAlbums = function (ar) {
    var self = this;
    var name = ar.title, lname = String(name).toLowerCase();
    // Library artist: Music Assistant's own artist page (albums in the library).
    if (/^library:/.test(ar.id)) {
      var ma = this._coord().ma;
      for (var i = 0; !ma && i < this._rooms.length; i++) ma = this._rooms[i].ma;
      if (ma) {
        return this._hass.callWS({ type: "media_player/browse_media", entity_id: ma, media_content_type: "artist", media_content_id: ar.id }).then(function (r) {
          var pre = lname + " - ";
          var list = (r.children || []).filter(function (c) { return c.can_play; }).map(function (c) {
            var t = String(c.title || "");
            if (t.toLowerCase().indexOf(pre) === 0) t = t.slice(pre.length);
            return { kind: "ma", title: t, sub: "", img: c.thumbnail || "", id: c.media_content_id, mtype: "album", artist: name };
          });
          return { items: albumSections(list), more: false };
        });
      }
    }
    // Spotify (or other provider) artist: search their albums and keep the ones credited to them.
    return this._maCall("search", { name: name, artist: name, media_type: ["album"], limit: 50 }).then(function (r) {
      var all = r.albums || [];
      var byId = all.filter(function (a) { return (a.artists || []).some(function (x) { return x.uri === ar.id; }); });
      if (!byId.length) byId = all.filter(function (a) { return (a.artists || []).some(function (x) { return String(x.name || "").toLowerCase() === lname; }); });
      var seen = {};
      var list = byId.filter(function (a) { var k = String(a.name).toLowerCase() + "|" + (a.version || ""); if (seen[k]) return false; seen[k] = 1; return true; })
        .map(function (a) { var t = maTile(a); t.sub = a.version || ""; t.version = a.version || ""; t.artist = name; return t; });
      return { items: albumSections(list), more: false };
    });
  };

  EchoMediaCard.prototype._tileHtml = function (it, key, withMore) {
    if (it.section) return '<div class="sh">' + esc(it.section) + "</div>";
    if (it.row) {
      return '<div class="trow" role="button" data-act="item" data-k="' + key + '"><div class="tn">' + it.n + "</div>" +
        '<div class="tx"><div class="tt1">' + esc(it.title) + '</div><div class="ts1">' + esc(it.sub || "") + "</div></div>" +
        '<div class="more"><ha-icon icon="mdi:dots-horizontal"></ha-icon></div></div>';
    }
    var round = it.mtype === "artist";
    return '<div class="tile' + (round ? " round" : "") + '" role="button" data-act="item" data-k="' + key + '">' +
      '<div class="ti"><ha-icon icon="' + (TYPE_ICON[it.mtype] || "mdi:music") + '"></ha-icon>' +
      (it.img ? '<img loading="lazy" src="' + esc(it.img) + '" alt="">' : "") + "</div>" +
      (withMore && it.kind === "ma" ? '<div class="more"><ha-icon icon="mdi:dots-horizontal"></ha-icon></div>' : "") +
      '<div class="tt">' + esc(it.title) + '</div><div class="ts">' + esc(it.sub || "") + "</div></div>";
  };

  EchoMediaCard.prototype._itemFor = function (key) {
    if (!key) return null;
    var n = parseInt(key.slice(1), 10);
    if (key.charAt(0) === "q") return this._quick ? this._quick[n] : null;
    return this._br.items[n] || null;
  };

  // --- data sources ---

  // Radio stations in the Music Assistant library (the idle page's quick row). Cached for 10 min.
  EchoMediaCard.prototype._loadStations = function () {
    var self = this;
    if (this._stCache && Date.now() - this._stCache.t < 600000) return this._stCache.p;
    var p = this._maLibrary("radio", 0, "name", "").then(function (r) { return r.items; });
    this._stCache = { t: Date.now(), p: p };
    p.then(null, function () { self._stCache = null; });
    return p;
  };

  // Radio tab: the library's stations, with SomaFM's folded into one "SomaFM" tile up front.
  // SomaFM stations that aren't in the library are found by searching its provider (below);
  // that tile is added when the search comes back, so the other stations don't wait for it.
  EchoMediaCard.prototype._radioList = function (q) {
    var self = this, c = this._config;
    var p = this._maCall("get_library", { media_type: "radio", limit: 500, offset: 0, order_by: "sort_name", search: q || undefined });
    return p.then(function (r) {
      var all = (r.items || []).filter(function (x) { return x.name; }), soma = [], rest = [];
      all.forEach(function (x) { (c.somafm && !q && SOMA.test(x.name) ? soma : rest).push(x); });
      var items = rest.map(maTile), res = { items: items, more: false };
      if (!c.somafm || q) return res;
      if (soma.length) {
        self._soma = { t: Date.now(), p: Promise.resolve(soma.map(somaTile).sort(byTitle)) };
        items.unshift(self._somaTile(soma.length));
      } else {
        res.soma = self._somaStations().then(function (list) { return list.length ? self._somaTile(list.length) : null; }, function () { return null; });
      }
      return res;
    });
  };

  EchoMediaCard.prototype._somaTile = function (n) {
    return { kind: "folder", mtype: "somafm", id: "somafm", title: "SomaFM", sub: n + " stations", img: this._config.somafm_logo };
  };

  function byTitle(a, b) { return a.title.toLowerCase() < b.title.toLowerCase() ? -1 : 1; }

  function somaTile(x) {
    var t = maTile(x);
    t.title = String(x.name).replace(SOMA, "") || x.name;
    t.sub = "SomaFM";
    return t;
  }

  EchoMediaCard.prototype._somaList = function () {
    return this._somaStations().then(function (list) { return { items: list, more: false }; });
  };

  // SomaFM's stations as Music Assistant tiles, A–Z. Its provider can only be listed through
  // search, which matches station names, so a few searches together cover all of them. Cached 10 min.
  EchoMediaCard.prototype._somaStations = function () {
    var self = this;
    if (this._soma && Date.now() - this._soma.t < 600000) return this._soma.p;
    var qs = ["a", "e", "i", "o", "u", "y"];
    var p = Promise.all(qs.map(function (q) {
      return self._maCall("search", { name: q, media_type: ["radio"], limit: 100 }).then(function (r) { return r.radio || []; }, function () { return []; });
    })).then(function (lists) {
      var seen = {}, out = [];
      lists.forEach(function (l) {
        l.forEach(function (x) {
          if (!x.name || !x.uri || seen[x.uri] || !(SOMA_URI.test(x.uri) || SOMA.test(x.name))) return;
          seen[x.uri] = 1;
          out.push(somaTile(x));
        });
      });
      out.sort(byTitle);
      return out;
    });
    this._soma = { t: Date.now(), p: p };
    p.then(null, function () { self._soma = null; });
    return p;
  };

  EchoMediaCard.prototype._maCall = function (service, data) {
    if (!this._config.ma_config_entry) return Promise.reject(new Error("Set ma_config_entry in the card config to browse Music Assistant"));
    data.config_entry_id = this._config.ma_config_entry;
    return this._hass.callWS({ type: "call_service", domain: "music_assistant", service: service, service_data: data, return_response: true })
      .then(function (r) { return r && r.response ? r.response : {}; });
  };

  function artistNames(x) {
    return (x.artists || []).map(function (a) { return a.name; }).filter(function (n) { return !!n; }).join(", ");
  }

  // Music Assistant hands back artwork exactly as it was saved. A logo uploaded as
  // http://<ip>:8123/local/... is blocked on an https dashboard (mixed content), so use the same
  // path on the page's own origin, which Home Assistant serves over https.
  function fixImg(u, loc) {
    loc = loc || window.location;
    if (typeof u !== "string" || !/^http:\/\//i.test(u) || loc.protocol !== "https:") return u;
    var a = document.createElement("a");
    a.href = u;
    return /^\/(local|api|hacsfiles)\//.test(a.pathname) ? loc.origin + a.pathname + a.search : u;
  }

  function maTile(x) {
    var sub = "";
    if (x.media_type === "track") sub = artistNames(x);
    else if (x.media_type === "album") sub = artistNames(x) || "Album";
    else if (x.media_type === "playlist") sub = x.owner || "Playlist";
    else if (x.media_type === "radio") sub = "Radio";
    else if (x.media_type === "podcast") sub = x.publisher || "Podcast";
    else if (x.media_type === "audiobook") sub = artistNames(x) || "Audiobook";
    return { kind: "ma", title: x.name || "Untitled", sub: sub, img: fixImg(x.image || (x.album && x.album.image) || ""), id: x.uri, mtype: x.media_type, artist: x.media_type === "album" ? artistNames(x) : "" };
  }

  EchoMediaCard.prototype._maLibrary = function (type, offset, sort, q) {
    var n = this._config.page_size;
    var data = { media_type: type, limit: n, offset: offset, order_by: sort === "name" ? (type === "track" ? "sort_name" : "sort_name") : sort };
    if (q) data.search = q;
    return this._maCall("get_library", data).then(function (r) {
      var items = (r.items || []).filter(function (x) { return x.name; }).map(maTile);
      return { items: items, count: (r.items || []).length, more: (r.items || []).length >= n };
    });
  };

  // which: "library" -> only items in the Music Assistant library, "spotify" -> only Spotify.
  EchoMediaCard.prototype._maSearch = function (q, which) {
    var pre = this._config.spotify_prefix;
    return this._maCall("search", { name: q, limit: 12 }).then(function (r) {
      var out = [];
      SEARCH_SECTIONS.forEach(function (sec) {
        var list = (r[sec[0]] || []).filter(function (x) {
          var u = String(x.uri || "");
          return which === "spotify" ? u.indexOf(pre) === 0 : u.indexOf("library://") === 0;
        });
        if (!list.length) return;
        out.push({ section: sec[1] });
        list.forEach(function (x) { out.push(maTile(x)); });
      });
      return { items: out, more: false };
    });
  };

  // Spotify tab before searching: what was saved from Spotify into the Music Assistant library
  // (recognised by Spotify-hosted artwork). "liked" = favourite songs, "recent" = last played.
  EchoMediaCard.prototype._spotifyLib = function (type, offset) {
    var self = this, big = 150, sec = "";
    var data = { media_type: type, limit: big, offset: offset || 0, order_by: "sort_name" };
    if (type === "liked") {
      // Spotify's Liked Songs arrive in Music Assistant as a playlist ("Liked Songs <user>"), not as favourites.
      return this._maCall("get_library", { media_type: "playlist", limit: 40, offset: 0, order_by: "sort_name", search: "Liked Songs" }).then(function (r) {
        var pl = (r.items || []).filter(function (x) { return /^liked songs/i.test(x.name || "") && SPOT_IMG.test(String(x.image || "")); })[0];
        if (!pl) return { items: [], more: false };
        return self._albumTracks({ id: pl.uri, mtype: "playlist", title: "Liked Songs" }).then(function (res) {
          return { items: res.items.slice(0, 300), more: false };
        });
      });
    }
    else if (type === "recent") {
      // Albums, then playlists: what was last played from Spotify.
      return Promise.all([this._maCall("get_library", { media_type: "album", limit: 60, offset: 0, order_by: "last_played_desc" }),
        this._maCall("get_library", { media_type: "playlist", limit: 60, offset: 0, order_by: "last_played_desc" })]).then(function (rs) {
        var out = [];
        [["Albums", rs[0]], ["Playlists", rs[1]]].forEach(function (g) {
          var list = (g[1].items || []).filter(function (x) { return x.name && SPOT_IMG.test(String(x.image || "")); }).slice(0, 12);
          if (!list.length) return;
          out.push({ section: g[0] });
          list.forEach(function (x) { out.push(maTile(x)); });
        });
        return { items: out, more: false };
      });
    }
    else sec = { playlist: "Your Spotify playlists", album: "Albums", artist: "Artists" }[type] || "";
    return this._maCall("get_library", data).then(function (r) {
      var raw = r.items || [];
      var list = raw.filter(function (x) { return x.name && SPOT_IMG.test(String(x.image || "")); });
      var out = [];
      if (list.length && !offset) out.push({ section: sec });
      list.forEach(function (x) { out.push(maTile(x)); });
      // A page of mostly local music is nearly empty after filtering: keep paging.
      return { items: out, count: raw.length, more: raw.length >= big && type !== "playlist" };
    });
  };

  // --- play ---

  EchoMediaCard.prototype._play = function (it, enqueue, radio) {
    var coord = this._coord(), n = this._membersOf(coord).length;
    var where = this._roomName(coord) + (n > 1 ? " +" + (n - 1) : "");
    var p;
    {
      if (!coord.ma) { this._toast("No Music Assistant player set for " + this._roomName(coord)); return; }
      // "replace" clears the old queue, so shuffle/next stay within what was just picked.
      var data = { entity_id: coord.ma, media_id: it.id, media_type: it.mtype, enqueue: enqueue || "replace" };
      if (radio) data.radio_mode = true;
      p = this._hass.callService("music_assistant", "play_media", data);
      if (!enqueue || enqueue === "replace") {
        this._setSrc(coord.ma, !radio && (it.mtype === "album" || it.mtype === "playlist") ?
          { title: it.title, sub: it.artist || "", id: it.id, mtype: it.mtype } : { title: it.title, mtype: radio ? "radio" : it.mtype });
      }
    }
    var verb = enqueue === "next" ? "Playing next on " : enqueue === "add" ? "Added to queue on " : radio ? "Starting radio on " : "Playing on ";
    this._toast(verb + where + " · " + it.title);
    var self = this;
    if (p && p.then) p.then(null, function (e) { self._toast("Couldn't play: " + (e && e.message ? e.message : "error")); });
    if (!enqueue || enqueue === "replace") setTimeout(function () { self._closeOverlays(); }, 700);
  };

  EchoMediaCard.prototype._openSheet = function (it) {
    this._closeSheet();
    this._sheetItem = it;
    var canRadio = it.mtype === "track" || it.mtype === "artist" || it.mtype === "album" || it.mtype === "playlist";
    var el = document.createElement("div");
    el.className = "sheet";
    el.setAttribute("data-act", "sheet-close");
    el.innerHTML = '<div class="spn">' +
      '<div class="st">' + (it.img ? '<img src="' + esc(it.img) + '" alt="">' : "") + '<div><div class="n">' + esc(it.title) + '</div><div class="s">' + esc(it.sub || "") + "</div></div></div>" +
      '<div class="so" role="button" data-act="sheet" data-o="replace"><ha-icon icon="mdi:play"></ha-icon>Play now</div>' +
      '<div class="so" role="button" data-act="sheet" data-o="next"><ha-icon icon="mdi:playlist-play"></ha-icon>Play next</div>' +
      '<div class="so" role="button" data-act="sheet" data-o="add"><ha-icon icon="mdi:playlist-plus"></ha-icon>Add to queue</div>' +
      (canRadio ? '<div class="so" role="button" data-act="sheet" data-o="radio"><ha-icon icon="mdi:radio-tower"></ha-icon>Start radio</div>' : "") +
      "</div>";
    this._mainEl.appendChild(el);
    this._sheetEl = el;
  };

  // "Play on" picker in the browse screen: choose which speaker (or group) music goes to.
  EchoMediaCard.prototype._openTargetPicker = function () {
    this._closeSheet();
    var coord = this._coord(), h = "<h3>Play on</h3>";
    for (var i = 0; i < this._rooms.length; i++) {
      var r = this._rooms[i], rc = this._coordOf(r), mem = this._membersOf(rc), a = this._activeOf(rc), sub;
      if (!this._available(r)) sub = "Unavailable";
      else if (rc !== r) sub = "Grouped with " + this._roomName(rc);
      else if (mem.length > 1) sub = "Group of " + mem.length + (a && PLAYING[a.state] ? " · Playing" : "");
      else if (a && PLAYING[a.state]) sub = "Playing · " + (a.attributes.media_title || "");
      else if (a) sub = "Paused";
      else sub = "Idle";
      if (r.local) sub = "This display · " + sub;
      var on = rc === coord;
      h += '<div class="so' + (on ? " cur" : "") + (this._available(r) ? "" : " na") + '" role="button" data-act="target" data-i="' + i + '">' +
        '<ha-icon icon="' + (on ? "mdi:check-circle" : r.local ? "mdi:tablet-dashboard" : mem.length > 1 ? "mdi:speaker-multiple" : "mdi:speaker") + '"></ha-icon>' +
        '<div class="sx"><div>' + esc(this._roomName(r)) + '</div><div class="ss">' + esc(sub) + "</div></div></div>";
    }
    h += '<div class="so" role="button" data-act="target-group"><ha-icon icon="mdi:tune-vertical-variant"></ha-icon><div class="sx"><div>Group speakers…</div></div></div>';
    var el = document.createElement("div");
    el.className = "sheet";
    el.setAttribute("data-act", "sheet-close");
    el.innerHTML = '<div class="spn">' + h + "</div>";
    this._mainEl.appendChild(el);
    this._sheetEl = el;
  };

  EchoMediaCard.prototype._closeSheet = function () {
    if (this._sheetEl && this._sheetEl.parentNode) this._sheetEl.parentNode.removeChild(this._sheetEl);
    this._sheetEl = null;
  };

  // ---------- back to the home view when nothing is playing ----------

  EchoMediaCard.prototype._touch = function () { this._lastAct = Date.now(); };

  EchoMediaCard.prototype._musicOn = function () {
    if (!this._hass) return false;
    if (this._config.stay_while === "any") {
      for (var i = 0; i < this._rooms.length; i++) if (this._isPlaying(this._rooms[i])) return true;
      return false;
    }
    return this._isPlaying(this._coord());
  };

  EchoMediaCard.prototype._startIdle = function () {
    var self = this;
    this._touch();
    if (this._idleT || !this._config.idle_timeout || !this._config.idle_path) return;
    this._idleT = setInterval(function () {
      if (self._musicOn() || self._vdrag || self._settingsEl) { self._touch(); return; }
      if (Date.now() - self._lastAct >= self._config.idle_timeout * 1000) {
        self._touch();
        if (window.location.pathname !== self._config.idle_path) navigate(self._config.idle_path);
      }
    }, 5000);
  };

  EchoMediaCard.prototype._stopIdle = function () {
    if (this._idleT) { clearInterval(this._idleT); this._idleT = null; }
  };

  // ---------- timer badges on nav buttons (same behaviour as echo-weather-card) ----------

  EchoMediaCard.prototype._timersFor = function (btn) {
    if (!btn.timers) return null;
    var pfx = this._timerPrefix || ownTimers(this._hass);
    if (!pfx) return btn.timers;
    var out = [];
    for (var i = 1; i <= 3; i++) out.push("timer." + pfx + "_" + i);
    return out;
  };

  EchoMediaCard.prototype._updateBadges = function () {
    var buttons = this._config.buttons || [];
    var st = this._hass.states;
    var info = [], sig = "";
    for (var i = 0; i < buttons.length; i++) {
      if (!buttons[i].timers) continue;
      var b = { i: i, done: false, finishes: 0, paused: 0, running: [] };
      var list = this._timersFor(buttons[i]);
      for (var j = 0; j < list.length; j++) {
        var t = st[list[j]];
        if (!t) continue;
        var nm = st["input_text." + list[j].split(".")[1] + "_name"];
        var named = nm && nm.state && nm.state !== "unknown" && nm.state !== "unavailable";
        if (t.state === "active" || t.state === "paused") b.running.push(list[j]);
        if (t.state === "active" && t.attributes.finishes_at) {
          var f = Date.parse(t.attributes.finishes_at);
          if (!b.finishes || f < b.finishes) b.finishes = f;
        } else if (t.state === "paused") {
          var r = parseHms(t.attributes.remaining);
          if (!b.paused || r < b.paused) b.paused = r;
        } else if (t.state === "idle" && named) {
          b.done = true;
        }
        sig += list[j] + t.last_updated + (nm ? nm.state : "") + "|";
      }
      info.push(b);
    }
    if (!info.length) return;
    // open_on_done / open_on_start: jump to the timers page (where the alarm rings).
    // Only react to changes seen while this page is showing: the first update after the
    // page opens just takes a snapshot (a timer started on another page isn't "new").
    var armed = !!this._runSeen && this.isConnected;
    if (!this.isConnected) { this._runSeen = null; this._doneSeen = null; }
    else if (!armed) { this._runSeen = {}; this._doneSeen = {}; }
    for (var q = 0; this.isConnected && q < info.length; q++) {
      var bt = buttons[info[q].i];
      var prevRun = this._runSeen[info[q].i];
      var started = false;
      if (prevRun) for (var r2 = 0; r2 < info[q].running.length; r2++) if (prevRun.indexOf(info[q].running[r2]) === -1) started = true;
      if (armed && bt.navigation_path && ((info[q].done && !this._doneSeen[info[q].i] && bt.open_on_done) || (started && bt.open_on_start))) {
        this._buttonTap(bt);
      }
      this._doneSeen[info[q].i] = info[q].done;
      this._runSeen[info[q].i] = info[q].running;
    }
    if (sig !== this._badgeSig) {
      this._badgeSig = sig;
      this._badges = info;
      this._paintBadges();
    }
    var anyActive = false;
    for (var k = 0; k < info.length; k++) if (info[k].finishes) anyActive = true;
    var self = this;
    if (anyActive && !this._badgeTick) this._badgeTick = setInterval(function () { self._paintBadges(); }, 1000);
    if (!anyActive && this._badgeTick) { clearInterval(this._badgeTick); this._badgeTick = null; }
  };

  // The big countdown over this page (echo-show-common's <echo-timer-overlay>). Hidden
  // while a panel (browse / speakers / queue) is open.
  EchoMediaCard.prototype._overlayTimers = function () {
    var buttons = this._config.buttons || [];
    for (var i = 0; i < buttons.length; i++) if (buttons[i].timers) return this._timersFor(buttons[i]);
    return [];
  };
  EchoMediaCard.prototype._updateOverlay = function () {
    var el = this._ovEl;
    if (!el || !el.update) return;
    var buttons = this._config.buttons || [];
    for (var i = 0; i < buttons.length; i++) if (buttons[i].timers) { el.path = buttons[i].navigation_path || null; break; }
    el.update(this._hass, this._overlayTimers());
  };

  EchoMediaCard.prototype._paintBadges = function () {
    var info = this._badges || [];
    for (var i = 0; i < info.length; i++) {
      var el = this.shadowRoot.querySelector('.bdg[data-i="' + info[i].i + '"]');
      if (!el) continue;
      var b = info[i];
      var txt = b.done ? "Done" : b.finishes ? fmtCountdown((b.finishes - Date.now()) / 1000) : b.paused ? fmtCountdown(b.paused) : "";
      if (el.textContent !== txt) el.textContent = txt;
      if (b.done !== el.classList.contains("done")) el.classList.toggle("done");
    }
  };

  EchoMediaCard._fixImg = fixImg;
  if (!customElements.get("echo-media-card")) customElements.define("echo-media-card", EchoMediaCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "echo-media-card",
    name: "Echo Media Card",
    description: "Full-screen Sonos now playing, grouping and browsing for wall tablets",
  });
  console.info("%c echo-media-card " + VERSION + " ", "background:#ff8a00;color:#000;border-radius:3px");
})();

/* ===== echo-climate-card.js ===== */
/*
 * echo-climate-card
 * Full-screen thermostat page for an Echo Show 8 kiosk, driven by the Echo Show climate
 * package (homeassistant/packages/echo_climate.yaml + echo_house.yaml):
 *  - Now: a dial with the room temperature and draggable heat/cool setpoints, what the
 *    system is doing and why (schedule, hold, away, smart recovery), hold lengths, comfort
 *    profiles, mode and fan, room sensors and today's schedule.
 *  - Schedule: the weekly program; tap a day to edit it (times on wheels, copy to days).
 *  - Comfort: the profiles' temperatures and which rooms each one follows, and options.
 *  - Insights: the last 24 hours, run time this week, learned recovery rates, the filter.
 *  - The house-mode pill (top left) shows Home / Night / Away / Vacation and opens a sheet
 *    to override presence when it acts up, and to set guests and vacation.
 *
 * Plain JavaScript, no dependencies, no build step. ES5-ish for older Chromium.
 */
(function () {
  "use strict";

  var VERSION = "1.0.2";

  function esc(s) {
    return String(s === undefined || s === null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function num(v) { var n = parseFloat(v); return isNaN(n) ? null : n; }
  function copy(o) { return JSON.parse(JSON.stringify(o === undefined ? null : o)); }
  function fmtT(v, unit) {
    if (v === null || v === undefined || isNaN(v)) return "–";
    var r = unit === "C" ? Math.round(v * 2) / 2 : Math.round(v);
    return String(r);
  }

  // ---------- which display is this? (same as the other cards) ----------
  function echoDisplayName() {
    if (window.EchoShow && window.EchoShow.displayName) return window.EchoShow.displayName();
    return Promise.resolve("");
  }
  // This display's own timer set (timer.<device>_timer_N) when Home Assistant has one.
  function ownTimers(hass) { var ES = window.EchoShow; return ES && ES.ownTimerPrefix ? ES.ownTimerPrefix(hass) : null; }
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

  // ---------- profiles ----------
  var PMETA = {
    home: { name: "Home", icon: "mdi:home-outline", color: "#ffb340" },
    wake: { name: "Wake", icon: "mdi:weather-sunset-up", color: "#ffd66b" },
    sleep: { name: "Sleep", icon: "mdi:weather-night", color: "#a291ff" },
    away: { name: "Away", icon: "mdi:home-export-outline", color: "#5cc2ff" },
    vacation: { name: "Vacation", icon: "mdi:airplane", color: "#52e0bd" },
  };
  var PORDER = ["home", "wake", "sleep", "away", "vacation"];
  var EXTRA_COLORS = ["#ff8fb1", "#9be15d", "#f6a5ff", "#7ee8fa"];
  function pmeta(key, profiles) {
    var m = PMETA[key] || {};
    var p = (profiles || {})[key] || {};
    var i = Object.keys(profiles || {}).indexOf(key);
    return {
      key: key,
      name: p.name || m.name || String(key || "").replace(/^./, function (c) { return c.toUpperCase(); }),
      icon: p.icon || m.icon || "mdi:thermostat",
      color: p.color || m.color || EXTRA_COLORS[(i < 0 ? 0 : i) % EXTRA_COLORS.length],
    };
  }
  var HEAT = "#ff7a3d", COOL = "#3aa8ff";
  var DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  var DAY_NAME = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
  var DAY_SHORT = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
  function dayKey(d) { return DAYS[(d.getDay() + 6) % 7]; }
  function hm2min(t) { var p = String(t || "0:0").split(":"); return (parseInt(p[0], 10) || 0) * 60 + (parseInt(p[1], 10) || 0); }
  function min2hm(m) { m = ((m % 1440) + 1440) % 1440; var h = Math.floor(m / 60), mm = m % 60; return (h < 10 ? "0" : "") + h + ":" + (mm < 10 ? "0" : "") + mm; }
  function sortDay(list) { return (list || []).slice().sort(function (a, b) { return hm2min(a.t) - hm2min(b.t); }); }

  var HOLD_CHOICES = [
    { id: "next", label: "Next change" },
    { id: "2h", label: "2 hours" },
    { id: "4h", label: "4 hours" },
    { id: "permanent", label: "Permanent" },
  ];

  // ---------- styles ----------
  var STYLE = [
    ":host{display:block;height:100vh;width:100%;overflow:hidden;font-family:var(--es-font,var(--ha-font-family-body,Roboto,'Helvetica Neue',Arial,sans-serif));color:#fff;-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none;}",
    ".root{position:relative;height:100vh;width:100%;overflow:hidden;box-sizing:border-box;background:var(--es-bg,radial-gradient(110% 90% at 0% 0%,#223567 0%,rgba(34,53,103,0) 60%),radial-gradient(90% 80% at 100% 100%,#0d3b4f 0%,rgba(13,59,79,0) 60%),#0a1022);}",
    ".content{position:relative;height:100vh;box-sizing:border-box;padding:2vh 2.5vh;display:flex;flex-direction:column;}",
    "ha-icon{display:inline-flex;}",
    "[role=button]{cursor:pointer;}",
    "[role=button]:active{transform:scale(.96);}",
    /* top bar */
    ".top{flex:0 0 auto;display:flex;align-items:center;justify-content:center;position:relative;height:8vh;margin-bottom:1.6vh;}",
    ".seg{display:flex;padding:.6vh;border-radius:3.4vh;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.08);}",
    ".sg{position:relative;min-width:17vh;height:6.4vh;padding:0 2.4vh;border-radius:2.8vh;display:flex;align-items:center;justify-content:center;font-size:2.9vh;color:rgba(255,255,255,.66);box-sizing:border-box;}",
    ".sg ha-icon{--mdc-icon-size:3.1vh;width:3.1vh;height:3.1vh;margin-right:1vh;}",
    ".sg.sel{background:rgba(255,255,255,.16);color:#fff;box-shadow:0 .3vh 1vh rgba(0,0,0,.25);}",
    ".sg .bdg{position:absolute;top:1vh;right:1.2vh;width:1.2vh;height:1.2vh;border-radius:50%;background:#ff6b61;display:none;}",
    ".sg .bdg.on{display:block;}",
    ".house{position:absolute;left:0;top:.6vh;height:6.8vh;padding:0 2.6vh 0 1.4vh;border-radius:3.4vh;display:flex;align-items:center;gap:1.2vh;font-size:2.8vh;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.1);max-width:34vh;box-sizing:border-box;}",
    ".house .hi{width:5vh;height:5vh;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.12);flex:0 0 auto;}",
    ".house .hi ha-icon{--mdc-icon-size:3.2vh;width:3.2vh;height:3.2vh;}",
    ".house .ht{display:flex;flex-direction:column;line-height:1.1;min-width:0;}",
    ".house .ht small{font-size:1.9vh;opacity:.6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
    ".house.ovr{border-color:rgba(var(--es-acc-rgb,255,159,10),.7);background:rgba(var(--es-acc-rgb,255,159,10),.14);}",
    ".house.ovr small{color:var(--es-hi2,#ffc266);opacity:1;}",
    ".house.away .hi{background:rgba(92,194,255,.25);color:#9bdcff;}",
    ".house.vacation .hi{background:rgba(82,224,189,.25);color:#8ff0d6;}",
    ".house.night .hi{background:rgba(162,145,255,.25);color:#c9bfff;}",
    ".tright{position:absolute;right:0;top:.6vh;display:flex;gap:1.2vh;}",
    ".save{height:6.8vh;padding:0 3.4vh;border-radius:3.4vh;display:none;align-items:center;font-size:2.9vh;font-weight:500;background:linear-gradient(180deg,var(--es-acc1,#ffab2e),var(--es-acc2,#ff8a00));color:var(--es-on-acc,#1a1000);}",
    ".save.on{display:flex;}",
    ".undo{height:6.8vh;padding:0 2.8vh;border-radius:3.4vh;display:none;align-items:center;font-size:2.7vh;background:rgba(255,255,255,.1);}",
    ".undo.on{display:flex;}",
    /* panes */
    ".pane{position:relative;flex:1 1 auto;min-height:0;display:none;}",
    ".root[data-tab=now] .p-now,.root[data-tab=schedule] .p-sched,.root[data-tab=comfort] .p-comfort,.root[data-tab=insights] .p-ins{display:flex;}",
    ".panel{border-radius:3vh;background:linear-gradient(180deg,rgba(255,255,255,.075),rgba(255,255,255,.03));border:1px solid rgba(255,255,255,.09);box-sizing:border-box;}",
    ".lbl{font-size:2.1vh;letter-spacing:.12em;text-transform:uppercase;opacity:.5;}",
    /* ===== now ===== */
    ".p-now{gap:2.4vh;}",
    ".dialw{position:relative;flex:0 0 auto;width:72vh;height:100%;display:flex;align-items:center;justify-content:center;}",
    ".dial{position:relative;width:70vh;height:70vh;flex:0 0 auto;}",
    ".dial svg{position:absolute;left:0;top:0;width:100%;height:100%;touch-action:none;overflow:visible;}",
    ".glow{position:absolute;left:12%;top:12%;width:76%;height:76%;border-radius:50%;opacity:0;transition:opacity .8s,background .8s;pointer-events:none;}",
    ".dial.heating .glow{opacity:1;background:radial-gradient(circle,rgba(255,122,61,.42) 0%,rgba(255,122,61,.12) 45%,rgba(255,122,61,0) 70%);animation:ecc-breathe 3.6s ease-in-out infinite;}",
    ".dial.cooling .glow{opacity:1;background:radial-gradient(circle,rgba(58,168,255,.42) 0%,rgba(58,168,255,.12) 45%,rgba(58,168,255,0) 70%);animation:ecc-breathe 3.6s ease-in-out infinite;}",
    "@keyframes ecc-breathe{0%,100%{transform:scale(.94);}50%{transform:scale(1.04);}}",
    ".mid{position:absolute;left:20%;top:18%;width:60%;height:60%;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none;}",
    ".act{font-size:2.5vh;letter-spacing:.16em;text-transform:uppercase;opacity:.7;display:flex;align-items:center;gap:.8vh;}",
    ".act ha-icon{--mdc-icon-size:2.8vh;width:2.8vh;height:2.8vh;}",
    ".heating .act{color:#ffb08a;opacity:1;}.cooling .act{color:#9fd4ff;opacity:1;}",
    ".big{font-size:21vh;font-weight:200;line-height:.95;letter-spacing:-.04em;font-variant-numeric:tabular-nums;position:relative;}",
    ".big sup{font-size:7vh;font-weight:300;position:absolute;top:2vh;margin-left:.4vh;opacity:.8;}",
    ".roomlbl{font-size:2.3vh;opacity:.6;margin-top:.4vh;white-space:nowrap;}",
    ".sps{display:flex;gap:1.2vh;margin-top:1.6vh;pointer-events:auto;}",
    ".sp{display:flex;align-items:center;gap:.8vh;height:6.4vh;padding:0 2vh;border-radius:3.2vh;font-size:3.4vh;font-variant-numeric:tabular-nums;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);}",
    ".sp small{font-size:1.9vh;letter-spacing:.1em;text-transform:uppercase;opacity:.7;}",
    ".sp.heat{color:#ffb08a;}.sp.cool{color:#9fd4ff;}",
    ".sp.heat.sel{background:rgba(255,122,61,.24);border-color:rgba(255,122,61,.8);}",
    ".sp.cool.sel{background:rgba(58,168,255,.24);border-color:rgba(58,168,255,.8);}",
    ".sp.pend{animation:ecc-pend 1s ease-in-out infinite;}",
    "@keyframes ecc-pend{50%{opacity:.55;}}",
    ".pm{position:absolute;bottom:4%;width:10vh;height:10vh;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.14);}",
    ".pm ha-icon{--mdc-icon-size:5.4vh;width:5.4vh;height:5.4vh;}",
    ".pm.minus{left:15%;}.pm.plus{right:15%;}",
    ".pm.off{opacity:.25;pointer-events:none;}",
    ".offmsg{font-size:3vh;opacity:.6;margin-top:1vh;}",
    /* right column */
    ".side{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:1.6vh;}",
    ".status{padding:2vh 2.6vh;display:flex;gap:2vh;align-items:center;}",
    ".status .si{flex:0 0 auto;width:8vh;height:8vh;border-radius:2.4vh;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.1);}",
    ".status .si ha-icon{--mdc-icon-size:4.6vh;width:4.6vh;height:4.6vh;}",
    ".status .st{flex:1 1 auto;min-width:0;}",
    ".status .t1{font-size:3.4vh;line-height:1.15;}",
    ".status .t2{font-size:2.4vh;opacity:.68;margin-top:.6vh;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
    ".status .t2 b{font-weight:500;opacity:1;color:#fff;}",
    ".resume{flex:0 0 auto;height:7.4vh;padding:0 3vh;border-radius:3.7vh;display:flex;align-items:center;gap:1vh;font-size:2.8vh;font-weight:500;background:linear-gradient(180deg,var(--es-acc1,#ffab2e),var(--es-acc2,#ff8a00));color:var(--es-on-acc,#1a1000);}",
    ".resume ha-icon{--mdc-icon-size:3.2vh;width:3.2vh;height:3.2vh;}",
    ".row{display:flex;align-items:center;gap:1.2vh;}",
    ".row .lbl{width:11vh;flex:0 0 auto;}",
    ".chips{display:flex;gap:1vh;flex:1 1 auto;min-width:0;}",
    ".chip{flex:1 1 0;min-width:0;height:6.6vh;padding:0 1.2vh;box-sizing:border-box;border-radius:3.3vh;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);display:flex;align-items:center;justify-content:center;gap:.8vh;font-size:2.5vh;white-space:nowrap;overflow:hidden;}",
    ".chip ha-icon{--mdc-icon-size:2.9vh;width:2.9vh;height:2.9vh;flex:0 0 auto;}",
    ".chip.sel{background:rgba(var(--es-acc-rgb,255,159,10),.2);border-color:rgba(var(--es-acc-rgb,255,159,10),.7);color:var(--es-hi2,#ffc266);}",
    ".chip.prof.sel{background:rgba(var(--pc-rgb),.2);border-color:rgba(var(--pc-rgb),.75);color:var(--pc);}",
    ".chip.dis{opacity:.35;pointer-events:none;}",
    ".chip.m-heat.sel{background:rgba(255,122,61,.22);border-color:rgba(255,122,61,.8);color:#ffb08a;}",
    ".chip.m-cool.sel{background:rgba(58,168,255,.22);border-color:rgba(58,168,255,.8);color:#9fd4ff;}",
    ".chip.m-heat_cool.sel{background:linear-gradient(90deg,rgba(255,122,61,.22),rgba(58,168,255,.22));border-color:rgba(255,255,255,.5);color:#fff;}",
    ".chip.m-off.sel{background:rgba(255,255,255,.2);border-color:rgba(255,255,255,.5);color:#fff;}",
    ".rooms{display:flex;gap:1.2vh;}",
    ".room{flex:1 1 0;min-width:0;padding:1.4vh 1.8vh;border-radius:2.4vh;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);}",
    ".room .rn{font-size:2vh;opacity:.6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:.6vh;}",
    ".room .rn ha-icon{--mdc-icon-size:2.2vh;width:2.2vh;height:2.2vh;}",
    ".room .rv{font-size:4.2vh;font-weight:300;font-variant-numeric:tabular-nums;line-height:1.15;}",
    ".room .rv small{font-size:2.1vh;opacity:.6;margin-left:1vh;font-weight:400;}",
    ".room.used{border-color:rgba(var(--es-acc-rgb,255,159,10),.55);}",
    ".room.used .rn{color:var(--es-hi2,#ffc266);opacity:.95;}",
    ".room.dead .rv{font-size:2.3vh;line-height:1.3;opacity:.55;padding-top:.7vh;}",
    /* today strip */
    ".today{position:relative;padding:1.4vh 2vh 1.2vh;}",
    ".tbar{position:relative;height:4.6vh;border-radius:1.4vh;overflow:hidden;background:rgba(255,255,255,.05);margin-top:1vh;}",
    ".tseg{position:absolute;top:0;bottom:0;display:flex;align-items:center;padding-left:1vh;box-sizing:border-box;font-size:2vh;color:rgba(0,0,0,.78);font-weight:500;white-space:nowrap;overflow:hidden;border-right:2px solid rgba(10,16,34,.6);}",
    ".tnow{position:absolute;top:-.6vh;bottom:-.6vh;width:.5vh;margin-left:-.25vh;background:#fff;border-radius:.3vh;box-shadow:0 0 1vh rgba(255,255,255,.8);}",
    ".tax{position:relative;height:2.4vh;margin-top:.6vh;font-size:1.8vh;opacity:.45;}",
    ".tax span{position:absolute;transform:translateX(-50%);white-space:nowrap;}.tax span:last-child{transform:translateX(-100%);}",
    /* ===== schedule ===== */
    ".p-sched{flex-direction:column;gap:1vh;}",
    ".sh{display:flex;align-items:flex-end;}",
    ".sh .dl{width:14vh;flex:0 0 auto;}",
    ".sh .ax{position:relative;flex:1 1 auto;height:2.6vh;font-size:1.9vh;opacity:.5;}",
    ".sh .ax span{position:absolute;transform:translateX(-50%);white-space:nowrap;}",
    ".srow{display:flex;align-items:center;flex:1 1 0;min-height:0;}",
    ".srow .dl{width:14vh;flex:0 0 auto;font-size:2.8vh;}",
    ".srow .dl.tdy{color:var(--es-hi,#ffb340);font-weight:500;}",
    ".sbar{position:relative;flex:1 1 auto;height:78%;border-radius:1.8vh;overflow:hidden;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.07);}",
    ".sseg{position:absolute;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center;padding-left:1.2vh;box-sizing:border-box;color:rgba(0,0,0,.8);white-space:nowrap;overflow:hidden;border-right:2px solid rgba(10,16,34,.55);}",
    ".sseg b{font-size:2.2vh;font-weight:600;}.sseg i{font-style:normal;font-size:1.8vh;opacity:.75;}",
    ".sedit{width:7vh;flex:0 0 auto;display:flex;justify-content:flex-end;opacity:.5;}",
    ".sedit ha-icon{--mdc-icon-size:3.4vh;width:3.4vh;height:3.4vh;}",
    ".legend{display:flex;gap:2.4vh;justify-content:center;font-size:2.2vh;opacity:.8;padding-top:.4vh;}",
    ".legend span{display:flex;align-items:center;gap:.8vh;}",
    ".legend i{width:2vh;height:2vh;border-radius:.6vh;display:inline-block;}",
    /* day editor sheet */
    ".sheet{position:absolute;left:0;top:0;right:0;bottom:0;z-index:30;display:flex;align-items:center;justify-content:center;background:rgba(3,6,14,.62);}",
    ".sbox{width:92vw;max-height:94vh;box-sizing:border-box;display:flex;flex-direction:column;background:linear-gradient(180deg,var(--es-pan1,#1c2540),var(--es-pan2,#141b30));border:1px solid rgba(255,255,255,.1);border-radius:3.4vh;box-shadow:0 20px 60px rgba(0,0,0,.6);overflow:hidden;}",
    ".shd{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;padding:2.2vh 2.8vh 1vh;}",
    ".shd h2{margin:0;font-size:3.8vh;font-weight:500;}",
    ".sbtn{font-size:3.1vh;padding:1.4vh 2.6vh;border-radius:3.2vh;color:var(--es-hi,#ffb340);justify-self:start;}",
    ".sbtn.ok{justify-self:end;background:linear-gradient(180deg,var(--es-acc1,#ffab2e),var(--es-acc2,#ff8a00));color:var(--es-on-acc,#1a1000);font-weight:500;padding:1.4vh 3.6vh;}",
    ".sbtn.wait{opacity:.5;pointer-events:none;}",
    ".sbody{display:flex;gap:3vh;padding:1vh 3vh 2.6vh;min-height:0;}",
    ".plist{flex:0 0 46vh;display:flex;flex-direction:column;gap:1vh;overflow-y:auto;max-height:62vh;touch-action:pan-y;}",
    ".pitem{display:flex;align-items:center;gap:1.4vh;padding:1.2vh 1.6vh;border-radius:2.2vh;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);}",
    ".pitem.sel{background:rgba(var(--es-acc-rgb,255,159,10),.16);border-color:rgba(var(--es-acc-rgb,255,159,10),.65);}",
    ".pitem .pt{font-size:4vh;font-weight:300;font-variant-numeric:tabular-nums;width:17vh;}",
    ".pitem .pt small{font-size:2.2vh;margin-left:.6vh;}",
    ".pitem .pp{flex:1 1 auto;display:flex;align-items:center;gap:.8vh;font-size:2.7vh;}",
    ".pitem .pp i{width:1.8vh;height:1.8vh;border-radius:50%;display:inline-block;}",
    ".pitem .px{width:6vh;height:6vh;display:flex;align-items:center;justify-content:center;color:#ff6961;}",
    ".pitem .px ha-icon{--mdc-icon-size:3.6vh;width:3.6vh;height:3.6vh;}",
    ".padd{display:flex;align-items:center;justify-content:center;gap:1vh;height:7vh;border-radius:2.2vh;border:1px dashed rgba(255,255,255,.25);font-size:2.7vh;opacity:.85;flex:0 0 auto;}",
    ".pedit{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2.2vh;}",
    ".pedit .wheels{display:flex;justify-content:center;gap:1vh;position:relative;--ww:13vh;--wrow:7vh;--wfs:5vh;}",
    ".wheels::before{content:'';position:absolute;left:0;right:0;top:50%;height:var(--wrow,6.6vh);margin-top:calc(var(--wrow,6.6vh) / -2);border-radius:1.8vh;background:rgba(255,255,255,.1);pointer-events:none;}",
    ".wheel{position:relative;height:calc(var(--wrow,6.6vh) * 5);width:var(--ww,13vh);touch-action:none;cursor:ns-resize;overflow:hidden;-webkit-mask-image:linear-gradient(180deg,transparent 0,#000 30%,#000 70%,transparent 100%);mask-image:linear-gradient(180deg,transparent 0,#000 30%,#000 70%,transparent 100%);}",
    ".wi{position:absolute;left:0;right:0;top:50%;text-align:center;font-size:var(--wfs,4.4vh);font-variant-numeric:tabular-nums;color:rgba(255,255,255,.9);will-change:transform;}",
    ".wheel.ampm{width:11vh;}",
    ".pchips{display:flex;flex-wrap:wrap;gap:1vh;}",
    ".pchips .chip{flex:0 0 auto;min-width:15vh;}",
    ".copy{display:flex;align-items:center;gap:1vh;flex-wrap:wrap;}",
    ".dchip{width:6.6vh;height:6.6vh;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:2.6vh;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.1);}",
    ".dchip.on{background:var(--es-acc,#ff9f0a);border-color:transparent;color:var(--es-on-acc,#1a1000);font-weight:500;}",
    ".dchip.self{opacity:.35;pointer-events:none;}",
    ".copy .chip{flex:0 0 auto;height:5.8vh;font-size:2.3vh;}",
    /* ===== comfort ===== */
    ".p-comfort{flex-direction:column;gap:1.8vh;}",
    ".profs{display:flex;gap:1.6vh;flex:1 1 auto;min-height:0;}",
    ".pcard{flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:1.4vh;padding:2vh;border-top:.6vh solid var(--pc);}",
    ".pcard .ph{display:flex;align-items:center;gap:1vh;font-size:3vh;color:var(--pc);}",
    ".pcard .ph ha-icon{--mdc-icon-size:3.4vh;width:3.4vh;height:3.4vh;}",
    ".stp{display:flex;align-items:center;justify-content:space-between;}",
    ".stp .sl{font-size:1.9vh;letter-spacing:.1em;text-transform:uppercase;opacity:.6;}",
    ".stp .sv{font-size:5.4vh;font-weight:300;font-variant-numeric:tabular-nums;line-height:1;}",
    ".stp.heat .sv{color:#ffb08a;}.stp.cool .sv{color:#9fd4ff;}",
    ".stp .pmb{display:flex;gap:.8vh;}",
    ".stp .pmb div{width:6vh;height:6vh;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.1);}",
    ".stp .pmb ha-icon{--mdc-icon-size:3.4vh;width:3.4vh;height:3.4vh;}",
    ".pcard .rs{display:flex;flex-wrap:wrap;gap:.8vh;margin-top:auto;}",
    ".pcard .rs .chip{flex:0 0 auto;height:5vh;font-size:2.1vh;padding:0 1.4vh;}",
    ".opts{display:flex;gap:1.6vh;flex:0 0 auto;}",
    ".opt{flex:1 1 0;min-width:0;display:flex;align-items:center;gap:1.6vh;padding:1.8vh 2.2vh;}",
    ".opt .ot{flex:1 1 auto;min-width:0;}",
    
    ".opt .o1{font-size:2.5vh;line-height:1.15;}.opt .o2{font-size:1.9vh;opacity:.6;margin-top:.4vh;line-height:1.3;}",
    ".tg{flex:0 0 auto;position:relative;width:11vh;height:6.6vh;border-radius:3.3vh;background:rgba(255,255,255,.18);transition:background .2s;}",
    ".tg::after{content:'';position:absolute;top:.6vh;left:.6vh;width:5.4vh;height:5.4vh;border-radius:50%;background:#fff;box-shadow:0 .3vh .8vh rgba(0,0,0,.35);transition:transform .2s;}",
    ".tg.on{background:#34c759;}.tg.on::after{transform:translateX(4.4vh);}",
    ".opt.wide{flex:2.3 1 0;}",
    ".opt .chips .chip{height:5.8vh;font-size:2.2vh;padding:0 .8vh;}",
    /* ===== insights ===== */
    ".p-ins{gap:1.8vh;}",
    ".chart{flex:1.55 1 0;min-width:0;display:flex;flex-direction:column;padding:2vh 2.4vh;}",
    ".chart .ch{display:flex;align-items:center;gap:2.4vh;}",
    ".chart .ch .lbl{flex:1 1 auto;}",
    ".key{display:flex;align-items:center;gap:.8vh;font-size:1.9vh;opacity:.8;}",
    ".key i{width:2.4vh;height:.6vh;border-radius:.3vh;display:inline-block;}",
    ".chart svg{flex:1 1 auto;width:100%;min-height:0;margin-top:1vh;}",
    ".icol{flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:1.6vh;}",
    ".ibox{padding:1.8vh 2.2vh;}",
    ".bars{display:flex;align-items:flex-end;gap:1.2vh;height:16vh;margin-top:1.4vh;}",
    ".bar{flex:1 1 0;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;gap:.4vh;}",
    ".bar .bs{width:70%;display:flex;flex-direction:column-reverse;border-radius:.8vh;overflow:hidden;min-height:.4vh;background:rgba(255,255,255,.06);}",
    ".bar .bh{background:" + HEAT + ";}.bar .bc{background:" + COOL + ";}",
    ".bar .bl{font-size:1.8vh;opacity:.55;}",
    ".bar .bv{font-size:1.7vh;opacity:.75;font-variant-numeric:tabular-nums;}",
    ".bar.today .bl{color:var(--es-hi,#ffb340);opacity:1;}",
    ".ist{display:flex;gap:2vh;margin-top:1vh;}",
    ".ist div{flex:1 1 0;}",
    ".ist b{display:block;font-size:4vh;font-weight:300;font-variant-numeric:tabular-nums;}",
    ".ist span{font-size:1.9vh;opacity:.6;}",
    ".fbar{position:relative;height:2.2vh;border-radius:1.1vh;background:rgba(255,255,255,.08);overflow:hidden;margin:1.2vh 0 1vh;}",
    ".fbar div{position:absolute;left:0;top:0;bottom:0;border-radius:1.1vh;background:linear-gradient(90deg,#34c759,#ffd60a,#ff6b61);}",
    ".frow{display:flex;align-items:center;gap:1.6vh;font-size:2.3vh;}",
    ".frow .ft{flex:1 1 auto;opacity:.75;}",
    ".fdone{white-space:nowrap;flex:0 0 auto;height:6vh;padding:0 2.4vh;border-radius:3vh;display:flex;align-items:center;font-size:2.4vh;background:rgba(255,255,255,.12);}",
    ".fdone.due{background:linear-gradient(180deg,var(--es-acc1,#ffab2e),var(--es-acc2,#ff8a00));color:var(--es-on-acc,#1a1000);font-weight:500;}",
    ".loading{display:flex;align-items:center;justify-content:center;flex:1 1 auto;opacity:.45;font-size:2.6vh;}",
    /* house sheet */
    ".hbox{width:84vw;}",
    ".hb{display:flex;gap:3vh;padding:1vh 3vh 3vh;}",
    ".hcol{flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:2vh;}",
    ".hnow{display:flex;align-items:center;gap:2vh;}",
    ".hnow .hi{width:11vh;height:11vh;border-radius:3vh;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.1);}",
    ".hnow .hi ha-icon{--mdc-icon-size:6.4vh;width:6.4vh;height:6.4vh;}",
    ".hnow b{display:block;font-size:4.6vh;font-weight:400;}",
    ".hnow span{font-size:2.5vh;opacity:.65;}",
    ".people{display:flex;flex-direction:column;gap:1vh;}",
    ".person{display:flex;align-items:center;gap:1.4vh;font-size:2.8vh;padding:1.2vh 1.6vh;border-radius:2vh;background:rgba(255,255,255,.05);}",
    ".person ha-icon{--mdc-icon-size:3.4vh;width:3.4vh;height:3.4vh;opacity:.8;}",
    ".person .ps{margin-left:auto;font-size:2.3vh;opacity:.7;}",
    ".person.home .ps{color:#7ff09a;opacity:1;}",
    ".person.unknown .ps{color:#ffd60a;opacity:1;}",
    ".hrow{display:flex;align-items:center;gap:1.6vh;}",
    ".hrow .ot{flex:1 1 auto;}",
    ".hrow .o1{font-size:2.8vh;}.hrow .o2{font-size:2vh;opacity:.6;margin-top:.3vh;}",
    ".hnote{font-size:2.1vh;line-height:1.35;opacity:.55;}",
    /* toast */
    ".toast{position:absolute;left:50%;bottom:16vh;z-index:40;transform:translate(-50%,2vh);max-width:80vw;padding:2vh 3.2vh;border-radius:2.4vh;background:rgba(20,24,38,.96);border:1px solid rgba(255,255,255,.14);font-size:2.8vh;line-height:1.3;opacity:0;pointer-events:none;transition:opacity .25s,transform .25s;box-shadow:0 1vh 3vh rgba(0,0,0,.5);}",
    ".toast.on{opacity:1;transform:translate(-50%,0);}",
    /* bottom buttons */
    ".btns{display:flex;gap:1.5vh;margin-top:2vh;height:9vh;flex:0 0 auto;}",
    ".btn{flex:1 1 0;border-radius:1.6vh;background:rgba(255,255,255,.1);display:flex;align-items:center;justify-content:center;}",
    ".btn.active{background:rgba(255,255,255,.24);}",
    ".btn ha-icon{--mdc-icon-size:5vh;width:5vh;height:5vh;color:rgba(255,255,255,.9);}",
    ".btn .bdg{margin-left:1.2vh;font-size:3.8vh;line-height:1;font-variant-numeric:tabular-nums;color:var(--es-hi,#ffb340);white-space:nowrap;}",
    ".btn .bdg:empty{display:none;}",
    ".btn .bdg.done{color:#ff6b61;animation:ecc-blink 1s steps(1) infinite;}",
    "@keyframes ecc-blink{50%{opacity:.25;}}",
  ].join("");

  var TABS = [
    { id: "now", icon: "mdi:thermostat", label: "Now" },
    { id: "schedule", icon: "mdi:calendar-week", label: "Schedule" },
    { id: "comfort", icon: "mdi:tune-variant", label: "Comfort" },
    { id: "insights", icon: "mdi:chart-timeline-variant", label: "Insights" },
  ];

  function hexRgb(h) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h || "");
    return m ? parseInt(m[1], 16) + "," + parseInt(m[2], 16) + "," + parseInt(m[3], 16) : "255,255,255";
  }

  // ---------- the card ----------
  function EchoClimateCard() {
    var self = Reflect.construct(HTMLElement, [], new.target || EchoClimateCard);
    self._hass = null;
    self._draft = null;          // setpoints being dragged / waiting for the thermostat
    self._sel = null;            // which setpoint the +/- buttons change: "heat" | "cool"
    self._tab = null;
    ["touchstart", "touchmove", "touchend", "touchcancel"].forEach(function (type) {
      self.addEventListener(type, function (ev) { ev.stopPropagation(); });
    });
    return self;
  }
  EchoClimateCard.prototype = Object.create(HTMLElement.prototype);
  EchoClimateCard.prototype.constructor = EchoClimateCard;
  Object.setPrototypeOf(EchoClimateCard, HTMLElement);

  EchoClimateCard.prototype.setConfig = function (config) {
    if (!config || !config.entity) throw new Error("echo-climate-card: set entity (your climate.* thermostat)");
    this._raw = config;
    this._apply(null);
    if (!this._devL) {   // this display's device (own timers, area) becomes known after the first render
      this._devL = true;
      var me = this;
      window.addEventListener("echo-show-device", function () { if (me._hass) { me._badgeSig = ""; me._sig = ""; me.hass = me._hass; } });
    }
    var self = this;
    echoDisplayName().then(function (name) {
      var prof = matchDisplay(config.devices, name);
      if (prof) { self._apply(prof); self._sig = ""; if (self._built && self._hass) self._update(); }
    });
  };

  EchoClimateCard.prototype._apply = function (prof) {
    var c = {}, k;
    for (k in this._raw) c[k] = this._raw[k];
    if (prof) for (k in prof) if (k !== "match") c[k] = prof[k];
    this._config = {
      entity: c.entity,
      plan: c.plan || "sensor.echo_climate_plan",
      settings: c.settings || "sensor.echo_climate_settings",
      house: c.house || "sensor.echo_house_mode",
      house_settings: c.house_settings || "sensor.echo_house_settings",
      hold_script: c.hold_script || "echo_climate_hold",
      set_script: c.set_script || "echo_climate_set",
      house_script: c.house_script || "echo_house_set",
      outdoor: c.outdoor || null,
      timer_prefix: c.timer_prefix || null,
      buttons: c.buttons || [],
      idle_timeout: c.idle_timeout !== undefined ? c.idle_timeout : 0,
      idle_path: c.idle_path || null,
      tabs: c.tabs || ["now", "schedule", "comfort", "insights"],
    };
  };

  EchoClimateCard.prototype.getCardSize = function () { return 12; };

  Object.defineProperty(EchoClimateCard.prototype, "hass", {
    set: function (hass) {
      this._hass = hass;
      if (!this._config) return;
      if (!this._built) this._build();
      this._update();
      if (this._settingsEl) this._settingsEl.hass = hass;
    },
    get: function () { return this._hass; },
  });

  EchoClimateCard.prototype.connectedCallback = function () {
    if (this._built) { this._sig = ""; this._update(); }
    this._startIdle();
  };
  EchoClimateCard.prototype.disconnectedCallback = function () {
    this._stopIdle();
    this._closeSheet();
    this._runSeen = null; this._doneSeen = null;
    if (this._badgeTick) { clearInterval(this._badgeTick); this._badgeTick = null; }
    if (this._settingsEl) this._settingsEl.close();
  };

  // ---------- state helpers ----------
  EchoClimateCard.prototype._st = function (id) { return id && this._hass ? this._hass.states[id] : null; };
  EchoClimateCard.prototype._plan = function () {
    var s = this._st(this._config.plan);
    return s && s.attributes && s.attributes.plan && typeof s.attributes.plan === "object" ? s.attributes.plan : {};
  };
  EchoClimateCard.prototype._store = function () {
    var s = this._st(this._config.settings);
    return s ? s.attributes || {} : {};
  };
  EchoClimateCard.prototype._unit = function () {
    var c = this._st(this._config.entity);
    var u = this._hass && this._hass.config && this._hass.config.unit_system ? this._hass.config.unit_system.temperature : null;
    if (u) return /C/.test(u) ? "C" : "F";
    return c && c.attributes.max_temp > 45 ? "F" : "C";
  };
  EchoClimateCard.prototype._step = function () {
    var c = this._st(this._config.entity);
    var o = this._store().options || {};
    return (c && c.attributes.target_temp_step) || o.step || (this._unit() === "C" ? 0.5 : 1);
  };
  EchoClimateCard.prototype._diff = function () {
    var o = this._store().options || {};
    return o.differential || (this._unit() === "C" ? 1.5 : 3);
  };
  EchoClimateCard.prototype._h24 = function () {
    var l = this._hass && this._hass.locale;
    if (l && l.time_format === "24") return true;
    if (l && l.time_format === "12") return false;
    try { return !/[ap]m/i.test(new Date(2020, 0, 1, 15).toLocaleTimeString(l && l.language || undefined)); } catch (e) { return false; }
  };
  EchoClimateCard.prototype._fmtTime = function (d, short) {
    if (!(d instanceof Date)) d = new Date(d);
    if (isNaN(d)) return "";
    var h = d.getHours(), m = d.getMinutes();
    if (this._h24()) return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
    var ap = h >= 12 ? "PM" : "AM";
    h = h % 12; if (h === 0) h = 12;
    if (short && m === 0) return h + " " + ap;
    return h + ":" + (m < 10 ? "0" : "") + m + " " + ap;
  };
  EchoClimateCard.prototype._fmtHM = function (hm, short) {
    var d = new Date(2020, 0, 1); var m = hm2min(hm);
    d.setHours(Math.floor(m / 60), m % 60, 0, 0);
    return this._fmtTime(d, short);
  };
  // "8:30 AM", "tomorrow 6:30 AM", "Sat 7:30 AM"
  EchoClimateCard.prototype._fmtWhen = function (iso) {
    var d = new Date(iso);
    if (isNaN(d)) return "";
    var now = new Date();
    var day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    var dd = Math.floor((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - day0) / 864e5);
    var t = this._fmtTime(d);
    if (dd === 0) return t;
    if (dd === 1) return "tomorrow " + t;
    return DAY_SHORT[dayKey(d)] + " " + t;
  };

  EchoClimateCard.prototype._call = function (script, data) {
    var self = this;
    return this._hass.callService("script", script, data).catch(function (e) {
      self._toast("Couldn't reach Home Assistant: " + (e && e.message ? e.message : "error"));
      throw e;
    });
  };

  // ---------- DOM ----------
  EchoClimateCard.prototype._build = function () {
    var root = this.shadowRoot || this.attachShadow({ mode: "open" });
    var cfg = this._config, buttons = cfg.buttons;
    var btnHtml = "";
    for (var i = 0; i < buttons.length; i++) {
      btnHtml += '<div class="btn' + (buttons[i].active ? " active" : "") + '" role="button" data-i="' + i + '"><ha-icon icon="' + esc(buttons[i].icon || "mdi:help") + '"></ha-icon>' +
        (buttons[i].timers ? '<span class="bdg" data-i="' + i + '"></span>' : "") + "</div>";
    }
    var seg = "";
    TABS.forEach(function (t) {
      if (cfg.tabs.indexOf(t.id) === -1) return;
      seg += '<div class="sg" role="button" data-tab="' + t.id + '"><ha-icon icon="' + t.icon + '"></ha-icon>' + t.label + '<span class="bdg"></span></div>';
    });
    root.innerHTML = "<style>" + STYLE + "</style>" +
      '<div class="root"><div class="content">' +
      '<div class="top"><div class="house" role="button"></div>' +
      (cfg.tabs.length > 1 ? '<div class="seg">' + seg + "</div>" : "") +
      '<div class="tright"><div class="undo" role="button">Undo</div><div class="save" role="button">Save</div></div></div>' +
      '<div class="pane p-now"></div><div class="pane p-sched"></div><div class="pane p-comfort"></div><div class="pane p-ins"></div>' +
      (buttons.length ? '<div class="btns">' + btnHtml + "</div>" : "") +
      '</div><echo-timer-overlay hidden auto-pos="top-right"></echo-timer-overlay><div class="toast"></div></div>';
    this._rootEl = root.querySelector(".root");
    this._houseEl = root.querySelector(".house");
    this._nowEl = root.querySelector(".p-now");
    this._schedEl = root.querySelector(".p-sched");
    this._comfEl = root.querySelector(".p-comfort");
    this._insEl = root.querySelector(".p-ins");
    this._toastEl = root.querySelector(".toast");
    this._saveEl = root.querySelector(".save");
    this._undoEl = root.querySelector(".undo");
    this._ovEl = root.querySelector("echo-timer-overlay");
    var self = this;

    root.addEventListener("pointerdown", function () { self._touch(); }, true);
    var segEl = root.querySelector(".seg");
    if (segEl) segEl.addEventListener("click", function (ev) {
      var t = ev.target.closest ? ev.target.closest(".sg") : null;
      if (t) self._setTab(t.getAttribute("data-tab"), true);
    });
    this._houseEl.addEventListener("click", function () { self._openHouse(); });
    this._saveEl.addEventListener("click", function () { self._saveComfort(); });
    this._undoEl.addEventListener("click", function () { self._comfDraft = null; self._renderComfort(); });

    this._nowEl.addEventListener("click", function (ev) { self._nowClick(ev); });
    this._bindDial();
    this._schedEl.addEventListener("click", function (ev) {
      var t = ev.target.closest ? ev.target.closest("[data-day]") : null;
      if (t) self._openDay(t.getAttribute("data-day"));
    });
    this._comfEl.addEventListener("click", function (ev) { self._comfClick(ev); });
    this._insEl.addEventListener("click", function (ev) {
      var t = ev.target.closest ? ev.target.closest("[data-a]") : null;
      if (t && t.getAttribute("data-a") === "filter") self._filterDone();
    });

    var btnEls = root.querySelectorAll(".btn");
    for (var b = 0; b < btnEls.length; b++) {
      btnEls[b].addEventListener("click", function (ev) {
        self._buttonTap(buttons[parseInt(ev.currentTarget.getAttribute("data-i"), 10)]);
      });
    }
    this._built = true;
    var p = window.EchoShow && window.EchoShow.prefs ? window.EchoShow.prefs.get("climate_tab") : null;
    this._setTab(p || cfg.tabs[0], false);
  };

  EchoClimateCard.prototype._buttonTap = function (btn) {
    if (!btn) return;
    if (btn.action === "settings" || btn.action === "timer-settings") {
      if (window.EchoShow && window.EchoShow.openSettings) window.EchoShow.openSettings(this, { timers: this._overlayTimers() });
    } else if (btn.navigation_path) navigate(btn.navigation_path);
    else if (btn.url) window.open(btn.url, "_self");
  };

  EchoClimateCard.prototype._setTab = function (id, user) {
    if (this._config.tabs.indexOf(id) === -1) id = this._config.tabs[0];
    if (user && window.EchoShow && window.EchoShow.prefs) window.EchoShow.prefs.set("climate_tab", id);
    this._tab = id;
    this._rootEl.setAttribute("data-tab", id);
    var sgs = this.shadowRoot.querySelectorAll(".sg");
    for (var i = 0; i < sgs.length; i++) {
      var on = sgs[i].getAttribute("data-tab") === id;
      if (on !== sgs[i].classList.contains("sel")) sgs[i].classList.toggle("sel");
    }
    this._sig = "";
    this._paintTopRight();
    this._update();
    if (id === "insights") this._loadHistory(false);
  };

  EchoClimateCard.prototype._toast = function (msg) {
    var el = this._toastEl;
    if (!el) return;
    el.textContent = msg;
    el.classList.add("on");
    clearTimeout(this._toastT);
    this._toastT = setTimeout(function () { el.classList.remove("on"); }, 3200);
  };

  // ---------- updates ----------
  EchoClimateCard.prototype._update = function () {
    if (!this._hass || !this._built) return;
    var c = this._st(this._config.entity);
    var pl = this._st(this._config.plan), se = this._st(this._config.settings);
    var ho = this._st(this._config.house), hs = this._st(this._config.house_settings);
    var store = this._store(), rooms = store.rooms || [];
    var sig = [c && c.last_updated, pl && pl.last_updated, se && se.last_updated, ho && ho.last_updated, hs && hs.last_updated, this._tab, Math.floor(Date.now() / 60000)];
    for (var i = 0; i < rooms.length; i++) {
      var r = this._st(rooms[i].entity), rh = this._st(rooms[i].humidity);
      sig.push(r ? r.state : "", rh ? rh.state : "");
    }
    var od = this._st(this._config.outdoor); sig.push(od ? od.last_updated : "");
    var ps = this._hass.states;
    for (var k in ps) if (k.indexOf("person.") === 0) sig.push(k + ps[k].state);
    sig = sig.join("|");
    this._updateBadges();
    this._updateOverlay();
    if (sig === this._sig) return;
    this._sig = sig;
    // a draft is done once the thermostat reports it (or after a while)
    if (this._draft && !this._draft.dragging && Date.now() - this._draft.at > 2500 && c) {
      var a = c.attributes, dr = this._draft, done = Date.now() - dr.at > 15000;
      if (c.state === "heat_cool" && a.target_temp_low === dr.low && a.target_temp_high === dr.high) done = true;
      if (c.state === "heat" && a.temperature === dr.low) done = true;
      if (c.state === "cool" && a.temperature === dr.high) done = true;
      if (done) this._draft = null;
    }
    this._paintHouse();
    if (this._houseSheet) this._paintHouseSheet();
    if (this._tab === "now") this._renderNow();
    else if (this._tab === "schedule") this._renderSched();
    else if (this._tab === "comfort") this._renderComfort();
    else if (this._tab === "insights") this._renderIns();
    this._paintTabBadges();
  };

  EchoClimateCard.prototype._paintTabBadges = function () {
    var f = this._store().filter || {};
    var due = (f.hours || 0) >= (f.limit || 300);
    var el = this.shadowRoot.querySelector('.sg[data-tab="insights"] .bdg');
    if (el && due !== el.classList.contains("on")) el.classList.toggle("on");
  };

  // ---------- house pill + sheet ----------
  var HOUSE = {
    home: { icon: "mdi:home", name: "Home" },
    night: { icon: "mdi:weather-night", name: "Night" },
    away: { icon: "mdi:home-export-outline", name: "Away" },
    vacation: { icon: "mdi:airplane", name: "Vacation" },
  };

  EchoClimateCard.prototype._paintHouse = function () {
    var h = this._st(this._config.house);
    var el = this._houseEl;
    if (!h) { el.style.display = "none"; return; }
    el.style.display = "";
    var m = HOUSE[h.state] || { icon: "mdi:home-question-outline", name: h.state };
    var a = h.attributes || {};
    var sub = a.override && a.override !== "auto" ? "Set by hand" : a.source === "vacation" ? "Vacation mode" : (a.reason || "Automatic");
    var html = '<div class="hi"><ha-icon icon="' + m.icon + '"></ha-icon></div><div class="ht">' + esc(m.name) + "<small>" + esc(sub) + "</small></div>";
    if (html !== this._houseHtml) { el.innerHTML = html; this._houseHtml = html; }
    el.className = "house " + h.state + (a.override && a.override !== "auto" ? " ovr" : "");
  };

  EchoClimateCard.prototype._openHouse = function () {
    if (!this._st(this._config.house)) return;
    this._closeSheet();
    var sh = document.createElement("div");
    sh.className = "sheet";
    sh.innerHTML = '<div class="sbox hbox"><div class="shd"><div></div><h2>House</h2><div class="sbtn ok" role="button" data-h="close">Done</div></div><div class="hb"></div></div>';
    var self = this;
    sh.addEventListener("click", function (ev) {
      if (ev.target === sh) { self._closeSheet(); return; }
      var t = ev.target.closest ? ev.target.closest("[data-h]") : null;
      if (!t) return;
      var a = t.getAttribute("data-h"), v = t.getAttribute("data-v");
      if (a === "close") self._closeSheet();
      else if (a === "ovr") self._call(self._config.house_script, { override: v });
      else if (a === "until") self._call(self._config.house_script, { override_until: v });
      else if (a === "guests" || a === "vacation" || a === "night") {
        var hs = self._st(self._config.house_settings), d = {};
        var cur = hs && hs.attributes ? hs.attributes[a] : false;
        d[a] = a === "night" ? cur === false : cur !== true;
        self._call(self._config.house_script, d);
      }
    });
    this._rootEl.appendChild(sh);
    this._houseSheet = sh;
    this._paintHouseSheet();
  };

  EchoClimateCard.prototype._paintHouseSheet = function () {
    var sh = this._houseSheet;
    if (!sh) return;
    var h = this._st(this._config.house), hs = this._st(this._config.house_settings);
    if (!h) return;
    var a = h.attributes || {}, s = hs ? hs.attributes || {} : {};
    var m = HOUSE[h.state] || { icon: "mdi:home", name: h.state };
    var ov = s.override || a.override || "auto", until = s.override_until || a.override_until || "manual";
    var people = [].concat(a.people_home || [], a.people_away || [], a.people_unknown || []);
    var self = this;
    var ppl = people.map(function (id) {
      var p = self._st(id), st = p ? p.state : "unknown";
      var cls = st === "home" ? "home" : (st === "unknown" || st === "unavailable") ? "unknown" : "away";
      var label = st === "home" ? "Home" : cls === "unknown" ? "Location unknown" : st === "not_home" ? "Away" : st;
      return '<div class="person ' + cls + '"><ha-icon icon="mdi:account' + (cls === "home" ? "" : "-outline") + '"></ha-icon>' +
        esc(p && p.attributes.friendly_name || id) + '<span class="ps">' + esc(label) + "</span></div>";
    }).join("");
    var chip = function (attr, v, label, cur, icon) {
      return '<div class="chip' + (cur === v ? " sel" : "") + '" role="button" data-h="' + attr + '" data-v="' + v + '">' + (icon ? '<ha-icon icon="' + icon + '"></ha-icon>' : "") + label + "</div>";
    };
    var untilRow = "";
    if (ov === "away") untilRow = '<div class="row"><div class="chips">' + chip("until", "arrival", "Until someone gets home", until) + chip("until", "manual", "Until I switch back", until) + "</div></div>";
    if (ov === "home") untilRow = '<div class="row"><div class="chips">' + chip("until", "manual", "Until I switch back", until) + chip("until", "departure", "Until everyone leaves", until) + "</div></div>";
    var tg = function (attr, on, t1, t2) {
      return '<div class="hrow"><div class="ot"><div class="o1">' + t1 + '</div><div class="o2">' + t2 + '</div></div><div class="tg' + (on ? " on" : "") + '" role="button" data-h="' + attr + '"></div></div>';
    };
    var html = '<div class="hcol"><div class="hnow"><div class="hi"><ha-icon icon="' + m.icon + '"></ha-icon></div><div><b>' + esc(m.name) + "</b><span>" + esc(a.reason || "") + "</span></div></div>" +
      '<div class="lbl">People</div><div class="people">' + (ppl || '<div class="hnote">No people found. Add person entities in Home Assistant.</div>') + "</div>" +
      (a.people_unknown && a.people_unknown.length ? '<div class="hnote">Someone’s location is unknown, so they count as away. If that’s wrong, use Home below until it’s fixed.</div>' : "") +
      '</div><div class="hcol"><div class="lbl">Presence</div><div class="row"><div class="chips">' +
      chip("ovr", "auto", "Automatic", ov, "mdi:account-switch-outline") + chip("ovr", "home", "Home", ov, "mdi:home") + chip("ovr", "away", "Away", ov, "mdi:home-export-outline") +
      "</div></div>" + untilRow +
      '<div class="hnote">Automatic follows who is home. Home or Away overrides it when presence detection gets it wrong.</div>' +
      tg("guests", s.guests === true, "Guests are home", "Counts as home even when nobody’s phone is") +
      tg("vacation", s.vacation === true, "Vacation", "Deep energy savings until you turn it off") +
      tg("night", s.night !== false, "Night mode", "Home becomes Night from " + this._fmtHM(s.night_start || a.night_start || "22:30") + " to " + this._fmtHM(s.night_end || a.night_end || "06:30")) +
      "</div>";
    var hb = sh.querySelector(".hb");
    if (hb.innerHTML !== html) hb.innerHTML = html;
  };

  EchoClimateCard.prototype._closeSheet = function () {
    if (this._houseSheet) { this._houseSheet.remove(); this._houseSheet = null; }
    if (this._daySheet) { this._daySheet.remove(); this._daySheet = null; this._dayEdit = null; }
  };

  // ---------- NOW ----------
  EchoClimateCard.prototype._setpoints = function () {
    var c = this._st(this._config.entity);
    if (!c) return { mode: "unavailable" };
    var a = c.attributes, mode = c.state, plan = this._plan();
    var low = mode === "heat_cool" ? a.target_temp_low : mode === "heat" ? a.temperature : num(plan.set_low);
    var high = mode === "heat_cool" ? a.target_temp_high : mode === "cool" ? a.temperature : num(plan.set_high);
    if (this._draft) { low = this._draft.low; high = this._draft.high; }
    return { mode: mode, low: num(low), high: num(high), cur: num(a.current_temperature), action: a.hvac_action, hum: num(a.current_humidity) };
  };

  EchoClimateCard.prototype._range = function (sp) {
    var F = this._unit() === "F";
    var lo = F ? 50 : 10, hi = F ? 90 : 32;
    [sp.low, sp.high, sp.cur].forEach(function (v) {
      if (v === null || v === undefined) return;
      if (v - 3 < lo) lo = Math.floor(v - 3);
      if (v + 3 > hi) hi = Math.ceil(v + 3);
    });
    return [lo, hi];
  };

  EchoClimateCard.prototype._renderNow = function () {
    var c = this._st(this._config.entity);
    if (!c) { this._nowEl.innerHTML = '<div class="loading">' + esc(this._config.entity) + " not found</div>"; return; }
    if (!this._nowBuilt) {
      this._nowEl.innerHTML = '<div class="dialw"><div class="dial"><div class="glow"></div><svg viewBox="0 0 200 200"></svg>' +
        '<div class="mid"></div><div class="pm minus" role="button" data-a="minus"><ha-icon icon="mdi:minus"></ha-icon></div>' +
        '<div class="pm plus" role="button" data-a="plus"><ha-icon icon="mdi:plus"></ha-icon></div></div></div><div class="side"></div>';
      this._nowBuilt = true;
    }
    this._paintDial();
    this._paintSide();
  };

  var A0 = 135, SWEEP = 270;
  function pt(a, r) { var t = a * Math.PI / 180; return [100 + r * Math.cos(t), 100 + r * Math.sin(t)]; }

  EchoClimateCard.prototype._ang = function (v) {
    var rg = this._rg;
    return A0 + (clamp(v, rg[0], rg[1]) - rg[0]) / (rg[1] - rg[0]) * SWEEP;
  };

  EchoClimateCard.prototype._paintDial = function () {
    var sp = this._setpoints(), u = this._unit();
    if (!this._draft || !this._draft.dragging) this._rg = this._range(sp);
    var rg = this._rg, mode = sp.mode;
    var heatOn = mode === "heat" || mode === "heat_cool", coolOn = mode === "cool" || mode === "heat_cool";
    if (!this._sel || (this._sel === "heat" && !heatOn) || (this._sel === "cool" && !coolOn)) {
      this._sel = mode === "cool" ? "cool" : mode === "heat" ? "heat" :
        (sp.cur !== null && sp.high !== null && sp.low !== null && Math.abs(sp.cur - sp.high) < Math.abs(sp.cur - sp.low) ? "cool" : "heat");
    }
    var stepT = u === "C" ? 0.5 : 1, s = "";
    var heating = sp.action === "heating", cooling = sp.action === "cooling";
    for (var v = rg[0]; v <= rg[1] + 0.001; v += stepT) {
      var a = this._ang(v), major = Math.abs(v % (u === "C" ? 2.5 : 5)) < 0.01;
      var p1 = pt(a, major ? 76 : 79), p2 = pt(a, 88);
      var col = "rgba(255,255,255,.18)";
      if (mode !== "off") {
        if (heatOn && sp.low !== null && v <= sp.low) col = "rgba(255,122,61,.38)";
        if (coolOn && sp.high !== null && v >= sp.high) col = "rgba(58,168,255,.38)";
        if (heating && sp.cur !== null && v >= sp.cur && v <= sp.low) col = HEAT;
        if (cooling && sp.cur !== null && v <= sp.cur && v >= sp.high) col = COOL;
      }
      s += '<line x1="' + p1[0].toFixed(2) + '" y1="' + p1[1].toFixed(2) + '" x2="' + p2[0].toFixed(2) + '" y2="' + p2[1].toFixed(2) + '" style="stroke:' + col + ';stroke-width:' + (major ? 1.3 : 0.9) + ';stroke-linecap:round"/>';
    }
    // scale numbers at the ends
    var e0 = pt(A0, 66), e1 = pt(A0 + SWEEP, 66);
    s += '<text x="' + e0[0] + '" y="' + (e0[1] + 6) + '" style="fill:rgba(255,255,255,.35);font-size:6px" text-anchor="middle">' + rg[0] + "</text>";
    s += '<text x="' + e1[0] + '" y="' + (e1[1] + 6) + '" style="fill:rgba(255,255,255,.35);font-size:6px" text-anchor="middle">' + rg[1] + "</text>";
    // current temperature marker
    if (sp.cur !== null) {
      // a small pointer just inside the scale, so it never hides under a knob
      var ca = this._ang(sp.cur), c0 = pt(ca, 73.5), cl = pt(ca - 3.2, 68), cr = pt(ca + 3.2, 68);
      s += '<path d="M' + c0[0].toFixed(2) + " " + c0[1].toFixed(2) + "L" + cl[0].toFixed(2) + " " + cl[1].toFixed(2) + "L" + cr[0].toFixed(2) + " " + cr[1].toFixed(2) + 'Z" style="fill:#fff"/>';
    }
    // setpoint knobs
    var self = this;
    var knob = function (val, col, side) {
      var k = pt(self._ang(val), 83), sel = self._sel === side && mode === "heat_cool";
      return '<g data-k="' + side + '">' + (sel ? '<circle cx="' + k[0].toFixed(2) + '" cy="' + k[1].toFixed(2) + '" r="13.5" style="fill:none;stroke:' + col + ';stroke-width:1;opacity:.6"/>' : "") +
        '<circle cx="' + k[0].toFixed(2) + '" cy="' + k[1].toFixed(2) + '" r="10.5" style="fill:' + col + ';stroke:rgba(10,16,34,.9);stroke-width:2"/>' +
        '<text x="' + k[0].toFixed(2) + '" y="' + (k[1] + 3.4).toFixed(2) + '" text-anchor="middle" style="fill:#160a02;font-size:9.5px;font-weight:700">' + fmtT(val, u) + "</text></g>";
    };
    if (mode !== "off" && mode !== "unavailable") {
      if (heatOn && sp.low !== null) s += knob(sp.low, HEAT, "heat");
      if (coolOn && sp.high !== null) s += knob(sp.high, COOL, "cool");
    }
    var svg = this._nowEl.querySelector("svg");
    svg.innerHTML = s;
    var dial = this._nowEl.querySelector(".dial");
    dial.className = "dial" + (heating ? " heating" : cooling ? " cooling" : "");

    // middle
    var plan = this._plan(), rooms = this._store().rooms || [];
    var act = mode === "off" ? "Off" : heating ? "Heating" : cooling ? "Cooling" : sp.action === "fan" ? "Fan" : "Idle";
    var aicon = heating ? "mdi:fire" : cooling ? "mdi:snowflake" : mode === "off" ? "mdi:power" : "mdi:check-circle-outline";
    var used = (plan.rooms_used || []).filter(function (k) { return k !== "thermostat"; });
    var roomTxt = "";
    if (used.length && plan.room !== null && plan.room !== undefined) {
      var names = rooms.filter(function (r) { return used.indexOf(r.key) !== -1; }).map(function (r) { return r.name; });
      roomTxt = esc(names.join(" + ")) + " " + fmtT(plan.room, u) + "°";
    } else if (sp.hum !== null) roomTxt = "Humidity " + Math.round(sp.hum) + "%";
    var pend = this._draft ? " pend" : "";
    var chips = "";
    if (heatOn && sp.low !== null) chips += '<div class="sp heat' + (mode === "heat_cool" && this._sel === "heat" ? " sel" : "") + pend + '" role="button" data-a="sel-heat"><small>Heat</small>' + fmtT(sp.low, u) + "°</div>";
    if (coolOn && sp.high !== null) chips += '<div class="sp cool' + (mode === "heat_cool" && this._sel === "cool" ? " sel" : "") + pend + '" role="button" data-a="sel-cool"><small>Cool</small>' + fmtT(sp.high, u) + "°</div>";
    var mid = '<div class="act"><ha-icon icon="' + aicon + '"></ha-icon>' + act + "</div>" +
      '<div class="big">' + fmtT(sp.cur, u) + "<sup>°</sup></div>" +
      (roomTxt ? '<div class="roomlbl">' + roomTxt + "</div>" : "") +
      (mode === "off" ? '<div class="offmsg">Tap a mode to turn it on</div>' : '<div class="sps">' + chips + "</div>");
    var midEl = this._nowEl.querySelector(".mid");
    if (midEl.innerHTML !== mid) midEl.innerHTML = mid;
    var off = mode === "off" || mode === "unavailable";
    this._nowEl.querySelector(".pm.minus").classList.toggle("off", off);
    this._nowEl.querySelector(".pm.plus").classList.toggle("off", off);
  };

  EchoClimateCard.prototype._paintSide = function () {
    var c = this._st(this._config.entity), plan = this._plan(), store = this._store();
    var u = this._unit(), profiles = store.profiles || {};
    var src = plan.source || (this._st(this._config.plan) ? "schedule" : "none");
    var hold = plan.hold || {}, next = plan.next || {};
    var pm = pmeta(plan.profile, profiles);
    var icon = "mdi:calendar-clock", t1 = "", t2 = "", resume = false, color = pm.color;
    var range = function (lo, hi) { return lo !== null && lo !== undefined ? fmtT(lo, u) + "–" + fmtT(hi, u) + "°" : ""; };
    var nextTxt = next.start ? "Next: <b>" + esc(next.name || pmeta(next.profile, profiles).name) + "</b> at " + esc(this._fmtWhen(next.start)) + (next.low !== null && next.low !== undefined ? " · " + range(next.low, next.high) : "") : "";
    if (src === "none") { icon = "mdi:alert-circle-outline"; t1 = "Climate package not installed"; t2 = "Showing the thermostat only"; color = "#ffffff"; }
    else if (src === "off") { icon = "mdi:power"; t1 = "The system is off"; t2 = nextTxt; color = "#ffffff"; }
    else if (src === "hold") {
      icon = "mdi:hand-back-left-outline"; resume = true; color = "#ff9f6e";
      t1 = hold.type === "permanent" ? "Holding until you resume" : "Holding until " + esc(this._fmtWhen(hold.until));
      t2 = (hold.by === "thermostat" ? "Changed on the thermostat" : hold.by === "voice" ? "Set by voice" : hold.profile ? esc(pmeta(hold.profile, profiles).name) : "Set by hand") +
        (hold.type !== "permanent" && next.start ? " · then " + esc(next.name || "") : "");
    } else if (src === "away") { icon = "mdi:home-export-outline"; t1 = "Away: saving energy"; t2 = esc(pm.name) + " " + range(plan.want_low, plan.want_high) + " until someone gets home"; }
    else if (src === "vacation") { icon = "mdi:airplane"; t1 = "Vacation"; t2 = esc(pm.name) + " " + range(plan.want_low, plan.want_high); }
    else if (src === "preheat") {
      icon = "mdi:clock-fast";
      t1 = ((next.low > (plan.period || {}).low || next.high >= (plan.period || {}).high) ? "Warming up" : "Cooling down") + " for " + esc(pm.name);
      t2 = "Smart recovery started early so it’s " + range(plan.want_low, plan.want_high) + " by " + esc(this._fmtWhen(next.start));
    } else {
      icon = pm.icon; t1 = "Following schedule: " + esc(pm.name) + " " + range(plan.want_low, plan.want_high); t2 = nextTxt;
    }
    if (plan.offset && src !== "hold" && src !== "off") t2 += (t2 ? " · " : "") + "set " + (plan.offset > 0 ? "+" : "") + fmtT(plan.offset, u) + "° for the room";
    var h = '<div class="panel status"><div class="si" style="color:' + color + ";background:rgba(" + hexRgb(color) + ',.16)"><ha-icon icon="' + icon + '"></ha-icon></div>' +
      '<div class="st"><div class="t1">' + t1 + '</div><div class="t2">' + t2 + "</div></div>" +
      (resume ? '<div class="resume" role="button" data-a="resume"><ha-icon icon="mdi:calendar-sync"></ha-icon>Resume</div>' : "") + "</div>";

    // hold length
    var hasPkg = src !== "none";
    var opts = store.options || {};
    var curHold = hold.active ? (hold.type === "permanent" ? "permanent" : hold.type === "until" ? this._holdLen(hold) : "next") : null;
    if (hasPkg && c && c.state !== "off") {
      h += '<div class="row"><div class="lbl">Hold</div><div class="chips">';
      HOLD_CHOICES.forEach(function (o) {
        h += '<div class="chip' + (curHold === o.id ? " sel" : "") + '" role="button" data-a="hold" data-v="' + o.id + '">' + o.label + "</div>";
      });
      h += "</div></div>";
    }
    // profiles
    if (hasPkg) {
      h += '<div class="row"><div class="lbl">Comfort</div><div class="chips">';
      var keys = PORDER.filter(function (k) { return k in profiles && k !== "vacation"; });
      Object.keys(profiles).forEach(function (k) { if (keys.indexOf(k) === -1 && k !== "vacation") keys.push(k); });
      var activeKey = src === "hold" ? hold.profile : plan.profile;
      keys.slice(0, 5).forEach(function (k) {
        var m = pmeta(k, profiles);
        h += '<div class="chip prof' + (activeKey === k ? " sel" : "") + (c && c.state === "off" ? " dis" : "") + '" style="--pc:' + m.color + ";--pc-rgb:" + hexRgb(m.color) + '" role="button" data-a="profile" data-v="' + esc(k) + '"><ha-icon icon="' + m.icon + '"></ha-icon>' + esc(m.name) + "</div>";
      });
      h += "</div></div>";
    }
    // mode + fan
    if (c) {
      var modes = (c.attributes.hvac_modes || []).slice();
      var order = ["off", "heat", "cool", "heat_cool", "auto"];
      modes.sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });
      var ML = { off: "Off", heat: "Heat", cool: "Cool", heat_cool: "Auto", auto: "Auto", dry: "Dry", fan_only: "Fan" };
      var MI = { off: "mdi:power", heat: "mdi:fire", cool: "mdi:snowflake", heat_cool: "mdi:sun-snowflake-variant", auto: "mdi:thermostat-auto", dry: "mdi:water-percent", fan_only: "mdi:fan" };
      h += '<div class="row"><div class="lbl">Mode</div><div class="chips">';
      modes.forEach(function (m) {
        h += '<div class="chip m-' + m + (c.state === m ? " sel" : "") + '" role="button" data-a="mode" data-v="' + m + '"><ha-icon icon="' + (MI[m] || "mdi:thermostat") + '"></ha-icon>' + (ML[m] || m) + "</div>";
      });
      h += "</div></div>";
      var fans = c.attributes.fan_modes || [];
      if (fans.length) {
        h += '<div class="row"><div class="lbl">Fan</div><div class="chips">';
        fans.forEach(function (f) {
          var lf = String(f).toLowerCase();
          var lab = /auto/.test(lf) ? "Auto" : /circ/.test(lf) ? "Circulate" : /^(on|low)$/.test(lf) ? "On" : f;
          h += '<div class="chip' + (c.attributes.fan_mode === f ? " sel" : "") + '" role="button" data-a="fan" data-v="' + esc(f) + '"><ha-icon icon="' + (/auto/.test(lf) ? "mdi:fan-auto" : /circ/.test(lf) ? "mdi:fan-clock" : "mdi:fan") + '"></ha-icon>' + esc(lab) + "</div>";
        });
        h += "</div></div>";
      }
    }
    // rooms
    h += '<div class="rooms">' + this._roomsHtml() + "</div>";
    // today
    if (hasPkg) h += this._todayHtml();
    var side = this._nowEl.querySelector(".side");
    if (side.innerHTML !== h) side.innerHTML = h;
  };

  EchoClimateCard.prototype._holdLen = function (hold) {
    if (!hold.at || !hold.until) return null;
    var hrs = Math.round((Date.parse(hold.until) - Date.parse(hold.at)) / 36e5);
    return hrs === 2 ? "2h" : hrs === 4 ? "4h" : null;
  };

  EchoClimateCard.prototype._roomsHtml = function () {
    var store = this._store(), rooms = store.rooms || [], plan = this._plan(), u = this._unit();
    var used = plan.rooms_used || [];
    var c = this._st(this._config.entity);
    var self = this, h = "";
    rooms.forEach(function (r) {
      var v, hum, dead = false, bat = null;
      if (r.key === "thermostat") {
        v = c ? num(c.attributes.current_temperature) : null;
        hum = c ? num(c.attributes.current_humidity) : null;
      } else {
        var s = self._st(r.entity), sh = self._st(r.humidity), sb = self._st(r.battery);
        v = s ? num(s.state) : null;
        hum = sh ? num(sh.state) : null;
        bat = sb ? num(sb.state) : null;
        dead = v === null;
      }
      var isUsed = used.indexOf(r.key) !== -1 && used.length && !(used.length === 1 && used[0] === "thermostat" && rooms.length === 1);
      h += '<div class="room' + (isUsed ? " used" : "") + (dead ? " dead" : "") + '"><div class="rn">' + (isUsed ? '<ha-icon icon="mdi:target"></ha-icon>' : "") + esc(r.name) +
        (bat !== null && bat <= 20 ? ' <ha-icon icon="mdi:battery-alert-variant-outline" style="color:#ffd60a"></ha-icon>' : "") + "</div>" +
        (dead ? '<div class="rv">Offline · check the battery</div>' :
          '<div class="rv">' + fmtT(v, u) + "°" + (hum !== null ? "<small>" + Math.round(hum) + "%</small>" : "") + "</div>") + "</div>";
    });
    var od = this._st(this._config.outdoor);
    if (od) {
      var ov = od.entity_id.indexOf("weather.") === 0 ? num(od.attributes.temperature) : num(od.state);
      h += '<div class="room"><div class="rn"><ha-icon icon="mdi:tree-outline"></ha-icon>Outside</div><div class="rv">' + fmtT(ov, u) + "°" +
        (od.entity_id.indexOf("weather.") === 0 && od.attributes.humidity !== undefined ? "<small>" + Math.round(od.attributes.humidity) + "%</small>" : "") + "</div></div>";
    }
    return h;
  };

  // The day's periods as segments [{p, from, to}] in minutes; the first one carries over
  // from the previous day's last period.
  EchoClimateCard.prototype._daySegs = function (week, key) {
    var list = sortDay(week[key]);
    var prevKey = DAYS[(DAYS.indexOf(key) + 6) % 7];
    var prevList = sortDay(week[prevKey]);
    var carry = prevList.length ? prevList[prevList.length - 1].p : (list.length ? list[list.length - 1].p : "home");
    var out = [], from = 0, p = carry;
    list.forEach(function (e) {
      var m = hm2min(e.t);
      if (m > from) out.push({ p: p, from: from, to: m });
      from = m; p = e.p;
    });
    out.push({ p: p, from: from, to: 1440 });
    return out.filter(function (s) { return s.to > s.from; });
  };

  EchoClimateCard.prototype._todayHtml = function () {
    var store = this._store(), week = store.week || {}, profiles = store.profiles || {};
    var now = new Date(), key = dayKey(now);
    var segs = this._daySegs(week, key);
    var self = this;
    var h = '<div class="panel today"><div class="lbl">Today</div><div class="tbar">';
    segs.forEach(function (s) {
      var m = pmeta(s.p, profiles), w = (s.to - s.from) / 14.4;
      h += '<div class="tseg" style="left:' + (s.from / 14.4) + "%;width:" + w + "%;background:" + m.color + '">' + (w > 9 ? esc(m.name) : "") + "</div>";
    });
    var nm = now.getHours() * 60 + now.getMinutes();
    h += '<div class="tnow" style="left:' + (nm / 14.4) + '%"></div></div><div class="tax">';
    [0, 360, 720, 1080, 1440].forEach(function (m) {
      h += '<span style="left:' + (m === 1440 ? 100 : Math.max(3, m / 14.4)) + '%">' + self._fmtHM(min2hm(m === 1440 ? 0 : m), true) + "</span>";
    });
    return h + "</div></div>";
  };

  EchoClimateCard.prototype._nowClick = function (ev) {
    var t = ev.target.closest ? ev.target.closest("[data-a]") : null;
    if (!t) return;
    var a = t.getAttribute("data-a"), v = t.getAttribute("data-v");
    var c = this._st(this._config.entity);
    if (!c) return;
    if (a === "minus" || a === "plus") this._nudge(a === "plus" ? 1 : -1);
    else if (a === "sel-heat" || a === "sel-cool") { this._sel = a === "sel-heat" ? "heat" : "cool"; this._paintDial(); }
    else if (a === "resume") {
      this._draft = null;
      this._call(this._config.hold_script, { resume: true });
      this._toast("Back on the schedule");
    } else if (a === "hold") {
      var d = { by: "dashboard" };
      if (v === "next" || v === "permanent") d.until = v;
      else { d.until = "hours"; d.hours = parseFloat(v); }
      var sp = this._setpoints();
      if (sp.low !== null) d.low = sp.low;
      if (sp.high !== null) d.high = sp.high;
      this._call(this._config.hold_script, d);
      this._toast(v === "permanent" ? "Holding until you resume" : v === "next" ? "Holding until the next schedule change" : "Holding for " + parseFloat(v) + " hours");
    } else if (a === "profile") {
      this._draft = null;
      this._call(this._config.hold_script, { profile: v, by: "dashboard" });
      this._toast(pmeta(v, this._store().profiles).name + " until the next change");
    } else if (a === "mode") {
      this._hass.callService("climate", "set_hvac_mode", { entity_id: this._config.entity, hvac_mode: v });
    } else if (a === "fan") {
      this._hass.callService("climate", "set_fan_mode", { entity_id: this._config.entity, fan_mode: v });
    }
  };

  // +/- buttons: change the selected setpoint by one step, sent after a short pause.
  EchoClimateCard.prototype._nudge = function (dir) {
    var sp = this._setpoints();
    if (sp.mode === "off") return;
    var step = this._step(), diff = this._diff();
    var low = sp.low, high = sp.high;
    var side = sp.mode === "heat" ? "heat" : sp.mode === "cool" ? "cool" : this._sel;
    if (side === "heat" && low !== null) {
      low = low + dir * step;
      if (sp.mode === "heat_cool" && high !== null && high - low < diff) high = low + diff;
    } else if (high !== null) {
      high = high + dir * step;
      if (sp.mode === "heat_cool" && low !== null && high - low < diff) low = high - diff;
    }
    this._setDraft(low, high, false);
    this._commitSoon(1200);
  };

  EchoClimateCard.prototype._setDraft = function (low, high, dragging) {
    var c = this._st(this._config.entity);
    var mn = c ? num(c.attributes.min_temp) : null, mx = c ? num(c.attributes.max_temp) : null;
    if (mn !== null) { if (low !== null) low = Math.max(mn, low); if (high !== null) high = Math.max(mn, high); }
    if (mx !== null) { if (low !== null) low = Math.min(mx, low); if (high !== null) high = Math.min(mx, high); }
    this._draft = { low: low, high: high, at: Date.now(), dragging: !!dragging };
    this._paintDial();
  };

  EchoClimateCard.prototype._commitSoon = function (ms) {
    var self = this;
    clearTimeout(this._commitT);
    this._commitT = setTimeout(function () {
      var d = self._draft, c = self._st(self._config.entity);
      if (!d || !c) return;
      d.at = Date.now();
      var data = { by: "dashboard", until: "default" };
      if (c.state === "heat_cool") { data.low = d.low; data.high = d.high; }
      else if (c.state === "heat") data.low = d.low;
      else if (c.state === "cool") data.high = d.high;
      if (self._st(self._config.plan)) self._call(self._config.hold_script, data);
      else {
        var sd = { entity_id: self._config.entity };
        if (c.state === "heat_cool") { sd.target_temp_low = d.low; sd.target_temp_high = d.high; }
        else sd.temperature = c.state === "cool" ? d.high : d.low;
        self._hass.callService("climate", "set_temperature", sd);
      }
    }, ms);
  };

  // Drag the knobs around the dial.
  EchoClimateCard.prototype._bindDial = function () {
    var self = this, drag = null;
    function valAt(ev, svg) {
      var r = svg.getBoundingClientRect();
      var x = (ev.clientX - r.left) / r.width * 200 - 100, y = (ev.clientY - r.top) / r.height * 200 - 100;
      var a = Math.atan2(y, x) * 180 / Math.PI; if (a < 0) a += 360;
      var rel = (a - A0 + 360) % 360;
      if (rel > SWEEP) rel = rel > SWEEP + (360 - SWEEP) / 2 ? 0 : SWEEP;
      var rg = self._rg, step = self._step();
      var v = rg[0] + rel / SWEEP * (rg[1] - rg[0]);
      return { v: Math.round(v / step) * step, a: A0 + rel, dist: Math.sqrt(x * x + y * y) };
    }
    this._nowEl.addEventListener("pointerdown", function (ev) {
      var svg = ev.target.closest ? ev.target.closest("svg") : null;
      if (!svg) return;
      var sp = self._setpoints();
      if (sp.mode === "off" || sp.mode === "unavailable") return;
      var hit = valAt(ev, svg);
      if (hit.dist < 55) return;            // the middle isn't a handle
      var cands = [];
      if ((sp.mode === "heat" || sp.mode === "heat_cool") && sp.low !== null) cands.push(["heat", self._ang(sp.low)]);
      if ((sp.mode === "cool" || sp.mode === "heat_cool") && sp.high !== null) cands.push(["cool", self._ang(sp.high)]);
      if (!cands.length) return;
      cands.sort(function (a, b) { return Math.abs(a[1] - hit.a) - Math.abs(b[1] - hit.a); });
      if (Math.abs(cands[0][1] - hit.a) > 40) return;
      drag = { side: cands[0][0], svg: svg };
      self._sel = drag.side;
      clearTimeout(self._commitT);
      try { svg.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
      ev.preventDefault();
      self._dragTo(drag, hit.v, sp);
    });
    this._nowEl.addEventListener("pointermove", function (ev) {
      if (!drag) return;
      self._dragTo(drag, valAt(ev, drag.svg).v, self._setpoints());
    });
    function end() {
      if (!drag) return;
      drag = null;
      if (self._draft) { self._draft.dragging = false; self._commitSoon(500); }
    }
    this._nowEl.addEventListener("pointerup", end);
    this._nowEl.addEventListener("pointercancel", end);
  };

  EchoClimateCard.prototype._dragTo = function (drag, v, sp) {
    var diff = this._diff(), low = sp.low, high = sp.high;
    if (drag.side === "heat") {
      low = v;
      if (sp.mode === "heat_cool" && high !== null && high - low < diff) high = low + diff;
    } else {
      high = v;
      if (sp.mode === "heat_cool" && low !== null && high - low < diff) low = high - diff;
    }
    if (this._draft && this._draft.dragging && this._draft.low === low && this._draft.high === high) return;
    this._setDraft(low, high, true);
  };

  // ---------- SCHEDULE ----------
  EchoClimateCard.prototype._renderSched = function () {
    var store = this._store(), week = store.week, profiles = store.profiles || {};
    if (!week) { this._schedEl.innerHTML = '<div class="loading">Install the climate package to use the schedule (see the README).</div>'; return; }
    var self = this, today = dayKey(new Date());
    var h = '<div class="sh"><div class="dl"></div><div class="ax">';
    [0, 180, 360, 540, 720, 900, 1080, 1260, 1440].forEach(function (m) {
      h += '<span style="left:' + Math.min(98, Math.max(2, m / 14.4)) + '%">' + self._fmtHM(min2hm(m === 1440 ? 0 : m), true) + "</span>";
    });
    h += '</div><div class="sedit"></div></div>';
    var now = new Date(), nm = now.getHours() * 60 + now.getMinutes();
    DAYS.forEach(function (d) {
      h += '<div class="srow" role="button" data-day="' + d + '"><div class="dl' + (d === today ? " today" : "") + '">' + DAY_NAME[d].slice(0, 3) + '</div><div class="sbar">';
      self._daySegs(week, d).forEach(function (s) {
        var m = pmeta(s.p, profiles), w = (s.to - s.from) / 14.4, pr = profiles[s.p] || {};
        h += '<div class="sseg" style="left:' + (s.from / 14.4) + "%;width:" + w + "%;background:" + m.color + '">' +
          (w > 7 ? "<b>" + esc(m.name) + "</b>" : "") + (w > 11 ? "<i>" + (s.from ? self._fmtHM(min2hm(s.from)) : "") + (pr.low !== undefined ? (s.from ? " · " : "") + fmtT(pr.low, self._unit()) + "–" + fmtT(pr.high, self._unit()) + "°" : "") + "</i>" : "") + "</div>";
      });
      if (d === today) h += '<div class="tnow" style="left:' + (nm / 14.4) + '%"></div>';
      h += '</div><div class="sedit"><ha-icon icon="mdi:pencil-outline"></ha-icon></div></div>';
    });
    h += '<div class="legend">';
    PORDER.concat(Object.keys(profiles).filter(function (k) { return PORDER.indexOf(k) === -1; })).forEach(function (k) {
      if (!(k in profiles)) return;
      var m = pmeta(k, profiles);
      h += '<span><i style="background:' + m.color + '"></i>' + esc(m.name) + "</span>";
    });
    h += "</div>";
    if (this._schedEl.innerHTML !== h) this._schedEl.innerHTML = h;
  };

  EchoClimateCard.prototype._openDay = function (day) {
    var store = this._store();
    if (!store.week) return;
    this._closeSheet();
    var list = sortDay(store.week[day]).map(function (e) { return { t: e.t, p: e.p }; });
    this._dayEdit = { day: day, list: list, sel: list.length ? 0 : -1, copy: {} };
    var sh = document.createElement("div");
    sh.className = "sheet";
    sh.innerHTML = '<div class="sbox"><div class="shd"><div class="sbtn" role="button" data-d="cancel">Cancel</div><h2>' + DAY_NAME[day] + '</h2><div class="sbtn ok" role="button" data-d="save">Save</div></div>' +
      '<div class="sbody"><div class="plist"></div><div class="pedit"></div></div></div>';
    var self = this;
    sh.addEventListener("click", function (ev) {
      if (ev.target === sh) { self._closeSheet(); return; }
      var t = ev.target.closest ? ev.target.closest("[data-d]") : null;
      if (!t) return;
      var a = t.getAttribute("data-d"), v = t.getAttribute("data-v"), de = self._dayEdit;
      if (!de) return;
      if (a === "cancel") self._closeSheet();
      else if (a === "save") self._saveDay(t);
      else if (a === "pick") { de.sel = parseInt(v, 10); self._paintDay(true); }
      else if (a === "del") { de.list.splice(parseInt(v, 10), 1); de.sel = Math.min(de.sel, de.list.length - 1); self._paintDay(true); }
      else if (a === "add") {
        var last = de.list.length ? hm2min(de.list[de.list.length - 1].t) : 360;
        de.list.push({ t: min2hm(Math.min(1425, last + 120)), p: "home" });
        de.sel = de.list.length - 1;
        self._paintDay(true);
      } else if (a === "prof" && de.sel >= 0) { de.list[de.sel].p = v; self._paintDay(false); }
      else if (a === "copy") { de.copy[v] = !de.copy[v]; self._paintDay(false); }
      else if (a === "copyset") {
        DAYS.forEach(function (d) { de.copy[d] = false; });
        (v === "weekdays" ? ["mon", "tue", "wed", "thu", "fri"] : v === "weekend" ? ["sat", "sun"] : DAYS).forEach(function (d) { if (d !== de.day) de.copy[d] = true; });
        self._paintDay(false);
      }
    });
    this._rootEl.appendChild(sh);
    this._daySheet = sh;
    this._paintDay(true);
  };

  EchoClimateCard.prototype._paintDay = function (wheels) {
    var de = this._dayEdit, sh = this._daySheet;
    if (!de || !sh) return;
    var store = this._store(), profiles = store.profiles || {}, self = this;
    // keep the list in time order, following the selected item
    var selItem = de.list[de.sel];
    de.list.sort(function (a, b) { return hm2min(a.t) - hm2min(b.t); });
    de.sel = selItem ? de.list.indexOf(selItem) : -1;
    var h = "";
    de.list.forEach(function (e, i) {
      var m = pmeta(e.p, profiles), t = self._fmtHM(e.t), ap = "";
      var mm = /^(.*) ([AP]M)$/.exec(t);
      if (mm) { t = mm[1]; ap = "<small>" + mm[2] + "</small>"; }
      h += '<div class="pitem' + (i === de.sel ? " sel" : "") + '" role="button" data-d="pick" data-v="' + i + '"><div class="pt">' + t + ap + '</div><div class="pp"><i style="background:' + m.color + '"></i>' + esc(m.name) + "</div>" +
        '<div class="px" role="button" data-d="del" data-v="' + i + '"><ha-icon icon="mdi:close-circle"></ha-icon></div></div>';
    });
    if (de.list.length < 8) h += '<div class="padd" role="button" data-d="add"><ha-icon icon="mdi:plus"></ha-icon>Add a change</div>';
    sh.querySelector(".plist").innerHTML = h;

    var pe = sh.querySelector(".pedit");
    if (wheels) {
      pe.innerHTML = de.sel >= 0 ? '<div class="lbl">Starts at</div><div class="wheels"></div><div class="lbl">Comfort</div><div class="pchips"></div><div class="lbl">Copy this day to</div><div class="copy"></div>' :
        '<div class="hnote">No changes on this day: it keeps the last profile of the day before. Add one.</div><div class="lbl">Copy this day to</div><div class="copy"></div>';
      this._mountDayWheels();
    }
    var pc = pe.querySelector(".pchips");
    if (pc && de.sel >= 0) {
      var ph = "";
      Object.keys(profiles).sort(function (a, b) { return (PORDER.indexOf(a) + 99) % 99 - (PORDER.indexOf(b) + 99) % 99; }).forEach(function (k) {
        var m = pmeta(k, profiles);
        ph += '<div class="chip prof' + (de.list[de.sel].p === k ? " sel" : "") + '" style="--pc:' + m.color + ";--pc-rgb:" + hexRgb(m.color) + '" role="button" data-d="prof" data-v="' + esc(k) + '"><ha-icon icon="' + m.icon + '"></ha-icon>' + esc(m.name) + "</div>";
      });
      pc.innerHTML = ph;
    }
    var cp = "";
    DAYS.forEach(function (d) {
      cp += '<div class="dchip' + (de.copy[d] ? " on" : "") + (d === de.day ? " self" : "") + '" role="button" data-d="copy" data-v="' + d + '">' + DAY_SHORT[d].charAt(0) + "</div>";
    });
    cp += '<div class="chip" role="button" data-d="copyset" data-v="weekdays">Weekdays</div><div class="chip" role="button" data-d="copyset" data-v="weekend">Weekend</div>';
    pe.querySelector(".copy").innerHTML = cp;
  };

  EchoClimateCard.prototype._mountDayWheels = function () {
    var de = this._dayEdit, W = window.EchoClockWheel;
    var host = this._daySheet && this._daySheet.querySelector(".wheels");
    if (!host || de.sel < 0) return;
    var m = hm2min(de.list[de.sel].t), h24 = this._h24(), self = this;
    var mins = []; for (var i = 0; i < 60; i += 5) mins.push((i < 10 ? "0" : "") + i);
    var hours = []; if (h24) for (var j = 0; j < 24; j++) hours.push((j < 10 ? "0" : "") + j); else for (var k = 1; k <= 12; k++) hours.push(String(k));
    var hh = Math.floor(m / 60), mi = Math.round((m % 60) / 5) % 12;
    var state = { h: h24 ? hh : (hh % 12 === 0 ? 11 : hh % 12 - 1), m: mi, ap: hh >= 12 ? 1 : 0 };
    var apply = function () {
      var H = h24 ? state.h : ((state.h + 1) % 12) + (state.ap ? 12 : 0);
      de.list[de.sel].t = min2hm(H * 60 + state.m * 5);
      self._paintDay(false);
    };
    if (!W) {         // no wheel (clock card not loaded): simple +/- 15 min buttons
      host.innerHTML = '<div class="chip" role="button" data-w="-15">−15 min</div><div class="chip" role="button" data-w="15">+15 min</div>';
      host.onclick = function (ev) {
        var t = ev.target.closest ? ev.target.closest("[data-w]") : null;
        if (!t) return;
        de.list[de.sel].t = min2hm(hm2min(de.list[de.sel].t) + parseInt(t.getAttribute("data-w"), 10));
        self._paintDay(false);
      };
      return;
    }
    host.innerHTML = "";
    var wh = new W({ values: hours, index: state.h, onChange: function (v) { state.h = v; apply(); } });
    var wm = new W({ values: mins, index: state.m, onChange: function (v) { state.m = v; apply(); } });
    host.appendChild(wh.el); host.appendChild(wm.el);
    var ws = [wh, wm];
    if (!h24) {
      var wa = new W({ values: ["AM", "PM"], index: state.ap, loop: false, cls: "ampm", onChange: function (v) { state.ap = v; apply(); } });
      host.appendChild(wa.el); ws.push(wa);
    }
    requestAnimationFrame(function () { ws.forEach(function (w) { w.paint(); }); });
  };

  EchoClimateCard.prototype._saveDay = function (btn) {
    var de = this._dayEdit;
    if (!de) return;
    var seen = {}, list = [];
    de.list.forEach(function (e) { if (!seen[e.t]) { seen[e.t] = 1; list.push({ t: e.t, p: e.p }); } });
    var week = {}; week[de.day] = list;
    DAYS.forEach(function (d) { if (de.copy[d] && d !== de.day) week[d] = copy(list); });
    btn.classList.add("wait");
    var self = this, n = Object.keys(week).length;
    this._call(this._config.set_script, { data: { week: week } }).then(function () {
      self._closeSheet();
      self._toast(n > 1 ? "Saved " + n + " days" : "Saved " + DAY_NAME[de.day]);
    }, function () { btn.classList.remove("wait"); });
  };

  // ---------- COMFORT ----------
  EchoClimateCard.prototype._renderComfort = function () {
    var store = this._store();
    if (!store.profiles) { this._comfEl.innerHTML = '<div class="loading">Install the climate package to set comfort profiles (see the README).</div>'; return; }
    var profiles = this._comfDraft || store.profiles, u = this._unit(), rooms = store.rooms || [];
    var keys = PORDER.filter(function (k) { return k in profiles; }).concat(Object.keys(profiles).filter(function (k) { return PORDER.indexOf(k) === -1; }));
    var h = '<div class="profs">';
    keys.forEach(function (k) {
      var p = profiles[k], m = pmeta(k, profiles);
      h += '<div class="panel pcard" style="--pc:' + m.color + '"><div class="ph"><ha-icon icon="' + m.icon + '"></ha-icon>' + esc(m.name) + "</div>" +
        '<div class="stp heat"><div><div class="sl">Heat to</div><div class="sv">' + fmtT(p.low, u) + '°</div></div><div class="pmb"><div role="button" data-c="low" data-k="' + esc(k) + '" data-v="-1"><ha-icon icon="mdi:minus"></ha-icon></div><div role="button" data-c="low" data-k="' + esc(k) + '" data-v="1"><ha-icon icon="mdi:plus"></ha-icon></div></div></div>' +
        '<div class="stp cool"><div><div class="sl">Cool to</div><div class="sv">' + fmtT(p.high, u) + '°</div></div><div class="pmb"><div role="button" data-c="high" data-k="' + esc(k) + '" data-v="-1"><ha-icon icon="mdi:minus"></ha-icon></div><div role="button" data-c="high" data-k="' + esc(k) + '" data-v="1"><ha-icon icon="mdi:plus"></ha-icon></div></div></div>' +
        '<div class="sl" style="font-size:1.9vh;letter-spacing:.1em;text-transform:uppercase;opacity:.6">Comfort where</div><div class="rs">';
      rooms.forEach(function (r) {
        var on = (p.sensors || ["thermostat"]).indexOf(r.key) !== -1;
        h += '<div class="chip' + (on ? " sel" : "") + '" role="button" data-c="room" data-k="' + esc(k) + '" data-v="' + esc(r.key) + '">' + esc(r.name) + "</div>";
      });
      h += "</div></div>";
    });
    h += "</div>";
    var o = store.options || {}, L = store.learn || {};
    var tg = function (key, on, t1, t2, wide) {
      return '<div class="panel opt' + (wide ? " wide" : "") + '"><div class="ot"><div class="o1">' + t1 + '</div><div class="o2">' + t2 + '</div></div><div class="tg' + (on ? " on" : "") + '" role="button" data-c="opt" data-v="' + key + '"></div></div>';
    };
    h += '<div class="opts">' +
      tg("preheat", o.preheat !== false, "Smart recovery", "Starts early, comfy on time") +
      tg("compensate", o.compensate !== false, "Room comfort", "Steers by each profile’s rooms") +
      tg("away", o.away !== false, "Auto away", "Away while nobody’s home");
    var dh = o.default_hold || "next";
    h += '<div class="panel opt wide"><div class="ot"><div class="o1">A change holds for</div><div class="chips" style="margin-top:1vh">';
    HOLD_CHOICES.forEach(function (c) { h += '<div class="chip' + (dh === c.id ? " sel" : "") + '" role="button" data-c="dhold" data-v="' + c.id + '">' + c.label + "</div>"; });
    h += "</div></div></div></div>";
    if (this._comfEl.innerHTML !== h) this._comfEl.innerHTML = h;
    this._paintTopRight();
  };

  EchoClimateCard.prototype._paintTopRight = function () {
    var dirty = this._tab === "comfort" && !!this._comfDraft;
    if (this._saveEl) this._saveEl.classList.toggle("on", dirty);
    if (this._undoEl) this._undoEl.classList.toggle("on", dirty);
  };

  EchoClimateCard.prototype._comfClick = function (ev) {
    var t = ev.target.closest ? ev.target.closest("[data-c]") : null;
    if (!t) return;
    var a = t.getAttribute("data-c"), k = t.getAttribute("data-k"), v = t.getAttribute("data-v");
    var store = this._store();
    if (a === "opt") {
      var cur = (store.options || {})[v] !== false, d = {}; d[v] = !cur;
      this._call(this._config.set_script, { data: { options: d } });
      t.classList.toggle("on", !cur);
      return;
    }
    if (a === "dhold") { this._call(this._config.set_script, { data: { options: { default_hold: v } } }); return; }
    if (!this._comfDraft) this._comfDraft = copy(store.profiles || {});
    var p = this._comfDraft[k];
    if (!p) return;
    var step = this._step(), diff = this._diff();
    if (a === "low") {
      p.low = Math.round((p.low + parseInt(v, 10) * step) * 10) / 10;
      if (p.high - p.low < diff) p.high = p.low + diff;
    } else if (a === "high") {
      p.high = Math.round((p.high + parseInt(v, 10) * step) * 10) / 10;
      if (p.high - p.low < diff) p.low = p.high - diff;
    } else if (a === "room") {
      var s = (p.sensors || ["thermostat"]).slice(), i = s.indexOf(v);
      if (i === -1) s.push(v); else if (s.length > 1) s.splice(i, 1);
      p.sensors = s;
    }
    this._renderComfort();
  };

  EchoClimateCard.prototype._saveComfort = function () {
    if (!this._comfDraft) return;
    var self = this, d = this._comfDraft;
    this._saveEl.classList.add("wait");
    this._call(this._config.set_script, { data: { profiles: d } }).then(function () {
      self._comfDraft = null;
      self._saveEl.classList.remove("wait");
      self._renderComfort();
      self._toast("Comfort saved");
    }, function () { self._saveEl.classList.remove("wait"); });
  };

  // ---------- INSIGHTS ----------
  EchoClimateCard.prototype._loadHistory = function (force) {
    var self = this;
    if (!this._hass || this._histBusy) return;
    if (!force && this._hist && Date.now() - this._hist.at < 10 * 60000) return;
    this._histBusy = true;
    var end = new Date(), start = new Date(end.getTime() - 7 * 864e5);
    var rooms = (this._store().rooms || []).filter(function (r) { return r.key !== "thermostat" && r.entity; }).map(function (r) { return r.entity; });
    var day = new Date(end.getTime() - 864e5);
    Promise.all([
      this._hass.callWS({ type: "history/history_during_period", start_time: start.toISOString(), end_time: end.toISOString(), entity_ids: [this._config.entity], minimal_response: false, no_attributes: false, significant_changes_only: false }),
      rooms.length ? this._hass.callWS({ type: "history/history_during_period", start_time: day.toISOString(), end_time: end.toISOString(), entity_ids: rooms, minimal_response: true, no_attributes: true, significant_changes_only: false }) : Promise.resolve({}),
    ]).then(function (r) {
      self._histBusy = false;
      self._hist = { at: Date.now(), climate: (r[0] || {})[self._config.entity] || [], rooms: r[1] || {} };
      self._sig = "";
      self._update();
    }, function () { self._histBusy = false; self._hist = { at: Date.now(), climate: [], rooms: {}, err: true }; self._sig = ""; self._update(); });
  };

  function tsOf(e) { return (e.lu || e.lc || 0) * 1000 || Date.parse(e.last_updated || e.last_changed || 0); }

  EchoClimateCard.prototype._renderIns = function () {
    if (!this._hist) { this._insEl.innerHTML = '<div class="loading">Loading history…</div>'; return; }
    var u = this._unit(), store = this._store(), L = store.learn || {}, f = store.filter || {};
    var hist = this._hist.climate, now = Date.now(), day0 = now - 864e5;
    // walk the climate history: run time per day and the 24 h series
    var pts = [], runs = {}, prev = null, A = null;
    hist.forEach(function (e) {
      if (e.a) A = e.a;
      var t = tsOf(e), st = e.s !== undefined ? e.s : e.state;
      var cur = { t: t, s: st, a: A || {} };
      if (prev) {
        var act = prev.a.hvac_action, from = prev.t, to = t;
        if (act === "heating" || act === "cooling") addRun(runs, act, from, to);
      }
      prev = cur;
      if (t >= day0 - 3600e3) pts.push(cur);
    });
    if (prev && (prev.a.hvac_action === "heating" || prev.a.hvac_action === "cooling")) addRun(runs, prev.a.hvac_action, prev.t, now);
    if (prev) pts.push({ t: now, s: prev.s, a: prev.a });

    var h = '<div class="panel chart"><div class="ch"><div class="lbl">Last 24 hours</div>' +
      '<span class="key"><i style="background:#fff"></i>Thermostat</span>';
    var rooms = (store.rooms || []).filter(function (r) { return r.key !== "thermostat"; });
    var rcol = ["#c9b8ff", "#8ff0d6", "#ffd66b"];
    rooms.forEach(function (r, i) { h += '<span class="key"><i style="background:' + rcol[i % 3] + '"></i>' + esc(r.name) + "</span>"; });
    h += '<span class="key"><i style="background:' + HEAT + '"></i>Heat to</span><span class="key"><i style="background:' + COOL + '"></i>Cool to</span></div>';
    h += this._chartSvg(pts, day0, now, rooms, rcol) + "</div>";

    // week bars
    var days = [], max = 0.5;
    for (var i = 6; i >= 0; i--) {
      var d = new Date(now - i * 864e5), k = d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate();
      var rr = runs[k] || { heating: 0, cooling: 0 };
      days.push({ d: d, h: rr.heating / 36e5, c: rr.cooling / 36e5 });
      max = Math.max(max, (rr.heating + rr.cooling) / 36e5);
    }
    var totH = 0, totC = 0;
    var bars = days.map(function (x, j) {
      totH += x.h; totC += x.c;
      return '<div class="bar' + (j === 6 ? " today" : "") + '"><div class="bv">' + (x.h + x.c >= 0.05 ? (x.h + x.c).toFixed(1) : "") + '</div><div class="bs" style="height:' + Math.max(1, (x.h + x.c) / max * 82) + '%">' +
        '<div class="bh" style="height:' + (x.h + x.c ? x.h / (x.h + x.c) * 100 : 0) + '%"></div><div class="bc" style="height:' + (x.h + x.c ? x.c / (x.h + x.c) * 100 : 0) + '%"></div></div>' +
        '<div class="bl">' + DAY_SHORT[dayKey(x.d)].charAt(0) + "</div></div>";
    }).join("");
    var fh = f.hours || 0, fl = f.limit || 300, due = fh >= fl;
    var c = this._st(this._config.entity), bat = null;
    if (c) { var bs = this._st("sensor." + this._config.entity.split(".")[1] + "_battery_level"); bat = bs ? num(bs.state) : null; }
    h += '<div class="icol"><div class="panel ibox"><div class="lbl">Run time this week</div><div class="bars">' + bars + "</div>" +
      '<div class="ist"><div><b style="color:#ffb08a">' + totH.toFixed(1) + "h</b><span>heating</span></div><div><b style=\"color:#9fd4ff\">" + totC.toFixed(1) + "h</b><span>cooling</span></div></div></div>" +
      '<div class="panel ibox"><div class="lbl">Smart recovery has learned</div><div class="ist"><div><b>' + fmtT(L.heat_rate, "C") + "°/h</b><span>warming up (" + (L.heat_n || 0) + " runs)</span></div><div><b>" + fmtT(L.cool_rate, "C") + "°/h</b><span>cooling down (" + (L.cool_n || 0) + " runs)</span></div></div></div>" +
      '<div class="panel ibox"><div class="lbl">Air filter</div><div class="fbar"><div style="width:' + Math.min(100, fh / fl * 100) + '%"></div></div>' +
      '<div class="frow"><div class="ft">' + Math.round(fh) + " of " + fl + " run hours" + (f.changed ? " · changed " + esc(new Date(f.changed + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })) : "") +
      (bat !== null ? " · thermostat battery " + Math.round(bat) + "%" : "") + '</div><div class="fdone' + (due ? " due" : "") + '" role="button" data-a="filter">' + (due ? "I changed it" : "Changed it") + "</div></div></div></div>";
    if (this._insEl.innerHTML !== h) this._insEl.innerHTML = h;
  };

  function addRun(runs, act, from, to) {
    while (from < to) {
      var d = new Date(from), k = d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate();
      var next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
      var e = Math.min(to, next);
      runs[k] = runs[k] || { heating: 0, cooling: 0 };
      runs[k][act] += e - from;
      from = e;
    }
  }

  EchoClimateCard.prototype._chartSvg = function (pts, t0, t1, rooms, rcol) {
    var W = 600, H = 300, padL = 26, padB = 22, padT = 8, self = this;
    if (!pts.length) return '<div class="loading">No history yet</div>';
    var vals = [];
    pts.forEach(function (p) {
      ["current_temperature", "target_temp_low", "target_temp_high", "temperature"].forEach(function (k) { var v = num(p.a[k]); if (v !== null) vals.push(v); });
    });
    var rs = this._hist.rooms || {};
    rooms.forEach(function (r) { (rs[r.entity] || []).forEach(function (e) { var v = num(e.s !== undefined ? e.s : e.state); if (v !== null) vals.push(v); }); });
    if (!vals.length) return '<div class="loading">No history yet</div>';
    var lo = Math.floor(Math.min.apply(null, vals) - 1), hi = Math.ceil(Math.max.apply(null, vals) + 1);
    var X = function (t) { return padL + (clamp(t, t0, t1) - t0) / (t1 - t0) * (W - padL - 4); };
    var Y = function (v) { return padT + (hi - v) / (hi - lo) * (H - padT - padB); };
    var s = '<svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none">';
    // grid + labels
    var gs = hi - lo > 12 ? 5 : 2;
    for (var g = Math.ceil(lo / gs) * gs; g <= hi; g += gs) {
      s += '<line x1="' + padL + '" x2="' + W + '" y1="' + Y(g) + '" y2="' + Y(g) + '" style="stroke:rgba(255,255,255,.07)"/><text x="' + (padL - 5) + '" y="' + (Y(g) + 3.5) + '" text-anchor="end" style="fill:rgba(255,255,255,.4);font-size:10px">' + g + "°</text>";
    }
    for (var hh = 0; hh <= 24; hh += 6) {
      var tt = t0 + hh * 36e5, xx = X(tt);
      s += '<line x1="' + xx + '" x2="' + xx + '" y1="' + padT + '" y2="' + (H - padB) + '" style="stroke:rgba(255,255,255,.05)"/>' +
        '<text x="' + Math.min(W - 18, Math.max(padL + 12, xx)) + '" y="' + (H - 6) + '" text-anchor="middle" style="fill:rgba(255,255,255,.4);font-size:10px">' + (hh === 24 ? "now" : esc(self._fmtTime(new Date(tt), true))) + "</text>";
    }
    // running bands
    for (var i = 0; i < pts.length - 1; i++) {
      var act = pts[i].a.hvac_action;
      if (act === "heating" || act === "cooling") {
        var x1 = X(pts[i].t), x2 = X(pts[i + 1].t);
        if (x2 - x1 > 0.2) s += '<rect x="' + x1 + '" y="' + padT + '" width="' + (x2 - x1) + '" height="' + (H - padT - padB) + '" style="fill:' + (act === "heating" ? "rgba(255,122,61,.13)" : "rgba(58,168,255,.13)") + '"/>';
      }
    }
    var step = function (key, alt, col, dash) {
      var d = "", last = null;
      pts.forEach(function (p) {
        var v = num(p.a[key]);
        if (v === null && alt) v = alt(p);
        if (v === null) { last = null; return; }
        var x = X(p.t), y = Y(v);
        d += last === null ? "M" + x.toFixed(1) + " " + y.toFixed(1) : "H" + x.toFixed(1) + "V" + y.toFixed(1);
        last = y;
      });
      if (last !== null) d += "H" + X(t1).toFixed(1);
      return d ? '<path d="' + d + '" style="fill:none;stroke:' + col + ";stroke-width:" + (dash ? 1.6 : 2.2) + (dash ? ";stroke-dasharray:4 3" : "") + ';opacity:.95"/>' : "";
    };
    s += step("target_temp_low", function (p) { return p.s === "heat" ? num(p.a.temperature) : null; }, HEAT, true);
    s += step("target_temp_high", function (p) { return p.s === "cool" ? num(p.a.temperature) : null; }, COOL, true);
    rooms.forEach(function (r, ri) {
      var d = "", pen = false;
      (rs[r.entity] || []).forEach(function (e) {
        var v = num(e.s !== undefined ? e.s : e.state), t = tsOf(e);
        if (v === null) { pen = false; return; }
        d += (pen ? "L" : "M") + X(t).toFixed(1) + " " + Y(v).toFixed(1);
        pen = true;
      });
      if (d) s += '<path d="' + d + '" style="fill:none;stroke:' + rcol[ri % 3] + ';stroke-width:1.6;opacity:.85"/>';
    });
    var d2 = "", pen2 = false;
    pts.forEach(function (p) {
      var v = num(p.a.current_temperature);
      if (v === null) { pen2 = false; return; }
      d2 += (pen2 ? "L" : "M") + X(p.t).toFixed(1) + " " + Y(v).toFixed(1);
      pen2 = true;
    });
    s += '<path d="' + d2 + '" style="fill:none;stroke:#fff;stroke-width:2.6;stroke-linejoin:round"/>';
    return s + "</svg>";
  };

  EchoClimateCard.prototype._filterDone = function () {
    var self = this;
    var d = new Date(), iso = d.getFullYear() + "-" + (d.getMonth() < 9 ? "0" : "") + (d.getMonth() + 1) + "-" + (d.getDate() < 10 ? "0" : "") + d.getDate();
    this._call(this._config.set_script, { data: { filter: { hours: 0, changed: iso, notified: false } } }).then(function () {
      self._toast("Filter reset. Next reminder after " + ((self._store().filter || {}).limit || 300) + " run hours");
      self._hass.callService("persistent_notification", "dismiss", { notification_id: "echo_climate_filter" }).catch(function () {});
    });
  };

  // ---------- timers on the nav buttons + the countdown overlay (like the other pages) ----------
  EchoClimateCard.prototype._timersFor = function (btn) {
    if (!btn.timers) return null;
    var pfx = this._config.timer_prefix || ownTimers(this._hass);
    if (!pfx) return btn.timers;
    var out = [];
    for (var i = 1; i <= 3; i++) out.push("timer." + pfx + "_" + i);
    return out;
  };
  EchoClimateCard.prototype._overlayTimers = function () {
    var b = this._config.buttons;
    for (var i = 0; i < b.length; i++) if (b[i].timers) return this._timersFor(b[i]);
    return [];
  };
  EchoClimateCard.prototype._updateOverlay = function () {
    var el = this._ovEl;
    if (!el || !el.update) return;
    var b = this._config.buttons;
    for (var i = 0; i < b.length; i++) if (b[i].timers) { el.path = b[i].navigation_path || null; break; }
    el.update(this._hass, this._overlayTimers());
  };
  function parseHms(s) {
    var p = String(s || "").split(":");
    return p.length === 3 ? parseInt(p[0], 10) * 3600 + parseInt(p[1], 10) * 60 + parseFloat(p[2]) : 0;
  }
  function fmtCountdown(sec) {
    sec = Math.max(0, Math.ceil(sec));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (h > 0 ? h + ":" + (m < 10 ? "0" : "") + m : String(m)) + ":" + (s < 10 ? "0" : "") + s;
  }
  EchoClimateCard.prototype._updateBadges = function () {
    var buttons = this._config.buttons, st = this._hass.states, info = [], sig = "";
    for (var i = 0; i < buttons.length; i++) {
      if (!buttons[i].timers) continue;
      var b = { i: i, done: false, finishes: 0, paused: 0, running: [] }, list = this._timersFor(buttons[i]);
      for (var j = 0; j < list.length; j++) {
        var t = st[list[j]];
        if (!t) continue;
        var nm = st["input_text." + list[j].split(".")[1] + "_name"];
        var named = nm && nm.state && nm.state !== "unknown" && nm.state !== "unavailable";
        if (t.state === "active" || t.state === "paused") b.running.push(list[j]);
        if (t.state === "active" && t.attributes.finishes_at) {
          var f = Date.parse(t.attributes.finishes_at);
          if (!b.finishes || f < b.finishes) b.finishes = f;
        } else if (t.state === "paused") {
          var r = parseHms(t.attributes.remaining);
          if (!b.paused || r < b.paused) b.paused = r;
        } else if (t.state === "idle" && named) b.done = true;
        sig += list[j] + t.last_updated + (nm ? nm.state : "") + "|";
      }
      info.push(b);
    }
    if (!info.length) return;
    var armed = !!this._runSeen && this.isConnected;
    if (!this.isConnected) { this._runSeen = null; this._doneSeen = null; }
    else if (!armed) { this._runSeen = {}; this._doneSeen = {}; }
    for (var q = 0; this.isConnected && q < info.length; q++) {
      var bt = buttons[info[q].i], prev = this._runSeen[info[q].i], started = false;
      if (prev) info[q].running.forEach(function (id) { if (prev.indexOf(id) === -1) started = true; });
      if (armed && bt.navigation_path && ((info[q].done && !this._doneSeen[info[q].i] && bt.open_on_done) || (started && bt.open_on_start))) this._buttonTap(bt);
      this._doneSeen[info[q].i] = info[q].done;
      this._runSeen[info[q].i] = info[q].running;
    }
    if (sig !== this._badgeSig) { this._badgeSig = sig; this._badges = info; this._paintBadges(); }
    var any = info.some(function (x) { return x.finishes; }), self = this;
    if (any && !this._badgeTick) this._badgeTick = setInterval(function () { self._paintBadges(); }, 1000);
    if (!any && this._badgeTick) { clearInterval(this._badgeTick); this._badgeTick = null; }
  };
  EchoClimateCard.prototype._paintBadges = function () {
    var info = this._badges || [];
    for (var i = 0; i < info.length; i++) {
      var el = this.shadowRoot.querySelector('.bdg[data-i="' + info[i].i + '"]');
      if (!el) continue;
      var b = info[i], txt = b.done ? "Done" : b.finishes ? fmtCountdown((b.finishes - Date.now()) / 1000) : b.paused ? fmtCountdown(b.paused) : "";
      if (el.textContent !== txt) el.textContent = txt;
      if (b.done !== el.classList.contains("done")) el.classList.toggle("done");
    }
  };

  // ---------- back to the home view after a while ----------
  EchoClimateCard.prototype._touch = function () { this._lastAct = Date.now(); };
  EchoClimateCard.prototype._startIdle = function () {
    var self = this;
    this._touch();
    if (this._idleT || !this._config || !this._config.idle_timeout || !this._config.idle_path) return;
    this._idleT = setInterval(function () {
      if (self._daySheet || self._houseSheet || self._settingsEl || self._comfDraft || (self._draft && self._draft.dragging)) { self._touch(); return; }
      if (Date.now() - self._lastAct >= self._config.idle_timeout * 1000) { self._touch(); navigate(self._config.idle_path); }
    }, 5000);
  };
  EchoClimateCard.prototype._stopIdle = function () {
    if (this._idleT) { clearInterval(this._idleT); this._idleT = null; }
  };

  if (!customElements.get("echo-climate-card")) customElements.define("echo-climate-card", EchoClimateCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "echo-climate-card",
    name: "Echo Climate Card",
    description: "Full-screen thermostat for wall tablets: schedule, holds, comfort profiles, house mode",
  });
  console.info("%c echo-climate-card " + VERSION + " ", "background:#ff7a3d;color:#000;border-radius:3px");
})();

/* ===== echo-notify.js ===== */
/*
 * echo-notify
 * Full-screen, must-dismiss notification layer for the Echo Show kiosk dashboards
 * (companion to echo-weather-card / echo-timer-card / echo-media-card).
 *
 * Load it once as a dashboard resource. It stays idle on every dashboard except the
 * ones whose config has a top-level `echo_notify:` block, so desktop dashboards are
 * never affected. The overlay lives on document.body, above every view, so it keeps
 * showing while the cards navigate between Weather / Timers / Media.
 *
 * Sources (each can be turned on/off in the config):
 *   nws                      National Weather Service active alerts (api.weather.gov),
 *                            polled from this browser for the HA home location.
 *   persistent_notifications HA persistent notifications whose id starts with "echo_"
 *                            (create them from any automation; dismissing on the
 *                            display dismisses them in HA too).
 *   events                   `echo_notify` events on the HA bus (richer options; needs
 *                            the kiosk's HA user to be an administrator).
 * Other cards / the browser console can use window.echoNotify.show({...}).
 *
 * Plain JavaScript, no dependencies, no build step. ES5-ish for older Chromium.
 */
(function () {
  "use strict";

  var VERSION = "1.3.0";
  if (window.echoNotify && window.echoNotify.version) return;  // loaded twice

  var LS_DISMISSED = "echo-notify-dismissed";

  var SEV = {
    info:     { rank: 0, color: "#4aa3ff", icon: "mdi:information-outline",  label: "Notice" },
    minor:    { rank: 1, color: "#4aa3ff", icon: "mdi:alert-circle-outline", label: "Minor" },
    moderate: { rank: 2, color: "#ffc233", icon: "mdi:alert-outline",        label: "Moderate" },
    severe:   { rank: 3, color: "#ff8a1f", icon: "mdi:alert",                label: "Severe" },
    extreme:  { rank: 4, color: "#ff3b3b", icon: "mdi:alert-octagon",        label: "Extreme" },
  };
  function sev(s) { s = String(s || "info").toLowerCase(); return SEV[s] ? s : "info"; }

  // Icons for common NWS event names (first match wins).
  var NWS_ICONS = [
    [/tornado/i, "mdi:weather-tornado"],
    [/hurricane|tropical/i, "mdi:weather-hurricane"],
    [/thunderstorm/i, "mdi:weather-lightning-rainy"],
    [/flood/i, "mdi:home-flood"],
    [/winter|snow|blizzard|ice|freez|frost|sleet/i, "mdi:snowflake-alert"],
    [/wind|gale/i, "mdi:weather-windy"],
    [/heat/i, "mdi:thermometer-alert"],
    [/cold|chill/i, "mdi:thermometer-low"],
    [/fire|red flag/i, "mdi:fire-alert"],
    [/smoke|air quality|dust/i, "mdi:smoke"],
    [/fog/i, "mdi:weather-fog"],
    [/tsunami|surf|marine|rip current|coastal/i, "mdi:waves"],
    [/earthquake/i, "mdi:earth"],
  ];

  var DEFAULTS = {
    sound: true,          // chime when a new notification appears
    sound_repeat: 0,      // seconds between repeat chimes for severe/extreme (0 = once)
    sources: {
      nws: { enabled: false, interval: 300, min_severity: "minor", exclude: [], latitude: null, longitude: null, zone: null },
      persistent_notifications: { enabled: true, prefix: "echo_" },
      events: { enabled: true, event_type: "echo_notify" },
    },
    devices: [],
  };

  function esc(s) {
    return String(s === undefined || s === null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function merge(a, b) {
    var o = {}, k;
    for (k in a) o[k] = a[k];
    if (b) for (k in b) {
      if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k]) && a[k] && typeof a[k] === "object" && !Array.isArray(a[k])) o[k] = merge(a[k], b[k]);
      else o[k] = b[k];
    }
    return o;
  }
  function log() {
    var a = ["%c echo-notify ", "background:#ff8a1f;color:#000;border-radius:3px"];
    for (var i = 0; i < arguments.length; i++) a.push(arguments[i]);
    console.info.apply(console, a);
  }

  // ---------- which display is this? (same rules as the other echo cards) ----------
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

  // ---------- dismissed ids (per display, kept until the alert would have expired) ----------
  var Dismissed = {
    _load: function () {
      try { return JSON.parse(window.localStorage.getItem(LS_DISMISSED) || "{}") || {}; } catch (e) { return {}; }
    },
    has: function (id) { return !!this._load()[id]; },
    add: function (id, until) {
      var d = this._load(), now = Date.now(), k;
      d[id] = until && until > now ? until : now + 7 * 864e5;
      for (k in d) if (d[k] < now) delete d[k];
      try { window.localStorage.setItem(LS_DISMISSED, JSON.stringify(d)); } catch (e) { /* ignore */ }
    },
    clear: function () { try { window.localStorage.removeItem(LS_DISMISSED); } catch (e) { /* ignore */ } },
  };

  // ---------- chime (Web Audio, no files) ----------
  var Chime = (function () {
    var ctx = null;
    function play(level) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        if (!ctx) ctx = new AC();
        if (ctx.state === "suspended") ctx.resume();
        var notes = level >= 3 ? [880, 660, 880, 660] : [660, 880];
        var t = ctx.currentTime + 0.05;
        notes.forEach(function (f, i) {
          var o = ctx.createOscillator(), g = ctx.createGain();
          o.type = "sine"; o.frequency.value = f;
          g.gain.setValueAtTime(0.0001, t + i * 0.28);
          g.gain.exponentialRampToValueAtTime(0.35, t + i * 0.28 + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.28 + 0.26);
          o.connect(g); g.connect(ctx.destination);
          o.start(t + i * 0.28); o.stop(t + i * 0.28 + 0.3);
        });
      } catch (e) { /* audio unavailable */ }
    }
    return { play: play };
  })();

  // ---------- text helpers ----------
  // NWS text is hard-wrapped at ~70 chars with blank lines between paragraphs, and
  // sections like "* WHAT...Winds 25 mph". Turn it into readable HTML.
  function nwsText(s) {
    if (!s) return "";
    return String(s).replace(/\r/g, "").split(/\n\s*\n/).map(function (p) {
      p = p.replace(/\s*\n\s*/g, " ").trim();
      if (!p) return "";
      var m = /^\*\s*([A-Z][A-Z \/]+?)\.\.\.\s*([\s\S]*)$/.exec(p);
      if (m) return '<p><b>' + esc(m[1].charAt(0) + m[1].slice(1).toLowerCase()) + ':</b> ' + esc(m[2]) + "</p>";
      return "<p>" + esc(p) + "</p>";
    }).join("");
  }
  function rgba(hex, a) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ""));
    if (!m) return "rgba(255,255,255," + a + ")";
    return "rgba(" + parseInt(m[1], 16) + "," + parseInt(m[2], 16) + "," + parseInt(m[3], 16) + "," + a + ")";
  }
  function plainText(s) {
    if (!s) return "";
    return String(s).split(/\n\s*\n/).map(function (p) { return "<p>" + esc(p).replace(/\n/g, "<br>") + "</p>"; }).join("");
  }
  function fmtTime(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d)) return "";
    var today = new Date(), tm = new Date(today.getTime() + 864e5);
    var time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (d.toDateString() === today.toDateString()) return "today " + time;
    if (d.toDateString() === tm.toDateString()) return "tomorrow " + time;
    return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) + " " + time;
  }

  // ---------- the overlay ----------
  var STYLE = [
    ":host{all:initial;}",
    ".wrap{position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(2,4,10,.72);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);font-family:var(--es-font,var(--ha-font-family-body,Roboto,'Helvetica Neue',Arial,sans-serif));color:#fff;-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none;animation:fade .25s ease-out;}",
    "@keyframes fade{from{opacity:0}to{opacity:1}}",
    "@keyframes pop{from{transform:scale(.94);opacity:0}to{transform:scale(1);opacity:1}}",
    "@keyframes pulse{0%,100%{box-shadow:0 0 0 0 var(--c)}50%{box-shadow:0 0 0 1.4vh transparent}}",
    ".panel{position:relative;display:flex;flex-direction:column;width:86vw;max-height:90vh;box-sizing:border-box;background:linear-gradient(180deg,var(--es-pan1,#1c2540),var(--es-pan2,#121829));border:1px solid rgba(255,255,255,.1);border-radius:3.4vh;box-shadow:0 20px 60px rgba(0,0,0,.6);overflow:hidden;animation:pop .3s ease-out;}",
    ".bar{height:1.4vh;background:var(--c);flex:0 0 auto;}",
    ".hd{display:flex;align-items:center;gap:2.6vh;padding:3vh 3.6vh 2vh;flex:0 0 auto;}",
    ".ic{flex:0 0 auto;width:11vh;height:11vh;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--c22);color:var(--c);}",
    ".lv3 .ic,.lv4 .ic{animation:pulse 1.6s ease-in-out infinite;}",
    ".ic ha-icon{--mdc-icon-size:6.4vh;width:6.4vh;height:6.4vh;display:inline-flex;}",
    ".tt{flex:1 1 auto;min-width:0;}",
    ".kick{font-size:2.5vh;letter-spacing:.1em;text-transform:uppercase;color:var(--c);font-weight:500;margin-bottom:.6vh;}",
    ".title{font-size:5.2vh;line-height:1.1;font-weight:500;}",
    ".sub{font-size:2.8vh;opacity:.7;margin-top:.8vh;line-height:1.3;}",
    ".count{flex:0 0 auto;align-self:flex-start;font-size:2.6vh;padding:.8vh 1.8vh;border-radius:2vh;background:rgba(255,255,255,.1);opacity:.85;}",
    ".meta{display:flex;flex-wrap:wrap;gap:1.2vh;padding:0 3.6vh 1.6vh;flex:0 0 auto;}",
    ".chip{font-size:2.5vh;padding:.8vh 1.8vh;border-radius:2vh;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.08);}",
    ".body{flex:1 1 auto;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:0 3.6vh;font-size:3vh;line-height:1.45;color:rgba(255,255,255,.9);user-select:text;-webkit-user-select:text;touch-action:pan-y;}",
    ".body p{margin:0 0 1.6vh;}",
    ".body b{color:#fff;font-weight:500;}",
    ".inst{margin-top:1vh;padding:1.8vh 2.2vh;border-radius:2vh;background:var(--c14);border-left:.6vh solid var(--c);}",
    ".inst h4{margin:0 0 1vh;font-size:2.5vh;letter-spacing:.1em;text-transform:uppercase;font-weight:500;color:var(--c);}",
    ".ft{display:flex;gap:2vh;padding:2.4vh 3.6vh 3vh;flex:0 0 auto;}",
    ".btn{flex:1 1 auto;height:10vh;border-radius:5vh;display:flex;align-items:center;justify-content:center;font-size:3.8vh;font-weight:500;cursor:pointer;background:var(--c);color:#0b0f1a;}",
    ".btn.all{flex:0 0 auto;padding:0 4vh;background:rgba(255,255,255,.12);color:#fff;font-weight:400;}",
    ".btn ha-icon{--mdc-icon-size:4.6vh;width:4.6vh;height:4.6vh;display:inline-flex;margin-right:1.2vh;}",
    ".btn:active{transform:scale(.97);}",
  ].join("");

  function Overlay(onDismiss, onDismissAll) {
    this.host = null;
    this.root = null;
    this.onDismiss = onDismiss;
    this.onDismissAll = onDismissAll;
  }
  Overlay.prototype._ensure = function () {
    if (this.host && this.host.isConnected) return;
    var host = document.createElement("echo-notify-layer");
    var root = host.attachShadow({ mode: "open" });
    var self = this;
    // Keep touches from reaching the kiosk's swipe-between-views handlers underneath.
    ["touchstart", "touchmove", "touchend", "pointerdown", "mousedown", "wheel", "keydown"].forEach(function (t) {
      host.addEventListener(t, function (ev) { ev.stopPropagation(); }, { passive: true });
    });
    root.addEventListener("click", function (ev) {
      var t = ev.target.closest ? ev.target.closest("[data-act]") : null;
      if (!t) return;
      ev.stopPropagation();
      if (t.getAttribute("data-act") === "dismiss") self.onDismiss();
      else if (t.getAttribute("data-act") === "all") self.onDismissAll();
    });
    document.body.appendChild(host);
    this.host = host; this.root = root;
  };
  Overlay.prototype.hide = function () {
    if (this.host) { this.host.remove(); this.host = null; this.root = null; }
    this._shown = null;
  };
  Overlay.prototype.render = function (n, pos, total) {
    this._ensure();
    var sig = n.key + "|" + pos + "|" + total;
    if (this._shown === sig) return;
    var first = !this._shown || this._shown.split("|")[0] !== n.key;
    this._shown = sig;
    var s = SEV[n.severity];
    var col = n.color || s.color;
    var meta = (n.meta || []).filter(Boolean).map(function (m) { return '<span class="chip">' + esc(m) + "</span>"; }).join("");
    var html =
      "<style>" + STYLE + "</style>" +
      '<div class="wrap lv' + s.rank + '" style="--c:' + esc(col) + ";--c22:" + rgba(col, .22) + ";--c14:" + rgba(col, .14) + '">' +
      '<div class="panel" role="alertdialog" aria-modal="true">' +
      '<div class="bar"></div>' +
      '<div class="hd">' +
      '<div class="ic"><ha-icon icon="' + esc(n.icon || s.icon) + '"></ha-icon></div>' +
      '<div class="tt">' +
      (n.kicker ? '<div class="kick">' + esc(n.kicker) + "</div>" : "") +
      '<div class="title">' + esc(n.title || "Notification") + "</div>" +
      (n.subtitle ? '<div class="sub">' + esc(n.subtitle) + "</div>" : "") +
      "</div>" +
      (total > 1 ? '<div class="count">' + pos + " of " + total + "</div>" : "") +
      "</div>" +
      (meta ? '<div class="meta">' + meta + "</div>" : "") +
      '<div class="body">' + (n.html || plainText(n.message)) +
      (n.instruction ? '<div class="inst"><h4>What to do</h4>' + (n.instructionHtml || plainText(n.instruction)) + "</div>" : "") +
      "</div>" +
      '<div class="ft">' +
      (total > 1 ? '<div class="btn all" data-act="all">Dismiss all</div>' : "") +
      '<div class="btn" data-act="dismiss"><ha-icon icon="mdi:check"></ha-icon>' + esc(n.button || (total > 1 ? "Dismiss & next" : "Dismiss")) + "</div>" +
      "</div></div></div>";
    this.root.innerHTML = html;
    if (!first) { var w = this.root.querySelector(".wrap"), p = this.root.querySelector(".panel"); if (w) w.style.animation = "none"; if (p) p.style.animation = "none"; }
  };

  // ---------- the manager ----------
  function Manager() {
    this.hass = null;
    this.conn = null;
    this.cfg = null;           // effective config for the current dashboard, or null (idle)
    this.dash = null;          // url_path the config belongs to
    this.items = {};           // key -> notification
    this.sources = {};         // source name -> { stop() }
    this.overlay = new Overlay(this._dismissTop.bind(this), this._dismissAll.bind(this));
    this._seen = {};
    this._repeatT = null;
  }

  Manager.prototype.start = function () {
    var self = this;
    var tries = 0;
    (function wait() {
      var ha = document.querySelector("home-assistant");
      if (ha && ha.hass && ha.hass.connection) {
        self.hass = ha.hass;
        self.conn = ha.hass.connection;
        self._watchHass(ha);
        self._route();
        window.addEventListener("location-changed", function () { setTimeout(function () { self._route(); }, 50); });
        window.addEventListener("popstate", function () { self._route(); });
        self.conn.addEventListener("ready", function () { self._restartSources(); });
        return;
      }
      if (tries++ < 600) setTimeout(wait, 500);
    })();
  };

  // hass is replaced on every state change; keep a fresh reference.
  Manager.prototype._watchHass = function (ha) {
    var self = this;
    setInterval(function () { if (ha.hass) self.hass = ha.hass; }, 2000);
  };

  Manager.prototype._route = function () {
    var dash = (window.location.pathname.split("/")[1] || "lovelace");
    if (dash === this.dash) return;
    this.dash = dash;
    var self = this;
    this.hass.callWS({ type: "lovelace/config", url_path: dash === "lovelace" ? null : dash }).then(function (c) {
      if (self.dash !== dash) return;
      var raw = c && c.echo_notify;
      if (!raw) { self._deactivate(); return; }
      echoDisplayName().then(function (name) {
        var prof = matchDisplay(raw.devices, name);
        var cfg = merge(DEFAULTS, raw);
        if (prof) { var p = {}, k; for (k in prof) if (k !== "match") p[k] = prof[k]; cfg = merge(cfg, p); }
        self._display = name;
        self._activate(cfg);
      });
    }, function () { self._deactivate(); });
  };

  Manager.prototype._activate = function (cfg) {
    var same = this.cfg && JSON.stringify(this.cfg) === JSON.stringify(cfg);
    this.cfg = cfg;
    if (!same) this._restartSources();
    this._paint();
  };
  Manager.prototype._deactivate = function () {
    this.cfg = null;
    this._stopSources();
    this.items = {};
    this._paint();
  };

  Manager.prototype._stopSources = function () {
    for (var k in this.sources) { try { this.sources[k].stop(); } catch (e) { /* ignore */ } }
    this.sources = {};
  };
  Manager.prototype._restartSources = function () {
    this._stopSources();
    if (!this.cfg) return;
    var s = this.cfg.sources || {};
    if (s.nws && s.nws.enabled) this.sources.nws = NwsSource(this, s.nws);
    if (s.persistent_notifications && s.persistent_notifications.enabled) this.sources.pn = PnSource(this, s.persistent_notifications);
    if (s.events && s.events.enabled) this.sources.ev = EventSource(this, s.events);
  };

  // Replace all items from one source with a new set (sources call this).
  Manager.prototype.setSource = function (source, list) {
    var k;
    for (k in this.items) if (this.items[k].source === source) delete this.items[k];
    (list || []).forEach(function (n) { n.source = source; this._add(n); }, this);
    this._paint();
  };
  Manager.prototype.add = function (n) { this._add(n); this._paint(); return n.key; };
  Manager.prototype._add = function (n) {
    n.severity = sev(n.severity);
    n.key = n.source + ":" + (n.id || ("n" + Date.now() + Math.random().toString(36).slice(2, 6)));
    n.ts = n.ts || Date.now();
    if (n.persist !== false && Dismissed.has(n.key)) return;
    this.items[n.key] = n;
  };
  Manager.prototype.remove = function (source, id) {
    delete this.items[source + ":" + id];
    this._paint();
  };

  Manager.prototype._queue = function () {
    var list = [], k;
    for (k in this.items) list.push(this.items[k]);
    list.sort(function (a, b) { return (SEV[b.severity].rank - SEV[a.severity].rank) || (a.ts - b.ts); });
    return list;
  };

  // Chime on this display? The settings panel's per-display choice wins over the config.
  Manager.prototype._sound = function () {
    var p = window.EchoShow ? window.EchoShow.prefs.get("notify_sound") : null;
    return p !== null && p !== undefined ? !!p : !!(this.cfg && this.cfg.sound);
  };

  Manager.prototype._paint = function () {
    var q = this.cfg ? this._queue() : [];
    if (!q.length) { this.overlay.hide(); this._stopRepeat(); return; }
    var top = q[0];
    this.overlay.render(top, 1, q.length);
    if (!this._seen[top.key]) {
      this._seen[top.key] = true;
      if (this._sound() && top.sound !== false) Chime.play(SEV[top.severity].rank);
      this._startRepeat(top);
    }
  };
  Manager.prototype._startRepeat = function (n) {
    this._stopRepeat();
    var every = Number(this.cfg.sound_repeat) || 0;
    if (!every || !this._sound() || n.sound === false || SEV[n.severity].rank < 3) return;
    var self = this;
    this._repeatT = setInterval(function () {
      var q = self._queue();
      if (!q.length || q[0].key !== n.key) { self._stopRepeat(); return; }
      Chime.play(SEV[n.severity].rank);
    }, every * 1000);
  };
  Manager.prototype._stopRepeat = function () { if (this._repeatT) { clearInterval(this._repeatT); this._repeatT = null; } };

  Manager.prototype._dismiss = function (n) {
    delete this.items[n.key];
    if (n.persist !== false) Dismissed.add(n.key, n.until);
    if (typeof n.onDismiss === "function") { try { n.onDismiss(n); } catch (e) { /* ignore */ } }
  };
  Manager.prototype._dismissTop = function () {
    var q = this._queue();
    if (q.length) this._dismiss(q[0]);
    this._paint();
  };
  Manager.prototype._dismissAll = function () {
    this._queue().forEach(this._dismiss, this);
    this._paint();
  };

  // ---------- source: National Weather Service ----------
  var NWS_RANK = { unknown: 0, minor: 1, moderate: 2, severe: 3, extreme: 4 };

  function nwsToNote(f) {
    var p = f.properties || {};
    var s = String(p.severity || "").toLowerCase();
    var level = NWS_RANK[s] !== undefined ? s : "minor";
    if (level === "unknown") level = "minor";
    var icon = null;
    for (var i = 0; i < NWS_ICONS.length; i++) if (NWS_ICONS[i][0].test(p.event || "")) { icon = NWS_ICONS[i][1]; break; }
    var ends = p.ends || p.expires;
    return {
      id: p.id || f.id,
      severity: level,
      icon: icon || SEV[level].icon,
      kicker: "National Weather Service · " + (p.severity || "Alert"),
      title: p.event || "Weather alert",
      subtitle: p.headline || "",
      meta: [
        p.onset || p.effective ? "From " + fmtTime(p.onset || p.effective) : "",
        ends ? "Until " + fmtTime(ends) : "",
        p.urgency && p.urgency !== "Unknown" ? "Urgency: " + p.urgency : "",
        p.areaDesc ? p.areaDesc.split(";").slice(0, 3).join(";") + (p.areaDesc.split(";").length > 3 ? "…" : "") : "",
      ],
      html: nwsText(p.description),
      instruction: p.instruction || "",
      instructionHtml: nwsText(p.instruction),
      until: ends ? new Date(ends).getTime() + 36e5 : null,
    };
  }

  function nwsUrl(mgr, c) {
    if (c.zone) return "https://api.weather.gov/alerts/active?zone=" + encodeURIComponent([].concat(c.zone).join(","));
    var lat = c.latitude != null ? c.latitude : mgr.hass.config.latitude;
    var lon = c.longitude != null ? c.longitude : mgr.hass.config.longitude;
    return "https://api.weather.gov/alerts/active?status=actual&point=" + Number(lat).toFixed(4) + "," + Number(lon).toFixed(4);
  }

  function nwsFetch(url) {
    return fetch(url, { headers: { Accept: "application/geo+json" }, cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  function NwsSource(mgr, c) {
    var stopped = false, t = null, fails = 0;
    var min = NWS_RANK[String(c.min_severity || "minor").toLowerCase()] || 0;
    var exclude = [].concat(c.exclude || []).map(function (x) { return String(x).toLowerCase(); });
    var url = nwsUrl(mgr, c);
    function poll() {
      if (stopped) return;
      nwsFetch(url).then(function (j) {
        if (stopped) return;
        fails = 0;
        var list = (j.features || []).filter(function (f) {
          var p = f.properties || {};
          if (p.status && p.status !== "Actual") return false;
          if (p.messageType === "Cancel") return false;
          if (exclude.indexOf(String(p.event || "").toLowerCase()) !== -1) return false;
          var r = NWS_RANK[String(p.severity || "unknown").toLowerCase()] || 1;
          return r >= min;
        }).map(nwsToNote);
        mgr.setSource("nws", list);
        mgr.nwsStatus = { ok: true, at: new Date().toISOString(), count: list.length, url: url };
      }, function (e) {
        fails++;
        mgr.nwsStatus = { ok: false, at: new Date().toISOString(), error: String(e), url: url };
        log("NWS fetch failed", e);
      }).then(function () {
        if (stopped) return;
        var every = Math.max(60, Number(c.interval) || 300) * 1000;
        t = setTimeout(poll, fails ? Math.min(every, 60000 * fails) : every);
      });
    }
    poll();
    return { stop: function () { stopped = true; clearTimeout(t); mgr.setSource("nws", []); } };
  }

  // ---------- source: HA persistent notifications with id "echo_*" ----------
  // Optional severity in the id: echo_<info|minor|moderate|severe|extreme>_<anything>.
  // Optional target at the end: echo_<anything>@<part of a display's name>, e.g. echo_leak@kitchen_echo_show_5,
  // shows only on displays whose Kiosk Satellite name contains it (spaces and underscores are the same).
  function slugOf(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""); }
  function PnSource(mgr, c) {
    var prefix = c.prefix || "echo_";
    var all = {};
    function publish() {
      var list = [], id;
      for (id in all) {
        var p = all[id], at = id.lastIndexOf("@");
        if (at > 0 && slugOf(mgr._display).indexOf(slugOf(id.slice(at + 1))) === -1) continue;
        var m = new RegExp("^" + prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(info|minor|moderate|severe|extreme)_").exec(id);
        list.push({
          id: id,
          severity: m ? m[1] : "info",
          kicker: "Home Assistant",
          title: p.title || "Notification",
          message: p.message || "",
          ts: p.created_at ? new Date(p.created_at).getTime() : Date.now(),
          persist: false,   // HA owns it: dismissing here dismisses it there
          onDismiss: function (n) {
            mgr.hass.callService("persistent_notification", "dismiss", { notification_id: n.id }).catch(function (e) { log("dismiss failed", e); });
          },
        });
      }
      mgr.setSource("pn", list);
    }
    var unsubP = mgr.conn.subscribeMessage(function (msg) {
      var n = msg.notifications || {}, id;
      if (msg.type === "current") all = {};
      if (msg.type === "removed") { for (id in n) delete all[id]; }
      else { for (id in n) if (id.indexOf(prefix) === 0) all[id] = n[id]; }
      publish();
    }, { type: "persistent_notification/subscribe" });
    unsubP.catch(function (e) { log("persistent_notification subscribe failed", e); });
    return { stop: function () { unsubP.then(function (u) { u(); }, function () {}); mgr.setSource("pn", []); } };
  }

  // ---------- source: echo_notify events ----------
  // data: { title, message, severity, icon, id, display (match), sound, color, button, dismiss: true }
  function EventSource(mgr, c) {
    var type = c.event_type || "echo_notify";
    if (mgr.hass.user && !mgr.hass.user.is_admin) {
      log("events source needs an admin HA user on this display; use persistent notifications (id echo_*) instead.");
      return { stop: function () {} };
    }
    var unsub = mgr.conn.subscribeEvents(function (ev) {
      var d = ev.data || {};
      if (d.display && slugOf(mgr._display).indexOf(slugOf(d.display)) === -1) return;
      if (d.dismiss) { if (d.id) mgr.remove("event", d.id); return; }
      mgr.add({
        source: "event", id: d.id, severity: d.severity, icon: d.icon, color: d.color,
        kicker: d.kicker || "Home Assistant", title: d.title, subtitle: d.subtitle,
        message: d.message, instruction: d.instruction, sound: d.sound, button: d.button,
        persist: !!d.id,
      });
    }, type);
    unsub.catch(function (e) { log("event subscribe failed", e); });
    return { stop: function () { unsub.then(function (u) { u(); }, function () {}); } };
  }

  // ---------- boot + public API ----------
  var mgr = new Manager();
  window.echoNotify = {
    version: VERSION,
    // Show a notification from any card / the console. Returns its key.
    // echoNotify.show({ title, message, severity, icon, kicker, subtitle, instruction, id, persist })
    show: function (n) { n = n || {}; n.source = n.source || "api"; if (n.persist === undefined) n.persist = false; return mgr.add(n); },
    dismiss: function (key) { var n = mgr.items[key]; if (n) { mgr._dismiss(n); mgr._paint(); } },
    list: function () { return mgr._queue(); },
    status: function () { return { active: !!mgr.cfg, dashboard: mgr.dash, display: mgr._display, config: mgr.cfg, nws: mgr.nwsStatus }; },
    resetDismissed: function () { Dismissed.clear(); if (mgr.cfg) mgr._restartSources(); },
    // Show the current NWS alerts for any point (e.g. somewhere with active alerts), for testing the look.
    previewNws: function (lat, lon) {
      return nwsFetch("https://api.weather.gov/alerts/active?status=actual&point=" + lat + "," + lon).then(function (j) {
        var list = (j.features || []).map(nwsToNote).map(function (n) { n.persist = false; n.id = "preview-" + n.id; return n; });
        mgr.setSource("preview", list);
        if (!mgr.cfg) mgr.cfg = merge(DEFAULTS, {}); mgr._paint();
        return list.length;
      });
    },
  };
  mgr.start();
  log("v" + VERSION);
})();

;(function () {
  window.EchoShowDashboard = { version: "1.13.0", cards: ["echo-show-common 1.8.0","echo-weather-card 1.7.3","echo-clock-card 2.3.0","echo-media-card 1.14.0","echo-climate-card 1.0.2","echo-notify 1.3.0"] };
  console.info("%c Echo Show Dashboard 1.13.0 ", "background:#ff8a00;color:#000;border-radius:3px");
})();
