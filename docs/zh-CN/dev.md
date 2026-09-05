# JimBDHub 开发者文档

面向贡献者与二次开发者的技术文档。用户文档见根目录 [README.md](../../README.md)。

## 架构总览

所有平台共享 `web/` 目录下的同一套前端代码，桌面端与 Android 端仅作为 WebView 外壳，通过桥接对象提供原生能力（文件对话框、系统日程/闹钟、桌面小部件、文件同步等）。前端通过 `web/js/platform.js` 检测运行环境：

| 环境      | 检测方式                                          | 桥接对象                                      |
| ------- | --------------------------------------------- | ----------------------------------------- |
| Android | `typeof window.AndroidBridge !== 'undefined'` | `AndroidBridge`（Kotlin 注入）                |
| 桌面端     | `typeof window.pywebview !== 'undefined'`     | `pywebview.api`（`DesktopBridge`）          |
| 浏览器     | 以上均不存在                                        | 无桥接，使用降级实现（`<input type="file">`、Blob 下载） |

## 目录结构

完整目录结构见 [DirInfo.txt](../../DirInfo.txt)。`android/app/src/main/assets/web` 是指向 `./web` 的符号链接，两端内容自动同步。

## 技术栈

| 层面           | 技术                                                |
| ------------ | ------------------------------------------------- |
| 前端           | 原生 HTML/CSS/JS (ES Modules)，无构建步骤                 |
| 图表           | 原生 SVG 渲染（`chart.js`）                             |
| 数据           | localStorage / WebView 存储                         |
| 同步           | 本地文件 + Syncthing（文件轮询）                            |
| 桌面端          | Python 3 + pywebview + PyQt6                      |
| Android      | Kotlin + WebView + WebViewAssetLoader + AppWidget |
| 打包 (Windows) | PyInstaller                                       |
| 打包 (Linux)   | AppImage / appimagetool                           |

## 前端模块

| 文件                 | 职责                                    |
| ------------------ | ------------------------------------- |
| `js/app.js`        | 入口与路由（视图切换、四张独立图表渲染与同步接线）             |
| `js/chart.js`      | 图表渲染（情绪/药效/睡眠/事件四个独立渲染器 + 滚动/十字线同步总线） |
| `js/store.js`      | 数据层（localStorage 读写、备份构建/导入）          |
| `js/meds.js`       | 药品库模块（库存、变更日志、内置数据库搜索）                |
| `js/records.js`    | 记录模块（情绪/服药/睡眠/事件表单、历史记录、备忘录）          |
| `js/settings.js`   | 设置模块                                  |
| `js/theme.js`      | 主题系统（情绪颜色、背景、缩放等）                     |
| `js/sync.js`       | Syncthing 同步                          |
| `js/autobackup.js` | 自动备份（事件钩子、数量上限、恢复/删除确认）               |
| `js/mdexport.js`   | 导出为 Markdown（供大语言模型分析，可调整导出记录数量）      |
| `js/update.js`     | 软件更新（频道选择、元数据拉取、平台匹配、SHA-256 校验、下载安装） |
| `js/platform.js`   | 平台检测与原生桥接                             |
| `js/i18n.js`       | 国际化引擎                                 |
| `locales/*.json`   | 语言文件（`zh-CN` / `en-US`）               |
| `MedDB.json`       | 内置药品数据库（含药代动力学参数）                     |

## 数据存储

所有数据键位于 `web/js/store.js`，均存储在浏览器 `localStorage`：

| 键名                       | 内容         |
| ------------------------ | ---------- |
| `jimbdhub_mood_records`  | 情绪记录       |
| `jimbdhub_medications`   | 药品信息       |
| `jimbdhub_med_logs`      | 药品变更日志     |
| `jimbdhub_sleep_records` | 睡眠记录       |
| `jimbdhub_events`        | 事件记录       |
| `jimbdhub_med_history`   | 用药历史（补充药效） |

其它持久化键：

| 键名                                                                                                     | 内容                                                                                                      | 位置           |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ------------ |
| `jimbdhub_memo`                                                                                        | 备忘录                                                                                                     | `records.js` |
| `jimbdhub_theme`                                                                                       | 主题设置（含睡眠显示模式 `sleepDisplayMode`、自动备份设置 `autoBackupEnabled` / `autoBackupFolder` / `autoBackupMaxCount`） | `theme.js`   |
| `jimbdhub_language`                                                                                    | 语言设置                                                                                                    | `i18n.js`    |
| `jimbdhub_syncthing_enabled`                                                                           | Syncthing 同步开关                                                                                          | `sync.js`    |
| `jimbdhub_sidebar_collapsed` / `jimbdhub_show_forward` / `jimbdhub_chart_page` / `jimbdhub_chart_view` | 视图状态                                                                                                    | `app.js`     |

桌面端 WebView 存储持久化于 `~/.JimBDHub`（见下文桌面端章节）。主题与语言设置均包含在备份中（`store.buildBackup()`）。

## 平台桥接

### Android（`AndroidBridge`，位于 `MainActivity.kt`）

| 方法                                                                                                                                                                     | 功能                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `saveBackup(json, suggestedName)`                                                                                                                                      | 通过 SAF `CreateDocument` 导出备份           |
| `saveTextFile(text, suggestedName)`                                                                                                                                    | 通过 SAF 导出任意文本文件（如 Markdown）            |
| `pickBackup()`                                                                                                                                                         | 通过 SAF 选择备份文件                          |
| `pickBackgroundImage()`                                                                                                                                                | 系统图片选择器，返回 Base64 data URL             |
| `enableSync()` / `disableSync()` / `writeSyncFile(json)`                                                                                                               | Syncthing 文件同步（SAF 目录，3 秒轮询）           |
| `chooseBackupFolder()` / `listAutoBackups(uri)` / `writeAutoBackup(uri, json, maxCount, reason)` / `readAutoBackup(uri, fileName)` / `deleteAutoBackup(uri, fileName)` | 自动备份（SAF 目录，见下文「自动备份机制」）               |
| `downloadAndInstallApk(url, sha512, fileName)`                                                                                                                         | 下载 APK、SHA-512 校验、通过 FileProvider 启动安装 |
| `addWidget()`                                                                                                                                                          | 请求添加启动器小部件                             |
| `openUrl(url)`                                                                                                                                                         | 用系统浏览器打开链接（如项目仓库）                      |
| `addCalendarEvent(...)`                                                                                                                                                | 添加系统日历事件（`CalendarContract`）           |
| `setAlarm(hour, minute, message)`                                                                                                                                      | 添加系统闹钟（`AlarmClock`）                   |
| `onWidgetReady()`                                                                                                                                                      | 前端 store 就绪回调，注入小部件产生的睡眠记录             |

前端通过 `window.__xxxCallback` / `window.__xxxError` 全局回调接收异步结果（见 `platform.js` 的 `waitFor*` 系列）。

### 桌面端（`DesktopBridge`，位于 `desktop/main.py`）

| 方法                                                                                                                                                                                                                               | 功能                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `isDesktop()`                                                                                                                                                                                                                    | 平台标识                                        |
| `saveBackup(json, file_name)` / `pickBackup()`                                                                                                                                                                                   | 原生文件对话框                                     |
| `saveTextFile(text, file_name)`                                                                                                                                                                                                  | 保存任意文本文件（如 Markdown 导出）                     |
| `enableSync(path?)` / `disableSync()` / `writeSyncFile(json)`                                                                                                                                                                    | Syncthing 文件同步（`SyncManager` 2 秒轮询 mtime）   |
| `chooseBackupFolder()` / `listAutoBackups(folder_path)` / `writeAutoBackup(folder_path, json_string, max_count=10, reason="DataChange")` / `readAutoBackup(folder_path, file_name)` / `deleteAutoBackup(folder_path, file_name)` | 自动备份（`FOLDER_DIALOG` 选择目录，见下文「自动备份机制」）      |
| `downloadUpdate(url, sha512, fileName)`                                                                                                                                                                                          | 下载更新、SHA-512 校验、启动安装（后台线程）                  |
| `addWidgetShortcut()`                                                                                                                                                                                                            | 桌面创建 `.lnk`（Windows）/ `.desktop`（GNU/Linux） |
| `openUrl(url)`                                                                                                                                                                                                                   | 用系统默认浏览器打开链接（`webbrowser`）                  |
| `onWidgetReady()`                                                                                                                                                                                                                | 前端 store 就绪回调，注入快捷方式产生的睡眠记录                 |

### 浏览器降级

无桥接时：导出使用 Blob + `<a download>`，导入使用隐藏 `<input type="file">`，同步与小部件功能不可用（前端 `platform.js` 的 `isSyncSupported()` / `isWidgetSupported()` 判断）。

## Syncthing 同步机制

- 数据变更后经 500ms 防抖写入同步文件（`sync.js`），写入/读取各有 1 秒抑制窗口，避免与外部轮询互相触发回环。
- 桌面端 `SyncManager` 每 2 秒轮询同步文件 mtime，变更时通过 `window.__syncthingCallback` 通知前端导入覆盖。
- 桌面端默认同步文件：`~/.JimBDHub/sync/JimBDHub.sync.json`；Android 端在设置中选择同步文件夹（SAF），轮询间隔 3 秒。
- 同步文件内容为完整备份 JSON（含 `syncedAt` 时间戳）。

## 自动备份机制

- 数据存到软件外：备份文件夹由用户选择，Android 端用 SAF 目录（`OpenDocumentTree` + 持久化权限，存 URI），桌面端用 `FOLDER_DIALOG` 选目录（存绝对路径）。
- 事件钩子形式：`autobackup.js` 通过 `store.subscribe()` 监听数据变化，变更后经 **3 秒防抖** 触发一次写入（`JimBDHub_AutoBackup_{操作}_{yyyyMMddHHmmss毫秒}.json`，操作即触发原因，固定英文，UI 展示时按当前语言翻译；内容为 `store.buildBackup()`），运行锁防止并发。`store.notify(reason)` 会记录并传递最后一次变更原因（如 `AddSleep`、`UpdateRecord`、`TakeMed` 等），主题/设置变更通过 `setTheme(partial, reason)` 传递原因，同步开关通过 `sync.js` 的 `lastSyncMutation` 传递原因。恢复备份（`RestoreBackup`）不会立即触发新的自动备份，避免冗余。刻意不做定时备份，避免后台保活。
- 数量上限：默认 10（可设 1~100），写入后按文件名排序删除超出上限的最旧文件；设置存于 `jimbdhub_theme`（`autoBackupEnabled` / `autoBackupFolder` / `autoBackupMaxCount`）。
- 恢复/删除均有确认弹窗（`showConfirm`）；恢复走 `store.validateBackup()` + `store.restoreBackup()`。
- 浏览器降级：`isAutoBackupSupported()` 为 false，自动备份 UI 禁用。

## 软件更新机制

- `update.js` 负责更新频道管理与版本检查流程。
- 频道（`UPDATE_CHANNELS`）按稳定性从高到低排列：正式发行版（R）、发布候选版（RC）、内部测试版（A）、公共测试版（B）、开发版（D）、金丝雀版（C）、夜间构建版（N）、内部预览版（IP）。选择靠后的频道会同时接收所有更稳定（rank 更小）的版本。
- 频道选择持久化在 `localStorage` 的 `jimbdhub_update_channel` 键中，默认 `R`。设置页 `update-channel-select` 下拉框驱动。
- `checkForUpdates(appVersion)` 拉取 GitHub Releases API（`RELEASES_API`），遍历每个 Release 寻找 `Metadata.json` 元数据资产（由 CI 自动构建时生成）；无元数据时视为稳定版（R 频道），从资产文件名推断平台信息。
- 元数据格式：`{ version, channel, files: [{ name, os, arch, url, sha512, sha256, sha1, md5 }] }`。
   - 客户端使用 `sha512` 校验；`sha256`、`sha1`、`md5` 供第三方使用。
- 版本比较：将版本号按数字段拆分后进行数值比较，支持 `V0.0.1A-N20260814` 等带后缀的格式。
- `runUpdate(meta)` 根据当前运行环境（Android / Windows / Linux）从元数据中挑选对应安装包，下载后 SHA-512 校验，校验通过后启动安装。
- 桌面端（`DesktopBridge.downloadUpdate`）：后台线程下载到 `~/Downloads`，SHA-512 校验后 `os.startfile`（Windows）或 `subprocess.Popen`（GNU/Linux，`APPIMAGE_EXTRACT_AND_RUN=1` 自解压模式）启动安装。完成后通过 `window.__desktopUpdateCallback` 回调前端。
- Android 端（`downloadAndInstallApk`）：后台线程下载到 `cacheDir`，SHA-512 校验后通过 `FileProvider` 提供 URI 启动 `ACTION_VIEW` 安装。完成后通过 `window.__androidUpdateCallback` 回调前端。
- 纯浏览器环境：前端 `fetch` 下载 + `crypto.subtle.digest('SHA-512')` 校验 + Blob 下载触发。
- 下载失败时提示用户是否前往浏览器手动下载。

## 国际化机制

- `i18n.js` 提供 `t(key, params?)` 与语言切换，语言存于 `jimbdhub_language`。
- 静态文本使用 `data-i18n`；含动态参数（如"药物 {n}"、同步状态）的文本使用 `data-i18n` + `data-i18n-params`（JSON 字符串），`updateDOM()` 会处理两者，保证切换语言即时生效。
- 修改语言文件后请同步更新 `zh-CN.json` 与 `en-US.json`。

## 主题系统

- `theme.js` 将主题设置持久化到 `jimbdhub_theme`，并写入 CSS 自定义属性。
- 支持：情绪颜色、数据点连接方式、背景（纯色/图片/渐变）、卡片/强调色、药物标记颜色、界面缩放（50%~150%）、屏幕边距。
- Android 自定义背景图通过 `AndroidBridge.pickBackgroundImage()` 获取 data URL 后存入主题。

## 桌面端

硬性约定（踩坑记录）：

- **必须**在导入 `webview` 前设置 `os.environ.setdefault("QT_API", "pyqt6")`，否则 qtpy 可能选中系统上残缺的 PyQt5。
- 使用本地 HTTP 服务器（`127.0.0.1:8765`）加载 `web/`，**禁止**使用 `file://` 协议（ES Module 会触发 CORS 失败）。
- `webview.start(private_mode=False, storage_path=~/.JimBDHub)`，否则 `localStorage` 在重启后丢失。
- AppImage 打包后 pywebview 对象注入可能延迟，前端 `platform.js` 检测与 `settings.js` 初始化需实现约 3 秒轮询等待。

命令行参数：`--sleep-log-toggle` 不启动 GUI，用于桌面小部件双态切换睡眠计时；状态与待写入记录存于 `~/.JimBDHub/widget_sleep_state.json` 和 `widget_pending_sleeps.json`。

## Android 端

- 通过 `WebViewAssetLoader` 加载 `https://appassets.androidplatform.net/assets/web/index.html`，解决 ES Module 的 CORS 限制。
- `AndroidManifest.xml` 中主题**必须**使用 `Theme.AppCompat` 系列，否则 `AppCompatActivity` 崩溃。
- 桌面小部件：`SleepWidgetProvider`（AppWidget 提供者，含 `BOOT_COMPLETED` 重注册）+ `SleepWidgetActionReceiver`（点击时写睡眠计时状态），记录在 WebView 启动后经 `onWidgetReady` 注入前端。
- 事件提醒（系统日程）与吃药提醒（系统闹钟）为 Android 独占功能。

## 本地开发与运行

### Web 端

由于 ES Module 的 CORS 限制，不能直接双击 `web/index.html`，需使用任意静态服务器：

```bash
cd web && python3 -m http.server 8765   # 或 npx serve web/
```

浏览器打开 `http://localhost:8765`。

### 桌面端

```bash
cd desktop
python -m venv venv
source venv/bin/activate    # Windows: venv\Scripts\activate
pip install -r requirements.txt
python main.py
```

GNU/Linux 额外需要 PyQt6 / Qt WebEngine（Arch: `sudo pacman -S python-pyqt6 python-pyqt6-webengine`），也可使用仓库根目录的 `Start.sh` / `Start.bat` 启动脚本。

桌面小部件命令行：`python desktop/main.py --sleep-log-toggle`（不启动 GUI，双态切换睡眠计时）。

### Android 端

Android Studio 打开 `android/` 目录，同步 Gradle 后直接运行。注意 `android/app/src/main/assets/web` 是指向 `./web` 的符号链接，改动前端后无需手动复制。

### Windows 符号链接

仓库使用 git 符号链接（索引 mode 120000），如 `web/contribution`、`web/JimBDHubIcon256.png`、`android/app/src/main/assets/web`。Windows 默认 `core.symlinks=false`，直接克隆会把符号链接检出为仅含目标路径文本的占位文件，导致 web / Android 构建引用失效。

**正确克隆方式**（需先开启 Windows 开发者模式，否则无权创建符号链接）：

```bash
git config --global core.symlinks true
git clone <仓库地址>
```

**已克隆且出现占位文件时**，运行仓库内脚本自动修复（优先创建真正的符号链接，无权限时回退为复制目标文件/目录内容）：

```bash
python Tools/Script/fix_link4win.py            # 自动修复
python Tools/Script/fix_link4win.py --dry-run  # 仅列出待修复项，不实际修改
```

> 注：脚本在无符号链接权限（非管理员、未开启开发者模式）时会回退为复制，功能正常，但 `git status` 会显示这些文件被修改。

## 构建与打包

### Windows — .exe

```bash
Build.bat            # 输出: dist/Microsoft-Windows-amd64.exe
Build.bat --wine     # 在 Wine 下交叉打包（使用 venv-wine）
Build.bat -g         # 跳过虚拟环境，使用全局 Python
```

### GNU/Linux — AppImage

```bash
chmod +x Build.sh
./Build.sh           # 输出: dist/GNU-Linux-amd64.AppImage
```

桌面端版本号在 `AppImageBuilder.yml` 中修改。

### Android — APK

Android Studio 打开 `android/`，`Build > Build Bundle(s) / APK(s) > Build APK(s)`。移动端版本号在 `android/app/build.gradle.kts` 中修改。

## 开发约定

- 前端无构建步骤、无外部网络依赖，保持离线可用（不使用 CDN / 在线字体）。
- 新增语言文本必须同时添加 `data-i18n` 与 `data-i18n-params`（如需插值）。
- 频繁使用的控件放在工作区（如图表控制栏）而非设置页，以提升可用性。
- 开发进度与历史决策见 [TODO.md](../../TODO.md)。
