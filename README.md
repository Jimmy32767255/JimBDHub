# JimBDHub

一个给**双相情感障碍**患者记录情绪、管理药物、追踪睡眠的跨平台应用。数据完全存储在本地，不上传任何云端。

## 功能特性

- **情绪记录** — 记录每日情绪值（-10~10），支持混合期标记，可关联药物服用信息
- **综合曲线图** — 在同一时间轴上展示情绪波动、药效浓度曲线和睡眠条，支持缩放和平移
- **药品库管理** — 管理个人药品库存，包含内置药品数据库，支持按名称/分类/标签快速搜索
- **药效追踪** — 基于药物的半衰期、起效/达峰时间自动计算药效浓度曲线
- **睡眠记录** — 记录入睡/清醒时间、中断情况、睡眠质量评分（0~5）
- **数据备份** — 导出/导入完整数据（含记录、药品、设置），方便迁移
- **国际化** — 内置简体中文和 English 界面，可随时切换
- **个性化主题** — 自定义情绪颜色、曲线连接方式（曲线/直线）、界面配色方案

## 跨平台架构

所有平台共享 `web/` 目录下的同一套前端代码，桌面端和 Android 端仅作为 WebView 外壳提供原生能力（文件对话框等）。

### 目录结构

请参阅[目录结构表](./DirInfo.txt)

## 快速开始

### 开发/运行 Web 端

直接使用任意静态服务器打开 `web/` 目录即可（由于 ES Module 的 CORS 限制，不能直接双击 `index.html`）：

```bash
# Python 内置服务器
cd web && python3 -m http.server 8765

# 或使用 Node.js
npx serve web/
```

浏览器打开 `http://localhost:8765`。

### 运行桌面端

```bash
# 1. 创建虚拟环境
cd desktop
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# 2. 安装依赖
pip install -r requirements.txt

# Linux 额外需要
# sudo pacman -S python-pyqt6 python-pyqt6-webengine  # Arch
# 或使用 GTK 后端：pip install PyGObject + 系统安装 webkit2gtk

# 3. 启动
python main.py
```

### 运行 Android 端

用 Android Studio 打开 `android/` 目录，同步 Gradle 后直接运行。

## 构建与打包

### Windows — 可执行文件 (.exe)

```bash
# 需要安装 Python
Build.bat
# 输出: dist/Microsoft-Windows-amd64.exe

# 如果在 Wine 下交叉打包
Build.bat --wine
```

### GNU/Linux — AppImage

```bash
# 需要安装 Python3、wget
chmod +x Build.sh
./Build.sh
# 输出: dist/GNU-Linux-amd64.AppImage
```

### Android — APK

用 Android Studio 打开 `android/` 目录，选择 `Build > Build Bundle(s) / APK(s) > Build APK(s)`。

## 数据存储

所有数据存储在浏览器 `localStorage` 中（桌面端和 Android 端同样使用 WebView 内置存储）：

| 键名 | 内容 |
|---|---|
| `jimbdhub_mood_records` | 情绪记录 |
| `jimbdhub_medications` | 药品信息 |
| `jimbdhub_med_logs` | 药品变更日志 |
| `jimbdhub_sleep_records` | 睡眠记录 |

建议定期使用 **设置 → 数据备份** 功能导出备份文件。

## 技术栈

| 层面 | 技术 |
|---|---|
| 前端 | 原生 HTML/CSS/JS (ES Modules) |
| 图表 | 原生 SVG 渲染 |
| 数据 | localStorage |
| 桌面端 | Python 3 + pywebview + PyQt6 |
| Android | Kotlin + WebView + WebViewAssetLoader |
| 打包 (Windows) | PyInstaller |
| 打包 (Linux) | AppImage / appimagetool |

## License

本项目基于 GPLv3 协议开源，具体条款见 [LICENSE](LICENSE)。
