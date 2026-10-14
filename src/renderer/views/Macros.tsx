// Macros: a library of onboard and app macros, a step editor (or code), and a key palette.
// Layout follows Keychron Launcher: library on the left, editor in the middle, keys on the right.

import { useEffect, useMemo, useRef, useState } from "react";
import { actionsToSteps, decodeMacroSteps, encodeMacroSteps, macroBufferBytes, untypeableCharacters, type MacroAction, type MacroStep } from "../../shared/macros";
import { describe, isModifierKey, kc, keycodeName, macroKey } from "../../shared/keycodes";
import { describeAppAction, newAppMacro, SHORTCUT_KEYS, triggerAccelerator, type AppMacro, type AppMacroAction, type ShortcutMod } from "../../shared/appMacros";
import { macroToViaText, parseProfile, profileMacroData, viaTextToMacro } from "../../shared/profile";
import { parseMacroFile, toLauncherMacros, type ImportedMacros } from "../../shared/launcherMacros";
import type { LayoutKey } from "../../shared/layout";
import { KeyboardView } from "../components/KeyboardView";
import { Workspace } from "../components/Workspace";
import { Button, Empty, Icon, ICONS, Segmented } from "../components/ui";
import { BasicKeySelect } from "./Keymap";
import { assignKey, writeMacros } from "../actions";
import { errorMessage, getState, host, macroNames, setMacroName, setState, toast, updateSettings, useStudio } from "../store";
import { hidCodeFor } from "../hidCodes";
import { keyLabel, labelContext } from "../labels";

type Selected = { kind: "onboard"; index: number } | { kind: "app"; id: string };
type DelayMode = "none" | "recorded" | "fixed";
type AddKind = "tap" | "down" | "up";
type Tab = "steps" | "code";

const LIBRARY_LAYOUT_KEY = "studio.macroLibraryLayout";
const DOWNLOAD_SEEN_KEY = "studio.macroDownloadSeen";

export function MacrosView() {
  const kb = useStudio((s) => s.kb)!;
  const model = useStudio((s) => s.model)!;
  const selection = useStudio((s) => s.selection);
  const appMacros = useStudio((s) => s.settings.appMacros);
  const [selected, setSelected] = useState<Selected>(kb.macros.count ? { kind: "onboard", index: 0 } : { kind: "app", id: appMacros[0]?.id ?? "" });
  const [drafts, setDrafts] = useState<Map<number, MacroStep[]>>(new Map());
  const [active, setActive] = useState<number | null>(null);
  const [addKind, setAddKind] = useState<AddKind>("tap");
  const [tab, setTab] = useState<Tab>("steps");
  const codeInsert = useRef<((text: string) => void) | null>(null);

  const stepsFor = (i: number) => drafts.get(i) ?? decodeMacroSteps(kb.macros.data[i] ?? new Uint8Array());
  const encoded = useMemo(() => kb.macros.data.map((d, i) => (drafts.has(i) ? encodeMacroSteps(drafts.get(i)!) : d)), [kb.macros.data, drafts]);
  const used = macroBufferBytes(encoded);
  const setSteps = (i: number, steps: MacroStep[]) => setDrafts((d) => new Map(d).set(i, steps));

  const select = (s: Selected) => {
    setSelected(s);
    setActive(null);
  };

  const save = async () => {
    if (used > kb.macros.bufferSize) {
      toast(`The macros are ${used - kb.macros.bufferSize} bytes over the keyboard's memory. Shorten one, or move it to an app macro.`, "error");
      return;
    }
    if (await writeMacros(encoded)) {
      setDrafts(new Map());
      toast("Macros saved to the keyboard", "success");
    }
  };

  const importData = async (data: unknown, label: string) => {
    let result: ImportedMacros | null = parseMacroFile(data);
    if (!result && data && typeof data === "object" && "format" in data) {
      const profile = parseProfile(data);
      const macros = profileMacroData(profile);
      if (macros) result = { macros, names: profile.macros?.names ?? [], unknown: [], source: "studio" };
    }
    if (!result) throw new Error(`${label} doesn't contain macros this app understands`);
    const next = new Map(drafts);
    let count = 0;
    result.macros.forEach((bytes, i) => {
      if (i >= kb.macros.count) return;
      if (bytes.length || encoded[i]?.length) next.set(i, decodeMacroSteps(bytes));
      if (bytes.length) count++;
    });
    setDrafts(next);
    for (const [i, name] of result.names.entries()) if (name && i < kb.macros.count) await setMacroName(i, name);
    const extra = result.macros.slice(kb.macros.count).filter((m) => m.length).length;
    const from = result.source === "launcher" ? "Keychron Launcher" : result.source === "studio" ? "the profile" : "the file";
    toast(
      `Imported ${count} macro${count === 1 ? "" : "s"} from ${from}. Check them, then Save to keyboard.` +
        (extra ? ` ${extra} didn't fit in this keyboard's ${kb.macros.count} slots.` : "") +
        (result.unknown.length ? ` Skipped unknown keys: ${result.unknown.slice(0, 4).join(", ")}.` : ""),
      result.unknown.length || extra ? "error" : "success",
    );
    select({ kind: "onboard", index: Math.max(0, result.macros.findIndex((m) => m.length)) });
    setTab("steps");
  };

  const importFile = async () => {
    try {
      const data = await host.importJson();
      if (data !== null) await importData(data, "That file");
    } catch (error) {
      toast(`Import failed: ${errorMessage(error)}`, "error");
    }
  };

  const exportFile = async () => {
    await host.exportJson(`${kb.info.productName} Macro.json`, toLauncherMacros(encoded)).catch((e) => toast(errorMessage(e), "error"));
  };

  const steps = selected.kind === "onboard" ? stepsFor(selected.index) : [];
  const activeStep = selected.kind === "onboard" && active !== null ? steps[active] : undefined;
  const editsKey = !!activeStep && "key" in activeStep;

  /** A key clicked in the palette: edit the active step, insert into code, or add a new step. */
  const pickKey = (code: number) => {
    if (selected.kind === "app") return pickAppKey(selected.id, code, active, setActive);
    if (tab === "code") {
      const name = keycodeName(code);
      codeInsert.current?.(addKind === "tap" ? `{${name}}` : `{${addKind === "down" ? "+" : "-"}${name}}`);
      return;
    }
    if (editsKey) {
      setSteps(selected.index, steps.map((s, i) => (i === active ? ({ ...s, key: code } as MacroStep) : s)));
      return;
    }
    setSteps(selected.index, [...steps, { type: addKind, key: code }]);
  };

  const selectedKey = selection?.kind === "key" ? model.layout.keys.find((k) => k.id === selection.id) : undefined;
  const currentCode = selected.kind === "onboard" ? macroKey(selected.index) : appMacros.find((m) => m.id === selected.id)?.trigger;
  const paletteHint =
    selected.kind === "app"
      ? active !== null
        ? `Sets the key of step ${active + 1}`
        : "Click a key to add a key press"
      : tab === "code"
        ? "Inserts the key's code at the cursor"
        : editsKey
          ? `Changes the key in step ${active! + 1}`
          : undefined;

  return (
    <Workspace
      compact
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
        <div className="macro-studio">
          <MacroLibrary
            selected={selected}
            onSelect={select}
            stepsFor={stepsFor}
            drafts={drafts}
            used={used}
            onImport={importFile}
            onImportData={importData}
            onExport={exportFile}
            onClear={(i) => setSteps(i, [])}
          />
          <section className="macro-editor">
            {selected.kind === "onboard" && selected.index < kb.macros.count ? (
              <OnboardEditor
                index={selected.index}
                steps={steps}
                dirty={drafts.size > 0}
                thisDirty={drafts.has(selected.index)}
                onChange={(next) => setSteps(selected.index, next)}
                onRevert={() =>
                  setDrafts((d) => {
                    const next = new Map(d);
                    next.delete(selected.index);
                    return next;
                  })
                }
                onSelect={select}
                active={active}
                setActive={setActive}
                tab={tab}
                setTab={setTab}
                codeInsert={codeInsert}
                onSave={save}
                selectedKey={selectedKey}
              />
            ) : selected.kind === "app" && appMacros.some((m) => m.id === selected.id) ? (
              <AppMacroEditor key={selected.id} macro={appMacros.find((m) => m.id === selected.id)!} onSelect={select} active={active} setActive={setActive} selectedKey={selectedKey} />
            ) : (
              <Empty title="Choose a macro" icon="macros">
                Pick a slot on the left, or create an app macro.
              </Empty>
            )}
          </section>
          <KeyPalette onPick={pickKey} addKind={addKind} setAddKind={setAddKind} hint={paletteHint} showKind={selected.kind === "onboard" && !editsKey} />
        </div>
      }
    />
  );
}

// --- library ------------------------------------------------------------------------------

function stepLabel(step: MacroStep): string {
  const name = (k: number) => describe(k).label;
  switch (step.type) {
    case "text":
      return `“${step.text.length > 14 ? `${step.text.slice(0, 14)}…` : step.text}”`;
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

const summary = (steps: MacroStep[]) => (steps.length ? steps.slice(0, 3).map(stepLabel).join(" · ") + (steps.length > 3 ? " …" : "") : "Empty");

function MacroLibrary({
  selected,
  onSelect,
  stepsFor,
  drafts,
  used,
  onImport,
  onImportData,
  onExport,
  onClear,
}: {
  selected: Selected;
  onSelect: (s: Selected) => void;
  stepsFor: (i: number) => MacroStep[];
  drafts: Map<number, MacroStep[]>;
  used: number;
  onImport: () => void;
  onImportData: (data: unknown, label: string) => Promise<void>;
  onExport: () => void;
  onClear: (i: number) => void;
}) {
  const kb = useStudio((s) => s.kb)!;
  const appMacros = useStudio((s) => s.settings.appMacros);
  const names = useStudio(() => macroNames());
  const [layout, setLayout] = useState<"list" | "grid">(() => (localStorage.getItem(LIBRARY_LAYOUT_KEY) === "grid" ? "grid" : "list"));
  const [download, setDownload] = useState<{ name: string; modified: number; data: unknown } | null>(null);

  useEffect(() => {
    let live = true;
    host
      .findMacroDownload()
      .then((found) => {
        if (live && found && localStorage.getItem(DOWNLOAD_SEEN_KEY) !== `${found.name}:${found.modified}` && parseMacroFile(found.data)) setDownload(found);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const dismissDownload = () => {
    if (download) localStorage.setItem(DOWNLOAD_SEEN_KEY, `${download.name}:${download.modified}`);
    setDownload(null);
  };

  const create = async () => {
    try {
      const macro = newAppMacro(appMacros, `App macro ${appMacros.length + 1}`);
      await updateSettings({ appMacros: [...appMacros, macro] });
      onSelect({ kind: "app", id: macro.id });
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  };

  const toggleLayout = () => {
    const next = layout === "list" ? "grid" : "list";
    setLayout(next);
    localStorage.setItem(LIBRARY_LAYOUT_KEY, next);
  };

  const pct = kb.macros.bufferSize ? (used / kb.macros.bufferSize) * 100 : 0;

  return (
    <section className="macro-library">
      <header className="column-head">
        <div>
          <h3>Macros</h3>
          <p>Pick one, then click a key above to put it there.</p>
        </div>
        <div className="column-tools">
          <button className="icon-btn" title={layout === "list" ? "Show as grid" : "Show as list"} onClick={toggleLayout}>
            <Icon name={layout === "list" ? "grid" : "list"} size={16} />
          </button>
          <button className="icon-btn" title="Import macros (Keychron Launcher, VIA or Keychron Studio file)" onClick={onImport}>
            <Icon name="upload" size={16} />
          </button>
          <button className="icon-btn" title="Export macros (Keychron Launcher can open the file too)" onClick={onExport}>
            <Icon name="download" size={16} />
          </button>
        </div>
      </header>

      {download && (
        <div className="download-banner">
          <Icon name="download" size={15} />
          <div className="download-text">
            <strong>{download.name}</strong>
            <small>Found in Downloads · {new Date(download.modified).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small>
          </div>
          <Button
            small
            kind="primary"
            onClick={async () => {
              try {
                await onImportData(download.data, download.name);
                dismissDownload();
              } catch (error) {
                toast(errorMessage(error), "error");
              }
            }}
          >
            Import
          </Button>
          <button className="icon-btn" title="Dismiss" onClick={dismissDownload}>
            <Icon name="close" size={14} />
          </button>
        </div>
      )}

      <div className="library-scroll">
        <span className="section-label">
          On the keyboard <small>works anywhere</small>
        </span>
        <ul className={`slots slots-${layout}`}>
          {Array.from({ length: kb.macros.count }, (_, i) => {
            const steps = stepsFor(i);
            const on = selected.kind === "onboard" && selected.index === i;
            return (
              <li key={i} className={`slot-item${on ? " on" : ""}${steps.length ? "" : " blank"}`} onClick={() => onSelect({ kind: "onboard", index: i })} title={layout === "grid" ? (names[i] ?? summary(steps)) : undefined}>
                <span className="slot-badge">
                  M{String(i).padStart(2, "0")}
                  {drafts.has(i) && <span className="dot-dirty" title="Not saved to the keyboard yet" />}
                </span>
                {layout === "list" ? (
                  <>
                    <span className="slot-text">
                      <NameInput index={i} value={names[i] ?? ""} />
                      <small>{summary(steps)}</small>
                    </span>
                    <button
                      className="icon-btn danger"
                      title="Clear this macro"
                      disabled={!steps.length}
                      onClick={(e) => {
                        e.stopPropagation();
                        onClear(i);
                      }}
                    >
                      <Icon name="trash" size={15} />
                    </button>
                  </>
                ) : (
                  <span className="slot-grid-name">{names[i] ?? (steps.length ? summary(steps) : "Empty")}</span>
                )}
              </li>
            );
          })}
        </ul>
        <span className="section-label">
          App macros <small>unlimited, need this app</small>
        </span>
        <ul className={`slots slots-${layout}`}>
          {appMacros.map((m) => (
            <li key={m.id} className={`slot-item${selected.kind === "app" && selected.id === m.id ? " on" : ""}`} onClick={() => onSelect({ kind: "app", id: m.id })} title={layout === "grid" ? m.name : undefined}>
              <span className="slot-badge app">
                <Icon name="bolt" size={14} />
              </span>
              {layout === "list" ? (
                <span className="slot-text">
                  <strong>{m.name}</strong>
                  <small>{m.actions.length ? m.actions.slice(0, 2).map(describeAppAction).join(" · ") : "Empty"}</small>
                </span>
              ) : (
                <span className="slot-grid-name">{m.name}</span>
              )}
            </li>
          ))}
          <li className="slot-item new" onClick={() => void create()}>
            <span className="slot-badge new">
              <Icon name="plus" size={14} />
            </span>
            {layout === "list" ? (
              <span className="slot-text">
                <strong>New app macro</strong>
                <small>Any text, open apps, run commands</small>
              </span>
            ) : (
              <span className="slot-grid-name">New</span>
            )}
          </li>
        </ul>
      </div>

      <footer className={`memory${pct > 90 ? " full" : ""}`}>
        <div className="memory-head">
          <span>Keyboard memory</span>
          <span>
            {(used / 1024).toFixed(2)} / {(kb.macros.bufferSize / 1024).toFixed(2)} KB · {Math.round(pct)}%
          </span>
        </div>
        <div className="meter-track">
          <span style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
      </footer>
    </section>
  );
}

function NameInput({ index, value }: { index: number; value: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      className="slot-name"
      placeholder="Custom title (optional)"
      value={draft}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && void setMacroName(index, draft)}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}

// --- macro switcher (top of the editor) ------------------------------------------------------

function MacroSwitcher({ selected, onSelect }: { selected: Selected; onSelect: (s: Selected) => void }) {
  const kb = useStudio((s) => s.kb)!;
  const appMacros = useStudio((s) => s.settings.appMacros);
  const names = useStudio(() => macroNames());
  const all: { value: string; label: string; sel: Selected }[] = [
    ...Array.from({ length: kb.macros.count }, (_, i) => ({ value: `o${i}`, label: `M${String(i).padStart(2, "0")} · ${names[i] ?? `Macro ${i}`}`, sel: { kind: "onboard", index: i } as Selected })),
    ...appMacros.map((m) => ({ value: `a${m.id}`, label: `⚡ ${m.name}`, sel: { kind: "app", id: m.id } as Selected })),
  ];
  const current = selected.kind === "onboard" ? `o${selected.index}` : `a${selected.id}`;
  const at = all.findIndex((o) => o.value === current);
  return (
    <div className="macro-switcher">
      <button className="icon-btn" disabled={at <= 0} onClick={() => onSelect(all[at - 1].sel)} title="Previous macro">
        <Icon name="left" size={16} />
      </button>
      <select value={current} onChange={(e) => onSelect(all.find((o) => o.value === e.target.value)!.sel)} title="Switch macro">
        {all.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <button className="icon-btn" disabled={at >= all.length - 1} onClick={() => onSelect(all[at + 1].sel)} title="Next macro">
        <Icon name="right" size={16} />
      </button>
    </div>
  );
}

// --- onboard editor --------------------------------------------------------------------------

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

function useRecorder(delayMode: DelayMode, fixedMs: number, onDone: (steps: MacroStep[]) => void) {
  const [recording, setRecording] = useState(false);
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
      if (events.current.length) {
        if (delayMode === "recorded" && now - last.current > 30) events.current.push({ type: "delay", ms: Math.min(60000, Math.round((now - last.current) / 10) * 10) });
        if (delayMode === "fixed") events.current.push({ type: "delay", ms: fixedMs });
      }
      last.current = now;
      if (e.type === "keydown") {
        held.add(code);
        events.current.push({ type: "down", key: code });
      } else {
        // macOS doesn't send keyup for keys released while ⌘ is held; release them with ⌘.
        if (code === kc("LGUI") || code === kc("RGUI"))
          for (const h of held)
            if (h !== code && !isModifierKey(h)) {
              events.current.push({ type: "up", key: h });
              held.delete(h);
            }
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
  }, [recording, delayMode, fixedMs]);
  return {
    recording,
    count,
    start: () => {
      events.current = [];
      setCount(0);
      setRecording(true);
    },
    stop: () => {
      setRecording(false);
      const steps = actionsToSteps(events.current);
      onDone(delayMode === "none" ? tidyRecording(steps) : steps);
    },
  };
}

const STEP_ICON: Record<MacroStep["type"], keyof typeof ICONS> = { tap: "keyTap", down: "keyDown", up: "keyUp", shortcut: "combo", text: "text", delay: "clock", raw: "code" };
const STEP_KIND: Record<MacroStep["type"], string> = { tap: "Tap", down: "Hold", up: "Release", shortcut: "Shortcut", text: "Type", delay: "Wait", raw: "Data" };

const ADD_STEPS: { label: string; icon: keyof typeof ICONS; title: string; make: () => MacroStep }[] = [
  { label: "Tap", icon: "keyTap", title: "Press and release a key", make: () => ({ type: "tap", key: kc("ENT") }) },
  { label: "Hold", icon: "keyDown", title: "Press a key and keep it down", make: () => ({ type: "down", key: kc("LSFT") }) },
  { label: "Release", icon: "keyUp", title: "Let go of a held key", make: () => ({ type: "up", key: kc("LSFT") }) },
  { label: "Shortcut", icon: "combo", title: "Modifiers held around one key, e.g. ⌘C", make: () => ({ type: "shortcut", mods: [kc("LGUI")], key: kc("C") }) },
  { label: "Text", icon: "text", title: "Type some text", make: () => ({ type: "text", text: "" }) },
  { label: "Wait", icon: "clock", title: "Pause before the next step", make: () => ({ type: "delay", ms: 100 }) },
];

function OnboardEditor({
  index,
  steps,
  dirty,
  thisDirty,
  onChange,
  onRevert,
  onSelect,
  active,
  setActive,
  tab,
  setTab,
  codeInsert,
  onSave,
  selectedKey,
}: {
  index: number;
  steps: MacroStep[];
  dirty: boolean;
  thisDirty: boolean;
  onChange: (s: MacroStep[]) => void;
  onRevert: () => void;
  onSelect: (s: Selected) => void;
  active: number | null;
  setActive: (i: number | null) => void;
  tab: Tab;
  setTab: (t: Tab) => void;
  codeInsert: React.MutableRefObject<((text: string) => void) | null>;
  onSave: () => void;
  selectedKey?: LayoutKey;
}) {
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [delayMode, setDelayMode] = useState<DelayMode>("none");
  const [fixedMs, setFixedMs] = useState(50);
  const recorder = useRecorder(delayMode, fixedMs, (recorded) => recorded.length && onChange([...steps, ...recorded]));
  useEffect(() => setChecked(new Set()), [index]);

  const update = (i: number, step: MacroStep) => onChange(steps.map((s, j) => (j === i ? step : s)));
  const move = (i: number, d: number) => {
    const next = steps.slice();
    const [s] = next.splice(i, 1);
    next.splice(i + d, 0, s);
    onChange(next);
    if (active === i) setActive(i + d);
  };
  const remove = (indices: Set<number>) => {
    onChange(steps.filter((_, j) => !indices.has(j)));
    setChecked(new Set());
    setActive(null);
  };
  const toggleCheck = (i: number) => {
    const next = new Set(checked);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    setChecked(next);
  };
  const allChecked = steps.length > 0 && checked.size === steps.length;

  return (
    <div className="editor">
      <header className="editor-top">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "steps", label: "Steps" },
            { value: "code", label: "Code", title: "Write or paste a macro as code" },
          ]}
        />
        <span className="spacer" />
        <MacroSwitcher selected={{ kind: "onboard", index }} onSelect={onSelect} />
      </header>

      {tab === "steps" ? (
        <div className="editor-body">
          <aside className="record-panel">
            <h4>Record</h4>
            <button className={`record-btn${recorder.recording ? " on" : ""}`} onClick={recorder.recording ? recorder.stop : recorder.start}>
              <span className="rec-dot" /> {recorder.recording ? `Stop · ${recorder.count}` : "Start recording"}
            </button>
            <h4>Time between keys</h4>
            <div className="radio-list">
              {(
                [
                  ["none", "No delay", "Fastest. Typed letters become text."],
                  ["recorded", "As recorded", "Keeps your own timing."],
                  ["fixed", "Fixed", "The same pause every time."],
                ] as [DelayMode, string, string][]
              ).map(([value, label, hint]) => (
                <label key={value} className={`radio${delayMode === value ? " on" : ""}`}>
                  <input type="radio" name="delay" checked={delayMode === value} onChange={() => setDelayMode(value)} disabled={recorder.recording} />
                  <span>
                    {label}
                    <small>{hint}</small>
                  </span>
                </label>
              ))}
              {delayMode === "fixed" && (
                <label className="fixed-ms">
                  <input type="number" min={1} max={5000} value={fixedMs} onChange={(e) => setFixedMs(Math.max(1, Math.min(5000, Number(e.target.value) || 1)))} /> ms
                </label>
              )}
            </div>
          </aside>

          <div className="steps-col">
            <div className="steps-head">
              <label className="check">
                <input type="checkbox" checked={allChecked} disabled={!steps.length} onChange={() => setChecked(allChecked ? new Set() : new Set(steps.map((_, i) => i)))} />
                Select all
              </label>
              <span className="muted small">
                {steps.length} step{steps.length === 1 ? "" : "s"}
              </span>
              <span className="spacer" />
              <Button small kind="ghost" disabled={!checked.size} onClick={() => remove(checked)}>
                <Icon name="trash" size={13} /> Delete{checked.size ? ` ${checked.size}` : ""}
              </Button>
            </div>
            <ol className="steps">
              {steps.map((step, i) => (
                <li key={i} className={`step${active === i ? " active" : ""}${checked.has(i) ? " checked" : ""}`} onClick={() => setActive(active === i ? null : i)}>
                  <input type="checkbox" className="step-check" checked={checked.has(i)} onClick={(e) => e.stopPropagation()} onChange={() => toggleCheck(i)} />
                  <span className="step-index">{i + 1}</span>
                  <span className={`step-icon step-${step.type}`} title={STEP_KIND[step.type]}>
                    <Icon name={STEP_ICON[step.type]} size={16} />
                  </span>
                  <div className="step-body" onClick={(e) => e.target !== e.currentTarget && e.stopPropagation()}>
                    <StepEditor step={step} onChange={(s) => update(i, s)} />
                  </div>
                  <span className="step-actions" onClick={(e) => e.stopPropagation()}>
                    <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} title="Move up">
                      <Icon name="up" size={14} />
                    </button>
                    <button className="icon-btn" disabled={i === steps.length - 1} onClick={() => move(i, 1)} title="Move down">
                      <Icon name="down" size={14} />
                    </button>
                    <button className="icon-btn danger" onClick={() => remove(new Set([i]))} title="Delete step">
                      <Icon name="trash" size={14} />
                    </button>
                  </span>
                </li>
              ))}
              {!steps.length && !recorder.recording && <li className="steps-empty">No steps yet. Record one, add a step below, or click keys on the right.</li>}
              {recorder.recording && (
                <li className="recording-row">
                  <span className="rec-dot" /> Recording. Press keys on your keyboard, then Stop. {recorder.count} events
                </li>
              )}
            </ol>
            <div className="add-steps">
              {ADD_STEPS.map((a) => (
                <button
                  key={a.label}
                  className="add-step"
                  title={a.title}
                  onClick={() => {
                    onChange([...steps, a.make()]);
                    setActive(steps.length);
                  }}
                >
                  <Icon name={a.icon} size={15} />
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <CodeEditor steps={steps} onApply={onChange} insertRef={codeInsert} />
      )}

      <EditorFooter
        code={macroKey(index)}
        bytes={encodeMacroSteps(steps).length}
        selectedKey={selectedKey}
        extra={
          <>
            {thisDirty && (
              <Button kind="ghost" onClick={onRevert}>
                Revert
              </Button>
            )}
            <Button kind="primary" disabled={!dirty} onClick={onSave}>
              Save to keyboard
            </Button>
          </>
        }
      />
    </div>
  );
}

function EditorFooter({ code, bytes, selectedKey, extra }: { code: number; bytes?: number; selectedKey?: LayoutKey; extra?: React.ReactNode }) {
  const kb = useStudio((s) => s.kb)!;
  const model = useStudio((s) => s.model)!;
  const layer = useStudio((s) => s.layer);
  const ctx = useStudio((s) => labelContext(s));
  const appMacros = useStudio((s) => s.settings.appMacros);
  const usedOn = useMemo(() => {
    const found: { layer: number; key: LayoutKey }[] = [];
    kb.keymap.forEach((l, li) => {
      for (const key of model.layout.keys) if (key.row >= 0 && l[key.row * kb.cols + key.col] === code) found.push({ layer: li, key });
    });
    return found;
  }, [code, kb, model]);
  const keyCode = selectedKey ? kb.keymap[layer][selectedKey.row * kb.cols + selectedKey.col] : undefined;
  const keyName = (key: LayoutKey) => (model.defaults ? keyLabel(model.defaults.layers[0]?.[key.row * kb.cols + key.col] ?? 0, ctx, appMacros).title : "") || `Key ${key.id}`;
  const layerName = (l: number) => model.layerNames[l] ?? `Layer ${l}`;

  return (
    <footer className="editor-footer">
      <div className="footer-keys">
        {usedOn.length ? (
          <>
            <span className="muted small">On</span>
            {usedOn.slice(0, 4).map((u) => (
              <button key={`${u.layer}-${u.key.id}`} className="chip" onClick={() => setState({ layer: u.layer, selection: { kind: "key", id: u.key.id } })} title={`Show on ${layerName(u.layer)}`}>
                {keyName(u.key)} <small>{layerName(u.layer)}</small>
              </button>
            ))}
          </>
        ) : (
          <span className="muted small">Not on a key yet</span>
        )}
        {selectedKey && keyCode !== undefined && keyCode !== code ? (
          <Button small onClick={() => void assignKey(layer, selectedKey.row, selectedKey.col, code)}>
            Put on {keyName(selectedKey)}
          </Button>
        ) : !selectedKey && !usedOn.length ? (
          <span className="muted small">· click a key above to put it there</span>
        ) : null}
      </div>
      <span className="spacer" />
      {bytes !== undefined && <span className="muted small">{bytes} bytes</span>}
      {extra}
    </footer>
  );
}

const MODIFIERS = [kc("LCTL"), kc("LALT"), kc("LSFT"), kc("LGUI")];

function StepEditor({ step, onChange }: { step: MacroStep; onChange: (s: MacroStep) => void }) {
  const platform = useStudio((s) => labelContext(s).platform);
  switch (step.type) {
    case "text": {
      const bad = untypeableCharacters(step.text);
      return (
        <>
          <input className="grow" value={step.text} placeholder="Text to type" onChange={(e) => onChange({ type: "text", text: e.target.value })} />
          {bad.length > 0 && (
            <span className="warn" title="The keyboard can only type plain US-layout characters. Use an app macro for anything else.">
              Can't type {bad.join(" ")}
            </span>
          )}
        </>
      );
    }
    case "shortcut":
      return (
        <>
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
          <span className="plus">+</span>
          <BasicKeySelect value={step.key} onChange={(key) => onChange({ ...step, key })} />
        </>
      );
    case "tap":
    case "down":
    case "up":
      return (
        <>
          <select className="step-kind-select" value={step.type} onChange={(e) => onChange({ ...step, type: e.target.value as "tap" })}>
            <option value="tap">Tap</option>
            <option value="down">Hold</option>
            <option value="up">Release</option>
          </select>
          <BasicKeySelect value={step.key} onChange={(key) => onChange({ ...step, key })} />
        </>
      );
    case "delay":
      return (
        <>
          <span className="step-kind">Wait</span>
          <input type="number" min={1} max={60000} value={step.ms} onChange={(e) => onChange({ type: "delay", ms: Math.max(1, Math.min(60000, Number(e.target.value) || 1)) })} />
          <span className="muted">ms</span>
        </>
      );
    case "raw":
      return (
        <>
          <code className="mono muted">{step.bytes.map((b) => b.toString(16).padStart(2, "0")).join(" ")}</code>
          <span className="muted small">Kept as-is</span>
        </>
      );
  }
}

// --- code editor ---------------------------------------------------------------------------

function CodeEditor({ steps, onApply, insertRef }: { steps: MacroStep[]; onApply: (s: MacroStep[]) => void; insertRef: React.MutableRefObject<((text: string) => void) | null> }) {
  const initial = useMemo(() => macroToViaText(encodeMacroSteps(steps)), [steps]);
  const [text, setText] = useState(initial);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setText(initial), [initial]);

  const parsed = useMemo(() => {
    try {
      return { steps: decodeMacroSteps(viaTextToMacro(text)), error: null as string | null };
    } catch (error) {
      return { steps: null, error: errorMessage(error) };
    }
  }, [text]);

  useEffect(() => {
    insertRef.current = (snippet) => {
      const el = area.current;
      const start = el?.selectionStart ?? text.length;
      const end = el?.selectionEnd ?? text.length;
      setText(text.slice(0, start) + snippet + text.slice(end));
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(start + snippet.length, start + snippet.length);
      });
    };
    return () => {
      insertRef.current = null;
    };
  }, [text, insertRef]);

  const changed = text !== initial;
  return (
    <div className="code-editor">
      <div className="code-main">
        <textarea ref={area} className="mono code-input" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} placeholder="{+KC_LCTL}{KC_TAB}{-KC_LCTL}" />
        <div className={`code-status${parsed.error ? " bad" : ""}`}>
          <span className="code-result">
            {parsed.error ?? (parsed.steps?.length ? `${parsed.steps.length} steps: ${parsed.steps.slice(0, 6).map(stepLabel).join(" · ")}${parsed.steps.length > 6 ? " …" : ""}` : "Empty macro")}
          </span>
          <Button small kind="ghost" disabled={!changed} onClick={() => setText(initial)}>
            Undo edits
          </Button>
          <Button small kind="primary" disabled={!changed || !!parsed.error} onClick={() => parsed.steps && onApply(parsed.steps)}>
            Use this code
          </Button>
        </div>
      </div>
      <aside className="code-help">
        <h4>How to write a macro</h4>
        <p>This is the same code VIA and Keychron Launcher use. Plain text is typed exactly as written. Keys go in curly brackets:</p>
        <dl>
          <dt>{"{KC_A}"}</dt>
          <dd>Tap a key</dd>
          <dt>{"{+KC_LSFT}"}</dt>
          <dd>Hold a key down</dd>
          <dt>{"{-KC_LSFT}"}</dt>
          <dd>Release it again</dd>
          <dt>{"{KC_LGUI,KC_C}"}</dt>
          <dd>Press keys together</dd>
          <dt>{"{200}"}</dt>
          <dd>Wait 200 ms</dd>
        </dl>
        <p className="muted small">
          Example, next tab: <code>{"{+KC_LCTL}{KC_TAB}{-KC_LCTL}"}</code>
        </p>
        <p className="muted small">Key names are QMK keycodes such as KC_ENT, KC_LEFT or KC_F13. Click keys on the right to insert them. Text can only use plain US keyboard characters.</p>
      </aside>
    </div>
  );
}

// --- app macro editor ---------------------------------------------------------------------------

const APP_MODS: { mod: ShortcutMod; mac: string; win: string }[] = [
  { mod: "ctrl", mac: "⌃", win: "Ctrl" },
  { mod: "alt", mac: "⌥", win: "Alt" },
  { mod: "shift", mac: "⇧", win: "Shift" },
  { mod: "cmd", mac: "⌘", win: "Win" },
];

/** HID usage → the key names app macro shortcuts use. */
const HID_TO_APP_KEY: Record<number, string> = (() => {
  const map: Record<number, string> = {};
  for (let i = 0; i < 26; i++) map[0x04 + i] = LETTERS[i];
  for (let i = 0; i < 10; i++) map[0x1e + i] = DIGITS[i];
  for (let i = 0; i < 12; i++) map[0x3a + i] = `f${i + 1}`;
  for (let i = 0; i < 12; i++) map[0x68 + i] = `f${i + 13}`;
  const named: [string, string][] = [
    ["ENT", "return"],
    ["ESC", "escape"],
    ["BSPC", "delete"],
    ["TAB", "tab"],
    ["SPC", "space"],
    ["MINS", "-"],
    ["EQL", "="],
    ["LBRC", "["],
    ["RBRC", "]"],
    ["BSLS", "\\"],
    ["SCLN", ";"],
    ["QUOT", "'"],
    ["GRV", "`"],
    ["COMM", ","],
    ["DOT", "."],
    ["SLSH", "/"],
    ["HOME", "home"],
    ["PGUP", "pageup"],
    ["DEL", "forwarddelete"],
    ["END", "end"],
    ["PGDN", "pagedown"],
    ["RGHT", "right"],
    ["LEFT", "left"],
    ["DOWN", "down"],
    ["UP", "up"],
  ];
  for (const [qmk, name] of named) map[kc(qmk)] = name;
  for (const code of Object.keys(map)) if (!SHORTCUT_KEYS.includes(map[Number(code)])) delete map[Number(code)];
  return map;
})();

const APP_MOD_FOR_HID: Record<number, ShortcutMod> = { 0xe0: "ctrl", 0xe4: "ctrl", 0xe1: "shift", 0xe5: "shift", 0xe2: "alt", 0xe6: "alt", 0xe3: "cmd", 0xe7: "cmd" };

function pickAppKey(id: string, code: number, active: number | null, setActive: (i: number | null) => void) {
  const s = getState();
  const macro = s.settings.appMacros.find((m) => m.id === id);
  if (!macro) return;
  const mod = APP_MOD_FOR_HID[code];
  const key = HID_TO_APP_KEY[code];
  const current = active !== null ? macro.actions[active] : undefined;
  let actions = macro.actions;
  if (current?.type === "shortcut") {
    if (mod) actions = actions.map((a, i) => (i === active && a.type === "shortcut" ? { ...a, mods: a.mods.includes(mod) ? a.mods.filter((m) => m !== mod) : [...a.mods, mod] } : a));
    else if (key) actions = actions.map((a, i) => (i === active && a.type === "shortcut" ? { ...a, key } : a));
    else return toast("App macros can't press that key");
  } else {
    if (!key) return toast(mod ? "Add a Shortcut step, then click modifiers to add them to it" : "App macros can't press that key");
    actions = [...actions, { type: "shortcut", mods: [], key }];
    setActive(actions.length - 1);
  }
  void updateSettings({ appMacros: s.settings.appMacros.map((m) => (m.id === id ? { ...m, actions } : m)) });
}

const APP_ICON: Record<AppMacroAction["type"], keyof typeof ICONS> = { text: "text", shortcut: "combo", delay: "clock", open: "open", shell: "terminal" };

function AppMacroEditor({
  macro,
  onSelect,
  active,
  setActive,
  selectedKey,
}: {
  macro: AppMacro;
  onSelect: (s: Selected) => void;
  active: number | null;
  setActive: (i: number | null) => void;
  selectedKey?: LayoutKey;
}) {
  const appMacros = useStudio((s) => s.settings.appMacros);
  const status = useStudio((s) => s.appMacroStatus);
  const platform = host.platform;
  const [name, setName] = useState(macro.name);
  const save = (patch: Partial<AppMacro>) => void updateSettings({ appMacros: appMacros.map((m) => (m.id === macro.id ? { ...m, ...patch } : m)) });
  const setActions = (actions: AppMacroAction[]) => save({ actions });
  const update = (i: number, a: AppMacroAction) => setActions(macro.actions.map((x, j) => (j === i ? a : x)));
  const move = (i: number, d: number) => {
    const next = macro.actions.slice();
    const [a] = next.splice(i, 1);
    next.splice(i + d, 0, a);
    setActions(next);
    if (active === i) setActive(i + d);
  };
  const add = (a: AppMacroAction) => {
    setActions([...macro.actions, a]);
    setActive(macro.actions.length);
  };
  const failed = status?.failed.find((f) => f.id === macro.id);

  return (
    <div className="editor">
      <header className="editor-top">
        <span className="slot-badge app big">
          <Icon name="bolt" size={15} />
        </span>
        <input className="title-input" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== macro.name && save({ name: name.trim() })} />
        <span className="spacer" />
        <MacroSwitcher selected={{ kind: "app", id: macro.id }} onSelect={onSelect} />
      </header>
      {failed && <p className="banner warn">Another app already uses this macro's trigger ({failed.accelerator}). Delete and recreate the macro to get a free one.</p>}
      {status?.accessibility === "denied" && (
        <p className="banner warn">
          macOS needs to allow Keychron Studio under Privacy & Security → Accessibility before it can type or press keys.{" "}
          <Button small onClick={() => void host.requestAccessibility().then((st) => setState({ appMacroStatus: st }))}>
            Allow access…
          </Button>
        </p>
      )}
      <div className="steps-col solo">
        <ol className="steps">
          {macro.actions.map((a, i) => (
            <li key={i} className={`step${active === i ? " active" : ""}`} onClick={() => setActive(active === i ? null : i)}>
              <span className="step-index">{i + 1}</span>
              <span className={`step-icon step-${a.type}`}>
                <Icon name={APP_ICON[a.type]} size={16} />
              </span>
              <div className="step-body" onClick={(e) => e.target !== e.currentTarget && e.stopPropagation()}>
                {a.type === "text" && <DraftInput className="grow" multiline value={a.text} placeholder="Any text, emoji or accents" onCommit={(text) => update(i, { type: "text", text })} />}
                {a.type === "shortcut" && (
                  <>
                    <div className="mod-row compact">
                      {APP_MODS.map((m) => (
                        <button key={m.mod} className={`mod${a.mods.includes(m.mod) ? " on" : ""}`} onClick={() => update(i, { ...a, mods: a.mods.includes(m.mod) ? a.mods.filter((x) => x !== m.mod) : [...a.mods, m.mod] })}>
                          {platform === "win32" ? m.win : m.mac}
                        </button>
                      ))}
                    </div>
                    <span className="plus">+</span>
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
                {a.type === "open" && <DraftInput className="grow" value={a.target} placeholder="https://…, a file, or an app name such as Safari" onCommit={(target) => update(i, { type: "open", target })} />}
                {a.type === "shell" && <DraftInput className="grow mono" value={a.command} placeholder="Shell command" onCommit={(command) => update(i, { type: "shell", command })} />}
              </div>
              <span className="step-actions" onClick={(e) => e.stopPropagation()}>
                <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} title="Move up">
                  <Icon name="up" size={14} />
                </button>
                <button className="icon-btn" disabled={i === macro.actions.length - 1} onClick={() => move(i, 1)} title="Move down">
                  <Icon name="down" size={14} />
                </button>
                <button
                  className="icon-btn danger"
                  onClick={() => {
                    setActions(macro.actions.filter((_, j) => j !== i));
                    setActive(null);
                  }}
                  title="Delete step"
                >
                  <Icon name="trash" size={14} />
                </button>
              </span>
            </li>
          ))}
          {!macro.actions.length && <li className="steps-empty">Add what this macro should do, or click keys on the right to press them.</li>}
        </ol>
        <div className="add-steps">
          <button className="add-step" title="Type any text, including emoji and accents" onClick={() => add({ type: "text", text: "" })}>
            <Icon name="text" size={15} /> Text
          </button>
          <button className="add-step" title="Press a shortcut such as ⌘C" onClick={() => add({ type: "shortcut", mods: ["cmd"], key: "c" })}>
            <Icon name="combo" size={15} /> Shortcut
          </button>
          <button className="add-step" title="Pause before the next step" onClick={() => add({ type: "delay", ms: 200 })}>
            <Icon name="clock" size={15} /> Wait
          </button>
          <button className="add-step" title="Open a website, file or app" onClick={() => add({ type: "open", target: "" })}>
            <Icon name="open" size={15} /> Open
          </button>
          <button className="add-step" title="Run a shell command" onClick={() => add({ type: "shell", command: "" })}>
            <Icon name="terminal" size={15} /> Command
          </button>
        </div>
        <p className="muted small">
          The key sends {triggerAccelerator(macro.trigger).replace(/\+/g, " + ")}, which this app turns into the steps above. Works while Keychron Studio runs (it can stay in the menu bar).
        </p>
      </div>
      <EditorFooter
        code={macro.trigger}
        selectedKey={selectedKey}
        extra={
          <>
            <Button
              kind="ghost"
              onClick={() => {
                if (!window.confirm(`Delete “${macro.name}”? Keys set to it will stop working.`)) return;
                void updateSettings({ appMacros: appMacros.filter((m) => m.id !== macro.id) });
                onSelect({ kind: "onboard", index: 0 });
              }}
            >
              Delete
            </Button>
            <Button onClick={() => void host.runAppMacro(macro.id).catch((e) => toast(errorMessage(e), "error"))} disabled={!macro.actions.length}>
              <Icon name="play" size={13} /> Test run
            </Button>
          </>
        }
      />
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

// --- key palette ---------------------------------------------------------------------------------

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const PALETTE: { title: string; codes: number[] }[] = [
  { title: "Modifiers", codes: ["LCTL", "LALT", "LSFT", "LGUI", "RCTL", "RALT", "RSFT", "RGUI"].map(kc) },
  { title: "Editing", codes: ["ESC", "TAB", "ENT", "BSPC", "DEL", "SPC", "CAPS", "INS"].map(kc) },
  { title: "Navigation", codes: ["LEFT", "DOWN", "UP", "RGHT", "HOME", "END", "PGUP", "PGDN"].map(kc) },
  { title: "Letters", codes: range(0x04, 0x1d) },
  { title: "Numbers", codes: range(0x1e, 0x27) },
  { title: "Symbols", codes: ["GRV", "MINS", "EQL", "LBRC", "RBRC", "BSLS", "SCLN", "QUOT", "COMM", "DOT", "SLSH"].map(kc) },
  { title: "Function keys", codes: [...range(0x3a, 0x45), ...range(0x68, 0x73)] },
  { title: "Media", codes: ["MPLY", "MPRV", "MNXT", "MUTE", "VOLD", "VOLU", "BRID", "BRIU"].map(kc) },
  { title: "Keypad", codes: [...range(0x59, 0x62), ...["PDOT", "PPLS", "PMNS", "PAST", "PSLS", "PENT"].map(kc)] },
  { title: "System", codes: ["PSCR", "SCRL", "PAUS", "APP"].map(kc) },
];

function KeyPalette({ onPick, addKind, setAddKind, hint, showKind }: { onPick: (code: number) => void; addKind: AddKind; setAddKind: (k: AddKind) => void; hint?: string; showKind: boolean }) {
  const platform = useStudio((s) => labelContext(s).platform);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const groups = PALETTE.map((g) => ({
    ...g,
    codes: q
      ? g.codes.filter((c) => {
          const d = describe(c, { platform });
          return `${d.title} ${d.label} ${keycodeName(c)}`.toLowerCase().includes(q);
        })
      : g.codes,
  })).filter((g) => g.codes.length);
  return (
    <section className="key-palette">
      <header className="column-head">
        <div>
          <h3>Keys</h3>
          <p>{hint ?? "Click a key to add it as a step."}</p>
        </div>
      </header>
      <div className="palette-tools">
        <label className="search">
          <Icon name="search" size={14} />
          <input placeholder="Find a key" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        {showKind && (
          <Segmented
            size="small"
            value={addKind}
            onChange={setAddKind}
            options={[
              { value: "tap", label: "Tap", title: "Clicked keys are pressed and released" },
              { value: "down", label: "Hold", title: "Clicked keys are pressed and kept down" },
              { value: "up", label: "Release", title: "Clicked keys are let go" },
            ]}
          />
        )}
      </div>
      <div className="palette-body">
        {groups.map((g) => (
          <div key={g.title} className="palette-group">
            <h4>{g.title}</h4>
            <div className="palette-grid">
              {g.codes.map((c) => {
                const d = describe(c, { platform });
                return (
                  <button key={c} className={`pkey${d.label.length > 3 ? " wide" : ""}`} title={`${d.title} · ${keycodeName(c)}`} onClick={() => onPick(c)}>
                    {d.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {!groups.length && <p className="muted small">No keys match “{query}”.</p>}
      </div>
    </section>
  );
}
