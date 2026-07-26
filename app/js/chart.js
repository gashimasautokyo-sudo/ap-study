/* 正答率の横棒グラフ（単一系列・外部ライブラリなし）
   - 系列は 1 本なので凡例は置かない（見出しが何のグラフかを言う）
   - 値は各バーの直上に直接ラベル（クリップされない）
   - 弱点はテキストのタグでも示す（色だけに意味を持たせない）
   - 表形式ビューを必ず用意する */
(function () {
  'use strict';

  function pct(r) { return r === null || r === undefined ? '—' : (r * 100).toFixed(0) + '%'; }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  /**
   * rows: [{ name, rate(0..1|null), correct, attempts, total, answered }]
   * opts: { sort:'rate'|'given', weakThreshold:0.6, minAttempts:3, showTotal:true }
   */
  function renderBars(container, rows, opts) {
    opts = opts || {};
    const thr = opts.weakThreshold === undefined ? 0.6 : opts.weakThreshold;
    const minA = opts.minAttempts === undefined ? 3 : opts.minAttempts;

    container.innerHTML = '';
    if (!rows.length) {
      container.appendChild(el('div', 'empty-msg', 'まだ集計するデータがありません。'));
      return;
    }

    let list = rows.slice();
    if ((opts.sort || 'rate') === 'rate') {
      // 弱い分野を上に。未回答は最後にまとめる（次に何をやるかが読み取れる並び）
      list.sort(function (a, b) {
        const na = a.rate === null, nb = b.rate === null;
        if (na !== nb) return na ? 1 : -1;
        if (na && nb) return (b.total || 0) - (a.total || 0);
        return a.rate - b.rate;
      });
    }

    const wrap = el('div', 'bars');
    list.forEach(function (r) {
      const row = el('div', 'bar-row' + (r.rate === null ? ' empty' : ''));

      const head = el('div', 'bar-head');
      const name = el('span', 'name');
      name.appendChild(document.createTextNode(r.name));
      if (r.rate !== null && r.attempts >= minA && r.rate < thr) {
        name.appendChild(el('span', 'weak-tag', '弱点'));
      }
      head.appendChild(name);
      head.appendChild(el('span', 'val', pct(r.rate)));
      head.appendChild(el('span', 'cnt',
        r.rate === null
          ? '未回答 / ' + (r.total || 0) + '問'
          : r.correct + '/' + r.attempts + '回 · ' + (r.answered || 0) + '/' + (r.total || 0) + '問'));
      row.appendChild(head);

      const track = el('div', 'bar-track');
      const fill = el('div', 'bar-fill');
      fill.style.width = (r.rate === null ? 0 : Math.max(0.6, r.rate * 100)) + '%';
      if (r.rate === null) fill.style.display = 'none';
      track.appendChild(fill);
      track.title = r.name + ' — 正答率 ' + pct(r.rate);
      row.appendChild(track);

      wrap.appendChild(row);
    });
    container.appendChild(wrap);

    const axis = el('div', 'axis');
    ['0%', '25%', '50%', '75%', '100%'].forEach(function (t) { axis.appendChild(el('span', null, t)); });
    container.appendChild(axis);
  }

  /** 同じ数字を表で出す（色に依存しない代替表現） */
  function renderTable(container, rows) {
    container.innerHTML = '';
    const t = el('table', 'tv');
    const thead = el('thead');
    const htr = el('tr');
    ['分野', '正答率', '正/回答', '着手'].forEach(function (h) { htr.appendChild(el('th', null, h)); });
    thead.appendChild(htr);
    t.appendChild(thead);
    const tb = el('tbody');
    rows.slice().sort(function (a, b) {
      const na = a.rate === null, nb = b.rate === null;
      if (na !== nb) return na ? 1 : -1;
      if (na && nb) return (b.total || 0) - (a.total || 0);
      return a.rate - b.rate;
    }).forEach(function (r) {
      const tr = el('tr');
      tr.appendChild(el('td', null, r.name));
      tr.appendChild(el('td', null, pct(r.rate)));
      tr.appendChild(el('td', null, r.rate === null ? '—' : r.correct + '/' + r.attempts));
      tr.appendChild(el('td', null, (r.answered || 0) + '/' + (r.total || 0)));
      tb.appendChild(tr);
    });
    t.appendChild(tb);
    container.appendChild(t);
  }

  window.Chart = { renderBars: renderBars, renderTable: renderTable, pct: pct };
})();
