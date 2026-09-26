/* Mushaf — service worker.
   Shell + Quran data are precached. Audio files the user chose to download live in
   AUDIO and are served back as proper 206 partial responses, because iOS Safari
   refuses to play a media resource that answers a Range request with a 200. */
'use strict';

var BASE = '../../';                       // integrator: './'
var SHELL = 'mushaf-shell-v1';
var AUDIO = 'mushaf-audio-v1';
var PRECACHE = [
  './', './index.html',
  BASE + 'quran/meta.json',
  BASE + 'quran/words.json',
  BASE + 'quran/husary-timings.json',
  BASE + 'quran/husary-muallim-timings.json',
  BASE + 'content/reciters.json',
  BASE + 'content/sharh.json',
  BASE + 'content/hadith.json',
  BASE + 'content/podcasts.json'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(SHELL).then(function (c) {
    // add one by one so a single missing sample file cannot fail the install
    return Promise.all(PRECACHE.map(function (u) {
      return c.add(new Request(u, { cache: 'reload' })).catch(function () {});
    }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) {
      if (k !== SHELL && k !== AUDIO) return caches.delete(k);
    }));
  }).then(function () { return self.clients.claim(); }));
});

function parseRange(h, size) {
  var m = /bytes=(\d*)-(\d*)/.exec(h || '');
  if (!m) return null;
  var start, end;
  if (m[1] === '' && m[2] === '') return null;
  if (m[1] === '') { start = Math.max(0, size - parseInt(m[2], 10)); end = size - 1; }
  else { start = parseInt(m[1], 10); end = m[2] === '' ? size - 1 : Math.min(size - 1, parseInt(m[2], 10)); }
  if (isNaN(start) || isNaN(end) || start > end || start >= size) return { bad: true };
  return { start: start, end: end };
}

function partial(req, full) {
  return full.blob().then(function (blob) {
    var size = blob.size;
    var type = full.headers.get('Content-Type') || 'audio/mpeg';
    var r = parseRange(req.headers.get('Range'), size);
    if (r && r.bad) {
      return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
    }
    if (!r) {
      return new Response(blob, { status: 200, headers: {
        'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes', 'X-Mushaf': 'cache' } });
    }
    var slice = blob.slice(r.start, r.end + 1, type);
    return new Response(slice, { status: 206, statusText: 'Partial Content', headers: {
      'Content-Type': type,
      'Content-Length': String(slice.size),
      'Content-Range': 'bytes ' + r.start + '-' + r.end + '/' + size,
      'Accept-Ranges': 'bytes',
      'X-Mushaf': 'cache' } });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  if (url.origin === self.location.origin) {
    // App shell and data: cache first, then network (and remember JSON we had to fetch).
    e.respondWith(caches.open(SHELL).then(function (c) {
      return c.match(req, { ignoreSearch: true }).then(function (hit) {
        if (hit) return hit;
        return fetch(req).then(function (res) {
          if (res.ok && (url.pathname.slice(-5) === '.json' || url.pathname.slice(-5) === '.html')) c.put(req, res.clone());
          return res;
        }).catch(function () {
          if (req.mode === 'navigate') return c.match('./index.html');
          throw new Error('offline');
        });
      });
    }));
    return;
  }

  // Cross-origin media: downloaded copies win, served as 206 slices; otherwise straight through.
  e.respondWith(caches.open(AUDIO).then(function (c) {
    return c.match(url.href).then(function (hit) {
      if (hit) return partial(req, hit);
      return fetch(req);
    });
  }));
});
