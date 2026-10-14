// Advanced: Snap Click, debounce, sleep timers, NKRO, resets and keyboard information.

import { useState } from "react";
import { FEATURE, type SnapClickPair } from "../../shared/protocol/commands";
import type { LayoutKey } from "../../shared/layout";
import { describe } from "../../shared/keycodes";
import { KeyboardView } from "../components/KeyboardView";
import { Workspace } from "../components/Workspace";
import { Button, Card, Icon, Segmented, Slider, Toggle } from "../components/ui";
import { setDebounce, setNkro, setSleep, setSnapClicks } from "../actions";
import { backupNow, busy, getState, perform, setState, toast, useStudio } from "../store";
import { labelContext } from "../labels";

const SNAP_TYPES = [
  { value: 1, label: "Last wins", title: "Holding both keys sends the one pressed last" },
  { value: 3, label: "First key wins", title: "Holding both keys sends the first key of the pair" },
  { value: 4, label: "Second key wins", title: "Holding both keys sends the second key of the pair" },
  { value: 5, label: "Neutral", title: "Holding both keys sends neither" },
];

const DEBOUNCE_TYPES = [
  "Symmetric delayed (global)",
  "Symmetric delayed (per row)",
  "Symmetric delayed (per key)",
  "Symmetric instant (per row)",
  "Symmetric instant (per key)",
  "Asymmetric instant press, delayed release",
  "None",
];

export function AdvancedView() {
  const kb = useStudio((s) => s.kb)!;
  const model = useStudio((s) => s.model)!;
  const [picking, setPicking] = useState<{ pair: number; slot: 0 | 1 } | null>(null);
  const pairs = kb.advanced.snapClicks;

  const pickKey = (key: LayoutKey) => {
    if (!picking || !pairs || key.row < 0) return;
    const code = kb.keymap[0][key.row * kb.cols + key.col];
    if (code > 0xff || code < 0x04) {
      toast("Snap Click works with plain keys such as letters and arrows");
      return;
    }
    const next = pairs.map((p) => ({ type: p.type, keys: [...p.keys] as [number, number] }));
    next[picking.pair].keys[picking.slot] = code;
    if (!next[picking.pair].type) next[picking.pair].type = 1;
    setPicking(picking.slot === 0 ? { pair: picking.pair, slot: 1 } : null);
    void setSnapClicks(next);
  };

  const snapKeys = new Set<string>();
  if (pairs)
    for (const p of pairs)
      if (p.type)
        for (const key of model.layout.keys) if (key.row >= 0 && p.keys.includes(kb.keymap[0][key.row * kb.cols + key.col])) snapKeys.add(key.id);

  return (
    <Workspace
      keyboard={
        <KeyboardView
          onKeyPress={pickKey}
          decorate={(key) => (snapKeys.has(key.id) ? { className: "snap-key" } : undefined)}
          selected={picking ? new Set() : undefined}
        />
      }
      toolbar={picking ? <div className="pick-banner">Click the {picking.slot === 0 ? "first" : "second"} key for pair {picking.pair + 1} · <button onClick={() => setPicking(null)}>Cancel</button></div> : undefined}
      panel={
        <div className="advanced-grid">
          {pairs && <SnapClickCard pairs={pairs} picking={picking} setPicking={setPicking} />}
          {kb.advanced.debounce && <DebounceCard />}
          {kb.advanced.sleep && <SleepCard />}
          {kb.advanced.nkro && <NkroCard />}
          <ResetCard />
        </div>
      }
      inspector={<KeyboardInfo />}
    />
  );
}

function SnapClickCard({ pairs, picking, setPicking }: { pairs: SnapClickPair[]; picking: { pair: number } | null; setPicking: (p: { pair: number; slot: 0 | 1 } | null) => void }) {
  const ctx = useStudio((s) => labelContext(s));
  const active = pairs.map((p, i) => ({ ...p, i })).filter((p) => p.type !== 0);
  const free = pairs.findIndex((p) => p.type === 0);
  const update = (i: number, patch: Partial<SnapClickPair>) => void setSnapClicks(pairs.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  return (
    <Card
      title="Snap Click"
      subtitle="For games: when two opposite keys are held, only one counts, so direction changes are instant."
      actions={
        <Button small disabled={free < 0} onClick={() => setPicking({ pair: free, slot: 0 })}>
          <Icon name="plus" size={14} /> Add pair
        </Button>
      }
    >
      {active.length === 0 && !picking ? (
        <p className="muted">No pairs yet. A common one is A + D.</p>
      ) : (
        <ul className="snap-list">
          {active.map((p) => (
            <li key={p.i}>
              <span className="chip">{describe(p.keys[0], ctx).label || "?"}</span>
              <span className="muted">+</span>
              <span className="chip">{describe(p.keys[1], ctx).label || "?"}</span>
              <Segmented size="small" value={p.type} onChange={(type) => update(p.i, { type })} options={SNAP_TYPES} />
              <button className="icon-btn" onClick={() => update(p.i, { type: 0, keys: [0, 0] })} title="Remove pair">
                <Icon name="trash" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function DebounceCard() {
  const d = useStudio((s) => s.kb!.advanced.debounce!);
  return (
    <Card title="Debounce" subtitle="How long a switch must settle before a press counts. Raise it if a key types twice.">
      <label className="field">
        <span>Method</span>
        <select value={d.type} onChange={(e) => void setDebounce(Number(e.target.value), d.time)}>
          {DEBOUNCE_TYPES.map((t, i) => (
            <option key={i} value={i}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <Slider label="Time" value={d.time} min={1} max={50} format={(v) => `${v} ms`} disabled={d.type === 6} onCommit={(v) => void setDebounce(d.type, v)} />
    </Card>
  );
}

function SleepCard() {
  const s = useStudio((st) => st.kb!.advanced.sleep!);
  const fmt = (v: number) => (v === 0 ? "Never" : v < 60 ? `${v} s` : `${Math.round(v / 60)} min`);
  return (
    <Card title="Wireless sleep" subtitle="Saves battery when the keyboard is used over Bluetooth or 2.4 GHz.">
      <Slider label="Backlight off after" value={s.backlightOff} min={5} max={600} step={5} format={fmt} onCommit={(v) => void setSleep({ ...s, backlightOff: v })} />
      <Slider label="Sleep after" value={s.idleSleep} min={60} max={7200} step={60} format={fmt} onCommit={(v) => void setSleep({ ...s, idleSleep: v })} />
    </Card>
  );
}

function NkroCard() {
  const n = useStudio((s) => s.kb!.advanced.nkro!);
  return (
    <Card title="Key rollover">
      <Toggle
        label="N-key rollover"
        hint={n.adaptive ? "Every key registers, however many are held. Turns itself off where it isn't supported." : "Every key registers, however many are held. Turn off if a BIOS or KVM doesn't see the keyboard."}
        checked={n.enabled}
        disabled={!n.settable}
        onChange={(v) => void setNkro(v)}
      />
    </Card>
  );
}

function ResetCard() {
  const kb = useStudio((s) => s.kb)!;
  const model = useStudio((s) => s.model)!;
  const reset = async (what: "keymap" | "macros") => {
    const k = getState().keyboard;
    if (!k) return;
    const label = what === "keymap" ? "Reset keymap" : "Clear macros";
    if (!window.confirm(`${label}? A backup is saved first, and you can undo.`)) return;
    await busy(label, async () => {
      await backupNow(`Before ${label.toLowerCase()}`);
      if (what === "keymap") {
        const before = k.state.keymap.map((l) => l.slice());
        const encBefore = k.state.encoders.map((l) => l.map((e) => [...e] as [number, number]));
        await perform(label, () => k.resetKeymap(), async () => {
          await k.writeKeymap(before);
          for (let l = 0; l < encBefore.length; l++) for (let e = 0; e < encBefore[l].length; e++) {
            await k.setEncoder(l, e, false, encBefore[l][e][0]);
            await k.setEncoder(l, e, true, encBefore[l][e][1]);
          }
        });
      } else {
        const before = k.state.macros.data.map((m) => m.slice());
        await perform(label, () => k.resetMacros(), () => k.writeMacros(before));
      }
    });
  };
  return (
    <Card title="Start over" subtitle="Each reset saves a backup first. Find backups under Profiles.">
      <div className="reset-row">
        <Button onClick={() => void reset("keymap")}>Reset keymap to factory</Button>
        <Button onClick={() => void reset("macros")} disabled={!kb.macros.count}>
          Clear onboard macros
        </Button>
        <Button kind="ghost" onClick={() => setState({ view: "lighting" })}>
          Lighting…
        </Button>
      </div>
      {!model.defaults && <p className="muted small">Factory layout isn't bundled for this keyboard; the keyboard's own reset is used.</p>}
    </Card>
  );
}

function KeyboardInfo() {
  const kb = useStudio((s) => s.kb)!;
  const model = useStudio((s) => s.model)!;
  const demo = useStudio((s) => s.connection.demo);
  const info = kb.info;
  const keyboard = useStudio((s) => s.keyboard)!;
  const features = [
    [FEATURE.BLUETOOTH, "Bluetooth"],
    [FEATURE.P24G, "2.4 GHz"],
    [FEATURE.SNAP_CLICK, "Snap Click"],
    [FEATURE.KEYCHRON_RGB, "Per-key RGB"],
    [FEATURE.NKRO, "NKRO"],
    [FEATURE.DYNAMIC_DEBOUNCE, "Adjustable debounce"],
  ] as const;
  return (
    <div className="inspector-body">
      <div className="inspector-title">
        <span className="eyebrow">Keyboard</span>
        <h2>{info.productName}</h2>
      </div>
      <Card>
        <dl className="facts">
          <dt>Firmware</dt>
          <dd>{info.firmware ?? "Unknown"}</dd>
          <dt>Vendor / product</dt>
          <dd className="mono">
            {info.vendorId.toString(16).padStart(4, "0")}:{info.productId.toString(16).padStart(4, "0")}
          </dd>
          <dt>VIA protocol</dt>
          <dd>{info.viaProtocol}</dd>
          {info.keychronProtocol !== undefined && (
            <>
              <dt>Keychron protocol</dt>
              <dd>{info.keychronProtocol}</dd>
            </>
          )}
          {info.mcu && (
            <>
              <dt>Chip</dt>
              <dd>{info.mcu}</dd>
            </>
          )}
          <dt>Layers</dt>
          <dd>{kb.layers}</dd>
          <dt>Layout</dt>
          <dd>{model.definition.name}</dd>
        </dl>
      </Card>
      <Card title="Supports">
        <div className="feature-chips">
          {features.map(([flag, name]) => (
            <span key={name} className={`chip${keyboard.hasFeature(flag) ? " ok" : " off"}`}>
              {name}
            </span>
          ))}
        </div>
      </Card>
      <Button onClick={() => void keyboard.identify().catch(() => undefined)} disabled={demo}>
        Flash the keyboard's lights
      </Button>
      <p className="muted small">Firmware updates are done with Keychron's official tools; this app never flashes firmware.</p>
    </div>
  );
}
