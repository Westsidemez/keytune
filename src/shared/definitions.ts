// Keyboard models: bundled definitions plus any the user imports.

import v5Max from "./data/v5-max.json";
import { parseLayout, validateDefinition, vendorProductId, type KeyboardLayout, type ViaDefinition } from "./layout";

export interface EffectOption {
  id: number;
  name: string;
}

export interface KeyboardModel {
  definition: ViaDefinition;
  layout: KeyboardLayout;
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
  const effects = effectOptions(definition);
  const maxBuiltIn = effects.reduce((m, e) => Math.max(m, e.id), 0);
  const perKey = effects.find((e) => /per.?key/i.test(e.name));
  const mixed = effects.find((e) => /mix/i.test(e.name));
  const isKeychron = definition.vendorId.toLowerCase() === "0x3434";
  return {
    definition,
    layout,
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
  const found: EffectOption[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== "object") return;
    const item = node as { content?: unknown; options?: unknown; type?: string };
    if (item.type === "dropdown" && Array.isArray(item.content) && item.content[0] === "id_qmk_rgb_matrix_effect" && Array.isArray(item.options)) {
      item.options.forEach((option, index) => {
        if (Array.isArray(option)) found.push({ name: String(option[0]), id: Number(option[1]) });
        else if (typeof option === "string") found.push({ name: option, id: index });
      });
      return;
    }
    if (item.content) visit(item.content);
  };
  visit(definition.menus ?? []);
  return found.filter((e) => e.id !== 0);
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
