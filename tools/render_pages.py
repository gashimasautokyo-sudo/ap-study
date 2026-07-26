# -*- coding: utf-8 -*-
"""工程②: 問題PDF（スキャン画像）を1ページ1枚のPNGに描画する。

    py -3.12 tools/render_pages.py --pdf-dir "C:\\...\\応用情報技術者試験問題、回答" --only r07a r07h

出力: work/pages/<exam_id>/p003.png ...
      work/pages/<exam_id>/index.json （ページ数・寸法）

この画像を工程③（問題文の構造化）で読む。工程④の図表切り出しでも同じ画像を使う。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import fitz

sys.path.insert(0, str(Path(__file__).resolve().parent))
from exams import discover  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / "work" / "pages"


def render(qs: Path, out_dir: Path, zoom: float, skip_blank: bool) -> dict:
    doc = fitz.open(qs)
    out_dir.mkdir(parents=True, exist_ok=True)
    pages = []
    for pno in range(doc.page_count):
        page = doc[pno]
        pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), colorspace=fitz.csGRAY)
        # ほぼ白紙のページは飛ばす（表紙裏など）
        if skip_blank:
            import numpy as np
            a = np.frombuffer(pix.samples, dtype=np.uint8)
            if (a < 170).mean() < 0.0015:
                pages.append({"page": pno, "file": None, "blank": True})
                continue
        name = f"p{pno:03d}.png"
        pix.save(out_dir / name)
        pages.append({"page": pno, "file": name, "blank": False,
                      "w": pix.width, "h": pix.height,
                      "pdf_w": page.rect.width, "pdf_h": page.rect.height})
    doc.close()
    return {"pages": pages, "zoom": zoom}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf-dir", required=True)
    ap.add_argument("--only", nargs="*", default=None)
    ap.add_argument("--zoom", type=float, default=1.6,
                    help="1.6 で約 826x1167px（本文が読める最小限のサイズ）")
    ap.add_argument("--keep-blank", action="store_true")
    args = ap.parse_args()

    exams = discover(Path(args.pdf_dir))
    targets = [(k, v) for k, v in exams.items()
               if v.get("qs") and (not args.only or k in args.only)]
    if not targets:
        print("対象がありません。--only の指定を確認してください。")
        print("利用できる exam_id:", ", ".join(exams))
        return 1

    for eid, ex in targets:
        out = WORK / eid
        info = render(ex["qs"], out, args.zoom, not args.keep_blank)
        info.update({"exam": eid, "label": ex["label"], "src": ex["qs"].name})
        (out / "index.json").write_text(json.dumps(info, ensure_ascii=False, indent=1),
                                       encoding="utf-8")
        n = sum(1 for p in info["pages"] if p["file"])
        mb = sum((out / p["file"]).stat().st_size for p in info["pages"] if p["file"]) / 1e6
        print(f"{eid:6s} {ex['label']:16s} {n:3d}ページ  {mb:5.1f} MB  -> "
              f"{out.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
