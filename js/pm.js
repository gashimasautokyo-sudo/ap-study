/* 午後モードのデータと採点ロジック。
   午前と違い記述式なので、自動採点できるのは記号選択だけ。
   記述は「自分の答えを書く → 解答例と並べて見る → 自分で ○△× を付ける」という自己採点にする。 */
(function () {
  'use strict';

  const PM = {
    exams: [],        // [{id,label,year,season,order,choose,required}]
    sections: [],     // [{id,examId,no,field,name,theme,body,questions}]
    byId: Object.create(null),
    state: Object.create(null),   // sectionId -> {answers:{qid:text}, marks:{qid:'o'|'t'|'x'}, ...}
    syncState: { checked: false, updated: false, error: null },

    MARKS: { o: '○ 正解', t: '△ 部分点', x: '× 不正解' },

    init: function () {
      return PM._sync().then(function () { return PM.reload(); });
    },

    _sync: function () {
      if (location.protocol === 'file:') return Promise.resolve();
      return fetch('data/pm-version.json', { cache: 'no-cache' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .catch(function () { return null; })
        .then(function (ver) {
          if (!ver || !ver.stamp) return null;
          PM.syncState.checked = true;
          return DB.getMeta('pmStamp').then(function (cur) {
            return DB.count('pmSections').then(function (n) {
              if (cur === ver.stamp && n > 0) return null;
              return fetch('data/pm.json')
                .then(function (r) {
                  if (!r.ok) throw new Error('pm.json を取得できません (' + r.status + ')');
                  return r.json();
                })
                .then(function (bank) { return PM.importBank(bank); })
                .then(function () {
                  PM.syncState.updated = true;
                  if (window.caches) {
                    caches.keys().then(function (ks) {
                      ks.forEach(function (k) {
                        caches.open(k).then(function (c) { c.delete('data/pm.json'); });
                      });
                    }).catch(function () { });
                  }
                });
            });
          });
        })
        .catch(function (e) { PM.syncState.error = e.message || String(e); });
    },

    importBank: function (obj) {
      if (!obj || !Array.isArray(obj.sections)) {
        return Promise.reject(new Error('午後データの形式が違います。'));
      }
      const exams = obj.exams || [];
      const figs = [];
      const secs = obj.sections.map(function (s) {
        const body = (s.body || []).map(function (b) {
          if (b.type === 'fig' && b.src) {
            const fid = s.id + ':' + figs.length;
            figs.push({ qid: fid, images: [b.src] });
            return { type: 'fig', figId: fid, caption: b.caption || '' };
          }
          return b;
        });
        return {
          id: String(s.id), examId: String(s.examId), no: Number(s.no) || 0,
          field: s.field || 'X', name: s.name || '', theme: s.theme || '',
          required: !!s.required,
          body: body,
          questions: (s.questions || []).map(function (q, i) {
            return {
              // key が解答・採点の保存キー。id は表示用で、同じ回に重複しうる
              key: String(q.key || ('q' + (i + 1))),
              id: String(q.id), label: q.label || '', sub: q.sub || null,
              blank: q.blank || null, prompt: String(q.prompt || ''),
              choices: q.choices || null, kind: q.kind || 'write',
              answer: String(q.answer || ''), note: q.note || '',
              limit: q.limit || null
            };
          }),
          intent: s.intent || '', commentary: s.commentary || ''
        };
      });

      return DB.putAll('pmExams', exams)
        .then(function () { return DB.putAll('pmSections', secs); })
        .then(function () { return DB.putAll('figures', figs); })
        .then(function () { return DB.setMeta('pmStamp', obj.stamp || String(Date.now())); })
        .then(function () { return { exams: exams.length, sections: secs.length }; });
    },

    reload: function () {
      return Promise.all([DB.getAll('pmExams'), DB.getAll('pmSections'), DB.getAll('pmState')])
        .then(function (r) {
          PM.exams = (r[0] || []).sort(function (a, b) { return (b.order || 0) - (a.order || 0); });
          PM.sections = (r[1] || []).sort(function (a, b) {
            if (a.examId !== b.examId) return a.examId < b.examId ? 1 : -1;
            return a.no - b.no;
          });
          PM.byId = Object.create(null);
          PM.sections.forEach(function (s) { PM.byId[s.id] = s; });
          PM.state = Object.create(null);
          (r[2] || []).forEach(function (st) { PM.state[st.sid] = st; });
          return PM;
        });
    },

    examLabel: function (examId) {
      for (let i = 0; i < PM.exams.length; i++) {
        if (PM.exams[i].id === examId) return PM.exams[i].label;
      }
      return examId;
    },

    blank: function (sid) {
      return { sid: sid, answers: {}, marks: {}, startedAt: null, endedAt: null,
               submitted: false, lastTs: null };
    },

    stateOf: function (sid) { return PM.state[sid] || PM.blank(sid); },

    save: function (st) {
      st.lastTs = Date.now();
      PM.state[st.sid] = st;
      return DB.put('pmState', st);
    },

    _norm: function (s) {
      return String(s || '').trim()
        .replace(/[Ａ-Ｚａ-ｚ０-９]/g, function (c) {
          return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
        })
        .replace(/[，、]/g, ',').replace(/[．。]/g, '.')
        .replace(/[（）]/g, function (c) { return c === '（' ? '(' : ')'; })
        .replace(/\s+/g, '')
        .toLowerCase();
    },

    /** 自動採点。誤りだと決めつけるのは記号選択だけに限る。
     *  記号選択  … 一致なら○、不一致なら×（選択肢が閉じているので確実）
     *  短答      … 完全一致なら○。不一致でも×にはせず自己採点に回す
     *              （表記ゆれや別解を機械が誤って×にしないため）
     *  記述      … 自動採点しない
     */
    autoMark: function (q, given) {
      const g = PM._norm(given);
      if (!g) return null;
      const a = PM._norm(q.answer);
      if (q.kind === 'choice') return g === a ? 'o' : 'x';
      if (q.kind === 'short') return g === a ? 'o' : null;
      return null;
    },

    /** 大問の成績。記述は自己採点の marks を使う */
    score: function (sid) {
      const s = PM.byId[sid];
      if (!s) return null;
      const st = PM.stateOf(sid);
      let o = 0, t = 0, x = 0, blank = 0;
      s.questions.forEach(function (q) {
        const m = st.marks[q.key];
        if (m === 'o') o++;
        else if (m === 't') t++;
        else if (m === 'x') x++;
        else blank++;
      });
      const n = s.questions.length;
      const marked = n - blank;
      const pts = o + t * 0.5;
      // 採点した設問だけで率を出す。未採点を0点扱いにすると、
      // 自己採点の途中で実態より低い値が出て判断を誤らせる
      return { total: n, o: o, t: t, x: x, blank: blank, marked: marked,
               rate: marked ? pts / marked : null,
               rateAll: n ? pts / n : 0 };
    },

    /** 復習対象: × か △ が付いた設問 */
    weakQuestions: function () {
      const out = [];
      PM.sections.forEach(function (s) {
        const st = PM.state[s.id];
        if (!st) return;
        s.questions.forEach(function (q) {
          const m = st.marks[q.key];
          if (m === 'x' || m === 't') {
            out.push({ section: s, q: q, mark: m, ts: st.lastTs || 0 });
          }
        });
      });
      return out.sort(function (a, b) { return b.ts - a.ts; });
    },

    overall: function () {
      let done = 0, o = 0, t = 0, x = 0;
      PM.sections.forEach(function (s) {
        const st = PM.state[s.id];
        if (!st || !st.submitted) return;
        done++;
        const sc = PM.score(s.id);
        o += sc.o; t += sc.t; x += sc.x;
      });
      const marked = o + t + x;
      return { sections: PM.sections.length, done: done, o: o, t: t, x: x,
               rate: marked ? (o + t * 0.5) / marked : null };
    },

    statsByField: function () {
      const acc = Object.create(null);
      PM.sections.forEach(function (s) {
        const a = acc[s.field] || (acc[s.field] =
          { code: s.field, name: s.name, total: 0, done: 0, o: 0, t: 0, x: 0 });
        a.total++;
        const st = PM.state[s.id];
        if (st && st.submitted) {
          a.done++;
          const sc = PM.score(s.id);
          a.o += sc.o; a.t += sc.t; a.x += sc.x;
        }
      });
      return Object.keys(acc).map(function (k) {
        const a = acc[k];
        const m = a.o + a.t + a.x;
        a.attempts = m;
        a.correct = a.o + a.t * 0.5;
        a.answered = a.done;
        a.rate = m ? (a.o + a.t * 0.5) / m : null;
        return a;
      }).sort(function (p, q) { return p.code < q.code ? -1 : 1; });
    }
  };

  window.PM = PM;
})();
