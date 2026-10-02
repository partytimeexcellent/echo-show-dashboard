// Screenshots + checks for the settings panel's Alarms tab and the timer wheels.
//   NODE_PATH=$(npm root -g) node test/alarms-settings.js
const { chromium } = require("playwright");
const path = require("path");
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  const url = "file://" + path.join(__dirname, "index.html");
  const out = (n) => path.join(__dirname, "screenshots", n + ".png");
  const panel = (sel) => p.evaluate((s) => { const e = document.querySelector("echo-show-settings").shadowRoot.querySelector(s); if (!e) throw new Error("missing " + s); e.click(); }, sel);
  const wait = (ms) => p.waitForTimeout(ms);
  const ks = () => p.evaluate(() => calls.filter((c) => c[0] === "ks").map((c) => c[1] + " " + JSON.stringify(c[2])));

  await p.goto(url + "#settings-alarms"); await p.reload(); await wait(1400);
  await panel('.tn[data-v="Echo Harp.wav"]'); await wait(700);
  await panel('.chip[data-k="alarms.snooze_minutes"][data-v="15"]'); await wait(500);
  // drag the volume slider to ~40%
  const r = await p.evaluate(() => { const t = document.querySelector("echo-show-settings").shadowRoot.querySelector(".track").getBoundingClientRect(); return { x: t.x, y: t.y + t.height / 2, w: t.width }; });
  await p.mouse.move(r.x + r.w * 0.36, r.y); await p.mouse.down(); await p.mouse.move(r.x + r.w * 0.37, r.y); await p.mouse.up(); await wait(600);
  await panel('.row[data-k="alarms.ease_in"]'); await wait(500);
  await panel('.row[data-k="alarms.ease_in"]'); await wait(500);
  await panel('.chip[data-k="alarms.ease_in_seconds"][data-v="60"]'); await wait(500);
  // phrase
  await p.evaluate(() => { const i = document.querySelector("echo-show-settings").shadowRoot.querySelector(".pin"); i.focus(); });
  await p.keyboard.press("End"); await p.keyboard.type(" Good morning!"); await p.keyboard.press("Enter"); await wait(600);
  console.log("calls:\n  " + (await ks()).join("\n  "));
  console.log("settings now:", JSON.stringify(await p.evaluate(() => ksSettings)));
  await p.screenshot({ path: out("sa-top") });
  await p.evaluate(() => { const b = document.querySelector("echo-show-settings").shadowRoot.querySelector(".body"); b.scrollTop = 9999; });
  await wait(200); await p.screenshot({ path: out("sa-bottom") });

  await p.goto(url + "?notones#settings-alarms"); await p.reload(); await wait(1400);
  await p.screenshot({ path: out("sa-notones") });
  await panel('[data-a="ks-install"]'); await wait(800);
  console.log("after install, tones shown:", await p.evaluate(() => document.querySelector("echo-show-settings").shadowRoot.querySelectorAll(".tn").length));

  await p.goto(url + "?noshell#settings-alarms"); await p.reload(); await wait(1400);
  await p.screenshot({ path: out("sa-noshell") });

  // timer wheels + recents
  await p.goto(url + "#clock-timers"); await p.reload(); await wait(800);
  await p.evaluate(() => { localStorage.setItem("echo-timer-recents", JSON.stringify([90, 600, 2700, 3600, 45])); ["1", "2"].forEach((n) => { states["timer.echo_timer_" + n] = Object.assign({}, states["timer.echo_timer_" + n], { state: "idle" }); states["input_text.echo_timer_" + n + "_name"] = Object.assign({}, states["input_text.echo_timer_" + n + "_name"], { state: "" }); }); card.hass = Object.assign({}, hass, { states: Object.assign({}, states) }); });
  await wait(700);
  await p.evaluate(() => card.shadowRoot.querySelector('.chip[data-sec="90"]').click()); await wait(600);
  await p.screenshot({ path: out("t-recents") });
  await p.evaluate(() => card.shadowRoot.querySelector(".go").click()); await wait(200);
  console.log("start:", JSON.stringify(await p.evaluate(() => calls.filter((c) => c[0] === "script").pop())), "recents:", await p.evaluate(() => localStorage.getItem("echo-timer-recents")));
  await p.goto(url + "#clock-timers"); await p.reload(); await wait(800);
  await p.evaluate(() => card.shadowRoot.querySelector(".corner.plus").click()); await wait(600);
  await p.screenshot({ path: out("t-recents3") });
  await p.goto(url + "#weather"); await p.reload(); await wait(1200);
  await p.evaluate(() => card.shadowRoot.querySelector(".fc").click()); await wait(700);
  await p.screenshot({ path: out("w-hourly") });
  console.log("errors:", errs.length ? errs : "none");
  await b.close();
})();
