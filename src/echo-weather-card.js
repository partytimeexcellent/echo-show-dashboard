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
