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

  var VERSION = "1.4.0";
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
  // The display's entity prefix: configured, or derived from the Kiosk Satellite name.
  function resolveDevice(hass, name, esCfg) {
    var prof = esCfg ? matchDisplay(esCfg.devices, name) : null;
    if (prof && prof.device) return prof.device;
    if (esCfg && esCfg.device) return esCfg.device;
    var slug = slugify(name);
    if (slug && hasDevice(hass, slug)) return slug;
    if (name) {
      var ln = String(name).toLowerCase();
      for (var id in hass.states) {
        if (id.indexOf("assist_satellite.") === 0 && String(hass.states[id].attributes.friendly_name || "").toLowerCase() === ln) return id.split(".")[1];
      }
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
    var st = this._st(id), na = !st || st.state === "unavailable";
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

  // --- tabs ---
  EchoShowSettings.prototype._tab_general = function () {
    if (!this._device) return this._noDevice();
    var mic = this._dev("switch", "mute"), cam = this._dev("switch", "camera_enabled");
    var wake = this._dev("switch", "wake_sound"), sat = this._dev("switch", "voice_satellite");
    var vol = this._dev("number", "volume"), avol = this._dev("number", "assistant_volume"), mvol = this._dev("number", "media_volume");
    var sens = this._dev("select", "wake_word_sensitivity");
    var h = '<div class="sec">Privacy</div><div class="tiles">';
    if (mic) {
      // The Kiosk Satellite switch is "Mute": on = microphone off.
      var muted = this._isOn(mic), mt = this._tile(mic, muted ? "mdi:microphone-off" : "mdi:microphone", "Microphone", !muted, muted ? "Off · not listening" : "On", "toggle");
      h += muted ? mt.replace('class="tl', 'class="tl alert') : mt;
    }
    if (cam) { var c = this._isOn(cam); h += this._tile(cam, c ? "mdi:camera" : "mdi:camera-off", "Camera", c, c ? "On" : "Off · motion wake off too", "toggle"); }
    var rtsp = this._dev("switch", "rtsp_streaming");
    if (rtsp) { var rs = this._isOn(rtsp); h += this._tile(rtsp, rs ? "mdi:cctv" : "mdi:cctv-off", "Video stream", rs, rs ? "Streaming to the network" : "Off", "toggle"); }
    if (sat) { var s = this._isOn(sat); h += this._tile(sat, s ? "mdi:account-voice" : "mdi:account-voice-off", "Voice assistant", s, s ? "On" : "Off", "toggle"); }
    if (wake) { var w = this._isOn(wake); h += this._tile(wake, w ? "mdi:bullhorn" : "mdi:bullhorn-outline", "Wake sound", w, w ? "Beep when listening" : "Silent", "toggle"); }
    h += "</div>";
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
    return '<div class="sec">Alarm</div><div class="alarm"></div>' +
      '<div class="note">Volume and tone are shared by every display and by the "alarm when finished" automation.</div>';
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
    if (a === "toggle" && id) {
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

  // ---------- public API ----------
  window.EchoShow = {
    version: VERSION,
    prefs: Prefs,
    openSettings: openSettings,
    settingsOpen: function () { return !!current; },
    displayName: echoDisplayName,
    devEnt: devEnt,
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
