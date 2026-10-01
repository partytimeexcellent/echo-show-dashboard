# Changelog

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
