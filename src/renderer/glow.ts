// Cheap lighting glow: key colours painted into a tiny canvas (a few pixels per key unit),
// which is then blurred once as a whole instead of blurring every key separately.

import type { KeyboardLayout as Layout } from "../shared/layout";
import type { RGB } from "./color";

export const GLOW_PX_PER_UNIT = 6;

export function glowCanvas(layout: Layout): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.ceil(layout.width * GLOW_PX_PER_UNIT);
  c.height = Math.ceil(layout.height * GLOW_PX_PER_UNIT);
  return c;
}

/** Paint each key's colour as a block into a glow canvas (see glowCanvas). */
export function paintGlow(canvas: HTMLCanvasElement, layout: Layout, colours: Map<string, RGB | null>): void {
  const g = canvas.getContext("2d");
  if (!g) return;
  g.clearRect(0, 0, canvas.width, canvas.height);
  const p = GLOW_PX_PER_UNIT;
  for (const key of layout.keys) {
    const rgb = colours.get(key.id);
    if (!rgb || !(rgb[0] || rgb[1] || rgb[2])) continue;
    g.fillStyle = `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`;
    g.fillRect(Math.round(key.x * p), Math.round(key.y * p), Math.max(1, Math.round(key.w * p)), Math.max(1, Math.round(key.h * p)));
  }
}
