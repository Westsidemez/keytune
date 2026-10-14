// Onboard macro encoding (QMK send_string format, as stored by VIA).
//
// The macro buffer holds NUL-terminated strings, one per macro slot. Inside a
// macro, printable ASCII is typed as-is; 0x01 starts an action:
//   01 01 kc   tap kc          01 02 kc   press kc
//   01 03 kc   release kc      01 04 <digits> '|'   wait <digits> ms

import { isModifierKey } from "./keycodes";

export const SS_PREFIX = 0x01;
export const SS_TAP = 0x01;
export const SS_DOWN = 0x02;
export const SS_UP = 0x03;
export const SS_DELAY = 0x04;
const DELAY_END = 0x7c; // '|'

export type MacroAction =
  | { type: "tap"; key: number }
  | { type: "down"; key: number }
  | { type: "up"; key: number }
  | { type: "delay"; ms: number }
  | { type: "text"; text: string }
  /** Bytes this app does not understand; kept so the macro round-trips unchanged. */
  | { type: "raw"; bytes: number[] };

/** Editor steps: actions plus a readable shortcut (modifiers held around one key). */
export type MacroStep = MacroAction | { type: "shortcut"; mods: number[]; key: number };

export const MAX_DELAY_MS = 60_000;

/** Characters the keyboard can type itself (US layout, as QMK sends them). */
export function isTypeable(char: string): boolean {
  const c = char.charCodeAt(0);
  return char.length === 1 && ((c >= 0x20 && c <= 0x7e) || c === 0x0a || c === 0x09);
}

export function untypeableCharacters(text: string): string[] {
  return [...new Set([...text].filter((ch) => !isTypeable(ch)))];
}

// --- buffer <-> macros ---------------------------------------------------------

/** Split the device buffer into `count` macros (bytes without the terminator). */
export function splitMacroBuffer(buffer: Uint8Array, count: number): Uint8Array[] {
  const macros: Uint8Array[] = [];
  let start = 0;
  for (let i = 0; i < count; i++) {
    if (start >= buffer.length) {
      macros.push(new Uint8Array());
      continue;
    }
    let end = buffer.indexOf(0, start);
    if (end < 0) end = buffer.length;
    macros.push(buffer.slice(start, end));
    start = end + 1;
  }
  return macros;
}

export function macroBufferBytes(macros: Uint8Array[]): number {
  return macros.reduce((sum, m) => sum + m.length + 1, 0);
}

/** Pack macros into a zero-filled buffer of the device's size. */
export function joinMacroBuffer(macros: Uint8Array[], size: number): Uint8Array {
  const used = macroBufferBytes(macros);
  if (used > size) throw new Error(`Macros need ${used} bytes but the keyboard stores ${size}`);
  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const m of macros) {
    if (m.includes(0)) throw new Error("A macro cannot contain a zero byte");
    buffer.set(m, offset);
    offset += m.length + 1;
  }
  return buffer;
}

/** Length of the buffer prefix that holds data (the rest is padding). */
export function usedMacroLength(macros: Uint8Array[]): number {
  return macroBufferBytes(macros);
}

// --- bytes <-> actions ------------------------------------------------------------

export function decodeMacro(bytes: Uint8Array): MacroAction[] {
  const actions: MacroAction[] = [];
  let text = "";
  const flush = () => {
    if (text) actions.push({ type: "text", text });
    text = "";
  };
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b !== SS_PREFIX) {
      text += String.fromCharCode(b);
      continue;
    }
    flush();
    const code = bytes[i + 1];
    if ((code === SS_TAP || code === SS_DOWN || code === SS_UP) && i + 2 < bytes.length) {
      const key = bytes[i + 2];
      actions.push({ type: code === SS_TAP ? "tap" : code === SS_DOWN ? "down" : "up", key });
      i += 2;
    } else if (code === SS_DELAY) {
      let j = i + 2;
      let digits = "";
      while (j < bytes.length && bytes[j] >= 0x30 && bytes[j] <= 0x39) digits += String.fromCharCode(bytes[j++]);
      // Firmware consumes the character that ends the digits ('|' when VIA wrote it).
      const terminated = j < bytes.length;
      if (terminated && bytes[j] !== DELAY_END) {
        actions.push({ type: "raw", bytes: Array.from(bytes.subarray(i, j + 1)) });
      } else {
        actions.push({ type: "delay", ms: digits ? Number(digits) : 0 });
      }
      i = terminated ? j : j - 1;
    } else {
      // Firmware skips the prefix and an unknown action code.
      const end = Math.min(bytes.length, i + 2);
      actions.push({ type: "raw", bytes: Array.from(bytes.subarray(i, end)) });
      i = end - 1;
    }
  }
  flush();
  return actions;
}

export function encodeActions(actions: MacroAction[]): Uint8Array {
  const out: number[] = [];
  for (const a of actions) {
    switch (a.type) {
      case "tap":
      case "down":
      case "up":
        if (a.key <= 0 || a.key > 0xff) throw new Error(`Onboard macros can only use basic keys (got 0x${a.key.toString(16)})`);
        out.push(SS_PREFIX, a.type === "tap" ? SS_TAP : a.type === "down" ? SS_DOWN : SS_UP, a.key);
        break;
      case "delay": {
        const ms = Math.max(0, Math.min(MAX_DELAY_MS, Math.round(a.ms)));
        out.push(SS_PREFIX, SS_DELAY, ...[...String(ms)].map((c) => c.charCodeAt(0)), DELAY_END);
        break;
      }
      case "text": {
        const bad = untypeableCharacters(a.text);
        if (bad.length) throw new Error(`The keyboard cannot type ${bad.map((c) => JSON.stringify(c)).join(", ")}; use an app macro for that text`);
        for (const ch of a.text) out.push(ch.charCodeAt(0));
        break;
      }
      case "raw":
        out.push(...a.bytes);
        break;
    }
  }
  return Uint8Array.from(out);
}

// --- actions <-> editor steps --------------------------------------------------------

/** Expand editor steps into the actions stored on the keyboard. */
export function stepsToActions(steps: MacroStep[]): MacroAction[] {
  const actions: MacroAction[] = [];
  for (const step of steps) {
    if (step.type === "shortcut") {
      for (const m of step.mods) actions.push({ type: "down", key: m });
      actions.push({ type: "tap", key: step.key });
      for (const m of [...step.mods].reverse()) actions.push({ type: "up", key: m });
    } else if (step.type === "text" && actions.length && actions[actions.length - 1].type === "text") {
      const last = actions[actions.length - 1] as { type: "text"; text: string };
      last.text += step.text;
    } else {
      actions.push({ ...step } as MacroAction);
    }
  }
  return actions;
}

/**
 * Collapse low-level presses into readable steps: modifiers held around a key
 * become one shortcut, and a press immediately followed by its release becomes
 * a tap. Anything else stays as recorded.
 */
export function actionsToSteps(actions: MacroAction[]): MacroStep[] {
  const steps: MacroStep[] = [];
  let i = 0;
  while (i < actions.length) {
    const shortcut = matchShortcut(actions, i);
    if (shortcut) {
      steps.push(shortcut.step);
      i = shortcut.next;
      continue;
    }
    const a = actions[i];
    const b = actions[i + 1];
    if (a.type === "down" && b?.type === "up" && b.key === a.key) {
      steps.push({ type: "tap", key: a.key });
      i += 2;
      continue;
    }
    steps.push(a);
    i++;
  }
  return steps;
}

function matchShortcut(actions: MacroAction[], start: number): { step: MacroStep; next: number } | null {
  const mods: number[] = [];
  let i = start;
  while (i < actions.length) {
    const a = actions[i];
    if (a.type !== "down" || !isModifierKey(a.key) || mods.includes(a.key)) break;
    mods.push(a.key);
    i++;
  }
  if (mods.length === 0) return null;
  let key: number;
  const a = actions[i];
  const b = actions[i + 1];
  if (a?.type === "tap" && !isModifierKey(a.key)) {
    key = a.key;
    i += 1;
  } else if (a?.type === "down" && !isModifierKey(a.key) && b?.type === "up" && b.key === a.key) {
    key = a.key;
    i += 2;
  } else {
    return null;
  }
  const released = new Set<number>();
  while (released.size < mods.length) {
    const up = actions[i];
    if (up?.type !== "up" || !mods.includes(up.key) || released.has(up.key)) return null;
    released.add(up.key);
    i++;
  }
  return { step: { type: "shortcut", mods, key }, next: i };
}

export function decodeMacroSteps(bytes: Uint8Array): MacroStep[] {
  return actionsToSteps(decodeMacro(bytes));
}

export function encodeMacroSteps(steps: MacroStep[]): Uint8Array {
  return encodeActions(stepsToActions(steps));
}

/** Low-level press/release events a macro produces, for the "raw events" view. */
export function eventCount(steps: MacroStep[]): number {
  return stepsToActions(steps).reduce((n, a) => n + (a.type === "tap" ? 2 : a.type === "text" ? a.text.length * 2 : a.type === "raw" ? 1 : a.type === "delay" ? 0 : 1), 0);
}
