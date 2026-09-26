/* Mushaf service worker: precached app shell + audio from Cache Storage (with byte-range answers). */
var SHELL = 'mushaf-shell-v1';
var AUDIO = 'mushaf-audio-v1';                 // must match AUDIO_CACHE in index.html
var BASE = '../../';                           // integrator: change to './'
var SHELL_FILES = [
  './', './index.html',
  BASE + 'quran/meta.json', BASE + 'quran/words.json', BASE + 'quran/husary-timings.json', BASE + 'quran/husary-muallim-timings.json',
  BASE + 'content/reciters.json', BASE + 'content/sharh.json', BASE + 'content/hadith.json', BASE + 'content/podcasts.json'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(SHELL).then(function (c) {
    // add one by one so a missing sample manifest never blocks the install
    return Promise.all(SHELL_FILES.map(function (u) { return c.add(new Request(u, { cache: 'reload' })).catch(function () {}); }));
  }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) { if (k !== SHELL && k !== AUDIO) return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function parseRange(h, size) {
  var m = /bytes=(\d*)-(\d*)/.exec(h || ''); if (!m) return null;
  var start = m[1] === '' ? Math.max(0, size - (+m[2])) : +m[1];
  var end = m[2] === '' || m[1] === '' ? size - 1 : Math.min(+m[2], size - 1);
  if (start > end || start >= size) return { bad: true };
  return { start: start, end: end };
}
// Serve a cached full response, honouring a Range header the way the media element expects (206 + Content-Range).
function rangedResponse(req, cached) {
  var rangeHeader = req.headers.get('range');
  return cached.blob().then(function (blob) {
    var size = blob.size, type = cached.headers.get('Content-Type') || 'audio/mpeg';
    if (!rangeHeader) return new Response(blob, { status: 200, headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' } });
    var r = parseRange(rangeHeader, size);
    if (!r || r.bad) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
    return new Response(blob.slice(r.start, r.end + 1, type), { status: 206, headers: {
      'Content-Type': type, 'Content-Length': String(r.end - r.start + 1), 'Content-Range': 'bytes ' + r.start + '-' + r.end + '/' + size, 'Accept-Ranges': 'bytes' } });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    // audio: cache first (explicit downloads only), otherwise straight to the network with the range intact
    e.respondWith(caches.open(AUDIO).then(function (c) { return c.match(req.url, { ignoreVary: true, ignoreSearch: false }); }).then(function (hit) {
      if (hit) return rangedResponse(req, hit);
      return fetch(req);
    }).catch(function () { return fetch(req); }));
    return;
  }
  // shell: cache first, refreshed in the background (stale-while-revalidate)
  e.respondWith(caches.open(SHELL).then(function (c) {
    return c.match(req, { ignoreSearch: true }).then(function (hit) {
      var net = fetch(req).then(function (res) { if (res && res.ok && res.type === 'basic') c.put(req, res.clone()); return res; }).catch(function () { return hit; });
      return hit || net;
    });
  }));
});
