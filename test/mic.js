// Settings › General › Microphone: muted over the Remote API (shell_command.echo_kiosk mic / mic_set).
//   NODE_PATH=$(npm root -g) node test/mic.js
const { chromium } = require("playwright");
const path = require("path");
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  const url = "file://" + path.join(__dirname, "index.html");
  const out = (n) => path.join(__dirname, "screenshots", n + ".png");
  const sr = (f) => p.evaluate(f);
  const tile = () => sr(() => { const t = document.querySelector("echo-show-settings").shadowRoot.querySelector('[data-a="mic"]'); return t ? t.className + " | " + t.textContent : "none"; });
  const click = () => sr(() => document.querySelector("echo-show-settings").shadowRoot.querySelector('[data-a="mic"]').click());
  let fail = 0;
  const check = (ok, m) => { console.log((ok ? "ok   " : "FAIL ") + m); if (!ok) fail++; };

  await p.goto(url + "#settings-general"); await p.reload(); await p.waitForTimeout(1400);
  check(/On/.test(await tile()), "starts on: " + await tile());
  await click(); await p.waitForTimeout(600);
  check(await sr(() => ksMuted === true), "mic_set muted the tablet");
  check(await sr(() => !calls.some((c) => c[1] === "turn_on" || c[1] === "turn_off")), "old mute switch not touched");
  check(/Off/.test(await tile()), "shows off: " + await tile());
  await p.screenshot({ path: out("mic-off") });
  await click(); await p.waitForTimeout(600);
  check(await sr(() => ksMuted === false), "mic_set unmuted the tablet");

  await p.goto(url + "?micoff#settings-general"); await p.reload(); await p.waitForTimeout(1400);
  check(/Off/.test(await tile()), "reads muted state from the tablet: " + await tile());

  await p.goto(url + "?noshell#settings-general"); await p.reload(); await p.waitForTimeout(1400);
  check(await sr(() => /old mute switch/.test(document.querySelector("echo-show-settings").shadowRoot.textContent)), "no helper: falls back with a note");
  await p.screenshot({ path: out("mic-noshell") });
  check(!errs.length, "no page errors " + errs.join("; "));
  await b.close();
  process.exit(fail ? 1 : 0);
})();
