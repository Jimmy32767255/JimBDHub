# -*- mode: python ; coding: utf-8 -*-
# JimBDHub PyInstaller 规格文件

import sys
from pathlib import Path

block_cipher = None

# 项目根目录
root_dir = Path(SPECPATH)
desktop_dir = root_dir / "desktop"
web_dir = root_dir / "web"

# 数据文件：打包整个 web 目录
added_files = [
    (str(web_dir), "web"),
]

# 隐藏导入
hiddenimports = [
    'webview',
    'webview.dom',
    'webview.dom.element',
    'webview.dom.event',
    'qtpy',
    'qtpy.QtCore',
    'qtpy.QtGui',
    'qtpy.QtWidgets',
    'PyQt6',
    'PyQt6.QtCore',
    'PyQt6.QtGui',
    'PyQt6.QtWidgets',
    'PyQt6.QtWebEngineWidgets',
    'PyQt6.QtWebEngineCore',
    'PyQt6.sip',
]

a = Analysis(
    [str(desktop_dir / 'main.py')],
    pathex=[str(root_dir), str(desktop_dir)],
    binaries=[],
    datas=added_files,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    # 排除多余的 Qt 绑定：环境里可能残留 PyQt5，
    # 而 PyInstaller 不允许同时收集 PyQt5 与 PyQt6。
    excludes=[
        'PyQt5',
        'PyQt5.QtCore',
        'PyQt5.QtGui',
        'PyQt5.QtWidgets',
        'PyQt5.QtNetwork',
        'PyQt5.QtWebEngineWidgets',
        'PyQt5.QtWebEngineCore',
        'PyQt5.sip',
        'PyQt5.Qt5',
        'PyQt5_sip',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='Microsoft-Windows-amd64',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='./assets/JimBDHubIconOutput.ico',
    onefile=True,
)
