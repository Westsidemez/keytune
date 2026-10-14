// QMK keycodes: naming, display labels and the picker catalogue.
// Numeric values come from the generated table (quantum/keycodes.h).

import table from "./data/qmk-keycodes.json";

export type Platform = "mac" | "win";

export const RANGE = {
  MODS: 0x0100,
  MODS_MAX: 0x1fff,
  MOD_TAP: 0x2000,
  MOD_TAP_MAX: 0x3fff,
  LAYER_TAP: 0x4000,
  LAYER_TAP_MAX: 0x4fff,
  LAYER_MOD: 0x5000,
  LAYER_MOD_MAX: 0x51ff,
  TO: 0x5200,
  MO: 0x5220,
  DF: 0x5240,
  TG: 0x5260,
  OSL: 0x5280,
  OSM: 0x52a0,
  TT: 0x52c0,
  PDF: 0x52e0,
  MACRO: 0x7700,
  MACRO_MAX: 0x777f,
  KB: 0x7e00,
  KB_MAX: 0x7e3f,
  USER: 0x7e40,
  USER_MAX: 0x7fff,
} as const;

/** 5-bit QMK modifier mask: Ctrl, Shift, Alt, GUI, plus a right-hand flag. */
export const MOD = { CTRL: 0x01, SHIFT: 0x02, ALT: 0x04, GUI: 0x08, RIGHT: 0x10 } as const;
export const HYPER = MOD.CTRL | MOD.SHIFT | MOD.ALT | MOD.GUI;
export const MEH = MOD.CTRL | MOD.SHIFT | MOD.ALT;

const values = table.values as Record<string, number>;
const aliases = table.aliases as Record<string, string>;

export const KEYCODE: Record<string, number> = { ...values };
for (const [alias, target] of Object.entries(aliases)) KEYCODE[alias] = values[target];

export function kc(name: string): number {
  const value = KEYCODE[name] ?? KEYCODE[`KC_${name}`];
  if (value === undefined) throw new Error(`Unknown keycode ${name}`);
  return value;
}

/** Shortest canonical name per value, e.g. 0x29 -> KC_ESC. */
const NAME_BY_VALUE = new Map<number, string>();
for (const [name, value] of Object.entries(KEYCODE)) {
  if (/^QK_(BASIC|MODS|MOD_TAP|LAYER|TO|MOMENTARY|DEF_LAYER|TOGGLE|ONE_SHOT|SWAP|TAP_DANCE|MAGIC|MIDI|SEQUENCER|JOYSTICK|PROGRAMMABLE|AUDIO|STENO|MACRO|CONNECTION|COMMUNITY|LIGHTING|QUANTUM|KB|USER|UNICODE|PERSISTENT)(_MAX)?$/.test(name)) continue;
  if (name === "XXXXXXX" || name === "_______") continue;
  const current = NAME_BY_VALUE.get(value);
  if (!current || name.length < current.length) NAME_BY_VALUE.set(value, name);
}
NAME_BY_VALUE.set(0, "KC_NO");
NAME_BY_VALUE.set(1, "KC_TRNS");

export interface CustomKeycode {
  name: string;
  title?: string;
  shortName?: string;
}

export interface LabelContext {
  platform?: Platform;
  /** Keyboard-specific keycodes starting at QK_KB_0 (from the VIA definition). */
  customKeycodes?: CustomKeycode[];
  macroNames?: (string | undefined)[];
  layerNames?: string[];
}

export type KeyKind = "basic" | "modified" | "tap-hold" | "layer" | "macro" | "custom" | "special" | "none" | "transparent";

export interface KeyLabel {
  /** Short legend for a keycap. */
  label: string;
  /** Secondary legend (hold action for tap/hold keys). */
  hold?: string;
  /** Human description. */
  title: string;
  /** QMK-style name, stable across apps (used for VIA files). */
  name: string;
  kind: KeyKind;
}

// --- labels ---------------------------------------------------------------

const BASIC_LABELS: Record<string, [string, string?]> = {
  KC_ENT: ["Return", "Return / Enter"],
  KC_ESC: ["Esc", "Escape"],
  KC_BSPC: ["Delete", "Backspace (Delete on Mac)"],
  KC_TAB: ["Tab"],
  KC_SPC: ["Space"],
  KC_MINS: ["- _", "Minus"],
  KC_EQL: ["= +", "Equals"],
  KC_LBRC: ["[ {", "Left bracket"],
  KC_RBRC: ["] }", "Right bracket"],
  KC_BSLS: ["\\ |", "Backslash"],
  KC_NUHS: ["# ~", "Non-US hash"],
  KC_SCLN: ["; :", "Semicolon"],
  KC_QUOT: ["' \"", "Quote"],
  KC_GRV: ["` ~", "Grave"],
  KC_COMM: [", <", "Comma"],
  KC_DOT: [". >", "Period"],
  KC_SLSH: ["/ ?", "Slash"],
  KC_CAPS: ["Caps", "Caps Lock"],
  KC_PSCR: ["PrtSc", "Print Screen"],
  KC_SCRL: ["ScrLk", "Scroll Lock (screen dimmer on Mac)"],
  KC_PAUS: ["Pause"],
  KC_INS: ["Ins", "Insert"],
  KC_HOME: ["Home"],
  KC_PGUP: ["PgUp", "Page Up"],
  KC_DEL: ["Del", "Forward Delete"],
  KC_END: ["End"],
  KC_PGDN: ["PgDn", "Page Down"],
  KC_RGHT: ["→", "Right arrow"],
  KC_LEFT: ["←", "Left arrow"],
  KC_DOWN: ["↓", "Down arrow"],
  KC_UP: ["↑", "Up arrow"],
  KC_NUM: ["Num", "Num Lock / Clear"],
  KC_PSLS: ["/", "Keypad /"],
  KC_PAST: ["*", "Keypad *"],
  KC_PMNS: ["-", "Keypad -"],
  KC_PPLS: ["+", "Keypad +"],
  KC_PENT: ["Enter", "Keypad Enter"],
  KC_PDOT: [".", "Keypad ."],
  KC_PEQL: ["=", "Keypad ="],
  KC_PCMM: [",", "Keypad ,"],
  KC_NUBS: ["\\ |", "Non-US backslash (ISO)"],
  KC_APP: ["Menu", "Application / context menu"],
  KC_KB_POWER: ["Power"],
  KC_MUTE: ["Mute"],
  KC_VOLU: ["Vol +", "Volume up"],
  KC_VOLD: ["Vol -", "Volume down"],
  KC_MNXT: ["Next", "Next track"],
  KC_MPRV: ["Prev", "Previous track"],
  KC_MSTP: ["Stop", "Stop playback"],
  KC_MPLY: ["Play", "Play / Pause"],
  KC_MSEL: ["Media", "Media select"],
  KC_EJCT: ["Eject"],
  KC_MAIL: ["Mail"],
  KC_CALC: ["Calc", "Calculator"],
  KC_MYCM: ["Computer", "My Computer"],
  KC_WSCH: ["Search", "Browser search"],
  KC_WHOM: ["Home", "Browser home"],
  KC_WBAK: ["Back", "Browser back"],
  KC_WFWD: ["Fwd", "Browser forward"],
  KC_WSTP: ["Stop", "Browser stop"],
  KC_WREF: ["Reload", "Browser refresh"],
  KC_WFAV: ["Favs", "Browser favourites"],
  KC_MFFD: ["FF", "Fast forward"],
  KC_MRWD: ["Rew", "Rewind"],
  KC_BRIU: ["Br +", "Screen brightness up"],
  KC_BRID: ["Br -", "Screen brightness down"],
  KC_CPNL: ["Settings", "Control panel"],
  KC_ASST: ["Assist", "Assistant"],
  KC_MCTL: ["MCtl", "Mission Control"],
  KC_LPAD: ["LPad", "Launchpad"],
  KC_PWR: ["Power", "System power"],
  KC_SLEP: ["Sleep", "System sleep"],
  KC_WAKE: ["Wake", "System wake"],
  MS_UP: ["Mouse ↑", "Move mouse up"],
  MS_DOWN: ["Mouse ↓", "Move mouse down"],
  MS_LEFT: ["Mouse ←", "Move mouse left"],
  MS_RGHT: ["Mouse →", "Move mouse right"],
  MS_BTN1: ["Click", "Left click"],
  MS_BTN2: ["R-Click", "Right click"],
  MS_BTN3: ["M-Click", "Middle click"],
  MS_BTN4: ["Btn 4", "Mouse back"],
  MS_BTN5: ["Btn 5", "Mouse forward"],
  MS_WHLU: ["Wheel ↑", "Scroll up"],
  MS_WHLD: ["Wheel ↓", "Scroll down"],
  MS_WHLL: ["Wheel ←", "Scroll left"],
  MS_WHLR: ["Wheel →", "Scroll right"],
  MS_ACL0: ["Accel 0", "Mouse speed slow"],
  MS_ACL1: ["Accel 1", "Mouse speed medium"],
  MS_ACL2: ["Accel 2", "Mouse speed fast"],
};

const SPECIAL_LABELS: Record<string, [string, string]> = {
  UG_TOGG: ["RGB", "Backlight on / off"],
  UG_NEXT: ["Mode +", "Next lighting effect"],
  UG_PREV: ["Mode -", "Previous lighting effect"],
  UG_HUEU: ["Hue +", "Lighting hue up"],
  UG_HUED: ["Hue -", "Lighting hue down"],
  UG_SATU: ["Sat +", "Lighting saturation up"],
  UG_SATD: ["Sat -", "Lighting saturation down"],
  UG_VALU: ["Bri +", "Backlight brighter"],
  UG_VALD: ["Bri -", "Backlight dimmer"],
  UG_SPDU: ["Spd +", "Lighting speed up"],
  UG_SPDD: ["Spd -", "Lighting speed down"],
  NK_TOGG: ["NKRO", "Toggle n-key rollover"],
  NK_ON: ["NKRO on", "N-key rollover on"],
  NK_OFF: ["NKRO off", "N-key rollover off"],
  QK_BOOT: ["Boot", "Restart into firmware-update mode"],
  QK_RBT: ["Reboot", "Restart the keyboard"],
  EE_CLR: ["Reset", "Erase all settings (factory reset)"],
  QK_GESC: ["Esc `", "Escape, or ` with Shift/GUI"],
  CL_SWAP: ["Caps⇄Ctl", "Swap Caps Lock and Control"],
  CL_NORM: ["Caps Ctl", "Unswap Caps Lock and Control"],
  AG_SWAP: ["⌥⇄⌘", "Swap Alt and GUI"],
  AG_NORM: ["⌥ ⌘", "Unswap Alt and GUI"],
  GU_TOGG: ["Win Lock", "Disable / enable the GUI key"],
  EC_SWAP: ["Esc⇄Caps", "Swap Escape and Caps Lock"],
  EC_NORM: ["Esc Caps", "Unswap Escape and Caps Lock"],
};

const MOD_SYMBOL_MAC: Record<number, string> = { [MOD.CTRL]: "⌃", [MOD.SHIFT]: "⇧", [MOD.ALT]: "⌥", [MOD.GUI]: "⌘" };
const MOD_WORD: Record<Platform, Record<number, string>> = {
  mac: { [MOD.CTRL]: "Control", [MOD.SHIFT]: "Shift", [MOD.ALT]: "Option", [MOD.GUI]: "Command" },
  win: { [MOD.CTRL]: "Ctrl", [MOD.SHIFT]: "Shift", [MOD.ALT]: "Alt", [MOD.GUI]: "Win" },
};
const MOD_ORDER = [MOD.CTRL, MOD.ALT, MOD.SHIFT, MOD.GUI];
const MOD_NAME: Record<number, string> = { [MOD.CTRL]: "CTL", [MOD.SHIFT]: "SFT", [MOD.ALT]: "ALT", [MOD.GUI]: "GUI" };

/** Display a 5-bit modifier mask, e.g. ⌃⌥⌘ or Ctrl+Alt+Win. */
export function modsLabel(mods: number, platform: Platform = "mac"): string {
  if ((mods & 0x0f) === HYPER) return "Hyper";
  if ((mods & 0x0f) === MEH) return "Meh";
  const parts = MOD_ORDER.filter((m) => mods & m);
  return platform === "mac" ? parts.map((m) => MOD_SYMBOL_MAC[m]).join("") : parts.map((m) => MOD_WORD.win[m]).join("+");
}

/** QMK name of a 5-bit mod mask, e.g. MOD_LCTL | MOD_LSFT. */
export function modsName(mods: number): string {
  const side = mods & MOD.RIGHT ? "R" : "L";
  return MOD_ORDER.filter((m) => mods & m).map((m) => `MOD_${side}${MOD_NAME[m]}`).join(" | ") || "0";
}

const MODIFIER_KEYS: Record<number, [number, boolean]> = {
  0xe0: [MOD.CTRL, false],
  0xe1: [MOD.SHIFT, false],
  0xe2: [MOD.ALT, false],
  0xe3: [MOD.GUI, false],
  0xe4: [MOD.CTRL, true],
  0xe5: [MOD.SHIFT, true],
  0xe6: [MOD.ALT, true],
  0xe7: [MOD.GUI, true],
};

export function isModifierKey(code: number): boolean {
  return code in MODIFIER_KEYS;
}

/** The 5-bit mod mask produced by a modifier keycode (0xE0-0xE7). */
export function modifierMask(code: number): number {
  const entry = MODIFIER_KEYS[code];
  return entry ? entry[0] | (entry[1] ? MOD.RIGHT : 0) : 0;
}

/** The modifier keycode for one modifier bit, e.g. (ALT, right) -> KC_RALT. */
export function modifierKeycode(mod: number, right = false): number {
  const base = { [MOD.CTRL]: 0xe0, [MOD.SHIFT]: 0xe1, [MOD.ALT]: 0xe2, [MOD.GUI]: 0xe3 }[mod];
  if (base === undefined) throw new Error(`Not a single modifier: ${mod}`);
  return base + (right ? 4 : 0);
}

function basicLabel(code: number, platform: Platform): { label: string; title: string; name: string } {
  const name = NAME_BY_VALUE.get(code) ?? `0x${hex4(code)}`;
  if (code in MODIFIER_KEYS) {
    const [mod, right] = MODIFIER_KEYS[code];
    const word = MOD_WORD[platform][mod];
    const symbol = platform === "mac" ? `${MOD_SYMBOL_MAC[mod]} ` : "";
    return { label: `${symbol}${word}`, title: `${right ? "Right" : "Left"} ${word}`, name };
  }
  if (code >= 0x04 && code <= 0x1d) return { label: String.fromCharCode(0x41 + code - 0x04), title: `Letter ${String.fromCharCode(0x41 + code - 0x04)}`, name };
  if (code >= 0x1e && code <= 0x27) {
    const digit = code === 0x27 ? "0" : String(code - 0x1d);
    return { label: digit, title: `Number ${digit}`, name };
  }
  if ((code >= 0x3a && code <= 0x45) || (code >= 0x68 && code <= 0x73)) {
    const n = code <= 0x45 ? code - 0x39 : code - 0x67 + 12;
    return { label: `F${n}`, title: `Function key F${n}`, name };
  }
  if (code >= 0x59 && code <= 0x62) {
    const digit = code === 0x62 ? "0" : String(code - 0x58);
    return { label: digit, title: `Keypad ${digit}`, name };
  }
  const known = BASIC_LABELS[name];
  if (known) return { label: known[0], title: known[1] ?? known[0], name };
  const pretty = name.replace(/^(KC|QK|MS)_/, "").replace(/_/g, " ");
  return { label: pretty, title: pretty, name };
}

/** Describe any 16-bit keycode for display. */
export function describe(code: number, ctx: LabelContext = {}): KeyLabel {
  const platform = ctx.platform ?? "mac";
  code &= 0xffff;
  if (code === 0) return { label: "", title: "No action", name: "KC_NO", kind: "none" };
  if (code === 1) return { label: "▽", title: "Transparent (uses the layer below)", name: "KC_TRNS", kind: "transparent" };

  if (code <= 0xff) {
    const b = basicLabel(code, platform);
    return { ...b, kind: "basic" };
  }

  const layerName = (n: number) => ctx.layerNames?.[n] ?? `Layer ${n}`;

  if (code >= RANGE.MODS && code <= RANGE.MODS_MAX) {
    const mods = (code >> 8) & 0x1f;
    const key = basicLabel(code & 0xff, platform);
    const shortcut = platform === "mac" ? `${modsLabel(mods, platform)}${key.label}` : `${modsLabel(mods, platform)}+${key.label}`;
    return { label: shortcut, title: `${modsLabel(mods, platform)} + ${key.title}`, name: modsWrap(mods, key.name), kind: "modified" };
  }
  if (code >= RANGE.MOD_TAP && code <= RANGE.MOD_TAP_MAX) {
    const mods = (code >> 8) & 0x1f;
    const key = basicLabel(code & 0xff, platform);
    const hold = modsLabel(mods, platform);
    return { label: key.label, hold, title: `Tap: ${key.title} · Hold: ${hold}`, name: `MT(${modsName(mods)}, ${key.name})`, kind: "tap-hold" };
  }
  if (code >= RANGE.LAYER_TAP && code <= RANGE.LAYER_TAP_MAX) {
    const layer = (code >> 8) & 0x0f;
    const key = basicLabel(code & 0xff, platform);
    return { label: key.label, hold: `L${layer}`, title: `Tap: ${key.title} · Hold: ${layerName(layer)}`, name: `LT(${layer}, ${key.name})`, kind: "tap-hold" };
  }
  if (code >= RANGE.LAYER_MOD && code <= RANGE.LAYER_MOD_MAX) {
    const layer = (code >> 5) & 0x0f;
    const mods = code & 0x1f;
    return { label: `L${layer}`, hold: modsLabel(mods, platform), title: `Hold: ${layerName(layer)} with ${modsLabel(mods, platform)}`, name: `LM(${layer}, ${modsName(mods)})`, kind: "layer" };
  }
  const layerOps: [number, string, string, string][] = [
    [RANGE.TO, "TO", "Go to", "Switch to"],
    [RANGE.MO, "MO", "Fn", "Hold for"],
    [RANGE.DF, "DF", "Base", "Make base layer:"],
    [RANGE.TG, "TG", "Toggle", "Toggle"],
    [RANGE.OSL, "OSL", "Once", "Next key on"],
    [RANGE.TT, "TT", "Tap-Tog", "Hold or double-tap for"],
    [RANGE.PDF, "PDF", "Base*", "Save as base layer:"],
  ];
  for (const [base, fn, short, verb] of layerOps) {
    if (code >= base && code < base + 0x20) {
      const layer = code - base;
      return { label: `${short} ${layer}`, title: `${verb} ${layerName(layer)}`, name: `${fn}(${layer})`, kind: "layer" };
    }
  }
  if (code >= RANGE.OSM && code < RANGE.OSM + 0x20) {
    const mods = code - RANGE.OSM;
    return { label: `1×${modsLabel(mods, platform)}`, title: `One-shot ${modsLabel(mods, platform)} (applies to the next key)`, name: `OSM(${modsName(mods)})`, kind: "layer" };
  }
  if (code >= RANGE.MACRO && code <= RANGE.MACRO_MAX) {
    const n = code - RANGE.MACRO;
    const named = ctx.macroNames?.[n];
    return { label: named ? named : `M${n}`, title: named ? `Macro M${n}: ${named}` : `Macro M${n}`, name: `QK_MACRO_${n}`, kind: "macro" };
  }
  if (code >= RANGE.KB && code <= RANGE.KB_MAX) {
    const n = code - RANGE.KB;
    const custom = ctx.customKeycodes?.[n];
    if (custom) return { label: custom.shortName ?? custom.name, title: custom.title ?? custom.name, name: `QK_KB_${n}`, kind: "custom" };
    return { label: `KB ${n}`, title: `Keyboard function ${n}`, name: `QK_KB_${n}`, kind: "custom" };
  }
  if (code >= RANGE.USER && code <= RANGE.USER_MAX) {
    const n = code - RANGE.USER;
    return { label: `User ${n}`, title: `User keycode ${n}`, name: `QK_USER_${n}`, kind: "custom" };
  }
  const name = NAME_BY_VALUE.get(code);
  if (name) {
    const special = SPECIAL_LABELS[name];
    if (special) return { label: special[0], title: special[1], name, kind: "special" };
    const pretty = name.replace(/^(QK|RM|UG|BL|LM)_/, "").replace(/_/g, " ").toLowerCase();
    return { label: pretty.length > 8 ? pretty.slice(0, 8) : pretty, title: pretty, name, kind: "special" };
  }
  return { label: `0x${hex4(code)}`, title: `Keycode 0x${hex4(code)}`, name: `0x${hex4(code)}`, kind: "special" };
}

function modsWrap(mods: number, inner: string): string {
  const side = mods & MOD.RIGHT ? "R" : "L";
  if ((mods & 0x0f) === HYPER && side === "L") return `HYPR(${inner})`;
  if ((mods & 0x0f) === MEH && side === "L") return `MEH(${inner})`;
  let result = inner;
  for (const m of [...MOD_ORDER].reverse()) {
    if (mods & m) result = `${side}${MOD_NAME[m]}(${result})`;
  }
  return result;
}

function hex4(value: number): string {
  return value.toString(16).toUpperCase().padStart(4, "0");
}

// --- construction ---------------------------------------------------------

/** Basic key with modifiers held (QMK's LCTL(kc) etc.); the mod bits sit directly in bits 8-12. */
export const withMods = (mods: number, key: number) => ((mods & 0x1f) << 8) | (key & 0xff);
export const modTap = (mods: number, key: number) => RANGE.MOD_TAP | ((mods & 0x1f) << 8) | (key & 0xff);
export const layerTap = (layer: number, key: number) => RANGE.LAYER_TAP | ((layer & 0x0f) << 8) | (key & 0xff);
export const layerMod = (layer: number, mods: number) => RANGE.LAYER_MOD | ((layer & 0x0f) << 5) | (mods & 0x1f);
export const MO = (layer: number) => RANGE.MO | (layer & 0x1f);
export const TG = (layer: number) => RANGE.TG | (layer & 0x1f);
export const TO = (layer: number) => RANGE.TO | (layer & 0x1f);
export const DF = (layer: number) => RANGE.DF | (layer & 0x1f);
export const OSL = (layer: number) => RANGE.OSL | (layer & 0x1f);
export const TT = (layer: number) => RANGE.TT | (layer & 0x1f);
export const OSM = (mods: number) => RANGE.OSM | (mods & 0x1f);
export const macroKey = (index: number) => RANGE.MACRO + index;

/** Split a tap/hold keycode into its parts. */
export function tapHoldParts(code: number): { tap: number; hold: { mods: number } | { layer: number } } | null {
  if (code >= RANGE.MOD_TAP && code <= RANGE.MOD_TAP_MAX) return { tap: code & 0xff, hold: { mods: (code >> 8) & 0x1f } };
  if (code >= RANGE.LAYER_TAP && code <= RANGE.LAYER_TAP_MAX) return { tap: code & 0xff, hold: { layer: (code >> 8) & 0x0f } };
  return null;
}

/** Parse a QMK/VIA keycode name such as KC_A, LCTL(KC_C), MO(1), LT(2,KC_SPC), QK_MACRO_3. */
export function parseKeycode(text: string, customKeycodes: CustomKeycode[] = []): number | null {
  const s = text.replace(/\s+/g, "");
  if (/^0x[0-9a-f]{1,4}$/i.test(s)) return parseInt(s, 16);
  if (s in KEYCODE) return KEYCODE[s];
  if (`KC_${s}` in KEYCODE) return KEYCODE[`KC_${s}`];
  const custom = customKeycodes.findIndex((c) => c.name.replace(/\s+/g, "") === s);
  if (custom >= 0) return RANGE.KB + custom;
  let m = /^(?:QK_MACRO_|MACRO|M|MC_)\(?(\d+)\)?$/.exec(s);
  if (m) return RANGE.MACRO + Number(m[1]);
  m = /^QK_KB_(\d+)$/.exec(s) ?? /^CUSTOM\((\d+)\)$/.exec(s);
  if (m) return RANGE.KB + Number(m[1]);
  m = /^(?:QK_USER_|USER)(\d+)$/.exec(s);
  if (m) return RANGE.USER + Number(m[1]);
  m = /^(TO|MO|DF|TG|OSL|TT|PDF)\((\d+)\)$/.exec(s);
  if (m) return ({ TO: RANGE.TO, MO: RANGE.MO, DF: RANGE.DF, TG: RANGE.TG, OSL: RANGE.OSL, TT: RANGE.TT, PDF: RANGE.PDF } as Record<string, number>)[m[1]] + Number(m[2]);
  m = /^LT\((\d+),(.+)\)$/.exec(s);
  if (m) {
    const key = parseKeycode(m[2], customKeycodes);
    return key === null ? null : layerTap(Number(m[1]), key);
  }
  m = /^MT\((.+),(.+)\)$/.exec(s);
  if (m) {
    const mods = parseModMask(m[1]);
    const key = parseKeycode(m[2], customKeycodes);
    return mods === null || key === null ? null : modTap(mods, key);
  }
  m = /^LM\((\d+),(.+)\)$/.exec(s);
  if (m) {
    const mods = parseModMask(m[2]);
    return mods === null ? null : layerMod(Number(m[1]), mods);
  }
  m = /^OSM\((.+)\)$/.exec(s);
  if (m) {
    const mods = parseModMask(m[1]);
    return mods === null ? null : OSM(mods);
  }
  m = /^([LR])?(CTL|SFT|ALT|GUI|C|S|A|G|OPT|CMD|WIN)_T\((.+)\)$/.exec(s);
  if (m) {
    const key = parseKeycode(m[3], customKeycodes);
    const mod = modFromWord(m[2]);
    return key === null || mod === null ? null : modTap(mod | (m[1] === "R" ? MOD.RIGHT : 0), key);
  }
  m = /^(HYPR|MEH)\((.+)\)$/.exec(s);
  if (m) {
    const key = parseKeycode(m[2], customKeycodes);
    return key === null ? null : withMods(m[1] === "HYPR" ? HYPER : MEH, key);
  }
  m = /^([LR])(CTL|SFT|ALT|GUI|OPT|CMD|WIN)\((.+)\)$/.exec(s);
  if (m) {
    const inner = parseKeycode(m[3], customKeycodes);
    const mod = modFromWord(m[2]);
    if (inner === null || mod === null) return null;
    const existing = inner >= RANGE.MODS && inner <= RANGE.MODS_MAX ? (inner >> 8) & 0x1f : 0;
    return withMods(existing | mod | (m[1] === "R" ? MOD.RIGHT : 0), inner & 0xff);
  }
  m = /^([CSAG])\((.+)\)$/.exec(s);
  if (m) {
    const inner = parseKeycode(m[2], customKeycodes);
    const mod = modFromWord(m[1]);
    if (inner === null || mod === null) return null;
    const existing = inner >= RANGE.MODS && inner <= RANGE.MODS_MAX ? (inner >> 8) & 0x1f : 0;
    return withMods(existing | mod, inner & 0xff);
  }
  return null;
}

function modFromWord(word: string): number | null {
  return ({ CTL: MOD.CTRL, C: MOD.CTRL, SFT: MOD.SHIFT, S: MOD.SHIFT, ALT: MOD.ALT, A: MOD.ALT, OPT: MOD.ALT, GUI: MOD.GUI, G: MOD.GUI, CMD: MOD.GUI, WIN: MOD.GUI } as Record<string, number>)[word] ?? null;
}

function parseModMask(text: string): number | null {
  let mask = 0;
  for (const part of text.split("|")) {
    const m = /^MOD_([LR])(CTL|SFT|ALT|GUI|OPT|CMD|WIN)$/.exec(part) ?? /^MOD_(HYPR|MEH)$/.exec(part);
    if (!m) return null;
    if (m[1] === "HYPR") mask |= HYPER;
    else if (m[1] === "MEH") mask |= MEH;
    else mask |= (modFromWord(m[2]) ?? 0) | (m[1] === "R" ? MOD.RIGHT : 0);
  }
  return mask;
}

/** Canonical name for a keycode, round-trippable through parseKeycode. */
export function keycodeName(code: number, customKeycodes: CustomKeycode[] = []): string {
  return describe(code, { customKeycodes }).name;
}

// --- picker catalogue -----------------------------------------------------

export interface PickerEntry {
  code: number;
  /** Optional override of the generated label for the picker tile. */
  label?: string;
  title?: string;
  keywords?: string;
}

export interface PickerGroup {
  title: string;
  entries: PickerEntry[];
}

export interface PickerCategory {
  id: string;
  title: string;
  groups: PickerGroup[];
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const entries = (codes: number[]): PickerEntry[] => codes.map((code) => ({ code }));
const shortcut = (label: string, title: string, mods: number, key: string, keywords = ""): PickerEntry => ({
  code: withMods(mods, kc(key)),
  label,
  title,
  keywords,
});

export interface PickerOptions {
  layers: number;
  macros: number;
  customKeycodes?: CustomKeycode[];
}

export function pickerCatalogue(options: PickerOptions): PickerCategory[] {
  const custom = options.customKeycodes ?? [];
  const customEntries = custom.map((_, i) => ({ code: RANGE.KB + i }));
  const layers = range(0, Math.max(0, options.layers - 1));
  return [
    {
      id: "basic",
      title: "Basic",
      groups: [
        { title: "Letters", entries: entries(range(0x04, 0x1d)) },
        { title: "Numbers", entries: entries(range(0x1e, 0x27)) },
        {
          title: "Editing",
          entries: entries(["ESC", "TAB", "ENT", "BSPC", "DEL", "SPC", "CAPS", "INS", "HOME", "END", "PGUP", "PGDN", "UP", "DOWN", "LEFT", "RGHT"].map(kc)),
        },
        { title: "Modifiers", entries: entries(range(0xe0, 0xe7)) },
        { title: "Symbols", entries: entries(["GRV", "MINS", "EQL", "LBRC", "RBRC", "BSLS", "SCLN", "QUOT", "COMM", "DOT", "SLSH", "NUHS", "NUBS"].map(kc)) },
        { title: "Function keys", entries: entries([...range(0x3a, 0x45), ...range(0x68, 0x73)]) },
        { title: "Keypad", entries: entries([...range(0x53, 0x63), kc("PEQL"), kc("PCMM")]) },
        { title: "System", entries: entries(["PSCR", "SCRL", "PAUS", "APP", "KB_POWER"].map(kc)) },
        { title: "Empty", entries: [{ code: 0 }, { code: 1 }] },
      ],
    },
    {
      id: "mac",
      title: "macOS",
      groups: [
        { title: "Keychron Mac keys", entries: customEntries.filter((e) => /Option|Cmd|Mission|Launchpad|Screen|Siri/i.test(custom[e.code - RANGE.KB].name)) },
        {
          title: "Shortcuts",
          entries: [
            shortcut("Lock", "Lock screen", MOD.CTRL | MOD.GUI, "Q", "lock screen"),
            shortcut("Spotlight", "Spotlight search", MOD.GUI, "SPC", "search"),
            shortcut("Emoji", "Emoji & symbols", MOD.CTRL | MOD.GUI, "SPC", "emoji"),
            shortcut("Shot ▢", "Screenshot of an area", MOD.SHIFT | MOD.GUI, "4", "screenshot"),
            shortcut("Shot ⚙", "Screenshot and recording tools", MOD.SHIFT | MOD.GUI, "5", "screenshot record"),
            shortcut("Force Q", "Force quit", MOD.ALT | MOD.GUI, "ESC", "force quit"),
            shortcut("Desk ←", "Previous desktop", MOD.CTRL, "LEFT", "space desktop"),
            shortcut("Desk →", "Next desktop", MOD.CTRL, "RGHT", "space desktop"),
            shortcut("Tab →", "Next tab", MOD.CTRL, "TAB", "tab"),
            shortcut("Tab ←", "Previous tab", MOD.CTRL | MOD.SHIFT, "TAB", "tab"),
            shortcut("Undo", "Undo", MOD.GUI, "Z"),
            shortcut("Redo", "Redo", MOD.SHIFT | MOD.GUI, "Z"),
            shortcut("Cut", "Cut", MOD.GUI, "X"),
            shortcut("Copy", "Copy", MOD.GUI, "C"),
            shortcut("Paste", "Paste", MOD.GUI, "V"),
            shortcut("Paste =", "Paste and match style", MOD.ALT | MOD.SHIFT | MOD.GUI, "V", "paste plain"),
            shortcut("Find", "Find", MOD.GUI, "F"),
            shortcut("Save", "Save", MOD.GUI, "S"),
            shortcut("Close", "Close window", MOD.GUI, "W"),
            shortcut("Quit", "Quit app", MOD.GUI, "Q"),
          ],
        },
        { title: "Mac media", entries: entries(["BRID", "BRIU", "MCTL", "LPAD", "EJCT"].map(kc)) },
      ],
    },
    {
      id: "windows",
      title: "Windows",
      groups: [
        { title: "Keychron Windows keys", entries: customEntries.filter((e) => /Task|Explorer|Cortana/i.test(custom[e.code - RANGE.KB].name)) },
        {
          title: "Shortcuts",
          entries: [
            shortcut("Lock", "Lock PC", MOD.GUI, "L", "lock"),
            shortcut("Desktop", "Show desktop", MOD.GUI, "D"),
            shortcut("Snip", "Snipping tool", MOD.SHIFT | MOD.GUI, "S", "screenshot"),
            shortcut("Run", "Run dialog", MOD.GUI, "R"),
            shortcut("Undo", "Undo", MOD.CTRL, "Z"),
            shortcut("Redo", "Redo", MOD.CTRL, "Y"),
            shortcut("Cut", "Cut", MOD.CTRL, "X"),
            shortcut("Copy", "Copy", MOD.CTRL, "C"),
            shortcut("Paste", "Paste", MOD.CTRL, "V"),
            shortcut("Task Mgr", "Task Manager", MOD.CTRL | MOD.SHIFT, "ESC"),
          ],
        },
      ],
    },
    {
      id: "media",
      title: "Media",
      groups: [
        { title: "Playback", entries: entries(["MPLY", "MNXT", "MPRV", "MSTP", "MFFD", "MRWD"].map(kc)) },
        { title: "Volume", entries: entries(["MUTE", "VOLU", "VOLD"].map(kc)) },
        { title: "Apps & browser", entries: entries(["MAIL", "CALC", "MYCM", "WSCH", "WHOM", "WBAK", "WFWD", "WREF", "WFAV"].map(kc)) },
        { title: "Power", entries: entries(["PWR", "SLEP", "WAKE"].map(kc)) },
      ],
    },
    {
      id: "macros",
      title: "Macros",
      groups: [{ title: "Onboard macros", entries: range(0, options.macros - 1).map((i) => ({ code: macroKey(i) })) }],
    },
    {
      id: "layers",
      title: "Layers",
      groups: [
        { title: "Hold for layer (MO)", entries: layers.map((l) => ({ code: MO(l) })) },
        { title: "Toggle layer (TG)", entries: layers.map((l) => ({ code: TG(l) })) },
        { title: "Switch to layer (TO)", entries: layers.map((l) => ({ code: TO(l) })) },
        { title: "Next key on layer (OSL)", entries: layers.map((l) => ({ code: OSL(l) })) },
        { title: "Hold, or double-tap to toggle (TT)", entries: layers.map((l) => ({ code: TT(l) })) },
        { title: "Set base layer (DF)", entries: layers.map((l) => ({ code: DF(l) })) },
        {
          title: "One-shot modifiers",
          entries: [MOD.CTRL, MOD.SHIFT, MOD.ALT, MOD.GUI, HYPER, MEH].map((m) => ({ code: OSM(m) })),
        },
      ],
    },
    {
      id: "mouse",
      title: "Mouse",
      groups: [
        { title: "Buttons", entries: entries(range(0xd1, 0xd5)) },
        { title: "Movement", entries: entries(range(0xcd, 0xd0)) },
        { title: "Wheel", entries: entries(range(0xd9, 0xdc)) },
        { title: "Speed", entries: entries(range(0xdd, 0xdf)) },
      ],
    },
    {
      id: "lighting",
      title: "Lighting",
      groups: [
        { title: "Backlight", entries: entries(["UG_TOGG", "UG_NEXT", "UG_PREV", "UG_VALU", "UG_VALD", "UG_SPDU", "UG_SPDD", "UG_HUEU", "UG_HUED", "UG_SATU", "UG_SATD"].map(kc)) },
      ],
    },
    {
      id: "keyboard",
      title: "Keyboard",
      groups: [
        { title: "Wireless & battery", entries: customEntries.filter((e) => /Bluetooth|2\.4G|Battery/i.test(custom[e.code - RANGE.KB].name)) },
        { title: "Behaviour", entries: entries(["NK_TOGG", "QK_GESC", "GU_TOGG", "AG_SWAP", "AG_NORM", "CL_SWAP", "CL_NORM", "EC_SWAP", "EC_NORM"].map(kc)) },
        { title: "Maintenance", entries: entries(["QK_RBT", "QK_BOOT", "EE_CLR"].map(kc)) },
        { title: "Other keyboard functions", entries: customEntries.filter((e) => !/Option|Cmd|Mission|Launchpad|Screen|Siri|Task|Explorer|Cortana|Bluetooth|2\.4G|Battery/i.test(custom[e.code - RANGE.KB].name)) },
      ],
    },
  ].map((category) => ({ ...category, groups: category.groups.filter((g) => g.entries.length > 0) }));
}

/** Keycodes that need a second look before assigning (they reset or reflash). */
export const DANGEROUS_KEYCODES = new Set([KEYCODE.QK_BOOT, KEYCODE.EE_CLR]);
