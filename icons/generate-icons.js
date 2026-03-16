// Generates PNG icons using only Node.js built-ins (no dependencies)
// Writes minimal valid PNG files with a colored background and arrows symbol
// Run: node icons/generate-icons.js

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZES = [16, 32, 48, 128];
const OUT_DIR = path.join(__dirname);

// ── Minimal PNG writer ────────────────────────────────────────────────────

function write32(buf, offset, val) {
  buf[offset]     = (val >>> 24) & 0xff;
  buf[offset + 1] = (val >>> 16) & 0xff;
  buf[offset + 2] = (val >>> 8)  & 0xff;
  buf[offset + 3] =  val         & 0xff;
}

function crc32(buf, start, len) {
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let c = 0xffffffff;
  for (let i = start; i < start + len; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = data.length;
  const buf = Buffer.alloc(len + 12);
  write32(buf, 0, len);
  buf.write(type, 4, 'ascii');
  data.copy(buf, 8);
  const c = crc32(buf, 4, len + 4);
  write32(buf, len + 8, c);
  return buf;
}

function buildPNG(pixels, size) {
  // pixels: Uint8Array of RGBA data, row-major
  const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  write32(ihdr, 0, size);
  write32(ihdr, 4, size);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: RGB (no alpha for simplicity, we'll use RGBA=6)
  ihdr[9] = 6;  // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  // Raw image data with filter bytes
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter type: None
    for (let x = 0; x < size; x++) {
      const si = (y * size + x) * 4;
      const di = y * (size * 4 + 1) + 1 + x * 4;
      raw[di]     = pixels[si];
      raw[di + 1] = pixels[si + 1];
      raw[di + 2] = pixels[si + 2];
      raw[di + 3] = pixels[si + 3];
    }
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });
  const idat = Buffer.from(compressed);
  const iend = Buffer.alloc(0);

  return Buffer.concat([
    header,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', iend),
  ]);
}

// ── Draw icon ─────────────────────────────────────────────────────────────

function drawIcon(size) {
  const pixels = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;

      // Rounded rect check
      const r = size * 0.15;
      const dx = Math.max(0, Math.max(r - x, x - (size - 1 - r)));
      const dy = Math.max(0, Math.max(r - y, y - (size - 1 - r)));
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > r) {
        // Outside rounded rect — transparent
        pixels[idx]     = 0;
        pixels[idx + 1] = 0;
        pixels[idx + 2] = 0;
        pixels[idx + 3] = 0;
        continue;
      }

      // Gradient: top-left #FFD600, bottom-right #FFA000
      const t = (x + y) / (size * 2);
      const R = Math.round(0xFF * (1 - t) + 0xFF * t);       // 255
      const G = Math.round(0xD6 * (1 - t) + 0xA0 * t);       // 214 → 160
      const B = 0;

      pixels[idx]     = R;
      pixels[idx + 1] = G;
      pixels[idx + 2] = B;
      pixels[idx + 3] = 255;

      // Draw arrows "⇄" as a simple pixel pattern scaled to icon size
      // Left arrow: thin bar + arrowhead on left side
      // Right arrow: thin bar + arrowhead on right side
      const cx = size / 2;
      const cy = size / 2;
      const thick = Math.max(1, Math.round(size * 0.08));
      const arrowW = size * 0.32;
      const arrowH = size * 0.18;
      const gap = size * 0.10;

      // Upper arrow (pointing right) from left-center to right
      const uy = cy - gap - thick / 2;
      const ly = cy + gap + thick / 2;

      let isArrow = false;

      // Upper arrow shaft and head (points right)
      if (Math.abs(y - uy) <= thick / 2 && x >= cx - arrowW && x <= cx + arrowW - arrowH) isArrow = true;
      // Upper arrowhead
      const uHeadX = cx + arrowW;
      const uHeadDist = Math.abs(x - uHeadX) + Math.abs(y - uy);
      if (x > cx + arrowW - arrowH && x <= uHeadX && Math.abs(y - uy) <= arrowH * (1 - (x - (uHeadX - arrowH)) / arrowH)) isArrow = true;

      // Lower arrow shaft and head (points left)
      if (Math.abs(y - ly) <= thick / 2 && x >= cx - arrowW + arrowH && x <= cx + arrowW) isArrow = true;
      // Lower arrowhead (points left)
      const lHeadX = cx - arrowW;
      if (x < cx - arrowW + arrowH && x >= lHeadX && Math.abs(y - ly) <= arrowH * (1 - (x - lHeadX) / arrowH)) isArrow = true;

      if (isArrow) {
        pixels[idx]     = 80;
        pixels[idx + 1] = 50;
        pixels[idx + 2] = 0;
        pixels[idx + 3] = 200;
      }
    }
  }

  return pixels;
}

// ── Generate ──────────────────────────────────────────────────────────────

for (const size of SIZES) {
  const pixels = drawIcon(size);
  const png = buildPNG(pixels, size);
  const outPath = path.join(OUT_DIR, `icon${size}.png`);
  fs.writeFileSync(outPath, png);
  console.log(`✓ icon${size}.png (${png.length} bytes)`);
}

console.log('\nAll icons generated in', OUT_DIR);
