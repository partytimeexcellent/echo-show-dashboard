// Screenshots of the Clock card's interactive states.
//   NODE_PATH=$(npm root -g) node test/clock.js
const { chromium } = require("playwright");
const path = require("path");
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  const url = "file://" + path.join(__dirname, "index.html");
  const out = (n) => path.join(__dirname, "screenshots", n + ".png");
  const sr = (sel) => p.evaluate((s) => { const e = card.shadowRoot.querySelector(s); if (!e) throw new Error("missing " + s); e.click(); }, sel);
  const wait = (ms) => p.waitForTimeout(ms);

  // Alarm editor: open the 6:30 alarm, roll the hour wheel by dragging, flip a day.
  await p.goto(url + "#clock-alarms"); await p.reload(); await wait(1200);
  await sr('.arow[data-k="0"]'); await wait(400);
  await p.screenshot({ path: out("c-alarm-edit") });
  const box = await p.evaluate(() => { const r = card.shadowRoot.querySelector(".sheet .wheel").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await p.mouse.move(box.x, box.y); await p.mouse.down();
  for (let i = 1; i <= 8; i++) { await p.mouse.move(box.x, box.y - i * 15); await wait(16); }
  await p.mouse.up(); await wait(900);
  await sr('.dchip[data-day="sat"]'); await wait(100);
  const picked = await p.evaluate(() => [...card.shadowRoot.querySelectorAll(".sheet .wi.sel")].map((e) => e.textContent).join(" "));
  console.log("editor wheels now:", picked);
  await p.screenshot({ path: out("c-alarm-edit2") });
  await sr('.sbtn.save'); await wait(1400);
  console.log("alarms after save:", JSON.stringify(await p.evaluate(() => kioskAlarms.map((a) => a.time + " " + a.days.join("/") + " " + a.on))));
  await p.screenshot({ path: out("c-alarm-saved") });

  // Toggle the weekend alarm on.
  await sr('.arow[data-k="1"] .sw'); await wait(900);
  console.log("after toggle:", JSON.stringify(await p.evaluate(() => kioskAlarms.map((a) => a.time + " " + a.on))));

  // New alarm sheet in 24 h.
  await sr(".add-alarm"); await wait(400);
  await p.screenshot({ path: out("c-alarm-add") });

  // Ringing banner + empty list.
  await p.goto(url + "?ringing&noalarms#clock-alarms"); await p.reload(); await wait(1300);
  await p.screenshot({ path: out("c-alarm-ringing") });

  // Stopwatch with laps.
  await p.goto(url + "#clock-stopwatch"); await p.reload(); await wait(800);
  await sr('[data-sw="right"]'); await wait(700);
  await sr('[data-sw="left"]'); await wait(450);
  await sr('[data-sw="left"]'); await wait(900);
  await sr('[data-sw="left"]'); await wait(300);
  await p.screenshot({ path: out("c-sw-running") });
  await sr('[data-sw="right"]'); await wait(200);
  await p.screenshot({ path: out("c-sw-stopped") });
  await sr('[data-sw="left"]');   // reset

  // New-timer wheels: free every slot.
  await p.goto(url + "#clock-timers"); await p.reload(); await wait(800);
  await p.evaluate(() => { ["1", "2"].forEach((n) => { states["timer.echo_timer_" + n] = Object.assign({}, states["timer.echo_timer_" + n], { state: "idle" }); states["input_text.echo_timer_" + n + "_name"] = Object.assign({}, states["input_text.echo_timer_" + n + "_name"], { state: "" }); }); card.hass = Object.assign({}, hass, { states: Object.assign({}, states) }); });
  await wait(600);
  await p.screenshot({ path: out("c-timer-new") });
  await sr('.chip[data-sec="600"]'); await wait(600);
  await sr(".go"); await wait(200);
  console.log("start call:", JSON.stringify(await p.evaluate(() => calls.filter((c) => c[0] === "script").pop())));
  // Two timers + adder (three columns).
  await p.goto(url + "#clock-timers"); await p.reload(); await wait(800);
  await sr(".corner.plus"); await wait(500);
  await p.screenshot({ path: out("c-timer-add3") });
  console.log("errors:", errs.length ? errs : "none");
  await b.close();
})();
