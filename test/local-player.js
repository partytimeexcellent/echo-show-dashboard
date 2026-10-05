// The media card offers this display's own player as a room: never grouped, never another Echo Show.
//   NODE_PATH=$(npm root -g) node test/local-player.js
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
  const rooms = () => p.evaluate(() => card._rooms.map((r) => r.entity + (r.local ? "*" : "")));

  await p.goto(url + "#media"); await p.reload(); await p.waitForTimeout(1600);
  let r = await rooms();
  check(r.join() === "media_player.kitchen,media_player.living_room,media_player.kitchen_echo_show_8*", "rooms: " + r.join());
  check(r.indexOf("media_player.office_echo_show_8") === -1, "other Echo Shows are not offered");
  check(await p.evaluate(() => card._rooms[0].i === 0 && card._room().entity === "media_player.kitchen"), "still starts on the Kitchen speaker");

  // Play-on picker lists it.
  await p.evaluate(() => card._openTargetPicker());
  let txt = await p.evaluate(() => card.shadowRoot.querySelector(".sheet").textContent);
  check(/Kitchen Echo Show 8/.test(txt) && /This display/.test(txt) && !/Office/.test(txt), "play-on picker shows this display only");
  await p.evaluate(() => card._closeSheet());

  // Speakers panel with a Sonos room shown: the display row has no group button.
  await p.evaluate(() => card._openSpeakers());
  let g = await p.evaluate(() => ({ rows: card._spEl.querySelectorAll(".srow").length, btns: card._spEl.querySelectorAll(".srow:not(.loc) .gbtn").length, locBtn: card._spEl.querySelectorAll(".srow.loc .gbtn").length }));
  check(g.rows === 3 && g.btns === 2 && g.locBtn === 0, "group buttons on the 2 speakers, none on the display (" + JSON.stringify(g) + ")");
  await p.screenshot({ path: out("local-player-speakers") });

  // Pick the display: grouping controls go away and nothing is ever joined.
  await p.evaluate(() => { card._sel = 2; card._manual = true; card._closeOverlays(); card._paint(); card._openSpeakers(); });
  await p.waitForTimeout(200);
  const vis = await p.evaluate(() => {
    const v = (s) => Array.from(card._spEl.querySelectorAll(s)).filter((e) => getComputedStyle(e).display !== "none").length;
    return { gbtn: v(".gbtn"), all: v('.wide[data-act="group-all"]') + v('.wide[data-act="ungroup-all"]') };
  });
  check(vis.gbtn === 0 && vis.all === 0, "no grouping controls while the display is shown (" + JSON.stringify(vis) + ")");
  await p.screenshot({ path: out("local-player-selected") });
  await p.evaluate(() => { calls.length = 0; card._toggleGroup(0); card._groupAll(); card._ungroupAll(); });
  const joined = await p.evaluate(() => calls.filter((c) => /join/.test(String(c[0]) + String(c[1]))).length);
  check(joined === 0, "grouping calls are ignored for the display");
  await p.evaluate(() => { card._sel = 0; card._groupAll(); });
  const grp = await p.evaluate(() => JSON.stringify(calls));
  check(!/kitchen_echo_show_8/.test(grp), "Group all never adds the display to the Sonos group");

  // Volume follows the tablet's Device volume (number.<display>_volume), not the player's own level.
  await p.goto(url + "#media"); await p.reload(); await p.waitForTimeout(1500);
  let v = await p.evaluate(() => ({ dev: card._volOf("media_player.kitchen_echo_show_8"), sonos: card._volOf("media_player.kitchen") }));
  check(Math.abs(v.dev - 0.4) < 0.001 && Math.abs(v.sonos - 0.35) < 0.001, "local volume reads the device volume (0.40), speakers keep their own (" + JSON.stringify(v) + ")");
  await p.evaluate(() => { calls.length = 0; card._vdrag = { key: "r2", rooms: [card._rooms[2]], pend: { "media_player.kitchen_echo_show_8": 0.65, "media_player.kitchen": 0.5 }, sent: 0 }; card._volFlush(); });
  const vc = await p.evaluate(() => calls.map((c) => c[0] + "." + c[1] + ":" + (c[2].entity_id || "") + ":" + (c[2].value !== undefined ? c[2].value : c[2].volume_level)).join(" "));
  check(/number\.set_value:number\.kitchen_echo_show_8_volume:65/.test(vc) && /media_player\.volume_set:media_player\.kitchen:0\.5/.test(vc) && !/volume_set:media_player\.kitchen_echo_show_8/.test(vc), "slider sets Device volume for the display, player volume for speakers (" + vc + ")");
  await p.evaluate(() => { states["number.kitchen_echo_show_8_volume"] = Object.assign({}, states["number.kitchen_echo_show_8_volume"], { state: "20" }); card.hass = Object.assign({}, card._hass, { states: Object.assign({}, states) }); card._vdrag = null; card._volLocal = {}; });
  await p.waitForTimeout(200);
  check(await p.evaluate(() => Math.abs(card._volOf("media_player.kitchen_echo_show_8") - 0.2) < 0.001), "a button press (device volume 20) shows on the slider");
  await p.evaluate(() => { card.setConfig(Object.assign({}, card._raw, { local_volume: "media" })); card.hass = card._hass; });
  check(await p.evaluate(() => Math.abs(card._volOf("media_player.kitchen_echo_show_8") - 0.35) < 0.001), "local_volume: media uses the player's own level");

  // Playing locally.
  await p.goto(url + "?localplaying#media"); await p.reload(); await p.waitForTimeout(1600);
  txt = await p.evaluate(() => card.shadowRoot.textContent);
  check(/Local Song|Kitchen/.test(txt), "page renders with the display playing");

  // Opt out.
  await p.goto(url + "#media"); await p.reload(); await p.waitForTimeout(800);
  await p.evaluate(() => { card.setConfig(Object.assign({}, card._raw, { local_player: false })); card.hass = card._hass; });
  await p.waitForTimeout(300);
  check((await rooms()).length === 2, "local_player: false removes it");

  check(errs.length === 0, "no page errors" + (errs.length ? ": " + errs[0] : ""));
  await b.close();
  process.exit(fail ? 1 : 0);
})();
