// The volume level bar: shows when this display's volume entity changes, not on load or with the settings open.
//   NODE_PATH=$(npm root -g) node test/volume-hud.js
const { chromium } = require("playwright");
const path = require("path");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const url = "file://" + path.join(__dirname, "index.html") + "?echo_display=Kitchen%20Echo%20Show%208#weather";
  await page.goto(url);
  await page.waitForTimeout(1500);
  const shown = () => page.evaluate(() => { const h = document.querySelector("echo-volume-hud"); return !!h && h.classList.contains("on") ? h.shadowRoot.querySelector(".nm").textContent + " " + h.shadowRoot.querySelector(".pc").textContent : ""; });
  const change = (suffix, v) => page.evaluate(([s, v]) => {
    const id = "number.kitchen_echo_show_8_" + s, old = card.hass.states[id];
    const st = Object.assign({}, old, { state: String(v), last_changed: new Date().toISOString() });
    card.hass = Object.assign({}, card.hass, { states: Object.assign({}, card.hass.states, { [id]: st }) });
  }, [suffix, v]);
  let failed = false;
  const check = (what, got, want) => { const ok = got === want; if (!ok) failed = true; console.log(`${ok ? "ok  " : "FAIL"} ${what}: ${JSON.stringify(got)}`); };

  check("nothing on load", await shown(), "");
  await change("volume", 47);
  await page.waitForTimeout(450);
  check("device volume", await shown(), "Device volume 47%");
  await page.screenshot({ path: path.join(__dirname, "screenshots", "volume-hud.png") });
  await page.waitForTimeout(2000);
  check("fades", await shown(), "");
  await change("assistant_volume", 30);
  await page.waitForTimeout(450);
  check("assistant volume", await shown(), "Assistant volume 30%");
  await page.waitForTimeout(2000);
  await page.evaluate(() => window.EchoShow.prefs.set("volume_hud", "off"));
  await change("volume", 60);
  await page.waitForTimeout(450);
  check("off in settings", await shown(), "");
  await page.evaluate(() => window.EchoShow.prefs.set("volume_hud", null));
  check("no page errors", errors.join("; "), "");
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
