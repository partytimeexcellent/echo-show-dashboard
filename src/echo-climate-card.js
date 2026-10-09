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

  var VERSION = "1.0.3";

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
    if (!this._devL) {   // this display's device (area, timers) becomes known after the first render
      this._devL = true;
      var me = this;
      window.addEventListener("echo-show-device", function () { if (me._hass) { me._sig = ""; me.hass = me._hass; } });
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
    if (window.EchoShow && window.EchoShow.timerBadgesDetach) window.EchoShow.timerBadgesDetach(this);
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
      if (window.EchoShow && window.EchoShow.openSettings) window.EchoShow.openSettings(this, {});
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
  EchoClimateCard.prototype._updateOverlay = function () {
    var el = this._ovEl;
    if (!el || !el.update) return;
    var b = this._config.buttons || [];
    for (var i = 0; i < b.length; i++) if (b[i].timers) { el.path = b[i].navigation_path || null; break; }
    el.update(this._hass);
  };
  EchoClimateCard.prototype._updateBadges = function () {
    var ES = window.EchoShow;
    if (ES && ES.timerBadges) ES.timerBadges(this);
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
