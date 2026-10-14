// Profiles and backups: a complete, portable snapshot of a keyboard's setup,
// plus import/export of VIA's saved-layout files.

import type { Keyboard, KeyboardState, AdvancedState } from "./keyboard";
import { describe as describeKey, keycodeName, parseKeycode, type CustomKeycode } from "./keycodes";
import { decodeMacro, encodeActions, type MacroAction } from "./macros";
import type { HSV, MixedEffect, IndicatorConfig } from "./protocol/commands";

export const PROFILE_FORMAT = "keychron-studio-profile";

export interface ProfileLighting {
  brightness: number;
  effect: number;
  speed: number;
  hue: number;
  sat: number;
  perKey?: { type: number; colors: HSV[] };
  mixed?: { regions: number[]; zones: MixedEffect[][] };
  indicators?: Pick<IndicatorConfig, "disabled" | "hsv">;
}

export interface Profile {
  format: typeof PROFILE_FORMAT;
  version: 1;
  name: string;
  createdAt: string;
  keyboard: { vendorId: number; productId: number; name: string };
  keymap?: number[][];
  encoders?: [number, number][][];
  macros?: { names: (string | null)[]; data: string[] };
  lighting?: ProfileLighting;
  advanced?: Pick<AdvancedState, "debounce" | "snapClicks" | "sleep">;
}

export type ProfileSection = "keymap" | "macros" | "lighting" | "advanced";
export const ALL_SECTIONS: ProfileSection[] = ["keymap", "macros", "lighting", "advanced"];

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));

export function snapshot(state: KeyboardState, name: string, macroNames: (string | undefined)[] = []): Profile {
  const lighting = state.lighting;
  return {
    format: PROFILE_FORMAT,
    version: 1,
    name,
    createdAt: new Date().toISOString(),
    keyboard: { vendorId: state.info.vendorId, productId: state.info.productId, name: state.info.productName },
    keymap: state.keymap.map((l) => l.slice()),
    encoders: state.encoders.map((l) => l.map((e) => [...e] as [number, number])),
    macros: { names: state.macros.data.map((_, i) => macroNames[i] ?? null), data: state.macros.data.map(toHex) },
    lighting: lighting && {
      brightness: lighting.brightness,
      effect: lighting.effect,
      speed: lighting.speed,
      hue: lighting.hue,
      sat: lighting.sat,
      perKey: lighting.perKey && { type: lighting.perKey.type, colors: lighting.perKey.colors.map((c) => ({ ...c })) },
      mixed: lighting.mixed && { regions: lighting.mixed.regions.slice(), zones: lighting.mixed.zones.map((z) => z.map((e) => ({ ...e }))) },
      indicators: lighting.indicators && { disabled: lighting.indicators.disabled, hsv: { ...lighting.indicators.hsv } },
    },
    advanced: {
      debounce: state.advanced.debounce && { ...state.advanced.debounce },
      snapClicks: state.advanced.snapClicks?.map((p) => ({ type: p.type, keys: [...p.keys] as [number, number] })),
      sleep: state.advanced.sleep && { ...state.advanced.sleep },
    },
  };
}

export function parseProfile(value: unknown): Profile {
  const p = value as Profile;
  if (!p || p.format !== PROFILE_FORMAT || p.version !== 1) throw new Error("This is not a Keychron Studio profile");
  if (!p.keyboard || typeof p.keyboard.vendorId !== "number") throw new Error("Profile has no keyboard information");
  return p;
}

export function profileMacroData(profile: Profile): Uint8Array[] | undefined {
  return profile.macros?.data.map(fromHex);
}

/** Write the chosen sections of a profile to the keyboard. Only differences are sent. */
export async function applyProfile(keyboard: Keyboard, profile: Profile, sections: ProfileSection[] = ALL_SECTIONS, progress: (label: string) => void = () => {}): Promise<void> {
  const state = keyboard.state;
  if (profile.keyboard.vendorId !== state.info.vendorId || profile.keyboard.productId !== state.info.productId) {
    throw new Error(`This profile is for ${profile.keyboard.name}, not ${state.info.productName}`);
  }
  if (sections.includes("keymap") && profile.keymap) {
    progress("Writing keymap");
    await keyboard.writeKeymap(profile.keymap);
    for (let layer = 0; layer < Math.min(state.layers, profile.encoders?.length ?? 0); layer++) {
      for (let i = 0; i < profile.encoders![layer].length; i++) {
        const [ccw, cw] = profile.encoders![layer][i];
        const current = keyboard.state.encoders[layer]?.[i];
        if (!current) continue;
        if (current[0] !== ccw) await keyboard.setEncoder(layer, i, false, ccw);
        if (current[1] !== cw) await keyboard.setEncoder(layer, i, true, cw);
      }
    }
  }
  if (sections.includes("macros") && profile.macros) {
    progress("Writing macros");
    await keyboard.writeMacros(profileMacroData(profile)!);
  }
  const lighting = profile.lighting;
  const current = keyboard.state.lighting;
  if (sections.includes("lighting") && lighting && current) {
    progress("Writing lighting");
    if (lighting.perKey && current.perKey) {
      if (lighting.perKey.type !== current.perKey.type) await keyboard.setPerKeyType(lighting.perKey.type);
      const changes = new Map<number, HSV>();
      lighting.perKey.colors.forEach((c, i) => {
        const was = current.perKey!.colors[i];
        if (was && (was.h !== c.h || was.s !== c.s || was.v !== c.v)) changes.set(i, c);
      });
      if (changes.size) await keyboard.setPerKeyColors(changes);
    }
    if (lighting.mixed && current.mixed) {
      const changes = new Map<number, number>();
      lighting.mixed.regions.forEach((r, i) => {
        if (current.mixed!.regions[i] !== undefined && current.mixed!.regions[i] !== r) changes.set(i, r);
      });
      if (changes.size) await keyboard.setMixedRegions(changes);
      for (let z = 0; z < Math.min(lighting.mixed.zones.length, current.mixed.zones.length); z++) {
        if (JSON.stringify(lighting.mixed.zones[z]) !== JSON.stringify(current.mixed.zones[z])) await keyboard.setMixedZone(z, lighting.mixed.zones[z]);
      }
    }
    if (lighting.indicators && current.indicators) await keyboard.setIndicators(lighting.indicators.disabled, lighting.indicators.hsv);
    if (current.perKey || current.mixed || current.indicators) await keyboard.saveKeychronLighting();
    // The effect goes last so the keyboard switches once everything it shows is in place.
    if (lighting.brightness !== current.brightness) await keyboard.setBrightness(lighting.brightness);
    if (lighting.speed !== current.speed) await keyboard.setSpeed(lighting.speed);
    if (lighting.hue !== current.hue || lighting.sat !== current.sat) await keyboard.setColor(lighting.hue, lighting.sat);
    if (lighting.effect !== current.effect) await keyboard.setEffect(lighting.effect);
  }
  const advanced = profile.advanced;
  if (sections.includes("advanced") && advanced) {
    progress("Writing settings");
    const now = keyboard.state.advanced;
    if (advanced.debounce && now.debounce && JSON.stringify(advanced.debounce) !== JSON.stringify(now.debounce)) {
      await keyboard.setDebounce(advanced.debounce.type, advanced.debounce.time);
    }
    if (advanced.snapClicks && now.snapClicks && JSON.stringify(advanced.snapClicks) !== JSON.stringify(now.snapClicks)) {
      await keyboard.setSnapClicks(advanced.snapClicks.slice(0, now.snapClicks.length));
    }
    if (advanced.sleep && now.sleep && JSON.stringify(advanced.sleep) !== JSON.stringify(now.sleep)) await keyboard.setSleep(advanced.sleep);
  }
}

// --- VIA saved layouts ----------------------------------------------------------

export interface ViaLayoutFile {
  name: string;
  vendorProductId: number;
  macros?: string[];
  layers: string[][];
  encoders?: [string, string][][];
}

/** Format a macro in VIA's text syntax: text, {KC_X} tap, {+KC_X} press, {-KC_X} release, {100} wait, {KC_A,KC_B} chord. */
export function macroToViaText(bytes: Uint8Array): string {
  return decodeMacro(bytes)
    .map((a) => {
      switch (a.type) {
        case "text":
          return a.text.replace(/[{}\\]/g, (c) => `\\${c}`);
        case "tap":
          return `{${keycodeName(a.key)}}`;
        case "down":
          return `{+${keycodeName(a.key)}}`;
        case "up":
          return `{-${keycodeName(a.key)}}`;
        case "delay":
          return `{${a.ms}}`;
        case "raw":
          return "";
      }
    })
    .join("");
}

export function viaTextToMacro(text: string): Uint8Array {
  const actions: MacroAction[] = [];
  let plain = "";
  const flush = () => {
    if (plain) actions.push({ type: "text", text: plain });
    plain = "";
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\" && i + 1 < text.length) {
      plain += text[++i];
      continue;
    }
    if (ch !== "{") {
      plain += ch;
      continue;
    }
    const end = text.indexOf("}", i);
    if (end < 0) throw new Error("Unclosed { in macro");
    const body = text.slice(i + 1, end).trim();
    i = end;
    flush();
    if (/^\d+$/.test(body)) {
      actions.push({ type: "delay", ms: Number(body) });
      continue;
    }
    const press = body.startsWith("+");
    const release = body.startsWith("-");
    const names = (press || release ? body.slice(1) : body).split(",").map((n) => n.trim());
    const codes = names.map((n) => {
      const code = parseKeycode(n);
      if (code === null || code > 0xff) throw new Error(`Macros cannot use ${n}`);
      return code;
    });
    if (press) codes.forEach((key) => actions.push({ type: "down", key }));
    else if (release) codes.forEach((key) => actions.push({ type: "up", key }));
    else if (codes.length === 1) actions.push({ type: "tap", key: codes[0] });
    else {
      codes.forEach((key) => actions.push({ type: "down", key }));
      [...codes].reverse().forEach((key) => actions.push({ type: "up", key }));
    }
  }
  flush();
  return encodeActions(actions);
}

export function exportViaLayout(state: KeyboardState, customKeycodes: CustomKeycode[] = []): ViaLayoutFile {
  return {
    name: state.info.productName,
    vendorProductId: state.info.vendorId * 0x10000 + state.info.productId,
    macros: state.macros.data.map(macroToViaText),
    layers: state.keymap.map((layer) => layer.map((code) => viaName(code, customKeycodes))),
    encoders: state.encoders.map((layer) => layer.map(([ccw, cw]) => [viaName(ccw, customKeycodes), viaName(cw, customKeycodes)] as [string, string])),
  };
}

function viaName(code: number, customKeycodes: CustomKeycode[]): string {
  const d = describeKey(code, { customKeycodes });
  if (d.kind === "custom" && code >= 0x7e00 && code <= 0x7e3f) return `CUSTOM(${code - 0x7e00})`;
  return d.name;
}

/** Convert a VIA saved layout into a profile for the given keyboard. Unknown keycodes are reported, not guessed. */
export function importViaLayout(file: ViaLayoutFile, state: KeyboardState, customKeycodes: CustomKeycode[] = []): { profile: Profile; unknown: string[] } {
  if (!file || !Array.isArray(file.layers)) throw new Error("This is not a VIA layout file");
  const expected = state.info.vendorId * 0x10000 + state.info.productId;
  if (typeof file.vendorProductId === "number" && file.vendorProductId !== expected) {
    throw new Error(`This layout is for a different keyboard (${file.name ?? "unknown"})`);
  }
  const unknown = new Set<string>();
  const parse = (name: string, fallback: number) => {
    const code = parseKeycode(name, customKeycodes);
    if (code === null) {
      unknown.add(name);
      return fallback;
    }
    return code;
  };
  const keys = state.rows * state.cols;
  const keymap = state.keymap.map((current, l) => {
    const names = file.layers[l];
    if (!names) return current.slice();
    return Array.from({ length: keys }, (_, i) => (names[i] === undefined ? current[i] : parse(names[i], current[i])));
  });
  const encoders = state.encoders.map((layer, l) =>
    layer.map(([ccw, cw], i) => {
      const e = file.encoders?.[l]?.[i];
      return e ? ([parse(e[0], ccw), parse(e[1], cw)] as [number, number]) : ([ccw, cw] as [number, number]);
    }),
  );
  const profile = snapshot(state, file.name ?? "Imported layout");
  profile.keymap = keymap;
  profile.encoders = encoders;
  if (file.macros) {
    const data = state.macros.data.map((m, i) => (file.macros![i] !== undefined ? viaTextToMacro(file.macros![i]) : m));
    profile.macros = { names: data.map(() => null), data: data.map(toHex) };
  }
  delete profile.lighting;
  delete profile.advanced;
  return { profile, unknown: [...unknown] };
}
