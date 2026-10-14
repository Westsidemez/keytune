// Macro files from Keychron Launcher ("<Keyboard> Macro.json") and similar tools.
//
// Launcher's export is its internal list: one array per macro slot, each step
// [type, keyName, keycodeName] with type 1 tap, 2 press, 3 release, 4 delay
// ([4, ms]), 5 text ([5, "text"]) and 6 chord ([6, ["KC_A", "KC_B"]]).

import { decodeMacro, encodeActions, type MacroAction } from "./macros";
import { keycodeName, parseKeycode } from "./keycodes";
import { viaTextToMacro } from "./profile";

export interface ImportedMacros {
  macros: Uint8Array[];
  names: (string | null)[];
  /** Key names that couldn't be understood; those steps were left out. */
  unknown: string[];
  source: "launcher" | "via-code" | "studio";
}

const TAP = 1;
const DOWN = 2;
const UP = 3;
const DELAY = 4;
const TEXT = 5;
const CHORD = 6;

function keyOf(names: unknown[], unknown: Set<string>): number | null {
  for (const n of names) {
    if (typeof n !== "string" || !n.trim()) continue;
    const code = parseKeycode(n.trim().toUpperCase().startsWith("KC_") ? n.trim().toUpperCase() : n.trim());
    if (code !== null && code >= 0x04 && code <= 0xff) return code;
  }
  const label = names.find((n) => typeof n === "string" && n) as string | undefined;
  unknown.add(label ?? JSON.stringify(names));
  return null;
}

function launcherMacro(steps: unknown[], unknown: Set<string>): Uint8Array {
  const actions: MacroAction[] = [];
  for (const step of steps) {
    if (!Array.isArray(step)) continue;
    const [type, a, b] = step as [unknown, unknown, unknown];
    if (type === DELAY) {
      const ms = Math.round(Number(a));
      if (ms > 0) actions.push({ type: "delay", ms: Math.min(ms, 60_000) });
    } else if (type === TEXT) {
      if (typeof a === "string" && a) actions.push({ type: "text", text: a });
    } else if (type === TAP || type === DOWN || type === UP) {
      const key = keyOf([b, a], unknown);
      if (key === null) continue;
      actions.push({ type: type === TAP ? "tap" : type === DOWN ? "down" : "up", key });
    } else if (type === CHORD && Array.isArray(a)) {
      const keys = a.map((n) => keyOf([n], unknown)).filter((k): k is number => k !== null);
      keys.forEach((key) => actions.push({ type: "down", key }));
      [...keys].reverse().forEach((key) => actions.push({ type: "up", key }));
    }
  }
  return encodeActions(actions);
}

const isLauncherList = (v: unknown): v is unknown[][] => Array.isArray(v) && v.every((m) => Array.isArray(m) && m.every((s) => Array.isArray(s)));

/** Recognise a macro file; returns null when the data isn't one. */
export function parseMacroFile(value: unknown): ImportedMacros | null {
  const unknown = new Set<string>();
  const done = (macros: Uint8Array[], names: (string | null)[], source: ImportedMacros["source"]): ImportedMacros => ({ macros, names, unknown: [...unknown], source });

  if (isLauncherList(value)) return done(value.map((m) => launcherMacro(m, unknown)), value.map(() => null), "launcher");

  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    // Launcher's mouse-style export: { md5, macro, name }.
    if (isLauncherList(o.macro)) return done(o.macro.map((m) => launcherMacro(m, unknown)), o.macro.map(() => null), "launcher");
    // { macros: [{ index, name, code }] } with VIA-style code text.
    if (Array.isArray(o.macros) && o.macros.every((m) => m && typeof m === "object" && typeof (m as { code?: unknown }).code === "string")) {
      const list = o.macros as { index?: number; name?: string; code: string }[];
      const size = Math.max(list.length, ...list.map((m) => (m.index ?? -1) + 1));
      const macros: Uint8Array[] = Array.from({ length: size }, () => new Uint8Array());
      const names: (string | null)[] = Array(size).fill(null);
      list.forEach((m, i) => {
        const at = m.index ?? i;
        macros[at] = viaTextToMacro(m.code);
        names[at] = m.name?.trim() || null;
      });
      return done(macros, names, "via-code");
    }
  }

  // A plain list of VIA macro strings (the "macros" field of a VIA layout file).
  if (Array.isArray(value) && value.every((m) => typeof m === "string")) return done(value.map((m) => viaTextToMacro(m)), value.map(() => null), "via-code");
  return null;
}

/** Export macros in Launcher's format so they can go back into Keychron Launcher. */
export function toLauncherMacros(macros: Uint8Array[]): unknown[][] {
  return macros.map((bytes) =>
    decodeMacro(bytes).flatMap((a): unknown[][] => {
      switch (a.type) {
        case "tap":
          return [[TAP, keycodeName(a.key), keycodeName(a.key)]];
        case "down":
          return [[DOWN, keycodeName(a.key), keycodeName(a.key)]];
        case "up":
          return [[UP, keycodeName(a.key), keycodeName(a.key)]];
        case "delay":
          return [[DELAY, a.ms]];
        case "text":
          return [[TEXT, a.text]];
        case "raw":
          return [];
      }
    }),
  );
}
