#!/usr/bin/env python3
"""JimBDHub 桌面端入口。

使用 pywebview 加载本地前端页面，支持 GNU/Linux 与 Windows。
建议先创建并激活 virtualenv，再安装依赖：

    python -m venv venv
    source venv/bin/activate  # Windows: venv\\Scripts\\activate
    pip install -r requirements.txt
    python main.py

说明：
- 强制使用 PyQt6（避免系统残留的不完整 PyQt5 被 qtpy 选中）。
- 通过本地 HTTP 服务器加载页面，避免 file:// 协议的 ES Module CORS 限制。
"""

import json
import os
import shlex
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from datetime import datetime
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

def resource_path(relative_path):
    """获取资源的绝对路径，支持 PyInstaller 打包后的环境。"""
    try:
        # PyInstaller 会将资源解压到 _MEIPASS 临时目录
        base_path = sys._MEIPASS
    except AttributeError:
        # 开发环境：使用当前文件所在目录
        base_path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base_path, relative_path)


# 强制 qtpy / pywebview 使用 PyQt6，避免系统上残缺的 PyQt5 被优先选中。
os.environ.setdefault("QT_API", "pyqt6")

import argparse


WIDGET_STATE_FILE = "widget_sleep_state.json"
WIDGET_PENDING_FILE = "widget_pending_sleeps.json"
WIDGET_MIN_DURATION_MS = 60_000

# 自动备份：备份文件名前缀，用于识别与数量上限清理
AUTO_BACKUP_PREFIX = "jimbdhub_auto_"


def _list_auto_backups(folder: Path) -> list:
    """列出备份文件夹中按名字倒序（最新在前）的自动备份文件信息。"""
    if not folder.is_dir():
        return []
    backups = []
    for p in folder.glob(f"{AUTO_BACKUP_PREFIX}*.json"):
        try:
            stat = p.stat()
            backups.append(
                {
                    "name": p.name,
                    "size": stat.st_size,
                    "modified": int(stat.st_mtime * 1000),
                }
            )
        except OSError:
            continue
    backups.sort(key=lambda b: b["name"], reverse=True)
    return backups


def widget_data_dir() -> Path:
    return Path.home() / ".JimBDHub"


def load_json_file(path: Path, default):
    if not path.exists():
        return default
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        print(f"读取 {path} 失败: {e}", file=sys.stderr)
        return default


def save_json_file(path: Path, data) -> bool:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        return True
    except Exception as e:
        print(f"写入 {path} 失败: {e}", file=sys.stderr)
        return False


def _is_frozen() -> bool:
    return getattr(sys, "_MEIPASS", None) is not None


def _widget_launch_command() -> list:
    """返回用于切换睡眠计时的启动命令列表。"""
    executable = sys.executable
    if _is_frozen():
        return [executable, "--sleep-log-toggle"]
    script = Path(__file__).resolve()
    return [executable, str(script), "--sleep-log-toggle"]


def _persistent_icon_path():
    """将图标复制到持久化目录并返回路径，便于快捷方式引用。"""
    data_dir = widget_data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)
    dest = data_dir / "JimBDHubIcon256.png"
    if not dest.exists():
        src = Path(resource_path("web/JimBDHubIcon256.png"))
        if src.exists():
            try:
                shutil.copy2(src, dest)
            except Exception as e:
                print(f"复制图标失败: {e}", file=sys.stderr)
                return None
    return dest if dest.exists() else None


def _create_windows_shortcut() -> dict:
    desktop = Path.home() / "Desktop"
    desktop.mkdir(exist_ok=True)
    shortcut_path = desktop / "JimBDHub Sleep.lnk"
    command = _widget_launch_command()
    target = command[0]
    args = " ".join(command[1:])
    workdir = str(Path.home())

    vbs_code = """Set WshShell = WScript.CreateObject("WScript.Shell")
Set Shortcut = WshShell.CreateShortcut(WScript.Arguments(0))
Shortcut.TargetPath = WScript.Arguments(1)
Shortcut.Arguments = WScript.Arguments(2)
Shortcut.WorkingDirectory = WScript.Arguments(3)
Shortcut.Save
"""
    vbs_path = ""
    try:
        with tempfile.NamedTemporaryFile("w", suffix=".vbs", delete=False, encoding="utf-8") as f:
            f.write(vbs_code)
            vbs_path = f.name
        subprocess.run(
            ["cscript", "//Nologo", vbs_path, str(shortcut_path), target, args, workdir],
            check=True,
            capture_output=True,
            text=True,
        )
        return {"ok": True, "path": str(shortcut_path)}
    except Exception as e:
        return {"ok": False, "error": f"创建快捷方式失败: {e}"}
    finally:
        if vbs_path:
            try:
                Path(vbs_path).unlink(missing_ok=True)
            except Exception:
                pass


def _create_linux_desktop_entry() -> dict:
    desktop = Path.home() / "Desktop"
    desktop.mkdir(exist_ok=True)
    desktop_file = desktop / "JimBDHub-Sleep.desktop"
    command = _widget_launch_command()
    exec_line = " ".join(shlex.quote(arg) for arg in command)
    icon = _persistent_icon_path()
    icon_line = f"Icon={icon}" if icon else ""

    content = f"""[Desktop Entry]
Name=JimBDHub Sleep
Comment=一键记录睡眠
Exec={exec_line}
Type=Application
Terminal=false
{icon_line}
Categories=Utility;
""".strip() + "\n"
    try:
        desktop_file.write_text(content, encoding="utf-8")
        desktop_file.chmod(0o755)
        return {"ok": True, "path": str(desktop_file)}
    except Exception as e:
        return {"ok": False, "error": f"创建 .desktop 失败: {e}"}


def add_widget_shortcut() -> dict:
    """在 Windows 创建 .lnk，在 GNU/Linux 创建 .desktop 快捷方式。"""
    if sys.platform.startswith("win"):
        return _create_windows_shortcut()
    if sys.platform.startswith("linux"):
        return _create_linux_desktop_entry()
    return {"ok": False, "error": "不支持的操作系统"}


def handle_sleep_toggle() -> bool:
    """处理 --sleep-log-toggle：双态切换睡眠计时，不启动 GUI。"""
    data_dir = widget_data_dir()
    state_path = data_dir / WIDGET_STATE_FILE
    pending_path = data_dir / WIDGET_PENDING_FILE

    state = load_json_file(state_path, {})
    now = int(time.time() * 1000)
    active_start = state.get("active_start_ms", 0)

    if active_start:
        end_ms = max(now, active_start + WIDGET_MIN_DURATION_MS)
        records = load_json_file(pending_path, [])
        records.append({"startMs": active_start, "endMs": end_ms})
        if save_json_file(pending_path, records) and save_json_file(state_path, {}):
            duration_min = (end_ms - active_start) // 60_000
            print(f"已记录睡眠：{duration_min} 分钟")
            return True
        return False
    else:
        if save_json_file(state_path, {"active_start_ms": now}):
            print("睡眠计时已开始")
            return True
        return False


parser = argparse.ArgumentParser(description="JimBDHub 桌面端")
parser.add_argument(
    "--sleep-log-toggle",
    action="store_true",
    dest="sleep_log_toggle",
    help="切换睡眠计时（不启动 GUI，适合桌面快捷方式）",
)
args, _ = parser.parse_known_args()

if args.sleep_log_toggle:
    sys.exit(0 if handle_sleep_toggle() else 1)

import webview


def inject_pending_sleeps(window):
    """将待同步的睡眠记录注入前端 store。"""
    pending_path = widget_data_dir() / WIDGET_PENDING_FILE
    records = load_json_file(pending_path, [])
    if not records:
        return
    for record in records:
        js = f"""
        (function() {{
            if (typeof window.__widgetAddSleep === 'function') {{
                window.__widgetAddSleep({{
                    startTime: {record['startMs']},
                    endTime: {record['endMs']},
                    quality: 0,
                    interruptions: [],
                    note: "Widget"
                }});
            }}
        }})();
        """
        try:
            window.evaluate_js(js)
        except Exception as e:
            print(f"注入睡眠记录失败: {e}", file=sys.stderr)
            return
    try:
        pending_path.unlink(missing_ok=True)
    except Exception as e:
        print(f"清理待同步记录失败: {e}", file=sys.stderr)


def get_web_root() -> Path:
    return Path(resource_path("web"))


def start_http_server(root: Path, port: int = 8765) -> HTTPServer:
    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(root), **kwargs)

        def log_message(self, format, *args):
            # 静默内置 server 的访问日志
            pass

    server = HTTPServer(("127.0.0.1", port), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


class SyncManager:
    """轮询同步文件并在变更时通知前端。"""

    def __init__(self, window, sync_path: Path):
        self.window = window
        self.sync_path = sync_path
        self.last_mtime = 0.0
        self.running = False
        self.thread = None
        self.interval = 2.0

    def start(self):
        if self.running:
            return
        self.running = True
        self.sync_path.parent.mkdir(parents=True, exist_ok=True)
        if self.sync_path.exists():
            self.last_mtime = self.sync_path.stat().st_mtime
        self.thread = threading.Thread(target=self._poll, daemon=True)
        self.thread.start()

    def stop(self):
        self.running = False

    def _poll(self):
        while self.running:
            try:
                if self.sync_path.exists():
                    mtime = self.sync_path.stat().st_mtime
                    if mtime > self.last_mtime + 0.001:
                        self.last_mtime = mtime
                        self._notify()
            except Exception as e:
                print(f"同步文件轮询失败: {e}", file=sys.stderr)
            time.sleep(self.interval)

    def _notify(self):
        try:
            with open(self.sync_path, "r", encoding="utf-8") as f:
                text = f.read()
            js = f"if (window.__syncthingCallback) window.__syncthingCallback({json.dumps(text)});"
            self.window.evaluate_js(js)
        except Exception as e:
            print(f"通知前端同步变更失败: {e}", file=sys.stderr)

    def write(self, json_string: str) -> bool:
        try:
            self.sync_path.parent.mkdir(parents=True, exist_ok=True)
            with open(self.sync_path, "w", encoding="utf-8") as f:
                f.write(json_string)
            self.last_mtime = self.sync_path.stat().st_mtime
            return True
        except Exception as e:
            print(f"写入同步文件失败: {e}", file=sys.stderr)
            return False


class DesktopBridge:
    """暴露给前端 JS 的桌面端能力（备份导出/导入、Syncthing 同步、小部件）。"""

    window = None
    sync_manager = None

    def isDesktop(self):
        return True

    def onWidgetReady(self):
        """前端 store 就绪后调用，同步通过快捷方式产生的睡眠记录。"""
        if self.window:
            inject_pending_sleeps(self.window)

    def addWidgetShortcut(self):
        """在桌面创建一键睡眠记录的快捷方式。"""
        return add_widget_shortcut()

    def _default_sync_path(self) -> Path:
        return Path.home() / ".JimBDHub" / "sync" / "JimBDHub.sync.json"

    def enableSync(self, path: str = None):
        if self.sync_manager:
            self.sync_manager.stop()
        sync_path = Path(path) if path else self._default_sync_path()
        self.sync_manager = SyncManager(self.window, sync_path)
        self.sync_manager.start()
        content = None
        if sync_path.exists():
            try:
                with open(sync_path, "r", encoding="utf-8") as f:
                    content = f.read()
            except Exception as e:
                print(f"读取已有同步文件失败: {e}", file=sys.stderr)
        return {"ok": True, "path": str(sync_path), "content": content}

    def disableSync(self):
        if self.sync_manager:
            self.sync_manager.stop()
            self.sync_manager = None
        return True

    def writeSyncFile(self, json_string: str):
        if not self.sync_manager:
            return {"ok": False, "error": "Sync not enabled"}
        ok = self.sync_manager.write(json_string)
        return {"ok": ok}

    def saveBackup(self, json_string: str, file_name: str):
        if not self.window:
            return False
        try:
            result = self.window.create_file_dialog(
                dialog_type=webview.SAVE_DIALOG,
                directory=str(Path.home()),
                save_filename=file_name,
                file_types=("JSON files (*.json)",),
            )
            if not result:
                return False
            path = result[0] if isinstance(result, (list, tuple)) else result
            if not path:
                return False
            with open(path, "w", encoding="utf-8") as f:
                f.write(json_string)
            return True
        except Exception as e:
            print(f"保存备份失败: {e}", file=sys.stderr)
            return False

    def getSystemTheme(self):
        """从系统调色板获取强调色与背景色，获取失败时返回 None。"""
        try:
            from PyQt6.QtGui import QGuiApplication, QPalette

            app = QGuiApplication.instance()
            if app is None:
                return None
            palette = app.palette()
            accent = palette.color(QPalette.ColorRole.Highlight)
            background = palette.color(QPalette.ColorRole.Window)
            result = {}
            if accent.isValid():
                result["accentColor"] = accent.name()
            if background.isValid():
                result["backgroundColor"] = background.name()
            return result or None
        except Exception as e:
            print(f"获取系统主题失败: {e}", file=sys.stderr)
            return None

    def pickBackup(self):
        if not self.window:
            return None
        try:
            result = self.window.create_file_dialog(
                dialog_type=webview.OPEN_DIALOG,
                directory=str(Path.home()),
                allow_multiple=False,
                file_types=("JSON files (*.json)",),
            )
            if not result:
                return None
            path = result[0] if isinstance(result, (list, tuple)) else result
            if not path:
                return None
            with open(path, "r", encoding="utf-8") as f:
                return f.read()
        except Exception as e:
            print(f"选择备份失败: {e}", file=sys.stderr)
            return None

    def chooseBackupFolder(self):
        """弹出文件夹选择框，返回用户选定的自动备份目录。"""
        if not self.window:
            return {"ok": False, "error": "window not ready"}
        try:
            result = self.window.create_file_dialog(
                dialog_type=webview.FOLDER_DIALOG,
                directory=str(Path.home()),
            )
            if not result:
                return {"ok": False, "cancelled": True}
            path = result[0] if isinstance(result, (list, tuple)) else result
            if not path:
                return {"ok": False, "cancelled": True}
            return {"ok": True, "path": str(path)}
        except Exception as e:
            print(f"选择备份文件夹失败: {e}", file=sys.stderr)
            return {"ok": False, "error": str(e)}

    def listAutoBackups(self, folder_path: str):
        folder = Path(folder_path)
        return {"ok": True, "backups": _list_auto_backups(folder)}

    def writeAutoBackup(self, folder_path: str, json_string: str, max_count: int = 10):
        """写入自动备份文件，并按数量上限删除最旧的备份。"""
        try:
            folder = Path(folder_path)
            folder.mkdir(parents=True, exist_ok=True)
            name = f"{AUTO_BACKUP_PREFIX}{datetime.now().strftime('%Y%m%d_%H%M%S_%f')[:-3]}.json"
            (folder / name).write_text(json_string, encoding="utf-8")
            trimmed = []
            limit = max(1, int(max_count))
            backups = sorted(_list_auto_backups(folder), key=lambda b: b["name"])
            over = len(backups) - limit
            for b in backups[:over]:
                try:
                    (folder / b["name"]).unlink()
                    trimmed.append(b["name"])
                except OSError:
                    continue
            return {"ok": True, "name": name, "trimmed": trimmed}
        except Exception as e:
            print(f"写入自动备份失败: {e}", file=sys.stderr)
            return {"ok": False, "error": str(e)}

    def readAutoBackup(self, folder_path: str, file_name: str):
        try:
            # 只取文件名部分，防止目录穿越
            path = Path(folder_path) / Path(file_name).name
            if not path.is_file():
                return {"ok": False, "error": "备份文件不存在"}
            return {"ok": True, "content": path.read_text(encoding="utf-8")}
        except Exception as e:
            print(f"读取自动备份失败: {e}", file=sys.stderr)
            return {"ok": False, "error": str(e)}

    def deleteAutoBackup(self, folder_path: str, file_name: str):
        try:
            path = Path(folder_path) / Path(file_name).name
            if path.exists():
                path.unlink()
            return {"ok": True}
        except Exception as e:
            print(f"删除自动备份失败: {e}", file=sys.stderr)
            return {"ok": False, "error": str(e)}


def main() -> None:
    web_root = get_web_root()
    if not web_root.exists():
        print(f"找不到前端页面目录: {web_root}", file=sys.stderr)
        sys.exit(1)

    server = start_http_server(web_root)
    port = server.server_address[1]
    url = f"http://127.0.0.1:{port}/index.html"

    bridge = DesktopBridge()
    window = webview.create_window(
        title="JimBDHub",
        url=url,
        width=1200,
        height=800,
        min_size=(800, 600),
        text_select=True,
        js_api=bridge,
    )
    bridge.window = window
    webview.start(
        debug=False,
        private_mode=False,
        storage_path=str(Path.home() / ".JimBDHub"),
    )


if __name__ == "__main__":
    main()
