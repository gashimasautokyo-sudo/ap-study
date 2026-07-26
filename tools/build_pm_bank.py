# -*- coding: utf-8 -*-
"""午後 工程④: 解答例（正典）と問題文の抽出結果を突き合わせてアプリ用データを作る。

    py -3.12 tools/build_pm_bank.py --pdf-dir "D:\\path\\to\\午後フォルダ"

入力
    work/pm_answers/<exam>.json     工程①（正解・出題趣旨・採点講評）— 正典
    work/pm_extracted/<exam>*.json  工程③（問題文・設問文・解答群・図の位置）
    午後の問題PDF                    図の切り出し元

出力
    app/data/pm.json / pm-version.json
    tools/pm_build_report.md

照合
    工程③の設問IDが、工程①の設問IDと過不足なく一致するかを見る。
    午前の「正解が解答PDFと一致するか」に相当する検査で、設問の取りこぼしを機械的に拾える。
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

try:
    import fitz
except ImportError:
    fitz = None

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pm_sections import code_from_label, name as sec_name  # noqa: E402
from sw_cache import stamp_sw  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / "work"
ANS = WORK / "pm_answers"
EXT = WORK / "pm_extracted"
OUT = ROOT / "app" / "data" / "pm.json"
OUT_VER = ROOT / "app" / "data" / "pm-version.json"
REPORT = ROOT / "tools" / "pm_build_report.md"

PDF_RE = re.compile(r"^(?P<ad>\d{4})(?P<era>[hr])(?P<n>\d{2})(?P<season>tokubetsu|[hao])_ap_pm_qs$")


def find_qs(pdf_dir: Path, exam: str) -> Path | None:
    for p in pdf_dir.glob("*_ap_pm_qs.pdf"):
        m = PDF_RE.match(p.stem)
        if not m:
            continue
        d = m.groupdict()
        sid = "t" if d["season"] == "tokubetsu" else d["season"]
        if f"{d['era']}{d['n']}{sid}" == exam:
            return p
    return None


def crop(doc, page: int, top: float, bottom: float, max_kb: int) -> str | None:
    if page < 0 or page >= doc.page_count:
        return None
    pg = doc[page]
    pix = pg.get_pixmap(matrix=fitz.Matrix(2.0, 2.0), colorspace=fitz.csGRAY)
    g = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width)
    H, W = g.shape
    y0, y1 = int(max(0, top) * H), int(min(1, bottom) * H)
    if y1 - y0 < 10:
        return None
    ink = g < 170
    rows = ink[y0:y1].sum(axis=1) >= 2
    # 内側の余白を詰める
    idx = np.where(rows)[0]
    if idx.size:
        y0, y1 = y0 + int(idx[0]) - 6, y0 + int(idx[-1]) + 7
    band = ink[max(0, y0):min(H, y1)]
    cols = np.where(band.sum(axis=0) > 0)[0]
    x0 = max(0, int(cols[0]) - 8) if cols.size else 0
    x1 = min(W, int(cols[-1]) + 9) if cols.size else W
    img = Image.fromarray(g[max(0, y0):min(H, y1), x0:x1])
    data = b""
    for sc in (1.0, 0.85, 0.7, 0.55):
        im = img if sc == 1.0 else img.resize(
            (max(1, int(img.width * sc)), max(1, int(img.height * sc))), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, format="PNG", optimize=True)
        data = buf.getvalue()
        if len(data) <= max_kb * 1024:
            break
    return "data:image/png;base64," + base64.b64encode(data).decode("ascii")


def load_extracted(exam: str) -> dict[int, dict]:
    out: dict[int, dict] = {}
    for p in sorted(EXT.glob(f"{exam}_*.json")):
        try:
            obj = json.loads(p.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"  !! {p.name}: {e}")
            continue
        for s in obj.get("sections", []):
            try:
                out[int(s["no"])] = s
            except (KeyError, TypeError, ValueError):
                continue
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf-dir", required=True)
    ap.add_argument("--only", nargs="*", default=None)
    ap.add_argument("--fig-max-kb", type=int, default=160)
    args = ap.parse_args()

    pdf_dir = Path(args.pdf_dir)
    keys = {}
    for p in sorted(ANS.glob("*.json")):
        k = json.loads(p.read_text(encoding="utf-8"))
        keys[k["exam"]] = k
    if not keys:
        print("work/pm_answers が空です。先に tools/extract_pm_answers.py を実行してください。")
        return 1

    exams, sections, issues, logs = [], [], [], []
    for eid, key in sorted(keys.items(), key=lambda kv: kv[1].get("order", 0)):
        if args.only and eid not in args.only:
            continue
        ext = load_extracted(eid)
        if not ext:
            continue

        doc = None
        qs = find_qs(pdf_dir, eid)
        if qs and fitz:
            doc = fitz.open(qs)

        exams.append({"id": eid, "label": key["label"], "year": key.get("year"),
                      "season": key.get("season"), "order": key.get("order", 0)})
        n_fig = 0
        for sec in key["sections"]:
            no = sec["no"]
            e = ext.get(no)
            if not e:
                continue
            # notes は要対応（人が直すもの）、infos は意図どおりに処理した記録
            notes, infos = [], []

            # --- 設問IDの照合（午前の正解照合に相当する検査）---
            # 対応付けは「位置」を優先する。理由は2つ:
            #  - 解答例には同じID（「設問4」など）が複数出るので、IDはキーにできない
            #  - 解答例側の解析を直すとIDの付き方が変わるが、行の並び順は変わらない
            # どちらも同じ表を同じ順に読んでいるので、件数が合えば位置対応が正しい。
            want = [it["id"] for it in sec["items"]]
            exq = e.get("questions", [])
            got = [str(q.get("id", "")) for q in exq]
            by_pos = (len(want) == len(exq))

            if by_pos:
                # 件数と並びが合っていれば ID の表記差は実害がない。
                # 解答例側の解析を直すと必ずここに来るので、要対応には数えない。
                if want != got:
                    infos.append("設問IDの表記差は位置で対応付けた（解答例側を再解析した影響）")
            else:
                # ここが本当の異常。件数が合わないので設問の取りこぼしか重複がある。
                notes.append(f"設問の件数が合わない: 解答例{len(want)}件 / 問題文側{len(exq)}件")
                missing = [i for i in want if i not in got]
                extra = [i for i in got if i not in want]
                if missing:
                    notes.append("解答例にあるが問題文側に無い設問: " + ", ".join(missing))
                if extra:
                    notes.append("問題文側にあるが解答例に無い設問: " + ", ".join(extra))
                qmap: dict[str, dict] = {}
                for q in exq:
                    qmap.setdefault(str(q.get("id", "")), q)

            questions = []
            for idx, it in enumerate(sec["items"]):
                q = (exq[idx] if by_pos and idx < len(exq) else qmap.get(it["id"], {}))
                questions.append({
                    # key は端末に解答を保存するための一意キー。id は表示用（重複しうる）
                    "key": f"q{idx + 1}",
                    "id": it["id"], "label": it["q"], "sub": it["sub"], "blank": it["blank"],
                    "prompt": str(q.get("prompt", "")).strip(),
                    "choices": q.get("choices") or None,
                    "kind": it["kind"], "answer": it["answer"], "note": it.get("note", ""),
                    "limit": q.get("limit"),
                })
            if len(set(want)) != len(want):
                infos.append("解答例に同じ設問IDが複数ある（表示用。保存キーは別に採番済み）")

            # --- 本文（図は切り出して埋め込む）---
            body = []
            for b in e.get("body", []):
                if b.get("type") == "fig":
                    src = None
                    if doc is not None:
                        try:
                            src = crop(doc, int(b.get("page", -1)),
                                       float(b.get("top", 0)), float(b.get("bottom", 1)),
                                       args.fig_max_kb)
                        except Exception as ex:
                            notes.append(f"図の切り出しに失敗: {ex}")
                    if src:
                        body.append({"type": "fig", "src": src,
                                     "caption": b.get("caption", "")})
                        n_fig += 1
                    else:
                        notes.append("図を切り出せなかった: " + str(b.get("caption", "")))
                else:
                    body.append(b)

            # 分野は〔問題一覧〕の表記（IPAが冊子に明記）を正典とし、
            # 解答例テキストからの推定はそれが無いときだけ使う
            code = code_from_label(e.get("fieldLabel", "")) or sec["field"]
            if code != sec["field"]:
                infos.append(f"分野を〔問題一覧〕に合わせて修正: 推定{sec['field']} → {code}"
                             f"（冊子表記「{e.get('fieldLabel','')}」）")

            sections.append({
                "id": f"{eid}-pm{no}", "examId": eid, "no": no,
                "field": code, "name": sec_name(code),
                "fieldLabel": e.get("fieldLabel", ""),
                "theme": e.get("theme", ""), "required": bool(e.get("required", no == 1)),
                "body": body, "questions": questions,
                "intent": sec.get("intent", ""), "commentary": sec.get("commentary", ""),
            })
            if notes:
                issues.append((eid, no, notes))
            if infos:
                logs.append((eid, no, infos))

        if doc is not None:
            doc.close()
        done = len([s for s in sections if s["examId"] == eid])
        print(f"組み立て: {key['label']} ({eid})  大問{done}  図{n_fig}")

    if not sections:
        print("work/pm_extracted に問題文の抽出結果がありません。")
        return 1

    payload = {"kind": "ap-study-pm", "schema": 1,
               "generated": datetime.now().strftime("%Y-%m-%d %H:%M"),
               "exams": exams, "sections": sections}
    # stamp は「中身が変わったか」を表す。生成時刻を混ぜると内容が同じでも毎回変わり、
    # 端末が 16MB を再取得してしまうので generated は除いて取る。
    body = json.dumps({k: v for k, v in payload.items() if k != "generated"},
                      ensure_ascii=False, sort_keys=True)
    payload["stamp"] = hashlib.sha1(body.encode("utf-8")).hexdigest()[:12]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    OUT_VER.write_text(json.dumps(
        {"stamp": payload["stamp"], "generated": payload["generated"],
         "exams": len(exams), "sections": len(sections)},
        ensure_ascii=False, indent=1), encoding="utf-8")

    # Service Worker のキャッシュ名を変える。ここを変えないと端末が古い
    # index.html や js を使い続け、データだけ新しいという状態になる。
    cache = stamp_sw(ROOT / "app", payload["stamp"])

    L = ["# 午後 問題バンク レポート", "",
         f"生成 {payload['generated']}", "",
         f"- 試験回 {len(exams)} / 大問 {len(sections)}",
         f"- 設問 {sum(len(s['questions']) for s in sections)}",
         f"- 要対応 {len(issues)} 大問",
         f"- 参考（意図どおり処理した記録） {len(logs)} 大問", "",
         "## 要対応", ""]
    L += [f"- {eid} 問{no}: " + " / ".join(n) for eid, no, n in issues] or ["なし"]
    L += ["", "## 参考", ""]
    L += [f"- {eid} 問{no}: " + " / ".join(n) for eid, no, n in logs] or ["なし"]
    REPORT.write_text("\n".join(L), encoding="utf-8")

    mb = OUT.stat().st_size / 1024 / 1024
    print(f"\n  app/data/pm.json  {mb:.1f} MB  ({len(sections)} 大問 / {len(exams)} 回)")
    print(f"  app/data/pm-version.json  stamp={payload['stamp']}")
    print(f"  tools/pm_build_report.md  要対応 {len(issues)} 大問 / 参考 {len(logs)} 大問")
    print(f"  app/sw.js  CACHE={cache}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
