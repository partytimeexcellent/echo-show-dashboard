// This display's Kiosk Satellite timers: the Clock card, overlay, badges and settings tab, through
// Home Assistant (vs_* actions) and on the kiosk (window.kioskSatellite), with the fake kiosk in index.html.
//   NODE_PATH=$(npm root -g) node test/timers-ks.js
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
  const wait = (ms) => p.waitForTimeout(ms);
  const open = async (q) => { await p.goto(url + q); await p.reload(); await wait(1400); };
  const text = () => p.evaluate(() => card.shadowRoot.textContent);
  const click = (sel) => p.evaluate((s) => { const e = card.shadowRoot.querySelector(s); if (!e) throw new Error("missing " + s); e.click(); }, sel);
  const esCalls = (sv) => p.evaluate((sv) => calls.filter((c) => c[0] === "esphome" && (!sv || c[1] === sv)).map((c) => c[2]), sv);
  const jsCalls = () => p.evaluate(() => calls.filter((c) => c[0] === "js").map((c) => c.slice(1)));
  const tileId = (name) => p.evaluate((n) => { const t = [...card.shadowRoot.querySelectorAll(".tcol")].find((e) => e.querySelector(".nm").textContent === n); return t ? t.getAttribute("data-id") : null; }, name);
  const toast = () => p.evaluate(() => card.shadowRoot.querySelector(".toast").textContent);

  // ---- through Home Assistant (a browser that isn't the kiosk) ----
  await open("#clock-timers");
  await p.evaluate(() => localStorage.removeItem("echo-timer-recents"));
  await open("#clock-timers");
  let txt = await text();
  check(/Pasta/.test(txt) && /Bread/.test(txt), "Timers tab lists the kiosk's timers (Pasta, Bread)");
  check((await esCalls("vs_list_timers")).length >= 1, "read them with vs_list_timers");
  await p.screenshot({ path: out("ks-timers") });

  const pasta = await tileId("Pasta");
  await click('.rb.pause[data-id="' + pasta + '"]'); await wait(500);
  check(JSON.stringify(await esCalls("vs_pause_timer")) === JSON.stringify([{ timer_id: pasta }]), "pause -> vs_pause_timer with its timer_id");
  check(/Paused/.test(await p.evaluate((id) => card.shadowRoot.querySelector('.tcol[data-id="' + id + '"] .sub').textContent, pasta)), "the tile shows Paused after the list is re-read");
  await click('.rb.play[data-id="' + pasta + '"]'); await wait(400);
  check((await esCalls("vs_resume_timer")).length === 1, "resume -> vs_resume_timer");

  // drag-to-adjust: +5 min
  await click('.ring[data-id="' + pasta + '"]'); await wait(300);
  const tr = await p.evaluate(() => { const r = card.shadowRoot.querySelector(".atrack").getBoundingClientRect(); return { x: r.x, y: r.y + r.height / 2, w: r.width }; });
  await p.mouse.move(tr.x + tr.w / 2, tr.y); await p.mouse.down(); await p.mouse.move(tr.x + tr.w * 0.66, tr.y, { steps: 5 }); await p.mouse.up();
  await p.screenshot({ path: out("ks-adjust") });
  await click('[data-act="adj-apply"]'); await wait(400);
  const add = (await esCalls("vs_add_time"))[0];
  check(add && add.timer_id === pasta && add.minutes > 0 && add.hours === 0, "adjust -> vs_add_time " + JSON.stringify(add));

  // start: preset with a name that's taken, a plain length, a typed name
  await click(".corner.plus"); await wait(400);
  await p.screenshot({ path: out("ks-add") });
  await click('.chip[data-name="Pasta"]'); await wait(500);
  await click(".go"); await wait(500);
  let st = await esCalls("vs_start_timer");
  check(st.length === 1 && st[0].name === "Pasta 2" && st[0].minutes === 10, "named preset taken -> starts \"Pasta 2\" " + JSON.stringify(st[0]));
  await click(".corner.plus"); await wait(400);
  await click('.chip[data-sec="600"][data-name=""]'); await wait(1200);   // Start ignores a second tap within 1.5 s
  await click(".go"); await wait(500);
  st = await esCalls("vs_start_timer");
  check(st[1] && st[1].name === "10 min" && st[1].minutes === 10, "plain length (a recent) -> named \"10 min\"");
  await wait(300);
  await click(".corner.plus"); await wait(400);
  await p.evaluate(() => { const i = card.shadowRoot.querySelector(".tname"); i.focus(); });
  await p.keyboard.type("Eggs");
  await click('.chip[data-sec="600"][data-name=""]'); await wait(1200);   // Start ignores a second tap within 1.5 s
  await click(".go"); await wait(500);
  st = await esCalls("vs_start_timer");
  check(st[2] && st[2].name === "Eggs", "typed name -> \"Eggs\"");
  await wait(400);
  txt = await text();
  check(/Pasta 2/.test(txt) && /10 min/.test(txt) && /Eggs/.test(txt), "new timers show up (no limit of three)");
  await p.screenshot({ path: out("ks-many-live") });

  const eggs = await tileId("Eggs");
  await click('.rb[data-act="cancel"][data-id="' + eggs + '"]'); await wait(400);
  check((await esCalls("vs_cancel_timer")).some((d) => d.timer_id === eggs), "cancel -> vs_cancel_timer");
  check(!errs.length, "no page errors " + errs.join(" | "));

  // two unnamed timers of the same length: HA can't tell them apart
  await open("?notimers&dupe#clock-timers");
  const ids = await p.evaluate(() => [...card.shadowRoot.querySelectorAll(".tcol")].map((e) => e.getAttribute("data-id")));
  await click('.rb.pause[data-id="' + ids[0] + '"]'); await wait(500);
  check(/can't tell this timer apart/.test(await toast()), "same-length unnamed timers: clear message (" + (await toast()).slice(0, 60) + "…)");
  await p.screenshot({ path: out("ks-dupe") });

  // a finished timer: Stop silences it with vs_cancel; +1 min starts it again
  await open("?notimers&tdone#clock-timers");
  check(/Stop/.test(await text()) && /Eggs/.test(await text()), "ringing timer shows Stop");
  await p.screenshot({ path: out("ks-done") });
  await click('[data-act="stop"]'); await wait(500);
  check((await esCalls("vs_cancel")).length === 1, "Stop -> vs_cancel");
  check(!/Eggs/.test(await text()), "dismissed timer leaves the list");
  await open("?notimers&tdone#clock-timers");
  await click('[data-act="more"]'); await wait(600);
  st = await esCalls("vs_start_timer");
  check((await esCalls("vs_cancel")).length === 1 && st.length === 1 && st[0].name === "eggs" && st[0].minutes === 1, "+1 min -> vs_cancel, then eggs for 1 min");
  await open("?notimers&tdone#weather");
  check(/Done/.test(await text()), "weather button badge says Done");
  check(await p.evaluate(() => /done/.test(card.shadowRoot.querySelector("echo-timer-overlay").shadowRoot.textContent)), "overlay shows the finished timer");

  // a timer that runs out while the weather page shows: open_on_done isn't set in the test buttons, the badge turns to Done
  await open("?notimers#weather");
  await p.evaluate(() => { ksAdd("quick", 2, 2, true); ksChanged(); }); await wait(900);
  check(/0:0\d/.test(await text()), "badge counts down a new timer");
  await wait(2600);
  check(/Done/.test(await text()), "...and says Done when it rings");

  // many timers: a grid
  await open("?many#clock-timers");
  check(await p.evaluate(() => card.shadowRoot.querySelector(".main").classList.contains("many")), "five timers: grid layout");
  await p.screenshot({ path: out("ks-many") });
  await click(".corner.plus"); await wait(500);
  check(await p.evaluate(() => !card.shadowRoot.querySelector(".tcol") && !!card.shadowRoot.querySelector(".tile.add")), "adding with 3+ timers: the wheels take the page");
  await p.screenshot({ path: out("ks-many-add") });

  // ESPHome node named differently from the display ("ks_kitchen_8" for kitchen_echo_show_8)
  await open("?node=ks_kitchen_8#clock-timers");
  check(/Pasta/.test(await text()) && (await p.evaluate(() => EchoShow.timers.node())) === "ks_kitchen_8", "node found by its shared words, not Kitchen Echo Show 5's");

  // Kiosk Satellite too old (no timer actions)
  await open("?oldks#clock-timers");
  check(/Update Kiosk Satellite/.test(await text()), "old Kiosk Satellite: says to update it");
  await p.screenshot({ path: out("ks-old") });

  // settings > Timers
  await open("#settings-timers");
  const set = await p.evaluate(() => document.querySelector("echo-show-settings").shadowRoot.querySelector(".body").textContent);
  check(/kitchen_echo_show_8/.test(set) && /Mute timer alerts/.test(set) && !/Set up timers/.test(set) && !/Marimba/.test(set), "settings Timers tab: node, mute switch, volume only");
  await p.screenshot({ path: out("ks-settings") });

  // ---- on the kiosk: the JavaScript API ----
  await open("?kiosk#clock-timers");
  check(/Pasta/.test(await text()), "kiosk: reads getVoiceTimers()");
  check((await esCalls("vs_list_timers")).length === 0, "kiosk: no vs_list_timers round trips");
  const kp = await tileId("Pasta");
  await click('.rb.pause[data-id="' + kp + '"]'); await wait(300);
  check(JSON.stringify(await jsCalls()) === JSON.stringify([["pause", kp, null]]) || (await jsCalls())[0][0] === "pause", "kiosk: pause -> controlVoiceTimer");
  check(/Paused/.test(await p.evaluate((id) => card.shadowRoot.querySelector('.tcol[data-id="' + id + '"] .sub').textContent, kp)), "kiosk: the event updates the tile");
  await click(".corner.plus"); await wait(400);
  await click('.chip[data-sec="600"][data-name=""]'); await wait(500);
  await click(".go"); await wait(400);
  check((await esCalls("vs_start_timer")).length === 1 && /10 min/.test(await text()), "kiosk: start still goes through vs_start_timer and shows up");
  // HA caches views: the listener goes with the page and the list is read again on return
  const reads = await p.evaluate(async () => {
    let n = 0; const g = window.kioskSatellite.getVoiceTimers; window.kioskSatellite.getVoiceTimers = function () { n++; return g(); };
    const parent = card.parentNode; parent.removeChild(card);
    ksAdd("soup", 600, 600, true); ksChanged();
    const stale = !/Soup/.test(card.shadowRoot.textContent);
    parent.appendChild(card);
    await new Promise((r) => setTimeout(r, 300));
    return { n, stale, fresh: /Soup/.test(card.shadowRoot.textContent) };
  });
  check(reads.stale && reads.n >= 1 && reads.fresh, "kiosk: no updates while the view is cached, re-read on return " + JSON.stringify(reads));

  check(!errs.length, "no page errors " + errs.join(" | "));
  await b.close();
  process.exit(fail ? 1 : 0);
})();
