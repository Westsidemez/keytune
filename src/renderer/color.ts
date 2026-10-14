// Colour helpers in QMK's units: hue, saturation and value are 0-255.

import type { HSV } from "../shared/protocol/commands";

export type RGB = [number, number, number];

export function hsvToRgb({ h, s, v }: HSV): RGB {
  const hh = ((h % 256) + 256) % 256 / 256 * 6;
  const ss = s / 255;
  const vv = v / 255;
  const i = Math.floor(hh);
  const f = hh - i;
  const p = vv * (1 - ss);
  const q = vv * (1 - ss * f);
  const t = vv * (1 - ss * (1 - f));
  const [r, g, b] = [
    [vv, t, p],
    [q, vv, p],
    [p, vv, t],
    [p, q, vv],
    [t, p, vv],
    [vv, p, q],
  ][i % 6];
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

export function rgbToHsv([r, g, b]: RGB): HSV {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === rr) h = ((gg - bb) / d) % 6;
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
  }
  h = Math.round(((h * 60 + 360) % 360) / 360 * 255);
  return { h, s: Math.round(max ? (d / max) * 255 : 0), v: Math.round(max * 255) };
}

export function hsvCss(hsv: HSV, alpha = 1): string {
  const [r, g, b] = hsvToRgb(hsv);
  return alpha === 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${alpha})`;
}

export function hexToHsv(hex: string): HSV | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return rgbToHsv([(n >> 16) & 255, (n >> 8) & 255, n & 255]);
}

export function hsvHex(hsv: HSV): string {
  return `#${hsvToRgb(hsv)
    .map((c) => c.toString(16).padStart(2, "0"))
    .join("")}`;
}

export const SWATCHES: HSV[] = [
  { h: 0, s: 255, v: 255 },
  { h: 16, s: 255, v: 255 },
  { h: 32, s: 255, v: 255 },
  { h: 43, s: 255, v: 255 },
  { h: 64, s: 255, v: 255 },
  { h: 85, s: 255, v: 255 },
  { h: 120, s: 255, v: 255 },
  { h: 145, s: 255, v: 255 },
  { h: 170, s: 255, v: 255 },
  { h: 191, s: 255, v: 255 },
  { h: 213, s: 255, v: 255 },
  { h: 234, s: 255, v: 255 },
  { h: 0, s: 0, v: 255 },
  { h: 28, s: 120, v: 255 },
  { h: 150, s: 90, v: 255 },
  { h: 0, s: 0, v: 0 },
];
