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

import os
import sys
import threading
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

# 强制 qtpy / pywebview 使用 PyQt6，避免系统上残缺的 PyQt5 被优先选中。
os.environ.setdefault("QT_API", "pyqt6")

import webview


def get_web_root() -> Path:
    return Path(__file__).resolve().parent.parent / "web"


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


class DesktopBridge:
    """暴露给前端 JS 的桌面端能力（备份导出/导入）。"""

    window = None

    def isDesktop(self):
        return True

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
    webview.start(debug=False)


if __name__ == "__main__":
    main()
