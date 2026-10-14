// ⌘K command palette: jump anywhere, run commands, or assign a key by name.

import { useEffect, useMemo, useRef, useState } from "react";
import { pickerCatalogue, parseKeycode } from "../../shared/keycodes";
import { setEffect } from "../actions";
import { assignCode } from "../views/Keymap";
import { exportProfile, importFile } from "../views/Profiles";
import { backupNow, connectDemo, disconnect, getState, redo, setState, undo, updateSettings, useStudio, type View } from "../store";
import { keyLabel, labelContext } from "../labels";
import { Icon } from "./ui";

interface Command {
  id: string;
  title: string;
  group: string;
  hint?: string;
  run: () => void | Promise<unknown>;
}

const VIEWS: [View, string, string][] = [
  ["keymap", "Keymap", "⌘1"],
  ["lighting", "Lighting", "⌘2"],
  ["macros", "Macros", "⌘3"],
  ["advanced", "Advanced", "⌘4"],
  ["test", "Key test", "⌘5"],
  ["profiles", "Profiles", "⌘6"],
  ["settings", "Settings", ""],
];

export function Palette() {
  const open = useStudio((s) => s.paletteOpen);
  const kb = useStudio((s) => s.kb);
  const model = useStudio((s) => s.model);
  const selection = useStudio((s) => s.selection);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
      setTimeout(() => input.current?.focus(), 0);
    }
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = VIEWS.map(([view, title, hint]) => ({ id: `view:${view}`, title: `Go to ${title}`, group: "Navigate", hint, run: () => setState({ view }) }));
    list.push(
      { id: "undo", title: "Undo", group: "Edit", hint: "⌘Z", run: undo },
      { id: "redo", title: "Redo", group: "Edit", hint: "⇧⌘Z", run: redo },
      { id: "backup", title: "Back up keyboard now", group: "Profiles", hint: "⌘B", run: () => backupNow() },
      { id: "import", title: "Import profile, VIA layout or definition…", group: "Profiles", hint: "⌘O", run: importFile },
      { id: "export", title: "Export profile…", group: "Profiles", hint: "⌘E", run: exportProfile },
      { id: "theme", title: "Toggle light / dark", group: "App", run: () => updateSettings({ theme: document.documentElement.dataset.theme === "light" ? "dark" : "light" }) },
      { id: "demo", title: getState().connection.demo ? "Leave demo keyboard" : "Open demo keyboard", group: "App", run: () => (getState().connection.demo ? disconnect() : connectDemo()) },
    );
    if (kb && model) {
      kb.keymap.forEach((_, l) => list.push({ id: `layer:${l}`, title: `Show layer: ${model.layerNames[l] ?? `Layer ${l}`}`, group: "Navigate", run: () => setState({ layer: l }) }));
      for (const e of model.effects) list.push({ id: `effect:${e.id}`, title: `Lighting effect: ${e.name}`, group: "Lighting", run: () => setEffect(e.id) });
    }
    return list;
  }, [kb, model]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    const matched = commands.filter((c) => words.every((w) => `${c.title} ${c.group}`.toLowerCase().includes(w)));
    if (kb && model && selection && q.length > 1) {
      const s = getState();
      const ctx = labelContext(s);
      const seen = new Set<number>();
      const keyResults: Command[] = [];
      const typed = parseKeycode(query, model.definition.customKeycodes);
      if (typed !== null) seen.add(typed), keyResults.push({ id: `kc:${typed}`, title: `Set key to ${keyLabel(typed, ctx, s.settings.appMacros).title}`, group: "Assign to selected key", run: () => assignCode(typed) });
      for (const c of pickerCatalogue({ layers: kb.layers, macros: kb.macros.count, customKeycodes: model.definition.customKeycodes }))
        for (const g of c.groups)
          for (const e of g.entries) {
            if (seen.has(e.code) || keyResults.length > 8) continue;
            const l = keyLabel(e.code, ctx, s.settings.appMacros);
            if (words.every((w) => `${e.title ?? ""} ${e.keywords ?? ""} ${l.title} ${l.name}`.toLowerCase().includes(w))) {
              seen.add(e.code);
              keyResults.push({ id: `kc:${e.code}`, title: `Set key to ${e.title ?? l.title}`, group: "Assign to selected key", run: () => assignCode(e.code) });
            }
          }
      return [...keyResults, ...matched].slice(0, 30);
    }
    return matched.slice(0, 30);
  }, [commands, query, kb, model, selection]);

  if (!open) return null;
  const close = () => setState({ paletteOpen: false });
  const run = (c: Command | undefined) => {
    if (!c) return;
    close();
    void c.run();
  };

  return (
    <div className="modal-backdrop palette-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog" aria-label="Command palette">
        <label className="palette-input">
          <Icon name="search" />
          <input
            ref={input}
            value={query}
            placeholder={selection ? "Search commands, or type a key to assign (e.g. “mute”)" : "Search commands…"}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
              else if (e.key === "ArrowDown") (e.preventDefault(), setIndex((i) => Math.min(results.length - 1, i + 1)));
              else if (e.key === "ArrowUp") (e.preventDefault(), setIndex((i) => Math.max(0, i - 1)));
              else if (e.key === "Enter") run(results[index]);
            }}
          />
        </label>
        <ul className="palette-list">
          {results.map((c, i) => (
            <li key={c.id}>
              <button className={i === index ? "on" : ""} onPointerMove={() => setIndex(i)} onClick={() => run(c)}>
                <span>{c.title}</span>
                <small>{c.hint ?? c.group}</small>
              </button>
            </li>
          ))}
          {!results.length && <li className="palette-empty">Nothing found</li>}
        </ul>
      </div>
    </div>
  );
}
