# Changelog

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
