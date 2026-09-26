/* Mushaf service worker: precaches the shell + Quran data, serves downloaded audio (with byte ranges) from Cache Storage. */
'use strict';
var VERSION = 'mushaf-b-v1';
var SHELL = 'mushaf-shell-' + VERSION;
var AUDIO = 'mushaf-audio-v1';                      /* must match AUDIO_CACHE in index.html */
var BASE = '../../';                                /* the integrator changes this to './' */
var AUDIO_HOSTS = ['download.quranicaudio.com', 'everyayah.com'];

function abs(p) { return new URL(p, self.location.href).href; }
var PRECACHE = [
  './', './index.html',
  BASE + 'quran/meta.json', BASE + 'quran/words.json', BASE + 'quran/husary-timings.json', BASE + 'quran/husary-muallim-timings.json',
  BASE + 'content/reciters.json', BASE + 'content/sharh.json', BASE + 'content/hadith.json', BASE + 'content/podcasts.json'
].map(abs);
var SHELL_SET = {}; PRECACHE.forEach(function (u) { SHELL_SET[u] = true; });

self.addEventListener('install', function (ev) {
  ev.waitUntil(caches.open(SHELL).then(function (c) {
    /* each file on its own so one 404 (e.g. an icon not yet supplied) cannot fail the whole install */
    return Promise.all(PRECACHE.map(function (u) { return fetch(u, { cache: 'no-cache' }).then(function (r) { if (r.ok) return c.put(u, r); }).catch(function () {}); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (ev) {
  ev.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) { if (k !== SHELL && k !== AUDIO) return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function isAudio(url) { return AUDIO_HOSTS.indexOf(url.hostname) >= 0 || /\.mp3(\?|$)/i.test(url.pathname); }

/* Answer a Range request from a complete cached response. Blob.slice is lazy, so a 95 MB surah costs nothing to slice. */
function rangeResponse(req, full) {
  var range = req.headers.get('range');
  return full.blob().then(function (blob) {
    var total = blob.size, m = /bytes=(\d*)-(\d*)/.exec(range || '');
    if (!m) return new Response(blob, { status: 200, headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(total), 'Accept-Ranges': 'bytes' } });
    var start = m[1] === '' ? Math.max(0, total - (+m[2])) : +m[1];
    var end = m[1] !== '' && m[2] !== '' ? Math.min(+m[2], total - 1) : total - 1;
    if (start > end || start >= total) return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + total } });
    var part = blob.slice(start, end + 1);
    return new Response(part, { status: 206, headers: {
      'Content-Type': 'audio/mpeg', 'Content-Length': String(end - start + 1), 'Content-Range': 'bytes ' + start + '-' + end + '/' + total, 'Accept-Ranges': 'bytes'
    } });
  });
}

function tell(type, url) {
  self.clients.matchAll({ includeUncontrolled: true }).then(function (cs) { cs.forEach(function (c) { c.postMessage({ type: type, url: url }); }); });
}

self.addEventListener('fetch', function (ev) {
  var req = ev.request, url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (req.method !== 'GET') return;

  if (isAudio(url)) {
    ev.respondWith(caches.open(AUDIO).then(function (c) { return c.match(url.href, { ignoreVary: true }); }).then(function (hit) {
      if (hit) { tell('audio-cache-hit', url.href); return rangeResponse(req, hit); }
      tell('audio-cache-miss', url.href);
      return fetch(req);
    }));
    return;
  }

  var key = url.origin + url.pathname;
  if (req.mode === 'navigate') {                    /* the shell: cache first, network to refresh */
    ev.respondWith(caches.match(abs('./index.html')).then(function (hit) {
      var net = fetch(req).then(function (r) { if (r.ok) caches.open(SHELL).then(function (c) { c.put(abs('./index.html'), r.clone()); }); return r; }).catch(function () { return hit; });
      return hit || net;
    }));
    return;
  }
  if (SHELL_SET[key] || SHELL_SET[url.href]) {      /* data files: cache first, refresh in the background */
    ev.respondWith(caches.open(SHELL).then(function (c) {
      return c.match(key).then(function (hit) {
        var net = fetch(req).then(function (r) { if (r.ok) c.put(key, r.clone()); return r; }).catch(function () { return hit; });
        if (hit) { ev.waitUntil(net.catch(function () {})); return hit; }
        return net;
      });
    }));
  }
});
