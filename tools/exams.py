# -*- coding: utf-8 -*-
"""試験回の識別（ファイル名と解答PDFのテキストから）。

IPA のファイル名の規則:
    2025r07a_ap_am_qs.pdf
    │   │  ││  └ am=午前 / qs=問題 ans=解答
    │   │  │└─── 実施期: h=春期, a=秋期, o=10月実施(秋期扱い), tokubetsu=特別
    │   │  └──── 年号内の年（r07=令和7年, h21=平成21年）
    │   └─────── 年号: h=平成, r=令和
    └─────────── 西暦
"""

from __future__ import annotations

import re
import unicodedata
from pathlib import Path

FNAME = re.compile(r"^(?P<ad>\d{4})(?P<era>[hr])(?P<n>\d{2})(?P<season>tokubetsu|[hao])_ap_am_(?P<kind>qs|ans)$")
ERA_TEXT = re.compile(r"(令和|平成)\s*(元|[0-9]{1,2})\s*年度?\s*(春期|秋期|特別)")

SEASON_JA = {"h": "春期", "a": "秋期", "o": "秋期", "tokubetsu": "特別"}
SEASON_ORDER = {"h": 10, "tokubetsu": 15, "a": 20, "o": 20}
SEASON_EN = {"h": "spring", "a": "autumn", "o": "autumn", "tokubetsu": "special"}


def parse_name(path: Path) -> dict | None:
    m = FNAME.match(path.stem)
    if not m:
        return None
    d = m.groupdict()
    era = "令和" if d["era"] == "r" else "平成"
    n = int(d["n"])
    season = d["season"]
    sid = "t" if season == "tokubetsu" else season
    nen = "元" if (era == "令和" and n == 1) else str(n)
    return {
        "id": f"{d['era']}{d['n']}{sid}",
        "label": f"{era}{nen}年度 {SEASON_JA[season]}",
        "year": int(d["ad"]),
        "season": SEASON_EN[season],
        "order": int(d["ad"]) * 100 + SEASON_ORDER[season],
        "kind": d["kind"],
        "path": path,
    }


def label_from_pdf(text: str) -> str | None:
    m = ERA_TEXT.search(unicodedata.normalize("NFKC", text or ""))
    if not m:
        return None
    era, n, season = m.groups()
    return f"{era}{n}年度 {season}"


def discover(pdf_dir: Path) -> dict[str, dict]:
    """exam_id -> {id,label,year,season,order,qs,ans}"""
    found: dict[str, dict] = {}
    for p in sorted(pdf_dir.glob("*.pdf")):
        info = parse_name(p)
        if not info:
            continue
        rec = found.setdefault(info["id"], {k: info[k] for k in
                                           ("id", "label", "year", "season", "order")})
        rec[info["kind"]] = p
    return dict(sorted(found.items(), key=lambda kv: kv[1]["order"]))


if __name__ == "__main__":
    import sys
    d = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(
        r"C:\Users\gashi\Desktop\応用情報技術者試験問題、回答")
    ex = discover(d)
    print(f"{len(ex)} 回")
    for k, v in ex.items():
        print(f"  {k:6s} {v['label']:14s} order={v['order']} "
              f"qs={'o' if v.get('qs') else 'x'} ans={'o' if v.get('ans') else 'x'}")
