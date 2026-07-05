#!/usr/bin/env python3
"""JimBDHub 桌面端入口。

使用 pywebview 加载本地前端页面，支持 GNU/Linux 与 Windows。
建议先创建并激活 virtualenv，再安装依赖：

    python -m venv venv
    source venv/bin/activate  # Windows: venv\\Scripts\\activate
    pip install -r requirements.txt
    python main.py
"""

import os
import sys
import webview


def get_index_path() -> str:
    script_dir = os.path.dirname(os.path.abspath(__file__))
    index_path = os.path.join(script_dir, "..", "web", "index.html")
    return os.path.abspath(index_path)


def main() -> None:
    index_path = get_index_path()
    if not os.path.exists(index_path):
        print(f"找不到前端页面: {index_path}", file=sys.stderr)
        sys.exit(1)

    webview.create_window(
        title="JimBDHub",
        url=f"file://{index_path}",
        width=1200,
        height=800,
        min_size=(800, 600),
        text_select=True,
    )
    webview.start(debug=False)


if __name__ == "__main__":
    main()
