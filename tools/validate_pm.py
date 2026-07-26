# -*- coding: utf-8 -*-
"""午後バンクの総点検。build_pm_bank.py とは独立に pm.json だけを入力に検証する。

    py -3.12 tools/validate_pm.py

見るところ:
    - 大問が 11（古い回は12）そろっているか
    - **設問IDが解答例（正典）と過不足なく一致するか** … 取りこぼしの検出
    - 解答例・出題趣旨・採点講評が空でないか
    - 本文が短すぎないか（午後の大問は数千字あるはず。極端に短ければ転記漏れ）
    - 解答群つき設問で、解答例の記号が解答群の中にあるか
    - 図の data URI が PNG として成立しているか
    - pm-version.json と本体のスタンプが一致するか
異常があれば終了コード 1。
"""

from __future__ import annotations

import base64
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BANK = ROOT / "app" / "data" / "pm.json"
VER = ROOT / "app" / "data" / "pm-version.json"
ANS = ROOT / "work" / "pm_answers"
PNG_SIG = b"\x89PNG\r\n\x1a\n"

MIN_BODY_CHARS = 800     # 午後の大問の本文はこれよりずっと長いのが普通


def main() -> int:
    if not BANK.exists():
        print(f"{BANK} がありません。先に tools/build_pm_bank.py を実行してください。")
        return 1
    bank = json.loads(BANK.read_text(encoding="utf-8"))
    secs, exams = bank["sections"], bank["exams"]
    print(f"schema={bank.get('schema')} stamp={bank.get('stamp')} generated={bank.get('generated')}")
    print(f"試験回 {len(exams)} / 大問 {len(secs)} / 設問 {sum(len(s['questions']) for s in secs)}")

    fail: list[str] = []
    warn: list[str] = []

    if VER.exists():
        v = json.loads(VER.read_text(encoding="utf-8"))
        if v.get("stamp") != bank.get("stamp"):
            fail.append(f"pm-version.json のスタンプが本体と不一致（{v.get('stamp')} / {bank.get('stamp')}）")
    else:
        fail.append("pm-version.json がない（アプリが更新を検知できない）")

    dup = [k for k, n in Counter(s["id"] for s in secs).items() if n > 1]
    if dup:
        fail.append(f"大問ID重複: {dup[:5]}")

    by_exam: dict[str, list] = {}
    for s in secs:
        by_exam.setdefault(s["examId"], []).append(s)

    figs = 0
    for eid, ss in sorted(by_exam.items()):
        p = ANS / f"{eid}.json"
        if not p.exists():
            fail.append(f"{eid} の解答例（正典）がない")
            continue
        key = json.loads(p.read_text(encoding="utf-8"))
        want_secs = {x["no"]: x for x in key["sections"]}
        got_nos = sorted(s["no"] for s in ss)
        missing_sec = sorted(set(want_secs) - set(got_nos))
        if missing_sec:
            warn.append(f"{eid}: 未抽出の大問 {missing_sec}")

        for s in ss:
            tag = f"{eid} 問{s['no']}"
            ks = want_secs.get(s["no"])
            if not ks:
                fail.append(f"{tag}: 解答例に該当の大問がない")
                continue

            # 設問IDの照合（この検査が午後の要）
            want = [i["id"] for i in ks["items"]]
            got = [q["id"] for q in s["questions"]]
            if want != got:
                miss = [i for i in want if i not in got]
                extra = [i for i in got if i not in want]
                fail.append(f"{tag}: 設問IDが解答例と不一致"
                            + (f" / 欠落 {miss}" if miss else "")
                            + (f" / 余分 {extra}" if extra else "")
                            + ("" if miss or extra else " / 順序違い"))

            for q in s["questions"]:
                if not q.get("answer"):
                    # IPA の解答例PDF自体に解答が無い箇所（表や作図の解答）は、
                    # 理由を note に書いたうえで空にしてある。理由なしの空はエラー。
                    if q.get("note"):
                        warn.append(f"{tag} {q['id']}: 解答例なし（{q['note']}）")
                    else:
                        fail.append(f"{tag} {q['id']}: 解答例が空")
                if not q.get("prompt"):
                    warn.append(f"{tag} {q['id']}: 設問文が空")
                ch = q.get("choices")
                if ch and q.get("kind") == "choice":
                    if q["answer"] not in ch:
                        warn.append(f"{tag} {q['id']}: 解答例「{q['answer']}」が解答群にない")

            body_chars = sum(len(b.get("text", "")) + len(b.get("md", ""))
                             for b in s.get("body", []))
            if body_chars < MIN_BODY_CHARS:
                warn.append(f"{tag}: 本文が{body_chars}字と短い（転記漏れの疑い）")
            if not s.get("intent"):
                warn.append(f"{tag}: 出題趣旨が空")
            if not s.get("commentary"):
                warn.append(f"{tag}: 採点講評が空")

            for b in s.get("body", []):
                if b.get("type") != "fig":
                    continue
                src = b.get("src", "")
                if not src.startswith("data:image/png;base64,"):
                    fail.append(f"{tag}: 図の形式が不正")
                    continue
                try:
                    if base64.b64decode(src.split(",", 1)[1])[:8] != PNG_SIG:
                        fail.append(f"{tag}: PNGシグネチャ不正")
                    else:
                        figs += 1
                except Exception as e:
                    fail.append(f"{tag}: 図をデコードできない: {e}")

    kinds = Counter(q["kind"] for s in secs for q in s["questions"])
    bodies = [sum(len(b.get("text", "")) + len(b.get("md", "")) for b in s["body"]) for s in secs]
    print(f"\n図 {figs} 枚")
    print(f"本文 平均{sum(bodies)//max(1,len(bodies))}字（最短{min(bodies)} 最長{max(bodies)}）")
    print("設問の形式:", dict(kinds))
    print("分野:", dict(Counter(s["name"] for s in secs)))

    print()
    if warn:
        print(f"△ 警告 {len(warn)} 件:")
        for w in warn[:25]:
            print("   -", w)
        if len(warn) > 25:
            print(f"   ... 他 {len(warn) - 25} 件")
        print()
    if fail:
        print(f"!! 検証エラー {len(fail)} 件")
        for f in fail[:30]:
            print("   -", f)
        if len(fail) > 30:
            print(f"   ... 他 {len(fail) - 30} 件")
        return 1
    print("すべての検証項目に合格")
    return 0


if __name__ == "__main__":
    sys.exit(main())
