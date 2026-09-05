# JimBDHub Developer Documentation

Technical documentation for contributors and maintainers. For end-user documentation, see the [README](../../README.md).

## Architecture Overview

All platforms share the same frontend code under `web/`. The desktop and Android apps are thin WebView shells that expose native capabilities through bridge objects (file dialogs, system calendar/alarm, home-screen widgets, file sync, etc.). The frontend detects the runtime environment via `web/js/platform.js`:

| Environment | Detection | Bridge object |
|---|---|---|
| Android | `typeof window.AndroidBridge !== 'undefined'` | `AndroidBridge` (injected from Kotlin) |
| Desktop | `typeof window.pywebview !== 'undefined'` | `pywebview.api` (`DesktopBridge`) |
| Browser | neither of the above | No bridge; fallbacks (`<input type="file">`, Blob download) |

## Directory Structure

See [DirInfo.txt](../../DirInfo.txt) for the full structure. `android/app/src/main/assets/web` is a symlink to `./web`, so the two stay in sync automatically.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML/CSS/JS (ES Modules), no build step |
| Charts | Native SVG rendering (`chart.js`) |
| Data | localStorage / WebView storage |
| Sync | Local file + Syncthing (file polling) |
| Desktop | Python 3 + pywebview + PyQt6 |
| Android | Kotlin + WebView + WebViewAssetLoader + AppWidget |
| Packaging (Windows) | PyInstaller |
| Packaging (Linux) | AppImage / appimagetool |

## Frontend Modules

| File | Responsibility |
|---|---|
| `js/app.js` | Entry & routing (view switching, combined chart interaction) |
| `js/chart.js` | Combined chart rendering (mood, medication concentration, sleep, events) |
| `js/store.js` | Data layer (localStorage read/write, backup build/import) |
| `js/meds.js` | Medication library module (stock, change logs, built-in database search) |
| `js/records.js` | Records module (mood/medication/sleep/event forms, history, memo) |
| `js/settings.js` | Settings module |
| `js/theme.js` | Theme system (mood colors, background, scaling, etc.) |
| `js/sync.js` | Syncthing sync |
| `js/autobackup.js` | Auto backup (event hooks, count cap, restore/delete confirmation) |
| `js/mdexport.js` | Export as Markdown (for LLM analysis, adjustable record count) |
| `js/update.js` | Software updates (channel selection, metadata fetch, platform matching, SHA-256 verification, download/install) |
| `js/platform.js` | Platform detection & native bridge |
| `js/i18n.js` | Internationalization engine |
| `locales/*.json` | Language files (`zh-CN` / `en-US`) |
| `MedDB.json` | Built-in medication database (with pharmacokinetic parameters) |

## Data Storage

All data keys are defined in `web/js/store.js` and stored in browser `localStorage`:

| Key | Contents |
|---|---|
| `jimbdhub_mood_records` | Mood records |
| `jimbdhub_medications` | Medication information |
| `jimbdhub_med_logs` | Medication change logs |
| `jimbdhub_sleep_records` | Sleep records |
| `jimbdhub_events` | Event records |
| `jimbdhub_med_history` | Medication history (effect estimation) |

Other persisted keys:

| Key | Contents | Location |
|---|---|---|
| `jimbdhub_memo` | Memo | `records.js` |
| `jimbdhub_theme` | Theme settings (incl. sleep display mode `sleepDisplayMode`, auto backup settings `autoBackupEnabled` / `autoBackupFolder` / `autoBackupMaxCount`) | `theme.js` |
| `jimbdhub_language` | Language setting | `i18n.js` |
| `jimbdhub_syncthing_enabled` | Syncthing sync toggle | `sync.js` |
| `jimbdhub_sidebar_collapsed` / `jimbdhub_show_forward` / `jimbdhub_chart_page` / `jimbdhub_chart_view` | View state | `app.js` |

Desktop WebView storage persists under `~/.JimBDHub` (see the desktop section below). Theme and language settings are included in backups (`store.buildBackup()`).

## Platform Bridges

### Android (`AndroidBridge`, in `MainActivity.kt`)

| Method | Purpose |
|---|---|
| `saveBackup(json, suggestedName)` | Export backup via SAF `CreateDocument` |
| `saveTextFile(text, suggestedName)` | Export arbitrary text (e.g. Markdown) via SAF |
| `pickBackup()` | Pick a backup file via SAF |
| `pickBackgroundImage()` | System image picker, returns a Base64 data URL |
| `enableSync()` / `disableSync()` / `writeSyncFile(json)` | Syncthing file sync (SAF folder, 3s polling) |
| `chooseBackupFolder()` / `listAutoBackups(uri)` / `writeAutoBackup(uri, json, maxCount, reason)` / `readAutoBackup(uri, fileName)` / `deleteAutoBackup(uri, fileName)` | Auto backup (SAF folder; see "Auto Backup Mechanism" below) |
| `downloadAndInstallApk(url, sha512, fileName)` | Download APK, verify SHA-512, launch install via FileProvider |
| `addWidget()` | Request adding a launcher widget |
| `openUrl(url)` | Open a link (e.g. the project repo) in the system browser |
| `addCalendarEvent(...)` | Add a system calendar event (`CalendarContract`) |
| `setAlarm(hour, minute, message)` | Add a system alarm (`AlarmClock`) |
| `onWidgetReady()` | Called when the frontend store is ready; injects sleep records produced by the widget |

The frontend receives async results via global callbacks `window.__xxxCallback` / `window.__xxxError` (see the `waitFor*` helpers in `platform.js`).

### Desktop (`DesktopBridge`, in `desktop/main.py`)

| Method | Purpose |
|---|---|
| `isDesktop()` | Platform marker |
| `saveBackup(json, file_name)` / `pickBackup()` | Native file dialogs |
| `saveTextFile(text, file_name)` | Save arbitrary text files (e.g. Markdown export) |
| `enableSync(path?)` / `disableSync()` / `writeSyncFile(json)` | Syncthing file sync (`SyncManager` polls mtime every 2s) |
| `chooseBackupFolder()` / `listAutoBackups(folder_path)` / `writeAutoBackup(folder_path, json_string, max_count=10, reason="DataChange")` / `readAutoBackup(folder_path, file_name)` / `deleteAutoBackup(folder_path, file_name)` | Auto backup (`FOLDER_DIALOG`; see "Auto Backup Mechanism" below) |
| `downloadUpdate(url, sha512, fileName)` | Download update, verify SHA-512, launch installer (background thread) |
| `addWidgetShortcut()` | Create a desktop shortcut — `.lnk` (Windows) / `.desktop` (GNU/Linux) |
| `openUrl(url)` | Open a link in the system default browser (`webbrowser`) |
| `onWidgetReady()` | Called when the frontend store is ready; injects sleep records produced by the shortcut |

### Browser fallback

Without a bridge: export uses Blob + `<a download>`, import uses a hidden `<input type="file">`; sync and widget features are unavailable (checked via `isSyncSupported()` / `isWidgetSupported()` in `platform.js`).

## Syncthing Sync Mechanism

- Data changes are written to the sync file after a 500ms debounce (`sync.js`); read/write each have a 1s suppression window to prevent feedback loops with external polling.
- On desktop, `SyncManager` polls the sync file mtime every 2 seconds and notifies the frontend via `window.__syncthingCallback` to import and overwrite on change.
- Desktop default sync file: `~/.JimBDHub/sync/JimBDHub.sync.json`; on Android, a sync folder is chosen in Settings (SAF), polled every 3 seconds.
- The sync file contains a complete backup JSON (with a `syncedAt` timestamp).

## Auto Backup Mechanism

- Data is stored outside the app: the backup folder is chosen by the user — a SAF folder on Android (`OpenDocumentTree` + persisted permission, stored as a URI) and a `FOLDER_DIALOG` directory on desktop (stored as an absolute path).
- Event-hook style: `autobackup.js` listens to data changes via `store.subscribe()` and writes a backup after a **3-second debounce** (`JimBDHub_AutoBackup_{reason}_{yyyyMMddHHmmssMilliseconds}.json`, where `reason` is the English trigger cause, translated in the UI; contents from `store.buildBackup()`); a running lock prevents concurrent writes. `store.notify(reason)` records and forwards the last mutation reason (e.g. `AddSleep`, `UpdateRecord`, `TakeMed`), theme/setting changes use `setTheme(partial, reason)`, and sync toggles use `sync.js`'s `lastSyncMutation`. Restoring a backup (`RestoreBackup`) does not immediately trigger another auto backup, avoiding redundant entries. Deliberately no scheduled backups, to avoid background keep-alive.
- Count cap: default 10 (configurable 1–100); after each write, the oldest files beyond the cap are removed by filename order. Settings live in `jimbdhub_theme` (`autoBackupEnabled` / `autoBackupFolder` / `autoBackupMaxCount`).
- Restore and delete both require a confirmation dialog (`showConfirm`); restore goes through `store.validateBackup()` + `store.restoreBackup()`.
- Browser fallback: `isAutoBackupSupported()` is false and the auto backup UI is disabled.

## Software Update Mechanism

- `update.js` handles update channel management and version checking.
- Channels (`UPDATE_CHANNELS`) are ordered by stability (most stable first): Release (R), Release Candidate (RC), Alpha (A), Beta (B), Development (D), Canary (C), Nightly (N), Internal Preview (IP). Selecting a lower-ranked (less stable) channel also receives all more-stable versions.
- The selected channel is persisted in `localStorage` under the key `jimbdhub_update_channel`, defaulting to `R`. The settings page `update-channel-select` dropdown drives it.
- `checkForUpdates(appVersion)` fetches the GitHub Releases API (`RELEASES_API`) and iterates over each Release to find the `Metadata.json` metadata asset (generated by CI during automated builds). Releases without metadata are treated as stable (R channel), with platform info inferred from asset filenames.
- Metadata format: `{ version, channel, files: [{ name, os, arch, url, sha512, sha256, sha1, md5 }] }`.
  - The client uses `sha512` for verification; `sha256`, `sha1`, and `md5` are provided for third-party use.
- Version comparison: version strings are split into numeric segments and compared numerically, supporting suffixes like `V0.0.1A-N20260814`.
- `runUpdate(meta)` picks the correct package for the current runtime (Android / Windows / Linux) from the metadata, downloads it, verifies the SHA-512 checksum, and launches the installer.
- Desktop (`DesktopBridge.downloadUpdate`): background thread downloads to `~/Downloads`, verifies SHA-512, then launches via `os.startfile` (Windows) or `subprocess.Popen` (GNU/Linux, with `APPIMAGE_EXTRACT_AND_RUN=1` self-extraction mode). Callback via `window.__desktopUpdateCallback`.
- Android (`downloadAndInstallApk`): background thread downloads to `cacheDir`, verifies SHA-512, then launches the `ACTION_VIEW` install intent via `FileProvider`. Callback via `window.__androidUpdateCallback`.
- Browser-only: `fetch` download + `crypto.subtle.digest('SHA-512')` verification + Blob download trigger.
- On download failure, the user is prompted to open a browser for manual download.

## Internationalization

- `i18n.js` provides `t(key, params?)` and language switching; the language is stored under `jimbdhub_language`.
- Static text uses `data-i18n`; text with dynamic parameters (e.g. "Medication {n}", sync status) uses `data-i18n` + `data-i18n-params` (JSON string). `updateDOM()` handles both so language switches apply immediately.
- When modifying language files, keep `zh-CN.json` and `en-US.json` in sync.

## Theme System

- `theme.js` persists theme settings to `jimbdhub_theme` and writes CSS custom properties.
- Supported: mood colors, data point connection style, background (solid/image/gradient), card/accent colors, per-medication marker colors, whole-UI scaling (50%–150%), screen edge margins.
- On Android, custom background images are obtained via `AndroidBridge.pickBackgroundImage()` and stored in the theme as a data URL.

## Desktop App

Hard constraints (lessons learned):

- **Must** set `os.environ.setdefault("QT_API", "pyqt6")` before importing `webview`, otherwise qtpy may pick up a broken PyQt5.
- Serve `web/` via a local HTTP server (`127.0.0.1:8765`); **never** use `file://` (ES Modules fail CORS).
- Call `webview.start(private_mode=False, storage_path=~/.JimBDHub)` or `localStorage` is lost on restart.
- After AppImage packaging, the pywebview object may be injected late; the frontend `platform.js` detection and `settings.js` initialization must poll for about 3 seconds.

CLI flag: `--sleep-log-toggle` runs without GUI and toggles sleep timing for the desktop widget; state and pending records live in `~/.JimBDHub/widget_sleep_state.json` and `widget_pending_sleeps.json`.

## Android App

- Loads `https://appassets.androidplatform.net/assets/web/index.html` via `WebViewAssetLoader` to avoid ES Module CORS issues.
- `AndroidManifest.xml` **must** use a `Theme.AppCompat` theme, otherwise `AppCompatActivity` crashes.
- Home-screen widget: `SleepWidgetProvider` (AppWidget provider, re-registers on `BOOT_COMPLETED`) + `SleepWidgetActionReceiver` (writes sleep timing state on tap); records are injected into the frontend via `onWidgetReady` after the WebView starts.
- Event reminders (system calendar) and medication reminders (system alarm) are Android-only.

## Local Development & Running

### Web

You cannot open `web/index.html` directly (ES Module CORS restriction); use any static server:

```bash
cd web && python3 -m http.server 8765   # or npx serve web/
```

Open `http://localhost:8765` in a browser.

### Desktop

```bash
cd desktop
python -m venv venv
source venv/bin/activate    # Windows: venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

On GNU/Linux you also need PyQt6 / Qt WebEngine (Arch: `sudo pacman -S python-pyqt6 python-pyqt6-webengine`); the `Start.sh` / `Start.bat` launch scripts at the repository root work too.

Widget CLI: `python desktop/main.py --sleep-log-toggle` (no GUI; toggles sleep timing).

### Android

Open the `android/` directory with Android Studio, sync Gradle, and run. `android/app/src/main/assets/web` is a symlink to `./web`, so frontend changes need no manual copying.

### Windows symlinks

The repo uses git symlinks (index mode `120000`), e.g. `web/contribution`, `web/JimBDHubIcon256.png`, `android/app/src/main/assets/web`. On Windows `core.symlinks` defaults to `false`, so a plain clone checks these out as small text files containing only the target path, breaking web / Android build references.

**To clone correctly** (requires Windows Developer Mode first, otherwise creating symlinks is not permitted):

```bash
git config --global core.symlinks true
git clone <repo-url>
```

**If you already cloned and have placeholder files**, run the in-repo script to fix them automatically (tries to create real symlinks; falls back to copying the target file/directory when it lacks permission):

```bash
python Tools/Script/fix_link4win.py            # auto-fix
python Tools/Script/fix_link4win.py --dry-run  # list what would be fixed, change nothing
```

> Note: without symlink permission (not admin / Developer Mode off), the script falls back to copying — everything works, but `git status` will show those files as modified.

## Building

### Windows — .exe

```bash
Build.bat            # Output: dist/Microsoft-Windows-amd64.exe
Build.bat --wine     # Cross-build under Wine (uses venv-wine)
Build.bat -g         # Skip the virtual environment, use global Python
```

### GNU/Linux — AppImage

```bash
chmod +x Build.sh
./Build.sh           # Output: dist/GNU-Linux-amd64.AppImage
```

The desktop version number is changed in `AppImageBuilder.yml`.

### Android — APK

Open `android/` with Android Studio, then `Build > Build Bundle(s) / APK(s) > Build APK(s)`. The mobile version number is changed in `android/app/build.gradle.kts`.

## Development Conventions

- The frontend has no build step and no external network dependencies; keep it usable offline (no CDN / online fonts).
- New UI strings must add both `data-i18n` and, when interpolation is needed, `data-i18n-params`.
- Frequently used controls belong in the working area (e.g., the chart control bar) rather than in Settings, for better usability.
- Development progress and historical decisions: see [TODO.md](../../TODO.md).
