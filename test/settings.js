// Screenshots of the settings tabs, overlay, hourly chart, media.
const { chromium } = require("playwright");
const path = require("path");
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  const url = "file://" + path.join(__dirname, "index.html");
  const out = (n) => path.join(__dirname, "screenshots", n + ".png");
  for (const t of ["general", "display", "weather", "timers", "media", "alerts", "about"]) {
    await p.goto(url + "#settings-" + t); await p.reload(); await p.waitForTimeout(1300);
    await p.screenshot({ path: out("set-" + t) });
  }
  await p.goto(url + "#weather"); await p.reload(); await p.waitForTimeout(1200);
  await p.screenshot({ path: out("w-daily") });
  await p.evaluate(() => card.shadowRoot.querySelector(".fc").click()); await p.waitForTimeout(600);
  await p.screenshot({ path: out("w-hourly") });
  await p.goto(url + "#media"); await p.reload(); await p.waitForTimeout(1200);
  await p.screenshot({ path: out("m-np") });
  console.log("errors:", errs.length ? errs : "none");
  await b.close();
})();
