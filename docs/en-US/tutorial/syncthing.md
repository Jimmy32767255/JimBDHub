# Cross-device Sync Tutorial (Syncthing)

JimBDHub data is stored only on your local device by default. If you want to automatically sync data across multiple devices (e.g., a home computer and a phone), you can use [Syncthing](https://syncthing.net), an open-source tool that transfers data directly between devices, peer-to-peer, without going through any relay server.

## How Sync Works

JimBDHub does not "connect" to Syncthing directly. Instead, it uses an "Everything is a File" approach:

1. Whenever local data changes, JimBDHub automatically writes the **complete dataset** into a sync file (`JimBDHub.sync.json`).
2. Syncthing syncs this file to your other devices.
3. On the other devices, JimBDHub detects the file change, automatically imports the data, and overwrites the local data.

So you only need to do two things: **share the folder containing the sync file with Syncthing**, and **enable the sync switch in JimBDHub on both devices**.

## 1. Download and Install Syncthing

Syncthing has clients for Windows / GNU/Linux / Android and other platforms:

- **Official website**: <https://syncthing.net> (downloads page: <https://syncthing.net/downloads/>)
- **Windows**: Download the Windows archive from the official website, extract it, and run `syncthing.exe`. A tray icon will appear on first run.
- **GNU/Linux**: Prefer installing from your distribution's repository, for example:
  - Debian/Ubuntu: `sudo apt install syncthing`
  - Arch Linux: `sudo pacman -S syncthing`
  - You can also use the AppImage / binary package from the official website
- **Android**: Search for and install **Syncthing** (or the community-maintained Syncthing-Fork) from an app store, such as F-Droid or Google Play.

After installation and startup, Syncthing provides a web management interface at the default address <http://127.0.0.1:8384> (on Android, operate directly in the app; the interface logic is the same). The steps below are all performed in this management interface.

> All devices you want to sync must have Syncthing installed and running, and ideally be online (devices can connect directly over a LAN, or via relay servers).

## 2. Pair Devices in Syncthing

Syncthing identifies each device by a "Device ID". To pair devices:

1. On **Device A**, find its Device ID (a very long random string) in the management interface ("Actions" menu at the top right → "Show ID", or at the top of the main screen).
2. On **Device B**, click **Add Remote Device**, paste Device A's Device ID, give it a name, and save.
3. In reverse, repeat the same steps on **Device A** to add Device B's Device ID.
4. After the two devices add each other, you'll see a prompt like "this device has tried to connect"; confirm and accept. After that, both devices will show each other as connected (green dot) in their device lists.

## 3. Create a Shared Folder in Syncthing

After pairing, create a "shared folder" so the two devices can exchange the same file:

1. In the management interface of **Device A**, click **Add Folder**:
   - **Folder ID**: enter an identifier, e.g., `jimbdhub-sync`. **It must be exactly the same on both devices** (Syncthing uses it to recognize the same folder).
   - **Folder Path**: the directory on Device A for storing the sync file (any path is fine; see "Step 4" below).
   - Save.
2. On **Device B**, also click **Add Folder**:
   - **Folder ID**: enter the exact same `jimbdhub-sync`.
   - **Folder Path**: another directory on Device B.
   - Save. Syncthing will ask whether to share it with Device A; choose "Share".
3. Wait for both devices to complete the initial scan and sync (a progress indicator appears next to the folder).

That completes the Syncthing configuration. Next, make JimBDHub write data into this folder.

## 4. Enable Sync in JimBDHub

### Desktop (Windows / GNU/Linux)

After enabling sync on desktop, JimBDHub automatically writes data to a fixed path: `~/.JimBDHub/sync/JimBDHub.sync.json` (`~` is your user home directory; note that `.JimBDHub` is a hidden folder).

Either of the two approaches works:

1. Enable sync first, then add the folder in Syncthing:
   - Open JimBDHub → **Settings → Syncthing Sync**, and enable the "Enable Syncthing Sync" switch.
   - Back in the Syncthing management interface → Add Folder, enter `jimbdhub-sync` as the Folder ID, and the full path corresponding to `~/.JimBDHub/sync` as the Folder Path (e.g., `/home/your-username/.JimBDHub/sync` on Linux, `C:\Users\your-username\.JimBDHub\sync` on Windows).
2. Or create the shared folder first, then enable sync (the order does not affect the result).

After enabling, the JimBDHub settings page will show the sync file path and automatically write to it whenever data changes.

### Android

1. In Syncthing (Android app), create a shared folder as in Step 3 and note its **path** (e.g., `/Syncthing/jimbdhub`).
2. Open JimBDHub → **Settings → Syncthing Sync**, and enable the switch.
3. A system folder picker will pop up; select the shared folder created in Step 1.
4. JimBDHub will automatically create `JimBDHub.sync.json` in that folder and start syncing. To change the folder later, turn the switch off and back on to re-select.

### All Devices

Enable sync on each device you want to sync, following the platform-specific steps above. Note: **JimBDHub on every device must write to the same shared folder** (same Folder ID) so that Syncthing can transfer the file between them.

## 5. Verification and Notes

- All devices need to keep Syncthing running for JimBDHub to detect changes from the other side; there is a delay of roughly 1–3 seconds.
- For the initial setup, it's recommended to first run **Settings → Data Backup** to export a backup in case of mistakes.
- Before configuring sync, it's recommended to have one device generate some data and complete the first sync, then enable sync on the other device, to avoid syncing in the wrong direction.
- Avoid heavily modifying data on both devices at the same time; the sync file holds the "most recent complete dataset". If Syncthing detects a version conflict, it keeps a conflict file with a `.sync-conflict` suffix that you can compare and handle yourself.
- Sync is only for multi-device backup/migration; to keep history data long-term, it's still recommended to periodically export backups manually.

## More Resources

- Syncthing official documentation: <https://docs.syncthing.net>
- Feedback (JimBDHub related): QQ group `181336946` / [GitHub Issues](https://github.com/Jimmy32767255/JimBDHub/issues) / <jimmy32767255@outlook.com>
