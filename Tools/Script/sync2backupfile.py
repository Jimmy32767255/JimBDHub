#!/usr/bin/env python3
"""将 JimBDHub 同步文件（JimBDHub.sync.json）转换为可导入的备份文件。

同步文件内容为完整备份 JSON 外加一个 syncedAt 时间戳，
本脚本去掉 syncedAt、刷新 exportedAt 后输出为备份文件。

用法：
    python3 sync2backupfile.py [同步文件路径] [输出目录]

默认同步文件：~/.JimBDHub/sync/JimBDHub.sync.json
默认输出目录：当前目录
"""

import json
import sys
from datetime import datetime
from pathlib import Path


def validate_backup(data):
    """与 web/js/store.js 的 validateBackup 保持一致。"""
    if not isinstance(data, dict):
        return False
    if not isinstance(data.get("records"), list):
        return False
    if not isinstance(data.get("meds"), list):
        return False
    if not isinstance(data.get("logs"), list):
        return False
    for key in ("sleeps", "events", "medHistory"):
        if key in data and not isinstance(data[key], list):
            return False
    if "language" in data and not isinstance(data["language"], str):
        return False
    if "theme" in data and not isinstance(data["theme"], dict):
        return False
    return True


def main():
    sync_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / ".JimBDHub" / "sync" / "JimBDHub.sync.json"
    out_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else Path.cwd()

    if not sync_path.is_file():
        print(f"错误：找不到同步文件 {sync_path}")
        return 1

    try:
        data = json.loads(sync_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as err:
        print(f"错误：无法读取同步文件：{err}")
        return 1

    if not validate_backup(data):
        print("错误：同步文件不是有效的 JimBDHub 备份数据")
        return 1

    # syncedAt 是同步文件专属字段，不属于备份格式；exportedAt 刷新为当前时间
    data.pop("syncedAt", None)
    data["exportedAt"] = datetime.now().astimezone().isoformat(timespec="seconds")

    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_path = out_dir / f"jimbdhub_backup_{stamp}.json"
    out_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"已生成备份文件：{out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
