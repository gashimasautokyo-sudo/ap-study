# -*- coding: utf-8 -*-
"""生成した問題バンクの総点検。解答PDFを正典として全問を突き合わせる。

    py -3.12 tools/validate_bank.py

build_bank.py の整合検査と重複するが、こちらは「出来上がった questions.json」
だけを入力に、独立した経路でもう一度検証する（生成側のバグを拾うため）。
確認済みの例外は tools/field_exceptions.json に記録されたものだけを許す。
異常があれば終了コード 1 を返す。
"""

from __future__ import annotations

import base64
import json
import re
import sys
import unicodedata
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BANK = ROOT / "app" / "data" / "questions.json"
VER = ROOT / "app" / "data" / "version.json"
ANS = ROOT / "work" / "answers"
EXC = ROOT / "tools" / "field_exceptions.json"
KEYS = ["ア", "イ", "ウ", "エ"]
PNG_SIG = b"\x89PNG\r\n\x1a\n"


def main() -> int:
    if not BANK.exists():
        print(f"{BANK} がありません。先に tools/build_bank.py を実行してください。")
        return 1

    bank = json.loads(BANK.read_text(encoding="utf-8"))
    qs, exams = bank["questions"], bank["exams"]
    exceptions = (json.loads(EXC.read_text(encoding="utf-8")).get("exceptions", {})
                  if EXC.exists() else {})

    print(f"schema={bank.get('schema')} stamp={bank.get('stamp')} "
          f"generated={bank.get('generated')}")
    print(f"試験回 {len(exams)} / 問題 {len(qs)}")

    fail: list[str] = []
    waived: list[str] = []

    # version.json と本体のスタンプが一致しているか（起動時の更新判定に使われる）
    if VER.exists():
        v = json.loads(VER.read_text(encoding="utf-8"))
        if v.get("stamp") != bank.get("stamp"):
            fail.append(f"version.json のスタンプ({v.get('stamp')}) が本体({bank.get('stamp')})と不一致")
        if v.get("questions") != len(qs):
            fail.append(f"version.json の問題数({v.get('questions')}) が本体({len(qs)})と不一致")
    else:
        fail.append("version.json がない（アプリが更新を検知できない）")

    # ID の一意性と問番号の連続性
    dup = [k for k, n in Counter(q["id"] for q in qs).items() if n > 1]
    if dup:
        fail.append(f"id 重複: {dup[:5]}")
    for e in exams:
        nos = sorted(q["no"] for q in qs if q["examId"] == e["id"])
        if nos != list(range(1, 81)):
            missing = sorted(set(range(1, 81)) - set(nos))
            fail.append(f"{e['id']} の問番号が 1..80 でない（{len(nos)}問／欠番 {missing[:10]}）")

    # 解答PDF（正典）との突き合わせ
    for e in exams:
        p = ANS / f"{e['id']}.json"
        if not p.exists():
            fail.append(f"{e['id']} の解答キーがない")
            continue
        key = json.loads(p.read_text(encoding="utf-8"))
        ans, grp = key["answers"], key["groups"]
        for q in (x for x in qs if x["examId"] == e["id"]):
            want = ans.get(str(q["no"]))
            if q["answer"] != want:
                fail.append(f"{q['id']} 正解 {q['answer']} != 解答PDF {want}")
            g = grp.get(str(q["no"]))
            if g and q["field"] and q["field"][0] != g:
                if q["id"] in exceptions:
                    waived.append(f"{q['id']} 系統 {q['field']} vs 解答PDF {g}（確認済み）")
                else:
                    fail.append(f"{q['id']} 系統 {q['field']} != 解答PDF {g}")

    # 大分野欄がない回（平成27年度以前）の代替チェック。
    # 応用情報は T→M→S の順にまとまって並ぶので、系統が単調に進むはずである。
    # 途切れる問題は分類ミスの疑いが濃い。
    warn: list[str] = []
    for e in exams:
        p = ANS / f"{e['id']}.json"
        if not p.exists() or json.loads(p.read_text(encoding="utf-8")).get("groups"):
            continue
        seq = [(q["no"], (q.get("field") or "?")[0])
               for q in sorted((x for x in qs if x["examId"] == e["id"]),
                               key=lambda x: x["no"])]
        rank = {"T": 0, "M": 1, "S": 2}
        outliers = []
        best = 0
        for no, g in seq:
            r = rank.get(g, -1)
            if r < 0:
                continue
            if r < best:
                outliers.append((no, g))
            else:
                best = r
        bounds = {}
        for no, g in seq:
            bounds.setdefault(g, no)
        b = " ".join(f"{g}:問{n}〜" for g, n in sorted(bounds.items(), key=lambda kv: kv[1]))
        if outliers:
            msg = (f"{e['id']} 系統の並びが単調でない（{b}）: "
                   + ", ".join(f"問{n}={g}" for n, g in outliers[:8]))
            if len(outliers) > 2:
                fail.append(msg)
            else:
                warn.append(msg)

    # 中身の欠損
    for q in qs:
        if len(q["text"]) < 8:
            fail.append(f"{q['id']} 本文が短い（{len(q['text'])}字）")
        ch = q.get("choices") or {}
        if sorted(ch.keys()) != sorted(KEYS):
            fail.append(f"{q['id']} 選択肢キーが不正")
        elif any(not str(ch[k]).strip() for k in KEYS):
            fail.append(f"{q['id']} 空の選択肢")
        if q["answer"] not in KEYS:
            fail.append(f"{q['id']} 正解が不正 {q['answer']!r}")
        if not q.get("explanation"):
            fail.append(f"{q['id']} 解説なし")
        if q.get("field") == "X00":
            fail.append(f"{q['id']} 分野未分類")

    # 再出題（同じ問題文が複数の回に出る）の整合。
    # IPA は選択肢の並びを変えて再出題するので、記号が違うのは正常。
    # 見るべきは (1) 選択肢の中身まで同じ版で正解が食い違わないか、(2) 分野の割当が揃っているか。
    def norm_txt(s: str) -> str:
        s = unicodedata.normalize("NFKC", s or "")
        s = re.sub(r"\s+", "", s)
        for a, b in [("，", ","), ("．", "."), ("（", "("), ("）", ")"),
                     ("−", "-"), ("－", "-"), ("、", ",")]:
            s = s.replace(a, b)
        return s

    dup: dict[str, list] = {}
    for q in qs:
        dup.setdefault(norm_txt(q["text"]), []).append(q)
    dup = {k: v for k, v in dup.items() if len(v) > 1}

    for v in dup.values():
        sets = {frozenset(norm_txt(x) for x in (q.get("choices") or {}).values()) for q in v}
        if len(sets) == 1:
            corr = {norm_txt((q.get("choices") or {}).get(q["answer"], "")) for q in v}
            if len(corr) > 1:
                fail.append("再出題で正解が食い違う（選択肢は同一）: "
                            + " / ".join(f"{q['id']}={q['answer']}" for q in v))
        fields = {q.get("field") for q in v}
        if len(fields) > 1:
            warn.append("再出題で分野の割当が不一致: "
                        + " / ".join(f"{q['id']}={q['field']}" for q in v)
                        + f" — {v[0]['text'][:36]}")

    # 図表画像が実データとして成立しているか
    figs = 0
    for q in qs:
        for u in q.get("figures") or []:
            if not isinstance(u, str) or not u.startswith("data:image/png;base64,"):
                fail.append(f"{q['id']} figure の形式が不正")
                continue
            try:
                b = base64.b64decode(u.split(",", 1)[1])
            except Exception as ex:
                fail.append(f"{q['id']} figure をデコードできない: {ex}")
                continue
            if b[:8] != PNG_SIG:
                fail.append(f"{q['id']} PNG シグネチャ不正")
            figs += 1

    # 統計
    exp = [len(q.get("explanation", "")) for q in qs]
    txt = [len(q["text"]) for q in qs]
    print(f"\n図表画像 {figs} 枚 / 図表つき問題 {sum(1 for q in qs if q.get('figures'))} 問")
    print(f"本文 平均{sum(txt)//len(txt)}字（最短{min(txt)} 最長{max(txt)}）")
    print(f"解説 平均{sum(exp)//len(exp)}字（最短{min(exp)} 最長{max(exp)}）")
    print(f"要確認フラグ {sum(1 for q in qs if q.get('needsReview'))} 問")
    print("正解の分布:", dict(sorted(Counter(q["answer"] for q in qs).items())))

    fc = Counter(q["fieldName"] for q in qs)
    print(f"\n分野 {len(fc)} 種:")
    for k, n in fc.most_common():
        print(f"   {k:26s} {n:4d}")

    print()
    if waived:
        print(f"確認済みの例外 {len(waived)} 件:")
        for w in waived:
            print("   -", w)
        print()
    if warn:
        print(f"△ 警告 {len(warn)} 件（エラーにはしないが目視確認が要る）:")
        for w in warn:
            print("   -", w)
        print()
    if fail:
        print(f"!! 検証エラー {len(fail)} 件")
        for f in fail[:40]:
            print("   -", f)
        if len(fail) > 40:
            print(f"   ... 他 {len(fail) - 40} 件")
        return 1
    print("すべての検証項目に合格")
    return 0


if __name__ == "__main__":
    sys.exit(main())
