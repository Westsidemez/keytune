// The on-screen keyboard: physical layout, legends, live lighting and editing gestures.

import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LayoutKey } from "../../shared/layout";
import type { KeyLabel } from "../../shared/keycodes";
import { keyLabel } from "../labels";
import { createPreview } from "../preview";
import { labelPlatform, macroNames, useStudio } from "../store";

export const KEYCODE_MIME = "application/x-keychron-keycode";
export const KEY_MIME = "application/x-keychron-key";

export interface KeyDecoration {
  content?: ReactNode;
  className?: string;
  /** Fixed background tint (CSS colour), e.g. zone colours. */
  tint?: string;
}

export interface KeyboardViewProps {
  mode?: "select" | "paint" | "test";
  selected?: ReadonlySet<string>;
  /** Show the keyboard's lighting on the keys. */
  lit?: boolean;
  /** Dim the legends (lighting views). */
  quietLegends?: boolean;
  onKeyPress?: (key: LayoutKey, event: React.PointerEvent) => void;
  onPaint?: (key: LayoutKey) => void;
  onPaintEnd?: () => void;
  onDropKeycode?: (key: LayoutKey, code: number) => void;
  onDropKey?: (from: LayoutKey, to: LayoutKey) => void;
  decorate?: (key: LayoutKey) => KeyDecoration | undefined;
  maxUnit?: number;
}

/** Second layer to show faintly on each key: the Fn layer above the current base layer. */
export function fnLayerFor(layer: number, layers: number, names: string[]): number | null {
  if (names[layer + 1]?.endsWith("Fn") && !names[layer]?.endsWith("Fn")) return layer + 1;
  if (!names.length && layer + 1 < layers && layer % 2 === 0) return layer + 1;
  return null;
}

export function KeyboardView(props: KeyboardViewProps) {
  const { mode = "select", selected, lit, quietLegends, onKeyPress, onPaint, onPaintEnd, onDropKeycode, onDropKey, decorate, maxUnit = 62 } = props;
  const model = useStudio((s) => s.model);
  const kb = useStudio((s) => s.kb);
  const layer = useStudio((s) => s.layer);
  const settings = useStudio((s) => s.settings);
  const platform = useStudio((s) => labelPlatform(s));
  const host = useRef<HTMLDivElement>(null);
  const keyEls = useRef(new Map<string, HTMLDivElement>());
  const [unit, setUnit] = useState(48);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const painting = useRef(false);

  const layout = model?.layout;

  useLayoutEffect(() => {
    const el = host.current;
    if (!el || !layout) return;
    const resize = () => {
      // The case adds 0.32 units of padding on each side.
      const style = getComputedStyle(el);
      const width = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 48;
      const height = el.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom) - 40;
      const byWidth = width / (layout.width + 0.64);
      const byHeight = height > 120 ? height / (layout.height + 0.64) : byWidth;
      setUnit(Math.max(26, Math.min(maxUnit, byWidth, byHeight)));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    return () => observer.disconnect();
  }, [layout, maxUnit]);

  // Live lighting preview, painted straight onto the key elements each frame.
  const lighting = kb?.lighting;
  const preview = useMemo(
    () => (lit && model && kb && lighting ? createPreview({ layout: model.layout, model, lighting, ledMap: kb.ledMap, cols: kb.cols }) : null),
    [lit, model, kb?.ledMap, kb?.cols, lighting],
  );
  useEffect(() => {
    const els = keyEls.current;
    if (!preview) {
      for (const el of els.values()) el.style.removeProperty("--led");
      return;
    }
    let frame = 0;
    let last = 0;
    const smoke = new URLSearchParams(location.search).has("smoke");
    const start = performance.now();
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - last < 33) return;
      last = now;
      const colours = preview(smoke ? 1.2 : (now - start) / 1000);
      for (const [id, rgb] of colours) {
        const el = els.get(id);
        if (!el) continue;
        if (rgb) el.style.setProperty("--led", `${rgb[0]} ${rgb[1]} ${rgb[2]}`);
        else el.style.removeProperty("--led");
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [preview]);

  useEffect(() => {
    if (mode !== "paint") return;
    const up = () => {
      if (painting.current) {
        painting.current = false;
        onPaintEnd?.();
      }
    };
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, [mode, onPaintEnd]);

  const baseColor = useMemo(() => {
    const counts = new Map<string, number>();
    for (const k of layout?.keys ?? []) if (k.color) counts.set(k.color, (counts.get(k.color) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  }, [layout]);

  if (!layout || !kb || !model) return <div className="keyboard-host" ref={host} />;

  const fnLayer = settings.showSecondLayer ? fnLayerFor(layer, kb.layers, model.layerNames) : null;
  const ctx = { platform, customKeycodes: model.definition.customKeycodes, macroNames: macroNames(), layerNames: model.layerNames };
  const gap = Math.max(3, unit * 0.075);
  const pad = unit * 0.32;

  return (
    <div className="keyboard-host" ref={host}>
      <div className={`keyboard mode-${mode}${lit ? " lit" : ""}${quietLegends ? " quiet" : ""}`} style={{ padding: pad, "--u": `${unit}px` } as React.CSSProperties}>
        <div className="plate" style={{ width: layout.width * unit, height: layout.height * unit }}>
        {layout.keys.map((key) => {
          const isEncoder = key.encoder !== undefined;
          const inMatrix = key.row >= 0;
          const code = inMatrix ? (kb.keymap[layer]?.[key.row * kb.cols + key.col] ?? 0) : 0;
          const label = inMatrix ? keyLabel(code, ctx, settings.appMacros) : undefined;
          let fn: KeyLabel | undefined;
          if (fnLayer !== null && inMatrix) {
            const fc = kb.keymap[fnLayer]?.[key.row * kb.cols + key.col] ?? 1;
            if (fc !== 1 && fc !== code) fn = keyLabel(fc, ctx, settings.appMacros);
          }
          const deco = decorate?.(key);
          const classes = [
            "key",
            isEncoder ? "knob" : "",
            key.color && baseColor && key.color !== baseColor ? "accent-cap" : "",
            selected?.has(key.id) ? "selected" : "",
            dropTarget === key.id ? "drop" : "",
            label ? `kind-${label.kind}` : "",
            label && label.label.length > 6 ? "long" : "",
            deco?.className ?? "",
          ];
          return (
            <KeyCap
              key={key.id}
              keyDef={key}
              unit={unit}
              gap={gap}
              className={classes.filter(Boolean).join(" ")}
              tint={deco?.tint}
              refCallback={(el) => (el ? keyEls.current.set(key.id, el) : keyEls.current.delete(key.id))}
              title={label ? `${label.title}${label.hold ? ` · hold: ${label.hold}` : ""}${fn ? `\n${model.layerNames[fnLayer!] ?? "Fn"}: ${fn.title}` : ""}` : undefined}
              draggable={mode === "select" && !!onDropKey && inMatrix}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                if (mode === "paint") {
                  painting.current = true;
                  onPaint?.(key);
                  (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
                } else onKeyPress?.(key, e);
              }}
              onPointerEnter={(e) => {
                if (mode === "paint" && painting.current && e.buttons & 1) onPaint?.(key);
              }}
              onDragStart={(e) => {
                e.dataTransfer.setData(KEY_MIME, key.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                if (!inMatrix && !isEncoder) return;
                const types = e.dataTransfer.types;
                if ((types.includes(KEYCODE_MIME) && onDropKeycode) || (types.includes(KEY_MIME) && onDropKey)) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = types.includes(KEY_MIME) ? "move" : "copy";
                  if (dropTarget !== key.id) setDropTarget(key.id);
                }
              }}
              onDragLeave={() => dropTarget === key.id && setDropTarget(null)}
              onDrop={(e) => {
                e.preventDefault();
                setDropTarget(null);
                const raw = e.dataTransfer.getData(KEYCODE_MIME);
                if (raw && onDropKeycode) onDropKeycode(key, Number(raw));
                const from = e.dataTransfer.getData(KEY_MIME);
                const source = from && layout.keys.find((k) => k.id === from);
                if (source && source !== key && onDropKey) onDropKey(source, key);
              }}
            >
              {deco?.content ?? (
                <>
                  {isEncoder && !inMatrix ? (
                    <span className="legend">
                      <span className="knob-mark" />
                    </span>
                  ) : (
                    <span className="legend">
                      <span className="main">{label?.label}</span>
                      {label?.hold && <span className="hold">{label.hold}</span>}
                    </span>
                  )}
                  {fn && <span className="fn">{fn.label}</span>}
                </>
              )}
            </KeyCap>
          );
        })}
        </div>
      </div>
    </div>
  );
}

interface KeyCapProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "className"> {
  keyDef: LayoutKey;
  unit: number;
  gap: number;
  className: string;
  tint?: string;
  refCallback: (el: HTMLDivElement | null) => void;
  children: ReactNode;
}

const KeyCap = memo(function KeyCap({ keyDef, unit, gap, className, tint, refCallback, children, ...rest }: KeyCapProps) {
  const style: React.CSSProperties = {
    left: keyDef.x * unit + gap / 2,
    top: keyDef.y * unit + gap / 2,
    width: keyDef.w * unit - gap,
    height: keyDef.h * unit - gap,
    ...(tint ? ({ "--tint": tint } as React.CSSProperties) : {}),
  };
  return (
    <div ref={refCallback} className={className} style={style} {...rest}>
      <div className="cap">{children}</div>
    </div>
  );
});
