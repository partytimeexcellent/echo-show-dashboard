# Echo Show Dashboard

Full-screen Home Assistant dashboard cards for an **Echo Show 8** (or any 1280×800 wall tablet) running as a kiosk, for example with the Kiosk Satellite app. Five pages, one file:

![Weather page](https://raw.githubusercontent.com/partytimeexcellent/echo-show-dashboard/main/docs/weather.png)

| | |
|---|---|
| ![Clock page, Alarms tab](https://raw.githubusercontent.com/partytimeexcellent/echo-show-dashboard/main/docs/clock.png) | ![Media page](https://raw.githubusercontent.com/partytimeexcellent/echo-show-dashboard/main/docs/media.png) |
| ![Climate page](https://raw.githubusercontent.com/partytimeexcellent/echo-show-dashboard/main/docs/climate.png) | ![Settings panel](https://raw.githubusercontent.com/partytimeexcellent/echo-show-dashboard/main/docs/settings.png) |

| | What it does |
|---|---|
| **Weather** (`echo-weather-card`) | Big current conditions, sunrise/sunset, AQI and moon, a 7-day chart and a 48-hour chart. Tap the source name to switch between several weather sources. |
| **Clock** (`echo-clock-card`) | Laid out like the iOS Clock app, with three tabs. **Alarms**: the Kiosk Satellite app's own alarms, set on rolling hour/minute wheels with repeat days and a label; they ring from the tablet even when Home Assistant or Wi-Fi is down. **Stopwatch**: laps with the best and worst marked. **Timers**: the display's own Kiosk Satellite timers, the same ones you set by voice, picked on hour/minute/second wheels with an optional name, with countdown rings, pause/resume and drag-to-adjust. |
| **Media** (`echo-media-card`) | Sonos "now playing" with album art, transport, shuffle/repeat, grouping with per-speaker volume, and radio (with SomaFM's stations in their own menu), your Music Assistant library and Spotify (artist → albums → songs). Optional live queue straight from Music Assistant. |
| **Climate** (`echo-climate-card`) | A smart thermostat run by Home Assistant. A dial with draggable heat and cool setpoints, comfort profiles (Home, Wake, Sleep, Away, Vacation), a weekly schedule you edit on the screen, holds like a real thermostat (until the next change, 2 or 4 hours, permanent, Resume), Away from who's home, room sensors per profile, smart recovery that learns how fast the house warms up, run-time charts, a filter reminder and voice commands. Comes with a reusable **house mode** (home / night / away / vacation) with a manual override. |
| **Alerts** (`echo-notify`) | Full-screen, must-dismiss alerts over every page: National Weather Service warnings, Home Assistant notifications, or your own automations. |
| **Settings** (`echo-show-common`) | The gear button on every page opens one settings panel: microphone, camera, brightness, volume, screensaver and wake word for the display (from the Kiosk Satellite app), plus weather, timer, media and alert options and a screen-cleaning mode. While a timer runs, a large countdown floats over the other pages. |

Every page shares the same bottom row of buttons, so the dashboard feels like one app. Pages go back to the weather view after a few idle minutes, but never while music is playing or a timer is running. Nothing ever plays audio through the tablet's media player, so the voice assistant (and its volume ducking) keeps working normally.

The cards are plain JavaScript with no dependencies, written for the older Chromium WebView on Fire tablets and Echo Shows.

---

## Install

### 1. The cards (HACS)

1. HACS → ⋮ → **Custom repositories** → add `https://github.com/partytimeexcellent/echo-show-dashboard`, type **Dashboard**.
2. Search for **Echo Show Dashboard** in HACS and download it.
3. Reload the browser. HACS registers the resource `/hacsfiles/echo-show-dashboard/echo-show-dashboard.js` for you.

<details><summary>Manual install instead of HACS</summary>

Copy `dist/echo-show-dashboard.js` to `<config>/www/echo-show-dashboard/`, then add it under Settings → Dashboards → ⋮ → Resources as `/local/echo-show-dashboard/echo-show-dashboard.js`, type **JavaScript module**.
</details>

> **Upgrading from the separate card files?** Remove the old `echo-weather-card.js`, `echo-timer-card.js`, `echo-media-card.js` and `echo-notify.js` resources, so only one copy of each card loads.

### 2. Timers (Kiosk Satellite 2026.10.14 or later)

Timers are each display's own Kiosk Satellite timers: the ones you ask for by voice ("set a 10 minute pasta timer", Home Assistant's built-in timer commands), the timer pills on the screen and the Clock page's Timers tab are one list. Kiosk Satellite rings them with its timer chime. On each display:

1. Update Kiosk Satellite to 2026.10.14 or later.
2. Run Voice Satellite natively, and turn on Settings › ESPHome › **Expose kiosk entities** (for its VS Timers / VS Next timer sensors).

Home Assistant then has the display's `esphome.<node>_vs_list_timers`, `_vs_start_timer`, `_vs_pause_timer`, … actions, which the dashboard uses away from the display (a desktop browser, the HA app). On the display itself it talks to Kiosk Satellite directly. Every timer started from the dashboard gets a name no other timer on that display has ("Pasta", "10 min", "10 min 2"): Home Assistant finds a timer by its name, or by its length when it has none, and can't change one of two timers that look the same.

Optional, for the alarm volume and the "Timer finished" automation below: copy [`homeassistant/packages/echo_show.yaml`](homeassistant/packages/echo_show.yaml) to `<config>/packages/` (add `homeassistant: packages: !include_dir_named packages` to `configuration.yaml` if you don't use packages yet) and restart Home Assistant.

> **Upgrading from 1.15 or earlier?** The timer helpers (`timer.echo_timer_1..3`, `timer.<display>_timer_1..3`, their `input_text.*_name` helpers, `input_select.echo_timer_alarm_tone`), the `echo_timer_start` / `echo_timer_cancel` scripts, `custom_templates/echo_timers.jinja` and automations made from the old Timer alarm and Timer voice commands blueprints are no longer used. Delete them once the new timers work: the old voice automation takes timer sentences before Home Assistant's own timer commands can.

### 3. Climate and house mode (optional)

Needed for the climate page. Works with any `climate.*` thermostat that has heat and/or cool setpoints.

1. Copy [`packages/echo_house.yaml`](homeassistant/packages/echo_house.yaml) and [`packages/echo_climate.yaml`](homeassistant/packages/echo_climate.yaml) to `<config>/packages/`, and [`custom_templates/echo_climate.jinja`](homeassistant/custom_templates/echo_climate.jinja) to `<config>/custom_templates/`.
2. In `echo_climate.yaml`, replace every `climate.thermostat` with your thermostat, and list your room temperature sensors under `rooms:` (or remove the examples).
3. Restart Home Assistant.
4. **Turn off the thermostat's own schedule and "smart recovery"**, or it will fight Home Assistant. On a Honeywell T6 Pro Z-Wave: enable the disabled *Schedule Type* and *Adaptive Intelligent Recovery* entities on the device page and set them to *No schedule on thermostat* and *Disable*.
5. Open the Comfort tab and set each profile's temperatures before the first schedule change.

If Home Assistant is down, the thermostat simply keeps its last setpoints.

**How it works.** `sensor.echo_climate_settings` stores everything (profiles, week, hold, options, learned rates, filter hours) and is only changed through `script.echo_climate_set` and `script.echo_climate_hold`. `sensor.echo_climate_plan` (the `echo_climate.jinja` macro) works out every minute what the thermostat should be doing and why: off, vacation, a permanent hold, away, a temporary hold, smart recovery or the schedule, in that order. The *follow the plan* automation sends the setpoints when they change. A setpoint changed anywhere else (the wall unit, the HA app, Assist) becomes a hold until the next schedule change, so nothing you set is silently undone.

| Voice (Assist) | |
|---|---|
| "make it warmer / cooler [by 2 degrees]", "I'm cold" | Holds a degree (or N) warmer or cooler until the next change |
| "hold the temperature at 70 for 2 hours", "hold the thermostat permanently" | Timed or permanent hold |
| "resume the schedule", "cancel the hold" | Back to the schedule |
| "what's the thermostat doing?" | Temperature, setpoints and what's next |
| "I'm leaving" / "we're home" / "house mode auto" | House override (Away until someone gets home, Home until everyone leaves, back to automatic) |
| "start / end vacation mode" | Vacation |

**House mode as a framework.** `sensor.echo_house_mode` (home / night / away / vacation) is meant to be the one presence signal for the whole house: follow it (or the `echo_house_mode_changed` event) from lights, notifications or a future alarm panel instead of writing presence logic again. When presence detection gets it wrong, override it from the house button on the climate page or by voice; Away can end by itself when someone arrives. `echo_house.yaml` has a commented example that arms a Manual alarm panel from it.

### 4. Automations (blueprints, optional)

| Blueprint | |
|---|---|
| [**Timer finished**](homeassistant/blueprints/automation/echo_show/timer_finished.yaml) | When a Kiosk Satellite timer finishes: wake that display's screen, open its timers page and turn its assistant volume up to the alarm level until the alert is dismissed. One automation covers every display. |

Import each one with Settings → Automations → Blueprints → **Import blueprint**, using the file's GitHub URL, then create an automation from it.

### 5. The dashboard

1. Settings → Dashboards → **Add dashboard** → *New dashboard from scratch*, URL **`echo-show`**.
2. Open it → ⋮ → Edit → ⋮ → **Raw configuration editor**, and paste [`homeassistant/dashboards/echo-show.yaml`](homeassistant/dashboards/echo-show.yaml).
3. Replace every line marked `# <-- yours` with your own entities.
4. Point the tablet's kiosk app at `/echo-show/weather`.

### 6. Volume buttons (optional)

The [Echo Volume Buttons](ks-plugin/README.md) Kiosk Satellite plugin takes over the hardware volume buttons: device volume normally, the assistant's volume while it's answering, faster while held. The dashboard shows the new level at the top of the screen whenever a display's volume changes (Settings → Display turns that off). To keep a display's Media volume at its Device volume, turn on Settings → General → **Media follows Device volume**. Install the plugin on each display from [`ks-plugin/dist/`](ks-plugin/dist/) and turn on Kiosk → **Disable volume buttons**; see its README.

---

## Several Echo Shows

One dashboard serves every display, and a new display works on its own with nothing to configure. Each display finds everything from its Kiosk Satellite name ("Kitchen Echo Show 5" → `kitchen_echo_show_5`):

- **Device controls** in the settings panel: its own `switch.kitchen_echo_show_5_*`, `number.*`, … entities.
- **Timers**: its own Kiosk Satellite timers, through `esphome.<node>_vs_*`. The ESPHome node is found from the name too (the same name, else the one sharing the most words, so `ks_samsung_s20` goes with "Samsung S20 Kiosk"); set `node:` under `echo_show: devices:` when it isn't.
- **Voice**: a timer set by voice belongs to the display that heard it, and the Timer finished automation wakes that display.
- **Media**: starts on the speaker in the display's Home Assistant area (when exactly one of the card's `players` is in that area), until a room is picked in the settings panel.
- **Alerts**: everywhere, unless sent to one display (see echo-notify).

Each card also takes a `devices:` list of overrides for when the defaults aren't right, matched against the Kiosk Satellite device name (case-insensitive, part of the name is enough):

```yaml
devices:
  - match: office            # applies on a display whose name contains "office"
    default_player: media_player.office_sonos
```

The dashboard's top-level `echo_show:` takes the same list for the display itself: `device:` (its entity prefix) and `node:` (its ESPHome node, for the timer actions).

Testing in a desktop browser? Add `?echo_display=office` to the URL to pretend to be that display (remembered until you set another).

---

## Card options

All cards also accept `buttons` (the bottom row), `devices` (per-display overrides), `block_swipe` (default `true`: stops the kiosk's swipe-between-views gesture inside the card) and `tap_sound`.

**Buttons:** each entry takes `icon`, and one of `navigation_path`, `url` or `action: settings` (opens the settings panel). Add `active: true` on the current page's button. A button with `timers: true` shows this display's soonest timer next to its icon (or "Done" while one rings), and `open_on_done` / `open_on_start: true` jump to its page when a timer finishes or starts. (A list of timer entities, from before 1.16, works the same as `true`.)

### Settings panel and this display

The gear button (`action: settings`) works the same on every page. Its **General** and **Display** tabs control the tablet through the entities the [Kiosk Satellite](https://github.com/jxlarrea/kiosk-satellite) app creates in Home Assistant (`switch.<display>_mute`, `switch.<display>_camera_enabled`, `light.<display>_screen`, `number.<display>_volume`, …); only the controls a display actually has are shown. The display is found from its Kiosk Satellite name (e.g. "Kitchen Echo Show 8" → `kitchen_echo_show_8`). If that doesn't match, set it at the top level of the dashboard's raw config. `device` is only used by displays whose name finds no entities and that no `devices` entry matches:

```yaml
echo_show:
  device: kitchen_echo_show_8        # entity prefix of this display
  devices:                           # other displays, matched on their name
    - match: office
      device: office_echo_show_8
```

Choices made in the Look, Weather, Media and Alerts tabs (theme, weather source, this display's room, chime, timer countdown position) are stored on that display only, so each Echo Show can have its own theme.

**Camera:** the Camera switch is Kiosk Satellite's own camera setting; with it off the app doesn't use the camera at all, so motion and face wake for the screensaver stop too. The Video stream switch (only shown if your Kiosk Satellite version has it) controls the RTSP stream on its own. The Echo Show 8 also has a physical camera shutter on top.

**Themes:** the Look tab offers Midnight, Black, Ocean, Forest, Aurora, Ember, Graphite, Night red and Terminal, plus an optional different theme after sunset (uses `sun.sun`).

### echo-weather-card

| Option | Default | |
|---|---|---|
| `sources` | **required** | List of `{entity: weather.x, name}`, or `{name, temperature: sensor.x, humidity: sensor.y}`. At least one must be a `weather.*` entity. |
| `sunrise` / `sunset` | | Timestamp sensors, e.g. `sensor.sun_next_rising`. |
| `aqi` / `moon` | | Optional air quality index and moon phase sensors. |
| `daily_days` | `7` | Days in the daily chart. |
| `hourly_hours` / `hourly_group` | `48` / `2` | Hours in the hourly chart, and how many hours each column covers. |
| `animations` | `true` | Animated weather icons. |
| `storage_key` | `default` | Remembers the chosen source per browser under this key. |

### echo-clock-card

The old name `custom:echo-timer-card` still works and gives the same card.

| Option | Default | |
|---|---|---|
| `tabs` | `[alarms, stopwatch, timers]` | Which tabs to show, in this order. |
| `default_tab` | | Tab for a display's first visit. After that it opens on the tab last used there, or on Timers when a timer is ringing or has just started. |
| `alarms` | `true` | The Alarms tab (needs the Kiosk Satellite app). |
| `kiosk` | this display's name | The Kiosk Satellite device name to manage alarms on. Set it (per display, under `devices`) to manage another kiosk or when the name isn't detected. |
| `alarm_script` | | A script made from Kiosk Satellite's alarms blueprint. Only needed when the display's Home Assistant user isn't an administrator. |
| `time_format` | HA profile | `12` or `24` for the alarm wheels and list. |
| `presets` | `[1, 3, 5, 10, 15, 20, 30, 60]` | Quick picks (minutes) shown until this display has Recents. A named one, `{name: Pasta, minutes: 10}`, always shows and names the timer. |
| `idle_path` / `idle_timeout` | / `180` | Go to this path after this many idle seconds when no timer or stopwatch is running. |

#### Alarms

Alarms belong to the [Kiosk Satellite](https://kiosksatellite.com/docs/alarms/) app, not to Home Assistant. Each one is stored on the tablet as an Android alarm clock, so it wakes the screen and rings on the alarm stream (a muted media volume doesn't silence it) with no Home Assistant, network or dashboard involved. It rings on Kiosk Satellite's own full-screen view (or its Clock screensaver), with Snooze and Stop, and "stop" by voice works too. Tone, alarm volume, snooze length, sunrise and ease-in are set in Kiosk Satellite under **Settings › Alarms** and apply to every alarm.

The card lists, adds, edits, switches and deletes them by sending the same request Kiosk Satellite's alarm script sends (the `kiosk_satellite_alarm` event naming this display), which the tablet answers over its own Home Assistant connection. So **changing** alarms needs Home Assistant; **ringing** never does. While Home Assistant is unreachable the card shows the last list it saw. Changes made by voice, on the tablet or in Kiosk Satellite's remote admin show up straight away.

Requirements:

- Kiosk Satellite with its **Home Assistant** address and a long-lived token from an **administrator** user (Settings › Home Assistant). Kiosk Satellite only listens for alarm requests with an admin token.
- The dashboard's Home Assistant user is an administrator, or set `alarm_script` to a script made from [Kiosk Satellite's alarms blueprint](https://github.com/jxlarrea/kiosk-satellite/blob/main/blueprints/script/kiosk_satellite_alarms.yaml) (it's also what lets an LLM voice assistant set alarms).
- While an alarm rings, the Alarms tab shows Snooze and Stop, using the display's `Stop alarm` / `Snooze alarm` buttons.

#### Alarm settings and tones (optional)

The settings panel's **Alarms** tab sets the tablet's own Kiosk Satellite alarm settings: alarm volume, tone, snooze length, how long an alarm rings, ease-in, sunrise length and the spoken phrase. It can also add 11 alarm tones made for this dashboard to the tablet. Home Assistant does this through a small script, because a dashboard page can't call the tablet's Remote API itself. One-time setup:

1. Copy [`homeassistant/custom_templates/echo_kiosk.py`](homeassistant/custom_templates/echo_kiosk.py) to `<config>/custom_templates/` and [`homeassistant/packages/echo_kiosk.yaml`](homeassistant/packages/echo_kiosk.yaml) to `<config>/packages/`.
2. In each tablet's Kiosk Satellite, **Settings › Remote Administration**: turn on Remote management and set an admin password.
3. Get a long-lived token for each tablet from any computer on your network (there's no button for it in the app):
   ```sh
   curl -X POST http://<tablet-ip>:2324/api/login -H 'Content-Type: application/json' \
     -d '{"password": "<admin password>", "ttl_days": 3650}'
   ```
4. Add a pair per tablet to `secrets.yaml`. `<name>` is part of the tablet's Kiosk Satellite device name that no other tablet's name contains. The full name is safest: `kitchen_echo_show_8` for "Kitchen Echo Show 8" (plain `kitchen` would also match a "Kitchen Echo Show 5"). The script checks the tablet's own name and skips a pair that belongs to another tablet:
   ```yaml
   echo_kiosk_<name>_url: http://<tablet-ip>:2324
   echo_kiosk_<name>_token: <the token>
   ```
5. Restart Home Assistant.

#### Microphone

The **Microphone** tile on the settings panel's General tab sets Kiosk Satellite's own **Mute microphone**, which stops the wake word and closes the microphone. It uses the display's **VS Mute** switch (`switch.<device>_vs_mute`), so it works on any display with **Expose kiosk entities** turned on under **Settings › ESPHome** in Kiosk Satellite, with no other setup. On a display without that switch, the alarm-settings helper above sets `voice.mute` over the Remote API instead, and without either the tile falls back to the older `switch.<device>_mute`.

The token stays in `secrets.yaml`; the script never prints it, and only `alarms.*` settings and `voice.mute` can be changed through it.

To delete an alarm, swipe its row to the left and tap **Delete**, or tap **Edit** and then the ✕ on a row; **Undo** brings it back for a few seconds. With the alarm-settings helper installed, the Alarms tab also has an alarm volume slider that plays the tone once when you let go.

Kiosk Satellite has no "edit" request, so editing an alarm deletes it and sets the new one. Alarms are matched by time and label, so two alarms at the same time need different labels to be edited here.

**Timers**: the Timers tab shows any number of timers (from four on, as a grid). Tap a ring or ± to add or take away time, ✕ to cancel. A ringing timer shows **Stop** (silences the alert, like saying "stop") and **+1 min** (starts it again for a minute). With three or more timers, + gives the new-timer wheels the whole page. The optional name field names the timer; a named preset's chip does too.

### echo-media-card

| Option | Default | |
|---|---|---|
| `players` | **required** | List of `{name, entity, ma_entity, icon}`. `entity` is the Sonos player, `ma_entity` its Music Assistant player. |
| `default_player` | the player in this display's area, else the first | The room this display controls. A display uses the one player in its own Home Assistant area before this; a `default_player` under `devices` or a room picked in the settings panel wins over both. When it's quiet and another room is playing, the card shows that room. Set `follow_playing: false` to stop that. |
| `local_player` / `local_name` | `true` / | Also offers this display's own player (`media_player.<display>`, the Music Assistant player Kiosk Satellite registers) as a room, so music can play on the Echo Show itself. Only the display the page is open on is listed, never the other Echo Shows, and it is never grouped with the Sonos speakers: its row has no group button, and Group all / Ungroup all leave it out. It is also a choice under Settings › Media. `local_player: false` turns it off. |
| `local_volume` | `device` | What the volume slider does for the display's own player. `device` moves the tablet's **Device volume** (`number.<display>_volume`), the one its volume buttons change, so the slider and the buttons stay in step. `media` uses the player's own level (Kiosk Satellite's separate **Media volume**). Each display can override it in Settings › Media. |
| `ma_config_entry` | | Music Assistant config entry id, needed for the library and Spotify tabs. |
| `ma_url` / `ma_token` | | Optional live queue straight from the Music Assistant server (one URL or a list to try in order; a long-lived token from MA → Settings → Users → Manage access tokens). Anyone who can open the dashboard can read the token, so use a non-admin MA user. |
| `somafm` | `true` | Folds SomaFM stations into one "SomaFM" tile at the front of Browse → Radio, which opens a menu of all of them. It holds the SomaFM stations in the Music Assistant library or, when there are none, every station of the SomaFM provider. `false` lists them with the other stations. |
| `somafm_logo` | `/local/resources/radio-logos/SomaFM-logo.png` | Picture on the SomaFM tile. |
| `quick_favorites` | `8` | Radio stations from the Music Assistant library shown on the "nothing playing" page (`0` hides them; needs `ma_config_entry`). |
| `idle_path` / `idle_timeout` | / `180` | Where to go when nothing is playing. `stay_while: any` keeps the page open while *any* room plays. |
| `spotify_prefix` | `spotify` | Music Assistant provider prefix used to tell Spotify results apart. |
| `page_size` | `60` | Library items loaded per page. |

Without `ma_url`/`ma_token`, the queue shows the album or playlist last started from any screen; for that, add one `input_text.echo_media_src_<room>` helper per room (max 255), see the package file.

### echo-climate-card

| Option | Default | |
|---|---|---|
| `entity` | **required** | Your `climate.*` thermostat. |
| `outdoor` | | A `weather.*` or temperature sensor shown next to the rooms. |
| `plan` / `settings` | `sensor.echo_climate_plan` / `sensor.echo_climate_settings` | From the climate package. Without the package the card still works as a plain thermostat (dial, mode, fan). |
| `house` / `house_settings` | `sensor.echo_house_mode` / `sensor.echo_house_settings` | From the house package; the house button shows only when they exist. |
| `hold_script` / `set_script` / `house_script` | `echo_climate_hold` / `echo_climate_set` / `echo_house_set` | Script names (without `script.`). |
| `tabs` | `[now, schedule, comfort, insights]` | Which tabs to show. |
| `buttons`, `devices`, `idle_path`, `idle_timeout` | | Same as the other cards; a button with `timers: true` shows the countdown here too. |

**Now**: drag the orange (heat) or blue (cool) knob, or tap a setpoint chip and use − / +; the change is sent after a short pause as a hold of the default length. *Hold* changes how long the current setting holds; *Comfort* switches to a profile until the next change; *Resume* goes back to the schedule. The room tiles show which sensors the current profile steers by (a target icon), and an offline sensor says to check its battery.
**Schedule**: tap a day to edit it: each row is "at this time, switch to this profile"; times on wheels; copy the day to others.
**Comfort**: each profile's heat/cool temperatures and the rooms it cares about (averaged; offline ones are skipped), smart recovery, room comfort, auto away and the default hold length.
**Insights**: the last 24 hours (temperature, rooms, setpoints, heating/cooling), run time for the week, the learned warm-up and cool-down rates and the filter hours (tap *Changed it* after a new filter).

### echo-notify

Not a card: it activates on any dashboard whose raw config has a top-level `echo_notify:` block (see the example dashboard) and stays idle everywhere else.

| Source | |
|---|---|
| `nws` | National Weather Service alerts for your HA location (US only). `min_severity`, `exclude: [event names]`, `zone`, `interval`. |
| `persistent_notifications` | Any persistent notification whose id starts with `echo_` shows full-screen. Put the severity in the id (`echo_severe_leak`) to colour it. End the id with `@<display>` (`echo_severe_leak@kitchen_echo_show_5`) to show it on that display only. Dismissing on screen dismisses it in HA. |
| `events` | Fire an `echo_notify` event with `title`, `message`, `severity`, `icon`, `id`, `display` (part of a display's name, e.g. `kitchen_echo_show_5` or `office`, to show it there only). Needs the display's HA user to be an administrator. |

```yaml
# Example: from any automation
action: persistent_notification.create
data:
  notification_id: echo_severe_garage
  title: Garage door open
  message: The garage door has been open for 30 minutes.
```

---

## Development

The cards are edited in `src/`. `dist/echo-show-dashboard.js` is built from them and committed (HACS installs it from there):

```sh
node build.js                    # rebuild dist/
python3 test/validate_ha.py      # check the YAML/Jinja in homeassistant/
python3 test/climate_plan.py     # scenario tests for the climate plan macro
node test/smoke.js               # load every card in Chromium (needs Playwright)
node test/climate.js             # drive the climate card against a fake HA
node test/timers-ks.js           # Kiosk Satellite timers: through HA and the kiosk's JS API
node test/readme-shots.js        # retake the README screenshots in docs/ (also needs @mdi/js)
```

`test/index.html#weather` (or `#timers`, `#media`, `#climate`, `#climate-schedule`, `#notify`) shows each card against a fake Home Assistant in any browser.

To release: bump `version` in `package.json`, run `node build.js`, commit, then publish a GitHub release with a new tag (e.g. `v1.1.0`). The release workflow attaches the bundle to it, and HACS offers it as an update. Releases marked *pre-release* only show up in HACS for people who enable beta versions.

## License

MIT
