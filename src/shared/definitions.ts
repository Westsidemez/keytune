// Keyboard models: bundled definitions plus any the user imports.

import v5Max from "./data/v5-max.json";
import { parseLayout, validateDefinition, vendorProductId, type KeyboardLayout, type ViaDefinition } from "./layout";

export interface EffectOption {
  id: number;
  name: string;
}

/** VIA custom-value channels for QMK lighting. */
export const LIGHTING_CHANNEL = { BACKLIGHT: 1, RGBLIGHT: 2, RGB_MATRIX: 3 } as const;

export interface KeyboardModel {
  definition: ViaDefinition;
  layout: KeyboardLayout;
  /** VIA channel the lighting menu talks to; undefined when the definition has no lighting. */
  lightingChannel?: number;
  /** Factory keymap, [layer][row * cols + col], when known. */
  defaults?: { layers: number[][]; encoders: [number, number][][] };
  effects: EffectOption[];
  /** RGB matrix mode ids of Keychron's per-key and mixed effects. */
  perKeyMode?: number;
  mixedMode?: number;
  /** Layer names the factory keymap uses. */
  layerNames: string[];
  bundled: boolean;
}

const KEYCHRON_LAYER_NAMES = ["Mac", "Mac Fn", "Windows", "Windows Fn"];

export function buildModel(definition: ViaDefinition, extras: Partial<Pick<KeyboardModel, "defaults" | "layerNames" | "bundled">> = {}): KeyboardModel {
  const layout = parseLayout(definition);
  const lighting = lightingMenu(definition);
  const effects = lighting?.effects ?? [];
  const maxBuiltIn = effects.reduce((m, e) => Math.max(m, e.id), 0);
  const perKey = effects.find((e) => /per.?key/i.test(e.name));
  const mixed = effects.find((e) => /mix/i.test(e.name));
  const isKeychron = definition.vendorId.toLowerCase() === "0x3434";
  return {
    definition,
    layout,
    // Keychron firmware answers on the RGB matrix channel even when a definition leaves the menu out.
    lightingChannel: lighting?.channel ?? (isKeychron ? LIGHTING_CHANNEL.RGB_MATRIX : undefined),
    defaults: extras.defaults,
    effects: effects.filter((e) => e !== perKey && e !== mixed),
    perKeyMode: perKey?.id ?? (isKeychron && effects.length ? maxBuiltIn + 1 : undefined),
    mixedMode: mixed?.id ?? (isKeychron && effects.length ? maxBuiltIn + 2 : undefined),
    layerNames: extras.layerNames ?? (isKeychron ? KEYCHRON_LAYER_NAMES : []),
    bundled: extras.bundled ?? false,
  };
}

/** Effect names from the definition's lighting menu (VIA "id_qmk_rgb_matrix_effect" dropdown). */
export function effectOptions(definition: ViaDefinition): EffectOption[] {
  return lightingMenu(definition)?.effects ?? [];
}

// VIA's built-in menus ("menus": ["qmk_rgb_matrix"]), from the-via/reader's common-menus.
const RGB_MATRIX_EFFECTS = [
  "All Off", "Solid Color", "Alphas Mods", "Gradient Up/Down", "Gradient Left/Right", "Breathing", "Band Sat.", "Band Val.",
  "Pinwheel Sat.", "Pinwheel Val.", "Spiral Sat.", "Spiral Val.", "Cycle All", "Cycle Left/Right", "Cycle Up/Down",
  "Rainbow Moving Chevron", "Cycle Out/In", "Cycle Out/In Dual", "Cycle Pinwheel", "Cycle Spiral", "Dual Beacon",
  "Rainbow Beacon", "Rainbow Pinwheels", "Raindrops", "Jellybean Raindrops", "Hue Breathing", "Hue Pendulum", "Hue Wave",
  "Pixel Rain", "Pixel Flow", "Pixel Fractal", "Typing Heatmap", "Digital Rain", "Solid Reactive Simple", "Solid Reactive",
  "Solid Reactive Wide", "Solid Reactive Multi Wide", "Solid Reactive Cross", "Solid Reactive Multi Cross",
  "Solid Reactive Nexus", "Solid Reactive Multi Nexus", "Splash", "Multi Splash", "Solid Splash", "Solid Multi Splash",
];
const RGBLIGHT_EFFECTS = [
  "All Off", "Solid Color", "Breathing 1", "Breathing 2", "Breathing 3", "Breathing 4", "Rainbow Mood 1", "Rainbow Mood 2",
  "Rainbow Mood 3", "Rainbow Swirl 1", "Rainbow Swirl 2", "Rainbow Swirl 3", "Rainbow Swirl 4", "Rainbow Swirl 5",
  "Rainbow Swirl 6", "Snake 1", "Snake 2", "Snake 3", "Snake 4", "Snake 5", "Snake 6", "Knight 1", "Knight 2", "Knight 3",
  "Christmas", "Gradient 1", "Gradient 2", "Gradient 3", "Gradient 4", "Gradient 5", "Gradient 6", "Gradient 7",
  "Gradient 8", "Gradient 9", "Gradient 10", "RGB Test", "Alternating", "Twinkle 1", "Twinkle 2", "Twinkle 3", "Twinkle 4",
  "Twinkle 5", "Twinkle 6",
];
const BUILT_IN_MENUS: Record<string, { channel: number; effects: string[] }> = {
  qmk_rgb_matrix: { channel: LIGHTING_CHANNEL.RGB_MATRIX, effects: RGB_MATRIX_EFFECTS },
  qmk_rgblight: { channel: LIGHTING_CHANNEL.RGBLIGHT, effects: RGBLIGHT_EFFECTS },
  qmk_backlight_rgblight: { channel: LIGHTING_CHANNEL.RGBLIGHT, effects: RGBLIGHT_EFFECTS },
  qmk_backlight: { channel: LIGHTING_CHANNEL.BACKLIGHT, effects: ["Off", "Breathing"] },
};
const EFFECT_ID = /^id_qmk_(rgb_matrix|rgblight|backlight)_effect$/;

/** The definition's lighting channel and effects. RGB matrix wins over underglow, which wins over plain backlight. */
function lightingMenu(definition: ViaDefinition): { channel: number; effects: EffectOption[] } | undefined {
  const found: { channel: number; effects: EffectOption[] }[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node === "string") {
      const menu = BUILT_IN_MENUS[node];
      if (menu) found.push({ channel: menu.channel, effects: menu.effects.map((name, id) => ({ id, name })) });
      return;
    }
    if (!node || typeof node !== "object") return;
    const item = node as { content?: unknown; options?: unknown; type?: string };
    if (item.type === "dropdown" && Array.isArray(item.content) && EFFECT_ID.test(String(item.content[0])) && Array.isArray(item.options)) {
      const effects: EffectOption[] = [];
      item.options.forEach((option, index) => {
        if (Array.isArray(option)) effects.push({ name: effectName(String(option[0])), id: Number(option[1]) });
        else if (typeof option === "string") effects.push({ name: effectName(option), id: index });
      });
      found.push({ channel: Number(item.content[1]), effects });
      return;
    }
    if (item.content) visit(item.content);
  };
  visit(definition.menus ?? []);
  const best = found.sort((a, b) => b.channel - a.channel)[0];
  return best && { channel: best.channel, effects: best.effects.filter((e) => e.id !== 0) };
}

/** "07. RAINBOW_MOVING_CHEVRON" → "Rainbow Moving Chevron". */
function effectName(raw: string): string {
  const name = raw.replace(/^\s*\d+\s*[.)]\s*/, "").trim();
  if (!/^[A-Z0-9_ ]+$/.test(name) || !/[A-Z]/.test(name)) return name;
  return name
    .toLowerCase()
    .split(/[_ ]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

const bundled: KeyboardModel[] = (v5Max.models as unknown as { definition: ViaDefinition; defaults: KeyboardModel["defaults"] }[]).map((m) =>
  buildModel(m.definition, { defaults: m.defaults, bundled: true }),
);

export class ModelRegistry {
  private readonly models = new Map<number, KeyboardModel>();

  constructor(extra: ViaDefinition[] = []) {
    for (const m of bundled) this.models.set(vendorProductId(m.definition), m);
    for (const d of extra) this.add(d);
  }

  add(definition: unknown): KeyboardModel {
    const valid = validateDefinition(definition);
    const model = buildModel(valid);
    this.models.set(vendorProductId(valid), model);
    return model;
  }

  find(vendorId: number, productId: number): KeyboardModel | undefined {
    return this.models.get(vendorId * 0x10000 + productId);
  }

  list(): KeyboardModel[] {
    return [...this.models.values()];
  }
}

export const V5_MAX_ANSI = bundled[0];

/** Where to find definition files by hand. */
export const KEYCHRON_DEFINITIONS = "https://www.keychron.com/pages/firmware-and-json-files-of-the-keychron-qmk-keyboards";
export const VIA_DEFINITIONS = "https://github.com/the-via/keyboards/tree/master/v3";
