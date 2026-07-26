# -*- coding: utf-8 -*-
"""工程③でエージェントに渡すページ範囲を出す。

    py -3.12 tools/page_split.py r07a r07h
    py -3.12 tools/page_split.py --todo          抽出がまだ済んでいない回を一覧する

実在ページ（描画済みPNG）のちょうど中央で前半・後半に割る。
欠番があるのでファイル名の連番ではなく実在枚数で割ること。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGES = ROOT / "work" / "pages"
EXTRACTED = ROOT / "work" / "extracted"
ANSWERS = ROOT / "work" / "answers"


def split_of(exam: str) -> dict | None:
    d = PAGES / exam
    files = sorted(p.stem for p in d.glob("p*.png"))
    if not files:
        return None
    half = (len(files) + 1) // 2
    return {
        "exam": exam,
        "n": len(files),
        "first": files[0],
        "last": files[-1],
        "a_end": files[half - 1],
        "b_start": files[half],
    }


def has_groups(exam: str) -> bool:
    p = ANSWERS / f"{exam}.json"
    if not p.exists():
        return False
    return bool(json.loads(p.read_text(encoding="utf-8")).get("groups"))


def done(exam: str) -> list[str]:
    return sorted(p.stem.split("_", 1)[1] for p in EXTRACTED.glob(f"{exam}_*.json"))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("exams", nargs="*", help="exam_id（省略時は --todo と同じ）")
    ap.add_argument("--todo", action="store_true", help="抽出が未完了の回を出す")
    args = ap.parse_args()

    if not PAGES.exists():
        print("work/pages がありません。先に tools/render_pages.py を実行してください。")
        return 1

    all_exams = sorted(p.name for p in PAGES.iterdir() if p.is_dir())
    if args.todo or not args.exams:
        targets = [e for e in all_exams if len(done(e)) < 2]
        if not targets:
            print("すべての回で前半・後半の抽出が済んでいます。")
            return 0
        print(f"未完了 {len(targets)} 回:\n")
    else:
        targets = args.exams

    for e in targets:
        s = split_of(e)
        if not s:
            print(f"{e}: 描画済みページがありません（render_pages.py を実行）")
            continue
        d = done(e)
        g = "大分野あり" if has_groups(e) else "★大分野なし（内容から判断させる）"
        print(f"{e}  実在{s['n']}ページ  {s['first']}..{s['last']}  [{g}]")
        print(f"    前半 a: {s['first']} 〜 {s['a_end']}"
              + ("  ✓済" if "a" in d else ""))
        print(f"    後半 b: {s['b_start']} 〜 {s['last']}"
              + ("  ✓済" if "b" in d else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
