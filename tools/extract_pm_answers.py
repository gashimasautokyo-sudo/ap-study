# -*- coding: utf-8 -*-
"""午後 工程①: 解答例PDFと採点講評PDFから、大問ごとの正典データを取り出す。

    py -3.12 tools/extract_pm_answers.py --pdf-dir "D:\\path\\to\\応用情報技術者試験午後問題、回答"

午後の解答例PDFはテキスト層があり、しかも設問が「表」として入っているので確実に取れる。
ここで得た「大問ごとの設問リスト」が、工程③（問題文の読み取り）の照合基準になる。

出力: work/pm_answers/<exam_id>.json
    {
      "exam": "r07a", "label": "令和7年度 秋期",
      "sections": [
        {"no":1, "name":"情報セキュリティ", "field":"T11",
         "intent":"出題趣旨…", "commentary":"採点講評…",
         "items":[
           {"id":"設問1-a", "q":"設問1", "sub":null, "blank":"a",
            "answer":"ク", "note":"", "kind":"choice"},
           {"id":"設問3-(2)", "q":"設問3", "sub":"(2)", "blank":null,
            "answer":"不正の発覚リスクが…", "note":"", "kind":"write"}
         ]}
      ]
    }

kind は解答例の形から推定する:
    choice … 記号1文字（ア〜ン / a〜z）だけ → アプリで自動採点できる
    short  … 20字以内の語句・数値      → 自己採点だが正誤判定しやすい
    write  … それ以上の記述            → 自己採点
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
from pm_sections import am_field, assign as assign_sections, name as sec_name  # noqa: E402

MAX_SECTIONS = 12   # 平成25年度春期以前は12大問だった

ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / "work" / "pm_answers"

FNAME = re.compile(r"^(?P<ad>\d{4})(?P<era>[hr])(?P<n>\d{2})(?P<season>tokubetsu|[hao])_ap_pm_(?P<kind>qs|ans|cmnt)$")
SEASON_JA = {"h": "春期", "a": "秋期", "o": "秋期", "tokubetsu": "特別"}
SEASON_ORDER = {"h": 10, "tokubetsu": 15, "a": 20, "o": 20}
SEASON_EN = {"h": "spring", "a": "autumn", "o": "autumn", "tokubetsu": "special"}

# IPA の PDF は「問１」「設問２(1)」のように全角数字を使う。
# 数字だけ半角に直してから判定する（本文の記号は原文のまま残したいので全体 NFKC はしない）。
Z2H = str.maketrans("０１２３４５６７８９（）", "0123456789()")

SETSUMON = re.compile(r"^設問\s*([0-9]{1,2})")
SUB = re.compile(r"^\(([0-9]{1,2})\)$")
BLANK_KEY = re.compile(r"^[a-zA-Zａ-ｚＡ-Ｚ]$|^[ア-ヶ]$")
CHOICE_ANS = re.compile(r"^[ア-ヶa-zA-Z]$")


def nfkc(s: str) -> str:
    return unicodedata.normalize("NFKC", s or "").strip()


def digits(s: str) -> str:
    """数字と括弧だけ半角化する。"""
    return (s or "").translate(Z2H)


# 大文字ラテン1文字は、午後では空欄記号よりも社名・人名・製品名の頭文字である方が多い
# （「A 社しか…」「X 君が…」「M システムの…」）。IPA の組版は A と 社 の間を空けるので、
# 空欄記号と見分けが付かず解答文の先頭を削ってしまう。続きの1文字と長さで切り分ける。
NAME_SUFFIX = "社君氏，、"


def _is_blank_mark(mark: str, rest: str) -> bool:
    """先頭1文字を空欄記号として切り出してよいかを判定する。"""
    if not mark.isupper() or not mark.isascii():
        return True  # 小文字 a〜z とカタカナ ア〜ヶ は空欄記号として使われる
    return bool(rest) and rest[0] not in NAME_SUFFIX and len(rest) <= 8


def clean(s: str | None) -> str:
    if not s:
        return ""
    s = s.replace("\n", " ").replace("\u3000", " ")
    return re.sub(r"\s{2,}", " ", s).strip()


def clean_prose(s: str | None) -> str:
    """\u51fa\u984c\u8da3\u65e8\u30fb\u63a1\u70b9\u8b1b\u8a55\u306e\u672c\u6587\u3002\u6539\u884c\u306f\u6bb5\u843d\u3068\u3057\u3066\u6b8b\u3057\u3001\u30da\u30fc\u30b8\u756a\u53f7\u3084\u8457\u4f5c\u6a29\u8868\u793a\u3092\u843d\u3068\u3059\u3002"""
    if not s:
        return ""
    s = re.sub(r"\n?\s*\d+\s*/\s*\d+\s*\n", "\n", s)
    s = re.sub(r"\u00a9\d{4}\s*\u72ec\u7acb\u884c\u653f\u6cd5\u4eba\u60c5\u5831\u51e6\u7406\u63a8\u9032\u6a5f\u69cb\s*", "", s)
    s = re.sub(r"(\u4ee4\u548c|\u5e73\u6210)[\uff10-\uff190-9\u5143]+\s*\u5e74\u5ea6.{0,8}\u5fdc\u7528\u60c5\u5831\u6280\u8853\u8005\u8a66\u9a13\s*(\u89e3\u7b54\u4f8b|\u63a1\u70b9\u8b1b\u8a55)\s*", "", s)
    s = re.sub(r"^\s*\u5348\u5f8c\u8a66\u9a13\s*$", "", s, flags=re.M)
    lines = [ln.strip() for ln in s.split("\n")]
    lines = [ln for ln in lines if ln]
    if not lines:
        return ""
    # PDF \u306e\u884c\u6298\u308a\u8fd4\u3057\u3092\u3064\u306a\u3050\u3002\u6587\u306e\u9014\u4e2d\u3067\u5207\u308c\u3066\u3044\u308b\u884c\u306f\u9023\u7d50\u3057\u3001
    # \u300c\u3002\u300d\u3067\u7d42\u308f\u308b\u884c\u306e\u3042\u3068\u3060\u3051\u6bb5\u843d\u3092\u5206\u3051\u308b\uff08\u548c\u6587\u3069\u3046\u3057\u306f\u8a70\u3081\u308b\uff09
    out = lines[0]
    for ln in lines[1:]:
        prev = out[-1]
        if prev in "\u3002\uff01\uff1f":
            out += "\n" + ln
        else:
            ascii_edge = (prev.isascii() and prev.isalnum()) or (ln[0].isascii() and ln[0].isalnum())
            out += (" " if ascii_edge else "") + ln
    return out.strip()


def parse_name(path: Path) -> dict | None:
    m = FNAME.match(path.stem)
    if not m:
        return None
    d = m.groupdict()
    era = "令和" if d["era"] == "r" else "平成"
    n = int(d["n"])
    nen = "元" if (era == "令和" and n == 1) else str(n)
    sid = "t" if d["season"] == "tokubetsu" else d["season"]
    return {
        "id": f"{d['era']}{d['n']}{sid}",
        "label": f"{era}{nen}年度 {SEASON_JA[d['season']]}",
        "year": int(d["ad"]),
        "season": SEASON_EN[d["season"]],
        "order": int(d["ad"]) * 100 + SEASON_ORDER[d["season"]],
        "kind": d["kind"],
        "path": path,
    }


# ------------------------- 解答例 -------------------------

def doc_text(path: Path) -> str:
    doc = fitz.open(path)
    try:
        return "\n".join(doc[i].get_text() for i in range(doc.page_count))
    finally:
        doc.close()


def split_intents(text: str) -> dict[int, str]:
    """「問N / 出題趣旨 / …本文… / 設問」から出題趣旨を切り出す。"""
    out: dict[int, str] = {}
    t = digits(text)
    pat = re.compile(r"問\s*([0-9]{1,2})\s*\n\s*出題趣旨\s*\n(.*?)(?=\n\s*設問\s*\n)", re.S)
    for m in pat.finditer(t):
        no = int(m.group(1))
        if 1 <= no <= MAX_SECTIONS:
            out[no] = clean_prose(m.group(2))
    return out


def kind_of(answer: str) -> str:
    a = nfkc(answer)
    if CHOICE_ANS.match(a):
        return "choice"
    if len(a) <= 20:
        return "short"
    return "write"


def parse_answer_tables(path: Path) -> list[list[dict]]:
    """PDF内の表を読み順に返す。1つの表が1つの大問に対応する。"""
    doc = fitz.open(path)
    tables: list[list[dict]] = []
    try:
        for pno in range(doc.page_count):
            for t in doc[pno].find_tables().tables:
                rows = t.extract()
                if not rows:
                    continue
                head = " ".join(clean(c) for c in rows[0] if c)
                if "設問" not in head or "解答" not in head:
                    continue
                tables.append(parse_one_table(rows[1:]))
        return tables
    finally:
        doc.close()


def parse_one_table(rows: list[list]) -> list[dict]:
    items: list[dict] = []
    cur_q = ""
    for raw in rows:
        cells = [clean(c) for c in raw]
        while cells and not cells[-1]:
            cells.pop()
        if not cells:
            continue

        # 末尾は備考（表によっては列が無い）
        note = ""
        body = cells[:]
        if len(body) >= 2 and not SETSUMON.match(body[-1]) and len(body[-1]) <= 12 \
                and body[-1] in ("順不同", "順不同可", "いずれか", "※"):
            note = body.pop()

        # 設問ラベル（空欄なら直前を引き継ぐ）。IPA は「設問１」と全角で書く
        if body and SETSUMON.match(digits(body[0])):
            cur_q = digits(body.pop(0)).replace(" ", "")
        elif body and body[0] == "":
            body.pop(0)

        # 小問番号「(1)」。これも全角のことがある
        sub = None
        if body and SUB.match(digits(body[0])):
            sub = digits(body.pop(0))

        body = [b for b in body if b]
        if not body:
            continue

        # 「空欄記号 + 解答」か「解答のみ」か
        blank = None
        if len(body) >= 2 and BLANK_KEY.match(nfkc(body[0])):
            blank = nfkc(body.pop(0))
        answer = " ".join(body).strip()
        if not answer:
            continue

        # 解答が2通りある回（a群／b群）では、その断り書きの行が
        # 設問として拾われてしまう。設問ではないので落とす。
        flat = answer.replace(" ", "")
        if ("群" in flat and ("組合せ" in flat or "同じ群" in flat)) \
                or flat in ("解答例", "備考", "解答の要点"):
            continue

        # 令和4年度秋期以前は表の列構成が違い、小問番号や空欄記号が
        # 解答セルに入り込んでいる（例: 「(1) a 25.0」）。
        # 列として取れていないときだけ、解答文の先頭から切り出す。
        if sub is None:
            m = re.match(r"^\(\s*([0-9]{1,2})\s*\)\s*(.+)$", digits(answer), re.S)
            # 「(3)，(5)」のように番号を並べて答える設問がある。読点が続くときだけは
            # 先頭の (3) を小問番号とみなさない。「(1) ・…」の中黒や「(2) (ⅳ)」の
            # 括弧は小問番号のあとに来る正当な解答なので、切り離してよい。
            if m and m.group(2).lstrip()[:1] not in ("，", "、", ","):
                sub = f"({m.group(1)})"
                answer = m.group(2).strip()
        if blank is None:
            # 「a 25.0」のように、1文字の空欄記号のあとに実際の解答が続く形
            m = re.match(r"^([a-zA-Zア-ヶ])\s+(\S.*)$", answer, re.S)
            if m and not CHOICE_ANS.match(answer) and _is_blank_mark(m.group(1), m.group(2)):
                blank = nfkc(m.group(1))
                answer = m.group(2).strip()
        if not answer:
            continue

        qid = cur_q + (sub or "") + (f"-{blank}" if blank else "")
        items.append({
            "id": qid or f"項目{len(items)+1}",
            "q": cur_q, "sub": sub, "blank": blank,
            "answer": answer, "note": note, "kind": kind_of(answer),
        })
    return items


# IPA の解答例PDFそのものに解答本体が入っていない箇所。
# どちらも解答が「表」や「シーケンス図への作図」で、PDFの表構造に載っていない。
# 小問番号だけが解答セルに残るので、そのままだと「(1)」が正解として自動採点される。
# キーは (試験回, 大問, 解答例の何番目か)。
MISSING_ANSWERS = {
    ("h23t", 6, 7): "設問2(1)：更新後レコードの一覧を答える設問。解答例が表のため取り込めていません。",
    ("h23t", 8, 4): "設問3(1)：シーケンス図に矢印とメッセージ名を記入する設問。解答例が作図のため取り込めていません。",
}


def apply_missing(exam: str, no: int, items: list[dict]) -> None:
    """解答本体が取れなかった項目を、自動採点しない形に直す。"""
    for i, it in enumerate(items):
        note = MISSING_ANSWERS.get((exam, no, i))
        if not note:
            continue
        it["sub"] = it["sub"] or "(1)"
        it["id"] = it["q"] + it["sub"]
        it["answer"] = ""
        it["note"] = note
        it["kind"] = "write"  # 自己採点に回す。誤って×にしないため


# ------------------------- 採点講評 -------------------------

def split_commentary(text: str) -> dict[int, str]:
    """採点講評を大問ごとに切る。「問N」だけの行が見出し。"""
    out: dict[int, str] = {}
    parts = re.split(r"\n\s*問\s*([0-9]{1,2})\s*\n", "\n" + digits(text))
    # parts = [前置き, 番号, 本文, 番号, 本文, ...]
    for i in range(1, len(parts) - 1, 2):
        try:
            no = int(parts[i])
        except ValueError:
            continue
        if 1 <= no <= MAX_SECTIONS:
            out[no] = clean_prose(parts[i + 1])
    return out


# ------------------------- 本体 -------------------------

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf-dir", required=True)
    ap.add_argument("--only", nargs="*", default=None)
    args = ap.parse_args()

    d = Path(args.pdf_dir)
    if not d.exists():
        print(f"{d} がありません。")
        return 1
    WORK.mkdir(parents=True, exist_ok=True)

    exams: dict[str, dict] = {}
    for p in sorted(d.glob("*.pdf")):
        info = parse_name(p)
        if not info:
            continue
        rec = exams.setdefault(info["id"], {k: info[k] for k in
                                           ("id", "label", "year", "season", "order")})
        rec[info["kind"]] = p

    if not exams:
        print("午後のPDFが見つかりません（*_ap_pm_*.pdf）。")
        return 1

    ok, ng = 0, []
    for eid, ex in sorted(exams.items(), key=lambda kv: kv[1]["order"]):
        if args.only and eid not in args.only:
            continue
        if "ans" not in ex:
            print(f"-- {eid} {ex['label']}: 解答例PDFがまだ無いので飛ばす")
            continue

        intents = split_intents(doc_text(ex["ans"]))
        tables = parse_answer_tables(ex["ans"])
        comments = split_commentary(doc_text(ex["cmnt"])) if "cmnt" in ex else {}

        texts = [intents.get(i, "") + "\n" + comments.get(i, "")
                 for i in range(1, len(tables) + 1)]
        assigned = assign_sections(texts)

        sections = []
        for i, items in enumerate(tables, start=1):
            code, score, margin = assigned[i - 1]
            apply_missing(eid, i, items)
            sections.append({
                "no": i,
                "field": code,
                "name": sec_name(code),
                "amField": am_field(code),
                "fieldScore": round(score, 1),
                "fieldMargin": margin,
                "intent": intents.get(i, ""),
                "commentary": comments.get(i, ""),
                "items": items,
            })

        rec = {
            "exam": eid, "label": ex["label"], "year": ex["year"],
            "season": ex["season"], "order": ex["order"],
            "source_ans": ex["ans"].name,
            "source_cmnt": ex["cmnt"].name if "cmnt" in ex else None,
            "sections": sections,
        }
        (WORK / f"{eid}.json").write_text(
            json.dumps(rec, ensure_ascii=False, indent=1), encoding="utf-8")

        n_items = sum(len(s["items"]) for s in sections)
        n_choice = sum(1 for s in sections for it in s["items"] if it["kind"] == "choice")
        n_intent = sum(1 for s in sections if s["intent"])
        n_cmnt = sum(1 for s in sections if s["commentary"])
        n_sec = len(sections)
        # 分野が全11種そろい、重複が2つ以内なら妥当とみなす（同分野が2問出る回もある）
        codes = [s["field"] for s in sections]
        weak = [s["no"] for s in sections if s["fieldMargin"] < 3]
        good = (n_sec in (11, 12) and n_intent == n_sec and n_cmnt == n_sec and not weak)
        mark = "OK " if good else "NG "
        if good:
            ok += 1
        else:
            ng.append(eid)
        print(f"{mark}{eid:6s} {ex['label']:16s} 大問{n_sec:3d}  設問{n_items:4d}"
              f"  趣旨{n_intent:3d} 講評{n_cmnt:3d}  分野{len(set(codes)):2d}種"
              + (f"  判定弱い:問{weak}" if weak else ""))

    print(f"\n完了: 大問11そろった回 {ok} / 不足 {len(ng)}")
    if ng:
        print("不足:", ", ".join(ng))
    return 0


if __name__ == "__main__":
    sys.exit(main())
