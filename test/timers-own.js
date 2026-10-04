// Each display's own timer set (timer.<device>_timer_N) and the settings panel's setup button.
//   NODE_PATH=$(npm root -g) node test/timers-own.js
const { chromium } = require("playwright");
const path = require("path");
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  const url = "file://" + path.join(__dirname, "index.html");
  const out = (n) => path.join(__dirname, "screenshots", n + ".png");
  let fail = 0;
  const check = (ok, m) => { console.log((ok ? "ok   " : "FAIL ") + m); if (!ok) fail++; };
  const settingsText = () => p.evaluate(() => { const s = document.querySelector("echo-show-settings"); return s ? s.shadowRoot.querySelector(".body").textContent : ""; });

  // Clock card: uses the display's own set when it exists.
  await p.goto(url + "?ownset#clock-timers"); await p.reload(); await p.waitForTimeout(1600);
  let txt = await p.evaluate(() => card.shadowRoot.textContent);
  check(/Soup/.test(txt) && !/Pasta/.test(txt), "clock shows this display's timers (Soup, not Pasta)");
  await p.screenshot({ path: out("own-timers-clock") });

  // Without its own set it keeps the shared one.
  await p.goto(url + "#clock-timers"); await p.reload(); await p.waitForTimeout(1600);
  txt = await p.evaluate(() => card.shadowRoot.textContent);
  check(/Pasta/.test(txt), "clock falls back to the shared timers (Pasta)");

  // Weather page button badge follows the own set too.
  await p.goto(url + "?ownset#weather"); await p.reload(); await p.waitForTimeout(1600);
  txt = await p.evaluate(() => card.shadowRoot.textContent);
  check(/7:1\d/.test(txt) && !/5:1\d/.test(txt), "weather timer badge counts down the own set (7:1x)");

  // Settings › Timers: setup button when the display has no set, creating 3 timers + 3 names.
  await p.goto(url + "#settings-timers"); await p.reload(); await p.waitForTimeout(1400);
  check(/Set up timers for this display/.test(await settingsText()), "setup button shown without an own set");
  await p.screenshot({ path: out("own-timers-setup") });
  await p.evaluate(() => document.querySelector("echo-show-settings").shadowRoot.querySelector('[data-a="tset"]').click());
  await p.waitForTimeout(600);
  const made = await p.evaluate(() => calls.filter((c) => c[0] === "create").map((c) => c[1] + " " + c[2]));
  check(made.length === 6 && made.indexOf("timer/create Kitchen Echo Show 8 Timer 1") !== -1 && made.indexOf("input_text/create Kitchen Echo Show 8 Timer 3 Name") !== -1, "created " + made.length + ": " + made.slice(0, 2).join(", "));

  await p.goto(url + "?ownset#settings-timers"); await p.reload(); await p.waitForTimeout(1400);
  check(!/Set up timers/.test(await settingsText()), "no setup button when the set exists");

  await p.goto(url + "?nonadmin#settings-timers"); await p.reload(); await p.waitForTimeout(1400);
  await p.evaluate(() => document.querySelector("echo-show-settings").shadowRoot.querySelector('[data-a="tset"]').click());
  await p.waitForTimeout(600);
  check(/Only a Home Assistant administrator/.test(await settingsText()), "non-admin gets told what to create");

  check(!errs.length, "no page errors " + errs.join(" | "));
  await b.close();
  process.exit(fail ? 1 : 0);
})();
