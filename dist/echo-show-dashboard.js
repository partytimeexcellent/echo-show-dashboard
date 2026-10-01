/*!
 * Echo Show Dashboard 1.0.0
 * https://github.com/partytimeexcellent/echo-show-dashboard
 * echo-weather-card 1.5.0, echo-timer-card 1.6.0, echo-media-card 1.7.0, echo-notify 1.0.0
 * License: MIT
 * Built from src/ by build.js. Edit the files in src/, not this one.
 */

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

  var VERSION = "1.5.0";


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
    ":host{display:block;height:100vh;width:100%;overflow:hidden;font-family:var(--ha-font-family-body,Roboto,'Helvetica Neue',Arial,sans-serif);color:#fff;-webkit-tap-highlight-color:transparent;}",
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
    ".btn .bdg{margin-left:1.2vh;font-size:3.8vh;line-height:1;font-variant-numeric:tabular-nums;color:#ffb340;white-space:nowrap;}",
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
    var self = this;
    echoDisplayName().then(function (name) {
      var prof = matchDisplay(config.devices, name);
      self._timerPrefix = prof && prof.timer_prefix ? prof.timer_prefix : null;
      self._badgeSig = "";
      self._runSeen = {};
      self._doneSeen = {};
      if (self._built && self._hass) self._updateBadges();
    });
  };

  // Timers a button tracks (per-display prefix overrides the configured list).
  EchoWeatherCard.prototype._timersFor = function (btn) {
    if (!btn.timers) return null;
    if (!this._timerPrefix) return btn.timers;
    var out = [];
    for (var i = 1; i <= 3; i++) out.push("timer." + this._timerPrefix + "_" + i);
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
      this._ensureSubscriptions();
      this._update();
      this._updateBadges();
      if (this._settingsEl) this._settingsEl.hass = hass;
    },
    get: function () {
      return this._hass;
    },
  });

  EchoWeatherCard.prototype.connectedCallback = function () {
    if (this._hass && this._config) {
      this._ensureSubscriptions();
    }
    var self = this;
    if (window.ResizeObserver && this._built && !this._ro) {
      this._ro = new ResizeObserver(function () { self._chartSig = ""; self._renderChart(); });
      this._ro.observe(this._fcEl);
    }
  };

  EchoWeatherCard.prototype.disconnectedCallback = function () {
    this._unsubscribe();
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
      '<div class="pop hidden"></div>' +
      "</div>";

    this._rootEl = root.querySelector(".root");
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
    if (btn.action === "timer-settings") {
      // The popup lives in echo-timer-card.js (loaded as its own resource).
      if (window.EchoAlarmSettingsOpen) window.EchoAlarmSettingsOpen(this, this._rootEl, btn.settings);
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
    this._doneSeen = this._doneSeen || {};
    this._runSeen = this._runSeen || {};
    for (var q = 0; q < info.length; q++) {
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
      if (bt.navigation_path && ((info[q].done && !this._doneSeen[info[q].i] && bt.open_on_done) || (started && bt.open_on_start))) {
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

  EchoWeatherCard.prototype._ensureSubscriptions = function () {
    var ent = this._forecastEntity();
    if (!ent || !this._hass || !this._hass.connection) return;
    if (this._subEntity === ent && this._subs.length) return;
    this._unsubscribe();
    this._subEntity = ent;
    var sup = this._supports(ent);
    var types = [];
    if (sup.daily) types.push("daily");
    else if (sup.twice) types.push("twice_daily");
    if (sup.hourly) types.push("hourly");
    var self = this;
    types.forEach(function (type) {
      var p = self._hass.connection.subscribeMessage(function (msg) {
        self._forecasts[ent + "|" + type] = msg.forecast || [];
        self._chartSig = "";
        self._renderChart();
      }, { type: "weather/subscribe_forecast", forecast_type: type, entity_id: ent });
      self._subs.push(p);
    });
  };

  EchoWeatherCard.prototype._unsubscribe = function () {
    this._subs.forEach(function (p) {
      Promise.resolve(p).then(function (unsub) { if (typeof unsub === "function") unsub(); }).catch(function () {});
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
    var anim = this._config.animations !== false;

    var moonSt = this._state(this._config.moon);
    var illum = 0.5, waxing = true;
    if (moonSt) {
      var f = num(moonSt.attributes.illumination_fraction);
      if (f !== null) illum = f > 1 ? f / 100 : f;
      waxing = moonSt.state.indexOf("waning") !== -1 || moonSt.state === "last_quarter" ? false : true;
    }

    var sig = [c, night, anim, Math.round(illum * 50), waxing].join("|");
    if (sig === this._fxSig) return;
    this._fxSig = sig;

    var bg;
    if (night) {
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
      var t = 0, tn = 0, p = null, q = null;
      grp.forEach(function (f) {
        var v = num(f.temperature);
        if (v !== null) { t += v; tn++; }
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
      JSON.stringify(data.map(function (d) { return [d.hi, d.lo, d.precip, d.prob, d.condition, d.top]; }))].join("|");
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
    var lineTop = chartTop + fs * 1.3;
    var lineBottom = barTop - fs * 1.35;
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
      s += '<path d="' + smoothPath(seg) + '" fill="none" stroke="rgba(255,245,170,0.9)" stroke-width="' + (0.45 * vh) + '" stroke-dasharray="' + (0.5 * vh) + " " + (0.7 * vh) + '" stroke-linecap="round"/>';
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
        s += '<circle cx="' + xs[i] + '" cy="' + yl + '" r="' + (0.55 * vh) + '" fill="rgba(255,245,170,0.95)"/>';
        t += '<text x="' + xs[i] + '" y="' + (yl + fs * 1.05) + '" text-anchor="middle" font-size="' + fs + '" fill="rgba(255,255,255,0.85)">' + Math.round(los[i]) + "°</text>";
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

/* ===== echo-timer-card.js ===== */
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

  var VERSION = "1.6.0";

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
    ":host{position:absolute;left:0;top:0;right:0;bottom:0;z-index:20;display:flex;align-items:center;justify-content:center;background:rgba(3,6,14,.6);font-family:var(--ha-font-family-body,Roboto,'Helvetica Neue',Arial,sans-serif);color:#fff;-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none;}",
    ".bd{position:absolute;left:0;top:0;right:0;bottom:0;}",
    ".panel{position:relative;background:linear-gradient(180deg,#1c2540,#141b30);border:1px solid rgba(255,255,255,.1);border-radius:3.2vh;padding:3vh 3.5vh;width:74vw;box-sizing:border-box;box-shadow:0 20px 50px rgba(0,0,0,.55);}",
    ".hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:2.4vh;}",
    ".hd h2{margin:0;font-size:4.4vh;font-weight:400;letter-spacing:.01em;}",
    ".done{font-size:3.4vh;padding:1.4vh 3.4vh;border-radius:3.5vh;background:rgba(255,255,255,.12);cursor:pointer;}",
    ".lbl{display:flex;justify-content:space-between;font-size:2.8vh;letter-spacing:.08em;text-transform:uppercase;opacity:.6;margin-bottom:1.2vh;}",
    ".vrow{display:flex;align-items:center;gap:2.4vh;margin-bottom:3.2vh;}",
    ".vrow ha-icon{--mdc-icon-size:4.6vh;width:4.6vh;height:4.6vh;display:inline-flex;opacity:.7;}",
    ".track{position:relative;flex:1 1 auto;height:8vh;border-radius:4vh;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.08);overflow:hidden;touch-action:none;cursor:ew-resize;}",
    ".fill{position:absolute;left:0;top:0;bottom:0;width:100%;background:linear-gradient(90deg,#ff8a00,#ffb340);transform-origin:left;}",
    ".tones{display:grid;grid-template-columns:repeat(3,1fr);gap:1.6vh;margin-bottom:2.8vh;}",
    ".tone{height:9vh;border-radius:2.2vh;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.08);display:flex;align-items:center;justify-content:center;font-size:3.3vh;cursor:pointer;}",
    ".tone.sel{background:rgba(255,159,10,.2);border-color:rgba(255,159,10,.65);color:#ffc266;}",
    ".test{height:9vh;border-radius:4.5vh;background:linear-gradient(180deg,#3ad16a,#27a84f);display:flex;align-items:center;justify-content:center;font-size:3.6vh;cursor:pointer;}",
    ".test ha-icon{--mdc-icon-size:4.4vh;width:4.4vh;height:4.4vh;display:inline-flex;margin-right:1.2vh;}",
    ".tone:active,.test:active,.done:active{transform:scale(.96);}",
    ".dev{margin-top:2vh;text-align:center;font-size:2.4vh;opacity:.45;}",
  ].join("");

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
    root.innerHTML = "<style>" + SET_STYLE + "</style>" +
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
    ["touchstart", "touchmove", "touchend", "touchcancel"].forEach(function (type) {
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
    ":host{display:block;height:100vh;width:100%;overflow:hidden;font-family:var(--ha-font-family-body,Roboto,'Helvetica Neue',Arial,sans-serif);color:#fff;-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none;}",
    ".root{position:relative;height:100vh;width:100%;overflow:hidden;box-sizing:border-box;background:radial-gradient(110% 90% at 0% 0%,#223567 0%,rgba(34,53,103,0) 60%),radial-gradient(90% 80% at 100% 100%,#0d3b4f 0%,rgba(13,59,79,0) 60%),#0a1022;}",
    ".content{position:relative;height:100vh;box-sizing:border-box;padding:2vh 2.5vh 2vh 2.5vh;display:flex;flex-direction:column;}",
    ".main{position:relative;flex:1 1 auto;min-height:0;display:flex;align-items:stretch;gap:2vh;}",
    /* one thing on screen: no tile frame, it sits straight on the background */
    ".main.solo .tile{background:none;border-color:transparent;box-shadow:none;}",
    ".main.solo .tile.done::before{border-radius:3.6vh;}",
    /* small round buttons in the top-right corner: "+" to add a timer, "x" to close the adder */
    ".corner{position:absolute;top:1.4vh;right:1.4vh;z-index:3;width:8vh;height:8vh;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;" +
      "background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.14);color:rgba(255,255,255,.92);}",
    ".corner.plus{background:rgba(255,159,10,.2);border-color:rgba(255,159,10,.5);color:#ffc266;}",
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
    ".head .dot{flex:0 0 auto;width:1.4vh;height:1.4vh;border-radius:50%;background:#ff9f0a;box-shadow:0 0 1.2vh rgba(255,159,10,.8);}",
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
    ".rb.pause{background:rgba(255,159,10,.18);border-color:rgba(255,159,10,.35);color:#ffb340;}",
    ".rb.play{background:rgba(52,199,89,.18);border-color:rgba(52,199,89,.4);color:#5ee07f;}",
    ".rb:active,.chip:active,.go:active,.btn:active,.wide:active{transform:scale(.95);}",
    ".wide{height:10vh;border-radius:5vh;padding:0 3.6vh;display:flex;align-items:center;justify-content:center;font-size:3.6vh;cursor:pointer;white-space:nowrap;}",
    ".wide.dismiss{background:linear-gradient(180deg,#ff6259,#e5362c);box-shadow:0 .8vh 2.4vh rgba(255,69,58,.35);}",
    ".wide.more,.wide.cancel{background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.1);}",
    ".wide.apply{background:linear-gradient(180deg,#ffab2e,#ff8a00);color:#1a1000;}",
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
    ".slider .fill{position:absolute;left:0;right:0;bottom:0;height:100%;background:linear-gradient(0deg,#ff8a00,#ffc15e);transform-origin:bottom;}",
    ".slider ha-icon{position:absolute;left:50%;bottom:2vh;margin-left:-2.5vh;--mdc-icon-size:5vh;width:5vh;height:5vh;display:inline-flex;color:rgba(40,20,0,.7);pointer-events:none;}",
    ".chips{display:grid;grid-template-columns:repeat(2,var(--chipw,13vh));gap:1.3vh;}",
    ".chip{height:var(--chiph,8.8vh);border-radius:2.2vh;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.09);display:flex;align-items:center;justify-content:center;font-size:3.2vh;cursor:pointer;white-space:nowrap;}",
    ".chip.sel{background:rgba(255,159,10,.2);border-color:rgba(255,159,10,.65);color:#ffc266;}",
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
        if (btn.action === "timer-settings") {
          var sc = {}, k;
          for (k in (btn.settings || {})) sc[k] = btn.settings[k];
          for (k in (self._config.settings || {})) sc[k] = self._config.settings[k];
          sc.timers = self._config.slots.map(function (s) { return s.timer; });
          window.EchoAlarmSettingsOpen(self, root.querySelector(".root"), sc);
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
    var c1 = it.state === "done" ? "#ff7a70" : "#ffc15e", c2 = it.state === "done" ? "#ff3b30" : "#ff8a00";
    return '<div class="tile tcol ' + it.state + '" data-slot="' + it.slot + '">' +
      '<div class="head"><span class="dot"></span><span class="nm">' + esc(it.name) + "</span></div>" +
      '<div class="ring"' + (it.state === "done" ? "" : ' data-act="adjust" data-slot="' + it.slot + '"') + '>' +
      '<svg viewBox="0 0 100 100"><defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="' + c1 + '"/><stop offset="1" stop-color="' + c2 + '"/></linearGradient></defs>' +
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
 *  - Browse: Sonos favorites, Music Assistant library, Spotify (via Music Assistant).
 *  - Queue: live from the Music Assistant server when ma_url + ma_token are set.
 *  - Goes back to the home view after a timeout, but never while music is playing.
 *
 * Plain JavaScript, no dependencies, no build step. ES5-ish for older Chromium.
 */
(function () {
  "use strict";

  var VERSION = "1.7.0";

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
    ":host{display:block;height:100vh;width:100%;overflow:hidden;font-family:var(--ha-font-family-body,Roboto,'Helvetica Neue',Arial,sans-serif);color:#fff;-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none;}",
    ".root{position:relative;height:100vh;width:100%;overflow:hidden;box-sizing:border-box;background:#0a1022;}",
    ".bg0{position:absolute;left:0;top:0;right:0;bottom:0;background:radial-gradient(110% 90% at 0% 0%,#223567 0%,rgba(34,53,103,0) 60%),radial-gradient(90% 80% at 100% 100%,#0d3b4f 0%,rgba(13,59,79,0) 60%),#0a1022;}",
    ".bgart{position:absolute;left:-10%;top:-10%;right:-10%;bottom:-10%;background-size:cover;background-position:center;filter:blur(60px) saturate(1.3);opacity:0;transition:opacity 1.2s;}",
    ".bgart.on{opacity:.55;}",
    ".bgshade{position:absolute;left:0;top:0;right:0;bottom:0;background:linear-gradient(180deg,rgba(6,10,22,.35),rgba(6,10,22,.7));}",
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
    ".chip .rc{margin-left:1.2vh;font-size:2.4vh;padding:.4vh 1.2vh;border-radius:2vh;background:rgba(255,159,10,.25);color:#ffc266;white-space:nowrap;}",
    ".chip .rc:empty{display:none;}",
    ".chip .chev{margin:0 0 0 .8vh;opacity:.6;}",
    ".ib{flex:0 0 auto;width:7.4vh;height:7.4vh;border-radius:50%;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.1);display:flex;align-items:center;justify-content:center;cursor:pointer;box-sizing:border-box;margin-left:1.4vh;}",
    ".ib ha-icon{--mdc-icon-size:4vh;width:4vh;height:4vh;}",
    ".ib.plain{background:none;border-color:transparent;}",
    /* meta */
    ".meta{display:flex;flex-direction:column;min-width:0;}",
    ".src{font-size:2.3vh;letter-spacing:.14em;text-transform:uppercase;opacity:.55;margin-bottom:1.2vh;display:flex;align-items:center;}",
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
    ".tb.sm.on{opacity:1;color:#ffb340;}",
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
    ".go{margin-top:3.4vh;height:9vh;border-radius:4.5vh;padding:0 4.4vh;background:linear-gradient(180deg,#ffab2e,#ff8a00);color:#1a1000;display:flex;align-items:center;justify-content:center;font-size:3.4vh;font-weight:500;cursor:pointer;}",
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
    ".tab.sel{background:rgba(255,159,10,.2);border-color:rgba(255,159,10,.6);color:#ffc266;}",
    ".tgt{height:7vh;padding:0 2vh 0 2.2vh;border-radius:3.5vh;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.12);font-size:2.6vh;white-space:nowrap;overflow:hidden;margin-left:1vh;display:flex;align-items:center;cursor:pointer;box-sizing:border-box;flex:0 1 auto;min-width:0;}",
    ".tgt b{font-weight:500;margin-left:.8vh;overflow:hidden;text-overflow:ellipsis;}",
    ".tgt ha-icon{--mdc-icon-size:3vh;width:3vh;height:3vh;margin-right:.8vh;flex:0 0 auto;}",
    ".tgt .chev{margin:0 0 0 .6vh;opacity:.6;}",
    ".tgt:active{transform:scale(.95);}",
    ".spn h3{margin:0 0 1.6vh;font-size:3.4vh;font-weight:400;}",
    ".so .sx{flex:1 1 auto;min-width:0;}",
    ".so .sx div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
    ".so .sx .ss{font-size:2.1vh;opacity:.55;margin-top:.2vh;}",
    ".so.cur{background:rgba(255,159,10,.18);color:#ffc266;}",
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
    ".trow.cur{background:rgba(255,159,10,.14);}",
    ".trow.cur .tn{color:#ffb340;opacity:1;}",
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
    ".spn{width:64vh;background:linear-gradient(180deg,#1c2540,#141b30);border:1px solid rgba(255,255,255,.1);border-radius:3vh;padding:2.4vh;box-sizing:border-box;box-shadow:0 2vh 5vh rgba(0,0,0,.55);}",
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
    ".srow.in{background:rgba(255,159,10,.09);border-color:rgba(255,159,10,.35);}",
    ".srow.na{opacity:.4;pointer-events:none;}",
    ".sname{flex:0 0 36vh;min-width:0;cursor:pointer;padding-right:1vh;}",
    ".sname .n{font-size:3.2vh;display:flex;align-items:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
    ".sname .n ha-icon{--mdc-icon-size:3vh;width:3vh;height:3vh;margin-left:1vh;color:#ffb340;}",
    ".sname .s{font-size:2.2vh;opacity:.55;margin-top:.4vh;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
    ".srow .ib{width:6.6vh;height:6.6vh;margin-left:0;}",
    ".srow .vtrack{height:6.6vh;border-radius:3.3vh;}",
    ".gbtn{flex:0 0 auto;height:6.6vh;width:19vh;margin-left:1.8vh;border-radius:3.3vh;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.1);display:flex;align-items:center;justify-content:center;font-size:2.6vh;cursor:pointer;padding:0 2vh;box-sizing:border-box;white-space:nowrap;}",
    ".gbtn ha-icon{--mdc-icon-size:3.2vh;width:3.2vh;height:3.2vh;margin-right:.8vh;}",
    ".gbtn.on{background:linear-gradient(180deg,#ffab2e,#ff8a00);border-color:transparent;color:#1a1000;}",
    ".gbtn.busy{opacity:.45;pointer-events:none;}",
    ".gbtn.fixed{background:none;border-color:transparent;opacity:.55;pointer-events:none;}",
    ".sfoot{display:flex;align-items:center;margin-top:2vh;flex:0 0 auto;}",
    ".wide{height:8vh;border-radius:4vh;padding:0 3.6vh;display:flex;align-items:center;justify-content:center;font-size:3vh;cursor:pointer;white-space:nowrap;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.1);box-sizing:border-box;margin-right:1.6vh;}",
    ".wide ha-icon{--mdc-icon-size:3.8vh;width:3.8vh;height:3.8vh;margin-right:1.2vh;}",
    ".wide.done{margin:0 0 0 auto;background:linear-gradient(180deg,#ffab2e,#ff8a00);color:#1a1000;border-color:transparent;}",
    /* toast */
    ".toast{position:absolute;left:50%;bottom:15vh;z-index:30;transform:translateX(-50%);background:rgba(28,37,64,.97);border:1px solid rgba(255,255,255,.12);padding:1.8vh 3.4vh;border-radius:3.4vh;font-size:2.8vh;white-space:nowrap;max-width:80vw;overflow:hidden;text-overflow:ellipsis;opacity:0;transition:opacity .25s;pointer-events:none;box-shadow:0 1vh 3vh rgba(0,0,0,.4);}",
    ".toast.show{opacity:1;}",
    /* bottom buttons (same look as the weather/timer cards) */
    ".btns{display:flex;gap:1.5vh;margin-top:2vh;height:9vh;flex:0 0 auto;}",
    ".btn{flex:1 1 0;border-radius:1.6vh;background:rgba(255,255,255,.1);display:flex;align-items:center;justify-content:center;cursor:pointer;}",
    ".btn.active{background:rgba(255,255,255,.24);}",
    ".btn ha-icon{--mdc-icon-size:5vh;width:5vh;height:5vh;display:inline-flex;color:rgba(255,255,255,.9);}",
    ".btn .bdg{margin-left:1.2vh;font-size:3.8vh;line-height:1;font-variant-numeric:tabular-nums;color:#ffb340;white-space:nowrap;}",
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
    { t: "radio", label: "Radio" },
    { t: "podcast", label: "Podcasts" },
  ];
  var TYPE_ICON = { playlist: "mdi:playlist-music", artist: "mdi:account-music", album: "mdi:album", track: "mdi:music-note", radio: "mdi:radio", podcast: "mdi:podcast", audiobook: "mdi:book-music", favorite: "mdi:star" };
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
    self._br = { tab: "fav", ltype: "playlist", sort: "name", q: "", items: [], offset: 0, more: false, loading: false, req: 0, stack: [] };
    self._favCache = null;
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
      ma_urls: c.ma_url ? [].concat(c.ma_url) : [],
      ma_token: c.ma_token || null,
    };
  };

  EchoMediaCard.prototype.getCardSize = function () { return 12; };

  Object.defineProperty(EchoMediaCard.prototype, "hass", {
    set: function (hass) {
      this._hass = hass;
      if (!this._config) return;
      if (!this._built) { this._build(); this._startIdle(); }
      this._update(false);
      this._maHook();
      if (this._settingsEl) this._settingsEl.hass = hass;
    },
    get: function () { return this._hass; },
  });

  EchoMediaCard.prototype.connectedCallback = function () {
    if (this._built) { this._startIdle(); this._update(true); }
  };

  EchoMediaCard.prototype.disconnectedCallback = function () {
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
    var s = this._st(r.entity);
    var gm = s && s.attributes.group_members;
    if (gm && gm.length && gm[0] !== r.entity) return this._roomOf(gm[0]) || r;
    return r;
  };

  // Rooms in the same group as the leader (leader first).
  EchoMediaCard.prototype._membersOf = function (coord) {
    var s = this._st(coord.entity);
    var gm = (s && s.attributes.group_members) || [];
    var out = [coord];
    for (var i = 0; i < gm.length; i++) {
      var r = this._roomOf(gm[i]);
      if (r && out.indexOf(r) === -1) out.push(r);
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
    var def = 0;
    if (this._config.default_player) {
      var d = this._roomOf(this._config.default_player);
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

  EchoMediaCard.prototype._volOf = function (entityId) {
    var l = this._volLocal[entityId];
    if (l && (l.drag || l.until > Date.now())) return l.v;
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
      if (/^(tunein|radiobrowser)/.test(id) || a.media_content_type === "radio") return ["mdi:radio", "Radio"];
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

  // Artwork URLs to try, best first.
  function artUrls(st) {
    if (!st) return [];
    var a = st.attributes;
    var list = a._art || [a.entity_picture_local, a.entity_picture];
    var out = [];
    for (var i = 0; i < list.length; i++) if (list[i] && out.indexOf(list[i]) === -1) out.push(list[i]);
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
      if (self._artList && self._artIdx < self._artList.length) { self._artUrl = self._artList[self._artIdx]; self._imgEl.setAttribute("src", self._artUrl); }
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
    if (btn.action === "timer-settings") {
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
      // Another display saved a new "playing from": only the open queue needs it.
      if (r.src && st[r.src] !== this._refs[r.src]) { this._refs[r.src] = st[r.src]; if (this._quEl && !this._quEl.classList.contains("hidden")) changed = true; }
    }
    if (force && !this._manual) this._sel = -1;
    if (changed) this._paint();
    this._updateBadges();
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
    // Quick-start row of Sonos favorites.
    var qn = this._config.quick_favorites;
    var qf = this.shadowRoot.querySelector(".qf");
    if (!qn) { qf.innerHTML = ""; return; }
    var self = this;
    this._loadFavorites().then(function (items) {
      var list = [];
      for (var j = 0; j < items.length && list.length < qn; j++) if (!items[j].section) list.push(items[j]);
      var sig = list.map(function (x) { return x.id; }).join("|");
      if (qf.getAttribute("data-sig") === sig) return;
      qf.setAttribute("data-sig", sig);
      self._quick = list;
      if (!list.length) { qf.innerHTML = ""; return; }
      var h = '<div class="sh">Sonos favorites</div><div class="qfg">';
      for (var k = 0; k < list.length; k++) h += self._tileHtml(list[k], "q" + k, false);
      qf.innerHTML = h + "</div>";
    }, function () { /* favorites unavailable */ });
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
    this._wantArt(artUrls(st));

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
    var h = '<div class="ovh"><h2>Speakers</h2><div class="grow"></div><div class="ib" role="button" data-act="close"><ha-icon icon="mdi:close"></ha-icon></div></div><div class="slist">';
    for (var j = 0; j < order.length; j++) {
      var r = order[j];
      h += '<div class="srow" data-i="' + r.i + '">' +
        '<div class="sname" role="button" data-act="pick" data-i="' + r.i + '"><div class="n"></div><div class="s"></div></div>' +
        volRow("r" + r.i, '<div class="gbtn" role="button" data-act="group" data-i="' + r.i + '"></div>') + "</div>";
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
      var sEl = row.querySelector(".s");
      if (sEl.textContent !== s) sEl.textContent = s;
      var g = row.querySelector(".gbtn"), gh, gc;
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
    if (!r) return;
    var coord = this._coord(), members = this._membersOf(coord);
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
    for (var i = 0; i < this._rooms.length; i++) {
      var r = this._rooms[i];
      if (members.indexOf(r) === -1 && this._available(r)) { add.push(r.entity); this._pendGroup[r.i] = Date.now(); }
    }
    if (add.length) this._hass.callService("media_player", "join", { entity_id: coord.entity, group_members: add });
    this._renderSpeakers(false);
  };

  EchoMediaCard.prototype._ungroupAll = function () {
    var coord = this._coord(), members = this._membersOf(coord);
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
      '<div class="tab" role="button" data-act="tab" data-t="fav"><ha-icon icon="mdi:star"></ha-icon>Sonos favorites</div>' +
      '<div class="tab" role="button" data-act="tab" data-t="lib"><ha-icon icon="mdi:bookshelf"></ha-icon>Library</div>' +
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
      f = '<div class="ah"><div class="ib" role="button" data-act="view-back"><ha-icon icon="mdi:arrow-left"></ha-icon></div>' +
        '<div class="av' + (isArtist ? "" : " sq") + '"' + (ar.img ? ' style="background-image:url(&quot;' + esc(ar.img) + '&quot;)"' : "") + '></div>' +
        '<div style="min-width:0"><div class="an">' + esc(ar.title) + '</div><div class="as">' +
        esc(isArtist ? "Artist · " + srcName : (ar.artist ? ar.artist + " · " : "") + "Album · " + srcName) + "</div></div></div>" +
        (isArtist ? '<div class="go mix" role="button" data-act="view-play"><ha-icon icon="mdi:shuffle-variant"></ha-icon>Play artist mix</div>' :
          '<div class="go mix alt" role="button" data-act="view-shuffle"><ha-icon icon="mdi:shuffle-variant"></ha-icon>Shuffle</div>' +
          '<div class="go mix" role="button" data-act="view-play"><ha-icon icon="mdi:play"></ha-icon>Play album</div>');
    } else if (br.tab === "lib" || br.tab === "spot") {
      f += '<div class="srch"><ha-icon icon="mdi:magnify"></ha-icon><input type="search" enterkeyhint="search" placeholder="' +
        (br.tab === "spot" ? "Search Spotify" : "Search your library") + '" value="' + esc(br.q) + '">' +
        (br.q ? '<ha-icon class="clr" role="button" data-act="clear" icon="mdi:close-circle"></ha-icon>' : "") + "</div>";
    }
    if (br.tab === "lib" && !vw) {
      for (var t = 0; t < LIB_TYPES.length; t++) {
        f += '<div class="fc' + (LIB_TYPES[t].t === br.ltype ? " sel" : "") + '" role="button" data-act="ltype" data-t="' + LIB_TYPES[t].t + '">' + LIB_TYPES[t].label + "</div>";
      }
      f += '<div class="fc sort" role="button" data-act="sort"><ha-icon icon="' + (br.sort === "name" ? "mdi:sort-alphabetical-ascending" : "mdi:history") + '"></ha-icon>' + (br.sort === "name" ? "A–Z" : "Recent") + "</div>";
    }
    var fSig = br.tab + "|" + br.ltype + "|" + br.sort + "|" + (br.q ? 1 : 0) + "|" + (vw ? vw.item.id : "");
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
    if (top) p = top.item.mtype === "artist" ? this._artistAlbums(top.item) : this._albumTracks(top.item);
    else if (br.tab === "fav") p = this._loadFavorites().then(function (items) { return { items: items, more: false }; });
    else if (br.tab === "lib") p = br.q ? this._maSearch(br.q, "library") : this._maLibrary(br.ltype, br.offset, br.sort, "");
    else p = br.q ? this._maSearch(br.q, "spotify") : this._spotifyHome();
    p.then(function (res) {
      if (req !== br.req) return;
      br.loading = false;
      br.items = br.items.concat(res.items);
      br.offset += res.count || res.items.length;
      br.more = !!res.more;
      self._renderGrid(!reset, res.items);
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
      if (!br.items.length) {
        var vn = this._view();
        var none = vn ? (vn.item.mtype === "artist" ? "No albums found for " : "No songs found on ") + vn.item.title : br.tab === "fav" ? "No Sonos favorites found" : br.q ? "No results for “" + br.q + "”" :
          br.tab === "spot" ? "Search Spotify to find songs, albums, artists and playlists" : "Nothing here yet";
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
    return this._hass.callWS({ type: "media_player/browse_media", entity_id: ma, media_content_type: "album", media_content_id: al.id }).then(function (r) {
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

  // Sonos favorites (all folders flattened into titled sections). Cached for 10 min.
  EchoMediaCard.prototype._loadFavorites = function () {
    var self = this;
    if (this._favCache && Date.now() - this._favCache.t < 600000) return this._favCache.p;
    var ent = this._coord().entity;
    var ws = function (type, id) {
      return self._hass.callWS({ type: "media_player/browse_media", entity_id: ent, media_content_type: type, media_content_id: id });
    };
    var p = ws("favorites", "").then(function (root) {
      var folders = [], items = [];
      (root.children || []).forEach(function (c) {
        if (c.can_expand && c.media_content_type === "favorites_folder") folders.push(c);
        else if (c.can_play) items.push(c);
      });
      // Radio first (most used on a kitchen display), then the rest as Sonos orders them.
      folders.sort(function (a, b) { return (b.title === "Radio") - (a.title === "Radio"); });
      return Promise.all(folders.map(function (fo) {
        return ws(fo.media_content_type, fo.media_content_id).then(function (r) { return { title: fo.title, children: r.children || [] }; }, function () { return { title: fo.title, children: [] }; });
      })).then(function (groups) {
        var out = [];
        if (items.length) groups.unshift({ title: "Favorites", children: items });
        groups.forEach(function (g) {
          var kids = g.children.filter(function (c) { return c.can_play; });
          if (!kids.length) return;
          if (groups.length > 1) out.push({ section: g.title });
          kids.forEach(function (c) {
            out.push({ kind: "sonos", title: c.title, sub: g.title === "Radio" ? "" : "", img: c.thumbnail || "", id: c.media_content_id, ctype: c.media_content_type, mtype: g.title === "Radio" ? "radio" : g.title === "Albums" ? "album" : g.title === "Tracks" ? "track" : "playlist" });
          });
        });
        return out;
      });
    });
    this._favCache = { t: Date.now(), p: p };
    p.then(null, function () { self._favCache = null; });
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

  function maTile(x) {
    var sub = "";
    if (x.media_type === "track") sub = artistNames(x);
    else if (x.media_type === "album") sub = artistNames(x) || "Album";
    else if (x.media_type === "playlist") sub = x.owner || "Playlist";
    else if (x.media_type === "radio") sub = "Radio";
    else if (x.media_type === "podcast") sub = x.publisher || "Podcast";
    else if (x.media_type === "audiobook") sub = artistNames(x) || "Audiobook";
    return { kind: "ma", title: x.name || "Untitled", sub: sub, img: x.image || (x.album && x.album.image) || "", id: x.uri, mtype: x.media_type, artist: x.media_type === "album" ? artistNames(x) : "" };
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

  // Spotify tab before searching: the Spotify playlists saved in the library
  // (recognised by their Spotify-hosted artwork).
  EchoMediaCard.prototype._spotifyHome = function () {
    return this._maCall("get_library", { media_type: "playlist", limit: 500, offset: 0, order_by: "sort_name" }).then(function (r) {
      var list = (r.items || []).filter(function (x) { return x.name && /scdn\.co|spotifycdn/.test(String(x.image || "")); });
      if (!list.length) return { items: [], more: false };
      var out = [{ section: "Your Spotify playlists" }];
      list.forEach(function (x) { out.push(maTile(x)); });
      return { items: out, more: false };
    });
  };

  // --- play ---

  EchoMediaCard.prototype._play = function (it, enqueue, radio) {
    var coord = this._coord(), n = this._membersOf(coord).length;
    var where = this._roomName(coord) + (n > 1 ? " +" + (n - 1) : "");
    var p;
    if (it.kind === "sonos") {
      p = this._hass.callService("media_player", "play_media", { entity_id: coord.entity, media_content_id: it.id, media_content_type: it.ctype || "favorite_item_id" });
    } else {
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
      var on = rc === coord;
      h += '<div class="so' + (on ? " cur" : "") + (this._available(r) ? "" : " na") + '" role="button" data-act="target" data-i="' + i + '">' +
        '<ha-icon icon="' + (on ? "mdi:check-circle" : mem.length > 1 ? "mdi:speaker-multiple" : "mdi:speaker") + '"></ha-icon>' +
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
    if (!this._timerPrefix) return btn.timers;
    var out = [];
    for (var i = 1; i <= 3; i++) out.push("timer." + this._timerPrefix + "_" + i);
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
    this._doneSeen = this._doneSeen || {};
    this._runSeen = this._runSeen || {};
    for (var q = 0; q < info.length; q++) {
      var bt = buttons[info[q].i];
      var prevRun = this._runSeen[info[q].i];
      var started = false;
      if (prevRun) for (var r2 = 0; r2 < info[q].running.length; r2++) if (prevRun.indexOf(info[q].running[r2]) === -1) started = true;
      if (bt.navigation_path && ((info[q].done && !this._doneSeen[info[q].i] && bt.open_on_done) || (started && bt.open_on_start))) {
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

  if (!customElements.get("echo-media-card")) customElements.define("echo-media-card", EchoMediaCard);
  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "echo-media-card",
    name: "Echo Media Card",
    description: "Full-screen Sonos now playing, grouping and browsing for wall tablets",
  });
  console.info("%c echo-media-card " + VERSION + " ", "background:#ff8a00;color:#000;border-radius:3px");
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

  var VERSION = "1.0.0";
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

  Manager.prototype._paint = function () {
    var q = this.cfg ? this._queue() : [];
    if (!q.length) { this.overlay.hide(); this._stopRepeat(); return; }
    var top = q[0];
    this.overlay.render(top, 1, q.length);
    if (!this._seen[top.key]) {
      this._seen[top.key] = true;
      if (this.cfg.sound && top.sound !== false) Chime.play(SEV[top.severity].rank);
      this._startRepeat(top);
    }
  };
  Manager.prototype._startRepeat = function (n) {
    this._stopRepeat();
    var every = Number(this.cfg.sound_repeat) || 0;
    if (!every || !this.cfg.sound || SEV[n.severity].rank < 3) return;
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

;(function () {
  window.EchoShowDashboard = { version: "1.0.0", cards: ["echo-weather-card 1.5.0","echo-timer-card 1.6.0","echo-media-card 1.7.0","echo-notify 1.0.0"] };
  console.info("%c Echo Show Dashboard 1.0.0 ", "background:#ff8a00;color:#000;border-radius:3px");
})();
