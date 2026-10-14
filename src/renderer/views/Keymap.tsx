// Keymap: click a key (or drop a keycode on it), then choose what it does.

import { useMemo, useState } from "react";
import {
  DANGEROUS_KEYCODES,
  HYPER,
  MEH,
  MOD,
  describe,
  layerTap,
  modTap,
  parseKeycode,
  pickerCatalogue,
  tapHoldParts,
  withMods,
  type PickerCategory,
  type PickerEntry,
} from "../../shared/keycodes";
import type { LayoutKey } from "../../shared/layout";
import { KeyboardView, KEYCODE_MIME } from "../components/KeyboardView";
import { Workspace } from "../components/Workspace";
import { Button, Card, Empty, Icon, Segmented } from "../components/ui";
import { assignEncoder, assignKey, swapKeys } from "../actions";
import { setState, toast, useStudio, getState, type Selection } from "../store";
import { hex, keyLabel, labelContext } from "../labels";

export function KeymapView() {
  const model = useStudio((s) => s.model)!;
  const selection = useStudio((s) => s.selection);
  const layer = useStudio((s) => s.layer);

  const selectedIds = useMemo(() => {
    if (!selection) return new Set<string>();
    if (selection.kind === "key") return new Set([selection.id]);
    const knob = model.layout.keys.find((k) => k.encoder === selection.index);
    return new Set(knob ? [knob.id] : []);
  }, [selection, model]);

  const onKeyPress = (key: LayoutKey) => {
    if (key.encoder !== undefined) {
      const current = getState().selection;
      const action = current?.kind === "encoder" && current.index === key.encoder ? current.action : key.row >= 0 ? "press" : "cw";
      setState({ selection: { kind: "encoder", index: key.encoder, action } });
    } else setState({ selection: { kind: "key", id: key.id } });
  };

  const onDropKeycode = (key: LayoutKey, code: number) => {
    if (key.encoder !== undefined && key.row < 0) {
      void assignEncoder(layer, key.encoder, true, code);
      return;
    }
    onKeyPress(key);
    void assignCode(code, { kind: "key", id: key.id });
  };

  return (
    <Workspace
      keyboard={
        <KeyboardView
          selected={selectedIds}
          onKeyPress={onKeyPress}
          onDropKeycode={onDropKeycode}
          onDropKey={(from, to) => {
            if (from.row >= 0 && to.row >= 0) void swapKeys(layer, [from.row, from.col], [to.row, to.col]);
          }}
        />
      }
      panel={<KeyPicker />}
      inspector={selection ? <KeyInspector selection={selection} /> : <KeymapOverview />}
    />
  );
}

/** Assign a keycode to whatever is selected. */
export async function assignCode(code: number, target: Selection = getState().selection): Promise<boolean> {
  const s = getState();
  if (!target || !s.model) {
    toast("Click a key on the keyboard first, or drag the keycode onto a key");
    return false;
  }
  if (DANGEROUS_KEYCODES.has(code) && !window.confirm(`${describe(code).title} resets or reflashes the keyboard when pressed. Assign it anyway?`)) return false;
  if (target.kind === "key") {
    const key = s.model.layout.keys.find((k) => k.id === target.id);
    if (!key || key.row < 0) return false;
    return assignKey(s.layer, key.row, key.col, code);
  }
  if (target.action === "press") {
    const knob = s.model.layout.keys.find((k) => k.encoder === target.index && k.row >= 0);
    if (!knob) {
      toast("This knob has no press action");
      return false;
    }
    return assignKey(s.layer, knob.row, knob.col, code);
  }
  return assignEncoder(s.layer, target.index, target.action === "cw", code);
}

// --- picker ----------------------------------------------------------------------------

function KeyPicker() {
  const kb = useStudio((s) => s.kb)!;
  const model = useStudio((s) => s.model)!;
  const appMacros = useStudio((s) => s.settings.appMacros);
  const ctx = useStudio((s) => labelContext(s));
  const [category, setCategory] = useState("basic");
  const [query, setQuery] = useState("");

  const catalogue = useMemo<PickerCategory[]>(() => {
    const base = pickerCatalogue({ layers: kb.layers, macros: kb.macros.count, customKeycodes: model.definition.customKeycodes });
    return base.map((c) =>
      c.id === "macros" && appMacros.length ? { ...c, groups: [...c.groups, { title: "App macros (run by this app)", entries: appMacros.map((m) => ({ code: m.trigger })) }] } : c,
    );
  }, [kb.layers, kb.macros.count, model, appMacros]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const seen = new Set<number>();
    const found: PickerEntry[] = [];
    for (const c of catalogue)
      for (const g of c.groups)
        for (const e of g.entries) {
          if (seen.has(e.code)) continue;
          const l = keyLabel(e.code, ctx, appMacros);
          const hay = `${e.label ?? ""} ${e.title ?? ""} ${e.keywords ?? ""} ${l.label} ${l.title} ${l.name}`.toLowerCase();
          if (hay.includes(q)) {
            seen.add(e.code);
            found.push(e);
          }
        }
    const typed = parseKeycode(query, model.definition.customKeycodes);
    if (typed !== null && !seen.has(typed)) found.unshift({ code: typed });
    return found.slice(0, 120);
  }, [query, catalogue, ctx, appMacros, model]);

  const active = catalogue.find((c) => c.id === category) ?? catalogue[0];

  return (
    <div className="picker">
      <div className="picker-head">
        <Segmented value={active.id} onChange={(v) => { setCategory(v); setQuery(""); }} options={catalogue.map((c) => ({ value: c.id, label: c.title }))} />
        <label className="search">
          <Icon name="search" size={15} />
          <input placeholder="Search keys, e.g. “volume”, “copy”, KC_F13" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>
      <div className="picker-body">
        {results ? (
          results.length ? (
            <div className="tile-grid">
              {results.map((e) => (
                <Tile key={e.code} entry={e} />
              ))}
            </div>
          ) : (
            <Empty title="No matching keys">Try another word, or type a QMK name such as LCTL(KC_C).</Empty>
          )
        ) : (
          active.groups.map((g) => (
            <div key={g.title} className="tile-group">
              <h4>{g.title}</h4>
              <div className="tile-grid">
                {g.entries.map((e) => (
                  <Tile key={`${g.title}-${e.code}`} entry={e} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function Tile({ entry }: { entry: PickerEntry }) {
  const ctx = useStudio((s) => labelContext(s));
  const appMacros = useStudio((s) => s.settings.appMacros);
  const l = keyLabel(entry.code, ctx, appMacros);
  const label = entry.label ?? l.label;
  return (
    <button
      className={`tile kind-${l.kind}${label.length > 6 ? " long" : ""}`}
      title={`${entry.title ?? l.title}\n${l.name}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(KEYCODE_MIME, String(entry.code));
        e.dataTransfer.effectAllowed = "copy";
      }}
      onClick={() => void assignCode(entry.code)}
    >
      <span>{label || "∅"}</span>
      {l.hold && <small>{l.hold}</small>}
    </button>
  );
}

// --- inspector ------------------------------------------------------------------------------

function KeymapOverview() {
  const kb = useStudio((s) => s.kb)!;
  const model = useStudio((s) => s.model)!;
  const layer = useStudio((s) => s.layer);
  const changed = useMemo(() => {
    const defaults = model.defaults?.layers[layer];
    if (!defaults) return null;
    return kb.keymap[layer].filter((c, i) => c !== defaults[i]).length;
  }, [kb.keymap, layer, model]);
  return (
    <div className="inspector-body">
      <Empty title="Select a key" icon="keymap">
        Click a key to see and change what it does on every layer. You can also drag a key from below onto the keyboard, or drag one key onto another to swap them.
      </Empty>
      <Card title="This layer">
        <dl className="facts">
          <dt>Layer</dt>
          <dd>{model.layerNames[layer] ?? `Layer ${layer}`}</dd>
          {changed !== null && (
            <>
              <dt>Changed keys</dt>
              <dd>{changed === 0 ? "None (factory layout)" : `${changed} differ from factory`}</dd>
            </>
          )}
          <dt>Macros</dt>
          <dd>{kb.macros.count} onboard slots</dd>
        </dl>
      </Card>
      <div className="hint-list">
        <p>
          <kbd>⌘K</kbd> search everything
        </p>
        <p>
          <kbd>⌘Z</kbd> undo the last change
        </p>
      </div>
    </div>
  );
}

function KeyInspector({ selection }: { selection: NonNullable<Selection> }) {
  const kb = useStudio((s) => s.kb)!;
  const model = useStudio((s) => s.model)!;
  const layer = useStudio((s) => s.layer);
  const ctx = useStudio((s) => labelContext(s));
  const appMacros = useStudio((s) => s.settings.appMacros);

  let key: LayoutKey | undefined;
  let code: number | undefined;
  let heading = "Key";
  if (selection.kind === "key") {
    key = model.layout.keys.find((k) => k.id === selection.id);
    if (key) code = kb.keymap[layer][key.row * kb.cols + key.col];
  } else {
    key = model.layout.keys.find((k) => k.encoder === selection.index);
    heading = "Knob";
    if (selection.action === "press") code = key && key.row >= 0 ? kb.keymap[layer][key.row * kb.cols + key.col] : undefined;
    else code = kb.encoders[layer]?.[selection.index]?.[selection.action === "cw" ? 1 : 0];
  }
  if (!key) return null;
  const label = code !== undefined ? keyLabel(code, ctx, appMacros) : undefined;
  const index = key.row * kb.cols + key.col;
  const factory =
    selection.kind === "encoder" && selection.action !== "press"
      ? model.defaults?.encoders[layer]?.[selection.index]?.[selection.action === "cw" ? 1 : 0]
      : key.row >= 0
        ? model.defaults?.layers[layer]?.[index]
        : undefined;

  return (
    <div className="inspector-body">
      <div className="key-hero">
        <div className={`hero-cap kind-${label?.kind ?? "none"}`}>
          <span>{label?.label || "∅"}</span>
          {label?.hold && <small>{label.hold}</small>}
        </div>
        <div>
          <span className="eyebrow">
            {heading} · {model.layerNames[layer] ?? `Layer ${layer}`}
          </span>
          <h2>{label?.title ?? "Not mappable"}</h2>
          {code !== undefined && (
            <code className="mono">
              {label?.name} · {hex(code)}
            </code>
          )}
        </div>
      </div>

      {selection.kind === "encoder" && <KnobSlots selection={selection} />}

      {code !== undefined && (
        <>
          <Card title="Build an action">
            <ActionBuilder key={`${JSON.stringify(selection)}:${layer}:${code}`} code={code} />
          </Card>
          <div className="quick-row">
            <Button small onClick={() => void assignCode(1)} title="Use whatever the layer below does">
              Transparent
            </Button>
            <Button small onClick={() => void assignCode(0)}>
              Disable
            </Button>
            {factory !== undefined && factory !== code && (
              <Button small kind="ghost" onClick={() => void assignCode(factory)} title={keyLabel(factory, ctx, appMacros).title}>
                Reset to “{keyLabel(factory, ctx, appMacros).label || "none"}”
              </Button>
            )}
          </div>
        </>
      )}

      {key.row >= 0 && selection.kind === "key" && (
        <Card title="On every layer">
          <ul className="layer-list">
            {kb.keymap.map((l, i) => {
              const c = l[index];
              const ll = keyLabel(c, ctx, appMacros);
              return (
                <li key={i} className={i === layer ? "current" : ""}>
                  <button onClick={() => setState({ layer: i })}>
                    <span className="layer-name">{model.layerNames[i] ?? `Layer ${i}`}</span>
                    <span className={`chip kind-${ll.kind}`}>{ll.label || "∅"}</span>
                    <span className="layer-title">{ll.title}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}

function KnobSlots({ selection }: { selection: Extract<NonNullable<Selection>, { kind: "encoder" }> }) {
  const kb = useStudio((s) => s.kb)!;
  const model = useStudio((s) => s.model)!;
  const layer = useStudio((s) => s.layer);
  const ctx = useStudio((s) => labelContext(s));
  const appMacros = useStudio((s) => s.settings.appMacros);
  const knob = model.layout.keys.find((k) => k.encoder === selection.index);
  const pair = kb.encoders[layer]?.[selection.index];
  const press = knob && knob.row >= 0 ? kb.keymap[layer][knob.row * kb.cols + knob.col] : undefined;
  const slots: { action: "ccw" | "press" | "cw"; title: string; code?: number }[] = [
    { action: "ccw", title: "Turn left", code: pair?.[0] },
    { action: "press", title: "Press", code: press },
    { action: "cw", title: "Turn right", code: pair?.[1] },
  ];
  return (
    <div className="knob-slots">
      {slots.map((s) => (
        <button
          key={s.action}
          disabled={s.code === undefined}
          className={selection.action === s.action ? "on" : ""}
          onClick={() => setState({ selection: { kind: "encoder", index: selection.index, action: s.action } })}
        >
          <small>{s.title}</small>
          <strong>{s.code === undefined ? "—" : keyLabel(s.code, ctx, appMacros).label || "∅"}</strong>
        </button>
      ))}
      {!pair && <p className="muted">This firmware doesn't allow remapping the knob's turn actions.</p>}
    </div>
  );
}

const MOD_BUTTONS: { mask: number; mac: string; win: string }[] = [
  { mask: MOD.CTRL, mac: "⌃ Control", win: "Ctrl" },
  { mask: MOD.ALT, mac: "⌥ Option", win: "Alt" },
  { mask: MOD.SHIFT, mac: "⇧ Shift", win: "Shift" },
  { mask: MOD.GUI, mac: "⌘ Command", win: "Win" },
];

const HOLD_CHOICES: { value: string; label: string }[] = [
  { value: `m${MOD.CTRL}`, label: "Control" },
  { value: `m${MOD.SHIFT}`, label: "Shift" },
  { value: `m${MOD.ALT}`, label: "Option / Alt" },
  { value: `m${MOD.GUI}`, label: "Command / Win" },
  { value: `m${HYPER}`, label: "Hyper (⌃⌥⇧⌘)" },
  { value: `m${MEH}`, label: "Meh (⌃⌥⇧)" },
  { value: `m${MOD.CTRL | MOD.SHIFT}`, label: "Control + Shift" },
  { value: `m${MOD.GUI | MOD.SHIFT}`, label: "Command + Shift" },
];

function ActionBuilder({ code }: { code: number }) {
  const model = useStudio((s) => s.model)!;
  const kb = useStudio((s) => s.kb)!;
  const platform = useStudio((s) => labelContext(s).platform);
  const parts = tapHoldParts(code);
  const [tab, setTab] = useState<"shortcut" | "taphold" | "code">(parts ? "taphold" : "shortcut");
  const [mods, setMods] = useState(code > 0xff && code < 0x2000 ? (code >> 8) & 0x1f : 0);
  const [key, setKey] = useState(code & 0xff || 0x04);
  const [hold, setHold] = useState(parts ? ("mods" in parts.hold ? `m${parts.hold.mods}` : `l${parts.hold.layer}`) : `m${HYPER}`);
  const [text, setText] = useState("");
  const parsed = text.trim() ? parseKeycode(text, model.definition.customKeycodes) : null;

  return (
    <div className="builder">
      <Segmented
        size="small"
        value={tab}
        onChange={setTab}
        options={[
          { value: "shortcut", label: "Shortcut" },
          { value: "taphold", label: "Tap / Hold" },
          { value: "code", label: "Keycode" },
        ]}
      />
      {tab === "shortcut" && (
        <>
          <div className="mod-row">
            {MOD_BUTTONS.map((m) => (
              <button key={m.mask} className={`mod${mods & m.mask ? " on" : ""}`} onClick={() => setMods(mods ^ m.mask)}>
                {platform === "win" ? m.win : m.mac}
              </button>
            ))}
          </div>
          <BasicKeySelect value={key} onChange={setKey} />
          <Button kind="primary" onClick={() => void assignCode(mods ? withMods(mods, key) : key)}>
            Set to {mods ? describe(withMods(mods, key), { platform }).label : describe(key, { platform }).label}
          </Button>
        </>
      )}
      {tab === "taphold" && (
        <>
          <label className="field">
            <span>Tap</span>
            <BasicKeySelect value={key} onChange={setKey} />
          </label>
          <label className="field">
            <span>Hold</span>
            <select value={hold} onChange={(e) => setHold(e.target.value)}>
              <optgroup label="Modifier">
                {HOLD_CHOICES.map((h) => (
                  <option key={h.value} value={h.value}>
                    {h.label}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Layer">
                {Array.from({ length: Math.min(16, kb.layers) }, (_, i) => (
                  <option key={i} value={`l${i}`}>
                    {model.layerNames[i] ?? `Layer ${i}`}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <p className="muted">Tap for the key, hold for the modifier or layer. Great for Caps Lock → Esc / Hyper.</p>
          <Button kind="primary" onClick={() => void assignCode(hold.startsWith("m") ? modTap(Number(hold.slice(1)), key) : layerTap(Number(hold.slice(1)), key))}>
            Set tap / hold
          </Button>
        </>
      )}
      {tab === "code" && (
        <>
          <label className="field">
            <span>QMK name or hex</span>
            <input className="mono" placeholder="LCTL(KC_C), MO(1), LT(2,KC_SPC), 0x5220" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
          </label>
          <p className="muted">{text.trim() ? (parsed === null ? "Not recognised" : `${describe(parsed, { platform, customKeycodes: model.definition.customKeycodes }).title} · ${hex(parsed)}`) : "Any keycode the firmware understands."}</p>
          <Button kind="primary" disabled={parsed === null} onClick={() => parsed !== null && void assignCode(parsed)}>
            Set keycode
          </Button>
        </>
      )}
    </div>
  );
}

const BASIC_KEYS = (() => {
  const list: { code: number; title: string }[] = [];
  for (let c = 0x04; c <= 0xe7; c++) {
    const d = describe(c);
    if (d.name.startsWith("0x") || /^KC_(NO|TRNS)$/.test(d.name) || (c > 0xa4 && c < 0xe0)) continue;
    list.push({ code: c, title: d.title });
  }
  return list;
})();

export function BasicKeySelect({ value, onChange }: { value: number; onChange: (code: number) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {BASIC_KEYS.map((k) => (
        <option key={k.code} value={k.code}>
          {k.title}
        </option>
      ))}
    </select>
  );
}
