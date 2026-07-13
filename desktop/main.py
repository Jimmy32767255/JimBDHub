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
import sys
import threading
import time
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

import webview


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
    """暴露给前端 JS 的桌面端能力（备份导出/导入、Syncthing 同步）。"""

    window = None
    sync_manager = None

    def isDesktop(self):
        return True

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
