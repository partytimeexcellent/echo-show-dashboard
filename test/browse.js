// Browse screen: Local library (Radio first) and Spotify, no Sonos favorites; quick row of radio stations.
//   NODE_PATH=$(npm root -g) node test/browse.js
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
  const txt = (sel) => p.evaluate((s) => Array.from(card._brEl.querySelectorAll(s)).map((e) => e.textContent.trim()), sel);

  await p.goto(url + "#media"); await p.reload(); await p.waitForTimeout(1200);
  await p.evaluate(() => { card.setConfig(Object.assign({}, card._raw, { ma_config_entry: "abc", quick_favorites: 8, players: [{ name: "Kitchen", entity: "media_player.kitchen", ma_entity: "media_player.kitchen_ma" }, { name: "Living Room", entity: "media_player.living_room", ma_entity: "media_player.living_room_ma" }] })); card.hass = card._hass; card._manual = true; card._sel = 1; card._paint(); });
  await p.waitForTimeout(500);
  // quick row on the idle page (Living Room is idle)
  const qf = await p.evaluate(() => card.shadowRoot.querySelector(".qf").textContent);
  check(/Radio/.test(qf) && /KRVM-FM/.test(qf) && /KWVA/.test(qf) && !/Sonos/.test(qf), "idle page shows library radio stations, not Sonos favorites");
  await p.screenshot({ path: out("browse-idle-radio") });

  await p.evaluate(() => card._openBrowse());
  await p.waitForTimeout(500);
  const tabs = (await txt(".tab")).map((t) => t.replace(/^[A-Z]{1,2}(?=[A-Z][a-z])/, ""));
  check(tabs.join("|") === "Local library|Spotify", "tabs: " + tabs.join("|"));
  check((await txt(".fc:not(.sort)")).join("|") === "Radio|Playlists|Artists|Albums|Tracks|Podcasts", "library chips: " + (await txt(".fc:not(.sort)")).join("|"));
  check(await p.evaluate(() => card._br.ltype === "radio" && /KRVM-FM/.test(card._gridEl.textContent)), "opens on Radio with the stations");
  await p.screenshot({ path: out("browse-library-radio") });

  await p.evaluate(() => card._brEl.querySelector('.tab[data-t="spot"]').click());
  await p.waitForTimeout(600);
  const chips = (await txt(".fc")).join("|");
  check(chips === "Playlists|Albums|Artists|Liked songs|Recently played", "spotify chips: " + chips);
  let g = await p.evaluate(() => card._gridEl.textContent);
  check(/Road Trip/.test(g) && /Chill/.test(g) && !/Local Mix/.test(g), "spotify playlists only (local one left out)");
  await p.screenshot({ path: out("browse-spotify") });
  for (const [t, yes, no] of [["album", "Legend", "Rumours"], ["artist", "Ween", "311"], ["liked", "Liked Song", "A Song"]]) {
    await p.evaluate((t) => card._brEl.querySelector('.fc[data-t="' + t + '"]').click(), t);
    await p.waitForTimeout(500);
    g = await p.evaluate(() => card._gridEl.textContent);
    check(g.indexOf(yes) !== -1 && g.indexOf(no) === -1, t + ": has " + yes + ", not " + no);
  }
  await p.evaluate(() => card._brEl.querySelector('.fc[data-t="recent"]').click());
  await p.waitForTimeout(500);
  g = await p.evaluate(() => card._gridEl.textContent);
  check(/Albums/.test(g) && /Playlists/.test(g) && /Legend/.test(g), "recently played has albums and playlists");
  const lc = await p.evaluate(() => calls.filter((c) => c[0] === "lib").map((c) => c[1] + (c[2] ? ":fav" : "") + ":" + c[3]).join(","));
  check(/track:fav/.test(lc) && /album:last_played_desc/.test(lc), "library calls: " + lc);

  // Playing a station goes through Music Assistant.
  await p.evaluate(() => { card._brEl.querySelector('.tab[data-t="lib"]').click(); });
  await p.waitForTimeout(500);
  await p.evaluate(() => { calls.length = 0; card._brEl.querySelector('.tile').click(); });
  const pm = await p.evaluate(() => calls.filter((c) => c[1] === "play_media").map((c) => c[0] + ":" + c[2].media_type + ":" + c[2].media_id).join());
  check(/music_assistant:radio:library:\/\/radio\/KRVM-FM1/.test(pm), "tapping a station plays it via Music Assistant (" + pm + ")");
  check(errs.length === 0, "no page errors" + (errs.length ? ": " + errs[0] : ""));
  await b.close();
  process.exit(fail ? 1 : 0);
})();
