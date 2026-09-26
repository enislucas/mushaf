/*
 * Generates the app icons: a Kaaba - one black cube, one thin gold band - on
 * near-black. No text, no ornament. Run: node tools/make-icons.js
 *
 * Outputs icon-192.png, icon-512.png (RGBA, mark inside the middle 80% so the
 * 512 also works as a maskable icon) and apple-touch-icon.png (180x180, fully
 * opaque - iOS renders transparency as black and it looks broken).
 *
 * No dependencies: shapes are analytic, the PNG is encoded with zlib from the
 * standard library. The encoder is the one already proven in the prayer app.
 */
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, '..');

// ---------------------------------------------------------------- geometry
// Isometric cube. Everything is in a 0..1 reference square so any size works.
const CX = 0.5, CY = 0.535;         // cube centre, a touch below middle: the apex needs air
const W = 0.30;                      // half width of the cube
const S = W * Math.tan(Math.PI / 6); // rise of the slanted edges
const V = 0.31;                      // height of a vertical edge

const A = [CX, CY - V / 2 - S], B = [CX + W, CY - V / 2], C = [CX, CY - V / 2 + S], D = [CX - W, CY - V / 2];
const E = [CX + W, CY + V / 2], F = [CX, CY + V / 2 + S], G = [CX - W, CY + V / 2];

function inQuad(p, q) {              // convex quad, any winding
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4];
    const cr = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    if (cr === 0) continue;
    if (sign === 0) sign = Math.sign(cr); else if (Math.sign(cr) !== sign) return false;
  }
  return true;
}
const TOP = [A, B, C, D], LEFT = [D, C, F, G], RIGHT = [C, B, E, F];

// Position down a side face, 0 at its slanted top edge, 1 at its bottom edge.
function downFace(p, topL, topR) {
  const t = (p[0] - topL[0]) / (topR[0] - topL[0]);
  const yTop = topL[1] + (topR[1] - topL[1]) * t;
  return (p[1] - yTop) / V;
}
const BAND_AT = 0.26, BAND_H = 0.075;   // the kiswah band sits in the upper third

// ---------------------------------------------------------------- colours
const INK = [11, 15, 26], INK_EDGE = [5, 7, 12];
const TOPF = [40, 44, 54], LEFTF = [20, 22, 29], RIGHTF = [13, 15, 20];
const GOLD_L = [206, 168, 96], GOLD_R = [172, 138, 74];

function shade(x, y) {
  const p = [x, y];
  if (inQuad(p, TOP)) return TOPF;
  if (inQuad(p, LEFT)) return (downFace(p, D, C) >= BAND_AT && downFace(p, D, C) < BAND_AT + BAND_H) ? GOLD_L : LEFTF;
  if (inQuad(p, RIGHT)) return (downFace(p, C, B) >= BAND_AT && downFace(p, C, B) < BAND_AT + BAND_H) ? GOLD_R : RIGHTF;
  // background: soft vignette so the cube sits in a pool of very dim light
  const d = Math.hypot(x - 0.5, y - 0.5);
  const t = Math.min(1, d / 0.72);
  return [INK[0] + (INK_EDGE[0] - INK[0]) * t, INK[1] + (INK_EDGE[1] - INK[1]) * t, INK[2] + (INK_EDGE[2] - INK[2]) * t];
}

function render(size, ss) {
  const px = new Uint8Array(size * size * 3);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0;
    for (let j = 0; j < ss; j++) for (let i = 0; i < ss; i++) {
      const c = shade((x + (i + 0.5) / ss) / size, (y + (j + 0.5) / ss) / size);
      r += c[0]; g += c[1]; b += c[2];
    }
    const n = ss * ss, o = (y * size + x) * 3;
    px[o] = Math.round(r / n); px[o + 1] = Math.round(g / n); px[o + 2] = Math.round(b / n);
  }
  return px;
}

// ---------------------------------------------------------------- PNG
const CRC = (function () {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; }
  return t;
})();
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function filterRows(raw, width, height, bpp) {
  const stride = width * bpp, out = Buffer.alloc((stride + 1) * height);
  const cand = [0, 1, 2, 3, 4].map(() => Buffer.alloc(stride));
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const row = raw.subarray(y * stride, (y + 1) * stride), score = [0, 0, 0, 0, 0];
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? row[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0, p = a + b - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      cand[0][i] = row[i]; cand[1][i] = (row[i] - a) & 0xff; cand[2][i] = (row[i] - b) & 0xff;
      cand[3][i] = (row[i] - ((a + b) >> 1)) & 0xff; cand[4][i] = (row[i] - pred) & 0xff;
      for (let f = 0; f < 5; f++) { const v = cand[f][i]; score[f] += v < 128 ? v : 256 - v; }
    }
    let best = 0; for (let f = 1; f < 5; f++) if (score[f] < score[best]) best = f;
    out[y * (stride + 1)] = best; cand[best].copy(out, y * (stride + 1) + 1); prev = row;
  }
  return out;
}
function encodePng(rgb, size, withAlpha) {
  const bpp = withAlpha ? 4 : 3;
  let raw;
  if (withAlpha) {
    raw = Buffer.alloc(size * size * 4);
    for (let i = 0, j = 0; i < size * size; i++, j += 4) { raw[j] = rgb[i * 3]; raw[j + 1] = rgb[i * 3 + 1]; raw[j + 2] = rgb[i * 3 + 2]; raw[j + 3] = 255; }
  } else raw = Buffer.from(rgb.buffer, rgb.byteOffset, rgb.length);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = withAlpha ? 6 : 2;
  const idat = zlib.deflateSync(filterRows(raw, size, size, bpp), { level: 9 });
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// ---------------------------------------------------------------- write + check
for (const [file, size, alpha] of [['icon-192.png', 192, true], ['icon-512.png', 512, true], ['apple-touch-icon.png', 180, false]]) {
  const png = encodePng(render(size, 4), size, alpha);
  fs.writeFileSync(path.join(OUT, file), png);
  const w = png.readUInt32BE(16), h = png.readUInt32BE(20), ct = png[25];
  if (w !== size || h !== size) throw new Error(file + ': wrong size');
  if (file.startsWith('apple') && ct !== 2) throw new Error('apple-touch-icon must be opaque RGB');
  console.log(file.padEnd(22), size + 'x' + size, alpha ? 'RGBA' : 'RGB (opaque)', (png.length / 1024).toFixed(1) + ' KB');
}
// the mark must stay inside the middle 80% for maskable use
const extent = Math.max(Math.abs(A[1] - 0.5), Math.abs(F[1] - 0.5), W);
console.log('mark extent from centre:', (extent * 100).toFixed(0) + '% of half-size', extent <= 0.40 ? '(inside safe zone)' : '(!! outside safe zone)');
