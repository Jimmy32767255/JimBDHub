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

# 清理不应打进 AppImage 的开发用目录（本地构建时可能存在 venv）
rm -rf \
    "$APPDIR/usr/share/jimbdhub/desktop/venv" \
    "$APPDIR/usr/share/jimbdhub/desktop/venv-wine" \
    "$APPDIR/usr/share/jimbdhub/desktop/venv-wsl" \
    "$APPDIR/usr/share/jimbdhub/desktop/__pycache__"

# 安装 Python 依赖到 AppDir
#
# 重要：必须使用固定目录 + `pip --target`，不能用 `pip --prefix`。
# Debian/Ubuntu 的 Python 默认安装方案是 posix_local，`pip install --prefix=$APPDIR/usr`
# 会把包装进 `$APPDIR/usr/local/lib/pythonX.Y/dist-packages`，而启动脚本却按
# `usr/lib/pythonX.Y/site-packages` 去找，导致 AppImage 在 AppImage 官方测试环境
# （Ubuntu/Debian）里报 `ModuleNotFoundError: No module named 'webview'`。
# `--target` 会无视发行版安装方案差异，稳定地把依赖装到指定目录。
echo "[安装 Python 依赖...]"
SITE_PACKAGES="$APPDIR/usr/lib/jimbdhub-python"
rm -rf "$SITE_PACKAGES"
mkdir -p "$SITE_PACKAGES"
install_deps() {
    python3 -m pip install \
        --target="$SITE_PACKAGES" \
        --upgrade \
        --ignore-installed \
        --no-warn-script-location \
        "$@" \
        -r "$SCRIPT_DIR/desktop/requirements.txt"
}
# Debian/Ubuntu 新版 pip 受 PEP 668 外部管理环境限制，首次可能拒绝安装；
# 仅在安装到 AppDir（--target）时重试，不会污染宿主环境。
if ! install_deps 2>/dev/null; then
    echo "[信息] 首次安装失败，尝试 --break-system-packages（仅安装到 AppDir，不影响系统 Python）"
    install_deps --break-system-packages
fi

# 确保 QtWebEngineProcess 可执行
echo "[确保 QtWebEngineProcess 可执行...]"
find "$SITE_PACKAGES" -name "QtWebEngineProcess" -exec chmod +x {} \; 2>/dev/null || true

# ---------- 打包 Qt xcb 平台插件所需的 X11 运行库 ----------
#
# Qt 6 的 xcb 平台插件依赖一批 X11 / xcb / xkbcommon 库。AppImage 官方测试环境
# （firejail）以及精简的测试容器里往往缺少这些库，启动时会直接报
#   qt.qpa.plugin: Could not load the Qt platform plugin "xcb"
# 然后立刻退出（连窗口都来不及显示），这也是 AppleImage 目录里报
# "not self-contained" 的同一根因。把库一并打包并通过 LD_LIBRARY_PATH 优先加载，
# 才能真正做到自包含。
echo "[收集 xcb 平台插件所需的 X11 运行库...]"
QT_X11_LIBS="$APPDIR/usr/lib/qt-x11"
rm -rf "$QT_X11_LIBS"
mkdir -p "$QT_X11_LIBS"

# 只收 X11 相关库：不打包 glibc / 编译器运行时（不可随包分发），也不打包
# PyQt6 自带的 Qt 库（它们已带 RPATH，重复打包反而有风险）。
X11_LIB_PATTERN='^lib(X11|Xau|Xdmcp|Xext|Xrender|Xfixes|Xi|Xtst|Xcursor|Xrandr|Xshmfence|xcb|X11-xcb|xkbcommon)[.-]'
copy_x11_libs_of() {
    local target="$1"
    [[ -f "$target" ]] || return 0
    ldd "$target" 2>/dev/null \
        | sed -n 's/.*=> \(.*\.so[^ ]*\).*/\1/p' \
        | while read -r lib; do
            [[ -f "$lib" ]] || continue
            local base
            base="$(basename "$lib")"
            [[ "$base" =~ $X11_LIB_PATTERN ]] || continue
            cp -Lf "$lib" "$QT_X11_LIBS/" 2>/dev/null || true
        done
}

# 1) 从 xcb 平台插件的直接依赖开始收集
QXCB_PLUGIN="$SITE_PACKAGES/PyQt6/Qt6/plugins/platforms/libqxcb.so"
copy_x11_libs_of "$QXCB_PLUGIN"

# 2) 迭代补齐间接依赖（如 libqxcb.so -> libxcb-xkb -> libxkbcommon-x11）
for _ in 1 2 3; do
    before="$(ls -1 "$QT_X11_LIBS" | wc -l)"
    while read -r f; do
        copy_x11_libs_of "$f"
    done < <(find "$QT_X11_LIBS" -name '*.so*' -type f)
    after="$(ls -1 "$QT_X11_LIBS" | wc -l)"
    [[ "$before" == "$after" ]] && break
done

# 3) 兜底：部分库由 Qt/Chromium 通过 dlopen 加载，不一定出现在 ldd 结果里
for name in libxkbcommon-x11.so.0 libxkbcommon.so.0 \
            libxcb-cursor.so.0 libxcb-icccm.so.4 libxcb-image.so.0 \
            libxcb-keysyms.so.1 libxcb-randr.so.0 libxcb-render-util.so.0 \
            libxcb-shape.so.0 libxcb-sync.so.1 libxcb-xfixes.so.0 \
            libxcb-xinerama.so.0 libxcb-xkb.so.1 libxcb-util.so.1 \
            libxcb-shm.so.0 libxcb-render.so.0 libxcb-glx.so.0 libxcb.so.1 \
            libX11-xcb.so.1 libX11.so.6 libXau.so.6 libXdmcp.so.6 \
            libxshmfence.so.1; do
    lib_path="$(ldconfig -p 2>/dev/null | awk -v n="$name" '$1 == n { print $NF; exit }')"
    if [[ -n "$lib_path" && -f "$lib_path" ]]; then
        cp -Lf "$lib_path" "$QT_X11_LIBS/" 2>/dev/null || true
    fi
done

echo "[已打包 X11 运行库: $(ls -1 "$QT_X11_LIBS" | wc -l) 个]"

# 复制图标
cp "$SCRIPT_DIR/assets/JimBDHubIcon256.png" "$APPDIR/usr/share/icons/hicolor/256x256/apps/JimBDHubIcon256.png"
cp "$SCRIPT_DIR/assets/JimBDHubIcon256.png" "$APPDIR/usr/share/pixmaps/JimBDHubIcon256.png"

# 在 stdout 打印 QtWebEngine 运行时环境变量片段。
# 参数 $1 为指向 AppDir 根目录的 shell 变量名（例如 APPDIR 或 HERE）。
# 说明：这里用未加引号的 heredoc，是为了让 `\$` 在输出里变成字面量 `$`，
# 从而在生成的启动脚本中引用其自身定义的变量。
make_runtime_env() {
    local root="$1"
    cat << EOF

# 强制使用 PyQt6
export QT_API=pyqt6

# 打包的依赖目录（固定路径，不依赖宿主 Python 版本与发行版安装方案）
SITE_PACKAGES="\$$root/usr/lib/jimbdhub-python"
export PYTHONPATH="\$SITE_PACKAGES:\$$root/usr/share/jimbdhub:\$PYTHONPATH"

# xcb 平台插件所需的 X11 运行库（随包分发，保证在 firejail / 精简环境里也能加载）
export LD_LIBRARY_PATH="\$$root/usr/lib/qt-x11:\$LD_LIBRARY_PATH"

# AppImage 内只打包了 PyQt6（没有 GTK），明确指定 pywebview 使用 Qt 后端，
# 避免它先去尝试导入系统上残缺的 GTK 并打印 "GTK cannot be loaded" 噪音
export PYWEBVIEW_GUI=qt

# QtWebEngineProcess / 资源 / 翻译 / 插件路径
WEBENGINE_PROCESS="\$SITE_PACKAGES/PyQt6/Qt6/libexec/QtWebEngineProcess"
if [[ -x "\$WEBENGINE_PROCESS" ]]; then
    export QTWEBENGINEPROCESS_PATH="\$WEBENGINE_PROCESS"
fi
export QTWEBENGINE_RESOURCES_PATH="\$SITE_PACKAGES/PyQt6/Qt6/resources"
export QTWEBENGINE_LOCALES_PATH="\$SITE_PACKAGES/PyQt6/Qt6/translations/qtwebengine_locales"
export QT_PLUGIN_PATH="\$SITE_PACKAGES/PyQt6/Qt6/plugins:\$QT_PLUGIN_PATH"
export QML2_IMPORT_PATH="\$SITE_PACKAGES/PyQt6/Qt6/qml:\$QML2_IMPORT_PATH"

# AppImage / firejail / root 环境下 Chromium 沙箱常常不可用（无法创建 user namespace
# 或 SUID helper 权限不足），不关闭会直接崩溃；同时禁用 GPU 走软件渲染，
# 避免无 GPU 的测试环境出现黑屏或闪退。
export QTWEBENGINE_DISABLE_SANDBOX=1
export QTWEBENGINE_CHROMIUM_FLAGS="\${QTWEBENGINE_CHROMIUM_FLAGS:-} --no-sandbox --disable-gpu --disable-dev-shm-usage"
EOF
}

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

# 创建启动脚本（位于 usr/bin，向上两级才是 AppDir 根目录）
{
    cat << 'HEADER'
#!/bin/bash
# JimBDHub 启动脚本

HERE="$(dirname "$(readlink -f "${0}")")"
APPDIR="$(dirname "$(dirname "$HERE")")"
HEADER

    make_runtime_env "APPDIR"

    cat << 'FOOTER'

exec python3 "$APPDIR/usr/share/jimbdhub/desktop/main.py" "$@"
FOOTER
} > "$APPDIR/usr/bin/jimbdhub"
chmod +x "$APPDIR/usr/bin/jimbdhub"

# 创建 AppRun 脚本（AppDir 根目录即为 HERE）
{
    cat << 'HEADER'
#!/bin/bash
# AppImage 入口点

SELF=$(readlink -f "$0")
HERE=${SELF%/*}

export PATH="$HERE/usr/bin:$PATH"
HEADER

    make_runtime_env "HERE"

    cat << 'FOOTER'

exec python3 "$HERE/usr/share/jimbdhub/desktop/main.py" "$@"
FOOTER
} > "$APPDIR/AppRun"
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
