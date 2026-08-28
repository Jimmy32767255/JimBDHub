#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""jimbdhub_crypt.py —— 不开软件，直接加密/解密 JimBDHub 备份与同步文件。

加密算法与 web/js/store.js 完全一致：
  - 密钥：PBKDF2-HMAC-SHA256，固定应用级盐 b"jimbdhub-file-salt-v1"，
    迭代 600000 次，派生 256 位 AES-GCM 密钥；
  - 加密：AES-256-GCM，随机 12 字节 IV，128 位认证标签；
  - 加密信封（自描述，写入 .json/.enc 文件的内容）：
        {"magic": "jimbdhub-encrypted-v1", "iv": "<base64>", "ciphertext": "<base64>"}

因此：
  - 本脚本加密出的文件可直接被软件导入（需创建备份时的主密码）；
  - 软件导出的加密备份（jimbdhub_backup_*.json）与加密同步文件
    （JimBDHub.sync.json）均可用本脚本解密。

用法：
    python jimbdhub_crypt.py -e 备份文件.json [更多文件...]   # 批量加密
    python jimbdhub_crypt.py -d 备份文件.json.enc             # 解密
    python jimbdhub_crypt.py -i                               # 交互模式
    python jimbdhub_crypt.py                                  # 无参数进入交互模式

说明：
  - 支持批处理：可传多个文件路径，也可传目录
    （加密处理目录下 *.json；解密处理目录下 *.json 与 *.enc）。
  - 加密输出为 <文件名>.enc；解密输出去掉 .enc，其余输出为
    <文件名>.decrypted<扩展名>，绝不覆盖源文件。
  - 密码不指定时安全提示输入（不显示）；批处理多个文件只询问一次。
  - 优先使用 cryptography 库；未安装时回退到内置纯 Python AES-GCM 实现。
"""

import argparse
import base64
import getpass
import hashlib
import json
import os
import shlex
import sys
from pathlib import Path

# ===== 文件加密参数（与 web/js/store.js 保持一致）=====
FILE_ENC_SALT = b"jimbdhub-file-salt-v1"  # JS 侧 new TextEncoder().encode('jimbdhub-file-salt-v1')
FILE_ENC_MAGIC = "jimbdhub-encrypted-v1"
PBKDF2_ITERATIONS = 600000
PBKDF2_HASH = "sha256"

try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM as _LibAESGCM
    HAVE_LIB_CRYPTO = True
except ImportError:
    HAVE_LIB_CRYPTO = False


# ===== 纯 Python AES 块密码（未安装 cryptography 时的回退实现）=====
_SBOX = (
    0x63, 0x7C, 0x77, 0x7B, 0xF2, 0x6B, 0x6F, 0xC5, 0x30, 0x01, 0x67, 0x2B, 0xFE, 0xD7, 0xAB, 0x76,
    0xCA, 0x82, 0xC9, 0x7D, 0xFA, 0x59, 0x47, 0xF0, 0xAD, 0xD4, 0xA2, 0xAF, 0x9C, 0xA4, 0x72, 0xC0,
    0xB7, 0xFD, 0x93, 0x26, 0x36, 0x3F, 0xF7, 0xCC, 0x34, 0xA5, 0xE5, 0xF1, 0x71, 0xD8, 0x31, 0x15,
    0x04, 0xC7, 0x23, 0xC3, 0x18, 0x96, 0x05, 0x9A, 0x07, 0x12, 0x80, 0xE2, 0xEB, 0x27, 0xB2, 0x75,
    0x09, 0x83, 0x2C, 0x1A, 0x1B, 0x6E, 0x5A, 0xA0, 0x52, 0x3B, 0xD6, 0xB3, 0x29, 0xE3, 0x2F, 0x84,
    0x53, 0xD1, 0x00, 0xED, 0x20, 0xFC, 0xB1, 0x5B, 0x6A, 0xCB, 0xBE, 0x39, 0x4A, 0x4C, 0x58, 0xCF,
    0xD0, 0xEF, 0xAA, 0xFB, 0x43, 0x4D, 0x33, 0x85, 0x45, 0xF9, 0x02, 0x7F, 0x50, 0x3C, 0x9F, 0xA8,
    0x51, 0xA3, 0x40, 0x8F, 0x92, 0x9D, 0x38, 0xF5, 0xBC, 0xB6, 0xDA, 0x21, 0x10, 0xFF, 0xF3, 0xD2,
    0xCD, 0x0C, 0x13, 0xEC, 0x5F, 0x97, 0x44, 0x17, 0xC4, 0xA7, 0x7E, 0x3D, 0x64, 0x5D, 0x19, 0x73,
    0x60, 0x81, 0x4F, 0xDC, 0x22, 0x2A, 0x90, 0x88, 0x46, 0xEE, 0xB8, 0x14, 0xDE, 0x5E, 0x0B, 0xDB,
    0xE0, 0x32, 0x3A, 0x0A, 0x49, 0x06, 0x24, 0x5C, 0xC2, 0xD3, 0xAC, 0x62, 0x91, 0x95, 0xE4, 0x79,
    0xE7, 0xC8, 0x37, 0x6D, 0x8D, 0xD5, 0x4E, 0xA9, 0x6C, 0x56, 0xF4, 0xEA, 0x65, 0x7A, 0xAE, 0x08,
    0xBA, 0x78, 0x25, 0x2E, 0x1C, 0xA6, 0xB4, 0xC6, 0xE8, 0xDD, 0x74, 0x1F, 0x4B, 0xBD, 0x8B, 0x8A,
    0x70, 0x3E, 0xB5, 0x66, 0x48, 0x03, 0xF6, 0x0E, 0x61, 0x35, 0x57, 0xB9, 0x86, 0xC1, 0x1D, 0x9E,
    0xE1, 0xF8, 0x98, 0x11, 0x69, 0xD9, 0x8E, 0x94, 0x9B, 0x1E, 0x87, 0xE9, 0xCE, 0x55, 0x28, 0xDF,
    0x8C, 0xA1, 0x89, 0x0D, 0xBF, 0xE6, 0x42, 0x68, 0x41, 0x99, 0x2D, 0x0F, 0xB0, 0x54, 0xBB, 0x16,
)
_INV_SBOX = [0] * 256
for _i in range(256):
    _INV_SBOX[_SBOX[_i]] = _i


def _gf_mul(a, b):
    """GF(2^8) 乘法，不可约多项式 0x11B。"""
    p = 0
    while b:
        if b & 1:
            p ^= a
        hi = a & 0x80
        a = (a << 1) & 0xFF
        if hi:
            a ^= 0x1B
        b >>= 1
    return p


_M2 = tuple(_gf_mul(2, x) for x in range(256))
_M3 = tuple(_gf_mul(3, x) for x in range(256))
_M9 = tuple(_gf_mul(9, x) for x in range(256))
_M11 = tuple(_gf_mul(11, x) for x in range(256))
_M13 = tuple(_gf_mul(13, x) for x in range(256))
_M14 = tuple(_gf_mul(14, x) for x in range(256))

_RCON = (0x00, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1B, 0x36)


def _sub_word(word):
    return bytes(_SBOX[b] for b in word)


def _rot_word(word):
    return word[1:] + word[:1]


def _expand_key(key):
    nk = len(key) // 4
    nr = nk + 6
    words = [key[i * 4:(i + 1) * 4] for i in range(nk)]
    for i in range(nk, 4 * (nr + 1)):
        temp = words[i - 1]
        if i % nk == 0:
            temp = _sub_word(_rot_word(temp))
            temp = bytes((temp[0] ^ _RCON[i // nk], temp[1], temp[2], temp[3]))
        elif nk > 6 and i % nk == 4:
            temp = _sub_word(temp)
        words.append(bytes(a ^ b for a, b in zip(words[i - nk], temp)))
    return b"".join(words)


def _add_round_key(state, rk, rnd):
    for i in range(16):
        state[i] ^= rk[rnd * 16 + i]


def _sub_bytes(state):
    for i in range(16):
        state[i] = _SBOX[state[i]]


def _inv_sub_bytes(state):
    for i in range(16):
        state[i] = _INV_SBOX[state[i]]


def _shift_rows(state):
    # state 为列主序：state[4*c+r] 是第 r 行第 c 列；行 r 循环左移 r 位
    for r in (1, 2, 3):
        row = [state[r + 4 * c] for c in range(4)]
        row = row[r:] + row[:r]
        for c in range(4):
            state[r + 4 * c] = row[c]


def _inv_shift_rows(state):
    for r in (1, 2, 3):
        row = [state[r + 4 * c] for c in range(4)]
        row = row[-r:] + row[:-r]
        for c in range(4):
            state[r + 4 * c] = row[c]


def _mix_columns(state):
    for c in range(4):
        a0, a1, a2, a3 = state[4 * c:4 * c + 4]
        state[4 * c] = _M2[a0] ^ _M3[a1] ^ a2 ^ a3
        state[4 * c + 1] = a0 ^ _M2[a1] ^ _M3[a2] ^ a3
        state[4 * c + 2] = a0 ^ a1 ^ _M2[a2] ^ _M3[a3]
        state[4 * c + 3] = _M3[a0] ^ a1 ^ a2 ^ _M2[a3]


def _inv_mix_columns(state):
    for c in range(4):
        a0, a1, a2, a3 = state[4 * c:4 * c + 4]
        state[4 * c] = _M14[a0] ^ _M11[a1] ^ _M13[a2] ^ _M9[a3]
        state[4 * c + 1] = _M9[a0] ^ _M14[a1] ^ _M11[a2] ^ _M13[a3]
        state[4 * c + 2] = _M13[a0] ^ _M9[a1] ^ _M14[a2] ^ _M11[a3]
        state[4 * c + 3] = _M11[a0] ^ _M13[a1] ^ _M9[a2] ^ _M14[a3]


def _aes_encrypt_block(key, block):
    nk = len(key) // 4
    nr = nk + 6
    rk = _expand_key(key)
    state = bytearray(block)
    _add_round_key(state, rk, 0)
    for rnd in range(1, nr):
        _sub_bytes(state)
        _shift_rows(state)
        _mix_columns(state)
        _add_round_key(state, rk, rnd)
    _sub_bytes(state)
    _shift_rows(state)
    _add_round_key(state, rk, nr)
    return bytes(state)


def _aes_decrypt_block(key, block):
    nk = len(key) // 4
    nr = nk + 6
    rk = _expand_key(key)
    state = bytearray(block)
    _add_round_key(state, rk, nr)
    for rnd in range(nr - 1, 0, -1):
        _inv_shift_rows(state)
        _inv_sub_bytes(state)
        _add_round_key(state, rk, rnd)
        _inv_mix_columns(state)
    _inv_shift_rows(state)
    _inv_sub_bytes(state)
    _add_round_key(state, rk, 0)
    return bytes(state)


# ===== 纯 Python GCM 模式（回退实现）=====
# GHASH 采用与 OpenSSL 一致的“反射式”GF(2^128) 乘法：
# 块按大端读成整数，乘 x 等价于右移，溢出时以 R=0xE1<<120 约简。
_GF_R = 0xE1000000000000000000000000000000


def _gf_mul128(x, y):
    """GF(2^128) 乘法（GCM 的 GHASH 需要）。"""
    z = 0
    v = y
    for i in range(128):
        if x & (1 << (127 - i)):
            z ^= v
        if v & 1:
            v = (v >> 1) ^ _GF_R
        else:
            v >>= 1
    return z


def _ghash(h, aad, ct):
    """GHASH(H, A, C)：AAD 与密文补齐 16 字节倍数后拼接长度块。"""
    data = aad + b"\x00" * ((-len(aad)) % 16)
    data += ct + b"\x00" * ((-len(ct)) % 16)
    data += (len(aad) * 8).to_bytes(8, "big") + (len(ct) * 8).to_bytes(8, "big")
    h_int = int.from_bytes(h, "big")
    y = 0
    for off in range(0, len(data), 16):
        y = _gf_mul128(y ^ int.from_bytes(data[off:off + 16], "big"), h_int)
    return y.to_bytes(16, "big")


def _inc32(x):
    """GCM 计数器自增：仅递增最低 32 位。"""
    return (x & ~0xFFFFFFFF) | ((x + 1) & 0xFFFFFFFF)


def _gcm_j0(h, iv):
    if len(iv) == 12:
        return (int.from_bytes(iv, "big") << 32) | 1
    return int.from_bytes(_ghash(h, b"", iv), "big")


def _gcm_encrypt(key, iv, plaintext, aad=b""):
    h = _aes_encrypt_block(key, bytes(16))
    j0 = _gcm_j0(h, iv)
    counter = _inc32(j0)
    ct = bytearray()
    for off in range(0, len(plaintext), 16):
        block = plaintext[off:off + 16]
        ks = _aes_encrypt_block(key, counter.to_bytes(16, "big"))
        ct += bytes(a ^ b for a, b in zip(block, ks))
        counter = _inc32(counter)
    tag = int.from_bytes(_ghash(h, aad, bytes(ct)), "big") ^ int.from_bytes(
        _aes_encrypt_block(key, j0.to_bytes(16, "big")), "big")
    return bytes(ct) + tag.to_bytes(16, "big")


def _gcm_decrypt(key, iv, ct_with_tag, aad=b""):
    if len(ct_with_tag) < 16:
        raise ValueError("密文长度非法")
    ct, tag = ct_with_tag[:-16], ct_with_tag[-16:]
    h = _aes_encrypt_block(key, bytes(16))
    j0 = _gcm_j0(h, iv)
    counter = _inc32(j0)
    pt = bytearray()
    for off in range(0, len(ct), 16):
        block = ct[off:off + 16]
        ks = _aes_encrypt_block(key, counter.to_bytes(16, "big"))
        pt += bytes(a ^ b for a, b in zip(block, ks))
        counter = _inc32(counter)
    computed = int.from_bytes(_ghash(h, aad, ct), "big") ^ int.from_bytes(
        _aes_encrypt_block(key, j0.to_bytes(16, "big")), "big")
    if computed != int.from_bytes(tag, "big"):
        raise ValueError("认证失败：密码错误或数据已损坏")
    return bytes(pt)


def _encrypt_bytes(key, iv, plaintext):
    if HAVE_LIB_CRYPTO:
        return _LibAESGCM(key).encrypt(iv, plaintext, None)
    return _gcm_encrypt(key, iv, plaintext)


def _decrypt_bytes(key, iv, ct_with_tag):
    if HAVE_LIB_CRYPTO:
        return _LibAESGCM(key).decrypt(iv, ct_with_tag, None)
    return _gcm_decrypt(key, iv, ct_with_tag)


# ===== 密钥派生与文件信封（与 web/js/store.js 保持一致）=====
def derive_key(password):
    return hashlib.pbkdf2_hmac(
        PBKDF2_HASH, password.encode("utf-8"), FILE_ENC_SALT, PBKDF2_ITERATIONS, 32
    )


def _b64e(data):
    return base64.b64encode(data).decode("ascii")


def _b64d(s):
    return base64.b64decode(s)


def is_envelope(text):
    """判断文本是否为加密信封（自描述 magic 标记）。"""
    try:
        data = json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return False
    return isinstance(data, dict) and data.get("magic") == FILE_ENC_MAGIC


def encrypt_payload(text, password):
    """加密备份内容（明文 JSON 字符串），返回加密信封字符串。"""
    key = derive_key(password)
    iv = os.urandom(12)
    ct = _encrypt_bytes(key, iv, text.encode("utf-8"))
    return json.dumps(
        {"magic": FILE_ENC_MAGIC, "iv": _b64e(iv), "ciphertext": _b64e(ct)},
        ensure_ascii=False,
    )


class NotEncryptedError(ValueError):
    pass


def decrypt_payload(text, password):
    """解密信封内容，返回明文 JSON 字符串；密码错误时抛出 ValueError。"""
    try:
        data = json.loads(text)
    except (json.JSONDecodeError, ValueError) as e:
        raise NotEncryptedError("不是有效的 JSON / 加密信封") from e
    if not isinstance(data, dict) or data.get("magic") != FILE_ENC_MAGIC:
        raise NotEncryptedError("不是加密文件（缺少 magic 标记）")
    try:
        iv = _b64d(data["iv"])
        ct = _b64d(data["ciphertext"])
    except (KeyError, TypeError, ValueError) as e:
        raise NotEncryptedError("加密信封字段不完整或非法") from e
    try:
        plain = _decrypt_bytes(derive_key(password), iv, ct)
    except Exception as e:
        raise ValueError("密码错误或数据已损坏") from e
    return plain.decode("utf-8")


# ===== 备份结构校验（与 web/js/store.js validateBackup / sync2backupfile.py 一致）=====
def validate_backup(data):
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


# ===== 文件处理 =====
def resolve_output(src, mode, args):
    """计算输出路径：加密 -> <名>.enc；解密 -> 去掉 .enc 或追加 .decrypted。"""
    if args.output:
        return Path(args.output)
    if mode == "encrypt":
        name = src.name + ".enc"
    elif src.name.lower().endswith(".enc"):
        name = src.name[:-4]
    else:
        name = src.stem + ".decrypted" + src.suffix
    base = Path(args.out_dir) if args.out_dir else src.parent
    return base / name


def process_file(src, mode, password, args):
    """处理单个文件，返回 (状态, 说明)。状态：ok / skip / error。"""
    try:
        # 用二进制读写保留原始行尾，保证加解密往返与源文件字节一致
        text = src.read_bytes().decode("utf-8")
    except (OSError, UnicodeDecodeError) as e:
        return "error", f"读取失败：{e}"
    try:
        if mode == "encrypt":
            if is_envelope(text):
                return "skip", "已是加密文件"
            try:
                data = json.loads(text)
            except json.JSONDecodeError as e:
                return "error", f"不是有效的 JSON：{e}"
            if not validate_backup(data):
                return "error", "不是有效的 JimBDHub 备份数据"
            result = encrypt_payload(text, password)
        else:
            if not is_envelope(text):
                return "skip", "不是加密文件（明文或无效格式）"
            plain = decrypt_payload(text, password)
            try:
                data = json.loads(plain)
            except json.JSONDecodeError as e:
                return "error", f"解密结果不是有效 JSON：{e}"
            if not validate_backup(data):
                return "error", "解密结果不是有效的 JimBDHub 备份数据"
            result = plain
    except ValueError as e:
        return "error", str(e)

    out = resolve_output(src, mode, args)
    if out.exists() and not args.overwrite:
        return "skip", f"输出已存在，跳过：{out}（用 --overwrite 覆盖）"
    try:
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(result.encode("utf-8"))
    except OSError as e:
        return "error", f"写入失败：{e}"
    return "ok", str(out)


def expand_inputs(paths, mode):
    """展开文件/目录参数为实际文件列表（去重、保序）。"""
    files = []
    seen = set()
    for p in paths:
        p = Path(p)
        if p.is_dir():
            if mode == "encrypt":
                candidates = sorted(p.glob("*.json"))
            else:
                candidates = sorted(set(p.glob("*.json")) | set(p.glob("*.enc")))
            for c in candidates:
                key = str(c)
                if key not in seen:
                    seen.add(key)
                    files.append(c)
        elif p.is_file():
            key = str(p.resolve())
            if key not in seen:
                seen.add(key)
                files.append(p)
        else:
            print(f"警告：路径不存在，已跳过：{p}", file=sys.stderr)
    return files


def run_batch(paths, mode, password, args):
    """批处理一组文件/目录，返回退出码（有失败为 1）。"""
    files = expand_inputs(paths, mode)
    if not files:
        print("没有可处理的文件。", file=sys.stderr)
        return 1
    ok = skipped = errors = 0
    verb = "加密" if mode == "encrypt" else "解密"
    for f in files:
        status, msg = process_file(f, mode, password, args)
        if status == "ok":
            ok += 1
            print(f"[{verb}完成] {f} -> {msg}")
        elif status == "skip":
            skipped += 1
            print(f"[跳过] {f}：{msg}")
        else:
            errors += 1
            print(f"[失败] {f}：{msg}", file=sys.stderr)
    print(f"\n完成：成功 {ok}，跳过 {skipped}，失败 {errors}。")
    return 1 if errors else 0


def interactive_main(args):
    """交互模式：e 加密 / d 解密 / Q 退出。"""
    print("JimBDHub 备份文件加解密（交互模式，输入 Q 或 Ctrl+C 退出）")
    while True:
        try:
            choice = input("[e/d/Q]? ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if choice in ("q", "quit", "exit"):
            break
        if choice == "e":
            mode = "encrypt"
        elif choice == "d":
            mode = "decrypt"
        else:
            print("无效输入，请输入 e（加密）/ d（解密）/ Q（退出）")
            continue
        try:
            raw = input("文件路径（多个用空格分隔；目录则批量处理）: ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if not raw:
            continue
        paths = shlex.split(raw)
        try:
            password = getpass.getpass("主密码（输入时不显示）: ")
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if not password:
            print("错误：密码不能为空", file=sys.stderr)
            continue
        run_batch(paths, mode, password, args)
    print("再见。")


def main():
    parser = argparse.ArgumentParser(
        prog=Path(__file__).name,
        description="加密/解密 JimBDHub 备份与同步文件（与软件内加密格式完全兼容）",
        epilog=(
            "示例：\n"
            "  %(prog)s -e backup.json                # 加密单文件\n"
            "  %(prog)s -e 备份目录/                  # 加密目录下全部 *.json\n"
            "  %(prog)s -d backup.json.enc            # 解密\n"
            "  %(prog)s -d -p 密码 backup.json.enc    # 通过选项提供密码\n"
            "  %(prog)s -i                            # 交互模式\n"
            "  %(prog)s                               # 无参数进入交互模式"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    action_group = parser.add_mutually_exclusive_group()
    action_group.add_argument("-e", "--encrypt", action="store_true", help="加密模式")
    action_group.add_argument("-d", "--decrypt", action="store_true", help="解密模式")
    parser.add_argument("-i", "--interactive", action="store_true", help="交互模式（无参数时自动进入）")
    parser.add_argument("-p", "--password", metavar="密码", help="主密码（不提供时安全提示输入）")
    parser.add_argument("-o", "--output", metavar="文件", help="输出文件路径（仅单个输入文件时可用）")
    parser.add_argument("--out-dir", dest="out_dir", metavar="目录", help="输出到指定目录（批处理时可用）")
    parser.add_argument("--overwrite", action="store_true", help="覆盖已存在的输出文件")
    parser.add_argument("files", nargs="*", metavar="文件", help="备份/同步文件路径或目录（可多个）")
    args = parser.parse_args()

    if args.encrypt:
        mode = "encrypt"
    elif args.decrypt:
        mode = "decrypt"
    else:
        mode = None

    # 无参数或指定 -i：进入交互模式
    if args.interactive or (mode is None and not args.files):
        return interactive_main(args)

    if mode is None:
        parser.error("请指定 -e/--encrypt 或 -d/--decrypt（或直接运行进入交互模式）")
    if not args.files:
        parser.error("未指定文件（可加 -i 进入交互模式）")
    if args.output and len(args.files) != 1:
        parser.error("--output 仅能配合单个输入文件使用")

    password = args.password
    if password is None:
        password = getpass.getpass("主密码（输入时不显示）: ")
    if not password:
        print("错误：密码不能为空", file=sys.stderr)
        return 1
    if mode == "encrypt" and len(password) < 4:
        print("错误：加密密码至少需要 4 个字符（与软件要求一致）", file=sys.stderr)
        return 1

    return run_batch(args.files, mode, password, args)


if __name__ == "__main__":
    sys.exit(main())
