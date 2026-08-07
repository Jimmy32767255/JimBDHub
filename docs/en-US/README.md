# JimBDHub

A cross-platform app for people living with **bipolar disorder** to track mood, manage medication, and monitor sleep. All data is stored locally — nothing is uploaded to any cloud service.

[简体中文](../../README.md) | English

## Features

- **Mood tracking** — Record your mood on a scale of -10 to 10, with support for mixed-episode markers and notes; enable "Simple Mode" to record by day or by morning/afternoon/evening periods
- **Combined chart** — A single timeline showing mood fluctuations, medication concentration curves (upper/lower bounds), and sleep bars, with zoom, pan, hover snapping, pagination, and auto-wrapping legend
- **Event tracking** — Important events appear as vertical lines on the combined chart, with optional "time since now" display (anniversaries/countdowns); on Android, events can be added to the system calendar with one tap
- **Medication library** — Manage personal stock (boxes/blisters/pills), with a built-in drug database searchable by name/category/tags, stock adjustments, and a change log
- **Effect tracking** — Automatically computes medication concentration curves from half-life and onset/peak time *ranges* (converted per-tablet dose); supports "medication history" to estimate effects before your first recorded dose
- **Forward effect prediction** — Set daily scheduled intake times to project future medication effects, useful for planning ahead
- **Sleep tracking** — Record bedtime/falling-asleep/waking/getting-out-of-bed times, interruptions, and a sleep quality score (0–5); two display modes: timeline bars and translucent overlay
- **Memo** — A persistent text area on the records page for jotting down anything
- **Data backup** — Export/import complete data (records, medications, logs, settings, theme, memo) for easy migration
- **Syncthing sync** — On desktop and Android, data can be automatically written to a local sync file and merged back when it changes, enabling cross-device sync via Syncthing ("Everything is a File")
- **Home-screen widget** — An Android launcher widget plus desktop shortcuts (`.lnk` / `.desktop`) for one-tap start/stop of sleep logging, without opening the app
- **System reminders** (Android only) — Add events to the system calendar and medication times to the system alarm clock
- **Automatic medication logging** — When enabled, medication logs are generated automatically and stock is deducted at each scheduled daily intake time
- **Internationalization** — Simplified Chinese and English built in; switching languages takes effect immediately without restarting
- **Personalization** — Custom mood colors, data point connection style (curve/line), background (solid/image/gradient), UI accent colors, and per-medication marker colors
- **Display adaptation** — Whole-UI scaling (50%–150%) and screen edge margins to fit various displays and full-screen (notch) devices
- **Search & filter** — Filter medications and medication logs by tag, and filter/search history records by time range, type, and keywords

*he medication concentration curves are based on a simplified pharmacokinetic model and are intended for self-observation only — not medical advice.*

## Supported Platforms

| Platform | Notes |
|---|---|
| Windows | Portable `.exe`, double-click to run |
| GNU/Linux | AppImage, no installation required |
| Android | `.apk` package, with launcher widget and system reminders |

All three platforms share the same UI and data, which is always stored on your local device.

## Download & Install

Download the package for your platform from the [Releases](https://github.com/Jimmy32767255/JimBDHub/releases) page:

- **Windows**: download `Microsoft-Windows-amd64.exe` and double-click to run — no installation needed.
- **GNU/Linux**: download `GNU-Linux-amd64.AppImage`, make it executable, then run:

  ```bash
  chmod +x GNU-Linux-amd64.AppImage
  ./GNU-Linux-amd64.AppImage
  ```

- **Android**: download `Google-Android-arm64.apk` and install it (allow installing apps from unknown sources if prompted).

### Home-screen Widget (optional)

Open the app and go to Settings → Widget → Add to desktop to create a one-tap sleep-log shortcut. After that you can start/stop sleep logging without opening the app.

### Cross-device Sync (optional)

To sync data between multiple devices, follow the [Syncthing setup tutorial](./tutorial/syncthing.md).

## Getting Help

If you run into problems or have suggestions, reach us through:

- **QQ Group**: `181336946`
- **GitHub Issues**: file an issue on the [Issues](https://github.com/Jimmy32767255/JimBDHub/issues) page
- **Email**: <jimmy32767255@outlook.com>

## Data & Privacy

- All data (records, medications, logs, settings, theme, memo) is stored only in local `localStorage` / WebView storage on your device — **never uploaded to any cloud**.
- On desktop, data persists under `~/.JimBDHub`; uninstalling the app does not delete your data.
- It is recommended to periodically export a backup via **Settings → Data Backup** for migration or recovery.
- For multi-device sync, use the method described in the [Syncthing setup tutorial](./tutorial/syncthing.md).

## Contributors

Thanks to every user who uses the app, reports bugs and requests features: [view the contributor credits](../../contribution/contributors.md)

## For Developers

- [Directory structure](../../DirInfo.txt)
- [Developer documentation](./dev.md)

## License

This project is open source under the GPLv3 license. See [LICENSE](../../LICENSE) for details.
