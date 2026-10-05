# Changelog

## 1.10.0

- **The display's volume slider follows its volume buttons.** For "This display", the media page's volume slider now reads and sets the tablet's Device volume (`number.<display>_volume`), which is what the physical buttons change. Before it used the player's own level (Kiosk Satellite's Media volume), a separate setting that stayed at 100% while the buttons moved the Device volume. `local_volume: media` brings the old behaviour back.

## 1.9.1

- Spotify › **Liked songs** was empty: Music Assistant brings Spotify's Liked Songs in as a playlist ("Liked Songs <name>"), not as favourite tracks. The chip now lists that playlist's songs (the first 300), and tapping one plays on from it.

## 1.9.0

- **Browse is now Local library and Spotify.** The Sonos favorites tab is gone (they played the wrong thing from some rooms). The library opens on **Radio**, before Playlists, Artists, Albums, Tracks and Podcasts, and the "nothing playing" page's quick row shows the library's radio stations instead of Sonos favorites.
- **More from Spotify.** The Spotify tab keeps its search and gains **Playlists, Albums, Artists, Liked songs and Recently played**: what you saved from Spotify into Music Assistant (recognised by Spotify's artwork, so local music is left out).

## 1.8.0

- **Play on this display.** The media page now lists the display's own player (`media_player.<display>`, its Music Assistant player) next to the Sonos speakers, in the Speakers panel, the **Play on** picker and Settings › Media. Each display lists only itself, never the other Echo Shows. It stays on its own: no group button, Group all / Ungroup all skip it, and nothing is ever joined with the Sonos players (they can't take AirPlay streams). `local_player: false` turns it off; `local_name` renames it.

## 1.7.0

Every display now works on its own, with nothing to configure, instead of falling back to one display's timers, satellite and room.

- **Timers per display.** Each display uses its own `timer.<display>_timer_1..3` and `input_text.<display>_timer_N_name` (`<display>` = its Kiosk Satellite name slugified) when they exist: the Clock card, the countdown overlay and every page's timer button. Settings › Timers shows **Set up timers for this display** on a display that's still on the shared set and creates them (Home Assistant administrator needed). A `timer_prefix` in the config still wins.
- **Voice and the timer alarm follow the display.** `echo_timers.jinja` gains `display_slug`, `prefix_for_device`, `slug_for_prefix` and `display_entity`. The voice blueprint finds the display's timers and Dashboard view select from the satellite that heard the command (the `displays` list is now optional overrides), and the timer alarm blueprint, with its inputs left empty, handles every display's timers in one automation, waking and raising the volume of the display the timer belongs to. Update `custom_templates/echo_timers.jinja`.
- Clock card: the timer alarm pauses while **this display's own** voice satellite listens. The configured `satellite` used to come first, so every display paused when that one listened. Satellites named `assist_satellite.<device>` (no `_assist_satellite` suffix) are found too.
- Media card: a display starts on the speaker in its own Home Assistant area when exactly one of the `players` is there.
- Alerts: an `echo_notify` event's `display` and a persistent notification id ending in `@<display>` show on that display only.

## 1.6.4

- Settings panel: a display is now found from its own Kiosk Satellite name before the dashboard's `echo_show: device` default is used, as the README describes. Before, the default won on every display without a `devices` entry, so the Microphone tile (and the other General/Display controls) on a Kitchen Echo Show 5 changed the Kitchen Echo Show 8.
- README: screenshots of each page.

## 1.6.3

- Settings › General: the **Microphone** tile now uses the display's **VS Mute** switch (`switch.<device>_vs_mute`, Kiosk Satellite's own Mute microphone) whenever Home Assistant has it, so it works on every display with **Expose kiosk entities** on, with no secrets.yaml entry. The Remote API helper is only used on displays without that switch. When a display has no way to mute, the tile's place shows what to turn on.
- Alarm-settings helper (`echo_kiosk.py`): fixed a display reaching another tablet whose secrets name is part of its own name (with only `echo_kiosk_kitchen_*`, a "Kitchen Echo Show 5" changed the "Kitchen Echo Show 8"). The script now asks the tablet its name and skips pairs that belong to another display, preferring the longest matching name. Update `custom_templates/echo_kiosk.py`.

## 1.6.2

- Settings › General: **Wake sound** and **Wake word sensitivity** now control Kiosk Satellite's own entities (`switch.<device>_vs_chimes`, `select.<device>_vs_wake_word_sensitivity`), falling back to the old Voice Satellite ones only when the native ones don't exist.
- Clock card: the timer beep now pauses while the Echo is listening even when `satellite` still names the old Voice Satellite entity. If the configured satellite is missing or unavailable, the display's native `assist_satellite.<device>_assist_satellite` is used.
- Timer voice blueprint: the example satellite is the native one, and "stop" falls back to a media player on the device that heard the command when none is set.

## 1.6.1

- Settings › General: the **Microphone** tile now turns Kiosk Satellite's own **Mute microphone** (`voice.mute`) on and off over the tablet's Remote API, so "Off" really stops the wake word. It used to flip `switch.<device>_mute`, the old dashboard Voice Satellite's mute, which the native wake word ignores. The tile shows the live state from the **VS Mute** entity when the tablet exposes it.
  - Uses the alarm-settings helper (`shell_command.echo_kiosk`, new ops `mic` and `mic_set`); update `custom_templates/echo_kiosk.py`. Without the helper the tile falls back to the VS Mute switch, then the old switch, with a note.

## 1.6.0

- **Climate page** (`echo-climate-card`): a smart thermostat run by Home Assistant.
  - **Now**: a dial with the room temperature and draggable heat/cool setpoints (or − / +), what it's doing and why, hold lengths (next change, 2 h, 4 h, permanent) and Resume, comfort profiles, mode and fan, room sensors and today's schedule.
  - **Schedule**: the week at a glance; tap a day to edit its changes on time wheels and copy it to other days.
  - **Comfort**: heat/cool temperatures per profile (Home, Wake, Sleep, Away, Vacation) and which rooms each one follows; smart recovery, room comfort, auto away and the default hold length.
  - **Insights**: last 24 hours, run time this week, learned recovery rates, filter hours.
  - A house button (top left) shows Home / Night / Away / Vacation and opens a sheet to override presence when it's wrong, and to set guests, vacation and night mode.
- New `packages/echo_climate.yaml` + `custom_templates/echo_climate.jinja`: profiles, weekly schedule, holds (a change made anywhere else becomes a hold until the next change), away/vacation, room compensation, smart recovery that learns warm-up and cool-down rates, filter run time and reminder, voice commands.
- New `packages/echo_house.yaml`: house mode (home / night / away / vacation) from every person, with an away delay, guests, vacation and a manual override that can end by itself on arrival or departure. Fires `echo_house_mode_changed`; meant to drive a future alarm panel too.
- `test/validate_ha.py` now also fails on a `variables:` block that uses its own keys (Home Assistant saves UI scripts with sorted keys) and on non-string keys such as a bare `off:`.

## 1.5.0

- Clock › Alarms: **delete alarms** by swiping a row to the left and tapping Delete, or with **Edit** (top left), which puts a ✕ on every row. A deleted alarm can be brought back with **Undo** for a few seconds.
- Clock › Alarms: an **Alarm volume** slider at the top, with a play button. Letting go of the slider saves the volume to the tablet and plays the alarm tone once at that level. It shows when the alarm-settings helper (`shell_command.echo_kiosk`) is installed.
- The alarm-settings helper has a `logs` op that returns the tablet's recent alarm and sound log lines, for troubleshooting.

## 1.4.0

- **Alarm settings in the settings panel**: a new Alarms tab sets the Kiosk Satellite alarm settings of the tablet you're on: alarm volume (with Test), tone, snooze length, stop ringing after, ease in and its duration, sunrise length and the spoken phrase. Picking a tone plays it once on the tablet.
- **11 new alarm tones** (Chime, Marimba, Bells, Gentle Beep, Kitchen Bell, Classic Alarm, Sunrise, Harp, Digital, Wind Chimes, Rising Pulse), original sounds made by the helper script and added to the tablet's sounds folder with one button.
  - Needs the new `packages/echo_kiosk.yaml` and `custom_templates/echo_kiosk.py`, Remote management on in Kiosk Satellite and a token per tablet in `secrets.yaml` (see the README).
- Timers: much taller hour/minute/second wheels, and the quick picks are now **Recents**, the last lengths you started on this display (the configured presets show until you've started one).
- Weather: the hourly wind row shows just the number, a little larger.

## 1.3.0

- **Clock** page (`echo-clock-card`, replaces the timers page; `echo-timer-card` still works as an alias). Reorganised like the iOS Clock app, with Alarms, Stopwatch and Timers tabs.
  - **Alarms**: lists and manages the Kiosk Satellite app's own alarms. Pick the time on rolling hour/minute (and AM/PM) wheels, choose repeat days and a label, switch alarms on and off, edit and delete. Alarms are stored and scheduled on the tablet as Android alarm clocks, so they ring even when Home Assistant, Wi-Fi or the dashboard is down. Shows the next alarm and a Snooze/Stop bar while one rings.
  - **Stopwatch**: start, stop, lap and reset, with the fastest and slowest laps marked. Keeps running across page changes and reloads.
  - **Timers**: new timers are picked on hour/minute/second wheels (seconds are new) with quick-pick chips.
  - The tab bar shows a dot when a timer, the stopwatch or an alarm is active. A ringing timer brings the Timers tab forward.
- Settings panel exposes `EchoShow.deviceSlug()` and `EchoShow.devEnt()` for cards.

## 1.2.1

- Fixed: the weather forecast chart could go blank and stay blank until the page was reloaded. It happened after a Home Assistant restart (the display reconnected before the weather integration had loaded, and the forecast subscription was never retried) and after the weather integration reloaded. The card now resubscribes after every reconnect, retries failed subscriptions, resubscribes when the weather entity comes back from unavailable or goes quiet for 90 minutes, and keeps the last forecast if the provider briefly sends an empty one.

## 1.2.0

- **Themes**: a new Look tab in settings with nine colour themes that apply to every page, popup and alert: Midnight (default), Black, Ocean, Forest, Aurora, Ember, Graphite, Night red and Terminal. Optionally switch to a different theme between sunset and sunrise. The weather page's live sky background can be turned off to use the theme's background instead.
- Fixed: with a timer running, switching pages could jump back to the timers page. The weather and media pages now only jump when a timer starts or finishes while they're showing.
- Settings: Kiosk Satellite's video stream (RTSP) switch on the General tab, and motion / face wake for the screensaver on the Display tab.
- The timer countdown overlay is fully opaque.

## 1.1.0

- **Settings panel**: the gear button opens the same tabbed settings on every page (`action: settings`). General: microphone, camera, voice assistant, wake sound, volumes, wake word sensitivity. Display: brightness, auto brightness, keep screen on, screensaver timeout and style, screen-cleaning mode, timer countdown position. Weather: source, animations, hourly wind. Timers: alarm volume, tone, test. Media: this display's room, follow what's playing, Music Assistant status. Alerts: chime, test alert, show dismissed alerts. About: display info, versions, reload / clear cache.
- **Timer countdown overlay**: big countdown with a progress ring on the weather and media pages while a timer runs; tap it to open the timers page.
- Weather: the low-temperature line is solid and coloured by temperature; the hourly view shows wind speed and direction.
- Media: now-playing text is centred.

## 1.0.0

First packaged release: all four cards in one file, installable through HACS.

- echo-weather-card 1.5.0
- echo-timer-card 1.6.0
- echo-media-card 1.7.0 (live Music Assistant queue, shared "playing from" helpers, speaker picker in browse)
- echo-notify 1.0.0
- Home Assistant package (timer helpers and scripts), Jinja macros, and blueprints for the timer alarm and voice commands
- Example dashboard
