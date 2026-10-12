// Runs dist/echo-show.html (the Kiosk Satellite custom page) against a fake Home Assistant:
// an HTTP server for /local/ and /hacsfiles/, /auth/token, and HA's WebSocket API
// (auth, subscribe_entities, lovelace/config, call_service, ...). The states, dashboard and
// forecast come from test/index.html's fake HA. Screenshots go to test/screenshots/page-*.png.
//   NODE_PATH=$(npm root -g) node test/page.js
const { chromium } = require("playwright");
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(__dirname, "screenshots");
let failed = false;
function check(ok, what, extra) {
  if (!ok) failed = true;
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${extra ? "  " + extra : ""}`);
}

// ---------- a minimal WebSocket server (text frames only) ----------
function wsAccept(req, socket, onMessage, onClose) {
  const key = req.headers["sec-websocket-key"];
  const accept = crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n");
  let buf = Buffer.alloc(0), closed = false;
  const peer = {
    send(obj) {
      if (closed) return;
      const data = Buffer.from(JSON.stringify(obj));
      let head;
      if (data.length < 126) head = Buffer.from([0x81, data.length]);
      else if (data.length < 65536) { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 126; head.writeUInt16BE(data.length, 2); }
      else { head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127; head.writeBigUInt64BE(BigInt(data.length), 2); }
      socket.write(Buffer.concat([head, data]));
    },
    close() { if (!closed) { closed = true; socket.write(Buffer.from([0x88, 0])); socket.end(); onClose(); } },
  };
  socket.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const op = buf[0] & 0x0f, masked = buf[1] & 0x80;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      const mask = masked ? buf.slice(off, off + 4) : null;
      if (masked) off += 4;
      if (buf.length < off + len) return;
      const payload = Buffer.from(buf.slice(off, off + len));
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      buf = buf.slice(off + len);
      if (op === 8) { peer.close(); return; }
      if (op === 1) onMessage(JSON.parse(payload.toString()));
    }
  });
  socket.on("close", () => { if (!closed) { closed = true; onClose(); } });
  socket.on("error", () => {});
  return peer;
}

// ---------- the fake Home Assistant ----------
function fakeHA(fx) {
  const ha = { tokens: new Set(["tok-1"]), refreshes: 0, calls: [], sockets: [], states: fx.states, subs: new Map(), wsCount: 0 };
  function compressed(s) {
    const out = { s: s.state, a: s.attributes || {}, c: "ctx", lc: Date.parse(s.last_changed || Date.now()) / 1000 };
    return out;
  }
  ha.setState = function (id, state, attrs) {
    const cur = ha.states[id];
    const plus = { s: state, lc: Date.now() / 1000 };
    if (attrs) plus.a = attrs;
    ha.states[id] = Object.assign({}, cur, { state, attributes: Object.assign({}, cur.attributes, attrs || {}) });
    for (const sock of ha.sockets) for (const [id2, sub] of sock.subs) if (sub === "entities") sock.peer.send({ id: id2, type: "event", event: { c: { [id]: { "+": plus } } } });
  };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/local/echo-show.html") return send(res, 200, "text/html", fs.readFileSync(path.join(ROOT, "dist", "echo-show.html")));
    if (u.pathname === "/hacsfiles/echo-show-dashboard/echo-show-dashboard.js") return send(res, 200, "application/javascript", fs.readFileSync(path.join(ROOT, "dist", "echo-show-dashboard.js")));
    if (u.pathname === "/local/art.jpg") return send(res, 200, "image/jpeg", fs.readFileSync(path.join(__dirname, "art.jpg")));
    if (u.pathname === "/auth/token" && req.method === "POST") {
      let body = "";
      req.on("data", (d) => (body += d));
      req.on("end", () => {
        const p = new URLSearchParams(body);
        if (p.get("refresh_token") !== "refresh-1") return send(res, 400, "application/json", '{"error":"invalid_grant"}');
        ha.refreshes++;
        const t = "tok-r" + ha.refreshes;
        ha.tokens.add(t);
        send(res, 200, "application/json", JSON.stringify({ access_token: t, expires_in: 1800, token_type: "Bearer" }));
      });
      return;
    }
    send(res, 404, "text/plain", "not found");
  });
  function send(res, code, type, body) { res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" }); res.end(body); }
  server.on("upgrade", (req, socket) => {
    if (req.url !== "/api/websocket") return socket.destroy();
    ha.wsCount++;
    const sock = { authed: false, subs: new Map() };
    sock.peer = wsAccept(req, socket, (m) => onMsg(sock, m), () => { ha.sockets = ha.sockets.filter((s) => s !== sock); });
    ha.sockets.push(sock);
    sock.peer.send({ type: "auth_required", ha_version: "2026.10.1" });
  });
  function result(sock, id, r) { sock.peer.send({ id, type: "result", success: true, result: r === undefined ? null : r }); }
  function error(sock, id, code, message) { sock.peer.send({ id, type: "result", success: false, error: { code, message } }); }
  function onMsg(sock, m) {
    if (!sock.authed) {
      if (m.type === "auth" && ha.tokens.has(m.access_token)) { sock.authed = true; sock.peer.send({ type: "auth_ok", ha_version: "2026.10.1" }); }
      else { sock.peer.send({ type: "auth_invalid", message: "Invalid access token" }); sock.peer.close(); }
      return;
    }
    ha.calls.push(m);
    switch (m.type) {
      case "supported_features": return result(sock, m.id);
      case "ping": return sock.peer.send({ id: m.id, type: "pong" });
      case "get_config": return result(sock, m.id, fx.config);
      case "get_services": return result(sock, m.id, fx.services);
      case "auth/current_user": return result(sock, m.id, { id: "u1", name: "Test", is_admin: true });
      case "frontend/get_user_data": return result(sock, m.id, { value: { language: "en", time_format: "12" } });
      case "config/entity_registry/list_for_display": return result(sock, m.id, { entity_categories: {}, entities: [] });
      case "config/device_registry/list": return result(sock, m.id, []);
      case "config/area_registry/list": return result(sock, m.id, []);
      case "lovelace/resources": return result(sock, m.id, [{ id: "r1", type: "module", url: "/hacsfiles/echo-show-dashboard/echo-show-dashboard.js?hacstag=1" }]);
      case "lovelace/config": return m.url_path === "echo-show" ? result(sock, m.id, fx.dash) : error(sock, m.id, "config_not_found", "No config found.");
      case "subscribe_entities": {
        sock.subs.set(m.id, "entities");
        result(sock, m.id);
        const a = {};
        for (const id in ha.states) a[id] = compressed(ha.states[id]);
        return sock.peer.send({ id: m.id, type: "event", event: { a } });
      }
      case "subscribe_events": sock.subs.set(m.id, "events:" + m.event_type); return result(sock, m.id);
      case "persistent_notification/subscribe": sock.subs.set(m.id, "pn"); result(sock, m.id); return sock.peer.send({ id: m.id, type: "event", event: { type: "current", notifications: {} } });
      case "weather/subscribe_forecast":
        sock.subs.set(m.id, "forecast"); result(sock, m.id);
        return sock.peer.send({ id: m.id, type: "event", event: { type: m.forecast_type, forecast: fx.forecast[m.forecast_type] || [] } });
      case "unsubscribe_events": sock.subs.delete(m.subscription); return result(sock, m.id);
      case "call_service":
        if (m.domain === "esphome" && /_vs_list_timers$/.test(m.service)) return result(sock, m.id, { context: {}, response: { timers: [] } });
        return result(sock, m.id, { context: { id: "c" } });
      case "history/history_during_period": return result(sock, m.id, {});
      default: return result(sock, m.id, null);
    }
  }
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => { ha.port = server.address().port; ha.server = server; resolve(ha); }));
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  // Fixtures from test/index.html's fake HA.
  const fxPage = await browser.newPage();
  await fxPage.goto("file://" + path.join(__dirname, "index.html") + "#weather");
  await fxPage.waitForTimeout(500);
  const fx = await fxPage.evaluate(() => {
    const views = {};
    const nav = (b) => (b.navigation_path ? Object.assign({}, b, { navigation_path: "/echo-show/" + b.navigation_path.slice(1) }) : b);
    const dash = { echo_notify: DASH.echo_notify, views: Object.keys(CONFIGS).map((k) => {
      const c = JSON.parse(JSON.stringify(CONFIGS[k][1]));
      c.buttons = (c.buttons || []).map(nav);
      return { path: k, type: "panel", cards: [Object.assign({ type: "custom:" + CONFIGS[k][0] }, c)] };
    }) };
    return { states: JSON.parse(JSON.stringify(states)), config: hass.config, services: JSON.parse(JSON.stringify(hass.services)),
      dash, forecast: { daily: forecast("daily"), hourly: forecast("hourly") } };
  });
  await fxPage.close();

  const ha = await fakeHA(fx);
  const base = `http://127.0.0.1:${ha.port}`;
  const tokens = (access, expires) => JSON.stringify({ access_token: access, refresh_token: "refresh-1", clientId: base + "/", hassUrl: base, expires, expires_in: 1800, token_type: "Bearer" });

  async function open(tok, hash, query) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    if (tok) await ctx.addInitScript((t) => { if (!sessionStorage.getItem("seeded")) { localStorage.setItem("hassTokens", t); sessionStorage.setItem("seeded", "1"); } }, tok);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("response", (r) => { if (r.status() >= 400) console.log("     " + r.status() + " " + r.url()); });
    await page.goto(base + "/local/echo-show.html" + (query || "") + (hash || ""));
    return { ctx, page, errors };
  }
  const shown = (page) => page.evaluate(() => { const el = document.querySelector("#view > *"); return el ? el.tagName.toLowerCase() : null; });

  // 1. Signed in: the weather view loads, icons draw, buttons switch views without a reload.
  {
    const { ctx, page, errors } = await open(tokens("tok-1", Date.now() + 3600e3), "", "?perf");
    await page.waitForFunction(() => window.EchoShowPage && window.EchoShowPage.timings.firstCard, null, { timeout: 15000 });
    await page.waitForTimeout(800);
    check((await shown(page)) === "echo-weather-card", "first view is the weather card");
    const icons = await page.evaluate(() => {
      const card = document.querySelector("echo-weather-card");
      const all = Array.from(card.shadowRoot.querySelectorAll("ha-icon"));
      return { n: all.length, drawn: all.filter((i) => i.shadowRoot && i.shadowRoot.querySelector("path[d]")).length };
    });
    check(icons.n > 0 && icons.drawn === icons.n, "ha-icon draws MDI icons", `${icons.drawn}/${icons.n}`);
    const t = await page.evaluate(() => window.EchoShowPage.timings);
    console.log("     timings (ms, local):", JSON.stringify(t));
    await page.screenshot({ path: path.join(OUT, "page-weather.png") });

    await page.evaluate(() => { window.__noReload = true; });
    await page.evaluate(() => {
      const card = document.querySelector("echo-weather-card");
      card.shadowRoot.querySelectorAll(".btn")[1].click();
    });
    await page.waitForTimeout(800);
    check((await shown(page)) === "echo-clock-card", "Clock button opens the clock view");
    check(await page.evaluate(() => location.pathname === "/local/echo-show.html" && location.hash === "#timers" && window.__noReload === true), "address stays on the page (#timers), no reload", await page.evaluate(() => location.pathname + location.search + location.hash));
    await page.screenshot({ path: path.join(OUT, "page-timers.png") });

    await page.evaluate(() => { location.hash = "#climate"; });
    await page.waitForTimeout(1000);
    check((await shown(page)) === "echo-climate-card", "Kiosk Satellite #climate address switches views");
    await page.screenshot({ path: path.join(OUT, "page-climate.png") });

    await page.evaluate(() => { location.hash = "#media"; });
    await page.waitForTimeout(1000);
    check((await shown(page)) === "echo-media-card", "#media");
    await page.screenshot({ path: path.join(OUT, "page-media.png") });

    // State changes reach the visible card.
    await page.evaluate(() => { location.hash = "#weather"; });
    await page.waitForTimeout(600);
    ha.setState("sensor.backyard", "12.3");
    await page.waitForTimeout(400);
    const txt = await page.evaluate(() => document.querySelector("echo-weather-card").shadowRoot.textContent);
    check(/12/.test(txt) && (await page.evaluate(() => document.querySelector("echo-weather-card").hass.states["sensor.backyard"].state)) === "12.3", "state change reaches the card");

    // Settings > About shows the page type and load time.
    await page.evaluate(() => document.querySelector("echo-weather-card").shadowRoot.querySelectorAll(".btn")[4].click());
    await page.waitForTimeout(500);
    await page.evaluate(() => { const p = document.querySelector("echo-show-settings"); const t = p && p.shadowRoot.querySelector('.tab[data-t="about"]'); if (t) t.click(); });
    await page.waitForTimeout(500);
    const about = await page.evaluate(() => { const p = document.querySelector("echo-show-settings"); return p ? p.shadowRoot.textContent.replace(/\s+/g, " ") : ""; });
    check(/Custom page/.test(about) && /Loaded in\s*[\d.]+ s/.test(about), "About shows custom page and load time", (about.match(/Page.{0,120}/) || [""])[0]);
    await page.screenshot({ path: path.join(OUT, "page-about.png") });

    // Reconnect: the socket drops, the page connects again and subscribes again.
    const before = ha.wsCount;
    ha.sockets.forEach((s) => s.peer.close());
    await page.waitForTimeout(2500);
    check(ha.wsCount > before && ha.sockets.length === 1, "reconnects after the connection drops");
    ha.setState("sensor.backyard", "15.5");
    await page.waitForTimeout(400);
    check((await page.evaluate(() => document.querySelector("home-assistant").hass.states["sensor.backyard"].state)) === "15.5", "states flow again after reconnecting");
    check(!errors.length, "no page errors", errors.slice(0, 3).join(" | "));
    await ctx.close();
  }

  // 2. Expired access token: refreshed with the saved refresh token and written back.
  {
    const r0 = ha.refreshes;
    const { ctx, page, errors } = await open(tokens("tok-old", Date.now() - 1000), "#timers");
    await page.waitForFunction(() => window.EchoShowPage && window.EchoShowPage.timings.firstCard, null, { timeout: 15000 });
    check(ha.refreshes === r0 + 1, "expired token is refreshed");
    check(JSON.parse(await page.evaluate(() => localStorage.getItem("hassTokens"))).access_token === "tok-r" + ha.refreshes, "new token saved for next time");
    check((await shown(page)) === "echo-clock-card", "#timers opens straight on the clock view");
    check(!errors.length, "no page errors", errors.slice(0, 3).join(" | "));
    await ctx.close();
  }

  // 3. Token HA no longer accepts (but not expired by the clock): refresh on auth_invalid.
  {
    const r0 = ha.refreshes;
    const { ctx, page } = await open(tokens("tok-revoked", Date.now() + 3600e3), "");
    await page.waitForFunction(() => window.EchoShowPage && window.EchoShowPage.timings.firstCard, null, { timeout: 15000 });
    check(ha.refreshes === r0 + 1, "rejected token is refreshed once");
    await ctx.close();
  }

  // 4. Never signed in: says so instead of a blank screen.
  {
    const { ctx, page } = await open(null, "");
    await page.waitForTimeout(800);
    const msg = await page.evaluate(() => document.getElementById("msg").textContent);
    check(/isn't signed in/.test(msg), "not signed in: explains what to do");
    await page.screenshot({ path: path.join(OUT, "page-login.png") });
    await ctx.close();
  }

  await browser.close();
  ha.server.close();
  console.log(failed ? "FAILED" : "all ok");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
