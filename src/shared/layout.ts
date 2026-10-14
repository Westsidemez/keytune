// Keyboard definitions in VIA's JSON format, with the physical layout in
// keyboard-layout-editor (KLE) notation. Each key's first legend is its matrix
// position "row,col"; an "eN" legend marks rotary encoder N; a "group,choice"
// legend in slot 8 marks a layout option.

export interface ViaDefinition {
  name: string;
  vendorId: string;
  productId: string;
  matrix: { rows: number; cols: number };
  layouts: { keymap: unknown[][]; labels?: (string | string[])[] };
  customKeycodes?: { name: string; title?: string; shortName?: string }[];
  menus?: unknown[];
  keycodes?: string[];
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
  const keys: LayoutKey[] = [];
  let y = 0;
  let color: string | undefined;
  const rows = definition.layouts.keymap;
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
  const width = Math.max(0, ...keys.map((k) => k.x + Math.max(k.w, k.shape2 ? k.shape2.x + k.shape2.w : 0)));
  const height = Math.max(0, ...keys.map((k) => k.y + Math.max(k.h, k.shape2 ? k.shape2.y + k.shape2.h : 0)));
  const encoders = keys.reduce((n, k) => (k.encoder === undefined ? n : Math.max(n, k.encoder + 1)), 0);
  return { keys, width, height, encoders };
}

export function validateDefinition(value: unknown): ViaDefinition {
  const d = value as Partial<ViaDefinition>;
  if (!d || typeof d !== "object") throw new Error("Definition must be a JSON object");
  if (typeof d.name !== "string") throw new Error("Definition needs a name");
  if (typeof d.vendorId !== "string" || typeof d.productId !== "string") throw new Error("Definition needs vendorId and productId");
  if (!d.matrix || typeof d.matrix.rows !== "number" || typeof d.matrix.cols !== "number") throw new Error("Definition needs matrix rows and cols");
  if (!d.layouts || !Array.isArray(d.layouts.keymap)) throw new Error("Definition needs layouts.keymap");
  parseLayout(d as ViaDefinition);
  return d as ViaDefinition;
}

export function vendorProductId(definition: Pick<ViaDefinition, "vendorId" | "productId">): number {
  return parseInt(definition.vendorId, 16) * 0x10000 + parseInt(definition.productId, 16);
}
