/* Compacts the quran.com downloads in src/ into the files the app ships. */
const fs = require('fs'), path = require('path');
const S = path.join(__dirname, 'src'), OUT = path.join(__dirname, '..', 'quran');
fs.mkdirSync(OUT, { recursive: true });
const chapters = JSON.parse(fs.readFileSync(path.join(S, 'chapters.json'))).chapters;
const juzs = JSON.parse(fs.readFileSync(path.join(S, 'juzs.json'))).juzs;
const pages = JSON.parse(fs.readFileSync(path.join(S, 'pages.json')));
const uthmani = JSON.parse(fs.readFileSync(path.join(S, 'uthmani.json'))).verses;

// ---- surahs: number, names, ayah count, first page, juz of first ayah
const juzOf = {};                       // "s:a" -> juz, for first ayah of each surah
const juzStarts = [];                   // juz -> "s:a"
const seen = new Set();
for (const j of juzs) {
  if (seen.has(j.juz_number)) continue; seen.add(j.juz_number);   // API lists each juz twice
  const firstSurah = Math.min(...Object.keys(j.verse_mapping).map(Number));
  juzStarts[j.juz_number] = firstSurah + ':' + j.verse_mapping[firstSurah].split('-')[0];
  for (const [s, range] of Object.entries(j.verse_mapping)) {
    const [a, b] = range.split('-').map(Number);
    for (let x = a; x <= b; x++) juzOf[s + ':' + x] = j.juz_number;
  }
}
const surahs = chapters.map((c) => ({
  n: c.id, name: c.name_simple, arabic: c.name_arabic, en: c.translated_name.name,
  ayahs: c.verses_count, page: c.pages[0], juz: juzOf[c.id + ':1'], makki: c.revelation_place === 'makkah',
}));

// ---- page -> first ayah, and ayah -> page (as page start keys)
const pageStarts = []; for (let p = 1; p <= 604; p++) pageStarts[p] = pages[p];

// ---- text: surah -> [ayah texts]; words split on spaces so word i aligns with segment index i
const text = {};
for (const v of uthmani) { const [s, a] = v.verse_key.split(':').map(Number); (text[s] ||= [])[a - 1] = v.text_uthmani; }

fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify({ surahs, juzStarts: juzStarts.slice(1), pageStarts: pageStarts.slice(1) }));
fs.writeFileSync(path.join(OUT, 'text.json'), JSON.stringify(text));

// ---- timings: compact ints. per surah: {url, d, v:[[from,to,[[w,s,e],...]],...]}
for (const [name, file] of [['husary', 'husary-timings.json']]) {        /* murattal only: the muallim edition was dropped */
  if (!fs.existsSync(path.join(S, file))) { console.log('skip', name); continue; }
  const t = JSON.parse(fs.readFileSync(path.join(S, file)));
  const out = {};
  for (const [s, c] of Object.entries(t)) out[s] = { url: c.url, d: c.duration, v: c.verses.map((v) => [v.from, v.to, v.seg.map((x) => [x[0], x[1], x[2]])]) };
  fs.writeFileSync(path.join(OUT, name + '-timings.json'), JSON.stringify(out));
}
for (const f of fs.readdirSync(OUT)) console.log(f.padEnd(28), (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0) + ' KB');
console.log('surah 114:', JSON.stringify(surahs[113]), '| juz 30 starts', juzStarts[30], '| page 582 starts', pageStarts[582]);
console.log('word count check 114:1 text words =', text[114][0].split(' ').length);

// ---- words: quran.com's own tokens, which the timing segments index.
// position p (1-based) -> words[p-1]; position words.length+1 is the ayah-end sign.
{
  const raw = JSON.parse(fs.readFileSync(path.join(S, 'words.json')));
  const words = {};
  let verses = 0, endSegs = 0, overflow = [];
  for (const [s, list] of Object.entries(raw)) {
    words[s] = list.map((v) => v.w.filter((w) => w[2] === 'word').map((w) => w[1]));
    const tim = JSON.parse(fs.readFileSync(path.join(S, 'husary-timings.json')))[s];
    list.forEach((v, i) => {
      verses++;
      const n = words[s][i].length;
      for (const seg of tim.verses[i].seg) {
        if (seg[0] === n + 1) endSegs++;
        else if (seg[0] > n + 1 || seg[0] < 1) overflow.push(v.k + ' pos ' + seg[0] + ' of ' + n);
      }
    });
  }
  fs.writeFileSync(path.join(OUT, 'words.json'), JSON.stringify(words));
  try { fs.unlinkSync(path.join(OUT, 'text.json')); } catch (e) {}
  console.log('words.json:', verses, 'verses; segments pointing at the ayah-end sign:', endSegs,
              '; segments out of range:', overflow.length, overflow.slice(0, 5).join(' | '));
  const marks = /[\u06D6-\u06DC\u06DE\u06E9]/;
  let withMark = 0; for (const s of Object.values(words)) for (const a of s) for (const w of a) if (marks.test(w)) withMark++;
  console.log('words carrying a pause/waqf mark:', withMark, ' e.g.', JSON.stringify(words[2][1]));
}
