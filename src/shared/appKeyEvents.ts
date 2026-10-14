// Turns an app macro's key steps into single key-down / key-up events.
//
// Holding needs real key events: a held modifier has to be part of every later
// event until it is released, so the modifier state is tracked here and each
// event carries the modifiers that are down at that moment.

import { MODIFIER_KEYS, type AppMacroAction, type ShortcutMod } from "./appMacros";

export type KeyOp = { kind: "key"; key: string; down: boolean; mods: ShortcutMod[] } | { kind: "wait"; ms: number };

/** Steps that press keys (everything else is run separately). */
export type KeyAction = Extract<AppMacroAction, { type: "shortcut" | "down" | "up" | "delay" }>;

export const isKeyAction = (a: AppMacroAction): a is KeyAction => a.type === "shortcut" || a.type === "down" || a.type === "up" || a.type === "delay";

const ORDER: ShortcutMod[] = ["ctrl", "alt", "shift", "cmd"];

/** Keys currently held down by a running macro. */
export class HeldKeys {
  private readonly keys = new Set<string>();

  mods(extra: ShortcutMod[] = []): ShortcutMod[] {
    const set = new Set<ShortcutMod>(extra);
    for (const k of this.keys) if (MODIFIER_KEYS[k]) set.add(MODIFIER_KEYS[k]);
    return ORDER.filter((m) => set.has(m));
  }

  /** Events for a run of key steps. */
  plan(actions: KeyAction[]): KeyOp[] {
    const ops: KeyOp[] = [];
    for (const a of actions) {
      if (a.type === "delay") ops.push({ kind: "wait", ms: Math.max(0, Math.min(60_000, a.ms)) });
      else if (a.type === "down") {
        if (this.keys.has(a.key)) continue;
        this.keys.add(a.key);
        ops.push({ kind: "key", key: a.key, down: true, mods: this.mods() });
      } else if (a.type === "up") {
        if (!this.keys.delete(a.key)) continue;
        ops.push({ kind: "key", key: a.key, down: false, mods: this.mods() });
      } else {
        // A shortcut: press its modifiers that aren't already held, tap the key, let them go again.
        const extra = a.mods.filter((m) => !this.mods().includes(m));
        const pressed: ShortcutMod[] = [];
        for (const m of extra) {
          pressed.push(m);
          ops.push({ kind: "key", key: m, down: true, mods: this.mods(pressed) });
        }
        const mods = this.mods(pressed);
        ops.push({ kind: "key", key: a.key, down: true, mods }, { kind: "key", key: a.key, down: false, mods });
        for (const m of [...extra].reverse()) {
          pressed.splice(pressed.indexOf(m), 1);
          ops.push({ kind: "key", key: m, down: false, mods: this.mods(pressed) });
        }
      }
    }
    return ops;
  }

  /** Events that let go of everything still held (non-modifiers first). */
  releaseAll(): KeyOp[] {
    const keys = [...this.keys].sort((a, b) => Number(!!MODIFIER_KEYS[a]) - Number(!!MODIFIER_KEYS[b]));
    return this.plan(keys.map((key) => ({ type: "up", key })));
  }

  get size(): number {
    return this.keys.size;
  }
}
