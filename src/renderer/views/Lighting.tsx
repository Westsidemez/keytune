// Lighting: effects, per-key painting, mixed zones and indicator lights.

import { useCallback, useRef, useState } from "react";
import type { LayoutKey } from "../../shared/layout";
import type { HSV, MixedEffect } from "../../shared/protocol/commands";
import { KeyboardView } from "../components/KeyboardView";
import { Workspace } from "../components/Workspace";
import { Button, Card, ColorInput, ColorPicker, Empty, Icon, Segmented, Slider, Toggle } from "../components/ui";
import { assignZones, paintKeys, setColor, setEffect, setIndicators, setLightingValue, setPerKeyType, setZoneEffects } from "../actions";
import { getState, toast, useStudio } from "../store";
import { hsvCss } from "../color";

type Tab = "effects" | "paint" | "zones" | "indicators";

export const ZONE_COLOURS = ["#ff7a3d", "#4da3ff", "#3ddc97", "#c77dff", "#ffd23d", "#ff5d8f", "#5ee0e6", "#a3a3a3"];

const PER_KEY_TYPES = ["Solid", "Breathing", "Reactive", "Reactive wide", "Reactive splash"];

export function LightingView() {
  const kb = useStudio((s) => s.kb)!;
  const model = useStudio((s) => s.model)!;
  const lighting = kb.lighting;
  const [tab, setTab] = useState<Tab>("effects");
  const [brush, setBrush] = useState<HSV>({ h: 16, s: 255, v: 255 });
  const [tool, setTool] = useState<"brush" | "fill" | "pick">("brush");
  const [zone, setZone] = useState(0);
  const stroke = useRef<{ changes: Map<number, HSV>; before: Map<number, HSV>; effect: number } | null>(null);
  const zoneStroke = useRef<{ changes: Map<number, number>; before: Map<number, number>; effect: number } | null>(null);

  const ledOf = (key: LayoutKey) => (key.row >= 0 ? kb.ledMap[key.row * kb.cols + key.col] : null);

  const onPaint = useCallback(
    (key: LayoutKey) => {
      const k = getState().keyboard;
      const state = k?.state;
      if (!k || !state?.lighting) return;
      const led = key.row >= 0 ? state.ledMap[key.row * state.cols + key.col] : null;
      if (led === null || led === undefined) return;
      if (tab === "paint" && state.lighting.perKey) {
        if (tool === "pick") {
          setBrush({ ...state.lighting.perKey.colors[led] });
          setTool("brush");
          return;
        }
        if (tool === "fill") {
          const changes = new Map<number, HSV>();
          const before = new Map<number, HSV>();
          state.lighting.perKey.colors.forEach((c, i) => {
            changes.set(i, brush);
            before.set(i, c);
          });
          void paintKeys(changes, before);
          return;
        }
        if (!stroke.current) {
          stroke.current = { changes: new Map(), before: new Map(), effect: state.lighting.effect };
          if (model.perKeyMode !== undefined && state.lighting.effect !== model.perKeyMode) void k.setEffect(model.perKeyMode);
        }
        if (stroke.current.changes.has(led)) return;
        stroke.current.before.set(led, state.lighting.perKey.colors[led]);
        stroke.current.changes.set(led, brush);
        void k.setPerKeyColors(new Map([[led, brush]])).catch(() => undefined);
      }
      if (tab === "zones" && state.lighting.mixed) {
        if (!zoneStroke.current) {
          zoneStroke.current = { changes: new Map(), before: new Map(), effect: state.lighting.effect };
          if (model.mixedMode !== undefined && state.lighting.effect !== model.mixedMode) void k.setEffect(model.mixedMode);
        }
        if (zoneStroke.current.changes.has(led)) return;
        zoneStroke.current.before.set(led, state.lighting.mixed.regions[led]);
        zoneStroke.current.changes.set(led, zone);
        void k.setMixedRegions(new Map([[led, zone]])).catch(() => undefined);
      }
    },
    [tab, tool, brush, zone, model],
  );

  const onPaintEnd = useCallback(() => {
    if (stroke.current) {
      const s = stroke.current;
      stroke.current = null;
      void paintKeys(s.changes, s.before, s.effect);
    }
    if (zoneStroke.current) {
      const s = zoneStroke.current;
      zoneStroke.current = null;
      void assignZones(s.changes, s.before, s.effect);
    }
  }, []);

  if (!lighting) {
    return <Workspace keyboard={<KeyboardView mode="select" />} panel={<Empty title="No adjustable lighting" icon="lighting">This keyboard doesn't report RGB lighting controls over USB.</Empty>} />;
  }

  const tabs: { value: Tab; label: string }[] = [{ value: "effects", label: "Effects" }];
  if (lighting.perKey) tabs.push({ value: "paint", label: "Paint keys" });
  if (lighting.mixed) tabs.push({ value: "zones", label: "Zones" });
  if (lighting.indicators && lighting.indicators.supported) tabs.push({ value: "indicators", label: "Indicators" });

  const painting = tab === "paint" || tab === "zones";
  const decorate =
    tab === "zones" && lighting.mixed
      ? (key: LayoutKey) => {
          const led = ledOf(key);
          if (led === null) return undefined;
          const region = lighting.mixed!.regions[led] ?? 0;
          return { tint: ZONE_COLOURS[region % ZONE_COLOURS.length], className: "zoned", content: <span className="zone-badge">{region + 1}</span> };
        }
      : undefined;

  return (
    <Workspace
      toolbar={
        <div className="lighting-toolbar">
          <Segmented value={tab} onChange={setTab} options={tabs} />
          {tab === "paint" && <span className="muted">Click or drag across keys to paint</span>}
          {tab === "zones" && <span className="muted">Paint keys into zone {zone + 1}</span>}
        </div>
      }
      keyboard={<KeyboardView lit quietLegends={painting} mode={painting ? "paint" : "select"} onPaint={onPaint} onPaintEnd={onPaintEnd} decorate={decorate} />}
      panel={
        tab === "effects" ? (
          <EffectGallery />
        ) : tab === "paint" ? (
          <PaintTools tool={tool} setTool={setTool} brush={brush} setBrush={setBrush} />
        ) : tab === "zones" ? (
          <ZoneEditor zone={zone} setZone={setZone} />
        ) : (
          <IndicatorEditor />
        )
      }
      inspector={tab === "paint" ? <BrushInspector brush={brush} setBrush={setBrush} /> : <GlobalLighting />}
    />
  );
}

function effectSwatch(name: string, h: number, s: number): string {
  if (/cycle|rainbow|pinwheel|spiral|beacon|rain|pixel/i.test(name)) return "linear-gradient(120deg, #ff4d4d, #ffd23d, #3ddc97, #4da3ff, #c77dff)";
  if (/heatmap/i.test(name)) return "linear-gradient(120deg, #3ddc97, #ffd23d, #ff4d4d)";
  if (/digital rain/i.test(name)) return "linear-gradient(180deg, #021a0a, #3ddc97)";
  const base = hsvCss({ h, s, v: 255 });
  if (/breath/i.test(name)) return `radial-gradient(circle at 50% 60%, ${base}, #111 75%)`;
  if (/reactive|splash|nexus|cross/i.test(name)) return `radial-gradient(circle at 30% 50%, ${base}, transparent 45%), #121316`;
  if (/band|gradient/i.test(name)) return `linear-gradient(90deg, #111, ${base}, #111)`;
  return base;
}

function EffectGallery() {
  const kb = useStudio((s) => s.kb)!;
  const model = useStudio((s) => s.model)!;
  const lighting = kb.lighting!;
  const special: { id: number; name: string; swatch: string }[] = [];
  if (model.perKeyMode !== undefined && lighting.perKey) special.push({ id: model.perKeyMode, name: "Your key colours", swatch: "linear-gradient(90deg, #ff7a3d 0 25%, #4da3ff 25% 50%, #3ddc97 50% 75%, #c77dff 75%)" });
  if (model.mixedMode !== undefined && lighting.mixed) special.push({ id: model.mixedMode, name: "Your zones", swatch: "linear-gradient(90deg, #ff7a3d 0 50%, #4da3ff 50%)" });
  return (
    <div className="effect-gallery">
      <button className={`effect-card${lighting.effect === 0 ? " on" : ""}`} onClick={() => void setEffect(0)}>
        <span className="effect-swatch off" />
        <span>Off</span>
      </button>
      {special.map((e) => (
        <button key={e.id} className={`effect-card special${lighting.effect === e.id ? " on" : ""}`} onClick={() => void setEffect(e.id)}>
          <span className="effect-swatch" style={{ background: e.swatch }} />
          <span>{e.name}</span>
        </button>
      ))}
      {model.effects.map((e) => (
        <button key={e.id} className={`effect-card${lighting.effect === e.id ? " on" : ""}`} onClick={() => void setEffect(e.id)}>
          <span className="effect-swatch" style={{ background: effectSwatch(e.name, lighting.hue, lighting.sat) }} />
          <span>{e.name}</span>
        </button>
      ))}
    </div>
  );
}

function GlobalLighting() {
  const kb = useStudio((s) => s.kb)!;
  const model = useStudio((s) => s.model)!;
  const l = kb.lighting!;
  const effectName = l.effect === 0 ? "Off" : l.effect === model.perKeyMode ? "Your key colours" : l.effect === model.mixedMode ? "Your zones" : (model.effects.find((e) => e.id === l.effect)?.name ?? `Effect ${l.effect}`);
  const usesColour = l.effect !== 0 && l.effect !== model.perKeyMode && l.effect !== model.mixedMode;
  return (
    <div className="inspector-body">
      <div className="inspector-title">
        <span className="eyebrow">Now playing</span>
        <h2>{effectName}</h2>
      </div>
      <Card>
        <Slider label="Brightness" value={l.brightness} onPreview={(v) => void setLightingValue("brightness", v, false)} onCommit={(v, start) => void setLightingValue("brightness", v, true, start)} />
        <Slider label="Speed" value={l.speed} disabled={l.effect === 0} onPreview={(v) => void setLightingValue("speed", v, false)} onCommit={(v, start) => void setLightingValue("speed", v, true, start)} />
      </Card>
      <Card title="Colour" subtitle={usesColour ? undefined : "Used by single-colour effects"}>
        <ColorPicker
          value={{ h: l.hue, s: l.sat, v: 255 }}
          showValue={false}
          onChange={(hsv) => void setColor(hsv, false)}
          onCommit={(hsv, start) => void setColor(hsv, true, start)}
        />
      </Card>
      <p className="muted small">Changes apply to the keyboard as you make them. Use ⌘Z to go back.</p>
    </div>
  );
}

function PaintTools({ tool, setTool, brush, setBrush }: { tool: string; setTool: (t: "brush" | "fill" | "pick") => void; brush: HSV; setBrush: (b: HSV) => void }) {
  const kb = useStudio((s) => s.kb)!;
  const model = useStudio((s) => s.model)!;
  const perKey = kb.lighting!.perKey!;
  const active = kb.lighting!.effect === model.perKeyMode;
  const recent = [...new Map(perKey.colors.filter((c) => c.v > 0).map((c) => [`${c.h},${c.s},${c.v}`, c])).values()].slice(0, 12);
  return (
    <div className="paint-tools">
      <Card title="Tool">
        <div className="tool-row">
          <button className={`tool${tool === "brush" ? " on" : ""}`} onClick={() => setTool("brush")}>
            <Icon name="brush" /> Brush
          </button>
          <button className={`tool${tool === "fill" ? " on" : ""}`} onClick={() => setTool("fill")} title="Click any key to colour every key">
            <Icon name="fill" /> Fill all
          </button>
          <button className={`tool${tool === "pick" ? " on" : ""}`} onClick={() => setTool("pick")} title="Click a key to pick up its colour">
            <Icon name="picker" /> Pick
          </button>
        </div>
        {!active && <p className="muted small">Painting switches the keyboard to your key colours.</p>}
      </Card>
      <Card title="Key effect">
        <Segmented size="small" value={perKey.type} onChange={(t) => void setPerKeyType(t)} options={PER_KEY_TYPES.map((label, value) => ({ value, label }))} />
      </Card>
      <Card title="Colours on the keyboard">
        <div className="swatches">
          {recent.length ? recent.map((c, i) => <button key={i} className={`swatch${c.h === brush.h && c.s === brush.s && c.v === brush.v ? " on" : ""}`} style={{ background: hsvCss(c) }} onClick={() => setBrush(c)} />) : <span className="muted">No keys painted yet</span>}
        </div>
      </Card>
    </div>
  );
}

function BrushInspector({ brush, setBrush }: { brush: HSV; setBrush: (b: HSV) => void }) {
  const l = useStudio((s) => s.kb!.lighting!);
  return (
    <div className="inspector-body">
      <div className="inspector-title">
        <span className="eyebrow">Brush</span>
        <h2>
          <span className="color-dot" style={{ background: hsvCss(brush) }} /> Paint colour
        </h2>
      </div>
      <Card>
        <ColorPicker value={brush} onChange={setBrush} onCommit={(hsv) => setBrush(hsv)} />
      </Card>
      <Card>
        <Slider label="Overall brightness" value={l.brightness} onPreview={(v) => void setLightingValue("brightness", v, false)} onCommit={(v, start) => void setLightingValue("brightness", v, true, start)} />
      </Card>
    </div>
  );
}

function ZoneEditor({ zone, setZone }: { zone: number; setZone: (z: number) => void }) {
  const kb = useStudio((s) => s.kb)!;
  const model = useStudio((s) => s.model)!;
  const mixed = kb.lighting!.mixed!;
  const timeline = (mixed.zones[zone] ?? []).filter((e) => e.effect !== 0);
  const counts = mixed.zones.map((_, i) => mixed.regions.filter((r) => r === i).length);

  const commit = (next: MixedEffect[]) => void setZoneEffects(zone, next);
  const update = (index: number, patch: Partial<MixedEffect>) => commit(timeline.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  const add = () => {
    if (timeline.length >= mixed.effectsPerRegion) {
      toast(`A zone can play up to ${mixed.effectsPerRegion} effects`);
      return;
    }
    commit([...timeline, { effect: model.effects[0]?.id ?? 1, hue: 16, sat: 255, speed: 128, time: 5000 }]);
  };

  return (
    <div className="zone-editor">
      <div className="zone-chips">
        {mixed.zones.map((_, i) => (
          <button key={i} className={`zone-chip${zone === i ? " on" : ""}`} onClick={() => setZone(i)} style={{ "--zone": ZONE_COLOURS[i % ZONE_COLOURS.length] } as React.CSSProperties}>
            <span className="zone-dot" />
            Zone {i + 1}
            <small>{counts[i]} keys</small>
          </button>
        ))}
      </div>
      <Card
        title={`Zone ${zone + 1} timeline`}
        subtitle="The zone plays these effects in order, then repeats."
        actions={
          <Button small onClick={add} disabled={timeline.length >= mixed.effectsPerRegion}>
            <Icon name="plus" size={14} /> Add effect
          </Button>
        }
      >
        {timeline.length === 0 ? (
          <Empty title="Nothing plays in this zone">Add an effect to light these keys.</Empty>
        ) : (
          <ol className="timeline">
            {timeline.map((e, i) => (
              <li key={i} className="timeline-row">
                <span className="step-index">{i + 1}</span>
                <select value={e.effect} onChange={(ev) => update(i, { effect: Number(ev.target.value) })}>
                  {model.effects.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
                <ColorInput title="Colour" value={{ h: e.hue, s: e.sat, v: 255 }} onCommit={(hsv) => update(i, { hue: hsv.h, sat: hsv.s })} />
                <div className="timeline-speed">
                  <Slider label="Speed" value={e.speed} onCommit={(v) => update(i, { speed: v })} />
                </div>
                <label className="field inline">
                  <input
                    type="number"
                    min={1}
                    max={600}
                    defaultValue={Math.round(e.time / 1000)}
                    onBlur={(ev) => {
                      const secs = Math.max(1, Math.min(600, Number(ev.target.value) || 1));
                      if (secs * 1000 !== e.time) update(i, { time: secs * 1000 });
                    }}
                  />
                  <span>s</span>
                </label>
                <button className="icon-btn" title="Remove" onClick={() => commit(timeline.filter((_, j) => j !== i))}>
                  <Icon name="trash" size={15} />
                </button>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

const INDICATORS = ["Num Lock", "Caps Lock", "Scroll Lock", "Compose", "Kana"];

function IndicatorEditor() {
  const ind = useStudio((s) => s.kb!.lighting!.indicators!);
  return (
    <div className="indicator-editor">
      <Card title="Lock lights" subtitle="Which keys light up when their lock is on">
        {INDICATORS.map((name, bit) =>
          ind.supported & (1 << bit) ? (
            <Toggle key={name} label={name} checked={!(ind.disabled & (1 << bit))} onChange={(on) => void setIndicators(on ? ind.disabled & ~(1 << bit) : ind.disabled | (1 << bit), ind.hsv)} />
          ) : null,
        )}
      </Card>
      <Card title="Indicator colour">
        <ColorPicker value={ind.hsv} onCommit={(hsv) => void setIndicators(ind.disabled, hsv)} />
      </Card>
    </div>
  );
}
