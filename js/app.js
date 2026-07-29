/* 画面遷移とイベント配線 */
(function () {
  'use strict';

  const $ = function (id) { return document.getElementById(id); };
  const KEYS = ['ア', 'イ', 'ウ', 'エ'];

  const UI = {
    tab: 'home',
    setup: { mode: 'exam', exams: [], fields: [], scope: 'unresolved' },
    review: { scope: 'unresolved' },
    detailQid: null,
    detailFrom: 'review',
    timer: null
  };

  /* ---------- 小道具 ---------- */

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function mmss(sec) {
    if (sec === null || sec === undefined) return '—';
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const p = function (n) { return n < 10 ? '0' + n : String(n); };
    return h > 0 ? h + ':' + p(m) + ':' + p(s) : p(m) + ':' + p(s);
  }

  function pct(r) { return r === null || r === undefined ? '—' : (r * 100).toFixed(0) + '%'; }

  function show(tab) {
    UI.tab = tab;
    const views = document.querySelectorAll('.view');
    for (let i = 0; i < views.length; i++) views[i].classList.remove('active');
    const v = $('view-' + tab);
    if (v) v.classList.add('active');
    const btns = $('tabbar').querySelectorAll('button');
    for (let i = 0; i < btns.length; i++) {
      const t = btns[i].getAttribute('data-tab');
      const on = (t === tab) || (tab === 'quiz' && t === 'setup') ||
        (tab === 'result' && t === 'setup') || (tab === 'detail' && t === 'review') ||
        ((tab === 'pmsolve' || tab === 'pmreview') && t === 'pm');
      if (on) btns[i].setAttribute('aria-current', 'page');
      else btns[i].removeAttribute('aria-current');
    }
    window.scrollTo(0, 0);
    if (tab !== 'quiz') stopTimer();
    if (tab !== 'pmsolve' && window.PMUI) PMUI.stopTimer();

    if (tab === 'pm' && window.PMUI) PMUI.render();
    if (tab === 'home') renderHome();
    if (tab === 'setup') renderSetup();
    if (tab === 'review') renderReview();
    if (tab === 'stats') renderStats();
    if (tab === 'settings') renderSettings();
    if (tab === 'quiz') renderQuiz();
  }

  function setTopSub(text) { $('topSub').textContent = text || ''; }

  /* ---------- ホーム ---------- */

  function renderHome() {
    const o = Store.overall();
    $('hRate').innerHTML = o.rate === null ? '—' :
      (o.rate * 100).toFixed(0) + '<span class="unit">%</span>';
    $('hAnswered').textContent = o.answered + ' / ' + o.total;
    $('hUnresolved').textContent = o.unresolved;
    $('hAttempts').textContent = o.attempts;
    $('qReviewN').textContent = o.unresolved;
    $('btnQuickReview').disabled = o.unresolved === 0;

    const exN = Store.exams.length;
    $('bankInfo').textContent = Store.questions.length
      ? Store.questions.length + ' 問 / ' + exN + ' 回分が登録されています。'
      : '問題データがまだありません。設定画面から questions.json を読み込んでください。';

    const s = Quiz.active;
    if (s && !s.graded) {
      $('resumeCard').hidden = false;
      $('resumeInfo').textContent = (s.title || '出題') + ' — ' +
        (s.idx + 1) + '/' + s.qids.length + '問目まで進行中';
    } else {
      $('resumeCard').hidden = true;
    }
    setTopSub('');
  }

  /* ---------- 出題設定 ---------- */

  function renderSetup() {
    // モード
    const mc = $('modeChips').querySelectorAll('.chip');
    for (let i = 0; i < mc.length; i++) {
      mc[i].setAttribute('aria-pressed', String(mc[i].getAttribute('data-mode') === UI.setup.mode));
    }
    const m = UI.setup.mode;
    $('secExam').hidden = m !== 'exam';
    $('secField').hidden = m !== 'field';
    $('secReview').hidden = m !== 'review';
    $('secMock').hidden = m !== 'mock';
    $('secOpts').hidden = m === 'mock';
    $('optScope').closest('.field-row').hidden = (m === 'review');

    // 試験回チップ
    const ec = $('examChips');
    if (ec.getAttribute('data-n') !== String(Store.exams.length)) {
      ec.innerHTML = '';
      Store.exams.forEach(function (e) {
        const n = Store.questions.filter(function (q) { return q.examId === e.id; }).length;
        const b = el('button', 'chip');
        b.setAttribute('data-exam', e.id);
        b.appendChild(document.createTextNode(e.label));
        b.appendChild(el('span', 'n', n + '問'));
        b.addEventListener('click', function () {
          toggleIn(UI.setup.exams, e.id);
          renderSetup();
        });
        ec.appendChild(b);
      });
      ec.setAttribute('data-n', String(Store.exams.length));
      if (!Store.exams.length) ec.appendChild(el('div', 'empty-msg', '試験回のデータがありません。'));
    }
    const ecb = ec.querySelectorAll('.chip');
    for (let i = 0; i < ecb.length; i++) {
      ecb[i].setAttribute('aria-pressed',
        String(UI.setup.exams.indexOf(ecb[i].getAttribute('data-exam')) >= 0));
    }

    // 分野チップ（大分野ごと）
    const fc = $('fieldChips');
    const stats = Store.statsByField();
    const have = Object.create(null);
    stats.forEach(function (s) { have[s.code] = s.total; });
    if (fc.getAttribute('data-n') !== String(stats.length)) {
      fc.innerHTML = '';
      window.AP_FIELDS.groups.forEach(function (g) {
        const inGroup = window.AP_FIELDS.all.filter(function (f) {
          return f.group === g && have[f.code];
        });
        if (!inGroup.length) return;
        fc.appendChild(el('div', 'group-title', g));
        const row = el('div', 'chips');
        inGroup.forEach(function (f) {
          const b = el('button', 'chip');
          b.setAttribute('data-field', f.code);
          b.appendChild(document.createTextNode(f.name));
          b.appendChild(el('span', 'n', have[f.code] + '問'));
          b.addEventListener('click', function () {
            toggleIn(UI.setup.fields, f.code);
            renderSetup();
          });
          row.appendChild(b);
        });
        fc.appendChild(row);
      });
      fc.setAttribute('data-n', String(stats.length));
      if (!stats.length) fc.appendChild(el('div', 'empty-msg', '分野のデータがありません。'));
    }
    const fcb = fc.querySelectorAll('.chip');
    for (let i = 0; i < fcb.length; i++) {
      fcb[i].setAttribute('aria-pressed',
        String(UI.setup.fields.indexOf(fcb[i].getAttribute('data-field')) >= 0));
    }

    // 復習スコープ
    const sc = $('scopeChips').querySelectorAll('.chip');
    for (let i = 0; i < sc.length; i++) {
      sc[i].setAttribute('aria-pressed', String(sc[i].getAttribute('data-scope') === UI.setup.scope));
    }

    // 模試の出題元
    const me = $('mockExam');
    if (me.getAttribute('data-n') !== String(Store.exams.length)) {
      me.innerHTML = '';
      const opt0 = el('option', null, '全回からシャッフル80問');
      opt0.value = '';
      me.appendChild(opt0);
      Store.exams.forEach(function (e) {
        const o = el('option', null, e.label);
        o.value = e.id;
        me.appendChild(o);
      });
      me.setAttribute('data-n', String(Store.exams.length));
    }

    updatePoolInfo();
  }

  function toggleIn(arr, v) {
    const i = arr.indexOf(v);
    if (i >= 0) arr.splice(i, 1); else arr.push(v);
  }

  function currentOpts() {
    const m = UI.setup.mode;
    if (m === 'mock') {
      return { mode: 'mock', examIds: $('mockExam').value ? [$('mockExam').value] : [] };
    }
    const o = {
      mode: m,
      examIds: m === 'exam' ? UI.setup.exams.slice() : [],
      fieldCodes: m === 'field' ? UI.setup.fields.slice() : [],
      scope: m === 'review' ? UI.setup.scope : $('optScope').value,
      order: $('optOrder').value,
      count: parseInt($('optCount').value, 10) || 0,
      immediate: $('optImmediate').checked
    };
    return o;
  }

  function updatePoolInfo() {
    const m = UI.setup.mode;
    if (m === 'mock') {
      $('poolInfo').textContent = '80問・150分。途中で中断しても再開できます。';
      $('btnStart').disabled = Store.questions.length === 0;
      return;
    }
    const o = currentOpts();
    const n = Quiz.pool(o).length;
    const c = o.count || 0;
    $('poolInfo').textContent = n === 0
      ? '条件に合う問題がありません。対象や範囲を変えてください。'
      : '条件に合う問題 ' + n + '問 → ' + (c > 0 ? Math.min(c, n) : n) + '問を出題します。';
    $('btnStart').disabled = n === 0;
  }

  /* ---------- 出題中 ---------- */

  function startSession(sess) {
    if (!sess) { toast('条件に合う問題がありません'); return; }
    Quiz.save();
    show('quiz');
  }

  function renderQuiz() {
    const s = Quiz.active;
    if (!s) { show('home'); return; }
    const q = Quiz.current();
    if (!q) { show('home'); return; }

    $('qProg').style.width = ((s.idx + 1) / s.qids.length * 100) + '%';

    const st = Store.stateOf(q.id);
    const meta = $('qMeta');
    meta.innerHTML = '';
    meta.appendChild(el('span', 'tag', Quiz.examLabel(q.examId)));
    meta.appendChild(el('span', 'tag', '問' + q.no));
    meta.appendChild(el('span', 'tag', Store.fieldLabel(q)));
    meta.appendChild(el('span', null, (s.idx + 1) + ' / ' + s.qids.length));
    if (st.starred) meta.appendChild(el('span', null, '★'));
    if (st.correctCount + st.wrongCount > 0) {
      meta.appendChild(el('span', null, '過去 ○' + st.correctCount + ' ×' + st.wrongCount));
    }
    if (q.needsReview) meta.appendChild(el('span', 'tag', '※要確認'));

    $('qText').textContent = q.text;
    renderFigures($('qFig'), q);

    const chosen = s.answers[q.id];
    const revealed = s.immediate && chosen !== undefined;
    renderChoices($('qChoices'), q, chosen, revealed, function (key) {
      Quiz.answer(key).then(function () {
        renderQuiz();
        if (s.immediate) renderHomeCountsLater();
      });
    });

    const vd = $('qVerdict');
    if (revealed) {
      const ok = chosen === q.answer;
      vd.hidden = false;
      vd.className = 'verdict ' + (ok ? 'ok' : 'ng');
      vd.textContent = ok ? '正解 — ' + q.answer : '不正解 — 正解は ' + q.answer + '（あなたの解答 ' + chosen + '）';
      renderExplain($('qExplain'), q);
      $('qNoteWrap').hidden = false;
      $('qNote').value = st.note || '';
      fillFieldSelect($('qFieldSel'), Store.fieldOf(q));
    } else {
      vd.hidden = true;
      $('qExplain').hidden = true;
      $('qNoteWrap').hidden = true;
    }

    $('btnPrev').disabled = s.idx === 0;
    $('btnNext').textContent = Quiz.isLast() ? '採点する' : '次へ';
    $('btnStar').textContent = st.starred ? '★ 解除' : '★ 付ける';
    $('btnFinish').hidden = !Quiz.isLast() ? false : true;

    if (s.limitSec) startTimer(); else setTopSub(Quiz.answeredCount() + '/' + s.qids.length + ' 回答');
    $('title').textContent = s.title || '出題中';
  }

  function renderExplain(host, q) {
    const t = (q && q.explanation ? String(q.explanation) : '').trim();
    if (!t) { host.hidden = true; host.innerHTML = ''; return; }
    host.innerHTML = '';
    host.appendChild(el('b', null, '解説'));
    host.appendChild(document.createTextNode(t));
    host.hidden = false;
  }

  /** 図表は表示するときだけ IndexedDB から読む（全問メモリに載せない） */
  function renderFigures(host, q) {
    host.innerHTML = '';
    const n = q.figureCount || (q.figures ? q.figures.length : 0);
    if (!n) return;
    const token = String(q.id) + ':' + Date.now();
    host.setAttribute('data-token', token);
    Store.figuresOf(q).then(function (srcs) {
      if (host.getAttribute('data-token') !== token) return;   // 表示中の問題が変わっていた
      host.innerHTML = '';
      srcs.forEach(function (src) {
        const img = document.createElement('img');
        img.alt = '問' + q.no + ' の図表';
        // data URI なので loading="lazy" は無意味（取得が発生しない）。付けると復号が遅れる
        img.decoding = 'sync';
        img.src = src;
        host.appendChild(img);
      });
    });
  }

  function renderChoices(host, q, chosen, revealed, onPick) {
    host.innerHTML = '';
    KEYS.forEach(function (k) {
      const txt = q.choices ? (q.choices[k] || '') : '';
      const b = el('button', 'choice');
      b.appendChild(el('span', 'key', k));
      b.appendChild(el('span', 'body', txt));
      let state = '';
      if (revealed) {
        if (k === q.answer) state = 'correct';
        else if (k === chosen) state = 'wrong';
      } else if (k === chosen) state = 'picked';
      if (state) b.setAttribute('data-state', state);
      if (revealed || !onPick) b.disabled = true;
      else b.addEventListener('click', function () { onPick(k); });
      host.appendChild(b);
    });
  }

  function fillFieldSelect(sel, code) {
    if (sel.getAttribute('data-filled') !== '1') {
      sel.innerHTML = '';
      window.AP_FIELDS.all.forEach(function (f) {
        const o = el('option', null, f.group.slice(0, 3) + '／' + f.name);
        o.value = f.code;
        sel.appendChild(o);
      });
      sel.setAttribute('data-filled', '1');
    }
    sel.value = code;
  }

  function startTimer() {
    stopTimer();
    tick();
    UI.timer = setInterval(tick, 1000);
  }

  function stopTimer() {
    if (UI.timer) { clearInterval(UI.timer); UI.timer = null; }
  }

  function tick() {
    const s = Quiz.active;
    if (!s || !s.limitSec) { stopTimer(); return; }
    const left = Quiz.remainingSec();
    const sub = $('topSub');
    sub.className = 'sub timer' + (left <= 600 ? ' warn' : '');
    sub.textContent = '残り ' + mmss(left) + ' · ' + Quiz.answeredCount() + '/' + s.qids.length;
    if (left <= 0) {
      stopTimer();
      toast('制限時間になりました。採点します。');
      finish();
    }
  }

  let _homeTimer = null;
  function renderHomeCountsLater() {
    clearTimeout(_homeTimer);
    _homeTimer = setTimeout(function () { /* ホームは表示時に再計算するので何もしない */ }, 0);
  }

  function finish() {
    Quiz.grade().then(function (res) {
      renderResult(res);
      show('result');
      return DB.setMeta('activeSession', null);
    }).catch(function (e) {
      toast('採点に失敗しました: ' + e.message);
    });
  }

  /* ---------- 結果 ---------- */

  function renderResult(res) {
    const s = Quiz.active;
    $('rTitle').textContent = (s && s.title) ? s.title : '結果';
    $('rRate').innerHTML = (res.rate * 100).toFixed(0) + '<span class="unit">%</span>';
    $('rCorrect').textContent = res.correct;
    $('rCount').textContent = res.count;
    $('rTime').textContent = mmss(res.elapsedSec);
    const unanswered = res.count - res.answered;
    $('rNote').textContent = unanswered > 0
      ? unanswered + '問が無回答でした（無回答は履歴に記録していません）。'
      : '間違えた問題は自動で「復習」に入っています。';

    const host = $('rList');
    host.innerHTML = '';
    res.rows.forEach(function (r) {
      if (!r.q) return;
      const b = el('button', 'item');
      const l1 = el('div', 'l1');
      l1.appendChild(el('span', null, Quiz.examLabel(r.q.examId) + ' 問' + r.q.no));
      l1.appendChild(el('span', null, Store.fieldLabel(r.q)));
      const rr = el('span', 'r ' + (r.correct ? 'badge-ok' : 'badge-ng'),
        r.chosen === null ? '無回答' : (r.correct ? '○ ' + r.chosen : '× ' + r.chosen + ' → ' + r.q.answer));
      l1.appendChild(rr);
      b.appendChild(l1);
      b.appendChild(el('div', 'l2', r.q.text));
      b.addEventListener('click', function () { openDetail(r.q.id, 'result'); });
      host.appendChild(b);
    });

    const wrongIds = res.rows.filter(function (r) {
      return r.q && !r.correct && r.chosen !== null;
    }).map(function (r) { return r.q.id; });
    $('btnRetryWrong').disabled = wrongIds.length === 0;
    $('btnRetryWrong').onclick = function () {
      startSession(Quiz.buildFromIds(wrongIds, 'やり直し（' + wrongIds.length + '問）'));
    };
  }

  /* ---------- 復習 ---------- */

  function renderReview() {
    const o = Store.overall();
    $('nUnresolved').textContent = o.unresolved;
    $('nEver').textContent = o.everWrong;
    $('nStarred').textContent = o.starred;

    const chips = $('revScopeChips').querySelectorAll('.chip');
    for (let i = 0; i < chips.length; i++) {
      chips[i].setAttribute('aria-pressed',
        String(chips[i].getAttribute('data-scope') === UI.review.scope));
    }

    const list = Store.wrongList(UI.review.scope);
    $('btnReviewStart').disabled = list.length === 0;
    $('btnReviewStart').textContent = 'この範囲で出題する（' + list.length + '問）';

    const host = $('revList');
    host.innerHTML = '';
    if (!list.length) {
      host.appendChild(el('div', 'empty-msg', '該当する問題はありません。'));
      return;
    }
    list.slice(0, 300).forEach(function (q) {
      const st = Store.stateOf(q.id);
      const b = el('button', 'item');
      const l1 = el('div', 'l1');
      l1.appendChild(el('span', null, Quiz.examLabel(q.examId) + ' 問' + q.no));
      l1.appendChild(el('span', null, Store.fieldLabel(q)));
      const tail = (st.starred ? '★ ' : '') + '○' + st.correctCount + ' ×' + st.wrongCount +
        (st.note ? ' 📝' : '');
      l1.appendChild(el('span', 'r' + (st.lastResult === 'wrong' ? ' badge-ng' : ''), tail));
      b.appendChild(l1);
      b.appendChild(el('div', 'l2', q.text));
      b.addEventListener('click', function () { openDetail(q.id, 'review'); });
      host.appendChild(b);
    });
    if (list.length > 300) {
      host.appendChild(el('div', 'empty-msg', '（先頭300件を表示しています）'));
    }
  }

  /* ---------- 問題詳細 ---------- */

  function openDetail(qid, from) {
    UI.detailQid = qid;
    UI.detailFrom = from || 'review';
    const q = Store.byId[qid];
    if (!q) return;
    const st = Store.stateOf(qid);

    const meta = $('dMeta');
    meta.innerHTML = '';
    meta.appendChild(el('span', 'tag', Quiz.examLabel(q.examId)));
    meta.appendChild(el('span', 'tag', '問' + q.no));
    meta.appendChild(el('span', 'tag', Store.fieldLabel(q)));
    meta.appendChild(el('span', null, '○' + st.correctCount + ' ×' + st.wrongCount));
    if (st.lastTs) {
      meta.appendChild(el('span', null,
        '最終 ' + new Date(st.lastTs).toLocaleDateString('ja-JP') +
        '（' + (st.lastResult === 'correct' ? '正解' : '不正解') + '）'));
    }

    $('dText').textContent = q.text;
    renderFigures($('dFig'), q);
    renderChoices($('dChoices'), q, st.lastChosen, true, null);
    renderExplain($('dExplain'), q);
    $('dNote').value = st.note || '';
    $('dStar').textContent = st.starred ? '★ を外す' : '★ を付ける';
    fillFieldSelect($('dFieldSel'), Store.fieldOf(q));
    show('detail');
  }

  /* ---------- 統計 ---------- */

  function renderStats() {
    const fs = Store.statsByField().filter(function (r) { return r.total > 0; });
    Chart.renderBars($('fieldChart'), fs);
    Chart.renderTable($('fieldTable'), fs);

    const es = Store.statsByExam().filter(function (r) { return r.total > 0; })
      .map(function (r) { return Object.assign({}, r, { name: r.label }); });
    Chart.renderBars($('examChart'), es, { sort: 'given' });

    DB.getAll('sessions').then(function (rows) {
      const host = $('sessList');
      host.innerHTML = '';
      if (!rows.length) {
        host.appendChild(el('div', 'empty-msg', 'まだ完了したセッションがありません。'));
        return;
      }
      rows.sort(function (a, b) { return (b.endedAt || 0) - (a.endedAt || 0); })
        .slice(0, 50).forEach(function (r) {
          const d = el('div', 'item');
          const l1 = el('div', 'l1');
          l1.appendChild(el('span', null, new Date(r.endedAt).toLocaleString('ja-JP')));
          l1.appendChild(el('span', null, r.mode === 'mock' ? '模試' : '演習'));
          l1.appendChild(el('span', 'r', pct(r.rate)));
          d.appendChild(l1);
          d.appendChild(el('div', 'l2',
            (r.title || '') + ' — ' + r.correct + '/' + r.count + '問正答' +
            (r.limitSec ? ' · 所要 ' + mmss(Math.floor((r.endedAt - r.startedAt) / 1000)) : '')));
          host.appendChild(d);
        });
    });
  }

  /* ---------- 設定 ---------- */

  function renderSettings() {
    DB.getMeta('bankImportedAt', null).then(function (ts) {
      $('setBankInfo').textContent = Store.questions.length
        ? Store.questions.length + ' 問 / ' + Store.exams.length + ' 回分' +
          (ts ? '（最終取り込み ' + new Date(ts).toLocaleString('ja-JP') + '）' : '')
        : '問題データが未登録です。';
    });
    const sm = $('setSyncMsg');
    if (Store.syncState.error) {
      sm.hidden = false;
      sm.textContent = '⚠ ' + Store.syncState.error;
      sm.style.color = 'var(--critical)';
    } else if (Store.syncState.updated) {
      sm.hidden = false;
      sm.textContent = '起動時に新しい問題データを取り込みました。';
      sm.style.color = 'var(--good-text)';
    } else {
      sm.hidden = true;
    }

    $('setTheme').value = localStorage.getItem('ap-theme') || 'auto';
    $('swInfo').textContent = ('serviceWorker' in navigator)
      ? (navigator.serviceWorker.controller
        ? 'オフライン対応：有効（機内モードでも起動します）'
        : 'オフライン対応：登録待ち。一度リロードしてください。')
      : 'この環境では Service Worker が使えないため、オフライン起動は保証されません（ホーム画面から https で開くと有効になります）。';
  }

  function readJsonFile(input, handler) {
    const f = input.files && input.files[0];
    if (!f) return;
    const fr = new FileReader();
    fr.onload = function () {
      let obj;
      try { obj = JSON.parse(fr.result); }
      catch (e) { toast('JSON として読めませんでした'); return; }
      handler(obj);
    };
    fr.onerror = function () { toast('ファイルを読めませんでした'); };
    fr.readAsText(f, 'utf-8');
    input.value = '';
  }

  function download(name, text) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function applyTheme(v) {
    if (v === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', v);
    localStorage.setItem('ap-theme', v);
  }

  /* ---------- 配線 ---------- */

  function wire() {
    const tb = $('tabbar').querySelectorAll('button');
    for (let i = 0; i < tb.length; i++) {
      tb[i].addEventListener('click', function () {
        show(this.getAttribute('data-tab'));
      });
    }

    // ホーム
    $('btnResume').addEventListener('click', function () { show('quiz'); });
    $('btnDiscard').addEventListener('click', function () {
      Quiz.discard().then(function () { renderHome(); toast('破棄しました'); });
    });
    $('btnQuickReview').addEventListener('click', function () {
      const ids = Store.wrongList('unresolved').map(function (q) { return q.id; });
      startSession(Quiz.buildFromIds(ids, '未克服の誤答（' + ids.length + '問）'));
    });
    $('btnQuickRandom').addEventListener('click', function () {
      startSession(Quiz.build({ mode: 'field', scope: 'all', order: 'random', count: 20, title: 'ランダム20問' }));
    });
    $('btnQuickNew').addEventListener('click', function () {
      startSession(Quiz.build({ mode: 'field', scope: 'unanswered', order: 'random', count: 20, title: '未回答から20問' }));
    });
    $('btnGoImport').addEventListener('click', function () { show('settings'); });

    // 出題設定
    const mc = $('modeChips').querySelectorAll('.chip');
    for (let i = 0; i < mc.length; i++) {
      mc[i].addEventListener('click', function () {
        UI.setup.mode = this.getAttribute('data-mode');
        renderSetup();
      });
    }
    const sc = $('scopeChips').querySelectorAll('.chip');
    for (let i = 0; i < sc.length; i++) {
      sc[i].addEventListener('click', function () {
        UI.setup.scope = this.getAttribute('data-scope');
        renderSetup();
      });
    }
    document.querySelectorAll('[data-sel]').forEach(function (b) {
      b.addEventListener('click', function () {
        const k = b.getAttribute('data-sel');
        if (k === 'exam-all') UI.setup.exams = Store.exams.map(function (e) { return e.id; });
        if (k === 'exam-none') UI.setup.exams = [];
        if (k === 'field-all') UI.setup.fields = Store.statsByField()
          .filter(function (r) { return r.total > 0; }).map(function (r) { return r.code; });
        if (k === 'field-none') UI.setup.fields = [];
        renderSetup();
      });
    });
    ['optScope', 'optOrder', 'optCount', 'optImmediate', 'mockExam'].forEach(function (id) {
      $(id).addEventListener('change', updatePoolInfo);
    });
    $('btnStart').addEventListener('click', function () {
      const o = currentOpts();
      if (o.mode === 'mock') {
        startSession(Quiz.buildMock(o.examIds[0] || null));
        return;
      }
      o.title = titleFor(o);
      startSession(Quiz.build(o));
    });

    // 出題中
    $('btnPrev').addEventListener('click', function () { Quiz.prev(); renderQuiz(); });
    $('btnNext').addEventListener('click', function () {
      if (Quiz.isLast()) finish(); else { Quiz.next(); renderQuiz(); }
    });
    $('btnStar').addEventListener('click', function () {
      const q = Quiz.current();
      if (!q) return;
      Store.toggleStar(q.id).then(renderQuiz);
    });
    $('btnFinish').addEventListener('click', finish);
    $('btnQuit').addEventListener('click', function () {
      Quiz.save().then(function () { show('home'); toast('中断しました。ホームから再開できます。'); });
    });
    $('btnSaveNote').addEventListener('click', function () {
      const q = Quiz.current();
      if (!q) return;
      Store.setNote(q.id, $('qNote').value).then(function () { toast('メモを保存しました'); });
    });
    $('qFieldSel').addEventListener('change', function () {
      const q = Quiz.current();
      if (!q) return;
      Store.setField(q.id, this.value).then(function () { renderQuiz(); toast('分野を変更しました'); });
    });

    // 結果
    $('btnResultHome').addEventListener('click', function () {
      Quiz.active = null;
      show('home');
    });

    // 復習
    const rsc = $('revScopeChips').querySelectorAll('.chip');
    for (let i = 0; i < rsc.length; i++) {
      rsc[i].addEventListener('click', function () {
        UI.review.scope = this.getAttribute('data-scope');
        renderReview();
      });
    }
    $('btnReviewStart').addEventListener('click', function () {
      const label = { unresolved: '未克服の誤答', ever: '過去の誤答', starred: '★の問題' }[UI.review.scope];
      const ids = Store.wrongList(UI.review.scope).map(function (q) { return q.id; });
      startSession(Quiz.buildFromIds(ids, label + '（' + ids.length + '問）'));
    });

    // 詳細
    $('dBack').addEventListener('click', function () { show(UI.detailFrom); });
    $('dSaveNote').addEventListener('click', function () {
      Store.setNote(UI.detailQid, $('dNote').value).then(function () { toast('メモを保存しました'); });
    });
    $('dStar').addEventListener('click', function () {
      Store.toggleStar(UI.detailQid).then(function () { openDetail(UI.detailQid, UI.detailFrom); });
    });
    $('dFieldSel').addEventListener('change', function () {
      Store.setField(UI.detailQid, this.value).then(function () {
        openDetail(UI.detailQid, UI.detailFrom);
        toast('分野を変更しました');
      });
    });

    // 統計
    $('btnFieldTable').addEventListener('click', function () {
      const t = $('fieldTable');
      t.hidden = !t.hidden;
      this.textContent = t.hidden ? '表で見る' : 'グラフだけにする';
    });
    $('btnFieldStudy').addEventListener('click', function () {
      const weak = Store.statsByField().filter(function (r) {
        return r.attempts >= 3 && r.rate !== null && r.rate < 0.6;
      }).map(function (r) { return r.code; });
      if (!weak.length) { toast('まだ弱点と判定できる分野がありません'); return; }
      UI.setup.mode = 'field';
      UI.setup.fields = weak;
      show('setup');
      toast(weak.length + ' 分野を選択しました');
    });

    // 設定
    $('btnPickBank').addEventListener('click', function () { $('fileBank').click(); });
    $('fileBank').addEventListener('change', function () {
      readJsonFile(this, function (obj) {
        Store.importBank(obj).then(function (r) {
          toast(r.questions + '問を取り込みました');
          renderSettings();
        }).catch(function (e) { alert('取り込めませんでした:\n' + e.message); });
      });
    });
    $('btnExport').addEventListener('click', function () {
      Store.exportProgress().then(function (o) {
        const d = new Date();
        const p = function (n) { return n < 10 ? '0' + n : String(n); };
        download('ap-progress-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '.json',
          JSON.stringify(o));
        toast('書き出しました');
      });
    });
    $('btnPickProgress').addEventListener('click', function () { $('fileProgress').click(); });
    $('fileProgress').addEventListener('change', function () {
      readJsonFile(this, function (obj) {
        if (!confirm('現在の学習履歴を置き換えます。よろしいですか？')) return;
        Store.importProgress(obj).then(function () {
          toast('学習履歴を復元しました');
          renderSettings();
        }).catch(function (e) { alert(e.message); });
      });
    });
    $('setTheme').addEventListener('change', function () { applyTheme(this.value); });
    $('btnResetProgress').addEventListener('click', function () {
      if (!confirm('学習履歴（午前の誤答・メモ・統計、午後の解答と自己採点）を全部消します。よろしいですか？')) return;
      Store.resetProgress().then(function () { toast('消去しました'); renderSettings(); });
    });
    $('btnResetAll').addEventListener('click', function () {
      if (!confirm('問題データと学習履歴を全部消します。よろしいですか？')) return;
      Store.resetAll().then(function () { toast('消去しました'); renderSettings(); });
    });

    // 出題中の左右キー（PC で確認するとき用）
    document.addEventListener('keydown', function (ev) {
      if (UI.tab !== 'quiz') return;
      if (ev.key === 'ArrowRight') { $('btnNext').click(); }
      if (ev.key === 'ArrowLeft') { $('btnPrev').click(); }
      const i = KEYS.indexOf(ev.key);
      if (i >= 0) {
        const b = $('qChoices').querySelectorAll('.choice')[i];
        if (b && !b.disabled) b.click();
      }
      if ('1234'.indexOf(ev.key) >= 0) {
        const b = $('qChoices').querySelectorAll('.choice')[parseInt(ev.key, 10) - 1];
        if (b && !b.disabled) b.click();
      }
    });
  }

  function titleFor(o) {
    if (o.mode === 'exam') {
      if (!o.examIds.length) return '全回から出題';
      if (o.examIds.length === 1) return Quiz.examLabel(o.examIds[0]);
      return o.examIds.length + '回分から出題';
    }
    if (o.mode === 'field') {
      if (!o.fieldCodes.length) return '全分野から出題';
      if (o.fieldCodes.length === 1) return window.AP_FIELDS.name(o.fieldCodes[0]);
      return o.fieldCodes.length + '分野から出題';
    }
    if (o.mode === 'review') {
      return { unresolved: '未克服の誤答', ever: '過去の誤答', starred: '★の問題' }[o.scope] || '復習';
    }
    return '出題';
  }

  /* ---------- 起動 ---------- */

  applyTheme(localStorage.getItem('ap-theme') || 'auto');

  // 午後モジュールから画面遷移を呼べるようにする
  window.AppHooks = { show: show, toast: toast };

  // 操作できるようにするのを先に済ませる。データの取得を待ってから wire すると、
  // 初回は数十MBのダウンロードが終わるまでタブすら切り替えられない。
  wire();
  if (window.PMUI) PMUI.wire();
  show('home');

  // 解答中・採点中に描き直すと入力や進行が飛ぶので、一覧系の画面だけ描き直す
  const REDRAWABLE = { home: 1, setup: 1, pm: 1, review: 1, stats: 1, settings: 1 };
  function redraw() { if (REDRAWABLE[UI.tab]) show(UI.tab); }

  Store.init()
    .then(function () { return Quiz.restore(); })
    .then(function () {
      redraw();
      if (!Store.questions.length) {
        toast('問題データを設定画面から読み込んでください');
      }
      // 午後は42MBあるので待たない。終わったら今の画面だけ描き直す
      if (window.PM) PM.init().then(redraw).catch(function () { });
    })
    .catch(function (e) {
      document.querySelector('main').innerHTML =
        '<div class="card"><h2>起動できませんでした</h2><p class="hint">' +
        (e && e.message ? e.message : e) +
        '</p><p class="hint">プライベートブラウズだと IndexedDB が使えない場合があります。通常のタブで開いてください。</p></div>';
    });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* 失敗しても動く */ });
    });
  }
})();
