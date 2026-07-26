/* 出題セッションの生成・進行・保存（中断しても再開できる） */
(function () {
  'use strict';

  const MOCK_COUNT = 80;
  const MOCK_SEC = 150 * 60;

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  const Quiz = {
    MOCK_COUNT: MOCK_COUNT,
    MOCK_SEC: MOCK_SEC,
    active: null,

    /**
     * opts = {
     *   mode: 'exam'|'field'|'review'|'mock',
     *   examIds: [], fieldCodes: [],
     *   scope: 'all'|'unanswered'|'unresolved'|'ever'|'starred',
     *   order: 'no'|'random', count: number|0(=全部), immediate: bool
     * }
     */
    pool: function (opts) {
      const examSet = opts.examIds && opts.examIds.length ? new Set(opts.examIds) : null;
      const fieldSet = opts.fieldCodes && opts.fieldCodes.length ? new Set(opts.fieldCodes) : null;
      const scope = opts.scope || 'all';

      return Store.questions.filter(function (q) {
        if (examSet && !examSet.has(q.examId)) return false;
        if (fieldSet && !fieldSet.has(Store.fieldOf(q))) return false;
        const st = Store.state[q.id];
        if (scope === 'unanswered') return !st || !st.lastTs;
        if (scope === 'unresolved') return !!st && st.lastResult === 'wrong';
        if (scope === 'ever') return !!st && st.wrongCount > 0;
        if (scope === 'starred') return !!st && st.starred;
        return true;
      });
    },

    build: function (opts) {
      let pool = Quiz.pool(opts);
      if (!pool.length) return null;

      const order = opts.order || 'random';
      let list = order === 'no' ? pool.slice() : shuffle(pool);
      if (order === 'no') {
        list.sort(function (a, b) {
          if (a.examId !== b.examId) return a.examId < b.examId ? 1 : -1;
          return (a.no || 0) - (b.no || 0);
        });
      }
      const count = opts.count || 0;
      if (count > 0 && list.length > count) list = list.slice(0, count);

      const sess = {
        id: 's' + Date.now(),
        mode: opts.mode || 'field',
        title: opts.title || '',
        qids: list.map(function (q) { return q.id; }),
        idx: 0,
        answers: {},
        immediate: opts.immediate !== false,
        order: order,
        startedAt: Date.now(),
        limitSec: opts.limitSec || null,
        endedAt: null,
        graded: false,
        poolSize: pool.length
      };
      Quiz.active = sess;
      return sess;
    },

    /** 問題 ID を直接指定して出題する（結果画面の「間違えた問題だけやり直す」など） */
    buildFromIds: function (qids, title, opts) {
      opts = opts || {};
      const list = (qids || []).filter(function (id) { return !!Store.byId[id]; });
      if (!list.length) return null;
      const sess = {
        id: 's' + Date.now(),
        mode: opts.mode || 'review',
        title: title || '',
        qids: opts.order === 'no' ? list.slice() : shuffle(list),
        idx: 0,
        answers: {},
        immediate: opts.immediate !== false,
        order: opts.order || 'random',
        startedAt: Date.now(),
        limitSec: null,
        endedAt: null,
        graded: false,
        poolSize: list.length
      };
      Quiz.active = sess;
      return sess;
    },

    buildMock: function (examId) {
      const opts = examId
        ? { mode: 'mock', examIds: [examId], order: 'no', count: MOCK_COUNT }
        : { mode: 'mock', order: 'random', count: MOCK_COUNT };
      opts.scope = 'all';
      opts.immediate = false;
      opts.limitSec = MOCK_SEC;
      opts.title = examId ? (Quiz.examLabel(examId) + '（模試）') : '全回シャッフル（模試）';
      return Quiz.build(opts);
    },

    examLabel: function (examId) {
      for (let i = 0; i < Store.exams.length; i++) {
        if (Store.exams[i].id === examId) return Store.exams[i].label;
      }
      return examId;
    },

    current: function () {
      const s = Quiz.active;
      if (!s) return null;
      return Store.byId[s.qids[s.idx]] || null;
    },

    remainingSec: function () {
      const s = Quiz.active;
      if (!s || !s.limitSec) return null;
      const used = Math.floor((Date.now() - s.startedAt) / 1000);
      return Math.max(0, s.limitSec - used);
    },

    /** 回答を保存。即時採点モードならその場で記録する */
    answer: function (key) {
      const s = Quiz.active;
      if (!s) return Promise.resolve(null);
      const qid = s.qids[s.idx];
      const already = Object.prototype.hasOwnProperty.call(s.answers, qid);
      s.answers[qid] = key;

      if (s.immediate) {
        if (already) return Quiz.save().then(function () { return null; });
        return Store.record(qid, key, s.id, s.mode).then(function (r) {
          return Quiz.save().then(function () { return r; });
        });
      }
      return Quiz.save().then(function () { return null; });
    },

    answeredCount: function () {
      const s = Quiz.active;
      return s ? Object.keys(s.answers).length : 0;
    },

    go: function (i) {
      const s = Quiz.active;
      if (!s) return;
      s.idx = Math.max(0, Math.min(s.qids.length - 1, i));
      Quiz.save();
    },

    next: function () { Quiz.go((Quiz.active ? Quiz.active.idx : 0) + 1); },
    prev: function () { Quiz.go((Quiz.active ? Quiz.active.idx : 0) - 1); },

    isLast: function () {
      const s = Quiz.active;
      return !!s && s.idx >= s.qids.length - 1;
    },

    /** 一括採点（模試モード）。ここで誤答が蓄積される */
    grade: function () {
      const s = Quiz.active;
      if (!s) return Promise.resolve(null);
      s.endedAt = Date.now();

      let chain = Promise.resolve();
      if (!s.immediate && !s.graded) {
        s.qids.forEach(function (qid) {
          const chosen = s.answers[qid];
          if (chosen === undefined) return;   // 無回答は記録しない
          chain = chain.then(function () { return Store.record(qid, chosen, s.id, s.mode); });
        });
      }
      s.graded = true;

      return chain.then(function () {
        const res = Quiz.result();
        return DB.put('sessions', {
          sid: s.id, mode: s.mode, title: s.title,
          startedAt: s.startedAt, endedAt: s.endedAt,
          count: s.qids.length, answered: res.answered,
          correct: res.correct, rate: res.rate,
          limitSec: s.limitSec || null,
          qids: s.qids, answers: s.answers
        }).then(function () { return res; });
      });
    },

    result: function () {
      const s = Quiz.active;
      if (!s) return null;
      let correct = 0, answered = 0;
      const rows = s.qids.map(function (qid) {
        const q = Store.byId[qid];
        const chosen = s.answers[qid];
        const ok = chosen !== undefined && q && chosen === q.answer;
        if (chosen !== undefined) answered += 1;
        if (ok) correct += 1;
        return { q: q, chosen: chosen === undefined ? null : chosen, correct: ok };
      });
      return {
        count: s.qids.length, answered: answered, correct: correct,
        rate: s.qids.length ? correct / s.qids.length : 0,
        elapsedSec: Math.floor(((s.endedAt || Date.now()) - s.startedAt) / 1000),
        rows: rows
      };
    },

    /* ---------- 中断・再開 ---------- */

    save: function () {
      if (!Quiz.active) return Promise.resolve();
      return DB.setMeta('activeSession', Quiz.active);
    },

    restore: function () {
      return DB.getMeta('activeSession', null).then(function (s) {
        if (!s || !s.qids || !s.qids.length || s.graded) return null;
        // 問題バンクが差し替わって存在しない id が混ざっていたら捨てる
        const ok = s.qids.every(function (id) { return !!Store.byId[id]; });
        if (!ok) return null;
        Quiz.active = s;
        return s;
      });
    },

    discard: function () {
      Quiz.active = null;
      return DB.setMeta('activeSession', null);
    }
  };

  window.Quiz = Quiz;
})();
