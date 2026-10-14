// A small keyboard that shows a lighting effect, for the effect gallery.
// Boards show a still frame and only animate while \`playing\` (on hover), sharing one loop.

import { useEffect, useMemo, useRef } from "react";
import type { LightingState } from "../../shared/keyboard";
import type { KeyboardModel } from "../../shared/definitions";
import { createPreview } from "../preview";

type Draw = (t: number) => void;
const active = new Set<Draw>();
let frame = 0;
let last = 0;
const start = performance.now();
const STILL_T = 1.7;
const still = typeof location !== "undefined" && new URLSearchParams(location.search).has("smoke");

function loop(now: number) {
  frame = active.size ? requestAnimationFrame(loop) : 0;
  if (now - last < 45) return;
  last = now;
  const t = still ? STILL_T : (now - start) / 1000;
  for (const draw of active) draw(t);
}

function play(draw: Draw): () => void {
  active.add(draw);
  if (!frame) frame = requestAnimationFrame(loop);
  return () => active.delete(draw);
}

export function MiniBoard({ model, lighting, ledMap, cols, playing = false }: { model: KeyboardModel; lighting: LightingState; ledMap: (number | null)[]; cols: number; playing?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const preview = useMemo(() => createPreview({ layout: model.layout, model, lighting, ledMap, cols }), [model, lighting, ledMap, cols]);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const layout = model.layout;

    const draw: Draw = (t) => {
      const dpr = window.devicePixelRatio || 1;
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      if (el.width !== Math.round(w * dpr)) {
        el.width = Math.round(w * dpr);
        el.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const pad = 6;
      const u = Math.min((w - pad * 2) / layout.width, (h - pad * 2) / layout.height);
      const ox = (w - layout.width * u) / 2;
      const oy = (h - layout.height * u) / 2;
      const gap = Math.max(1, u * 0.12);
      const colours = preview(t);
      for (const key of layout.keys) {
        const rgb = colours.get(key.id);
        const x = ox + key.x * u + gap / 2;
        const y = oy + key.y * u + gap / 2;
        const kw = key.w * u - gap;
        const kh = key.h * u - gap;
        const r = key.encoder !== undefined ? kw / 2 : Math.max(1, u * 0.16);
        ctx.beginPath();
        ctx.roundRect(x, y, kw, kh, r);
        if (rgb && (rgb[0] || rgb[1] || rgb[2])) {
          ctx.fillStyle = `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`;
          ctx.shadowColor = `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]} / 0.7)`;
          ctx.shadowBlur = u * 0.5;
        } else {
          ctx.fillStyle = "rgb(255 255 255 / 0.07)";
          ctx.shadowBlur = 0;
        }
        ctx.fill();
      }
      ctx.shadowBlur = 0;
    };

    draw(STILL_T);
    if (!playing || still) {
      // The first layout may not have happened yet; draw again once the canvas has a size.
      const observer = new ResizeObserver(() => draw(STILL_T));
      observer.observe(el);
      return () => observer.disconnect();
    }
    const stop = play(draw);
    return () => {
      stop();
      draw(STILL_T);
    };
  }, [preview, model, playing]);

  return <canvas ref={canvas} className="mini-board" />;
}
