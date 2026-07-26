# -*- coding: utf-8 -*-
"""午後 解答例の設問リストに、設問でない行が混ざっていないかを全回横断で調べる。

    py -3.12 tools/audit_pm_items.py

解答例PDFの表は回によって列構成が違う（解答が a群/b群 の2通りある回など）。
そのため「表のヘッダ行」や「注記」が設問として拾われたり、
小問番号 (1) が解答文に食い込んだりすることがある。
このスクリプトはその疑いがある項目だけを洗い出す。ここで挙がったものは
work/pm_answers/<exam>.json を手で直すか、build 側で除外する。
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ANS = ROOT / "work" / "pm_answers"

# 解答文の先頭に小問番号が残っている → 表の列がずれて取れた疑い
SUB_LEAK = re.compile(r"^\(\s*\d+\s*\)")
# 「(3)，(5)」は番号を並べて答える正当な解答なので、上の疑いから除く
NUM_LIST = re.compile(r"^\(\s*\d+\s*\)\s*[，、,]")
# 大文字ラテン1文字を空欄記号として切り出したが、解答文が「社」「君」で続く形。
# 「A 社しか…」の A を空欄と誤認して解答の先頭を削った状態（実際に16件あった）
NAME_CUT = re.compile(r"^[社君氏，、]")
# 設問ではなく表の見出し・注記と思われる文言
HEADER_WORDS = ("群", "同じ群", "順不同", "いずれか", "解答例", "備考", "組合せとする")


def looks_header(ans: str) -> bool:
    a = ans.replace(" ", "")
    if "群" in a and ("組合せ" in a or "同じ" in a):
        return True
    if a in ("解答例", "備考", "解答の要点"):
        return True
    return False


def main() -> int:
    total = 0
    leaks: list[tuple] = []
    headers: list[tuple] = []
    empties: list[tuple] = []
    cuts: list[tuple] = []

    for p in sorted(ANS.glob("*.json")):
        k = json.loads(p.read_text(encoding="utf-8"))
        for s in k["sections"]:
            for i, it in enumerate(s["items"]):
                total += 1
                a = str(it.get("answer", ""))
                if looks_header(a):
                    headers.append((k["exam"], s["no"], i, it["id"], a[:44]))
                elif not a.strip():
                    empties.append((k["exam"], s["no"], i, it["id"], ""))
                elif NAME_CUT.match(a) and str(it.get("blank") or "").isupper() \
                        and str(it.get("blank") or "").isascii():
                    # 「社員…」で始まる正当な解答は多い。空欄記号として大文字を
                    # 切り出したうえで続きが「社」なら、それは社名を割った跡。
                    cuts.append((k["exam"], s["no"], i, it["id"], a[:44]))
                elif SUB_LEAK.match(a) and not NUM_LIST.match(a) \
                        and it.get("sub") is None and it.get("blank") is None:
                    # 空欄記号も小問番号も取れていないのに解答が「(1)」で始まる →
                    # 列がずれた疑い。blank や sub が取れている場合の「(7)」等は、
                    # 選択肢番号を答える正当な解答なので対象外にする。
                    leaks.append((k["exam"], s["no"], i, it["id"], a[:44]))

    print(f"全 {total} 項目を確認")
    print(f"\n■ 表の見出し・注記が設問化された疑い: {len(headers)} 件")
    for e, no, i, qid, a in headers:
        print(f"   {e} 問{no} [{i}] id={qid} : {a!r}")
    print(f"\n■ 小問番号が解答文に食い込んでいる疑い: {len(leaks)} 件")
    for e, no, i, qid, a in leaks[:40]:
        print(f"   {e} 問{no} [{i}] id={qid} : {a!r}")
    if len(leaks) > 40:
        print(f"   ... 他 {len(leaks) - 40} 件")
    print(f"\n■ 社名の頭文字を空欄と誤認して解答の先頭を削った疑い: {len(cuts)} 件")
    for e, no, i, qid, a in cuts[:20]:
        print(f"   {e} 問{no} [{i}] id={qid} : {a!r}")
    if empties:
        print(f"\n■ 解答例が空: {len(empties)} 件")
        for e, no, i, qid, _ in empties[:20]:
            print(f"   {e} 問{no} [{i}] id={qid}")

    bad = len(headers) + len(leaks) + len(empties) + len(cuts)
    print(f"\n要確認 合計 {bad} 件 / {total} 項目（{bad / max(1, total) * 100:.1f}%）")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
