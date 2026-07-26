# -*- coding: utf-8 -*-
"""工程①: 解答PDF から 正解 と 大分野(T/M/S) を取り出す。

    py -3.12 tools/extract_answers.py --pdf-dir "C:\\...\\応用情報技術者試験問題、回答"

出力: work/answers/<exam_id>.json
    {"exam":"r07a","label":"令和7年度 秋期","answers":{"1":"エ",...},"groups":{"1":"T",...}}

解答PDF がスキャン画像で読めない回は work/answers/<exam_id>.manual.txt を置けば
そちらを使う（"エウイ..." の並び、または "1 エ" の行並び）。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path

import fitz

sys.path.insert(0, str(Path(__file__).resolve().parent))
from exams import discover, label_from_pdf  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / "work" / "answers"
KEYS = "アイウエ"

# 「問1 エ T」の並び。分野列は平成28年以降にだけある
ROW = re.compile(r"問\s*([0-9]{1,3})\s*\n?\s*([アイウエ])\s*\n?\s*([TMS])?")


def read_pdf_text(path: Path) -> str:
    doc = fitz.open(path)
    try:
        return "\n".join(doc[i].get_text() for i in range(doc.page_count))
    finally:
        doc.close()


def am_section(text: str) -> str:
    """午前試験の解答部分だけを切り出す（同じPDFに午後の解答例が入っている）。"""
    t = unicodedata.normalize("NFKC", text)
    i = t.find("午前")
    if i < 0:
        return t
    j = t.find("午後", i + 1)
    sec = t[i:j] if j > i else t[i:]
    return sec if len(sec) > 100 else t


def from_pdf(path: Path) -> tuple[dict[int, str], dict[int, str]]:
    sec = am_section(read_pdf_text(path))
    answers: dict[int, str] = {}
    groups: dict[int, str] = {}
    for n, a, g in ROW.findall(sec):
        i = int(n)
        if 1 <= i <= 80 and i not in answers:
            answers[i] = a
            if g:
                groups[i] = g
    return answers, groups


def from_manual(path: Path) -> tuple[dict[int, str], dict[int, str]]:
    """手入力ファイルを読む。

    受け付ける形式:
        エウイアウ…                  解答を80個並べただけ
        1 エ                          "問番号 解答"
        1 エ T                        "問番号 解答 大分野"（大分野も保持する）
    """
    txt = path.read_text(encoding="utf-8", errors="replace")
    rows = re.findall(r"([0-9]{1,3})\s*[.:：　 \t]*([アイウエ])\s*[　 \t]*([TMS])?", txt)
    if rows:
        answers = {int(n): a for n, a, _ in rows}
        groups = {int(n): g for n, _, g in rows if g}
        return answers, groups
    seq = [c for c in txt if c in KEYS]
    return {i + 1: c for i, c in enumerate(seq)}, {}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf-dir", required=True)
    ap.add_argument("--only", nargs="*", default=None, help="exam_id を指定（省略で全回）")
    args = ap.parse_args()

    WORK.mkdir(parents=True, exist_ok=True)
    exams = discover(Path(args.pdf_dir))
    if not exams:
        print("PDF が見つかりません。")
        return 1

    ok, ng = 0, []
    for eid, ex in exams.items():
        if args.only and eid not in args.only:
            continue

        manual = WORK / f"{eid}.manual.txt"
        label = ex["label"]
        groups: dict[int, str] = {}

        if manual.exists():
            answers, groups = from_manual(manual)
            src = manual.name
        elif ex.get("ans"):
            answers, groups = from_pdf(ex["ans"])
            src = ex["ans"].name
            lb = label_from_pdf(read_pdf_text(ex["ans"]))
            if lb:
                label = lb.replace("年度", "年度 ")
                label = re.sub(r"\s+", " ", label).strip()
                label = ex["label"]  # ファイル名由来の表記で統一する
        else:
            answers, src = {}, "(なし)"

        answers = {k: v for k, v in answers.items() if 1 <= k <= 80 and v in KEYS}
        rec = {
            "exam": eid,
            "label": label,
            "year": ex["year"],
            "season": ex["season"],
            "order": ex["order"],
            "source": src,
            "answers": {str(k): answers[k] for k in sorted(answers)},
            "groups": {str(k): groups[k] for k in sorted(groups)},
        }
        (WORK / f"{eid}.json").write_text(
            json.dumps(rec, ensure_ascii=False, indent=1), encoding="utf-8")

        n = len(answers)
        mark = "OK " if n == 80 else "NG "
        if n == 80:
            ok += 1
        else:
            ng.append(eid)
        print(f"{mark}{eid:6s} {label:16s} 正解{n:3d} 大分野{len(groups):3d}  <- {src}")

    print(f"\n完了: 正解80問そろった回 {ok} / 不足 {len(ng)}")
    if ng:
        print("不足した回:", ", ".join(ng))
        for eid in ng:
            print(f"  → work/answers/{eid}.manual.txt に解答を書けば次回から使われます")
    return 0


if __name__ == "__main__":
    sys.exit(main())
