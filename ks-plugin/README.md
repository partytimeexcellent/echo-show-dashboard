# Echo Volume Buttons (Kiosk Satellite plugin)

Takes over the hardware volume buttons on a Kiosk Satellite display:

- A press changes the **device volume** (or the media volume, if you pick that).
- While the assistant is answering, and for 4 seconds after, it changes the **assistant volume** instead, so a loud reply can be turned down without touching the music.
- Holding a button repeats, faster the longer it's held (about 5 steps a second, then 10).
- A mute key, where the device has one, mutes and restores the device volume.

The [Echo Show Dashboard](../README.md) shows the new level on screen. Elsewhere, turn on **Show the level in a small window**.

Needs Kiosk Satellite **2026.10.9** or newer. Nothing to configure per display.

## Install (on each display)

1. Download the ZIP from [`dist/`](dist/) (open it on GitHub and press the download button).
2. Open the display's Remote Admin (`http://<display>:2324`) → **Plugin Manager** → **Developer Tools** → **Install from ZIP**, pick the ZIP and confirm. Turn **Enable Plugins** on if it isn't, then enable **Echo Volume Buttons**.
3. In **Settings → Kiosk**, turn on **Disable volume buttons**. The buttons still reach the plugin, but the system stops changing the volume on its own (otherwise each press moves it twice).

To update, install the newer ZIP the same way; settings are kept.

## Settings

| Setting | Default | |
|---|---|---|
| Volume buttons change | Device volume | Device volume is the overall level. Media volume is music's share of it, so it can't get louder than the device volume. |
| Assistant volume during a voice reply | On | |
| Step per press | 7% | The device volume has about 15 levels, so 7% is one level. |
| Speed up while held | On | |
| Show the level in a small window | Off | For dashboards other than the Echo Show Dashboard. |

The plugin page shows the last level it set, or why it couldn't.

## What it can't do

Kiosk Satellite gives plugins no control of the alarm volume or of snoozing, so the buttons don't touch a ringing alarm. Nothing reaches the plugin while the screen is off or another app is in front.

## Development

`src/` is the plugin, `tests/` drives it against a fake host, `sdk/` and `tools/` are copied from the [Kiosk Satellite plugin SDK](https://github.com/jxlarrea/kiosk-satellite-plugin-hello-world) (Apache-2.0, see `sdk/LICENSE`).

```sh
python3 ks-plugin/tools/test.py                                   # JDK only
ANDROID_HOME=... python3 ks-plugin/tools/build.py --android-platform 35   # needs Android build-tools
```

GitHub Actions (`.github/workflows/ks-plugin.yml`) runs both on every push that touches `ks-plugin/` and commits the ZIP to `ks-plugin/dist/`. Bump `version` in `kiosk-satellite-plugin.json` for a new release.
