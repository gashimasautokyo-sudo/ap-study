/* オフライン用 Service Worker
   アプリ本体はキャッシュ優先（機内モードでも起動する）。
   問題データを差し替えたら CACHE の版番号を上げるか、設定画面から JSON を読み込む。 */
const CACHE = 'ap-study-8c449c8fba83-734f8f0b';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/fields.js',
  './js/db.js',
  './js/store.js',
  './js/quiz.js',
  './js/pm.js',
  './js/chart.js',
  './js/app.js',
  './js/pmui.js',
  './data/version.json',
  './data/pm-version.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// data/questions.json と data/pm.json は数十MBあるので事前キャッシュしない。
// 初回だけ取得して IndexedDB に入れ、そのあとキャッシュから削除する（store.js / pm.js 側）。
// 版番号の2つは必ずネットワークを先に見る。ここをキャッシュ優先にすると
// データを差し替えても端末が古いままになる。
const NETWORK_FIRST = ['data/version.json', 'data/pm-version.json'];

self.addEventListener('install', function (ev) {
  ev.waitUntil(
    caches.open(CACHE).then(function (c) {
      // 1 つ落ちても install 全体を失敗させない
      return Promise.all(SHELL.map(function (u) {
        return c.add(new Request(u, { cache: 'reload' })).catch(function () { return null; });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (ev) {
  ev.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (ev) {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // 版番号はまずネットワークを見る（更新を見落とさないため）。落ちたらキャッシュ。
  if (NETWORK_FIRST.some(function (p) { return url.pathname.endsWith(p); })) {
    ev.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || new Response('{}', { headers: { 'Content-Type': 'application/json' } });
        });
      })
    );
    return;
  }

  ev.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) {
        // 裏で静かに更新（次回起動から反映）
        fetch(req).then(function (res) {
          if (res && res.ok) caches.open(CACHE).then(function (c) { c.put(req, res); });
        }).catch(function () { });
        return hit;
      }
      return fetch(req).then(function (res) {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        // 画面遷移だけはアプリ本体を返す。JSON や画像の失敗を HTML で 200 に化かすと
        // 呼び出し側が「取得できた」と誤認するので、そのまま失敗させる。
        if (req.mode === 'navigate') return caches.match('./index.html');
        throw new Error('offline: ' + url.pathname);
      });
    })
  );
});
