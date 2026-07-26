# -*- coding: utf-8 -*-
"""工程④: 抽出結果を突き合わせてアプリ用の問題バンクを作る。

    py -3.12 tools/build_bank.py

入力
    work/answers/<exam>.json        工程①（正解・大分野）— これを正典とする
    work/extracted/<exam>_*.json    工程③（問題文・選択肢・中分野・解説・図の位置）
    work/pages/<exam>/pNNN.png      工程②（図表の切り出し元）

出力
    app/data/questions.js / questions.json
    tools/build_report.md           整合検査の結果

検査内容
    - 問1〜問80 がそろっているか
    - 抽出された正解が解答PDFの正解と一致するか（不一致は解答PDFを採用し報告）
    - 中分野の系統（T/M/S）が解答PDFの大分野と一致するか
    - 問題文・選択肢に空がないか
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
import re
import sys
from datetime import datetime
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ap_fields import GROUP, NAME  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / "work"
OUT_JS = ROOT / "app" / "data" / "questions.js"      # 旧方式。あれば削除する
OUT_JSON = ROOT / "app" / "data" / "questions.json"
OUT_VER = ROOT / "app" / "data" / "version.json"
REPORT = ROOT / "tools" / "build_report.md"
EXCEPTIONS = ROOT / "tools" / "field_exceptions.json"
SW = ROOT / "app" / "sw.js"


def load_exceptions() -> tuple[dict, dict]:
    """(exceptions, field_overrides) を返す。

    exceptions      … 解答PDFの大分野と食い違うが確認済みのもの（照合を免除する）
    field_overrides … 再出題で分野の割当が揃っていないものを揃えるための上書き
    """
    if not EXCEPTIONS.exists():
        return {}, {}
    try:
        obj = json.loads(EXCEPTIONS.read_text(encoding="utf-8"))
        return obj.get("exceptions", {}), obj.get("field_overrides", {})
    except Exception as e:
        print(f"  !! field_exceptions.json を読めません: {e}")
        return {}, {}

KEYS = ["ア", "イ", "ウ", "エ"]
GROUP_LETTER = {"テクノロジ系": "T", "マネジメント系": "M", "ストラテジ系": "S"}


# ---------------------------- 図表の切り出し ----------------------------

def load_page(exam: str, page: int) -> np.ndarray | None:
    p = WORK / "pages" / exam / f"p{page:03d}.png"
    if not p.exists():
        return None
    return np.asarray(Image.open(p).convert("L"))


def snap_band(ink_rows: np.ndarray, y0: int, y1: int, slack: int) -> tuple[int, int]:
    """指定した上下端を、近くの余白行まで広げてから内側の余白を詰める。"""
    n = len(ink_rows)
    y0 = max(0, min(n - 1, y0))
    y1 = max(y0 + 1, min(n, y1))

    # 上へ：余白行に当たるまで広げる
    a = y0
    limit = max(0, y0 - slack)
    while a > limit and ink_rows[a]:
        a -= 1
    # 下へ
    b = y1
    limit = min(n, y1 + slack)
    while b < limit and ink_rows[min(b, n - 1)]:
        b += 1
    # 内側の余白を詰める
    while a < b and not ink_rows[a]:
        a += 1
    while b > a and not ink_rows[b - 1]:
        b -= 1
    return a, max(a + 1, b)


def crop_figure(exam: str, page: int, top: float, bottom: float,
                max_kb: int, pad: int = 8) -> str | None:
    g = load_page(exam, page)
    if g is None:
        return None
    H, W = g.shape
    ink = g < 170
    rows = ink.sum(axis=1) >= 2

    y0 = int(round(top * H))
    y1 = int(round(bottom * H))
    y0, y1 = snap_band(rows, y0, y1, slack=int(H * 0.035))
    if y1 - y0 < 8:
        return None

    band = ink[y0:y1]
    cols = np.where(band.sum(axis=0) > 0)[0]
    if cols.size == 0:
        return None
    x0 = max(0, int(cols[0]) - pad)
    x1 = min(W, int(cols[-1]) + pad + 1)
    y0 = max(0, y0 - pad)
    y1 = min(H, y1 + pad)

    img = Image.fromarray(g[y0:y1, x0:x1])
    for scale in (1.0, 0.85, 0.7, 0.55):
        im = img if scale == 1.0 else img.resize(
            (max(1, int(img.width * scale)), max(1, int(img.height * scale))),
            Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, format="PNG", optimize=True)
        data = buf.getvalue()
        if len(data) <= max_kb * 1024:
            break
    return "data:image/png;base64," + base64.b64encode(data).decode("ascii")


# ---------------------------- 突き合わせ ----------------------------

def load_parts(exam: str) -> dict[int, dict]:
    merged: dict[int, dict] = {}
    for p in sorted((WORK / "extracted").glob(f"{exam}_*.json")):
        try:
            obj = json.loads(p.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"  !! {p.name} を読めません: {e}")
            continue
        for q in obj.get("questions", []):
            try:
                no = int(q.get("no"))
            except (TypeError, ValueError):
                continue
            if not (1 <= no <= 80):
                continue
            cur = merged.get(no)
            # 同じ問が両パートに出たら本文の長いほうを採る
            if cur is None or len(str(q.get("text", ""))) > len(str(cur.get("text", ""))):
                q["_src"] = p.name
                merged[no] = q
    return merged


def build_exam(exam: str, key: dict, args, exceptions: dict, overrides: dict) -> dict:
    parts = load_parts(exam)
    answers = {int(k): v for k, v in key.get("answers", {}).items()}
    groups = {int(k): v for k, v in key.get("groups", {}).items()}

    questions, issues, waived = [], [], []
    fig_count = 0

    for no in range(1, 81):
        q = parts.get(no)
        if q is None:
            issues.append((no, "抽出結果がない"))
            continue

        notes: list[str] = []
        text = str(q.get("text", "")).strip()
        choices = q.get("choices") or {}
        choices = {k: str(choices.get(k, "")).strip() for k in KEYS}

        if len(text) < 8:
            notes.append("問題文が短い")
        empty = [k for k in KEYS if not choices[k]]
        if empty:
            notes.append("空の選択肢: " + "".join(empty))

        # 正解は解答PDFを正典とする
        ans_key = answers.get(no, "")
        ans_ext = str(q.get("answer", "")).strip()
        if ans_key not in KEYS:
            notes.append("解答PDFに正解がない")
            answer = ans_ext if ans_ext in KEYS else ""
            if not answer:
                notes.append("正解が確定できない")
        else:
            answer = ans_key
            if ans_ext in KEYS and ans_ext != ans_key:
                notes.append(f"抽出側の正解({ans_ext})が解答PDF({ans_key})と不一致→解答PDFを採用")

        # 中分野と大分野の整合
        qid = f"{exam}-q{no}"
        field = str(q.get("field", "")).strip() or "X00"
        if field not in NAME:
            notes.append(f"未知の分野コード {field}")
            field = "X00"
        if qid in overrides:
            field = overrides[qid]         # 再出題どうしで分野を揃えるための上書き
        exc = exceptions.get(qid)
        if exc and exc.get("field"):
            field = exc["field"]           # 確認済みの例外は指定の分野で固定する
        want = groups.get(no)
        if want and field != "X00":
            got = GROUP_LETTER.get(GROUP.get(field, ""), "")
            if got != want:
                if exc:
                    waived.append((no, f"解答PDF={want} / 採用={field} — {exc.get('reason', '')}"))
                else:
                    notes.append(f"大分野不一致（解答PDF={want} / 抽出={got}:{field}）")

        # 図表
        figures = []
        fig = q.get("figure")
        if fig:
            specs = fig if isinstance(fig, list) else [fig]
            for sp in specs:
                if not isinstance(sp, dict):
                    continue
                try:
                    pg = int(sp.get("page"))
                    top = float(sp.get("top", 0))
                    bot = float(sp.get("bottom", 1))
                except (TypeError, ValueError):
                    notes.append("figure の指定が読めない")
                    continue
                if not (0 <= top < bot <= 1):
                    notes.append("figure の範囲が不正")
                    continue
                uri = crop_figure(exam, pg, top, bot, args.fig_max_kb)
                if uri:
                    figures.append(uri)
                else:
                    notes.append(f"図表を切り出せなかった（p{pg:03d}）")
            if figures:
                fig_count += 1
            elif "〔図〕" in text or "図" in text:
                notes.append("本文が図を参照しているが画像がない")

        conf = str(q.get("confidence", "")).strip()
        if conf and conf != "high":
            notes.append(f"読み取り確度 {conf}"
                         + (f"（{q.get('note')}）" if q.get("note") else ""))

        questions.append({
            "id": qid,
            "examId": exam,
            "no": no,
            "text": text,
            "choices": choices,
            "answer": answer,
            "field": field,
            "fieldName": NAME.get(field, "未分類"),
            "explanation": str(q.get("explanation", "")).strip(),
            "figures": figures,
            "needsReview": bool(notes),
        })
        if notes:
            issues.append((no, " / ".join(notes)))

    return {
        "exam": exam,
        "meta": {"id": exam, "label": key.get("label", exam), "year": key.get("year"),
                 "season": key.get("season", ""), "order": key.get("order", 0)},
        "questions": questions,
        "issues": issues,
        "waived": waived,
        "fig_count": fig_count,
        "answer_source": key.get("source", ""),
    }


# ---------------------------- 出力 ----------------------------

def write_outputs(results: list[dict]) -> None:
    exams = [r["meta"] for r in results]
    questions = [q for r in results for q in r["questions"]]

    payload = {
        "kind": "ap-study-bank",
        "schema": 2,
        "generated": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "exams": exams,
        "questions": questions,
    }
    # stamp は「中身が変わったか」を表す。生成時刻を混ぜると内容が同じでも毎回変わり、
    # 端末が 10MB を再取得してしまうので generated は除いて取る。
    body = json.dumps({k: v for k, v in payload.items() if k != "generated"},
                      ensure_ascii=False, sort_keys=True)
    payload["stamp"] = hashlib.sha1(body.encode("utf-8")).hexdigest()[:12]

    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    # アプリが fetch する本体。indent なしで小さくする
    OUT_JSON.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

    # 起動時に見る数十バイトの版番号。これが変わったときだけ本体を取りに行く
    OUT_VER.write_text(json.dumps({
        "stamp": payload["stamp"],
        "generated": payload["generated"],
        "exams": len(exams),
        "questions": len(questions),
    }, ensure_ascii=False, indent=1), encoding="utf-8")

    # 旧方式（data/questions.js を script で読む）の残骸があれば消す
    if OUT_JS.exists():
        OUT_JS.unlink()

    if SW.exists():
        src = SW.read_text(encoding="utf-8")
        new = re.sub(r"const CACHE = '[^']*';",
                     f"const CACHE = 'ap-study-{payload['stamp']}';", src, count=1)
        if new != src:
            SW.write_text(new, encoding="utf-8")

    mb = OUT_JSON.stat().st_size / 1024 / 1024
    print(f"\n  app/data/questions.json  {mb:.1f} MB  ({len(questions)} 問 / {len(exams)} 回)")
    print(f"  app/data/version.json    stamp={payload['stamp']}")
    if mb > 25:
        print("  ※ 大きめです。--fig-max-kb を下げると図表画像を削れます。")


def write_report(results: list[dict]) -> None:
    total_q = sum(len(r["questions"]) for r in results)
    total_i = sum(len(r["issues"]) for r in results)
    L = ["# 問題バンク 整合検査レポート", "",
         f"生成 {datetime.now().strftime('%Y-%m-%d %H:%M')}", "",
         f"- 試験回 {len(results)} / 問題 {total_q} / 要確認 {total_i}", ""]
    for r in results:
        qs = r["questions"]
        nos = {q["no"] for q in qs}
        missing = sorted(set(range(1, 81)) - nos)
        unclassified = [q["no"] for q in qs if q["field"] == "X00"]
        noans = [q["no"] for q in qs if not q["answer"]]
        L += [f"## {r['meta']['label']} (`{r['exam']}`)", "",
              f"- 問題数 {len(qs)} / 80" + (f" — **欠番 {missing}**" if missing else " ✓"),
              f"- 図表画像を付けた問題 {r['fig_count']}",
              f"- 正解未確定 {len(noans)}" + (f" → {noans}" if noans else ""),
              f"- 分野未分類 {len(unclassified)}" + (f" → {unclassified}" if unclassified else ""),
              f"- 解答の出所 `{r['answer_source']}`", ""]
        if r.get("waived"):
            L += [f"- 確認済みの例外 {len(r['waived'])} 件:"]
            for no, msg in r["waived"]:
                L.append(f"  - 問{no}: {msg}")
            L.append("")
        if r["issues"]:
            L += ["<details><summary>要確認 " + str(len(r["issues"])) + " 件</summary>", ""]
            for no, msg in r["issues"]:
                L.append(f"- 問{no}: {msg}")
            L += ["", "</details>", ""]
    REPORT.write_text("\n".join(L), encoding="utf-8")
    print(f"  tools/build_report.md")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*", default=None, help="exam_id を指定")
    ap.add_argument("--fig-max-kb", type=int, default=140)
    ap.add_argument("--require-extracted", action="store_true", default=True,
                    help="工程③の結果がある回だけを対象にする（既定）")
    args = ap.parse_args()

    keys = {}
    for p in sorted((WORK / "answers").glob("*.json")):
        k = json.loads(p.read_text(encoding="utf-8"))
        keys[k["exam"]] = k
    if not keys:
        print("work/answers が空です。先に tools/extract_answers.py を実行してください。")
        return 1

    exceptions, overrides = load_exceptions()
    if overrides:
        print(f"分野の上書き {len(overrides)} 件を適用します（再出題どうしの整合）\n")
    results = []
    for eid, key in sorted(keys.items(), key=lambda kv: kv[1].get("order", 0)):
        if args.only and eid not in args.only:
            continue
        if not list((WORK / "extracted").glob(f"{eid}_*.json")):
            continue
        print(f"組み立て: {key.get('label', eid)} ({eid})")
        r = build_exam(eid, key, args, exceptions, overrides)
        ok = len(r["questions"])
        extra = f" / 確認済み例外 {len(r['waived'])}" if r["waived"] else ""
        print(f"  {ok} 問 / 要確認 {len(r['issues'])} 問 / 図表 {r['fig_count']} 問{extra}")
        results.append(r)

    if not results:
        print("work/extracted に抽出結果がありません。工程③を先に実行してください。")
        return 1

    write_outputs(results)
    write_report(results)
    print("\n完了。アプリを開き直すと新しい問題データが自動で取り込まれます。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
