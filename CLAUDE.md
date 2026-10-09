# Notes for working on this repo

Full-screen Home Assistant cards for an Echo Show 8 (1280×800) running the Kiosk Satellite
app. User-facing docs are in README.md, history in CHANGELOG.md.

## Layout
- `src/*.js`: one self-contained IIFE per piece. Plain ES5-ish custom elements (`Reflect.construct`,
  shadow DOM, sizes in `vh`). No dependencies, no frameworks. Has to run on the old Fire OS Chromium WebView.
  - `echo-show-common.js`: `window.EchoShow` (prefs, settings panel `<echo-show-settings>`,
    timer overlay `<echo-timer-overlay>`, themes, display detection). Loaded first. `EchoShow.timers` is the page's one
    list of this display's Kiosk Satellite timers: on the kiosk `window.kioskSatellite.getVoiceTimers()` /
    `controlVoiceTimer()` / event `kiosksatellite:voice-timers`; elsewhere `esphome.<node>_vs_list_timers` (re-read when the
    VS Timers / VS Next timer sensors change, plus a 15 s poll) and the `vs_*` actions. Start is always `vs_start_timer`
    with a unique name (HA finds timers by name). `EchoShow.timerBadges(card)` does the bottom-button badges for every card.
  - `echo-weather-card.js`, `echo-clock-card.js`, `echo-media-card.js`: the three pages. The clock card also registers
    as `echo-timer-card` (old name). Its Alarms tab drives Kiosk Satellite's on-device alarms by firing
    `kiosk_satellite_alarm` and waiting for `kiosk_satellite_alarm_result` (the protocol of KS's alarm blueprint);
    there is no alarm method on `window.kioskSatellite`. `Wheel` in that file is the iOS-style picker.
  - `echo-climate-card.js`: thermostat page (Now/Schedule/Comfort/Insights) + house-mode sheet. Reads
    `sensor.echo_climate_plan` (attribute `plan`) and `sensor.echo_climate_settings`; writes only through
    `script.echo_climate_hold` / `script.echo_climate_set` / `script.echo_house_set`. Uses `window.EchoClockWheel`.
  - `echo-notify.js`: full-screen alerts (NWS, persistent notifications `echo_*`, `echo_notify` events).
- `dist/echo-show-dashboard.js`: built bundle, **committed**. HACS installs it.
- `ks-plugin/`: Echo Volume Buttons, a Kiosk Satellite plugin (Java, SDK 1) for the hardware volume keys. `python3 ks-plugin/tools/test.py`
  runs its tests on a plain JDK; building the ZIP needs Android build-tools, so CI (`ks-plugin.yml`) builds it and commits it to `ks-plugin/dist/`.
- `homeassistant/`: packages, Jinja macros, the `timer_finished` blueprint, example dashboard.
  `packages/echo_kiosk.yaml` + `custom_templates/echo_kiosk.py`: `shell_command.echo_kiosk`, which the settings
  panel's Alarms tab calls (return_response) to read/set the tablet's `alarms.*` settings over its Remote API and to
  upload the synthesized "Echo …" tones. It reads `echo_kiosk_<name>_url/_token` from secrets.yaml.
- `homeassistant/packages/echo_climate.yaml` + `echo_house.yaml` + `custom_templates/echo_climate.jinja`: the climate
  brain. Settings live in trigger-based template sensors updated by events (`echo_climate_set`, `echo_house_set`);
  `echo_climate_plan()` decides the setpoints. Scripts/automations may be pasted into the HA UI, which saves keys
  sorted: never use a key from the same `variables:` block (split into steps), and quote YAML-boolean keys (`off:`).
  `test/climate_plan.py` has scenario tests for the macro.
- `test/`: `index.html` is a fake HA (`#climate[-schedule|-comfort|-insights|-house|-day]`, `?heating`, `?hold`, `?away`, `?rooms`, `?filter`, `?override`, `?mode=heat`) (`#weather`, `#timers`, `#clock-<tab>`, `#media`, `#notify`, `#settings-<tab>`, `?theme=<id>`,
  `?ringing`, `?noalarms`, `?idle` (media idle page), `?radio` (Music Assistant stations)) with a fake kiosk answering alarm requests; `clock.js` screenshots the Clock card's states;
  `alarm-list.js` drives the Clock Alarms tab (volume row, swipe/Edit delete, Undo); `alarms-settings.js` drives the settings Alarms tab (fake `shell_command.echo_kiosk`; `?notones`, `?noshell`);
  `smoke.js` loads every card in Playwright; `volume-hud.js` checks the volume level bar; `timers-ks.js` checks the Kiosk Satellite timers against the fake kiosk
  (`?notimers`, `?tdone`, `?many`, `?dupe`, `?oldks`, `?node=<name>`, `?kiosk` = fake `window.kioskSatellite`); `validate_ha.py` checks the YAML/Jinja.

## Workflow
1. Edit `src/`, bump that file's `VERSION` (and `package.json` for a release), add to CHANGELOG.
2. `node build.js` (CI runs `node build.js --check`, so always commit the rebuilt dist).
3. `NODE_PATH=$(npm root -g) node test/smoke.js`, `node test/climate.js`, `python3 test/validate_ha.py` and `python3 test/climate_plan.py`.
4. Screenshot changed views with Playwright at 1280×800 and look at them.
5. Commit, push to main. HACS installs the latest commit; GitHub releases (any tag) attach dist.

## Conventions
- Display controls come from Kiosk Satellite entities `<domain>.<device>_<suffix>` (e.g. `switch.<dev>_mute`,
  `switch.<dev>_camera_enabled`, `light.<dev>_screen`). Resolved by `devEnt()`, which also accepts a doubled area prefix.
  Only show controls whose entities exist.
- Per-display overrides: card `devices: [{match: <substring of Kiosk Satellite name>, ...}]`; dashboard
  top-level `echo_show: {device, devices}`. `?echo_display=<name>` fakes a display in a browser.
- Per-display prefs: localStorage `echo-show-prefs` via `EchoShow.prefs`. Changes fire window event
  `echo-show-prefs` (`detail.key`); cards listen in connectedCallback and remove in disconnectedCallback.
- Colours are CSS variables `--es-*` with the Midnight value as the `var()` fallback. Themes (`THEMES` in common)
  set them on `<html>`. Use the variables for new accent/panel colours. In SVG use `style=` (attributes can't take var()).
- HA caches views: cards get disconnected and reconnected with stale state. Reset per-visit state on
  disconnect (see `badgeDetach` in common) and never act on the first update after reconnecting.
- Never commit personal details (IPs, domains, tokens, real entity ids). Example config uses placeholders marked `# <-- yours`.
