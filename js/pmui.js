/* 午後モードの画面。app.js の後に読み込む（AppHooks 経由で連携する）
   解答・自己採点の保存キーは q.key を使う。
   q.id（「設問4」など）は解答例側で重複することがあり、キーには使えない。 */
(function () {
  'use strict';

  const $ = function (id) { return document.getElementById(id); };
  const UI = { examId: null, sid: null, fontStep: 0, timer: null };
  const FONT = [15, 17, 19, 13];

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function pct(r) { return r === null || r === undefined ? '—' : Math.round(r * 100) + '%'; }

  function mmss(sec) {
    const m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' + s : s);
  }

  /* ---------- 一覧 ---------- */

  function renderList() {
    const o = PM.overall();
    $('pmRate').innerHTML = o.rate === null ? '—'
      : Math.round(o.rate * 100) + '<span class="unit">%</span>';
    $('pmDone').textContent = o.done + ' / ' + o.sections;
    $('pmWeak').textContent = PM.weakQuestions().length;
    $('pmTotal').textContent = PM.sections.length + '大問';

    const ec = $('pmExamChips');
    ec.innerHTML = '';
    if (!PM.exams.length) {
      // 初回は40MB超を取りに行くので、取得中と本当に無いときを区別して出す
      ec.appendChild(el('div', 'empty-msg', PM.syncState && PM.syncState.error
        ? '午後データを読み込めませんでした（' + PM.syncState.error + '）'
        : '午後データを読み込んでいます。40MB ほどあるので、初回は少し時間がかかります。'
          + '読み込みが終わると自動で表示されます。'));
      $('pmSectionList').innerHTML = '';
      $('pmPickHint').textContent = '';
      return;
    }
    if (!UI.examId || !PM.exams.some(function (e) { return e.id === UI.examId; })) {
      UI.examId = PM.exams[0].id;
    }
    PM.exams.forEach(function (e) {
      const b = el('button', 'chip');
      b.textContent = e.label;
      b.setAttribute('aria-pressed', String(e.id === UI.examId));
      b.addEventListener('click', function () { UI.examId = e.id; renderList(); });
      ec.appendChild(b);
    });

    const exam = PM.exams.filter(function (e) { return e.id === UI.examId; })[0] || {};
    const secs = PM.sections.filter(function (s) { return s.examId === UI.examId; });
    // 平成25年春以前は必須問題がなく、全問が選択制。回によって違うのでデータから決める
    const req = secs.filter(function (s) { return s.required; })
      .map(function (s) { return '問' + s.no; });
    $('pmPickHint').textContent = exam.selection || (
      req.length
        ? req.join('・') + 'が必須、残りから選択して解きます。1大問あたり約30分が目安です。'
        : 'この回は必須問題がなく、すべて選択問題です。1大問あたり約30分が目安です。');

    const host = $('pmSectionList');
    host.innerHTML = '';
    secs.forEach(function (s) {
      const st = PM.stateOf(s.id);
      const sc = PM.score(s.id);
      const b = el('button', 'item pm-sec');
      const l1 = el('div', 'l1');
      l1.appendChild(el('span', 'tag', '問' + s.no));
      l1.appendChild(el('span', null, s.name));
      if (s.required) l1.appendChild(el('span', 'tag', '必須'));
      const r = el('span', 'r');
      if (st.submitted && sc.blank) {
        r.textContent = '採点中 ' + sc.marked + '/' + sc.total + '設問';
      } else if (st.submitted) {
        r.className = 'r ' + (sc.rate >= 0.6 ? 'badge-ok' : 'badge-ng');
        r.textContent = '自己採点 ' + pct(sc.rate) + '（○' + sc.o + ' △' + sc.t + ' ×' + sc.x + '）';
      } else if (Object.keys(st.answers).length) {
        r.textContent = '解答中 ' + Object.keys(st.answers).length + '/' + s.questions.length;
      } else {
        r.textContent = s.questions.length + '設問';
      }
      l1.appendChild(r);
      b.appendChild(l1);
      b.appendChild(el('div', 'l2', s.theme || (s.body[0] ? s.body[0].text : '')));
      b.addEventListener('click', function () { openSolve(s.id); });
      host.appendChild(b);
    });
    if (!secs.length) host.appendChild(el('div', 'empty-msg', 'この回の大問がまだありません。'));
  }

  /* ---------- 本文 ---------- */

  function renderBody(host, s) {
    host.innerHTML = '';
    (s.body || []).forEach(function (b) {
      if (b.type === 'h') {
        host.appendChild(el('h4', null, b.text));
      } else if (b.type === 'table' && b.md) {
        const w = el('div', 'tblwrap');
        w.appendChild(mdTable(b.md));
        host.appendChild(w);
      } else if (b.type === 'fig') {
        const fig = el('figure');
        const img = document.createElement('img');
        img.alt = b.caption || '図';
        img.decoding = 'sync';
        fig.appendChild(img);
        if (b.caption) fig.appendChild(el('figcaption', null, b.caption));
        host.appendChild(fig);
        if (b.figId) {
          DB.get('figures', b.figId).then(function (row) {
            if (row && row.images && row.images[0]) img.src = row.images[0];
            else fig.appendChild(el('figcaption', null, '（図を読み込めませんでした）'));
          });
        }
      } else if (b.text) {
        host.appendChild(el('p', null, b.text));
      }
    });
  }

  function mdTable(md) {
    const rows = md.split('\n').map(function (l) { return l.trim(); })
      .filter(function (l) { return l.indexOf('|') >= 0; });
    const t = el('table');
    let head = true;
    rows.forEach(function (line) {
      const cells = line.replace(/^\||\|$/g, '').split('|').map(function (c) { return c.trim(); });
      if (cells.every(function (c) { return /^:?-{2,}:?$/.test(c); })) { head = false; return; }
      const tr = el('tr');
      cells.forEach(function (c) {
        const cell = el(head ? 'th' : 'td');
        // セル内の改行は <br> で表現されている
        String(c).split(/<br\s*\/?>/i).forEach(function (part, i) {
          if (i) cell.appendChild(document.createElement('br'));
          cell.appendChild(document.createTextNode(part.replace(/<\/?sup>/gi, '')));
        });
        tr.appendChild(cell);
      });
      (head ? t.createTHead() : (t.tBodies[0] || t.createTBody())).appendChild(tr);
      if (head) head = false;
    });
    return t;
  }

  /* ---------- 解答画面 ---------- */

  function openSolve(sid) {
    UI.sid = sid;
    const s = PM.byId[sid];
    if (!s) return;
    const st = PM.stateOf(sid);
    if (!st.startedAt) { st.startedAt = Date.now(); PM.save(st); }

    const meta = $('pmMeta');
    meta.innerHTML = '';
    meta.appendChild(el('span', 'tag', PM.examLabel(s.examId)));
    meta.appendChild(el('span', 'tag', '問' + s.no));
    meta.appendChild(el('span', 'tag', s.name));
    if (s.required) meta.appendChild(el('span', null, '必須'));
    meta.appendChild(el('span', null, s.questions.length + '設問'));
    $('pmTheme').textContent = s.theme || '';

    document.documentElement.style.setProperty('--pm-size', FONT[UI.fontStep] + 'px');
    renderBody($('pmBody'), s);
    renderInputs(s, st);
    startTimer();
    window.AppHooks.show('pmsolve');
  }

  function renderInputs(s, st) {
    const host = $('pmQuestions');
    host.innerHTML = '';
    s.questions.forEach(function (q) {
      const box = el('div', 'pm-q');
      const lbl = el('div', 'lbl', q.label + (q.sub || ''));
      if (q.blank) lbl.appendChild(el('span', 'blank', '空欄 ' + q.blank));
      box.appendChild(lbl);
      if (q.prompt) box.appendChild(el('div', 'prompt', q.prompt));

      if (q.choices && Object.keys(q.choices).length) {
        const wrap = el('div', 'pm-choices');
        Object.keys(q.choices).forEach(function (k) {
          const b = el('button', 'chip');
          b.textContent = k + '　' + q.choices[k];
          b.setAttribute('aria-pressed', String(st.answers[q.key] === k));
          b.addEventListener('click', function () {
            st.answers[q.key] = (st.answers[q.key] === k) ? '' : k;
            PM.save(st).then(function () { renderInputs(s, st); });
          });
          wrap.appendChild(b);
        });
        box.appendChild(wrap);
      } else {
        const ta = document.createElement('textarea');
        ta.value = st.answers[q.key] || '';
        ta.placeholder = q.limit ? q.limit + '字以内で記述' : '解答を入力';
        const cnt = el('div', 'count');
        const upd = function () {
          const n = ta.value.replace(/\s/g, '').length;
          cnt.textContent = q.limit ? n + ' / ' + q.limit + '字' : n + '字';
          cnt.classList.toggle('over', !!(q.limit && n > q.limit));
        };
        const store = function () { st.answers[q.key] = ta.value; PM.save(st); };
        // 1大問30分かかるので、change/blur だけに任せるとアプリを切り替えた拍子に
        // 入力が消える。打っている最中も少し遅らせて保存しておく。
        let timer = 0;
        ta.addEventListener('input', function () {
          upd();
          clearTimeout(timer);
          timer = setTimeout(store, 600);
        });
        ta.addEventListener('change', store);
        ta.addEventListener('blur', store);
        upd();
        box.appendChild(ta);
        box.appendChild(cnt);
      }
      host.appendChild(box);
    });
  }

  function startTimer() {
    stopTimer();
    const tick = function () {
      const st = PM.stateOf(UI.sid);
      if (!st.startedAt) return;
      const sec = Math.floor((Date.now() - st.startedAt) / 1000);
      const t = $('pmTimer');
      t.textContent = '経過 ' + mmss(sec) + ' / 目安30:00';
      t.classList.toggle('warn', sec > 30 * 60);
    };
    tick();
    UI.timer = setInterval(tick, 1000);
  }

  function stopTimer() { if (UI.timer) { clearInterval(UI.timer); UI.timer = null; } }

  /* ---------- 採点画面 ---------- */

  function openReview(sid) {
    UI.sid = sid;
    const s = PM.byId[sid];
    const st = PM.stateOf(sid);

    // 記号選択と、解答例に完全一致した短答だけをここで自動採点する
    let auto = 0;
    s.questions.forEach(function (q) {
      if (st.marks[q.key]) return;
      const m = PM.autoMark(q, st.answers[q.key]);
      if (m) { st.marks[q.key] = m; auto++; }
    });
    st.submitted = true;
    PM.save(st);

    const meta = $('pmrMeta');
    meta.innerHTML = '';
    meta.appendChild(el('span', 'tag', PM.examLabel(s.examId)));
    meta.appendChild(el('span', 'tag', '問' + s.no));
    meta.appendChild(el('span', 'tag', s.name));
    if (auto) meta.appendChild(el('span', null, auto + '問を自動採点'));

    renderMarks(s, st);
    $('pmrIntentCard').hidden = !s.intent;
    $('pmrIntent').textContent = s.intent || '';
    $('pmrCmntCard').hidden = !s.commentary;
    $('pmrCmnt').innerHTML = '';
    if (s.commentary) {
      $('pmrCmnt').appendChild(el('b', null, '採点講評'));
      $('pmrCmnt').appendChild(document.createTextNode(s.commentary));
    }
    stopTimer();
    window.AppHooks.show('pmreview');
  }

  function renderMarks(s, st) {
    const host = $('pmrList');
    host.innerHTML = '';
    s.questions.forEach(function (q) {
      const box = el('div', 'pm-q');
      const lbl = el('div', 'lbl', q.label + (q.sub || ''));
      if (q.blank) lbl.appendChild(el('span', 'blank', '空欄 ' + q.blank));
      box.appendChild(lbl);
      if (q.prompt) box.appendChild(el('div', 'prompt', q.prompt));

      const mine = el('div', 'pm-mine');
      mine.appendChild(el('b', null, 'あなたの解答'));
      const given = (st.answers[q.key] || '').trim();
      mine.appendChild(document.createTextNode(given || '（未記入）'));
      box.appendChild(mine);

      const ans = el('div', 'pm-ans');
      ans.appendChild(el('b', null, '解答例' + (q.note ? '（' + q.note + '）' : '')));
      ans.appendChild(document.createTextNode(q.answer));
      box.appendChild(ans);

      const marks = el('div', 'pm-marks');
      ['o', 't', 'x'].forEach(function (m) {
        const b = el('button', null, PM.MARKS[m]);
        b.setAttribute('data-m', m);
        b.setAttribute('aria-pressed', String(st.marks[q.key] === m));
        b.addEventListener('click', function () {
          if (st.marks[q.key] === m) delete st.marks[q.key];
          else st.marks[q.key] = m;
          PM.save(st).then(function () { renderMarks(s, st); });
        });
        marks.appendChild(b);
      });
      box.appendChild(marks);
      if (q.kind === 'choice') {
        box.appendChild(el('div', 'pm-auto', '記号選択のため自動採点しました（変更もできます）'));
      } else if (q.kind === 'short' && st.marks[q.key] === 'o') {
        box.appendChild(el('div', 'pm-auto', '解答例と完全に一致したため自動で○にしました'));
      }
      host.appendChild(box);
    });
    updateScore(s);
  }

  function updateScore(s) {
    const sc = PM.score(s.id);
    $('pmrRate').innerHTML = sc.rate === null ? '—'
      : Math.round(sc.rate * 100) + '<span class="unit">%</span>';
    $('pmrCount').textContent = '○' + sc.o + '　△' + sc.t + '（0.5点換算）　×' + sc.x
      + '　／　採点済み ' + sc.marked + ' / ' + sc.total + '設問'
      + (sc.blank ? '（残り' + sc.blank + '問は下で ○△× を付けてください）' : '');
  }

  /* ---------- 配線 ---------- */

  function wire() {
    $('pmToggleBody').addEventListener('click', function () {
      const c = $('pmBodyCard');
      c.hidden = !c.hidden;
      this.textContent = c.hidden ? '本文を表示' : '本文を隠す';
    });
    $('pmFont').addEventListener('click', function () {
      UI.fontStep = (UI.fontStep + 1) % FONT.length;
      document.documentElement.style.setProperty('--pm-size', FONT[UI.fontStep] + 'px');
      this.textContent = '文字 ' + FONT[UI.fontStep] + 'px';
    });
    $('pmSubmit').addEventListener('click', function () { openReview(UI.sid); });
    $('pmSaveExit').addEventListener('click', function () {
      stopTimer();
      window.AppHooks.show('pm');
    });
    $('pmReset').addEventListener('click', function () {
      if (!confirm('この大問の解答と自己採点を消します。よろしいですか？')) return;
      PM.save(PM.blank(UI.sid)).then(function () { openSolve(UI.sid); });
    });
    $('pmrBackSolve').addEventListener('click', function () { openSolve(UI.sid); });
    $('pmrDone').addEventListener('click', function () { window.AppHooks.show('pm'); });
  }

  window.PMUI = {
    wire: wire,
    render: renderList,
    openSolve: openSolve,
    stopTimer: stopTimer
  };
})();
