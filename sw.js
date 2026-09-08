// Service worker. The store is where this app is used and signal is bad there,
// so working offline is a requirement, not a nicety.
//
// Three routes, deliberately different:
//
//   Shell files: cache first, then refreshed in the background. The app has to
//   open with no network at all, so the cached copy is served immediately and
//   the next open gets whatever the network returned this time.
//
//   Everything else on this origin: network first, with the cache as the
//   fallback. The previous version cached every same origin GET and then served
//   it forever, so an edited file stayed invisible until the version string
//   below changed. That is a good way to spend an hour debugging a file the
//   browser is not actually running.
//
//   Open Food Facts: network first with a cache fallback. off.js separately
//   keeps its own copy in IndexedDB with a timestamp, so the UI can always say
//   how old a price or a record is.

const VERSION = 'pricebook-v3';
const SHELL_CACHE = VERSION + '-shell';
const DATA_CACHE = VERSION + '-data';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './src/styles.css',
  './src/app.js',
  './src/store.js',
  './src/off.js',
  './src/metrics.js',
  './src/ean.js',
  './src/barcode.js'
];

// Resolved once against this worker scope so a request can be classified by
// path instead of by guessing at the URL string.
const SHELL_PATHS = SHELL.map(function (rel) {
  return new URL(rel, self.location.href).pathname;
});

function isShell(url) {
  return SHELL_PATHS.indexOf(url.pathname) >= 0;
}

function isOpenFoodFacts(url) {
  return url.hostname.indexOf('openfoodfacts.org') >= 0;
}

function storable(res) {
  return !!(res && res.status === 200 && res.type === 'basic');
}

function put(cacheName, req, res) {
  const copy = res.clone();
  caches.open(cacheName).then(function (c) { c.put(req, copy); });
}

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function (cache) {
      // Added one by one so a single 404 cannot fail the whole install.
      return Promise.all(
        SHELL.map(function (url) {
          return cache.add(new Request(url, { cache: 'reload' })).catch(function () {});
        })
      );
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k.indexOf(VERSION) !== 0; })
            .map(function (k) { return caches.delete(k); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

// Shell. Answer from the cache at once, and refresh in the background so the
// next open is current. Being one load behind is a fair price for opening in a
// shop with no signal.
function shellRoute(req) {
  return caches.match(req).then(function (hit) {
    if (hit) {
      fetch(req).then(function (res) {
        if (storable(res)) put(SHELL_CACHE, req, res);
      }).catch(function () {});
      return hit;
    }
    return fetch(req).then(function (res) {
      if (storable(res)) put(SHELL_CACHE, req, res);
      return res;
    });
  });
}

// Everything else on this origin. Fresh when there is a network, cached when
// there is not.
function sameOriginRoute(req) {
  return fetch(req).then(function (res) {
    if (storable(res)) put(SHELL_CACHE, req, res);
    return res;
  }).catch(function () {
    return caches.match(req).then(function (hit) {
      if (hit) return hit;
      if (req.mode === 'navigate') {
        return caches.match('./index.html').then(function (shell) {
          return shell || new Response('Offline, and this page was never cached.', {
            status: 504, headers: { 'Content-Type': 'text/plain' }
          });
        });
      }
      return new Response('', { status: 504 });
    });
  });
}

function offRoute(req) {
  return fetch(req).then(function (res) {
    if (res && res.status === 200) put(DATA_CACHE, req, res);
    return res;
  }).catch(function () {
    return caches.match(req).then(function (hit) {
      return hit || new Response(JSON.stringify({ status: 0, offline: true }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      });
    });
  });
}

self.addEventListener('fetch', function (event) {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  if (isOpenFoodFacts(url)) { event.respondWith(offRoute(req)); return; }
  if (url.origin !== self.location.origin) return;
  if (isShell(url)) { event.respondWith(shellRoute(req)); return; }
  event.respondWith(sameOriginRoute(req));
});
