/* 問題バンク + 学習状態のストア
   - 問題データは data/questions.js（同梱）か、設定画面からの JSON インポートで入る
   - 学習状態（誤答蓄積・メモ）は questions を差し替えても消えない（qid で別管理） */
(function () {
  'use strict';

  const KEYS = ['ア', 'イ', 'ウ', 'エ'];

  const Store = {
    exams: [],          // [{id,label,year,season,order}]
    questions: [],      // [{id,examId,no,text,choices,answer,field,fieldName,figures,needsReview}]
    byId: Object.create(null),
    state: Object.create(null),   // qid -> qstate
    KEYS: KEYS,

    /** 同梱データの取り込み状況。UI のメッセージ用 */
    syncState: { checked: false, updated: false, error: null },

    /** アプリ側のデータ構造の版。上げると次回起動でバンクを取り直す */
    APP_SCHEMA: 2,

    init: function () {
      return DB.open()
        .then(function () {
          // 構造が変わったらスタンプを消して取り直させる（学習履歴には触らない）
          return DB.getMeta('appSchema', 0).then(function (v) {
            if (v === Store.APP_SCHEMA) return null;
            return DB.setMeta('bankStamp', null)
              .then(function () { return DB.setMeta('appSchema', Store.APP_SCHEMA); });
          });
        })
        .then(function () { return Store._syncBundled(); })
        .then(function () { return Store.reload(); });
    },

    /** 図表画像は表示するときだけ読む */
    figuresOf: function (q) {
      if (q && q.figures && q.figures.length) return Promise.resolve(q.figures); // 旧形式
      if (!q || !q.figureCount) return Promise.resolve([]);
      return DB.get('figures', q.id).then(function (row) {
        return row && row.images ? row.images : [];
      }).catch(function () { return []; });
    },

    /* 問題データの取り込み。
       毎回 11MB の JSON を読み込むのは重いので、まず数十バイトの version.json だけを見て、
       スタンプが変わっていなければ本体は取りに行かない。取り込み後は IndexedDB だけで動く。 */
    _syncBundled: function () {
      // data/questions.js を同梱している場合（file:// で開いたときなど）はそれを使う
      const inline = window.AP_BUNDLED_QUESTIONS;
      if (inline && inline.questions && inline.questions.length) {
        return Store._importIfNew(inline.stamp || 'inline', function () {
          return Promise.resolve(inline);
        });
      }
      if (location.protocol === 'file:') {
        Store.syncState.error = 'file: で開いているため問題データを自動取得できません。'
          + '設定画面から questions.json を読み込んでください。';
        return Promise.resolve();
      }
      return fetch('data/version.json', { cache: 'no-cache' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; })
        .then(function (ver) {
          if (!ver || !ver.stamp) return null;   // オフラインで未取得なら既存DBのまま動かす
          return Store._importIfNew(ver.stamp, function () {
            return fetch('data/questions.json').then(function (r) {
              if (!r.ok) throw new Error('questions.json を取得できません (' + r.status + ')');
              return r.json();
            });
          });
        })
        .catch(function (e) {
          Store.syncState.error = e && e.message ? e.message : String(e);
          return null;
        });
    },

    _importIfNew: function (stamp, fetchBank) {
      Store.syncState.checked = true;
      return DB.getMeta('bankStamp').then(function (cur) {
        return DB.count('questions').then(function (n) {
          if (cur === stamp && n > 0) return null;
          return fetchBank()
            .then(function (bank) { return Store.importBank(bank, { silent: true }); })
            .then(function (r) {
              Store.syncState.updated = true;
              Store._dropCachedBank();
              return r;
            });
        });
      });
    },

    /* 取り込みが済めば questions.json はもう不要。キャッシュから外して端末の容量を返す */
    _dropCachedBank: function () {
      if (!window.caches) return;
      caches.keys().then(function (keys) {
        keys.forEach(function (k) {
          caches.open(k).then(function (c) {
            c.delete('data/questions.json');
            c.delete(new URL('data/questions.json', location.href).href);
          });
        });
      }).catch(function () { });
    },

    reload: function () {
      return Promise.all([
        DB.getAll('exams'),
        DB.getAll('questions'),
        DB.getAll('qstate')
      ]).then(function (r) {
        Store.exams = r[0].sort(function (a, b) {
          return (b.order || 0) - (a.order || 0);   // 新しい回を先頭に
        });
        Store.questions = r[1].sort(function (a, b) {
          if (a.examId !== b.examId) return a.examId < b.examId ? 1 : -1;
          return (a.no || 0) - (b.no || 0);
        });
        Store.byId = Object.create(null);
        Store.questions.forEach(function (q) { Store.byId[q.id] = q; });
        Store.state = Object.create(null);
        r[2].forEach(function (s) { Store.state[s.qid] = s; });
        return Store;
      });
    },

    /* ---------- 取り込み ---------- */

    /** questions.json 形式のオブジェクトを取り込む（同 id は上書き、学習状態は保持） */
    importBank: function (obj, opts) {
      opts = opts || {};
      const errs = Store.validateBank(obj);
      if (errs.length) return Promise.reject(new Error(errs.join('\n')));

      const exams = (obj.exams || []).map(function (e, i) {
        return {
          id: String(e.id),
          label: e.label || String(e.id),
          year: e.year || null,
          season: e.season || '',
          order: typeof e.order === 'number' ? e.order : (e.year || 0) * 10 + (e.season === 'autumn' ? 2 : 1) || i
        };
      });
      // 図表画像は別ストアへ。問題本体は軽く保つ
      const figs = [];
      const qs = obj.questions.map(function (q) {
        const images = q.figures || [];
        if (images.length) figs.push({ qid: String(q.id), images: images });
        return {
          id: String(q.id),
          examId: String(q.examId),
          no: Number(q.no) || 0,
          text: String(q.text || ''),
          choices: q.choices || {},
          answer: String(q.answer || '').trim(),
          field: q.field || 'X00',
          fieldName: q.fieldName || '',
          explanation: String(q.explanation || ''),
          figureCount: images.length,
          needsReview: !!q.needsReview
        };
      });

      return DB.putAll('exams', exams)
        .then(function () { return DB.putAll('questions', qs); })
        .then(function () { return DB.putAll('figures', figs); })
        .then(function () { return DB.setMeta('bankStamp', obj.stamp || String(Date.now())); })
        .then(function () { return DB.setMeta('bankImportedAt', Date.now()); })
        .then(function () { return opts.silent ? null : Store.reload(); })
        .then(function () { return { exams: exams.length, questions: qs.length }; });
    },

    validateBank: function (obj) {
      const e = [];
      if (!obj || typeof obj !== 'object') { e.push('JSON の形式が読めません。'); return e; }
      if (!Array.isArray(obj.questions)) { e.push('questions 配列がありません。'); return e; }
      if (!obj.questions.length) e.push('questions が空です。');
      let bad = 0;
      obj.questions.slice(0, 2000).forEach(function (q) {
        if (!q || !q.id || !q.examId || !q.text) bad++;
        else if (KEYS.indexOf(String(q.answer || '').trim()) < 0) bad++;
      });
      if (bad) e.push(bad + ' 件の問題に id / examId / text / answer の欠損があります。');
      return e;
    },

    /* ---------- 分野 ---------- */

    fieldOf: function (q) {
      const st = Store.state[q.id];
      if (st && st.fieldOverride) return st.fieldOverride;
      return q.field || 'X00';
    },

    fieldLabel: function (q) {
      return window.AP_FIELDS.name(Store.fieldOf(q), q.fieldName);
    },

    setField: function (qid, code) {
      return Store._patchState(qid, { fieldOverride: code || null });
    },

    /* ---------- 学習状態 ---------- */

    _blank: function (qid) {
      return {
        qid: qid, correctCount: 0, wrongCount: 0,
        lastResult: null, lastChosen: null, lastTs: null,
        starred: false, note: '', fieldOverride: null
      };
    },

    stateOf: function (qid) {
      return Store.state[qid] || Store._blank(qid);
    },

    _patchState: function (qid, patch) {
      const st = Object.assign(Store._blank(qid), Store.state[qid] || {}, patch);
      Store.state[qid] = st;
      return DB.put('qstate', st).then(function () { return st; });
    },

    /** 1 問の回答を記録する。誤答は自動的に蓄積される */
    record: function (qid, chosen, sessionId, mode) {
      const q = Store.byId[qid];
      if (!q) return Promise.resolve(null);
      const correct = chosen === q.answer;
      const ts = Date.now();
      const st = Object.assign(Store._blank(qid), Store.state[qid] || {});
      if (correct) st.correctCount += 1; else st.wrongCount += 1;
      st.lastResult = correct ? 'correct' : 'wrong';
      st.lastChosen = chosen;
      st.lastTs = ts;
      Store.state[qid] = st;

      return DB.put('qstate', st)
        .then(function () {
          return DB.put('attempts', {
            qid: qid, ts: ts, chosen: chosen, correct: correct,
            sessionId: sessionId || null, mode: mode || null
          });
        })
        .then(function () { return { correct: correct, answer: q.answer, state: st }; });
    },

    setNote: function (qid, note) { return Store._patchState(qid, { note: note }); },
    toggleStar: function (qid) {
      const st = Store.stateOf(qid);
      return Store._patchState(qid, { starred: !st.starred });
    },

    /* ---------- 集計 ---------- */

    overall: function () {
      let answered = 0, correct = 0, wrong = 0, unresolved = 0, starred = 0;
      Store.questions.forEach(function (q) {
        const st = Store.state[q.id];
        if (!st || !st.lastTs) return;
        answered += 1;
        correct += st.correctCount;
        wrong += st.wrongCount;
        if (st.lastResult === 'wrong') unresolved += 1;
        if (st.starred) starred += 1;
      });
      const attempts = correct + wrong;
      return {
        total: Store.questions.length,
        answered: answered,
        attempts: attempts,
        correct: correct,
        wrong: wrong,
        rate: attempts ? correct / attempts : null,
        unresolved: unresolved,     // 最後の回答が誤答＝まだ克服していない
        everWrong: Store.questions.filter(function (q) {
          const st = Store.state[q.id];
          return st && st.wrongCount > 0;
        }).length,
        starred: starred
      };
    },

    /** 分野別の正答率。attempts ベース（同じ問題を複数回解いた分も反映） */
    statsByField: function () {
      const acc = Object.create(null);
      Store.questions.forEach(function (q) {
        const code = Store.fieldOf(q);
        if (!acc[code]) {
          acc[code] = {
            code: code, name: window.AP_FIELDS.name(code, q.fieldName),
            group: window.AP_FIELDS.group(code),
            total: 0, answered: 0, attempts: 0, correct: 0, unresolved: 0
          };
        }
        const a = acc[code];
        a.total += 1;
        const st = Store.state[q.id];
        if (st && st.lastTs) {
          a.answered += 1;
          a.attempts += st.correctCount + st.wrongCount;
          a.correct += st.correctCount;
          if (st.lastResult === 'wrong') a.unresolved += 1;
        }
      });
      return Object.keys(acc).map(function (k) {
        const a = acc[k];
        a.rate = a.attempts ? a.correct / a.attempts : null;
        return a;
      }).sort(function (x, y) {
        return window.AP_FIELDS.order(x.code) - window.AP_FIELDS.order(y.code);
      });
    },

    statsByExam: function () {
      const acc = Object.create(null);
      Store.exams.forEach(function (e) {
        acc[e.id] = { id: e.id, label: e.label, order: e.order, total: 0, answered: 0, attempts: 0, correct: 0, unresolved: 0 };
      });
      Store.questions.forEach(function (q) {
        const a = acc[q.examId] || (acc[q.examId] = { id: q.examId, label: q.examId, order: 0, total: 0, answered: 0, attempts: 0, correct: 0, unresolved: 0 });
        a.total += 1;
        const st = Store.state[q.id];
        if (st && st.lastTs) {
          a.answered += 1;
          a.attempts += st.correctCount + st.wrongCount;
          a.correct += st.correctCount;
          if (st.lastResult === 'wrong') a.unresolved += 1;
        }
      });
      return Object.keys(acc).map(function (k) {
        const a = acc[k];
        a.rate = a.attempts ? a.correct / a.attempts : null;
        return a;
      }).sort(function (x, y) { return (y.order || 0) - (x.order || 0); });
    },

    /** 誤答リスト。scope: 'unresolved' | 'ever' | 'starred' */
    wrongList: function (scope) {
      return Store.questions.filter(function (q) {
        const st = Store.state[q.id];
        if (!st) return false;
        if (scope === 'starred') return !!st.starred;
        if (scope === 'ever') return st.wrongCount > 0;
        return st.lastResult === 'wrong';
      }).sort(function (a, b) {
        const sa = Store.state[a.id], sb = Store.state[b.id];
        return (sb.lastTs || 0) - (sa.lastTs || 0);
      });
    },

    /* ---------- バックアップ ---------- */

    // 午後の解答・自己採点（pmState）も履歴の一部。schema 2 から含める
    exportProgress: function () {
      return Promise.all([
        DB.getAll('qstate'), DB.getAll('attempts'), DB.getAll('sessions'),
        DB.getAll('pmState')
      ]).then(function (r) {
        return {
          kind: 'ap-study-progress', schema: 2, exportedAt: new Date().toISOString(),
          qstate: r[0], attempts: r[1], sessions: r[2], pmState: r[3]
        };
      });
    },

    importProgress: function (obj) {
      if (!obj || obj.kind !== 'ap-study-progress') {
        return Promise.reject(new Error('学習履歴のバックアップファイルではありません。'));
      }
      // schema 1 のファイルには pmState が無い。そのときは午後の記録を消さずに残す
      const hasPm = Object.prototype.hasOwnProperty.call(obj, 'pmState');
      const stores = ['qstate', 'attempts', 'sessions'].concat(hasPm ? ['pmState'] : []);
      return DB.clear(stores)
        .then(function () { return DB.putAll('qstate', obj.qstate || []); })
        .then(function () {
          const at = (obj.attempts || []).map(function (a) {
            const c = Object.assign({}, a); delete c.id; return c;
          });
          return DB.putAll('attempts', at);
        })
        .then(function () {
          const ss = (obj.sessions || []).map(function (s) {
            const c = Object.assign({}, s); delete c.id; return c;
          });
          return DB.putAll('sessions', ss);
        })
        .then(function () {
          // pmState は sid が主キーなので、そのまま入れれば復元できる
          return hasPm ? DB.putAll('pmState', obj.pmState || []) : null;
        })
        .then(function () { return Store.reload(); })
        .then(function () { return window.PM ? PM.reload() : null; });
    },

    resetProgress: function () {
      return DB.clear(['qstate', 'attempts', 'sessions', 'pmState'])
        .then(function () { return DB.setMeta('activeSession', null); })
        .then(function () { return Store.reload(); })
        .then(function () { return window.PM ? PM.reload() : null; });
    },

    resetAll: function () {
      return DB.clear(['qstate', 'attempts', 'sessions', 'pmState',
                       'questions', 'exams', 'meta', 'figures',
                       'pmExams', 'pmSections'])
        .then(function () { return Store._syncBundled(); })
        .then(function () { return Store.reload(); })
        .then(function () { return window.PM ? PM.init() : null; });
    }
  };

  window.Store = Store;
})();
