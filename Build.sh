#!/bin/bash

# JimBDHub AppImage 构建脚本 (使用 appimagetool)
# 用法: ./Build.sh

set -e

echo "=========================================="
echo "JimBDHub AppImage 构建工具 (appimagetool)"
echo "=========================================="

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# 创建构建目录
BUILD_DIR="$SCRIPT_DIR/build-appimage"
mkdir -p "$BUILD_DIR"
cd "$BUILD_DIR"

# 检查依赖
echo "[检查依赖...]"

# 检查 appimagetool
if [[ ! -f "appimagetool-x86_64.AppImage" ]]; then
    echo "[下载 appimagetool...]"
    wget -q "https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-x86_64.AppImage"
    chmod +x appimagetool-x86_64.AppImage
fi

# 检查 runtime
if [[ ! -f "runtime-x86_64" ]]; then
    echo "[下载 AppImage runtime...]"
    wget -q "https://github.com/AppImage/type2-runtime/releases/download/continuous/runtime-x86_64"
fi

# 检查 Python 是否安装
if ! command -v python3 &> /dev/null; then
    echo "[错误] 未检测到 Python3，请先安装 Python3"
    exit 1
fi

echo "[依赖检查完成]"

# 创建 AppDir 结构
echo "[创建 AppDir 结构...]"
APPDIR="$BUILD_DIR/AppDir"
rm -rf "$APPDIR"
mkdir -p "$APPDIR/usr/share/jimbdhub"
mkdir -p "$APPDIR/usr/bin"
mkdir -p "$APPDIR/usr/share/applications"
mkdir -p "$APPDIR/usr/share/icons/hicolor/256x256/apps"
mkdir -p "$APPDIR/usr/share/pixmaps"
mkdir -p "$APPDIR/usr/lib"

# 复制程序文件
echo "[复制程序文件...]"
cp -r "$SCRIPT_DIR/desktop" "$APPDIR/usr/share/jimbdhub/"
cp -r "$SCRIPT_DIR/web" "$APPDIR/usr/share/jimbdhub/"

# 安装 Python 依赖到 AppDir
echo "[安装 Python 依赖...]"
pip3 install --prefix="$APPDIR/usr" --ignore-installed -r "$SCRIPT_DIR/desktop/requirements.txt"

# 确保 QtWebEngineProcess 可执行
echo "[确保 QtWebEngineProcess 可执行...]"
find "$APPDIR/usr" -name "QtWebEngineProcess" -exec chmod +x {} \; 2>/dev/null || true

# 复制图标
cp "$SCRIPT_DIR/assets/JimBDHubIcon256.png" "$APPDIR/usr/share/icons/hicolor/256x256/apps/JimBDHubIcon256.png"
cp "$SCRIPT_DIR/assets/JimBDHubIcon256.png" "$APPDIR/usr/share/pixmaps/JimBDHubIcon256.png"

# 创建桌面文件
cat > "$APPDIR/usr/share/applications/jimbdhub.desktop" << 'EOF'
[Desktop Entry]
Name=JimBDHub
Comment=一个给双相情感障碍患者记录情绪变化的软件
Exec=jimbdhub
Icon=JimBDHubIcon256
Terminal=false
Type=Application
Categories=Utility
StartupNotify=true
EOF

# 创建启动脚本
cat > "$APPDIR/usr/bin/jimbdhub" << 'EOF'
#!/bin/bash
# JimBDHub 启动脚本

HERE="$(dirname "$(readlink -f "${0}")")"
APPDIR="$(dirname "$(dirname "$HERE")")"

# 强制使用 PyQt6
export QT_API=pyqt6

# 查找 Python site-packages 目录
PYTHON_VERSION=$(python3 -c 'import sys; print(f"python{sys.version_info.major}.{sys.version_info.minor}")')
export PYTHONPATH="$APPDIR/usr/share/jimbdhub:$APPDIR/usr/lib/$PYTHON_VERSION/site-packages:$PYTHONPATH"

# 查找并设置 QtWebEngineProcess 路径
WEBENGINE_PROCESS=$(find "$APPDIR/usr/lib/$PYTHON_VERSION/site-packages" -name "QtWebEngineProcess" -type f 2>/dev/null | head -1)
if [[ -n "$WEBENGINE_PROCESS" ]]; then
    chmod +x "$WEBENGINE_PROCESS" 2>/dev/null || true
    export QTWEBENGINEPROCESS_PATH="$WEBENGINE_PROCESS"
fi

exec python3 "$APPDIR/usr/share/jimbdhub/desktop/main.py" "$@"
EOF
chmod +x "$APPDIR/usr/bin/jimbdhub"

# 创建 AppRun 脚本
cat > "$APPDIR/AppRun" << 'EOF'
#!/bin/bash
# AppImage 入口点

# 获取 AppDir 路径
SELF=$(readlink -f "$0")
HERE=${SELF%/*}

# 强制使用 PyQt6
export QT_API=pyqt6

# 设置环境变量
export PATH="$HERE/usr/bin:$PATH"

# 查找 Python site-packages 目录
PYTHON_VERSION=$(python3 -c 'import sys; print(f"python{sys.version_info.major}.{sys.version_info.minor}")')
export PYTHONPATH="$HERE/usr/share/jimbdhub:$HERE/usr/lib/$PYTHON_VERSION/site-packages:$PYTHONPATH"

# 查找并设置 QtWebEngineProcess 路径
WEBENGINE_PROCESS=$(find "$HERE/usr/lib/$PYTHON_VERSION/site-packages" -name "QtWebEngineProcess" -type f 2>/dev/null | head -1)
if [[ -n "$WEBENGINE_PROCESS" ]]; then
    chmod +x "$WEBENGINE_PROCESS" 2>/dev/null || true
    export QTWEBENGINEPROCESS_PATH="$WEBENGINE_PROCESS"
fi

# 启动程序
exec python3 "$HERE/usr/share/jimbdhub/desktop/main.py" "$@"
EOF
chmod +x "$APPDIR/AppRun"

# 复制 .desktop 到根目录
cp "$APPDIR/usr/share/applications/jimbdhub.desktop" "$APPDIR/jimbdhub.desktop"

# 复制图标到根目录
cp "$APPDIR/usr/share/icons/hicolor/256x256/apps/JimBDHubIcon256.png" "$APPDIR/JimBDHubIcon256.png"

# 使用 appimagetool 打包
echo "[使用 appimagetool 打包...]"
ARCH=x86_64 APPIMAGELAUNCHER_DISABLE=1 ./appimagetool-x86_64.AppImage "$APPDIR" --runtime-file runtime-x86_64

# 检查并提示
cd "$SCRIPT_DIR"
if [[ -f "$BUILD_DIR/JimBDHub-x86_64.AppImage" ]]; then
    mkdir -p "$SCRIPT_DIR/dist"
    mv "$BUILD_DIR/JimBDHub-x86_64.AppImage" "$SCRIPT_DIR/dist/GNU-Linux-amd64.AppImage"
    echo ""
    echo "=========================================="
    echo "构建成功!"
    echo "输出文件: $SCRIPT_DIR/dist/GNU-Linux-amd64.AppImage"
    echo "=========================================="
else
    echo "[错误] 构建失败，未找到输出文件"
    exit 1
fi
