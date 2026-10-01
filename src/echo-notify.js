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

  var VERSION = "1.1.0";
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
    ".wrap{position:fixed;left:0;top:0;right:0;bottom:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;background:rgba(2,4,10,.72);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);font-family:var(--ha-font-family-body,Roboto,'Helvetica Neue',Arial,sans-serif);color:#fff;-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none;animation:fade .25s ease-out;}",
    "@keyframes fade{from{opacity:0}to{opacity:1}}",
    "@keyframes pop{from{transform:scale(.94);opacity:0}to{transform:scale(1);opacity:1}}",
    "@keyframes pulse{0%,100%{box-shadow:0 0 0 0 var(--c)}50%{box-shadow:0 0 0 1.4vh transparent}}",
    ".panel{position:relative;display:flex;flex-direction:column;width:86vw;max-height:90vh;box-sizing:border-box;background:linear-gradient(180deg,#1c2540,#121829);border:1px solid rgba(255,255,255,.1);border-radius:3.4vh;box-shadow:0 20px 60px rgba(0,0,0,.6);overflow:hidden;animation:pop .3s ease-out;}",
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
  function PnSource(mgr, c) {
    var prefix = c.prefix || "echo_";
    var all = {};
    function publish() {
      var list = [], id;
      for (id in all) {
        var p = all[id];
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
      if (d.display && String(mgr._display || "").toLowerCase().indexOf(String(d.display).toLowerCase()) === -1) return;
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
