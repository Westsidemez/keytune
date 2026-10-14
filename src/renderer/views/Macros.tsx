// Macros: onboard macros (stored on the keyboard) and unlimited app macros (run by this app).

import { useEffect, useMemo, useRef, useState } from "react";
import {
  decodeMacroSteps,
  encodeMacroSteps,
  macroBufferBytes,
  untypeableCharacters,
  type MacroAction,
  type MacroStep,
  actionsToSteps,
} from "../../shared/macros";
import { describe, isModifierKey, kc, macroKey } from "../../shared/keycodes";
import { describeAppAction, newAppMacro, SHORTCUT_KEYS, triggerAccelerator, type AppMacro, type AppMacroAction, type ShortcutMod } from "../../shared/appMacros";
import type { LayoutKey } from "../../shared/layout";
import { KeyboardView } from "../components/KeyboardView";
import { Workspace } from "../components/Workspace";
import { Button, Card, Empty, Icon, Meter } from "../components/ui";
import { BasicKeySelect } from "./Keymap";
import { assignKey, writeMacros } from "../actions";
import { errorMessage, getState, host, macroNames, setMacroName, setState, toast, updateSettings, useStudio } from "../store";
import { hidCodeFor } from "../hidCodes";
import { keyLabel, labelContext } from "../labels";

type Selected = { kind: "onboard"; index: number } | { kind: "app"; id: string };

export function MacrosView() {
  const kb = useStudio((s) => s.kb)!;
  const model = useStudio((s) => s.model)!;
  const selection = useStudio((s) => s.selection);
  const appMacros = useStudio((s) => s.settings.appMacros);
  const [selected, setSelected] = useState<Selected>(kb.macros.count ? { kind: "onboard", index: 0 } : { kind: "app", id: appMacros[0]?.id ?? "" });
  const [drafts, setDrafts] = useState<Map<number, MacroStep[]>>(new Map());

  const stepsFor = (i: number) => drafts.get(i) ?? decodeMacroSteps(kb.macros.data[i] ?? new Uint8Array());
  const encoded = useMemo(() => kb.macros.data.map((d, i) => (drafts.has(i) ? encodeMacroSteps(drafts.get(i)!) : d)), [kb.macros.data, drafts]);
  const used = macroBufferBytes(encoded);
  const dirty = drafts.size > 0;

  const save = async () => {
    if (used > kb.macros.bufferSize) {
      toast(`The macros are ${used - kb.macros.bufferSize} bytes over the keyboard's storage. Shorten one, or move it to an app macro.`, "error");
      return;
    }
    if (await writeMacros(encoded)) {
      setDrafts(new Map());
      toast("Macros saved to the keyboard", "success");
    }
  };

  const selectedKey = selection?.kind === "key" ? model.layout.keys.find((k) => k.id === selection.id) : undefined;
  const currentCode = selected.kind === "onboard" ? macroKey(selected.index) : appMacros.find((m) => m.id === selected.id)?.trigger;

  return (
    <Workspace
      keyboard={
        <KeyboardView
          selected={selectedKey ? new Set([selectedKey.id]) : undefined}
          onKeyPress={(key: LayoutKey) => key.row >= 0 && setState({ selection: { kind: "key", id: key.id } })}
          decorate={(key) => {
            if (key.row < 0 || currentCode === undefined) return undefined;
            return kb.keymap[getState().layer][key.row * kb.cols + key.col] === currentCode ? { className: "macro-home" } : undefined;
          }}
        />
      }
      panel={
        <div className="macro-panel">
          <MacroList selected={selected} onSelect={setSelected} stepsFor={stepsFor} drafts={drafts} />
          <div className="macro-editor">
            {selected.kind === "onboard" && selected.index < kb.macros.count ? (
              <OnboardEditor
                key={selected.index}
                index={selected.index}
                steps={stepsFor(selected.index)}
                dirty={drafts.has(selected.index)}
                onChange={(steps) => setDrafts((d) => new Map(d).set(selected.index, steps))}
                onRevert={() =>
                  setDrafts((d) => {
                    const next = new Map(d);
                    next.delete(selected.index);
                    return next;
                  })
                }
              />
            ) : selected.kind === "app" && appMacros.some((m) => m.id === selected.id) ? (
              <AppMacroEditor key={selected.id} macro={appMacros.find((m) => m.id === selected.id)!} onDeleted={() => setSelected({ kind: "onboard", index: 0 })} />
            ) : (
              <Empty title="Choose a macro" icon="macros">
                Pick a slot on the left, or create an app macro.
              </Empty>
            )}
          </div>
        </div>
      }
      inspector={
        <MacroInspector selected={selected} used={used} dirty={dirty} onSave={save} onDiscard={() => setDrafts(new Map())} selectedKey={selectedKey} />
      }
    />
  );
}

function stepSummary(steps: MacroStep[]): string {
  if (!steps.length) return "Empty";
  return steps
    .slice(0, 4)
    .map((s) => stepLabel(s))
    .join(" · ")
    .concat(steps.length > 4 ? " …" : "");
}

function stepLabel(step: MacroStep): string {
  const name = (k: number) => describe(k).label;
  switch (step.type) {
    case "text":
      return `“${step.text.length > 16 ? `${step.text.slice(0, 16)}…` : step.text}”`;
    case "shortcut":
      return [...step.mods.map(name), name(step.key)].join("+");
    case "tap":
      return name(step.key);
    case "down":
      return `↓${name(step.key)}`;
    case "up":
      return `↑${name(step.key)}`;
    case "delay":
      return `${step.ms} ms`;
    case "raw":
      return "…";
  }
}

function MacroList({ selected, onSelect, stepsFor, drafts }: { selected: Selected; onSelect: (s: Selected) => void; stepsFor: (i: number) => MacroStep[]; drafts: Map<number, MacroStep[]> }) {
  const kb = useStudio((s) => s.kb)!;
  const appMacros = useStudio((s) => s.settings.appMacros);
  const names = useStudio(() => macroNames());
  const create = async () => {
    try {
      const macro = newAppMacro(appMacros, `App macro ${appMacros.length + 1}`);
      await updateSettings({ appMacros: [...appMacros, macro] });
      onSelect({ kind: "app", id: macro.id });
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  };
  return (
    <div className="macro-list">
      <h4>
        On the keyboard <small>{kb.macros.count} slots · work anywhere</small>
      </h4>
      <ul>
        {Array.from({ length: kb.macros.count }, (_, i) => (
          <li key={i}>
            <button className={selected.kind === "onboard" && selected.index === i ? "on" : ""} onClick={() => onSelect({ kind: "onboard", index: i })}>
              <span className="slot">M{i}</span>
              <span className="macro-name">
                {names[i] ?? `Macro ${i}`}
                {drafts.has(i) && <span className="dot-dirty" title="Not saved yet" />}
              </span>
              <small>{stepSummary(stepsFor(i))}</small>
            </button>
          </li>
        ))}
      </ul>
      <h4>
        App macros <small>unlimited · need this app running</small>
      </h4>
      <ul>
        {appMacros.map((m) => (
          <li key={m.id}>
            <button className={selected.kind === "app" && selected.id === m.id ? "on" : ""} onClick={() => onSelect({ kind: "app", id: m.id })}>
              <span className="slot app">
                <Icon name="bolt" size={13} />
              </span>
              <span className="macro-name">{m.name}</span>
              <small>{m.actions.length ? m.actions.slice(0, 2).map(describeAppAction).join(" · ") : "Empty"}</small>
            </button>
          </li>
        ))}
      </ul>
      <Button small onClick={() => void create()}>
        <Icon name="plus" size={14} /> New app macro
      </Button>
    </div>
  );
}

// --- onboard editor ---------------------------------------------------------------------

const MODIFIERS = [kc("LCTL"), kc("LALT"), kc("LSFT"), kc("LGUI")];

const LETTERS = "abcdefghijklmnopqrstuvwxyz";
const DIGITS = "1234567890";

/** Turn recorded taps of plain characters into readable text steps. */
function tidyRecording(steps: MacroStep[]): MacroStep[] {
  const out: MacroStep[] = [];
  const pushText = (t: string) => {
    const last = out[out.length - 1];
    if (last?.type === "text") last.text += t;
    else out.push({ type: "text", text: t });
  };
  for (const s of steps) {
    if (s.type === "tap" && s.key >= 0x04 && s.key <= 0x1d) pushText(LETTERS[s.key - 0x04]);
    else if (s.type === "tap" && s.key >= 0x1e && s.key <= 0x27) pushText(DIGITS[s.key - 0x1e]);
    else if (s.type === "tap" && s.key === 0x2c) pushText(" ");
    else if (s.type === "shortcut" && s.mods.length === 1 && (s.mods[0] === kc("LSFT") || s.mods[0] === kc("RSFT")) && s.key >= 0x04 && s.key <= 0x1d) pushText(LETTERS[s.key - 0x04].toUpperCase());
    else out.push({ ...s } as MacroStep);
  }
  return out;
}

function useRecorder(onDone: (steps: MacroStep[]) => void) {
  const [recording, setRecording] = useState(false);
  const [keepTiming, setKeepTiming] = useState(false);
  const events = useRef<MacroAction[]>([]);
  const last = useRef(0);
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!recording) return;
    void host.setRecording(true);
    const held = new Set<number>();
    const handle = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      const code = hidCodeFor(e.code);
      if (code === undefined) return;
      const now = performance.now();
      if (keepTiming && events.current.length && now - last.current > 40) events.current.push({ type: "delay", ms: Math.min(60000, Math.round((now - last.current) / 10) * 10) });
      last.current = now;
      if (e.type === "keydown") {
        held.add(code);
        events.current.push({ type: "down", key: code });
      } else {
        // macOS doesn't send keyup for keys released while ⌘ is held; release them with ⌘.
        if (code === kc("LGUI") || code === kc("RGUI")) for (const h of held) if (h !== code && !isModifierKey(h)) events.current.push({ type: "up", key: h }), held.delete(h);
        if (!held.has(code)) return;
        held.delete(code);
        events.current.push({ type: "up", key: code });
      }
      setCount(events.current.length);
    };
    window.addEventListener("keydown", handle, true);
    window.addEventListener("keyup", handle, true);
    return () => {
      void host.setRecording(false);
      window.removeEventListener("keydown", handle, true);
      window.removeEventListener("keyup", handle, true);
    };
  }, [recording, keepTiming]);
  return {
    recording,
    count,
    keepTiming,
    setKeepTiming,
    start: () => {
      events.current = [];
      setCount(0);
      setRecording(true);
    },
    stop: () => {
      setRecording(false);
      onDone(tidyRecording(actionsToSteps(events.current)));
    },
  };
}

function OnboardEditor({ index, steps, dirty, onChange, onRevert }: { index: number; steps: MacroStep[]; dirty: boolean; onChange: (s: MacroStep[]) => void; onRevert: () => void }) {
  const names = useStudio(() => macroNames());
  const [name, setName] = useState(names[index] ?? "");
  const recorder = useRecorder((recorded) => recorded.length && onChange([...steps, ...recorded]));
  const update = (i: number, step: MacroStep) => onChange(steps.map((s, j) => (j === i ? step : s)));
  const move = (i: number, d: number) => {
    const next = steps.slice();
    const [s] = next.splice(i, 1);
    next.splice(i + d, 0, s);
    onChange(next);
  };
  const bytes = encodeMacroSteps(steps).length;

  return (
    <div className="editor">
      <header className="editor-head">
        <span className="slot big">M{index}</span>
        <input className="title-input" placeholder={`Macro ${index}`} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => void setMacroName(index, name)} />
        <span className="muted small">{bytes} bytes</span>
        {dirty && (
          <Button small kind="ghost" onClick={onRevert}>
            Revert
          </Button>
        )}
      </header>
      <ol className="steps">
        {steps.map((step, i) => (
          <li key={i} className={`step step-${step.type}`}>
            <span className="step-index">{i + 1}</span>
            <StepEditor step={step} onChange={(s) => update(i, s)} />
            <span className="step-actions">
              <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} title="Move up">
                <Icon name="up" size={14} />
              </button>
              <button className="icon-btn" disabled={i === steps.length - 1} onClick={() => move(i, 1)} title="Move down">
                <Icon name="down" size={14} />
              </button>
              <button className="icon-btn" onClick={() => onChange(steps.filter((_, j) => j !== i))} title="Remove">
                <Icon name="trash" size={14} />
              </button>
            </span>
          </li>
        ))}
        {!steps.length && !recorder.recording && <li className="steps-empty">This macro is empty. Add steps below or record one.</li>}
        {recorder.recording && (
          <li className="recording-row">
            <span className="rec-dot" /> Recording… press the keys, then click Stop. {recorder.count} events
          </li>
        )}
      </ol>
      <div className="add-row">
        <Button small onClick={() => onChange([...steps, { type: "text", text: "" }])}>
          <Icon name="plus" size={14} /> Text
        </Button>
        <Button small onClick={() => onChange([...steps, { type: "shortcut", mods: [kc("LGUI")], key: kc("C") }])}>
          <Icon name="plus" size={14} /> Shortcut
        </Button>
        <Button small onClick={() => onChange([...steps, { type: "tap", key: kc("ENT") }])}>
          <Icon name="plus" size={14} /> Key
        </Button>
        <Button small onClick={() => onChange([...steps, { type: "delay", ms: 100 }])}>
          <Icon name="plus" size={14} /> Pause
        </Button>
        <span className="spacer" />
        <label className="check">
          <input type="checkbox" checked={recorder.keepTiming} onChange={(e) => recorder.setKeepTiming(e.target.checked)} disabled={recorder.recording} /> Keep timing
        </label>
        {recorder.recording ? (
          <Button small kind="danger" onClick={recorder.stop}>
            Stop
          </Button>
        ) : (
          <Button small onClick={recorder.start}>
            <span className="rec-dot" /> Record
          </Button>
        )}
      </div>
    </div>
  );
}

function StepEditor({ step, onChange }: { step: MacroStep; onChange: (s: MacroStep) => void }) {
  const platform = useStudio((s) => labelContext(s).platform);
  switch (step.type) {
    case "text": {
      const bad = untypeableCharacters(step.text);
      return (
        <div className="step-body">
          <span className="step-kind">Type</span>
          <input className="grow" value={step.text} placeholder="Text to type" onChange={(e) => onChange({ type: "text", text: e.target.value })} />
          {bad.length > 0 && <span className="warn" title="The keyboard can only type plain US-layout characters. Use an app macro for anything else.">Can't type {bad.join(" ")}</span>}
        </div>
      );
    }
    case "shortcut":
      return (
        <div className="step-body">
          <span className="step-kind">Press</span>
          <div className="mod-row compact">
            {MODIFIERS.map((m) => (
              <button
                key={m}
                className={`mod${step.mods.includes(m) ? " on" : ""}`}
                onClick={() => {
                  const mods = step.mods.includes(m) ? step.mods.filter((x) => x !== m) : [...step.mods, m];
                  onChange(mods.length ? { ...step, mods } : { type: "tap", key: step.key });
                }}
              >
                {describe(m, { platform }).label}
              </button>
            ))}
          </div>
          <BasicKeySelect value={step.key} onChange={(key) => onChange({ ...step, key })} />
        </div>
      );
    case "tap":
    case "down":
    case "up":
      return (
        <div className="step-body">
          <select className="step-kind-select" value={step.type} onChange={(e) => onChange({ ...step, type: e.target.value as "tap" })}>
            <option value="tap">Tap</option>
            <option value="down">Hold down</option>
            <option value="up">Release</option>
          </select>
          {step.type === "tap" && (
            <div className="mod-row compact">
              {MODIFIERS.map((m) => (
                <button key={m} className="mod" onClick={() => onChange({ type: "shortcut", mods: [m], key: step.key })} title="Add modifier">
                  {describe(m, { platform }).label}
                </button>
              ))}
            </div>
          )}
          <BasicKeySelect value={step.key} onChange={(key) => onChange({ ...step, key })} />
        </div>
      );
    case "delay":
      return (
        <div className="step-body">
          <span className="step-kind">Wait</span>
          <input type="number" min={1} max={60000} value={step.ms} onChange={(e) => onChange({ type: "delay", ms: Math.max(1, Math.min(60000, Number(e.target.value) || 1)) })} />
          <span className="muted">ms</span>
        </div>
      );
    case "raw":
      return (
        <div className="step-body">
          <span className="step-kind">Data</span>
          <code className="mono muted">{step.bytes.map((b) => b.toString(16).padStart(2, "0")).join(" ")}</code>
          <span className="muted small">Kept as-is</span>
        </div>
      );
  }
}

// --- app macro editor ----------------------------------------------------------------------

const APP_MODS: { mod: ShortcutMod; mac: string; win: string }[] = [
  { mod: "ctrl", mac: "⌃", win: "Ctrl" },
  { mod: "alt", mac: "⌥", win: "Alt" },
  { mod: "shift", mac: "⇧", win: "Shift" },
  { mod: "cmd", mac: "⌘", win: "Win" },
];

function AppMacroEditor({ macro, onDeleted }: { macro: AppMacro; onDeleted: () => void }) {
  const appMacros = useStudio((s) => s.settings.appMacros);
  const status = useStudio((s) => s.appMacroStatus);
  const platform = host.platform;
  const [name, setName] = useState(macro.name);
  const save = (patch: Partial<AppMacro>) => void updateSettings({ appMacros: appMacros.map((m) => (m.id === macro.id ? { ...m, ...patch } : m)) });
  const setActions = (actions: AppMacroAction[]) => save({ actions });
  const update = (i: number, a: AppMacroAction) => setActions(macro.actions.map((x, j) => (j === i ? a : x)));
  const failed = status?.failed.find((f) => f.id === macro.id);

  return (
    <div className="editor">
      <header className="editor-head">
        <span className="slot big app">
          <Icon name="bolt" size={16} />
        </span>
        <input className="title-input" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== macro.name && save({ name: name.trim() })} />
        <Button small onClick={() => void host.runAppMacro(macro.id).catch((e) => toast(errorMessage(e), "error"))} disabled={!macro.actions.length} title="Run it now">
          <Icon name="play" size={13} /> Test
        </Button>
        <Button
          small
          kind="ghost"
          onClick={() => {
            if (!window.confirm(`Delete “${macro.name}”? Keys set to it will stop working.`)) return;
            void updateSettings({ appMacros: appMacros.filter((m) => m.id !== macro.id) });
            onDeleted();
          }}
        >
          <Icon name="trash" size={14} />
        </Button>
      </header>
      {failed && <p className="banner warn">Another app already uses this macro's trigger ({failed.accelerator}). Delete and recreate the macro to get a free one.</p>}
      <ol className="steps">
        {macro.actions.map((a, i) => (
          <li key={i} className={`step step-${a.type}`}>
            <span className="step-index">{i + 1}</span>
            <div className="step-body">
              {a.type === "text" && (
                <>
                  <span className="step-kind">Type</span>
                  <DraftInput className="grow" multiline value={a.text} placeholder="Any text, emoji or accents" onCommit={(text) => update(i, { type: "text", text })} />
                </>
              )}
              {a.type === "shortcut" && (
                <>
                  <span className="step-kind">Press</span>
                  <div className="mod-row compact">
                    {APP_MODS.map((m) => (
                      <button
                        key={m.mod}
                        className={`mod${a.mods.includes(m.mod) ? " on" : ""}`}
                        onClick={() => update(i, { ...a, mods: a.mods.includes(m.mod) ? a.mods.filter((x) => x !== m.mod) : [...a.mods, m.mod] })}
                      >
                        {platform === "win32" ? m.win : m.mac}
                      </button>
                    ))}
                  </div>
                  <select value={a.key} onChange={(e) => update(i, { ...a, key: e.target.value })}>
                    {SHORTCUT_KEYS.map((k) => (
                      <option key={k} value={k}>
                        {k.length === 1 ? k.toUpperCase() : k}
                      </option>
                    ))}
                  </select>
                </>
              )}
              {a.type === "delay" && (
                <>
                  <span className="step-kind">Wait</span>
                  <input type="number" min={1} max={60000} value={a.ms} onChange={(e) => update(i, { type: "delay", ms: Math.max(1, Math.min(60000, Number(e.target.value) || 1)) })} />
                  <span className="muted">ms</span>
                </>
              )}
              {a.type === "open" && (
                <>
                  <span className="step-kind">Open</span>
                  <DraftInput className="grow" value={a.target} placeholder="https://…, a file, or an app name such as Safari" onCommit={(target) => update(i, { type: "open", target })} />
                </>
              )}
              {a.type === "shell" && (
                <>
                  <span className="step-kind">Run</span>
                  <DraftInput className="grow mono" value={a.command} placeholder="Shell command" onCommit={(command) => update(i, { type: "shell", command })} />
                </>
              )}
            </div>
            <span className="step-actions">
              <button className="icon-btn" onClick={() => setActions(macro.actions.filter((_, j) => j !== i))} title="Remove">
                <Icon name="trash" size={14} />
              </button>
            </span>
          </li>
        ))}
        {!macro.actions.length && <li className="steps-empty">Add what this macro should do.</li>}
      </ol>
      <div className="add-row">
        <Button small onClick={() => setActions([...macro.actions, { type: "text", text: "" }])}>
          <Icon name="plus" size={14} /> Text
        </Button>
        <Button small onClick={() => setActions([...macro.actions, { type: "shortcut", mods: ["cmd"], key: "c" }])}>
          <Icon name="plus" size={14} /> Shortcut
        </Button>
        <Button small onClick={() => setActions([...macro.actions, { type: "delay", ms: 200 }])}>
          <Icon name="plus" size={14} /> Pause
        </Button>
        <Button small onClick={() => setActions([...macro.actions, { type: "open", target: "" }])}>
          <Icon name="plus" size={14} /> Open
        </Button>
        <Button small onClick={() => setActions([...macro.actions, { type: "shell", command: "" }])}>
          <Icon name="plus" size={14} /> Command
        </Button>
      </div>
      <p className="muted small">
        The key sends {triggerAccelerator(macro.trigger).replace(/\+/g, " + ")}, which this app turns into the steps above. Works while Keychron Studio runs (it can stay in the menu bar).
      </p>
    </div>
  );
}

function DraftInput({ value, onCommit, className, placeholder, multiline }: { value: string; onCommit: (v: string) => void; className?: string; placeholder?: string; multiline?: boolean }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const props = {
    className,
    placeholder,
    value: draft,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: () => draft !== value && onCommit(draft),
  };
  return multiline ? <textarea rows={Math.min(5, Math.max(1, draft.split("\n").length))} {...props} /> : <input {...props} />;
}

// --- inspector ------------------------------------------------------------------------------

function MacroInspector({ selected, used, dirty, onSave, onDiscard, selectedKey }: { selected: Selected; used: number; dirty: boolean; onSave: () => void; onDiscard: () => void; selectedKey?: LayoutKey }) {
  const kb = useStudio((s) => s.kb)!;
  const model = useStudio((s) => s.model)!;
  const layer = useStudio((s) => s.layer);
  const appMacros = useStudio((s) => s.settings.appMacros);
  const status = useStudio((s) => s.appMacroStatus);
  const ctx = useStudio((s) => labelContext(s));
  const names = useStudio(() => macroNames());
  const code = selected.kind === "onboard" ? macroKey(selected.index) : appMacros.find((m) => m.id === selected.id)?.trigger;
  const title = selected.kind === "onboard" ? (names[selected.index] ?? `Macro ${selected.index}`) : (appMacros.find((m) => m.id === selected.id)?.name ?? "");

  const usedOn = useMemo(() => {
    if (code === undefined) return [];
    const found: { layer: number; key: LayoutKey }[] = [];
    kb.keymap.forEach((l, li) => {
      for (const key of model.layout.keys) if (key.row >= 0 && l[key.row * kb.cols + key.col] === code) found.push({ layer: li, key });
    });
    return found;
  }, [code, kb, model]);

  const keyCode = selectedKey ? kb.keymap[layer][selectedKey.row * kb.cols + selectedKey.col] : undefined;

  return (
    <div className="inspector-body">
      <Card title="Keyboard storage">
        <Meter used={used} total={kb.macros.bufferSize} label={`${kb.macros.count} onboard macros`} />
        <div className="save-row">
          <Button kind="primary" disabled={!dirty} onClick={onSave}>
            Save to keyboard
          </Button>
          {dirty && (
            <Button kind="ghost" onClick={onDiscard}>
              Discard
            </Button>
          )}
        </div>
        {!dirty && <p className="muted small">Edits to onboard macros are kept here until you save them.</p>}
      </Card>

      {code !== undefined && (
        <Card title={`Keys running “${title}”`}>
          {usedOn.length ? (
            <ul className="used-on">
              {usedOn.map((u) => (
                <li key={`${u.layer}-${u.key.id}`}>
                  <button onClick={() => setState({ layer: u.layer, selection: { kind: "key", id: u.key.id } })}>
                    <span className="layer-name">{model.layerNames[u.layer] ?? `Layer ${u.layer}`}</span>
                    <span>{model.defaults ? `The ${keyLabel(model.defaults.layers[0]?.[u.key.row * kb.cols + u.key.col] ?? 0, ctx, appMacros).title} key` : `Key ${u.key.id}`}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Not on any key yet.</p>
          )}
          {selectedKey && keyCode !== undefined ? (
            <Button kind={keyCode === code ? "secondary" : "primary"} disabled={keyCode === code} onClick={() => void assignKey(layer, selectedKey.row, selectedKey.col, code)}>
              {keyCode === code ? "Already on the selected key" : `Put it on the selected key (now “${keyLabel(keyCode, ctx, appMacros).label || "none"}”)`}
            </Button>
          ) : (
            <p className="muted small">Click a key on the keyboard to put this macro on it.</p>
          )}
        </Card>
      )}

      {selected.kind === "app" && status && status.accessibility !== "not-needed" && (
        <Card title="Permission">
          {status.accessibility === "granted" ? (
            <p className="ok-line">
              <Icon name="check" size={14} /> Accessibility access granted
            </p>
          ) : (
            <>
              <p className="muted">To type text and press shortcuts, macOS needs to allow Keychron Studio under Privacy & Security → Accessibility.</p>
              <Button onClick={() => void host.requestAccessibility().then((s) => setState({ appMacroStatus: s }))}>Allow access…</Button>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
