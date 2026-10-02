# Changelog

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
