// Screenshots for the README (docs/*.png), one per page at the Echo Show 8's 1280×800,
// with real Material Design icons in place of the test page's initials.
//   npm i -g playwright @mdi/js && NODE_PATH=$(npm root -g) node test/readme-shots.js
const { chromium } = require("playwright");
const mdi = require("@mdi/js");
const path = require("path");

const camel = (n) => "mdi" + n.replace(/^mdi:/, "").split("-").map((s) => s[0].toUpperCase() + s.slice(1)).join("");
const icons = {};
for (const k of Object.keys(mdi)) icons[k] = mdi[k];

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
  await p.addInitScript(({ icons, camelSrc }) => {
    const camel = eval(camelSrc);
    class Icon extends HTMLElement {
      static get observedAttributes() { return ["icon"]; }
      connectedCallback() { this.r(); }
      attributeChangedCallback() { this.r(); }
      r() {
        const d = icons[camel(this.getAttribute("icon") || "")] || "";
        this.style.cssText += ";align-items:center;justify-content:center";
        this.innerHTML = '<svg viewBox="0 0 24 24" style="width:var(--mdc-icon-size,24px);height:var(--mdc-icon-size,24px);fill:currentColor;display:block"><path d="' + d + '"/></svg>';
      }
    }
    try { localStorage.setItem("echo-show-prefs", JSON.stringify({ overlay: "off" })); } catch (e) {}   // keep pages uncovered
    const define = customElements.define.bind(customElements);
    customElements.define = (name, cls, opts) => define(name, name === "ha-icon" ? Icon : cls, opts);
  }, { icons, camelSrc: camel.toString() });
  const url = "file://" + path.join(__dirname, "index.html");
  for (const [view, name] of [["weather", "weather"], ["clock-alarms", "clock"], ["media", "media"], ["climate", "climate"], ["settings-general", "settings"]]) {
    await p.goto(url + "#" + view);
    await p.reload();
    await p.waitForTimeout(1800);
    await p.screenshot({ path: path.join(__dirname, "..", "docs", name + ".png") });
  }
  await b.close();
})();
