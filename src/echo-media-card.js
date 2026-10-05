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
 *  - Browse: Music Assistant library (radio first) and Spotify (via Music Assistant).
 *  - Queue: live from the Music Assistant server when ma_url + ma_token are set.
 *  - Goes back to the home view after a timeout, but never while music is playing.
 *
 * Plain JavaScript, no dependencies, no build step. ES5-ish for older Chromium.
 */
(function () {
  "use strict";

  var VERSION = "1.13.1";

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
    { t: "radio", label: "Radio" },
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
    self._localSlug = null;  // this display's Kiosk Satellite name; its own player becomes a room of its own
    self._br = { tab: "lib", ltype: "radio", stype: "playlist", sort: "name", q: "", items: [], offset: 0, more: false, loading: false, req: 0, stack: [] };
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
    if (top) p = top.item.mtype === "artist" ? this._artistAlbums(top.item) : this._albumTracks(top.item);
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
        var none = vn ? (vn.item.mtype === "artist" ? "No albums found for " : "No songs found on ") + vn.item.title : br.q ? "No results for “" + br.q + "”" :
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
