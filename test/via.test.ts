import { describe, expect, it } from "vitest";
import { Keyboard } from "../src/shared/keyboard";
import { SimulatedKeyboard } from "../src/shared/simulator";
import { ModelRegistry, buildModel, effectOptions, LIGHTING_CHANNEL } from "../src/shared/definitions";
import { parseLayout, validateDefinition } from "../src/shared/layout";

// The shape VIA's online library serves (www.usevia.app/definitions/v3/<id>.json).
const compiled = {
  name: "Example 6",
  vendorProductId: 0x4b42 * 0x10000 + 0x0006,
  firmwareVersion: 0,
  menus: ["qmk_rgblight"],
  keycodes: ["qmk_rgblight_keycodes"],
  matrix: { rows: 2, cols: 3 },
  layouts: {
    width: 3,
    height: 2,
    keys: [
      { row: 0, col: 0, x: 0, y: 0, r: 0, rx: 0, ry: 0, d: false, h: 1, w: 1, color: "accent" },
      { row: 0, col: 1, x: 1, y: 0, r: 0, rx: 0, ry: 0, d: false, h: 1, w: 1, color: "alpha" },
      { row: 0, col: 2, x: 2, y: 0, r: 0, rx: 0, ry: 0, d: false, h: 1, w: 1, color: "mod", ei: 0 },
      { row: 1, col: 0, x: 0, y: 1, r: 0, rx: 0, ry: 0, d: true, h: 1, w: 1, color: "alpha" },
    ],
    optionKeys: {
      0: {
        0: [{ row: 1, col: 1, x: 0, y: 1, r: 0, rx: 0, ry: 0, d: false, h: 1, w: 2, color: "mod" }],
        1: [
          { row: 1, col: 1, x: 0, y: 1, r: 0, rx: 0, ry: 0, d: false, h: 1, w: 1, color: "mod" },
          { row: 1, col: 2, x: 1, y: 1, r: 0, rx: 0, ry: 0, d: false, h: 1, w: 1.25, x2: -0.25, w2: 1.5, h2: 1, color: "mod" },
        ],
      },
    },
  },
};

describe("VIA library definitions", () => {
  it("reads the compiled layout, options and encoders", () => {
    const definition = validateDefinition(compiled);
    expect(definition).toMatchObject({ vendorId: "0x4B42", productId: "0x0006" });
    const layout = parseLayout(definition);
    expect(layout.keys.map((k) => k.id)).toEqual(["0,0", "0,1", "0,2", "1,1"]);
    expect(layout.encoders).toBe(1);
    expect(layout.keys[0].color).toBe("#777777");
    expect(layout.width).toBe(3);
    const other = parseLayout(definition, [1]);
    expect(other.keys.map((k) => k.id)).toEqual(["0,0", "0,1", "0,2", "1,1", "1,2"]);
    expect(other.keys[4].shape2).toEqual({ x: -0.25, y: 0, w: 1.5, h: 1 });
  });

  it("registers by vendor and product id", () => {
    const registry = new ModelRegistry([validateDefinition(compiled)]);
    expect(registry.find(0x4b42, 0x0006)?.definition.name).toBe("Example 6");
  });

  it("expands VIA's built-in lighting menus", () => {
    const model = buildModel(validateDefinition(compiled));
    expect(model.lightingChannel).toBe(LIGHTING_CHANNEL.RGBLIGHT);
    expect(model.effects[0]).toEqual({ id: 1, name: "Solid Color" });
    expect(model.effects).toHaveLength(42);
    expect(model.layerNames).toEqual([]);
    expect(model.perKeyMode).toBeUndefined();
  });

  it("tidies numbered firmware effect names", () => {
    const definition = validateDefinition({
      ...compiled,
      menus: [{ label: "Lighting", content: [{ label: "Effect", type: "dropdown", content: ["id_qmk_rgb_matrix_effect", 3, 2], options: [["00. None", 0], ["07. RAINBOW_MOVING_CHEVRON", 7]] }] }],
    });
    expect(effectOptions(definition)).toEqual([{ id: 7, name: "Rainbow Moving Chevron" }]);
    expect(buildModel(definition).lightingChannel).toBe(LIGHTING_CHANNEL.RGB_MATRIX);
  });

  it("reads v2 definitions that name their lighting", () => {
    const { menus: _menus, ...v2 } = compiled;
    expect(buildModel(validateDefinition({ ...v2, lighting: "qmk_backlight" })).lightingChannel).toBe(LIGHTING_CHANNEL.BACKLIGHT);
    expect(buildModel(validateDefinition({ ...v2, lighting: "none" })).lightingChannel).toBeUndefined();
  });
});

describe("Keyboard against a plain VIA keyboard", () => {
  const identity = { vendorId: 0x4b42, productId: 0x0006, productName: "Example 6" };

  it("connects without Keychron commands and drives underglow on channel 2", async () => {
    const model = buildModel(validateDefinition(compiled));
    const sim = new SimulatedKeyboard(model, { keychron: false, lightingChannel: 2 });
    const keyboard = await Keyboard.connect(sim, identity, model);
    const s = keyboard.state;
    expect(s.info.keychronProtocol).toBeUndefined();
    expect(s.info.features).toBe(0);
    expect(s.keymap).toHaveLength(4);
    expect(s.macros.count).toBe(16);
    expect(s.lighting).toMatchObject({ brightness: 200, effect: 24, adjustable: true });
    expect(s.lighting?.perKey).toBeUndefined();
    await keyboard.setEffect(3);
    expect(sim.rgb.mode).toBe(3);
    expect(sim.log.at(-2)?.slice(0, 4)).toEqual(Uint8Array.from([0x07, 2, 2, 3]));
    keyboard.close();
  });

  it("reads only brightness and effect from a plain backlight", async () => {
    const { menus: _menus, ...v2 } = compiled;
    const model = buildModel(validateDefinition({ ...v2, lighting: "qmk_backlight" }));
    const sim = new SimulatedKeyboard(model, { keychron: false, lightingChannel: 1 });
    const keyboard = await Keyboard.connect(sim, identity, model);
    expect(keyboard.state.lighting).toMatchObject({ brightness: 200, adjustable: false });
    expect(sim.log.some((r) => r[0] === 0x08 && r[1] === 1 && r[2] === 3)).toBe(false);
    keyboard.close();
  });

  it("skips lighting when the definition has none", async () => {
    const { menus: _menus, ...plain } = compiled;
    const model = buildModel(validateDefinition(plain));
    const sim = new SimulatedKeyboard(model, { keychron: false, lightingChannel: 0 });
    const keyboard = await Keyboard.connect(sim, identity, model);
    expect(keyboard.state.lighting).toBeUndefined();
    keyboard.close();
  });
});
