# -*- coding: utf-8 -*-
"""応用情報 午後試験の大問と分野。

**大問番号と分野の対応は年代で変わる**ので、番号で決めつけてはいけない。
  - 平成21年度春期〜平成25年度春期: 12大問。問1が経営戦略系で、セキュリティは中ほど
  - 平成25年度秋期〜: 11大問
  - 近年: 問1が情報セキュリティ（必須）、以降 経営戦略・プログラミング…の順

そこで分野は、解答例PDFから確実に取れる「出題趣旨」と「採点講評」の本文から判定する。
どちらもIPAが書いた要約文で、題材と問う能力が明記されているため判定しやすい。
"""

from __future__ import annotations

# 午後の分野（11種）。code は午前の中分野に寄せて、統計をまたいで見られるようにする
PM_FIELDS: list[tuple[str, str]] = [
    ("SEC", "情報セキュリティ"),
    ("STR", "経営戦略・情報戦略"),
    ("PRG", "プログラミング"),
    ("ARC", "システムアーキテクチャ"),
    ("NET", "ネットワーク"),
    ("DB", "データベース"),
    ("EMB", "組込みシステム開発"),
    ("DEV", "情報システム開発"),
    ("PM", "プロジェクトマネジメント"),
    ("SM", "サービスマネジメント"),
    ("AUD", "システム監査"),
]
NAME = dict(PM_FIELDS)

# 午前の中分野コードへの対応（統計をまとめて見るため）
TO_AM = {
    "SEC": "T11", "STR": "S03", "PRG": "T02", "ARC": "T04", "NET": "T10",
    "DB": "T09", "EMB": "T06", "DEV": "T12", "PM": "M01", "SM": "M02", "AUD": "M03",
}

# 出題趣旨・採点講評に現れる語。長い語ほど強く効かせる
KEYWORDS: dict[str, list[str]] = {
    "SEC": [
        "情報セキュリティ", "セキュリティ対策", "サイバー攻撃", "標的型攻撃", "マルウェア",
        "ウイルス感染", "不正アクセス", "ファイアウォール", "脆弱性", "暗号", "認証",
        "ディジタル署名", "証明書", "ランサムウェア", "サプライチェーン攻撃", "フィッシング",
        "SQLインジェクション", "クロスサイトスクリプティング", "多要素認証", "ゼロトラスト",
        "CSIRT", "インシデント対応", "内部不正", "アクセス権限の管理", "WAF", "IDS",
    ],
    "STR": [
        "経営戦略", "事業戦略", "情報戦略", "マーケティング", "SWOT", "競争優位",
        "コアコンピタンス", "事業領域", "新規事業", "提携", "アライアンス", "M&A",
        "ブランド", "投資対効果", "経営環境", "ビジネスモデル", "事業計画", "収益力",
        "システム化構想", "システム化計画", "IT投資", "業務改革", "BPR", "経営課題",
    ],
    "PRG": [
        "アルゴリズム", "プログラミング", "データ構造", "計算量", "再帰", "探索",
        "整列", "スタック", "キュー", "リンクリスト", "連結リスト", "2分木", "木構造",
        "ハッシュ", "動的計画法", "擬似言語", "配列", "関数の実装", "プログラムの実装",
    ],
    "ARC": [
        "システムアーキテクチャ", "システム構成", "仮想サーバ", "仮想化", "クラウドサービス",
        "冗長構成", "可用性の設計", "性能設計", "キャパシティ", "スループット",
        "応答時間", "災害復旧", "ディザスタリカバリ", "負荷分散", "サーバ統合",
        "ハードウェア制約", "エッジコンピューティング", "コンテナ",
    ],
    "NET": [
        "ネットワーク", "TCP/IP", "IPアドレス", "サブネット", "ルーティング", "ルータ",
        "DHCP", "DNS", "NAT", "VLAN", "LAN", "WAN", "VPN", "プロキシ", "経路制御",
        "パケット", "帯域", "無線LAN", "VoIP", "IP電話", "ロードバランサ", "通信手順",
    ],
    "DB": [
        "データベース", "テーブル構造", "E-R図", "ER図", "SQL", "正規化", "主キー",
        "外部キー", "参照制約", "トランザクション", "排他制御", "デッドロック",
        "データモデル", "スーパータイプ", "サブタイプ", "索引", "インデックス",
    ],
    "EMB": [
        "組込みシステム", "組込み機器", "リアルタイムOS", "マイコン", "MPU", "センサ",
        "アクチュエータ", "省電力", "電池", "タスクの設計", "割込み", "状態遷移",
        "制御プログラム", "ファームウェア", "機器の制御",
    ],
    "DEV": [
        "情報システム開発", "ソフトウェア開発", "システム開発", "要件定義", "外部設計",
        "内部設計", "モジュール", "テスト設計", "単体テスト", "結合テスト", "レビュー",
        "UML", "クラス図", "シーケンス図", "ユースケース", "オブジェクト指向",
        "画面設計", "機能追加", "改修", "アジャイル", "スクラム", "品質確保",
    ],
    "PM": [
        "プロジェクトマネジメント", "プロジェクト計画", "プロジェクトマネージャ", "WBS",
        "スコープ", "工数", "要員", "スケジュール", "進捗", "クリティカルパス",
        "アローダイアグラム", "コスト管理", "リスク対応", "ステークホルダ", "体制",
        "責任分担", "開発プロジェクト",
    ],
    "SM": [
        "サービスマネジメント", "サービスレベル", "SLA", "SLM", "ITIL", "サービスデスク",
        "インシデント管理", "問題管理", "変更管理", "リリース", "運用", "可用性管理",
        "キャパシティ管理", "事業継続", "バックアップ", "アウトソーシング", "エスカレーション",
        "障害対応", "運用管理", "FAQ",
    ],
    "AUD": [
        "システム監査", "監査人", "監査手続", "監査証拠", "監査計画", "監査報告",
        "内部統制", "点検", "準拠性", "統制", "可監査性", "モニタリング", "是正",
    ],
}


def score_one(text: str) -> dict[str, float]:
    """1つの大問について、各分野との適合度を出す。"""
    scores: dict[str, float] = {c: 0.0 for c, _ in PM_FIELDS}
    if not text:
        return scores
    for code, words in KEYWORDS.items():
        s = 0.0
        for w in words:
            n = text.count(w)
            if n:
                s += len(w) * (n ** 0.5)
        scores[code] = s
    return scores


def assign(texts: list[str]) -> list[tuple[str, float, float]]:
    """1回分の大問すべてをまとめて分野に割り当てる。

    **1つの試験回では大問ごとに異なる分野が出る**という制約が効くので、
    個別に最大値を取るのではなく、全体の合計適合度が最大になる組合せを選ぶ。
    弱い信号の大問も、他が確定することで消去法で決まる。
    大問が12ある回（平成25年度春期以前）は1分野だけ2回使えるようにする。

    戻り値は大問ごとの (code, score, margin)。margin は
    「その大問を2位の分野に替えたときに全体の合計がどれだけ下がるか」で、
    小さいほど判定が際どい。
    """
    import numpy as np
    from scipy.optimize import linear_sum_assignment

    codes = [c for c, _ in PM_FIELDS]
    n = len(texts)
    mat = np.array([[score_one(t)[c] for c in codes] for t in texts], dtype=float)

    # 大問数 > 分野数 のときは各分野の列を複製して 2 回まで使えるようにする
    reps = 2 if n > len(codes) else 1
    cols = codes * reps
    big = np.tile(mat, (1, reps))

    rows, cs = linear_sum_assignment(-big)
    best = {int(r): cols[int(c)] for r, c in zip(rows, cs)}
    total = sum(big[r, c] for r, c in zip(rows, cs))

    out: list[tuple[str, float, float]] = []
    for i in range(n):
        code = best[i]
        # この大問だけ別の分野に強制したときの、全体最適の下がり幅
        margin = float("inf")
        for alt in set(cols):
            if alt == code:
                continue
            pen = big.copy()
            for j, c in enumerate(cols):
                if c == alt:
                    continue
                pen[i, j] = -1e6
            r2, c2 = linear_sum_assignment(-pen)
            t2 = sum(mat[r, cols.index(cols[c])] if False else big[r, c]
                     for r, c in zip(r2, c2))
            margin = min(margin, total - t2)
        out.append((code, float(mat[i, codes.index(code)]), round(margin, 1)))
    return out


def classify(text: str) -> tuple[str, int, str]:
    """単独判定（参考用）。実際の割当は assign() を使うこと。"""
    s = score_one(text)
    ranked = sorted(s.items(), key=lambda kv: -kv[1])
    return ranked[0][0], int(ranked[0][1]), ranked[1][0] if ranked[1][1] > 0 else ""


# 〔問題一覧〕に書かれている出題分野の表記 → コード。
# 表記は年代で揺れる（「IT サービスマネジメント」「戦略立案・コンサルティングの技法」など）。
LABEL_TO_CODE: dict[str, str] = {
    "情報セキュリティ": "SEC",
    "セキュリティ": "SEC",
    "経営戦略": "STR",
    "経営戦略・情報戦略": "STR",
    "情報戦略": "STR",
    "戦略立案・コンサルティングの技法": "STR",
    "プログラミング": "PRG",
    "システムアーキテクチャ": "ARC",
    "ネットワーク": "NET",
    "データベース": "DB",
    "組込みシステム開発": "EMB",
    "情報システム開発": "DEV",
    "プロジェクトマネジメント": "PM",
    "サービスマネジメント": "SM",
    "ITサービスマネジメント": "SM",
    "IT サービスマネジメント": "SM",
    "システム監査": "AUD",
}


def code_from_label(label: str) -> str | None:
    """〔問題一覧〕の出題分野表記からコードを引く。IPA の表記が正典。"""
    if not label:
        return None
    s = "".join(str(label).split())
    if s in LABEL_TO_CODE:
        return LABEL_TO_CODE[s]
    for k, v in LABEL_TO_CODE.items():
        if "".join(k.split()) in s:
            return v
    return None


def name(code: str) -> str:
    return NAME.get(code, "その他")


def am_field(code: str) -> str:
    return TO_AM.get(code, "X00")
