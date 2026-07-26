# -*- coding: utf-8 -*-
"""Service Worker のキャッシュ名を決める。

キャッシュ名にはデータの版番号だけでなく **アプリ本体（HTML/JS/CSS）の内容**も混ぜる。
データが同じでJSだけ直した場合にキャッシュ名が変わらないと、
すでにアプリを開いた端末は「1回目は古いJS、2回目にやっと新しいJS」になる。
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

# 事前キャッシュするアプリ本体。ここが変わったらキャッシュを作り直す
SHELL = ["index.html", "manifest.webmanifest", "css/style.css",
         "js/fields.js", "js/db.js", "js/store.js", "js/quiz.js",
         "js/pm.js", "js/chart.js", "js/app.js", "js/pmui.js"]


def shell_hash(app_dir: Path) -> str:
    h = hashlib.sha1()
    for rel in SHELL:
        p = app_dir / rel
        if p.exists():
            h.update(rel.encode("utf-8"))
            h.update(p.read_bytes())
    return h.hexdigest()[:8]


def stamp_sw(app_dir: Path, data_stamp: str) -> str | None:
    """sw.js の CACHE を書き換える。書き換えた名前を返す。"""
    sw = app_dir / "sw.js"
    if not sw.exists():
        return None
    name = f"ap-study-{data_stamp}-{shell_hash(app_dir)}"
    src = sw.read_text(encoding="utf-8")
    new = re.sub(r"const CACHE = '[^']*';", f"const CACHE = '{name}';", src, count=1)
    if new != src:
        sw.write_text(new, encoding="utf-8")
    return name
