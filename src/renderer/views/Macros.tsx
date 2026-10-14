// Macros: a library of onboard and app macros, a step editor (or code), and a key palette.
// Layout follows Keychron Launcher: library on the left, editor in the middle, keys on the right.
// Onboard and app macros share one editor; app macros add Open and Command steps.

import { useEffect, useMemo, useRef, useState } from "react";
import { actionsToSteps, decodeMacroSteps, encodeMacroSteps, macroBufferBytes, untypeableCharacters, type MacroAction, type MacroStep } from "../../shared/macros";
import { describe, isModifierKey, kc, keycodeName, macroKey, type Platform } from "../../shared/keycodes";
import { newAppMacro, SHORTCUT_KEYS, triggerAccelerator, type AppMacro, type AppMacroAction, type ShortcutMod } from "../../shared/appMacros";
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
type Mode = "onboard" | "app";
type DelayMode = "none" | "recorded" | "fixed";
type AddKind = "tap" | "down" | "up";
type Tab = "steps" | "code";
/** A step in the editor: an onboard macro step, or one of the app-only steps. */
type EStep = MacroStep | { type: "open"; target: string } | { type: "shell"; command: string };

const LIBRARY_LAYOUT_KEY = "studio.macroLibraryLayout";
const DOWNLOAD_SEEN_KEY = "studio.macroDownloadSeen";

const hasKey = (s: EStep | undefined): s is Extract<MacroStep, { key: number }> => !!s && (s.type === "tap" || s.type === "down" || s.type === "up" || s.type === "shortcut");

export function MacrosView() {
  const kb = useStudio((s) => s.kb)!;
  const model = useStudio((s) => s.model)!;
  const selection = useStudio((s) => s.selection);
  const appMacros = useStudio((s) => s.settings.appMacros);
  const [selected, setSelected] = useState<Selected>(kb.macros.count ? { kind: "onboard", index: 0 } : { kind: "app", id: appMacros[0]?.id ?? "" });
  const [drafts, setDrafts] = useState<Map<number, MacroStep[]>>(new Map());
  const [tab, setTab] = useState<Tab>("steps");

  const stepsFor = (i: number) => drafts.get(i) ?? decodeMacroSteps(kb.macros.data[i] ?? new Uint8Array());
  const encoded = useMemo(() => kb.macros.data.map((d, i) => (drafts.has(i) ? encodeMacroSteps(drafts.get(i)!) : d)), [kb.macros.data, drafts]);
  const used = macroBufferBytes(encoded);
  const setSteps = (i: number, steps: MacroStep[]) => setDrafts((d) => new Map(d).set(i, steps));

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
    setSelected({ kind: "onboard", index: Math.max(0, result.macros.findIndex((m) => m.length)) });
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

  const selectedKey = selection?.kind === "key" ? model.layout.keys.find((k) => k.id === selection.id) : undefined;
  const appMacro = selected.kind === "app" ? appMacros.find((m) => m.id === selected.id) : undefined;
  const currentCode = selected.kind === "onboard" ? macroKey(selected.index) : appMacro?.trigger;
  const shared = { tab, setTab, onSelect: setSelected, selectedKey };

  return (
    <Workspace
      compact
      keyboard={
        <div className="macro-stage">
          <div className="macro-stage-board">
            <KeyboardView
              selected={selectedKey ? new Set([selectedKey.id]) : undefined}
              onKeyPress={(key: LayoutKey) => key.row >= 0 && setState({ selection: { kind: "key", id: key.id } })}
              decorate={(key) => {
                if (key.row < 0 || currentCode === undefined) return undefined;
                return kb.keymap[getState().layer][key.row * kb.cols + key.col] === currentCode ? { className: "macro-home" } : undefined;
              }}
            />
          </div>
          {currentCode !== undefined && (
            <AssignPanel
              code={currentCode}
              badge={selected.kind === "onboard" ? `M${String(selected.index).padStart(2, "0")}` : null}
              name={selected.kind === "onboard" ? (macroNames()[selected.index] ?? `Macro ${selected.index}`) : (appMacro?.name ?? "")}
              steps={selected.kind === "onboard" ? stepsFor(selected.index) : appToSteps(appMacro?.actions ?? [])}
              isApp={selected.kind === "app"}
              selectedKey={selectedKey}
            />
          )}
        </div>
      }
      panel={
        <div className="macro-studio">
          <MacroLibrary
            selected={selected}
            onSelect={setSelected}
            stepsFor={stepsFor}
            drafts={drafts}
            used={used}
            onImport={importFile}
            onImportData={importData}
            onExport={exportFile}
            onClear={(i) => setSteps(i, [])}
          />
          {selected.kind === "onboard" && selected.index < kb.macros.count ? (
            <Workbench
              key={`o${selected.index}`}
              mode="onboard"
              selected={selected}
              steps={stepsFor(selected.index)}
              onChange={(next) => setSteps(selected.index, next as MacroStep[])}
              title={macroNames()[selected.index] ?? ""}
              onRename={(name) => void setMacroName(selected.index, name)}
              footer={
                <>
                  {drafts.has(selected.index) && (
                    <Button
                      kind="ghost"
                      onClick={() =>
                        setDrafts((d) => {
                          const next = new Map(d);
                          next.delete(selected.index);
                          return next;
                        })
                      }
                    >
                      Revert
                    </Button>
                  )}
                  <Button kind="primary" disabled={!drafts.size} onClick={save}>
                    Save steps to keyboard
                  </Button>
                </>
              }
              {...shared}
            />
          ) : appMacro ? (
            <AppWorkbench key={`a${appMacro.id}`} macro={appMacro} {...shared} />
          ) : (
            <>
              <section className="macro-editor">
                <Empty title="Choose a macro" icon="macros">
                  Pick a slot on the left, or create an app macro.
                </Empty>
              </section>
              <section className="key-palette" />
            </>
          )}
        </div>
      }
    />
  );
}

// --- key caps (compact summaries) -------------------------------------------------------------

const MAC_MOD: Record<number, string> = { 0xe0: "⌃", 0xe1: "⇧", 0xe2: "⌥", 0xe3: "⌘", 0xe4: "R⌃", 0xe5: "R⇧", 0xe6: "R⌥", 0xe7: "R⌘" };
const WIN_MOD: Record<number, string> = { 0xe0: "Ctrl", 0xe1: "Shift", 0xe2: "Alt", 0xe3: "Win", 0xe4: "RCtrl", 0xe5: "RShift", 0xe6: "RAlt", 0xe7: "RWin" };
const SYMBOL: Record<string, string> = { ENT: "⏎", BSPC: "⌫", DEL: "⌦", TAB: "⇥", ESC: "Esc", SPC: "Space", CAPS: "⇪", LEFT: "←", RGHT: "→", UP: "↑", DOWN: "↓" };

/** The shortest readable legend for a key, e.g. ⌘, ⏎, \\, F13. */
function capLabel(code: number, platform: Platform): string {
  if (isModifierKey(code)) return (platform === "win" ? WIN_MOD : MAC_MOD)[code] ?? describe(code, { platform }).label;
  const name = keycodeName(code).replace(/^KC_/, "");
  if (SYMBOL[name]) return SYMBOL[name];
  const label = describe(code, { platform }).label;
  const pair = /^(\S{1,2}) \S{1,2}$/.exec(label);
  return pair ? pair[1] : label;
}

type CapGroup = { kind: "keys"; keys: string[]; held?: boolean } | { kind: "text"; text: string } | { kind: "open" } | { kind: "shell" };

function capGroups(steps: EStep[], platform: Platform): CapGroup[] {
  const groups: CapGroup[] = [];
  let holding: Extract<CapGroup, { kind: "keys" }> | null = null;
  for (const s of steps) {
    if (s.type === "down") {
      if (!holding) groups.push((holding = { kind: "keys", keys: [], held: true }));
      holding.keys.push(capLabel(s.key, platform));
      continue;
    }
    if (s.type === "up") {
      holding = null;
      continue;
    }
    if (s.type === "delay" || s.type === "raw") continue;
    holding = null;
    if (s.type === "tap") groups.push({ kind: "keys", keys: [capLabel(s.key, platform)] });
    else if (s.type === "shortcut") groups.push({ kind: "keys", keys: [...s.mods, s.key].map((k) => capLabel(k, platform)) });
    else if (s.type === "text") groups.push({ kind: "text", text: s.text });
    else groups.push({ kind: s.type });
  }
  return groups;
}

function KeyCaps({ steps, max = 3 }: { steps: EStep[]; max?: number }) {
  const platform = useStudio((s) => labelContext(s).platform ?? "mac");
  const groups = capGroups(steps, platform);
  if (!groups.length) return <span className="caps-empty">Empty</span>;
  return (
    <span className="caps">
      {groups.slice(0, max).map((g, i) => (
        <span key={i} className="cap-group">
          {g.kind === "keys" &&
            g.keys.map((k, j) => (
              <kbd key={j} className={`kcap${g.held ? " held" : ""}`}>
                {k}
              </kbd>
            ))}
          {g.kind === "text" && <span className="cap-text">“{g.text.length > 12 ? `${g.text.slice(0, 12)}…` : g.text}”</span>}
          {g.kind === "open" && (
            <kbd className="kcap">
              <Icon name="open" size={10} />
            </kbd>
          )}
          {g.kind === "shell" && (
            <kbd className="kcap">
              <Icon name="terminal" size={10} />
            </kbd>
          )}
        </span>
      ))}
      {groups.length > max && <span className="cap-more">+{groups.length - max}</span>}
    </span>
  );
}

function stepLabel(step: EStep): string {
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
    case "open":
      return `Open ${step.target}`;
    case "shell":
      return `Run ${step.command}`;
  }
}

// --- library ------------------------------------------------------------------------------

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
  const [layout, setLayout] = useState<"list" | "grid">(() => (localStorage.getItem(LIBRARY_LAYOUT_KEY) === "list" ? "list" : "grid"));
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
              <li
                key={i}
                className={`slot-item${on ? " on" : ""}${steps.length ? "" : " blank"}`}
                onClick={() => onSelect({ kind: "onboard", index: i })}
                title={layout === "grid" ? [names[i], steps.map(stepLabel).join(" · ")].filter(Boolean).join("\n") || "Empty" : undefined}
              >
                <span className="slot-badge">
                  M{String(i).padStart(2, "0")}
                  {drafts.has(i) && <span className="dot-dirty" title="Not saved to the keyboard yet" />}
                </span>
                {layout === "list" ? (
                  <>
                    <span className="slot-text">
                      <NameInput index={i} value={names[i] ?? ""} />
                      <KeyCaps steps={steps} max={4} />
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
                  <span className="slot-grid-body">
                    <KeyCaps steps={steps} max={1} />
                    {names[i] && <small className="slot-grid-name">{names[i]}</small>}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        <span className="section-label">
          App macros <small>unlimited, need this app</small>
        </span>
        <ul className={`slots slots-${layout}`}>
          {appMacros.map((m) => {
            const steps = appToSteps(m.actions);
            return (
              <li key={m.id} className={`slot-item${selected.kind === "app" && selected.id === m.id ? " on" : ""}${steps.length ? "" : " blank"}`} onClick={() => onSelect({ kind: "app", id: m.id })} title={layout === "grid" ? m.name : undefined}>
                <span className="slot-badge is-app">
                  <Icon name="bolt" size={14} />
                </span>
                {layout === "list" ? (
                  <span className="slot-text">
                    <strong>{m.name}</strong>
                    <KeyCaps steps={steps} max={4} />
                  </span>
                ) : (
                  <span className="slot-grid-body">
                    <KeyCaps steps={steps} max={1} />
                    <small className="slot-grid-name">{m.name}</small>
                  </span>
                )}
              </li>
            );
          })}
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
              <span className="slot-grid-body">
                <small className="slot-grid-name">New</small>
              </span>
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
  return <CommitInput className="slot-name" placeholder="Custom title (optional)" value={value} onCommit={(name) => void setMacroName(index, name)} stopClicks />;
}

/** A text field that commits on blur or Enter. */
function CommitInput({ value, onCommit, className, placeholder, stopClicks }: { value: string; onCommit: (v: string) => void; className?: string; placeholder?: string; stopClicks?: boolean }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      className={className}
      placeholder={placeholder}
      value={draft}
      onClick={stopClicks ? (e) => e.stopPropagation() : undefined}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
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

// --- recording --------------------------------------------------------------------------------

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

// --- app macro <-> editor steps ---------------------------------------------------------------

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
const APP_KEY_TO_HID: Record<string, number> = Object.fromEntries(Object.entries(HID_TO_APP_KEY).map(([code, name]) => [name, Number(code)]));
const APP_KEY_CODES = Object.keys(HID_TO_APP_KEY).map(Number);

const MOD_FOR_HID: Record<number, ShortcutMod> = { 0xe0: "ctrl", 0xe4: "ctrl", 0xe1: "shift", 0xe5: "shift", 0xe2: "alt", 0xe6: "alt", 0xe3: "cmd", 0xe7: "cmd" };
const HID_FOR_MOD: Record<ShortcutMod, number> = { ctrl: 0xe0, shift: 0xe1, alt: 0xe2, cmd: 0xe3 };

/** HID modifier usage → app macro modifier key name (left and right). */
const HID_TO_APP_MOD: Record<number, string> = { 0xe0: "ctrl", 0xe1: "shift", 0xe2: "alt", 0xe3: "cmd", 0xe4: "rctrl", 0xe5: "rshift", 0xe6: "ralt", 0xe7: "rcmd" };
const APP_MOD_TO_HID: Record<string, number> = Object.fromEntries(Object.entries(HID_TO_APP_MOD).map(([code, name]) => [name, Number(code)]));
/** The app macro name for any key it can press, modifiers included. */
const appKeyFor = (code: number): string | undefined => HID_TO_APP_KEY[code] ?? HID_TO_APP_MOD[code];

function appToSteps(actions: AppMacroAction[]): EStep[] {
  return actions.map((a): EStep => {
    if (a.type === "down" || a.type === "up") return { type: a.type, key: APP_KEY_TO_HID[a.key] ?? APP_MOD_TO_HID[a.key] ?? kc("LSFT") };
    if (a.type !== "shortcut") return a;
    const key = APP_KEY_TO_HID[a.key] ?? kc("A");
    return a.mods.length ? { type: "shortcut", mods: a.mods.map((m) => HID_FOR_MOD[m]), key } : { type: "tap", key };
  });
}

function stepsToApp(steps: EStep[]): AppMacroAction[] {
  const out: AppMacroAction[] = [];
  for (const s of steps) {
    if (s.type === "tap" && HID_TO_APP_MOD[s.key]) {
      // Tapping a modifier on its own: press and release it.
      out.push({ type: "down", key: HID_TO_APP_MOD[s.key] }, { type: "up", key: HID_TO_APP_MOD[s.key] });
    } else if (s.type === "tap" || s.type === "shortcut") {
      const key = HID_TO_APP_KEY[s.key];
      if (!key) continue;
      const mods = s.type === "shortcut" ? [...new Set(s.mods.map((m) => MOD_FOR_HID[m]).filter(Boolean))] : [];
      out.push({ type: "shortcut", mods, key });
    } else if (s.type === "down" || s.type === "up") {
      const key = appKeyFor(s.key);
      if (key) out.push({ type: s.type, key });
    } else if (s.type === "text" || s.type === "delay" || s.type === "open" || s.type === "shell") out.push(s);
  }
  return out;
}

/** Steps the app can run; keys it can't press are dropped. */
function forApp(steps: MacroStep[]): { steps: EStep[]; dropped: number } {
  let dropped = 0;
  const out: EStep[] = [];
  for (const s of steps) {
    if (s.type === "tap" || s.type === "down" || s.type === "up" ? appKeyFor(s.key) : s.type === "shortcut" ? HID_TO_APP_KEY[s.key] : false) out.push(s);
    else if (s.type === "text" || s.type === "delay") out.push(s);
    else dropped++;
  }
  return { steps: out, dropped };
}

/** App macro editor host: edits locally and saves to settings shortly after each change. */
function AppWorkbench({ macro, ...shared }: { macro: AppMacro } & SharedProps) {
  const appMacros = useStudio((s) => s.settings.appMacros);
  const status = useStudio((s) => s.appMacroStatus);
  const [steps, setSteps] = useState<EStep[]>(() => appToSteps(macro.actions));
  const pending = useRef<EStep[] | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const flush = async () => {
    window.clearTimeout(timer.current);
    if (!pending.current) return;
    const actions = stepsToApp(pending.current);
    pending.current = null;
    await updateSettings({ appMacros: getState().settings.appMacros.map((m) => (m.id === macro.id ? { ...m, actions } : m)) });
  };
  useEffect(() => () => void flush(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const onChange = (next: EStep[]) => {
    setSteps(next);
    pending.current = next;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), 400);
  };
  const failed = status?.failed.find((f) => f.id === macro.id);

  return (
    <Workbench
      mode="app"
      selected={{ kind: "app", id: macro.id }}
      steps={steps}
      onChange={onChange}
      title={macro.name}
      onRename={(name) => name.trim() && void updateSettings({ appMacros: appMacros.map((m) => (m.id === macro.id ? { ...m, name: name.trim() } : m)) })}
      banners={
        <>
          {failed && <p className="banner warn">Another app already uses this macro's trigger ({failed.accelerator}). Delete and recreate the macro to get a free one.</p>}
          {status?.accessibility === "denied" && (
            <p className="banner warn">
              macOS needs to allow Keychron Studio under Privacy & Security → Accessibility before it can type or press keys.{" "}
              <Button small onClick={() => void host.requestAccessibility().then((st) => setState({ appMacroStatus: st }))}>
                Allow access…
              </Button>
            </p>
          )}
        </>
      }
      note={`The key sends ${triggerAccelerator(macro.trigger).replace(/\+/g, " + ")}, which this app turns into these steps while it runs (it can stay in the menu bar).`}
      footer={
        <>
          <Button
            kind="ghost"
            onClick={() => {
              if (!window.confirm(`Delete “${macro.name}”? Keys set to it will stop working.`)) return;
              pending.current = null;
              void updateSettings({ appMacros: appMacros.filter((m) => m.id !== macro.id) });
              shared.onSelect({ kind: "onboard", index: 0 });
            }}
          >
            Delete
          </Button>
          <Button
            disabled={!steps.length}
            onClick={async () => {
              await flush();
              await host.runAppMacro(macro.id).catch((e) => toast(errorMessage(e), "error"));
            }}
          >
            <Icon name="play" size={13} /> Test run
          </Button>
        </>
      }
      {...shared}
    />
  );
}

// --- the editor + key palette -----------------------------------------------------------------

interface SharedProps {
  tab: Tab;
  setTab: (t: Tab) => void;
  onSelect: (s: Selected) => void;
  selectedKey?: LayoutKey;
}

const STEP_ICON: Record<EStep["type"], keyof typeof ICONS> = { tap: "keyTap", down: "keyDown", up: "keyUp", shortcut: "combo", text: "text", delay: "clock", raw: "code", open: "open", shell: "terminal" };
const STEP_KIND: Record<EStep["type"], string> = { tap: "Tap", down: "Hold", up: "Release", shortcut: "Shortcut", text: "Type", delay: "Wait", raw: "Data", open: "Open", shell: "Command" };

const ADD_STEPS: { label: string; icon: keyof typeof ICONS; title: string; modes: Mode[]; make: () => EStep }[] = [
  { label: "Tap", icon: "keyTap", title: "Press and release a key", modes: ["onboard", "app"], make: () => ({ type: "tap", key: kc("ENT") }) },
  { label: "Hold", icon: "keyDown", title: "Press a key and keep it down", modes: ["onboard", "app"], make: () => ({ type: "down", key: kc("LSFT") }) },
  { label: "Release", icon: "keyUp", title: "Let go of a held key", modes: ["onboard", "app"], make: () => ({ type: "up", key: kc("LSFT") }) },
  { label: "Shortcut", icon: "combo", title: "Modifiers held around one key, e.g. ⌘C", modes: ["onboard", "app"], make: () => ({ type: "shortcut", mods: [kc("LGUI")], key: kc("C") }) },
  { label: "Text", icon: "text", title: "Type some text", modes: ["onboard", "app"], make: () => ({ type: "text", text: "" }) },
  { label: "Wait", icon: "clock", title: "Pause before the next step", modes: ["onboard", "app"], make: () => ({ type: "delay", ms: 100 }) },
  { label: "Open", icon: "open", title: "Open a website, file or app", modes: ["app"], make: () => ({ type: "open", target: "" }) },
  { label: "Command", icon: "terminal", title: "Run a shell command", modes: ["app"], make: () => ({ type: "shell", command: "" }) },
];

function Workbench({
  mode,
  selected,
  steps,
  onChange,
  title,
  onRename,
  footer,
  banners,
  note,
  tab,
  setTab,
  onSelect,
}: {
  mode: Mode;
  selected: Selected;
  steps: EStep[];
  onChange: (s: EStep[]) => void;
  title: string;
  onRename: (name: string) => void;
  footer: React.ReactNode;
  banners?: React.ReactNode;
  note?: string;
} & SharedProps) {
  const [active, setActive] = useState<number | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [addKind, setAddKind] = useState<AddKind>("tap");
  const [delayMode, setDelayMode] = useState<DelayMode>("none");
  const [fixedMs, setFixedMs] = useState(50);
  const codeInsert = useRef<((text: string) => void) | null>(null);
  const isApp = mode === "app";

  const append = (more: MacroStep[]) => {
    if (!more.length) return;
    if (!isApp) return onChange([...steps, ...more]);
    const { steps: usable, dropped } = forApp(more);
    if (dropped) toast(`${dropped} step${dropped === 1 ? "" : "s"} left out: app macros can't press those keys.`);
    onChange([...steps, ...usable]);
  };
  const recorder = useRecorder(delayMode, fixedMs, append);

  const update = (i: number, step: EStep) => onChange(steps.map((s, j) => (j === i ? step : s)));
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
  const activeStep = active !== null ? steps[active] : undefined;
  const editsKey = hasKey(activeStep);

  /** A key clicked in the palette: insert into code, edit the active step, or add a new step. */
  const pickKey = (key: number) => {
    if (tab === "code") {
      const name = keycodeName(key);
      codeInsert.current?.(addKind === "tap" || isApp ? `{${name}}` : `{${addKind === "down" ? "+" : "-"}${name}}`);
      return;
    }
    const usable = !isApp || appKeyFor(key) !== undefined;
    if (editsKey && active !== null) {
      const s = activeStep;
      if (isModifierKey(key) && (s.type === "tap" || s.type === "shortcut")) {
        // Modifiers clicked while a tap or shortcut is selected are added to (or removed from) it.
        const mods = s.type === "shortcut" ? s.mods : [];
        const next = mods.includes(key) ? mods.filter((m) => m !== key) : [...mods, key];
        update(active, next.length ? { type: "shortcut", mods: next, key: s.key } : { type: "tap", key: s.key });
        return;
      }
      if (!usable || (isApp && s.type === "shortcut" && !HID_TO_APP_KEY[key])) return void toast("App macros can't press that key");
      update(active, { ...s, key });
      return;
    }
    if (!usable) return void toast("App macros can't press that key");
    onChange([...steps, { type: addKind, key }]);
  };

  const hint =
    tab === "code"
      ? "Click a key to insert its code at the cursor."
      : editsKey && active !== null
        ? `Changes the key in step ${active + 1}. Modifiers are added to it.`
        : isApp
          ? "Click a key to add it as a step."
          : undefined;

  const badge = selected.kind === "onboard" ? `M${String(selected.index).padStart(2, "0")}` : null;
  const codeBlocked = isApp && steps.some((s) => s.type === "open" || s.type === "shell");

  return (
    <>
      <section className="macro-editor">
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
            <span className={`slot-badge big${badge ? " on" : " is-app"}`}>{badge ?? <Icon name="bolt" size={15} />}</span>
            <CommitInput className="title-input" placeholder={badge ? `Name this macro (Macro ${(selected as { index: number }).index})` : "Name this macro"} value={title} onCommit={onRename} />
            <MacroSwitcher selected={selected} onSelect={onSelect} />
          </header>
          {banners}

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
                  ).map(([value, label, hintText]) => (
                    <label key={value} className={`radio${delayMode === value ? " on" : ""}`}>
                      <input type="radio" name="delay" checked={delayMode === value} onChange={() => setDelayMode(value)} disabled={recorder.recording} />
                      <span>
                        {label}
                        <small>{hintText}</small>
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
                <div className="steps-scroll">
                  <ol className="steps">
                    {steps.map((step, i) => (
                      <li key={i} className={`step${active === i ? " active" : ""}${checked.has(i) ? " checked" : ""}`} onClick={() => setActive(active === i ? null : i)}>
                        <input type="checkbox" className="step-check" checked={checked.has(i)} onClick={(e) => e.stopPropagation()} onChange={() => toggleCheck(i)} />
                        <span className="step-index">{i + 1}</span>
                        <span className={`step-icon step-${step.type}`} title={STEP_KIND[step.type]}>
                          <Icon name={STEP_ICON[step.type]} size={16} />
                        </span>
                        <div className="step-body" onClick={(e) => e.target !== e.currentTarget && e.stopPropagation()}>
                          <StepEditor mode={mode} step={step} onChange={(s) => update(i, s)} />
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
                  <div className={`add-steps add-${mode}`}>
                    {ADD_STEPS.filter((a) => a.modes.includes(mode)).map((a) => (
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
                  {note && <p className="steps-note muted small">{note}</p>}
                </div>
              </div>
            </div>
          ) : codeBlocked ? (
            <div className="code-blocked">
              <Empty title="This macro can't be shown as code" icon="code">
                Open and Command steps have no code form. Edit this macro under Steps, or remove those steps to use code.
              </Empty>
            </div>
          ) : (
            <CodeEditor
              steps={steps as MacroStep[]}
              onApply={(next) => {
                if (!isApp) return onChange(next);
                const { steps: usable, dropped } = forApp(next);
                if (dropped) toast(`${dropped} step${dropped === 1 ? "" : "s"} left out: app macros can't press those keys.`);
                onChange(usable);
              }}
              insertRef={codeInsert}
            />
          )}

          <EditorFooter isApp={isApp} bytes={isApp ? undefined : encodeMacroSteps(steps as MacroStep[]).length} extra={footer} />
        </div>
      </section>
      <KeyPalette onPick={pickKey} addKind={addKind} setAddKind={setAddKind} hint={hint} showKind={!editsKey} />
    </>
  );
}

function EditorFooter({ bytes, extra, isApp }: { bytes?: number; extra?: React.ReactNode; isApp: boolean }) {
  return (
    <footer className="editor-footer">
      <span className="muted small">{isApp ? "Changes to app macros are saved as you make them." : "Step changes stay in this app until you save them to the keyboard."}</span>
      <span className="spacer" />
      {bytes !== undefined && <span className="muted small">{bytes} bytes</span>}
      {extra}
    </footer>
  );
}

// --- assign panel (beside the keyboard) ------------------------------------------------------

function AssignPanel({ code, badge, name, steps, isApp, selectedKey }: { code: number; badge: string | null; name: string; steps: EStep[]; isApp: boolean; selectedKey?: LayoutKey }) {
  const kb = useStudio((s) => s.kb)!;
  const model = useStudio((s) => s.model)!;
  const layer = useStudio((s) => s.layer);
  const ctx = useStudio((s) => labelContext(s));
  const appMacros = useStudio((s) => s.settings.appMacros);
  const layerName = (l: number) => model.layerNames[l] ?? `Layer ${l}`;
  const usedOn = useMemo(() => {
    const found: { layer: number; key: LayoutKey }[] = [];
    kb.keymap.forEach((l, li) => {
      for (const key of model.layout.keys) if (key.row >= 0 && l[key.row * kb.cols + key.col] === code) found.push({ layer: li, key });
    });
    return found;
  }, [code, kb, model]);
  const index = selectedKey ? selectedKey.row * kb.cols + selectedKey.col : -1;
  const keyCode = selectedKey ? kb.keymap[layer][index] : undefined;
  const current = keyCode !== undefined ? keyLabel(keyCode, ctx, appMacros) : undefined;
  const factory = selectedKey ? model.defaults?.layers[layer]?.[index] : undefined;
  const assigned = keyCode === code;

  return (
    <aside className="assign-panel">
      <span className="assign-label">Macro</span>
      <div className="assign-macro">
        <span className={`slot-badge${badge ? " on" : " is-app"}`}>{badge ?? <Icon name="bolt" size={14} />}</span>
        <span className="assign-macro-text">
          <strong>{name || "Untitled"}</strong>
          <KeyCaps steps={steps} max={3} />
        </span>
      </div>

      <span className="assign-label">Key</span>
      {selectedKey && current ? (
        <div className="assign-key">
          <kbd className="kcap big">{current.label || "—"}</kbd>
          <span>
            <strong>{current.title || "Nothing"}</strong>
            <small>{layerName(layer)} layer</small>
          </span>
        </div>
      ) : (
        <p className="assign-empty">Click a key on the keyboard</p>
      )}

      {assigned ? (
        <div className="assign-done">
          <Icon name="check" size={14} /> On this key
          {factory !== undefined && factory !== code && (
            <button className="link-btn" onClick={() => void assignKey(layer, selectedKey!.row, selectedKey!.col, factory)}>
              Reset key
            </button>
          )}
        </div>
      ) : (
        <Button kind="primary" disabled={!selectedKey} onClick={() => selectedKey && void assignKey(layer, selectedKey.row, selectedKey.col, code).then((ok) => ok && toast(`${badge ?? name} is now on this key`, "success"))}>
          Assign {badge ?? "macro"} to key
        </Button>
      )}

      <div className="assign-used">
        {usedOn.length ? (
          <>
            <span className="muted small">Already on</span>
            {usedOn.slice(0, 4).map((u) => (
              <button key={`${u.layer}-${u.key.id}`} className="chip" onClick={() => setState({ layer: u.layer, selection: { kind: "key", id: u.key.id } })} title="Select this key">
                {keyLabel(model.defaults?.layers[0]?.[u.key.row * kb.cols + u.key.col] ?? 0, ctx, appMacros).title || `Key ${u.key.id}`} <small>{layerName(u.layer)}</small>
              </button>
            ))}
          </>
        ) : (
          <span className="muted small">Not on any key yet</span>
        )}
      </div>
      {isApp && <p className="muted small assign-note">Works while Keychron Studio is running.</p>}
    </aside>
  );
}

const MODIFIERS = [kc("LCTL"), kc("LALT"), kc("LSFT"), kc("LGUI")];

const APP_MOD_CODES = Object.keys(HID_TO_APP_MOD).map(Number);

function AppKeySelect({ value, onChange, modifiers }: { value: number; onChange: (code: number) => void; modifiers?: boolean }) {
  const platform = useStudio((s) => labelContext(s).platform);
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {(modifiers ? [...APP_MOD_CODES, ...APP_KEY_CODES] : APP_KEY_CODES).map((c) => (
        <option key={c} value={c}>
          {describe(c, { platform }).title}
        </option>
      ))}
    </select>
  );
}

function StepEditor({ mode, step, onChange }: { mode: Mode; step: EStep; onChange: (s: EStep) => void }) {
  const platform = useStudio((s) => labelContext(s).platform);
  const KeySelect = mode === "app" ? AppKeySelect : BasicKeySelect;
  switch (step.type) {
    case "text": {
      const bad = mode === "onboard" ? untypeableCharacters(step.text) : [];
      return (
        <>
          <input className="grow" value={step.text} placeholder={mode === "app" ? "Any text, emoji or accents" : "Text to type"} onChange={(e) => onChange({ type: "text", text: e.target.value })} />
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
            {MODIFIERS.map((m) => {
              const on = step.mods.includes(m) || step.mods.includes(m + 4);
              return (
                <button
                  key={m}
                  className={`mod${on ? " on" : ""}`}
                  onClick={() => {
                    const mods = on ? step.mods.filter((x) => x !== m && x !== m + 4) : [...step.mods, m];
                    onChange(mods.length ? { ...step, mods } : { type: "tap", key: step.key });
                  }}
                >
                  {describe(m, { platform }).label}
                </button>
              );
            })}
          </div>
          <span className="plus">+</span>
          <KeySelect value={step.key} onChange={(key) => onChange({ ...step, key })} />
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
          {mode === "app" ? <AppKeySelect modifiers value={step.key} onChange={(key) => onChange({ ...step, key })} /> : <BasicKeySelect value={step.key} onChange={(key) => onChange({ ...step, key })} />}
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
    case "open":
      return <input className="grow" value={step.target} placeholder="https://…, a file, or an app name such as Safari" onChange={(e) => onChange({ type: "open", target: e.target.value })} />;
    case "shell":
      return <input className="grow mono" value={step.command} placeholder="Shell command" onChange={(e) => onChange({ type: "shell", command: e.target.value })} />;
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

// --- key palette ---------------------------------------------------------------------------------

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
/** Left and right modifiers side by side: Control, Option/Alt, Shift, Command/Win. */
const MODIFIER_ROWS: [number, number][] = [
  [kc("LCTL"), kc("RCTL")],
  [kc("LALT"), kc("RALT")],
  [kc("LSFT"), kc("RSFT")],
  [kc("LGUI"), kc("RGUI")],
];
const PALETTE: { title: string; codes: number[] }[] = [
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
  const matches = (c: number) => {
    if (!q) return true;
    const d = describe(c, { platform });
    return `${d.title} ${d.label} ${keycodeName(c)}`.toLowerCase().includes(q);
  };
  const groups = PALETTE.map((g) => ({ ...g, codes: g.codes.filter(matches) })).filter((g) => g.codes.length);
  const modRows = MODIFIER_ROWS.map((row) => row.filter(matches)).filter((row) => row.length);
  const key = (c: number, label?: string) => {
    const d = describe(c, { platform });
    const text = label ?? d.label;
    return (
      <button key={c} className={`pkey${text.length > 3 ? " wide" : ""}`} title={`${d.title} · ${keycodeName(c)}`} onClick={() => onPick(c)}>
        {text}
      </button>
    );
  };
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
        {modRows.length > 0 && (
          <div className="palette-group">
            <h4>Modifiers</h4>
            <div className="mod-table">
              <span className="mod-side">Left</span>
              <span className="mod-side">Right</span>
              {modRows.flatMap((row) => row.map((c) => key(c, describe(c, { platform }).label)))}
            </div>
          </div>
        )}
        {groups.map((g) => (
          <div key={g.title} className="palette-group">
            <h4>{g.title}</h4>
            <div className="palette-grid">{g.codes.map((c) => key(c))}</div>
          </div>
        ))}
        {!groups.length && !modRows.length && <p className="muted small">No keys match “{query}”.</p>}
      </div>
    </section>
  );
}
