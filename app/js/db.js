/* IndexedDB ラッパ（端末内保存・オフライン完結） */
(function () {
  'use strict';

  const DB_NAME = 'ap-study';
  const DB_VER = 2;
  let _db = null;

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise(function (resolve, reject) {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = function (ev) {
        const db = req.result;

        if (!db.objectStoreNames.contains('questions')) {
          const s = db.createObjectStore('questions', { keyPath: 'id' });
          s.createIndex('examId', 'examId', { unique: false });
          s.createIndex('field', 'field', { unique: false });
        }
        if (!db.objectStoreNames.contains('exams')) {
          db.createObjectStore('exams', { keyPath: 'id' });
        }
        // 問題ごとの学習状態（誤答蓄積・メモ・分野の手動上書き）
        if (!db.objectStoreNames.contains('qstate')) {
          const s = db.createObjectStore('qstate', { keyPath: 'qid' });
          s.createIndex('lastTs', 'lastTs', { unique: false });
        }
        // 1 回答 = 1 レコード（全履歴）
        if (!db.objectStoreNames.contains('attempts')) {
          const s = db.createObjectStore('attempts', { keyPath: 'id', autoIncrement: true });
          s.createIndex('qid', 'qid', { unique: false });
          s.createIndex('ts', 'ts', { unique: false });
        }
        // 模試などのセッション結果
        if (!db.objectStoreNames.contains('sessions')) {
          const s = db.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
          s.createIndex('endedAt', 'endedAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
        // 図表画像は問題本体から切り離して置く（問題一覧をメモリに常駐させても軽いままにする）
        if (!db.objectStoreNames.contains('figures')) {
          db.createObjectStore('figures', { keyPath: 'qid' });
        }
        void ev;
      };
      req.onsuccess = function () { _db = req.result; resolve(_db); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function tx(stores, mode) {
    return open().then(function (db) { return db.transaction(stores, mode); });
  }

  function wrap(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  function done(t) {
    return new Promise(function (resolve, reject) {
      t.oncomplete = function () { resolve(); };
      t.onerror = function () { reject(t.error); };
      t.onabort = function () { reject(t.error); };
    });
  }

  const DB = {
    open: open,

    get: function (store, key) {
      return tx([store], 'readonly').then(function (t) {
        return wrap(t.objectStore(store).get(key));
      });
    },

    getAll: function (store) {
      return tx([store], 'readonly').then(function (t) {
        return wrap(t.objectStore(store).getAll());
      });
    },

    getAllByIndex: function (store, index, value) {
      return tx([store], 'readonly').then(function (t) {
        return wrap(t.objectStore(store).index(index).getAll(value));
      });
    },

    count: function (store) {
      return tx([store], 'readonly').then(function (t) {
        return wrap(t.objectStore(store).count());
      });
    },

    put: function (store, value) {
      return tx([store], 'readwrite').then(function (t) {
        const r = t.objectStore(store).put(value);
        return done(t).then(function () { return r.result; });
      });
    },

    /** 大量 upsert。1 トランザクションでまとめて書く */
    putAll: function (store, values) {
      if (!values || !values.length) return Promise.resolve(0);
      return tx([store], 'readwrite').then(function (t) {
        const os = t.objectStore(store);
        for (let i = 0; i < values.length; i++) os.put(values[i]);
        return done(t).then(function () { return values.length; });
      });
    },

    del: function (store, key) {
      return tx([store], 'readwrite').then(function (t) {
        t.objectStore(store).delete(key);
        return done(t);
      });
    },

    clear: function (stores) {
      const list = Array.isArray(stores) ? stores : [stores];
      return tx(list, 'readwrite').then(function (t) {
        list.forEach(function (s) { t.objectStore(s).clear(); });
        return done(t);
      });
    },

    getMeta: function (key, dflt) {
      return DB.get('meta', key).then(function (row) {
        return row ? row.value : dflt;
      });
    },

    setMeta: function (key, value) {
      return DB.put('meta', { key: key, value: value });
    }
  };

  window.DB = DB;
})();
