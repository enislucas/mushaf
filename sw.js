/* Mushaf service worker: precached app shell + downloaded audio from Cache Storage,
   answered with proper 206 byte ranges (iOS Safari refuses a 200 to a Range request). */
'use strict';
var SHELL = 'mushaf-shell-v4';
var AUDIO = 'mushaf-audio-v1';                 /* must match AUDIO_CACHE in index.html */
var SHELL_FILES = [
  './', './index.html', './manifest.webmanifest',
  './quran/meta.json', './quran/words.json', './quran/husary-timings.json',
  './content/reciters.json', './content/sharh.json', './content/hadith.json', './content/podcasts.json',
  './icon-192.png', './icon-512.png', './apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(SHELL).then(function (c) {
    /* one by one, so a single missing file can never fail the whole install */
    return Promise.all(SHELL_FILES.map(function (u) { return c.add(new Request(u, { cache: 'reload' })).catch(function () {}); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) { if (k !== SHELL && k !== AUDIO) return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function parseRange(h, size) {
  var m = /bytes=(\d*)-(\d*)/.exec(h || '');
  if (!m) return null;
  if (m[1] === '' && m[2] === '') return { bad: true };
  var start, end;
  if (m[1] === '') { start = Math.max(0, size - parseInt(m[2], 10)); end = size - 1; }
  else { start = parseInt(m[1], 10); end = m[2] === '' ? size - 1 : Math.min(size - 1, parseInt(m[2], 10)); }
  if (isNaN(start) || isNaN(end) || start > end || start >= size) return { bad: true };
  return { start: start, end: end };
}
/* Serve a cached full response, honouring a Range header the way a media element expects.
   Blob.slice is lazy, so slicing a large surah costs nothing. */
function rangedResponse(req, cached) {
  return cached.blob().then(function (blob) {
    var size = blob.size, type = cached.headers.get('Content-Type') || 'audio/mpeg';
    var r = parseRange(req.headers.get('range'), size);
    if (!r) return new Response(blob, { status: 200, headers: {
      'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' } });
    if (r.bad) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
    var part = blob.slice(r.start, r.end + 1, type);
    return new Response(part, { status: 206, statusText: 'Partial Content', headers: {
      'Content-Type': type,
      'Content-Length': String(r.end - r.start + 1),
      'Content-Range': 'bytes ' + r.start + '-' + r.end + '/' + size,
      'Accept-Ranges': 'bytes' } });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request, url;
  if (req.method !== 'GET') return;
  try { url = new URL(req.url); } catch (err) { return; }

  if (url.origin !== self.location.origin) {
    /* audio: whatever was explicitly downloaded wins, otherwise straight to the network with the Range intact */
    e.respondWith(caches.open(AUDIO).then(function (c) { return c.match(url.href, { ignoreVary: true }); }).then(function (hit) {
      return hit ? rangedResponse(req, hit) : fetch(req);
    }).catch(function () { return fetch(req); }));
    return;
  }

  /* the shell: cache first, refreshed in the background */
  e.respondWith(caches.open(SHELL).then(function (c) {
    return c.match(req, { ignoreSearch: true }).then(function (hit) {
      var net = fetch(req).then(function (res) {
        if (res && res.ok && res.type === 'basic') c.put(req, res.clone());
        return res;
      }).catch(function () {
        if (hit) return hit;
        if (req.mode === 'navigate') return c.match('./index.html');
        throw new Error('offline');
      });
      if (hit) { e.waitUntil(net.catch(function () {})); return hit; }
      return net;
    });
  }));
});
