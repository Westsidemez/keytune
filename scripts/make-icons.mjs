// Draws the app icon and the menu bar icon as PNGs (no image tools needed),
// then builds build/icon.icns with macOS iconutil when available.
//   node scripts/make-icons.mjs

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf) => {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x + 0.5, y + 0.5, size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

/** Signed distance to a rounded rectangle centred at (cx, cy). */
const roundRect = (x, y, cx, cy, w, h, r) => {
  const qx = Math.abs(x - cx) - w / 2 + r;
  const qy = Math.abs(y - cy) - h / 2 + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const cover = (d, aa) => Math.min(1, Math.max(0, 0.5 - d / aa));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const over = (dst, src, alpha) => {
  const a = Math.min(1, Math.max(0, alpha));
  return [...mix(dst.slice(0, 3), src, a), Math.max(dst[3], a * 255)];
};

// App icon: a dark squircle holding three keycaps, the middle one glowing orange.
function appIcon(x, y, s) {
  const u = s / 1024;
  const aa = 1.2 * u * (1024 / s);
  let px = [0, 0, 0, 0];
  const body = roundRect(x, y, s / 2, s / 2, 824 * u, 824 * u, 185 * u);
  if (body < aa) {
    const t = y / s;
    px = over(px, mix([40, 42, 50], [16, 17, 21], t), cover(body, aa));
    const rim = Math.abs(body + 3 * u) - 2 * u;
    px = over(px, [90, 94, 104], cover(rim, aa) * 0.6 * Math.max(0, 1 - y / (s * 0.75)));
  }
  const caps = [
    { cx: 512 - 250, cy: 512, glow: false },
    { cx: 512, cy: 512, glow: true },
    { cx: 512 + 250, cy: 512, glow: false },
  ];
  for (const c of caps) {
    const cx = c.cx * u;
    const cy = c.cy * u;
    const shadow = roundRect(x, y, cx, cy + 22 * u, 210 * u, 210 * u, 46 * u);
    if (shadow < 30 * u) px = over(px, [0, 0, 0], Math.min(1, 1 - shadow / (30 * u)) * 0.5);
    const base = roundRect(x, y, cx, cy + 10 * u, 210 * u, 210 * u, 46 * u);
    if (base < aa) px = over(px, c.glow ? [196, 72, 30] : [22, 23, 28], cover(base, aa));
    const top = roundRect(x, y, cx, cy - 8 * u, 186 * u, 180 * u, 40 * u);
    if (top < aa) {
      const t = (y - (cy - 98 * u)) / (180 * u);
      const colour = c.glow ? mix([255, 168, 110], [255, 106, 52], t) : mix([70, 73, 82], [48, 50, 57], t);
      px = over(px, colour, cover(top, aa));
    }
    if (c.glow) {
      const d = Math.hypot(x - cx, y - (cy + 140 * u)) / (260 * u);
      if (d < 1 && body < 0) px = over(px, [255, 122, 61], (1 - d) ** 2 * 0.45);
    }
  }
  return px.map((v) => Math.round(v));
}

// Menu bar icon: a monochrome keycap outline with a dot (template image).
function trayIcon(x, y, s) {
  const u = s / 18;
  const aa = 1.1 * (18 / s) * u;
  const outer = roundRect(x, y, 9 * u, 9 * u, 15 * u, 12 * u, 3 * u);
  const ring = Math.abs(outer) - 0.85 * u;
  let a = cover(ring, aa);
  for (const [kx, ky] of [
    [5.5, 7.5],
    [9, 7.5],
    [12.5, 7.5],
  ])
    a = Math.max(a, cover(roundRect(x, y, kx * u, ky * u, 2.2 * u, 2.2 * u, 0.6 * u), aa));
  a = Math.max(a, cover(roundRect(x, y, 9 * u, 11.2 * u, 7 * u, 1.8 * u, 0.6 * u), aa));
  return [0, 0, 0, Math.round(a * 255)];
}

const pub = path.join(root, "src/renderer/public");
fs.mkdirSync(pub, { recursive: true });
fs.writeFileSync(path.join(pub, "trayTemplate.png"), png(18, trayIcon));
fs.writeFileSync(path.join(pub, "trayTemplate@2x.png"), png(36, trayIcon));

const buildDir = path.join(root, "build");
fs.mkdirSync(buildDir, { recursive: true });
fs.writeFileSync(path.join(buildDir, "icon.png"), png(1024, appIcon));

if (process.platform === "darwin") {
  const set = path.join(buildDir, "icon.iconset");
  fs.rmSync(set, { recursive: true, force: true });
  fs.mkdirSync(set);
  for (const size of [16, 32, 128, 256, 512]) {
    fs.writeFileSync(path.join(set, `icon_${size}x${size}.png`), png(size, appIcon));
    fs.writeFileSync(path.join(set, `icon_${size}x${size}@2x.png`), png(size * 2, appIcon));
  }
  execFileSync("iconutil", ["-c", "icns", set, "-o", path.join(buildDir, "icon.icns")]);
  fs.rmSync(set, { recursive: true, force: true });
}
console.log("Icons written");
