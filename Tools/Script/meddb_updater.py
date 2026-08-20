#!/usr/bin/env python3
"""根据权威来源更新内置药品数据库（MedDB.json）中与血药浓度相关的参数。

本脚本做两件事：
  1. 分子量 molarMass —— 通过 PubChem PUG REST 自动获取（权威、公开、无密钥）。
     该值当前仅用于 mmol/L 单位（如碳酸锂）的血药浓度换算。
  2. 分布容积 Vd、生物利用度 F —— 来自下方 PK_REFERENCE 精选数据表（含来源说明）。

为何 Vd/F 用精选表而不是自动抓取：
  目前没有免费 API 以结构化字段直接提供「分布容积」「生物利用度」这两个数值
  （PubChem / FDA 标签中它们只是人体吸收代谢章节里的自由文本，且有区间、单位和
  描述性措辞，无法可靠地自动解析）。因此这里采用来源可追溯的精选值，并在脚本中
  集中维护、便于人工审校。

重要假设：
  - 分布容积以 L/kg 为单位写入数据库（vdPerKg），由前端按用户体重换算成个体 Vd(L)。
  - 生物利用度 F 以 0~1 的小数表示。

用法：
    python3 meddb_updater.py [--meddb 路径] [--offline] [--dry-run]

默认数据库：<仓库根>/web/MedDB.json（相对脚本自身位置推导）。
"""

import argparse
import json
import sys
import urllib.request
from datetime import date
from pathlib import Path

# PubChem PUG REST 接口
PUBCHEM_BASE = "https://pubchem.ncbi.nlm.nih.gov/rest/pug"

# 精选药代动力学参考数据。
# 键为 MedDB.json 中的药品中文名；bioavailability 为 0~1 的小数；vd_l_per_kg 为分布容积(L/kg)。
# pubchem_name 用于查询分子量；active_ratio 仅 mmol/L 浓度换算需要（每摩尔盐产生的活性离子数）。
# reference 指向可查证的权威来源，便于人工复核。
# 说明：未列入本表的药品（如安非他酮，其口服生物利用度随剂型差异大、缺乏单一可靠值；
#       苯海索，缺乏可靠的 Vd/F 公开数据）不会被写入 Vd/F，即不启用真实血药浓度曲线。
PK_REFERENCE = {
    "碳酸锂": {
        "vd_l_per_kg": 0.79,
        "bioavailability": 1.0,
        "active_ratio": 2,
        "molar_mass": 73.89,
        "pubchem_name": "lithium carbonate",
        "reference": "https://pubchem.ncbi.nlm.nih.gov/compound/11125",
    },
    "丙戊酸钠": {
        "vd_l_per_kg": 0.2,
        "bioavailability": 0.9,
        "pubchem_name": "valproic acid",
        "reference": "https://pubchem.ncbi.nlm.nih.gov/compound/3121",
    },
    "丙戊酸镁": {
        "vd_l_per_kg": 0.2,
        "bioavailability": 0.9,
        "pubchem_name": "valproic acid",
        "reference": "https://pubchem.ncbi.nlm.nih.gov/compound/3121",
    },
    "拉莫三嗪": {
        "vd_l_per_kg": 1.1,
        "bioavailability": 0.98,
        "pubchem_name": "lamotrigine",
        "reference": "https://pubchem.ncbi.nlm.nih.gov/compound/3878",
    },
    "卡马西平": {
        "vd_l_per_kg": 1.3,
        "bioavailability": 0.75,
        "pubchem_name": "carbamazepine",
        "reference": "https://pubchem.ncbi.nlm.nih.gov/compound/2554",
    },
    "喹硫平": {
        "vd_l_per_kg": 10.0,
        "bioavailability": 0.09,
        "pubchem_name": "quetiapine",
        "reference": "https://pubchem.ncbi.nlm.nih.gov/compound/5002",
    },
    "奥氮平": {
        "vd_l_per_kg": 15.0,
        "bioavailability": 0.7,
        "pubchem_name": "olanzapine",
        "reference": "https://pubchem.ncbi.nlm.nih.gov/compound/4585",
    },
    "利培酮": {
        "vd_l_per_kg": 1.5,
        "bioavailability": 0.7,
        "pubchem_name": "risperidone",
        "reference": "https://pubchem.ncbi.nlm.nih.gov/compound/5073",
    },
    "阿立哌唑": {
        "vd_l_per_kg": 4.9,
        "bioavailability": 0.87,
        "pubchem_name": "aripiprazole",
        "reference": "https://pubchem.ncbi.nlm.nih.gov/compound/60795",
    },
    "鲁拉西酮": {
        "vd_l_per_kg": 40.0,
        "bioavailability": 0.1,
        "pubchem_name": "lurasidone",
        "reference": "https://pubchem.ncbi.nlm.nih.gov/compound/213046",
    },
    "齐拉西酮": {
        "vd_l_per_kg": 1.5,
        "bioavailability": 0.6,
        "pubchem_name": "ziprasidone",
        "reference": "https://pubchem.ncbi.nlm.nih.gov/compound/60854",
    },
    "帕利哌酮": {
        "vd_l_per_kg": 6.9,
        "bioavailability": 0.28,
        "pubchem_name": "paliperidone",
        "reference": "https://pubchem.ncbi.nlm.nih.gov/compound/115237",
    },
    "氨磺必利": {
        "vd_l_per_kg": 5.8,
        "bioavailability": 0.48,
        "pubchem_name": "amisulpride",
        "reference": "https://pubchem.ncbi.nlm.nih.gov/compound/2255609",
    },
    "舍曲林": {
        "vd_l_per_kg": 20.0,
        "bioavailability": 0.44,
        "pubchem_name": "sertraline",
        "reference": "https://pubchem.ncbi.nlm.nih.gov/compound/63009",
    },
    "氟西汀": {
        "vd_l_per_kg": 35.0,
        "bioavailability": 0.7,
        "pubchem_name": "fluoxetine",
        "reference": "https://pubchem.ncbi.nlm.nih.gov/compound/3386",
    },
    "艾司西酞普兰": {
        "vd_l_per_kg": 12.0,
        "bioavailability": 0.8,
        "pubchem_name": "escitalopram",
        "reference": "https://pubchem.ncbi.nlm.nih.gov/compound/146570",
    },
    "文拉法辛": {
        "vd_l_per_kg": 7.5,
        "bioavailability": 0.45,
        "pubchem_name": "venlafaxine",
        "reference": "https://pubchem.ncbi.nlm.nih.gov/compound/5656",
    },
    "度洛西汀": {
        "vd_l_per_kg": 23.0,
        "bioavailability": 0.5,
        "pubchem_name": "duloxetine",
        "reference": "https://pubchem.ncbi.nlm.nih.gov/compound/60835",
    },
    "米氮平": {
        "vd_l_per_kg": 4.5,
        "bioavailability": 0.5,
        "pubchem_name": "mirtazapine",
        "reference": "https://pubchem.ncbi.nlm.nih.gov/compound/4205",
    },
    "曲唑酮": {
        "vd_l_per_kg": 0.84,
        "bioavailability": 0.65,
        "pubchem_name": "trazodone",
        "reference": "https://pubchem.ncbi.nlm.nih.gov/compound/5533",
    },
    "劳拉西泮": {
        "vd_l_per_kg": 1.3,
        "bioavailability": 0.9,
        "pubchem_name": "lorazepam",
        "reference": "https://pubchem.ncbi.nlm.nih.gov/compound/3958",
    },
    "阿普唑仑": {
        "vd_l_per_kg": 1.0,
        "bioavailability": 0.9,
        "pubchem_name": "alprazolam",
        "reference": "https://pubchem.ncbi.nlm.nih.gov/compound/2118",
    },
    "氯硝西泮": {
        "vd_l_per_kg": 3.0,
        "bioavailability": 0.9,
        "pubchem_name": "clonazepam",
        "reference": "https://pubchem.ncbi.nlm.nih.gov/compound/2802",
    },
    "丁螺环酮": {
        "vd_l_per_kg": 5.3,
        "bioavailability": 0.04,
        "pubchem_name": "buspirone",
        "reference": "https://pubchem.ncbi.nlm.nih.gov/compound/2477",
    },
    "唑吡坦": {
        "vd_l_per_kg": 0.54,
        "bioavailability": 0.7,
        "pubchem_name": "zolpidem",
        "reference": "https://pubchem.ncbi.nlm.nih.gov/compound/5732",
    },
    "右佐匹克隆": {
        "vd_l_per_kg": 1.4,
        "bioavailability": 0.8,
        "pubchem_name": "eszopiclone",
        "reference": "https://pubchem.ncbi.nlm.nih.gov/compound/969472",
    },
    "佐匹克隆": {
        "vd_l_per_kg": 1.4,
        "bioavailability": 0.75,
        "pubchem_name": "zopiclone",
        "reference": "https://pubchem.ncbi.nlm.nih.gov/compound/5735",
    },
    "哌甲酯": {
        "vd_l_per_kg": 13.0,
        "bioavailability": 0.3,
        "pubchem_name": "methylphenidate",
        "reference": "https://pubchem.ncbi.nlm.nih.gov/compound/4158",
    },
    "托莫西汀": {
        "vd_l_per_kg": 0.85,
        "bioavailability": 0.63,
        "pubchem_name": "atomoxetine",
        "reference": "https://pubchem.ncbi.nlm.nih.gov/compound/54841",
    },
    "普萘洛尔": {
        "vd_l_per_kg": 4.0,
        "bioavailability": 0.26,
        "pubchem_name": "propranolol",
        "reference": "https://pubchem.ncbi.nlm.nih.gov/compound/4946",
    },
}


def _http_json(url, timeout=15):
    """发起 GET 请求并解析 JSON。"""
    req = urllib.request.Request(url, headers={"User-Agent": "JimBDHub meddb-updater/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def pubchem_molecular_weight(name):
    """按名称查询 PubChem 的分子量；失败返回 None。"""
    try:
        cids = _http_json(f"{PUBCHEM_BASE}/compound/name/{urllib.request.quote(name)}/cids/JSON")
        cid = cids["IdentifierList"]["CID"][0]
    except Exception:
        return None
    try:
        props = _http_json(f"{PUBCHEM_BASE}/compound/cid/{cid}/property/MolecularWeight/JSON")
        value = props["PropertyTable"]["Properties"][0]["MolecularWeight"]
        return float(value)
    except Exception:
        return None


def default_meddb_path():
    """仓库根下 web/MedDB.json（脚本位于 Tools/Script/）。"""
    return Path(__file__).resolve().parent.parent.parent / "web" / "MedDB.json"


def apply_updates(data, fetch_online):
    """就地更新 data['medicines']，返回 (更新计数, 在线失败计数)。"""
    medicines = data.get("medicines")
    if not isinstance(medicines, list):
        raise ValueError("MedDB.json 缺少 valid 的 medicines 列表")

    updated = 0
    fetch_failed = 0

    for med in medicines:
        name = med.get("name")
        ref = PK_REFERENCE.get(name)
        if not ref:
            continue

        med["vdPerKg"] = ref["vd_l_per_kg"]
        med["bioavailability"] = ref["bioavailability"]

        # 仅 mmol/L 浓度换算需要分子量与活性离子数
        if "active_ratio" in ref:
            med["activeRatio"] = ref["active_ratio"]
            molar_mass = ref.get("molar_mass")
            if fetch_online and ref.get("pubchem_name"):
                weight = pubchem_molecular_weight(ref["pubchem_name"])
                if weight is not None:
                    molar_mass = round(weight, 2)
                else:
                    fetch_failed += 1
            if molar_mass is not None:
                med["molarMass"] = molar_mass

        updated += 1

    return updated, fetch_failed


def main():
    parser = argparse.ArgumentParser(description="更新 MedDB.json 中的血药浓度相关参数")
    parser.add_argument("--meddb", default=str(default_meddb_path()), help="MedDB.json 路径")
    parser.add_argument("--offline", action="store_true", help="不访问 PubChem，仅使用精选表")
    parser.add_argument("--dry-run", action="store_true", help="只打印将写入/新增的内容，不写文件")
    args = parser.parse_args()

    meddb_path = Path(args.meddb)
    if not meddb_path.is_file():
        print(f"错误：找不到数据库文件 {meddb_path}")
        return 1

    try:
        data = json.loads(meddb_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as err:
        print(f"错误：无法读取 {meddb_path}：{err}")
        return 1

    updated, fetch_failed = apply_updates(data, fetch_online=not args.offline)

    if not args.dry_run:
        data["lastVerified"] = date.today().isoformat()
        data["dataSource"] = (
            "Vd/生物利用度：精选自 FDA 药品标签与 PubChem（集中维护于 Tools/Script/meddb_updater.py 的 "
            "PK_REFERENCE，Vd 以 L/kg 记录，由前端按用户体重换算）；分子量：PubChem PUG REST 自动获取。"
        )
        meddb_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"已更新药物：{updated} 种")
    if fetch_failed:
        print(f"警告：{fetch_failed} 个药品的分子量在线获取失败（不影响 Vd/F 写入）")
    print("完成（dry-run，未写文件）" if args.dry_run else f"已写入：{meddb_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())