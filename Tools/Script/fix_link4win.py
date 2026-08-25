#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fix_link4win.py —— Windows 上自动查找并修正 git 符号链接的检出问题。

git 仓库中的符号链接（索引 mode 120000）在 Windows 上若未开启 core.symlinks，
会被 git 检出为仅包含目标路径文本的普通文件，例如：
    web/contribution            -> 内容 "../contribution"
    web/JimBDHubIcon256.png     -> 内容 "../assets/JimBDHubIcon256.png"
    android/app/src/main/assets/web -> 内容 "../../../../../web"
导致 web 页面 / Android 构建引用的文件或目录失效。

本脚本：
1. 通过 `git ls-files -s -z` 自动列出索引中所有符号链接条目；
2. 用 `git cat-file blob <sha>` 读取每个链接的真实目标路径；
3. 检查工作区对应文件是否仍是“目标路径文本”占位文件；
4. 优先创建真正的符号链接（Windows 需管理员/开发者模式），
   无权限时自动回退为复制目标文件/目录内容。

用法：
    python fix_link4win.py            # 自动查找并修复
    python fix_link4win.py --dry-run  # 仅列出待修复项，不实际修改
"""

import argparse
import os
import shutil
import subprocess
import sys


def repo_root(script_dir):
    """优先用 git 定位仓库根目录，失败时按脚本所在目录回退（Tools/Script）。"""
    try:
        out = subprocess.check_output(
            ['git', 'rev-parse', '--show-toplevel'],
            cwd=script_dir, stderr=subprocess.DEVNULL, text=True
        )
        root = out.strip()
        if root:
            return root
    except (subprocess.CalledProcessError, OSError):
        pass
    return os.path.abspath(os.path.join(script_dir, '..', '..'))


def list_symlink_entries(root):
    """返回 [(工作区相对路径, blob 哈希), ...]，来自 git 索引中 mode 120000 的条目。"""
    entries = []
    try:
        raw = subprocess.check_output(['git', 'ls-files', '-s', '-z'], cwd=root)
    except (subprocess.CalledProcessError, OSError) as err:
        print(f'[错误] 无法读取 git 索引：{err}', file=sys.stderr)
        return entries
    text = raw.decode('utf-8', errors='replace')
    for rec in text.split('\0'):
        if not rec:
            continue
        meta, sep, rel = rec.partition('\t')
        if not sep:
            continue
        fields = meta.split()
        if len(fields) >= 3 and fields[0] == '120000':
            entries.append((rel, fields[1]))
    return entries


def read_link_target(root, blob_sha):
    """读取符号链接 blob 的内容（即链接目标路径）。"""
    try:
        out = subprocess.check_output(['git', 'cat-file', 'blob', blob_sha], cwd=root)
        return out.decode('utf-8', errors='replace').strip()
    except (subprocess.CalledProcessError, OSError):
        return ''


def is_placeholder_file(path, target):
    """判断 path 是否为符号链接被检出后的占位文本文件（内容恰为目标路径）。"""
    try:
        if not os.path.isfile(path):
            return False
        with open(path, 'r', encoding='utf-8', errors='replace') as f:
            return f.read().strip() == target
    except OSError:
        return False


def classify(root, rel, target):
    """检查单个条目是否需要修复，返回 (是否需修复, 说明)。"""
    if not target:
        return False, '无法读取链接目标'
    abs_path = os.path.join(root, rel)
    target_abs = os.path.normpath(os.path.join(os.path.dirname(abs_path), target))
    if not os.path.exists(target_abs):
        return False, f'目标不存在：{target_abs}'
    if os.path.islink(abs_path):
        return False, '已是符号链接'
    if os.path.isdir(abs_path):
        return False, '已是真实目录，保留不动'
    if not is_placeholder_file(abs_path, target):
        return False, '不是占位文件（可能已是修复后的真实文件）'
    return True, ''


def apply_fix(root, rel, target):
    """修复单个占位文件：优先建符号链接，失败则复制目标内容。返回说明。"""
    abs_path = os.path.join(root, rel)
    target_abs = os.path.normpath(os.path.join(os.path.dirname(abs_path), target))
    is_dir = os.path.isdir(target_abs)

    os.makedirs(os.path.dirname(abs_path), exist_ok=True)
    try:
        os.remove(abs_path)  # 占位文件：建链接/复制前都需先移除
    except OSError:
        pass

    # 优先创建真正的符号链接（内容为 git 中的相对目标，git status 保持干净）
    try:
        os.symlink(target, abs_path, target_is_directory=is_dir)
        return '已创建符号链接'
    except (OSError, NotImplementedError):
        pass

    # 无权限创建符号链接时回退为复制目标内容
    try:
        if is_dir:
            shutil.copytree(target_abs, abs_path)
        else:
            shutil.copy2(target_abs, abs_path)
        return '已复制目标内容（无权限创建符号链接，回退复制）'
    except OSError as err:
        return f'修复失败：{err}'


def main():
    parser = argparse.ArgumentParser(description='修复 Windows 上检出的 git 符号链接占位文件')
    parser.add_argument('--dry-run', action='store_true', help='仅列出待修复项，不实际修改')
    args = parser.parse_args()

    root = repo_root(os.path.dirname(os.path.abspath(__file__)))
    entries = list_symlink_entries(root)
    if not entries:
        print('未发现符号链接条目。')
        return

    print(f'仓库根目录：{root}')
    print(f'发现 {len(entries)} 个符号链接条目：\n')

    fixed = 0
    for rel, blob in entries:
        target = read_link_target(root, blob)
        need_fix, why = classify(root, rel, target)
        if not need_fix:
            print(f'[跳过] {rel} -> {target}  ({why})')
            continue
        if args.dry_run:
            print(f'[将修复] {rel} -> {target}')
            continue
        msg = apply_fix(root, rel, target)
        if msg.startswith('已'):
            fixed += 1
        print(f'[已修复] {rel} -> {target}  ({msg})')

    print(f'\n完成：共修复 {fixed} 项。')
    if args.dry_run:
        print('（--dry-run 模式，未做任何修改）')


if __name__ == '__main__':
    main()
