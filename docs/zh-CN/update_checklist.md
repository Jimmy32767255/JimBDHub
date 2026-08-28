# 更新检查单

所有需要更新的内容。以下均为硬编码在文件中的值，发布新版本前需手动确认/修改。

## 一、版本号（每次发布必改）

| 文件 | 关键词（Ctrl+F） | 说明 |
|---|---|---|
| `web/js/about.js` | `APP_VERSION` | 应用版本号。显示在「关于」页，也是「检查更新」时比对的当前版本，是版本号的唯一事实来源（夜间构建 CI 会从这里自动提取） |
| `android/app/build.gradle.kts` | `versionName` | Android 版本名，**必须与 `about.js` 的 `APP_VERSION` 完全一致** |
| `android/app/build.gradle.kts` | `versionCode` | Android 构建号（正整数），每次发布**必须递增**，否则商店/系统无法识别新版本 |
| `AppImageBuilder.yml` | `version: 0.0.1`（位于 `AppDir.app_info` 段） | 桌面 AppImage 的版本号（注意文件第 4 行 `version: 1` 是 AppImage Builder 配置格式版本，**不要改**） |

> 补充：`.github/workflows/nightly.yml` 会自动从 `about.js` 提取版本并生成夜间构建的 `Metadata.json`，**无需手动改**，但前提是 `APP_VERSION` 已更新。

## 二、数据库与数据格式版本（数据结构变更时才需改）

| 文件 | 关键词（Ctrl+F） | 说明 |
|---|---|---|
| `web/MedDB.json` | `"version": 2` | 内置药品数据库格式版本。`Tools/Script/meddb_updater.py` 更新参数时只改写 `lastVerified`、`dataSource` 与药品字段，**不会**递增此版本；当数据库结构或字段语义变化时需手动递增 |
| `web/js/dbUpgrade.js` | `CURRENT_DB_VERSION` | 本地数据仓库（localStorage）结构版本。新增需要迁移的字段/格式时在此递增，并同步补充升级逻辑；`store.js` 会以 `VERSION_KEY` 把它落盘 |
| `web/js/store.js` | `VERSION_KEY`（`'jimbdhub_db_version'`） | 本地数据库版本号的 localStorage 存储键，与 `CURRENT_DB_VERSION` 配套使用 |

## 三、版本一致性约束

- `web/js/about.js` 的 `APP_VERSION` ↔ `android/app/build.gradle.kts` 的 `versionName` 必须一致。
- `versionCode` 只增不减。
- Git 标签（tag）按版本号命名，例如历史标签 `V1.0.0R`、`V1.1.0R-NEC`、`V1.2.0B`、`V1.3.0R-NIBC`，发布时打对应的 `V x.y.z` 标签。

## 四、构建产物名与更新机制（CI 与前端约定，改动需两端同步）

| 文件 | 关键词（Ctrl+F） | 说明 |
|---|---|---|
| `.github/workflows/nightly.yml` | `targets = [` 段中的 `Microsoft-Windows-amd64.exe`、`GNU-Linux-amd64.AppImage`、`Google-Android-arm64.apk` | 三端产物文件名与 os/arch 映射，生成 `Metadata.json` 的依据 |
| `.github/workflows/nightly.yml` | `files:` 段（发布时附带的产物列表） | 与上面 `targets` 保持一致 |
| `web/js/update.js` | `UPDATE_META_NAME`（`'Metadata.json'`） | 客户端从每个 Release 资产中查找的更新元数据文件名，须与 CI 生成的资产名一致 |
| `web/js/update.js` | `fileFromAsset` 中的正则 `Microsoft-Windows\|GNU-Linux\|Google-Android` | 无元数据时的回退解析：按产物命名约定 `<OS>-<ARCH>.<ext>` 推断平台，须与 CI 产物命名一致 |

## 五、仓库地址（仓库改名/迁移时才需改）

| 文件 | 关键词（Ctrl+F） | 说明 |
|---|---|---|
| `web/js/update.js` | `RELEASES_API` | GitHub Releases API 地址（`https://api.github.com/repos/...`），检查更新用 |
| `web/js/update.js` | `RELEASES_URL` | GitHub Releases 页面地址，下载失败时跳转用 |
| `web/js/about.js` | `REPO_URL` | 「查看项目仓库」按钮打开的地址 |
| `.github/workflows/nightly.yml` | `Jimmy32767255/JimBDHub` | 夜间构建产物下载 URL 中的仓库路径 |

## 六、应用标识与图标（一般不变，改名/换图标时才需改）

| 文件 | 关键词（Ctrl+F） | 说明 |
|---|---|---|
| `android/app/build.gradle.kts` | `namespace` / `applicationId`（`org.jimmy.bdhub`） | Android 包名，发布后不可更改 |
| `android/app/src/main/res/values/strings.xml` | `app_name` | Android 桌面显示的应用名 |
| `desktop/main.py` | `title="JimBDHub"` | 桌面端窗口标题 |
| `AppImageBuilder.yml` | `id:`（`com.github.jimmy32767255.jimbdhub`） | AppImage 应用 ID |
| `AppImageBuilder.yml` | `Name=JimBDHub`、`Icon=JimBDHubIcon256` | 桌面入口显示名与图标名 |
| `web/index.html` | `about-name`、`JimBDHubIcon256.png` | 关于页显示的应用名与图标路径 |
| `Build.spec` | `name='Microsoft-Windows-amd64'` | Windows 可执行文件（exe）产物名，须与 nightly.yml 一致 |
| `Build.spec` | `icon='./assets/JimBDHubIconOutput.ico'` | Windows 打包用图标文件路径 |

## 七、数据文件名约定（跨端/工具脚本保持一致）

| 文件 | 关键词（Ctrl+F） | 说明 |
|---|---|---|
| `desktop/main.py` | `.JimBDHub`（`_data_dir` / `storage_path`） | 桌面端数据存储目录名（位于用户主目录下） |
| `desktop/main.py` | `JimBDHub.sync.json`（`_default_sync_path`） | 桌面端默认同步文件名 |
| `desktop/main.py` | `AUTO_BACKUP_PREFIX`（`"JimBDHub_AutoBackup_"`） | 自动备份文件名前缀 |
| `web/js/autobackup.js` | `AUTO_BACKUP_FILE_PREFIX`（`'JimBDHub_AutoBackup_'`） | 前端对应的自动备份前缀，须与桌面端一致 |
| `Tools/Script/sync2backupfile.py` | `JimBDHub.sync.json` | 同步文件转备份工具里的默认同步文件名 |

## 八、构建基础设施（修改 `web/` 后需检查）

| 文件 | 关键词（Ctrl+F） | 说明 |
|---|---|---|
| `android/app/src/main/assets/web` | （目录，本身为符号链接） | Android 打包用的 web 资源 = 仓库根 `web/` 的符号链接。修改 `web/` 后需保证该链接存在；Windows 无符号链接权限时 `git checkout` 会退化为普通副本，需运行 `python Tools/Script/fix_link4win.py` 修复/同步，否则 Android 端不会带上最新前端代码 |

## 九、文档中的硬编码信息（联系方式变更时才需改）

| 文件 | 关键词（Ctrl+F） | 说明 |
|---|---|---|
| `docs/zh-CN/tutorial/syncthing.md` | `181336946` | 中文文档中的 QQ 交流群号 |
| `docs/en-US/tutorial/syncthing.md` | `181336946` | 英文文档中的 QQ 交流群号 |
