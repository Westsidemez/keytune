// Keyboard definitions in VIA's JSON format, with the physical layout in
// keyboard-layout-editor (KLE) notation. Each key's first legend is its matrix
// position "row,col"; an "eN" legend marks rotary encoder N; a "group,choice"
// legend in slot 8 marks a layout option. VIA's online library serves the same
// definitions "compiled": a numeric vendorProductId and the keys already laid out.

export interface ViaDefinition {
  name: string;
  vendorId: string;
  productId: string;
  matrix: { rows: number; cols: number };
  /** KLE rows (source definitions) or pre-positioned keys (VIA's compiled definitions). */
  layouts: { keymap?: unknown[][]; keys?: CompiledKey[]; optionKeys?: Record<string, Record<string, CompiledKey[]>>; labels?: (string | string[])[] };
  customKeycodes?: { name: string; title?: string; shortName?: string }[];
  menus?: unknown[];
  keycodes?: string[];
}

/** A key in VIA's compiled layout. */
export interface CompiledKey {
  row: number;
  col: number;
  x: number;
  y: number;
  w: number;
  h: number;
  x2?: number;
  y2?: number;
  w2?: number;
  h2?: number;
  d?: boolean;
  /** Encoder index. */
  ei?: number;
  color?: string;
}

export interface LayoutKey {
  /** Stable id: "row,col" (encoders that only rotate use "e<index>"). */
  id: string;
  row: number;
  col: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Rotary encoder index if this key is a knob. */
  encoder?: number;
  /** Second rectangle for stepped/ISO-enter keys, relative to x/y. */
  shape2?: { x: number; y: number; w: number; h: number };
  /** KLE colour, used to tell alpha keys from modifiers. */
  color?: string;
}

export interface KeyboardLayout {
  keys: LayoutKey[];
  width: number;
  height: number;
  encoders: number;
}

interface KleProps {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  x2?: number;
  y2?: number;
  w2?: number;
  h2?: number;
  c?: string;
  d?: boolean;
}

export function parseLayout(definition: ViaDefinition, options: number[] = []): KeyboardLayout {
  const keys = definition.layouts.keymap ? parseKle(definition.layouts.keymap, options) : compiledKeys(definition.layouts, options);
  const width = Math.max(0, ...keys.map((k) => k.x + Math.max(k.w, k.shape2 ? k.shape2.x + k.shape2.w : 0)));
  const height = Math.max(0, ...keys.map((k) => k.y + Math.max(k.h, k.shape2 ? k.shape2.y + k.shape2.h : 0)));
  const encoders = keys.reduce((n, k) => (k.encoder === undefined ? n : Math.max(n, k.encoder + 1)), 0);
  return { keys, width, height, encoders };
}

/** VIA's compiled colour names, as the KLE colours the source definitions use. */
const COMPILED_COLOURS: Record<string, string> = { alpha: "#cccccc", mod: "#aaaaaa", accent: "#777777" };

function compiledKeys(layouts: ViaDefinition["layouts"], options: number[]): LayoutKey[] {
  if (!Array.isArray(layouts.keys)) throw new Error("Definition needs layouts.keymap or layouts.keys");
  const all = [...layouts.keys];
  for (const [group, choices] of Object.entries(layouts.optionKeys ?? {})) {
    all.push(...(choices[String(options[Number(group)] ?? 0)] ?? []));
  }
  const keys: LayoutKey[] = [];
  for (const k of all) {
    if (!k || typeof k !== "object" || k.d) continue;
    if (typeof k.row !== "number" || typeof k.col !== "number" || typeof k.x !== "number" || typeof k.y !== "number") throw new Error("Layout keys need row, col, x and y");
    const key: LayoutKey = { id: `${k.row},${k.col}`, row: k.row, col: k.col, x: k.x, y: k.y, w: k.w ?? 1, h: k.h ?? 1, color: COMPILED_COLOURS[k.color ?? ""] ?? k.color };
    if (typeof k.ei === "number") key.encoder = k.ei;
    if (k.x2 !== undefined || k.y2 !== undefined || k.w2 !== undefined || k.h2 !== undefined) {
      key.shape2 = { x: k.x2 ?? 0, y: k.y2 ?? 0, w: k.w2 ?? key.w, h: k.h2 ?? key.h };
    }
    keys.push(key);
  }
  return keys;
}

function parseKle(rows: unknown[][], options: number[]): LayoutKey[] {
  const keys: LayoutKey[] = [];
  let y = 0;
  let color: string | undefined;
  rows.forEach((row, rowIndex) => {
    if (!Array.isArray(row)) throw new Error("Layout rows must be arrays");
    let x = 0;
    if (rowIndex > 0) y += 1;
    let next: Required<Pick<KleProps, "w" | "h">> & Pick<KleProps, "x2" | "y2" | "w2" | "h2" | "d"> = { w: 1, h: 1 };
    for (const item of row) {
      if (item !== null && typeof item === "object") {
        const props = item as KleProps;
        if (typeof props.x === "number") x += props.x;
        if (typeof props.y === "number") y += props.y;
        if (typeof props.w === "number") next.w = props.w;
        if (typeof props.h === "number") next.h = props.h;
        if (typeof props.x2 === "number") next.x2 = props.x2;
        if (typeof props.y2 === "number") next.y2 = props.y2;
        if (typeof props.w2 === "number") next.w2 = props.w2;
        if (typeof props.h2 === "number") next.h2 = props.h2;
        if (typeof props.c === "string") color = props.c;
        if (props.d) next.d = true;
        continue;
      }
      if (typeof item !== "string") throw new Error("Layout keys must be strings");
      const labels = item.split("\n");
      const position = /^\s*(\d+)\s*,\s*(\d+)\s*$/.exec(labels[0] ?? "");
      const option = /^\s*(\d+)\s*,\s*(\d+)\s*$/.exec(labels[8] ?? "");
      const encoderLabel = labels.map((l) => /^e(\d+)$/.exec(l.trim())).find(Boolean);
      const included = !option || (options[Number(option[1])] ?? 0) === Number(option[2]);
      if (!next.d && included && (position || encoderLabel)) {
        const row = position ? Number(position[1]) : -1;
        const col = position ? Number(position[2]) : -1;
        const key: LayoutKey = {
          id: position ? `${row},${col}` : `e${encoderLabel![1]}`,
          row,
          col,
          x,
          y,
          w: next.w,
          h: next.h,
          color,
        };
        if (encoderLabel) key.encoder = Number(encoderLabel[1]);
        if (next.w2 !== undefined || next.h2 !== undefined || next.x2 !== undefined || next.y2 !== undefined) {
          key.shape2 = { x: next.x2 ?? 0, y: next.y2 ?? 0, w: next.w2 ?? next.w, h: next.h2 ?? next.h };
        }
        keys.push(key);
      }
      x += next.w;
      next = { w: 1, h: 1 };
    }
  });
  return keys;
}

/** Check a definition and return it in the source shape (hex vendorId/productId strings). */
export function validateDefinition(value: unknown): ViaDefinition {
  if (!value || typeof value !== "object") throw new Error("Definition must be a JSON object");
  const compiled = value as Partial<ViaDefinition> & { vendorProductId?: unknown };
  let d: Partial<ViaDefinition> = compiled;
  if (typeof compiled.vendorProductId === "number" && typeof compiled.vendorId !== "string") {
    const hex = (n: number) => `0x${n.toString(16).toUpperCase().padStart(4, "0")}`;
    const { vendorProductId, ...rest } = compiled;
    d = { ...rest, vendorId: hex(Math.floor(vendorProductId / 0x10000)), productId: hex(vendorProductId % 0x10000) };
  }
  // VIA v2 definitions name their lighting instead of listing menus.
  const lighting = (d as { lighting?: unknown }).lighting;
  if (!d.menus && lighting) {
    const preset = typeof lighting === "string" ? lighting : (lighting as { extends?: unknown }).extends;
    if (typeof preset === "string" && preset !== "none") d = { ...d, menus: [preset] };
  }
  if (typeof d.name !== "string") throw new Error("Definition needs a name");
  if (typeof d.vendorId !== "string" || typeof d.productId !== "string") throw new Error("Definition needs vendorId and productId");
  if (!d.matrix || typeof d.matrix.rows !== "number" || typeof d.matrix.cols !== "number") throw new Error("Definition needs matrix rows and cols");
  if (!d.layouts || !(Array.isArray(d.layouts.keymap) || Array.isArray(d.layouts.keys))) throw new Error("Definition needs layouts.keymap");
  parseLayout(d as ViaDefinition);
  return d as ViaDefinition;
}

export function vendorProductId(definition: Pick<ViaDefinition, "vendorId" | "productId">): number {
  return parseInt(definition.vendorId, 16) * 0x10000 + parseInt(definition.productId, 16);
}
