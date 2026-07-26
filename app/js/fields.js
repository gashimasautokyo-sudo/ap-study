/* 応用情報技術者試験 午前 の分野体系（IPA シラバス 大分野／中分野に準拠）
   tools/ap_fields.py と code を一致させること。 */
(function () {
  'use strict';

  const FIELDS = [
    // ---- テクノロジ系 ----
    { code: 'T01', group: 'テクノロジ系', name: '基礎理論' },
    { code: 'T02', group: 'テクノロジ系', name: 'アルゴリズムとプログラミング' },
    { code: 'T03', group: 'テクノロジ系', name: 'コンピュータ構成要素' },
    { code: 'T04', group: 'テクノロジ系', name: 'システム構成要素' },
    { code: 'T05', group: 'テクノロジ系', name: 'ソフトウェア' },
    { code: 'T06', group: 'テクノロジ系', name: 'ハードウェア' },
    { code: 'T07', group: 'テクノロジ系', name: 'ヒューマンインタフェース' },
    { code: 'T08', group: 'テクノロジ系', name: 'マルチメディア' },
    { code: 'T09', group: 'テクノロジ系', name: 'データベース' },
    { code: 'T10', group: 'テクノロジ系', name: 'ネットワーク' },
    { code: 'T11', group: 'テクノロジ系', name: 'セキュリティ' },
    { code: 'T12', group: 'テクノロジ系', name: 'システム開発技術' },
    { code: 'T13', group: 'テクノロジ系', name: 'ソフトウェア開発管理技術' },
    // ---- マネジメント系 ----
    { code: 'M01', group: 'マネジメント系', name: 'プロジェクトマネジメント' },
    { code: 'M02', group: 'マネジメント系', name: 'サービスマネジメント' },
    { code: 'M03', group: 'マネジメント系', name: 'システム監査' },
    // ---- ストラテジ系 ----
    { code: 'S01', group: 'ストラテジ系', name: 'システム戦略' },
    { code: 'S02', group: 'ストラテジ系', name: 'システム企画' },
    { code: 'S03', group: 'ストラテジ系', name: '経営戦略マネジメント' },
    { code: 'S04', group: 'ストラテジ系', name: '技術戦略マネジメント' },
    { code: 'S05', group: 'ストラテジ系', name: 'ビジネスインダストリ' },
    { code: 'S06', group: 'ストラテジ系', name: '企業活動' },
    { code: 'S07', group: 'ストラテジ系', name: '法務' },
    // ---- 自動分類できなかったもの ----
    { code: 'X00', group: '未分類', name: '未分類' }
  ];

  const BY_CODE = Object.create(null);
  FIELDS.forEach(function (f) { BY_CODE[f.code] = f; });

  const GROUPS = [];
  FIELDS.forEach(function (f) {
    if (GROUPS.indexOf(f.group) < 0) GROUPS.push(f.group);
  });

  window.AP_FIELDS = {
    all: FIELDS,
    groups: GROUPS,
    /** コード → 表示名。未知コードは questions.json 側の fieldName で補う */
    name: function (code, fallback) {
      const f = BY_CODE[code];
      return f ? f.name : (fallback || code || '未分類');
    },
    group: function (code) {
      const f = BY_CODE[code];
      return f ? f.group : 'その他';
    },
    /** 表示順に並べるための index */
    order: function (code) {
      for (let i = 0; i < FIELDS.length; i++) if (FIELDS[i].code === code) return i;
      return 999;
    }
  };
})();
