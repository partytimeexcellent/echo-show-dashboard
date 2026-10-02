// Clock card Alarms tab: volume row, swipe-to-delete, Edit mode, Undo.
//   NODE_PATH=$(npm root -g) node test/alarm-list.js
const { chromium } = require("playwright");
const path = require("path");
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 800 }, hasTouch: false });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  const url = "file://" + path.join(__dirname, "index.html");
  const out = (n) => path.join(__dirname, "screenshots", n + ".png");
  const wait = (ms) => p.waitForTimeout(ms);
  const sr = (sel) => p.evaluate((s) => { const e = card.shadowRoot.querySelector(s); if (!e) throw new Error("missing " + s); e.click(); }, sel);
  const box = (sel) => p.evaluate((s) => { const r = card.shadowRoot.querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, sel);
  const alarms = () => p.evaluate(() => kioskAlarms.map((a) => a.time + (a.label ? " " + a.label : "") + (a.on ? "" : " (off)")).join(", "));
  const ks = () => p.evaluate(() => calls.filter((c) => c[0] === "ks").map((c) => c[1] + " " + JSON.stringify(c[2])).join(" | "));

  await p.goto(url + "#clock-alarms"); await p.reload(); await wait(1500);
  console.log("volume row shown:", await p.evaluate(() => card.shadowRoot.querySelector(".avol").classList.contains("on")));
  await p.screenshot({ path: out("al-list") });

  // drag the volume to ~50%
  let v = await box(".vtrack");
  await p.mouse.move(v.x + v.w * 0.3, v.y + v.h / 2); await p.mouse.down(); await p.mouse.move(v.x + v.w * 0.47, v.y + v.h / 2, { steps: 4 }); await p.mouse.up(); await wait(700);
  console.log("volume calls:", await ks());

  // swipe the first row left
  let r = await box('.aw[data-k="0"] .arow');
  await p.mouse.move(r.x + r.w * 0.7, r.y + r.h / 2); await p.mouse.down();
  await p.mouse.move(r.x + r.w * 0.35, r.y + r.h / 2, { steps: 8 }); await p.mouse.up(); await wait(400);
  await p.screenshot({ path: out("al-swiped") });
  await sr('.aw[data-k="0"] .adel'); await wait(700);
  console.log("after swipe-delete:", await alarms());
  await p.screenshot({ path: out("al-undo") });
  await p.evaluate(() => card.shadowRoot.querySelector(".toast .tact").click()); await wait(1200);
  console.log("after undo:", await alarms());

  // Edit mode: X on the "Pizza out" row
  await sr(".edit-alarms"); await wait(300);
  await p.screenshot({ path: out("al-edit") });
  const k = await p.evaluate(() => card._alarms.findIndex((a) => a.label === "Pizza out"));
  await sr('.arow[data-k="' + k + '"] .ax'); await wait(900);
  console.log("after edit-delete:", await alarms());
  console.log("edit button:", await p.evaluate(() => card.shadowRoot.querySelector(".edit-alarms").textContent));

  // a tap on a row still opens the editor when not editing
  await sr(".edit-alarms"); await wait(200);
  await sr('.aw[data-k="0"] .arow'); await wait(400);
  console.log("tap opens editor:", await p.evaluate(() => !!card.shadowRoot.querySelector(".sheet")));

  // no helper installed -> no volume row
  await p.goto(url + "?noshell#clock-alarms"); await p.reload(); await wait(1200);
  console.log("volume row without helper:", await p.evaluate(() => card.shadowRoot.querySelector(".avol").classList.contains("on")));
  console.log("errors:", errs.length ? errs : "none");
  await b.close();
})();
