// Regenerates src/shared/data/* from a checkout of Keychron's QMK fork.
// Usage: node scripts/generate-firmware-data.mjs <path-to-qmk_firmware>
// The generated files are committed; the build never needs the firmware tree.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fw = process.argv[2];
if (!fw) throw new Error("Pass the qmk_firmware checkout path");
const out = path.join(root, "src/shared/data");

// --- keycodes.h: NAME = 0x1234 and ALIAS = NAME entries -------------------
const header = fs.readFileSync(path.join(fw, "quantum/keycodes.h"), "utf8");
const values = {};
const aliases = {};
for (const match of header.matchAll(/^\s+([A-Z][A-Z0-9_]+)\s*=\s*(0x[0-9A-Fa-f]+|[A-Z][A-Z0-9_]+)\s*,/gm)) {
  const [, name, rhs] = match;
  if (rhs.startsWith("0x")) values[name] = parseInt(rhs, 16);
  else aliases[name] = rhs;
}
// Resolve alias chains.
for (const [alias, target] of Object.entries(aliases)) {
  let t = target;
  for (let i = 0; i < 8 && !(t in values) && t in aliases; i++) t = aliases[t];
  if (t in values) aliases[alias] = t;
  else delete aliases[alias];
}
fs.writeFileSync(
  path.join(out, "qmk-keycodes.json"),
  JSON.stringify({ source: "quantum/keycodes.h (Keychron qmk_firmware 2025q3)", values, aliases }, null, 0) + "\n",
);

// --- V5 Max definitions and default keymaps --------------------------------
const kbRoot = path.join(fw, "keyboards/keychron/v5_max");
const lookup = (name) => {
  const custom = {
    KC_LOPTN: 0x7e00, KC_ROPTN: 0x7e01, KC_LCMMD: 0x7e02, KC_RCMMD: 0x7e03,
    KC_MCTRL: 0x7e04, KC_LNPAD: 0x7e05, KC_TASK: 0x7e06, KC_FILE: 0x7e07,
    KC_SNAP: 0x7e08, KC_CTANA: 0x7e09, KC_SIRI: 0x7e0a, BT_HST1: 0x7e0b,
    BT_HST2: 0x7e0c, BT_HST3: 0x7e0d, P2P4G: 0x7e0e, BAT_LVL: 0x7e0f,
    _______: 0x0001, XXXXXXX: 0x0000,
  };
  if (name in custom) return custom[name];
  const mo = /^MO\((\d+)\)$/.exec(name);
  if (mo) return 0x5220 | Number(mo[1]);
  if (name === "FN_MAC") return 0x5221;
  if (name === "FN_WIN") return 0x5223;
  if (name in values) return values[name];
  if (name in aliases) return values[aliases[name]];
  throw new Error(`Unknown keycode ${name}`);
};

const models = [];
for (const variant of ["ansi_encoder", "iso_encoder", "jis_encoder"]) {
  const kbJson = JSON.parse(fs.readFileSync(path.join(kbRoot, variant, "keyboard.json"), "utf8"));
  const via = JSON.parse(fs.readFileSync(path.join(kbRoot, "via_json", `v5_max_${variant}.json`), "utf8"));
  const [layoutName, layout] = Object.entries(kbJson.layouts)[0];
  const keymapSource = fs.readFileSync(path.join(kbRoot, variant, "keymaps/keychron/keymap.c"), "utf8");
  const layers = [];
  for (const m of keymapSource.matchAll(new RegExp(`\\[\\w+\\]\\s*=\\s*${layoutName}\\(([\\s\\S]*?)\\)\\s*,?\\s*\\n`, "g"))) {
    // Split on commas that are not inside parentheses.
    const args = [];
    let depth = 0, cur = "";
    for (const ch of m[1]) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) { args.push(cur.trim()); cur = ""; } else cur += ch;
    }
    if (cur.trim()) args.push(cur.trim());
    if (args.length !== layout.layout.length) throw new Error(`${variant}: ${args.length} keycodes for ${layout.layout.length} keys`);
    const layer = Array(via.matrix.rows * via.matrix.cols).fill(0);
    args.forEach((name, i) => {
      const [r, c] = layout.layout[i].matrix;
      layer[r * via.matrix.cols + c] = lookup(name);
    });
    layers.push(layer);
  }
  const enc = [];
  for (const m of keymapSource.matchAll(/ENCODER_CCW_CW\((\w+),\s*(\w+)\)/g)) enc.push([[lookup(m[1]), lookup(m[2])]]);
  models.push({ variant, definition: via, defaults: { layers, encoders: enc } });
}
fs.writeFileSync(
  path.join(out, "v5-max.json"),
  JSON.stringify({ source: "keyboards/keychron/v5_max (Keychron qmk_firmware 2025q3, GPL-2.0)", models }, null, 0) + "\n",
);
console.log(`keycodes: ${Object.keys(values).length} values, ${Object.keys(aliases).length} aliases; models: ${models.length}`);
