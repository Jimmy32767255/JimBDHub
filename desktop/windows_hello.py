"""Windows Hello / Credential Manager 生物认证支持（仅 Windows）。

- 主密码加密存储于 Windows Credential Manager（系统 DPAPI 加密保护），
  通过 advapi32 的 Cred* API（ctypes，标准库，无需额外依赖）。
- 生物认证通过 Windows Hello 的 UserConsentVerifier：
  - 优先使用 winsdk 包（进程内调用，速度快）；
  - 未安装时回退到 PowerShell 脚本调用（依赖系统自带的 .NET WinRT 投影）。
- 非 Windows 平台或未配置 Windows Hello 时，能力检测返回 False，
  需要密码的操作抛出 UnsupportedError（由前端转为提示信息）。
"""

import ctypes
import ctypes.wintypes
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

# Credential Manager 凭据目标名（通用凭据）
CRED_TARGET = "JimBDHub:MasterPassword"
CRED_TYPE_GENERIC = 1
CRED_PERSIST_ENTERPRISE = 2
ERROR_NOT_FOUND = 1168


class UnsupportedError(Exception):
    """当前平台/环境不支持 Windows Hello 生物认证。"""


def _is_windows() -> bool:
    return sys.platform.startswith("win")


# ===== Credential Manager（ctypes 调用 advapi32）=====

class _CREDENTIAL(ctypes.Structure):
    _fields_ = [
        ("Flags", ctypes.wintypes.DWORD),
        ("Type", ctypes.wintypes.DWORD),
        ("TargetName", ctypes.wintypes.LPWSTR),
        ("Comment", ctypes.wintypes.LPWSTR),
        ("LastWritten", ctypes.wintypes.FILETIME),
        ("CredentialBlobSize", ctypes.wintypes.DWORD),
        ("CredentialBlob", ctypes.c_void_p),
        ("Persist", ctypes.wintypes.DWORD),
        ("AttributeCount", ctypes.wintypes.DWORD),
        ("Attributes", ctypes.c_void_p),
        ("TargetAlias", ctypes.wintypes.LPWSTR),
        ("UserName", ctypes.wintypes.LPWSTR),
    ]


_advapi32 = None
if _is_windows():
    _advapi32 = ctypes.WinDLL("advapi32", use_last_error=True)
    _advapi32.CredWriteW.argtypes = [ctypes.POINTER(_CREDENTIAL), ctypes.wintypes.DWORD]
    _advapi32.CredWriteW.restype = ctypes.wintypes.BOOL
    _advapi32.CredReadW.argtypes = [
        ctypes.wintypes.LPCWSTR,
        ctypes.wintypes.DWORD,
        ctypes.wintypes.DWORD,
        ctypes.POINTER(ctypes.c_void_p),
    ]
    _advapi32.CredReadW.restype = ctypes.wintypes.BOOL
    _advapi32.CredDeleteW.argtypes = [ctypes.wintypes.LPCWSTR, ctypes.wintypes.DWORD, ctypes.wintypes.DWORD]
    _advapi32.CredDeleteW.restype = ctypes.wintypes.BOOL
    _advapi32.CredFree.argtypes = [ctypes.c_void_p]
    _advapi32.CredFree.restype = None


def save_password(password: str) -> None:
    """将主密码写入 Windows Credential Manager（DPAPI 加密保护）。"""
    if not _is_windows():
        raise UnsupportedError("仅支持 Windows")
    data = password.encode("utf-16-le")
    blob = (ctypes.c_ubyte * len(data)).from_buffer_copy(data)
    cred = _CREDENTIAL()
    cred.Type = CRED_TYPE_GENERIC
    cred.TargetName = CRED_TARGET
    cred.CredentialBlobSize = len(data)
    cred.CredentialBlob = ctypes.cast(blob, ctypes.c_void_p)
    cred.Persist = CRED_PERSIST_ENTERPRISE
    if not _advapi32.CredWriteW(ctypes.byref(cred), 0):
        raise UnsupportedError(f"写入 Credential Manager 失败（错误码 {ctypes.get_last_error()}）")


def load_password() -> str:
    """从 Windows Credential Manager 读取主密码。"""
    if not _is_windows():
        raise UnsupportedError("仅支持 Windows")
    pcred = ctypes.c_void_p()
    if not _advapi32.CredReadW(CRED_TARGET, CRED_TYPE_GENERIC, 0, ctypes.byref(pcred)):
        raise UnsupportedError("未找到已保存的主密码，请先在设置中重新启用生物认证")
    try:
        cred = ctypes.cast(pcred, ctypes.POINTER(_CREDENTIAL)).contents
        if not cred.CredentialBlob or cred.CredentialBlobSize == 0:
            raise UnsupportedError("主密码数据为空")
        raw = ctypes.string_at(cred.CredentialBlob, cred.CredentialBlobSize)
        return raw.decode("utf-16-le")
    finally:
        _advapi32.CredFree(pcred)


def remove_password() -> None:
    """从 Windows Credential Manager 删除主密码（凭据不存在时视为成功）。"""
    if not _is_windows():
        return
    if not _advapi32.CredDeleteW(CRED_TARGET, CRED_TYPE_GENERIC, 0):
        if ctypes.get_last_error() != ERROR_NOT_FOUND:
            raise UnsupportedError(f"删除 Credential Manager 凭据失败（错误码 {ctypes.get_last_error()}）")


def has_password() -> bool:
    """Credential Manager 中是否已保存主密码。"""
    if not _is_windows():
        return False
    pcred = ctypes.c_void_p()
    try:
        return bool(_advapi32.CredReadW(CRED_TARGET, CRED_TYPE_GENERIC, 0, ctypes.byref(pcred)))
    finally:
        if pcred:
            _advapi32.CredFree(pcred)


# ===== Windows Hello（UserConsentVerifier）=====
# 优先 winsdk（进程内）；回退 PowerShell（系统自带 WinRT 投影，无需额外依赖）。

_PS_TEMPLATE = r"""
param([string]$Message = "", [switch]$Verify)

Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
$null = [Windows.Security.Credentials.UI.UserConsentVerifier, Windows.Security.Credentials.UI, ContentType=WindowsRuntime]

$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and $_.GetParameters().Count -eq 1 } | Select-Object -First 1
if (-not $asTask) { exit 3 }

$op = [Windows.Security.Credentials.UI.UserConsentVerifier]::CheckAvailabilityAsync()
$task = $asTask.MakeGenericMethod([Windows.Security.Credentials.UI.UserConsentVerifierAvailability]).Invoke($null, @($op))
if (-not $task.Wait(15000)) { Write-Output "TIMEOUT"; exit 0 }
[int]$avail = $task.Result
Write-Output ("AVAIL=" + $avail)

if ($Verify -and $avail -eq 0) {
    $vop = [Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync($Message)
    $vtask = $asTask.MakeGenericMethod([Windows.Security.Credentials.UI.UserConsentVerificationResult]).Invoke($null, @($vop))
    if (-not $vtask.Wait(120000)) { Write-Output "TIMEOUT"; exit 0 }
    [int]$verify = $vtask.Result
    Write-Output ("VERIFY=" + $verify)
}
"""

# UserConsentVerifierAvailability：0=Available 1=DeviceNotPresent 2=NotEnrolled 3=DisabledByPolicy 4=DeviceBusy
# UserConsentVerificationResult：0=Verified 1=DeviceBusy 2=RetriesExceeded 3=Canceled 4=Unavailable 5=NotConfigured


def _hello_availability_winsdk() -> bool:
    import asyncio

    from winsdk.security.credentials.ui import (
        UserConsentVerifier,
        UserConsentVerifierAvailability,
    )

    async def _check():
        availability = await UserConsentVerifier.check_availability()
        return availability == UserConsentVerifierAvailability.AVAILABLE

    return asyncio.run(_check())


def _hello_verify_winsdk(message: str) -> bool:
    import asyncio

    from winsdk.security.credentials.ui import UserConsentVerifier, UserConsentVerificationResult

    async def _verify():
        result = await UserConsentVerifier.request_verification(message)
        return result == UserConsentVerificationResult.VERIFIED

    return asyncio.run(_verify())


def _hello_via_powershell(message: str = ""):
    """通过 PowerShell 调用 UserConsentVerifier，返回 {'available': bool, 'verified': bool|None}。"""
    tmp = None
    try:
        with tempfile.NamedTemporaryFile("w", suffix=".ps1", delete=False, encoding="utf-8") as f:
            f.write(_PS_TEMPLATE)
            tmp = f.name
        cmd = ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", tmp]
        if message:
            cmd += ["-Message", message, "-Verify"]
        kwargs = {"capture_output": True, "text": True, "timeout": 130}
        if sys.platform.startswith("win"):
            kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        proc = subprocess.run(cmd, **kwargs)
    except subprocess.TimeoutExpired as e:
        raise UnsupportedError("Windows Hello 认证超时") from e
    except FileNotFoundError as e:
        raise UnsupportedError("未找到 PowerShell") from e
    finally:
        if tmp:
            try:
                Path(tmp).unlink(missing_ok=True)
            except OSError:
                pass

    avail = None
    verified = None
    for line in (proc.stdout or "").splitlines():
        if line.startswith("AVAIL="):
            avail = int(line.split("=", 1)[1])
        elif line.startswith("VERIFY="):
            verified = int(line.split("=", 1)[1])
    if avail is None:
        raise UnsupportedError("Windows Hello 检测失败")
    return {"available": avail == 0, "verified": (verified == 0) if verified is not None else None}


def _hello_availability() -> bool:
    """检测 Windows Hello 是否可用（优先 winsdk，回退 PowerShell）。"""
    try:
        return _hello_availability_winsdk()
    except Exception:
        pass
    try:
        return bool(_hello_via_powershell("")["available"])
    except Exception:
        return False


def _hello_verify(message: str) -> bool:
    """弹出 Windows Hello 认证，返回是否通过。"""
    try:
        return _hello_verify_winsdk(message)
    except Exception:
        pass
    try:
        result = _hello_via_powershell(message)
        return bool(result["verified"])
    except Exception:
        return False


_hello_available = None
_hello_lock = threading.Lock()


def is_available() -> bool:
    """Windows Hello 是否可用（设备支持且已录入生物凭据）；结果按会话缓存。"""
    global _hello_available
    if not _is_windows():
        return False
    with _hello_lock:
        if _hello_available is None:
            _hello_available = _hello_availability()
    return _hello_available


def verify_and_load_password(message: str) -> str:
    """弹出 Windows Hello 认证，成功后返回主密码；失败抛出 UnsupportedError。"""
    if not _is_windows():
        raise UnsupportedError("仅支持 Windows")
    if not is_available():
        raise UnsupportedError("设备不支持 Windows Hello 或未配置生物凭据")
    if not _hello_verify(message):
        raise UnsupportedError("Windows Hello 认证未通过或已取消")
    return load_password()
