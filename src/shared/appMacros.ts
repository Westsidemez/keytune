// App macros: unlimited macros run by this app on the computer.
//
// The keyboard key is set to a trigger combination nobody types by hand
// (Hyper+F13, Meh+F13, ...). The app registers each trigger as a global
// shortcut and runs the macro's actions when it fires. The keyboard needs no
// firmware change; the macro only works while the app is running.

import { HYPER, MEH, MOD, withMods } from "./keycodes";

export type AppMacroAction =
  | { type: "text"; text: string }
  | { type: "shortcut"; mods: ShortcutMod[]; key: string }
  | { type: "delay"; ms: number }
  | { type: "open"; target: string }
  | { type: "shell"; command: string };

export type ShortcutMod = "cmd" | "ctrl" | "alt" | "shift";

export interface AppMacro {
  id: string;
  name: string;
  /** Keycode the keyboard sends to trigger this macro. */
  trigger: number;
  actions: AppMacroAction[];
}

const F13 = 0x68;
const TRIGGER_MODS = [
  HYPER,
  MEH,
  MOD.CTRL | MOD.ALT | MOD.GUI,
  MOD.CTRL | MOD.SHIFT | MOD.GUI,
  MOD.ALT | MOD.SHIFT | MOD.GUI,
  MOD.CTRL | MOD.ALT,
  MOD.CTRL | MOD.SHIFT,
  MOD.ALT | MOD.SHIFT,
];

/** Every trigger in allocation order: 8 modifier sets × F13–F24 = 96 macros. */
export const APP_TRIGGERS: number[] = TRIGGER_MODS.flatMap((mods) => Array.from({ length: 12 }, (_, i) => withMods(mods, F13 + i)));

export function isAppTrigger(code: number): boolean {
  return APP_TRIGGERS.includes(code);
}

export function nextFreeTrigger(macros: AppMacro[]): number | undefined {
  const used = new Set(macros.map((m) => m.trigger));
  return APP_TRIGGERS.find((t) => !used.has(t));
}

/** Electron accelerator for a trigger keycode, e.g. "Control+Alt+Shift+Command+F13". */
export function triggerAccelerator(code: number): string {
  const mods = (code >> 8) & 0x0f;
  const key = code & 0xff;
  if (key < F13 || key > F13 + 11) throw new Error("Not an app macro trigger");
  const parts: string[] = [];
  if (mods & MOD.CTRL) parts.push("Control");
  if (mods & MOD.ALT) parts.push("Alt");
  if (mods & MOD.SHIFT) parts.push("Shift");
  if (mods & MOD.GUI) parts.push("Super");
  parts.push(`F${13 + key - F13}`);
  return parts.join("+");
}

export function newAppMacro(macros: AppMacro[], name = "New app macro"): AppMacro {
  const trigger = nextFreeTrigger(macros);
  if (trigger === undefined) throw new Error(`All ${APP_TRIGGERS.length} app macro slots are in use`);
  return { id: `am-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, name, trigger, actions: [] };
}

export function describeAppAction(action: AppMacroAction): string {
  switch (action.type) {
    case "text":
      return action.text.length > 40 ? `Type “${action.text.slice(0, 40)}…”` : `Type “${action.text}”`;
    case "shortcut":
      return `Press ${[...action.mods.map((m) => ({ cmd: "⌘", ctrl: "⌃", alt: "⌥", shift: "⇧" })[m]), action.key.toUpperCase()].join("")}`;
    case "delay":
      return `Wait ${action.ms} ms`;
    case "open":
      return `Open ${action.target}`;
    case "shell":
      return `Run ${action.command}`;
  }
}

export function validateAppMacros(value: unknown): AppMacro[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (m): m is AppMacro => !!m && typeof m === "object" && typeof (m as AppMacro).id === "string" && typeof (m as AppMacro).trigger === "number" && Array.isArray((m as AppMacro).actions),
  );
}

/** Key names the runner understands for shortcut actions. */
export const SHORTCUT_KEYS = [
  ..."abcdefghijklmnopqrstuvwxyz0123456789".split(""),
  "return",
  "tab",
  "space",
  "delete",
  "escape",
  "forwarddelete",
  "home",
  "end",
  "pageup",
  "pagedown",
  "left",
  "right",
  "up",
  "down",
  "-",
  "=",
  "[",
  "]",
  "\\",
  ";",
  "'",
  ",",
  ".",
  "/",
  "`",
  ...Array.from({ length: 20 }, (_, i) => `f${i + 1}`),
];
