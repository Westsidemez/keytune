// Approximate, on-screen versions of the keyboard's lighting effects, so the
// app's keyboard shows what the real one is doing. Effects are matched by the
// names in the keyboard definition (QMK RGB matrix effects).

import type { KeyboardLayout, LayoutKey } from "../shared/layout";
import type { LightingState } from "../shared/keyboard";
import type { KeyboardModel } from "../shared/definitions";
import type { HSV } from "../shared/protocol/commands";
import { hsvToRgb, type RGB } from "./color";

export interface PreviewInput {
  layout: KeyboardLayout;
  model: KeyboardModel;
  lighting: LightingState;
  ledMap: (number | null)[];
  cols: number;
}

interface KeyGeometry {
  key: LayoutKey;
  led: number | null;
  cx: number;
  cy: number;
  /** Normalised 0-1 position. */
  nx: number;
  ny: number;
  angle: number;
  dist: number;
  seed: number;
}

function geometry(input: PreviewInput): KeyGeometry[] {
  const { layout, ledMap, cols } = input;
  const midX = layout.width / 2;
  const midY = layout.height / 2;
  return layout.keys.map((key, i) => {
    const cx = key.x + key.w / 2;
    const cy = key.y + key.h / 2;
    const led = key.row >= 0 ? ledMap[key.row * cols + key.col] ?? null : null;
    return {
      key,
      led,
      cx,
      cy,
      nx: cx / layout.width,
      ny: cy / layout.height,
      angle: Math.atan2(cy - midY, (cx - midX) / 2.2),
      dist: Math.hypot((cx - midX) / layout.width, (cy - midY) / layout.height),
      seed: hash(i * 7919 + key.row * 131 + key.col),
    };
  });
}

function hash(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** A simulated key press, so typing-reactive effects have something to react to. */
export interface Press {
  t: number;
  cx: number;
  cy: number;
  row: number;
  col: number;
  key: string;
}

interface PaintContext {
  presses: Press[];
}

type Painter = (g: KeyGeometry, t: number, base: HSV, ctx: PaintContext) => HSV | null;

const deg = (radians: number) => ((radians / (2 * Math.PI)) * 256 + 512) % 256;

/** Brightness 0-1 of a key from presses that spread out as rings. */
function ring(g: KeyGeometry, t: number, presses: Press[], width = 1.1, speed = 7): { v: number; d: number } {
  let best = { v: 0, d: 0 };
  for (const p of presses) {
    const age = t - p.t;
    if (age < 0 || age > 1.6) continue;
    const d = Math.hypot(g.cx - p.cx, (g.cy - p.cy) * 1.2);
    const v = Math.max(0, 1 - Math.abs(d - age * speed) / width) * (1 - age / 1.6);
    if (v > best.v) best = { v, d };
  }
  return best;
}

const PAINTERS: [RegExp, Painter][] = [
  [/^solid color$/i, (_g, _t, b) => b],
  [/^breathing$/i, (_g, t, b) => ({ ...b, v: b.v * (0.15 + 0.85 * (0.5 + 0.5 * Math.sin(t * 2.2))) })],
  [/band spiral val/i, (g, t, b) => ({ ...b, v: b.v * Math.max(0.05, Math.cos(g.angle + t * 2)) ** 2 })],
  [/band.*val/i, (g, t, b) => ({ ...b, v: b.v * (0.5 + 0.5 * Math.cos(g.nx * 6 - t * 2)) })],
  [/band.*sat/i, (g, t, b) => ({ ...b, s: b.s * (0.5 + 0.5 * Math.cos(g.nx * 6 - t * 2)) })],
  [/^cycle all$/i, (_g, t, b) => ({ ...b, h: (t * 40) % 256 })],
  [/cycle left right/i, (g, t, b) => ({ ...b, h: (g.nx * 256 - t * 60 + 1024) % 256 })],
  [/cycle up down/i, (g, t, b) => ({ ...b, h: (g.ny * 256 - t * 60 + 1024) % 256 })],
  [/chevron/i, (g, t, b) => ({ ...b, h: (Math.abs(g.ny - 0.5) * 256 + g.nx * 256 - t * 60 + 1024) % 256 })],
  [/cycle out in dual/i, (g, t, b) => ({ ...b, h: (Math.hypot((g.nx < 0.5 ? g.nx - 0.25 : g.nx - 0.75) * 2, g.ny - 0.5) * 300 - t * 60 + 1024) % 256 })],
  [/cycle out in/i, (g, t, b) => ({ ...b, h: (g.dist * 400 - t * 60 + 1024) % 256 })],
  [/pinwheel/i, (g, t, b) => ({ ...b, h: (deg(g.angle) + t * 50) % 256 })],
  [/cycle spiral/i, (g, t, b) => ({ ...b, h: (deg(g.angle) + g.dist * 300 - t * 60 + 1024) % 256 })],
  [/dual beacon/i, (g, t, b) => ({ ...b, h: (b.h + 256 + 48 * Math.sin(g.angle + t * 1.5)) % 256 })],
  [/beacon/i, (g, t, b) => ({ ...b, h: (deg(g.angle) + t * 60) % 256 })],
  [/jellybean|raindrop/i, (g, t, b) => {
    const tick = Math.floor(t * 1.2 + g.seed * 8);
    return { h: hash(tick * 31 + g.seed * 1000) * 256, s: b.s, v: b.v };
  }],
  [/pixel rain/i, (g, t, b) => {
    const tick = Math.floor(t * 1.6 + g.seed * 13);
    const lit = hash(tick * 7 + g.seed * 500) > 0.55;
    return { h: hash(tick * 31 + g.seed * 1000) * 256, s: b.s, v: lit ? b.v : 0 };
  }],
  [/heatmap/i, (g, t, _b, ctx) => {
    let heat = 0;
    for (const p of ctx.presses) {
      const age = t - p.t;
      if (age < 0) continue;
      heat += Math.exp(-Math.hypot(g.cx - p.cx, g.cy - p.cy) * 1.4) * Math.max(0, 1 - age / 4);
    }
    heat = Math.min(1, heat * 1.6);
    return heat < 0.04 ? { h: 0, s: 0, v: 0 } : { h: 85 - heat * 85, s: 255, v: 80 + heat * 175 };
  }],
  [/digital rain/i, (g, t, b) => {
    const column = Math.floor(g.cx);
    const head = ((t * 2.2 + hash(column) * 9) % 8) - 1;
    const d = head - g.cy;
    const v = d >= 0 && d < 3 ? 1 - d / 3 : 0;
    return { h: 85, s: d < 0.5 ? 60 : 255, v: b.v * v };
  }],
  [/nexus|cross/i, (g, t, b, ctx) => {
    let v = 0;
    for (const p of ctx.presses) {
      const age = t - p.t;
      if (age < 0 || age > 1.2) continue;
      const fade = 1 - age / 1.2;
      if (Math.abs(g.cy - p.cy) < 0.5) v = Math.max(v, Math.max(0, 1 - Math.abs(Math.abs(g.cx - p.cx) - age * 12) / 1.5) * fade);
      if (Math.abs(g.cx - p.cx) < 0.6) v = Math.max(v, Math.max(0, 1 - Math.abs(Math.abs(g.cy - p.cy) - age * 8) / 1.2) * fade);
      if (g.key.id === p.key) v = Math.max(v, fade);
    }
    return { ...b, v: b.v * v };
  }],
  [/multiwide|wide/i, (g, t, b, ctx) => {
    let v = 0;
    for (const p of ctx.presses) {
      const age = t - p.t;
      if (age < 0 || age > 1) continue;
      v = Math.max(v, Math.max(0, 1 - Math.hypot(g.cx - p.cx, (g.cy - p.cy) * 1.2) / (1 + age * 5)) * (1 - age));
    }
    return { ...b, v: b.v * v };
  }],
  [/^solid splash$/i, (g, t, b, ctx) => ({ ...b, v: b.v * ring(g, t, ctx.presses).v })],
  [/splash/i, (g, t, b, ctx) => {
    const r = ring(g, t, ctx.presses);
    return { h: (b.h + r.d * 30) % 256, s: 255, v: b.v * r.v };
  }],
  [/reactive/i, (g, t, b, ctx) => {
    let v = 0;
    for (const p of ctx.presses) if (p.key === g.key.id && t >= p.t) v = Math.max(v, Math.max(0, 1 - (t - p.t) / 1.2));
    return { ...b, v: b.v * v };
  }],
];

const fallback: Painter = (g, t, b) => ({ ...b, h: (g.nx * 256 + t * 40) % 256 });

export function painterFor(effectName: string | undefined): Painter {
  if (!effectName) return fallback;
  return PAINTERS.find(([re]) => re.test(effectName))?.[1] ?? fallback;
}

/** Creates a function returning each key's preview colour (null = unlit) at time t (seconds). */
export function createPreview(input: PreviewInput): (t: number) => Map<string, RGB | null> {
  const keys = geometry(input);
  const { lighting, model } = input;
  const effectName = (id: number) => model.effects.find((e) => e.id === id)?.name;
  const scale = Math.max(0.35, lighting.brightness / 255);
  const speed = (s: number) => 0.25 + (s / 255) * 1.75;
  const out = new Map<string, RGB | null>();
  const lit = keys.filter((k) => k.led !== null && k.key.row >= 0);
  const ctx: PaintContext = { presses: [] };
  const PRESS_EVERY = 0.38;

  /** Presses in the last few seconds of (effect-speed-scaled) time. */
  const fillPresses = (time: number) => {
    ctx.presses.length = 0;
    if (!lit.length) return;
    for (let k = Math.floor((time - 4) / PRESS_EVERY); k <= Math.floor(time / PRESS_EVERY); k++) {
      const g = lit[Math.floor(hash(k * 13 + 7) * lit.length)];
      ctx.presses.push({ t: k * PRESS_EVERY, cx: g.cx, cy: g.cy, row: g.key.row, col: g.key.col, key: g.key.id });
    }
  };
  const mixed = lighting.effect === model.mixedMode && lighting.mixed;

  return (t: number) => {
    out.clear();
    fillPresses(mixed ? t : t * speed(lighting.speed));
    for (const g of keys) {
      if (g.led === null) {
        out.set(g.key.id, null);
        continue;
      }
      let hsv: HSV | null = null;
      if (lighting.effect === 0) {
        hsv = null;
      } else if (lighting.effect === model.perKeyMode && lighting.perKey) {
        const c = lighting.perKey.colors[g.led] ?? { h: 0, s: 0, v: 0 };
        const type = lighting.perKey.type;
        const pulse = type === 1 ? 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(t * 2.2)) : type >= 2 ? 0.45 : 1;
        hsv = { ...c, v: c.v * pulse };
      } else if (lighting.effect === model.mixedMode && lighting.mixed) {
        const zone = lighting.mixed.zones[lighting.mixed.regions[g.led] ?? 0] ?? [];
        const active = zone.filter((e) => e.effect !== 0);
        if (active.length) {
          const total = active.reduce((s, e) => s + Math.max(500, e.time), 0);
          let at = (t * 1000) % total;
          let current = active[0];
          for (const e of active) {
            if (at < Math.max(500, e.time)) {
              current = e;
              break;
            }
            at -= Math.max(500, e.time);
          }
          hsv = painterFor(effectName(current.effect))(g, t * speed(current.speed), { h: current.hue, s: current.sat, v: 255 }, ctx);
        }
      } else {
        hsv = painterFor(effectName(lighting.effect))(g, t * speed(lighting.speed), { h: lighting.hue, s: lighting.sat, v: 255 }, ctx);
      }
      if (!hsv || hsv.v < 4) {
        out.set(g.key.id, hsv ? [0, 0, 0] : null);
        continue;
      }
      out.set(g.key.id, hsvToRgb({ h: hsv.h, s: hsv.s, v: Math.min(255, hsv.v * scale) }));
    }
    return out;
  };
}
