// Drives the Climate card: +/- and dial drag send a hold, profiles, resume, the day
// editor and comfort profiles save through the package's scripts.
//   NODE_PATH=$(npm root -g) node test/climate.js
const { chromium } = require("playwright");
const path = require("path");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const url = "file://" + path.join(__dirname, "index.html");
  const fails = [];
  const calls = () => page.evaluate(() => window.calls.filter((c) => c[0] === "script" || c[0] === "climate").map((c) => [c[1], c[2]]));
  const reset = () => page.evaluate(() => { window.calls.length = 0; });
  const tap = (sel) => page.evaluate((s) => { const r = window.card.shadowRoot; const el = r.querySelector(s); if (!el) throw new Error("no " + s); el.click(); }, sel);

  await page.goto(url + "#climate"); await page.reload(); await page.waitForTimeout(600);
  // +1 twice on the heat setpoint (68 -> 70), sent once after the pause
  await reset();
  await tap('.sp.heat'); await tap('.pm.plus'); await tap('.pm.plus');
  await page.waitForTimeout(1500);
  let c = await calls();
  const hold = c.find((x) => x[0] === "echo_climate_hold");
  if (!hold || hold[1].low !== 70 || hold[1].high !== 76 || hold[1].until !== "default") fails.push("plus: " + JSON.stringify(c));
  if (c.filter((x) => x[0] === "echo_climate_hold").length !== 1) fails.push("plus sent " + c.length + " calls");

  // cool down to the heat setpoint: the heat setpoint is pushed down by the differential
  await page.goto(url + "#climate"); await page.reload(); await page.waitForTimeout(600); await reset();
  await tap('.sp.cool');
  for (let i = 0; i < 9; i++) await tap('.pm.minus');
  await page.waitForTimeout(1500);
  c = await calls();
  const h2 = c.find((x) => x[0] === "echo_climate_hold");
  if (!h2 || h2[1].high !== 67 || h2[1].low !== 64) fails.push("differential: " + JSON.stringify(h2));

  // drag the heat knob on the dial
  await page.goto(url + "#climate"); await page.reload(); await page.waitForTimeout(600); await reset();
  const box = await page.evaluate(() => { const r = window.card.shadowRoot.querySelector('g[data-k="heat"] circle:last-of-type').getBoundingClientRect(); const s = window.card.shadowRoot.querySelector(".dial svg").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, cx: s.x + s.width / 2, cy: s.y + s.height / 2 }; });
  await page.mouse.move(box.x, box.y); await page.mouse.down();
  await page.mouse.move(box.cx - (box.cx - box.x) * 0.2 - 120, box.y + 40, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(1000);
  c = await calls();
  const h3 = c.find((x) => x[0] === "echo_climate_hold");
  if (!h3 || !(h3[1].low < 68)) fails.push("drag: " + JSON.stringify(c));

  // profile chip, hold length, resume
  await page.goto(url + "?hold#climate"); await page.reload(); await page.waitForTimeout(600); await reset();
  await tap('[data-a="profile"][data-v="sleep"]');
  await tap('[data-a="hold"][data-v="permanent"]');
  await tap('[data-a="resume"]');
  c = await calls();
  if (!c.find((x) => x[0] === "echo_climate_hold" && x[1].profile === "sleep")) fails.push("profile");
  if (!c.find((x) => x[0] === "echo_climate_hold" && x[1].until === "permanent" && x[1].low === 70)) fails.push("permanent: " + JSON.stringify(c));
  if (!c.find((x) => x[0] === "echo_climate_hold" && x[1].resume === true)) fails.push("resume");
  await tap('[data-a="mode"][data-v="heat"]');
  c = await calls();
  if (!c.find((x) => x[0] === "set_hvac_mode" && x[1].hvac_mode === "heat")) fails.push("mode");

  // day editor: delete Friday's Away, copy to Thursday, save
  await page.goto(url + "#climate-day"); await page.reload(); await page.waitForTimeout(700); await reset();
  await page.evaluate(() => { const sh = window.card.shadowRoot.querySelector(".sheet"); sh.querySelector('[data-d="del"][data-v="1"]').click(); sh.querySelector('[data-d="copy"][data-v="thu"]').click(); sh.querySelector('[data-d="save"]').click(); });
  await page.waitForTimeout(200);
  c = await calls();
  const wk = c.find((x) => x[0] === "echo_climate_set");
  const fri = wk && wk[1].data.week.fri;
  if (!fri || fri.length !== 3 || fri.some((e) => e.p === "away") || !wk[1].data.week.thu) fails.push("day save: " + JSON.stringify(wk));

  // comfort: Sleep heat +1, follow Downstairs too, save
  await page.goto(url + "#climate-comfort"); await page.reload(); await page.waitForTimeout(600); await reset();
  await tap('[data-c="low"][data-k="sleep"][data-v="1"]');
  await tap('[data-c="room"][data-k="sleep"][data-v="downstairs"]');
  await tap(".save");
  await page.waitForTimeout(200);
  c = await calls();
  const pr = c.find((x) => x[0] === "echo_climate_set");
  const sl = pr && pr[1].data.profiles.sleep;
  if (!sl || sl.low !== 65 || sl.sensors.join() !== "bedroom,downstairs") fails.push("comfort: " + JSON.stringify(pr));

  // house sheet: override to Home
  await page.goto(url + "#climate-house"); await page.reload(); await page.waitForTimeout(600); await reset();
  await page.evaluate(() => window.card.shadowRoot.querySelector('.sheet [data-h="ovr"][data-v="home"]').click());
  c = await calls();
  if (!c.find((x) => x[0] === "echo_house_set" && x[1].override === "home")) fails.push("house override");

  if (errors.length) fails.push("page errors: " + errors.join("; "));
  await browser.close();
  if (fails.length) { console.log("FAIL\n - " + fails.join("\n - ")); process.exit(1); }
  console.log("climate card: all interactions ok");
})();
