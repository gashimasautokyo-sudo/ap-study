# -*- coding: utf-8 -*-
"""工程③の抽出結果に入っている `answer` が、解答PDF（正典）と一致するかを全回横断で監査する。

    py -3.12 tools/audit_answers.py

なぜ必要か:
    build_bank.py は正解を必ず解答PDFで上書きするので、バンクの `answer` は常に正しい。
    しかし **解説は抽出時の answer を前提に書かれている**ため、抽出側がずれていると
    「正解はア」と表示しながら解説がイを正当化する、という食い違いが起きる。
    この監査はその危険な組み合わせだけを洗い出す。

出力: 不一致があった問題の一覧（exam, 問番号, 抽出answer, 正典answer, ファイル）
      1件でもあれば終了コード 1
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXTRACTED = ROOT / "work" / "extracted"
ANSWERS = ROOT / "work" / "answers"
KEYS = {"ア", "イ", "ウ", "エ"}


def main() -> int:
    keys: dict[str, dict[str, str]] = {}
    for p in sorted(ANSWERS.glob("*.json")):
        k = json.loads(p.read_text(encoding="utf-8"))
        keys[k["exam"]] = k.get("answers", {})

    bad: list[tuple] = []
    missing: list[tuple] = []
    total = 0

    for p in sorted(EXTRACTED.glob("*.json")):
        obj = json.loads(p.read_text(encoding="utf-8"))
        exam = obj.get("exam") or p.stem.split("_")[0]
        key = keys.get(exam)
        if key is None:
            print(f"!! {p.name}: 解答キーがない（exam={exam}）")
            continue
        for q in obj.get("questions", []):
            no = q.get("no")
            got = str(q.get("answer", "")).strip()
            want = key.get(str(no))
            total += 1
            if got not in KEYS:
                missing.append((exam, no, got, want, p.name))
            elif want and got != want:
                bad.append((exam, no, got, want, p.name))

    print(f"照合した問題 {total}")
    if missing:
        print(f"\n!! answer が不正な問題 {len(missing)} 件")
        for e, n, g, w, f in missing[:20]:
            print(f"   {e} 問{n}: answer={g!r} 正典={w}  ({f})")
    if bad:
        print(f"\n!! 抽出 answer が正典と不一致 {len(bad)} 件")
        print("   → この問題は解説が誤った選択肢を正解として書かれている可能性が高い")
        for e, n, g, w, f in bad:
            print(f"   {e} 問{n}: 抽出={g} / 正典={w}  ({f})")
    if not bad and not missing:
        print("\nすべての抽出結果の answer が解答PDFと一致（解説の前提もずれていない）")
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
