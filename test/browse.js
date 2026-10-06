// Browse screen: Radio (with the SomaFM menu), Local library and Spotify, no Sonos favorites; quick row of radio stations.
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
  check(tabs.join("|") === "Radio|Local library|Spotify", "tabs: " + tabs.join("|"));
  check(await p.evaluate(() => card._br.tab === "radio" && /KRVM-FM/.test(card._gridEl.textContent)), "opens on Radio with the stations");
  await p.waitForTimeout(700);
  let tl = (await txt(".tile .tt")).join("|");
  check(tl === "SomaFM|KRVM-FM 1|KWVA 2", "SomaFM tile (found by search) goes first: " + tl);
  check(await p.evaluate(() => (card._brEl.querySelector(".tile img") || {}).getAttribute("src") === "/local/resources/radio-logos/SomaFM-logo.png"), "SomaFM tile uses the logo");
  await p.screenshot({ path: out("browse-radio") });
  await p.evaluate(() => card._brEl.querySelector(".tile").click());
  await p.waitForTimeout(500);
  tl = (await txt(".tile .tt")).join("|");
  check(tl === "Beat Blender|DEF CON Radio|Drone Zone|Groove Salad|Indie Pop Rocks!|Lush|Secret Agent|Space Station Soma", "SomaFM menu lists its stations A-Z without the prefix: " + tl);
  check(/SomaFM/.test(await p.evaluate(() => card._ovfEl.textContent)) && !(await p.evaluate(() => card._ovfEl.querySelector("input"))), "SomaFM header, no search box");
  await p.screenshot({ path: out("browse-somafm") });
  await p.evaluate(() => { calls.length = 0; card._brEl.querySelectorAll(".tile")[3].click(); });
  let pm = await p.evaluate(() => calls.filter((c) => c[1] === "play_media").map((c) => c[2].media_type + ":" + c[2].media_id).join());
  check(pm === "radio:somafm://radio/groovesalad", "tapping a SomaFM station plays it (" + pm + ")");
  await p.evaluate(() => card._openBrowse());
  await p.waitForTimeout(300);
  await p.evaluate(() => card._brEl.querySelector('[data-act="view-back"]').click());
  await p.waitForTimeout(300);
  check((await txt(".tile .tt")).join("|") === "SomaFM|KRVM-FM 1|KWVA 2", "back returns to the Radio list");

  await p.evaluate(() => card._brEl.querySelector('.tab[data-t="lib"]').click());
  await p.waitForTimeout(500);
  check((await txt(".fc:not(.sort)")).join("|") === "Playlists|Artists|Albums|Tracks|Podcasts", "library chips: " + (await txt(".fc:not(.sort)")).join("|"));
  await p.screenshot({ path: out("browse-library") });

  await p.evaluate(() => card._brEl.querySelector('.tab[data-t="spot"]').click());
  await p.waitForTimeout(600);
  const chips = (await txt(".fc")).join("|");
  check(chips === "Playlists|Albums|Artists|Liked songs|Recently played", "spotify chips: " + chips);
  let g = await p.evaluate(() => card._gridEl.textContent);
  check(/Road Trip/.test(g) && /Chill/.test(g) && !/Local Mix/.test(g), "spotify playlists only (local one left out)");
  await p.screenshot({ path: out("browse-spotify") });
  for (const [t, yes, no] of [["album", "Legend", "Rumours"], ["artist", "Ween", "311"], ["liked", "Liked Song 1", "A Song"]]) {
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
  check(/album:last_played_desc/.test(lc), "library calls: " + lc);
  check(await p.evaluate(() => calls.some((c) => c[0] === "browse" && c[1] === "playlist" && c[2] === "library://playlist/7")), "liked songs: browses the Liked Songs playlist");

  // Playing a station goes through Music Assistant.
  await p.evaluate(() => { card._brEl.querySelector('.tab[data-t="radio"]').click(); });
  await p.waitForTimeout(500);
  await p.evaluate(() => { calls.length = 0; card._brEl.querySelectorAll('.tile')[1].click(); });
  pm = await p.evaluate(() => calls.filter((c) => c[1] === "play_media").map((c) => c[0] + ":" + c[2].media_type + ":" + c[2].media_id).join());
  check(/music_assistant:radio:library:\/\/radio\/KRVM-FM1/.test(pm), "tapping a station plays it via Music Assistant (" + pm + ")");
  const fx = await p.evaluate(() => { const f = customElements.get("echo-media-card")._fixImg, L = { protocol: "https:", origin: "https://ha.example.com" };
    return [f("http://192.168.1.211:8123/local/resources/radio-logos/KLCC-logo.png", L), f("http://192.168.1.211:8123/local/a.png", { protocol: "http:", origin: "http://x" }), f("https://i.scdn.co/x", L), f("http://example.com/logo.png", L), f("", L)]; });
  check(fx[0] === "https://ha.example.com/local/resources/radio-logos/KLCC-logo.png" && fx[1] === "http://192.168.1.211:8123/local/a.png" && fx[2] === "https://i.scdn.co/x" && fx[3] === "http://example.com/logo.png" && fx[4] === "", "http logos on an https dashboard use the page's own origin (" + fx[0] + ")");
  // Radio from Music Assistant: the station logo from the library goes after MA's own picture,
  // and a picture that doesn't load moves on to it.
  await p.evaluate(() => card._withLogo({ attributes: { media_content_id: "library://radio/KRVM-FM1" } }, []));
  await p.waitForTimeout(300);
  const logo = await p.evaluate(() => card._withLogo({ attributes: { media_content_id: "library://radio/KRVM-FM1" } }, ["https://ma/imageproxy/1"]).join("|"));
  check(logo === "https://ma/imageproxy/1|http://r/x.png", "radio art falls back to the station logo (" + logo + ")");
  const px = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  await p.evaluate((px) => { card._artKey = null; card._wantArt(["http://10.255.255.1/stalls.png", px]); }, px);
  await p.waitForTimeout(5500);
  check(await p.evaluate((px) => card._artUrl === px && !card._npEl.classList.contains("noart"), px), "a picture that stalls or fails is skipped for the next one");
  // SomaFM stations in the library: the tile holds those, with no search.
  await p.goto(url + "?somalib#media"); await p.waitForTimeout(800);
  await p.evaluate(() => { card.setConfig(Object.assign({}, card._raw, { ma_config_entry: "abc", players: [{ name: "Kitchen", entity: "media_player.kitchen", ma_entity: "media_player.kitchen_ma" }] })); card.hass = card._hass; calls.length = 0; card._openBrowse(); });
  await p.waitForTimeout(600);
  tl = (await txt(".tile .tt")).join("|");
  check(tl === "SomaFM|KRVM-FM 1|KWVA 2" && /2 stations/.test(await p.evaluate(() => card._gridEl.textContent)), "library SomaFM stations fold into the tile: " + tl);
  await p.evaluate(() => card._brEl.querySelector(".tile").click());
  await p.waitForTimeout(300);
  tl = (await txt(".tile .tt")).join("|");
  check(tl === "Drone Zone|Groove Salad" && !(await p.evaluate(() => calls.some((c) => c[0] === "search"))), "menu shows the library's SomaFM stations: " + tl);
  await p.evaluate(() => card._brEl.querySelector('[data-act="view-back"]').click());
  await p.evaluate(() => { const i = card._ovfEl.querySelector("input"); i.value = "soma"; i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" })); });
  await p.waitForTimeout(400);
  tl = (await txt(".tile .tt")).join("|");
  check(tl === "SomaFM: Drone Zone|SomaFM: Groove Salad", "radio search finds stations by name: " + tl);
  check(errs.length === 0, "no page errors" + (errs.length ? ": " + errs[0] : ""));
  await b.close();
  process.exit(fail ? 1 : 0);
})();
