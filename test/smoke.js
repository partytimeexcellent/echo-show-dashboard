// Loads the bundle in Chromium for each card and fails on any page error.
//   npm i -g playwright && NODE_PATH=$(npm root -g) node test/smoke.js
const { chromium } = require("playwright");
const path = require("path");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  const url = "file://" + path.join(__dirname, "index.html");
  let failed = false;
  for (const view of ["weather", "timers", "clock-alarms", "clock-stopwatch", "media", "notify"]) {
    await page.goto(url + "#" + view);
    await page.reload();
    await page.waitForTimeout(1200);
    const r = await page.evaluate(() => ({
      defined: ["echo-weather-card", "echo-clock-card", "echo-timer-card", "echo-media-card", "echo-alarm-settings"].filter((n) => !customElements.get(n)),
      notify: !!window.echoNotify,
      bundle: window.EchoShowDashboard,
      errors: window.errors,
      text: (document.querySelector("body > [class], body > *:last-child") || document.body).shadowRoot
        ? document.body.lastElementChild.shadowRoot.textContent.replace(/\s+/g, " ").slice(0, 120)
        : "",
    }));
    const errs = pageErrors.splice(0).concat(r.errors);
    const ok = !r.defined.length && r.notify && !errs.length;
    if (!ok) failed = true;
    console.log(`${ok ? "ok  " : "FAIL"} ${view.padEnd(8)} ${r.bundle ? r.bundle.version : "no bundle"}  ${r.text}`);
    if (r.defined.length) console.log("     missing elements:", r.defined.join(", "));
    errs.forEach((e) => console.log("     error:", e));
    await page.screenshot({ path: path.join(__dirname, "screenshots", view + ".png") });
  }
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
