// Undoable edits. Each writes to the keyboard straight away; undo writes the old value back.

import type { HSV, MixedEffect, SleepConfig, SnapClickPair } from "../shared/protocol/commands";
import { describe } from "../shared/keycodes";
import { getState, perform, setState, toast } from "./store";

function keyboard() {
  const k = getState().keyboard;
  if (!k) throw new Error("No keyboard connected");
  return k;
}

export function keyLabelFor(code: number): string {
  const s = getState();
  return describe(code, { customKeycodes: s.model?.definition.customKeycodes, layerNames: s.model?.layerNames }).title;
}

export async function assignKey(layer: number, row: number, col: number, code: number): Promise<boolean> {
  const k = keyboard();
  const before = k.keycodeAt(layer, row, col);
  if (before === code) return true;
  return perform(
    `Set key to ${keyLabelFor(code)}`,
    () => k.setKeycode(layer, row, col, code),
    () => k.setKeycode(layer, row, col, before),
  );
}

export async function assignEncoder(layer: number, index: number, clockwise: boolean, code: number): Promise<boolean> {
  const k = keyboard();
  const before = k.state.encoders[layer]?.[index]?.[clockwise ? 1 : 0];
  if (before === undefined) throw new Error("This knob can't be remapped");
  if (before === code) return true;
  return perform(
    `Set knob ${clockwise ? "right" : "left"} to ${keyLabelFor(code)}`,
    () => k.setEncoder(layer, index, clockwise, code),
    () => k.setEncoder(layer, index, clockwise, before),
  );
}

/** Swap two keys on a layer (drag one key onto another with ⌥). */
export async function swapKeys(layer: number, a: [number, number], b: [number, number]): Promise<boolean> {
  const k = keyboard();
  const ca = k.keycodeAt(layer, ...a);
  const cb = k.keycodeAt(layer, ...b);
  return perform(
    "Swap keys",
    async () => {
      await k.setKeycode(layer, a[0], a[1], cb);
      await k.setKeycode(layer, b[0], b[1], ca);
    },
    async () => {
      await k.setKeycode(layer, a[0], a[1], ca);
      await k.setKeycode(layer, b[0], b[1], cb);
    },
  );
}

export async function writeKeymap(label: string, keymap: number[][]): Promise<boolean> {
  const k = keyboard();
  const before = k.state.keymap.map((l) => l.slice());
  return perform(label, () => k.writeKeymap(keymap), () => k.writeKeymap(before));
}

export async function writeMacros(data: Uint8Array[]): Promise<boolean> {
  const k = keyboard();
  const before = k.state.macros.data.map((m) => m.slice());
  return perform("Save macros", () => k.writeMacros(data), () => k.writeMacros(before));
}

// --- lighting ------------------------------------------------------------------------

let saveTimer: ReturnType<typeof setTimeout> | undefined;

/** Per-key, zone and indicator changes are saved to flash shortly after the last edit. */
export function scheduleLightingSave(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    getState()
      .keyboard?.saveKeychronLighting()
      .catch((error) => toast(`Could not save lighting: ${error instanceof Error ? error.message : error}`, "error"));
  }, 800);
}

export async function setEffect(effect: number): Promise<boolean> {
  const k = keyboard();
  const before = k.state.lighting?.effect ?? 0;
  if (before === effect) return true;
  return perform("Change effect", () => k.setEffect(effect), () => k.setEffect(before));
}

/** Slider value: `persist` false while dragging (preview only), true on release (undoable). */
export async function setLightingValue(kind: "brightness" | "speed", value: number, persist: boolean, startValue?: number): Promise<void> {
  const k = keyboard();
  const apply = (v: number, p: boolean) => (kind === "brightness" ? k.setBrightness(v, p) : k.setSpeed(v, p));
  if (!persist) {
    await apply(value, false).catch(() => undefined);
    return;
  }
  const before = startValue ?? k.state.lighting?.[kind] ?? 0;
  await perform(kind === "brightness" ? "Change brightness" : "Change speed", () => apply(value, true), () => apply(before, true));
}

export async function setColor(hsv: { h: number; s: number }, persist: boolean, start?: { h: number; s: number }): Promise<void> {
  const k = keyboard();
  if (!persist) {
    await k.setColor(hsv.h, hsv.s, false).catch(() => undefined);
    return;
  }
  const l = k.state.lighting;
  const before = start ?? { h: l?.hue ?? 0, s: l?.sat ?? 0 };
  await perform("Change colour", () => k.setColor(hsv.h, hsv.s, true), () => k.setColor(before.h, before.s, true));
}

async function ensureEffect(mode: number | undefined): Promise<void> {
  const k = keyboard();
  if (mode === undefined || k.state.lighting?.effect === mode) return;
  await k.setEffect(mode);
}

/** Colour a set of keys (by LED index). One undo step per brush stroke. */
export async function paintKeys(changes: Map<number, HSV>, before: Map<number, HSV>, effectBefore = keyboard().state.lighting?.effect ?? 0): Promise<boolean> {
  const k = keyboard();
  const model = getState().model;
  const ok = await perform(
    "Paint keys",
    async () => {
      await ensureEffect(model?.perKeyMode);
      await k.setPerKeyColors(changes);
    },
    async () => {
      await k.setPerKeyColors(before);
      if (effectBefore !== k.state.lighting?.effect) await k.setEffect(effectBefore);
    },
  );
  scheduleLightingSave();
  return ok;
}

export async function setPerKeyType(type: number): Promise<boolean> {
  const k = keyboard();
  const before = k.state.lighting?.perKey?.type ?? 0;
  const ok = await perform("Change key effect", () => k.setPerKeyType(type), () => k.setPerKeyType(before));
  scheduleLightingSave();
  return ok;
}

export async function assignZones(changes: Map<number, number>, before: Map<number, number>, effectBefore = keyboard().state.lighting?.effect ?? 0): Promise<boolean> {
  const k = keyboard();
  const model = getState().model;
  const ok = await perform(
    "Paint zones",
    async () => {
      await ensureEffect(model?.mixedMode);
      await k.setMixedRegions(changes);
    },
    async () => {
      await k.setMixedRegions(before);
      if (effectBefore !== k.state.lighting?.effect) await k.setEffect(effectBefore);
    },
  );
  scheduleLightingSave();
  return ok;
}

export async function setZoneEffects(region: number, effects: MixedEffect[]): Promise<boolean> {
  const k = keyboard();
  const model = getState().model;
  const before = k.state.lighting?.mixed?.zones[region]?.map((e) => ({ ...e })) ?? [];
  const effectBefore = k.state.lighting?.effect ?? 0;
  const ok = await perform(
    "Edit zone effects",
    async () => {
      await ensureEffect(model?.mixedMode);
      await k.setMixedZone(region, effects);
    },
    async () => {
      await k.setMixedZone(region, before);
      if (effectBefore !== k.state.lighting?.effect) await k.setEffect(effectBefore);
    },
  );
  scheduleLightingSave();
  return ok;
}

export async function setIndicators(disabled: number, hsv: HSV): Promise<boolean> {
  const k = keyboard();
  const current = k.state.lighting?.indicators;
  if (!current) return false;
  const before = { disabled: current.disabled, hsv: { ...current.hsv } };
  const ok = await perform("Change indicators", () => k.setIndicators(disabled, hsv), () => k.setIndicators(before.disabled, before.hsv));
  scheduleLightingSave();
  return ok;
}

// --- advanced ------------------------------------------------------------------------

export async function setDebounce(type: number, time: number): Promise<boolean> {
  const k = keyboard();
  const before = k.state.advanced.debounce;
  if (!before) return false;
  return perform("Change debounce", () => k.setDebounce(type, time), () => k.setDebounce(before.type, before.time));
}

export async function setSnapClicks(pairs: SnapClickPair[]): Promise<boolean> {
  const k = keyboard();
  const before = k.state.advanced.snapClicks?.map((p) => ({ type: p.type, keys: [...p.keys] as [number, number] })) ?? [];
  return perform("Change Snap Click", () => k.setSnapClicks(pairs), () => k.setSnapClicks(before));
}

export async function setSleep(config: SleepConfig): Promise<boolean> {
  const k = keyboard();
  const before = k.state.advanced.sleep;
  if (!before) return false;
  return perform("Change sleep timers", () => k.setSleep(config), () => k.setSleep(before));
}

export async function setNkro(enabled: boolean): Promise<boolean> {
  const k = keyboard();
  return perform(enabled ? "Turn on NKRO" : "Turn off NKRO", () => k.setNkro(enabled), () => k.setNkro(!enabled));
}

export function selectKey(id: string | null): void {
  setState({ selection: id ? { kind: "key", id } : null });
}
