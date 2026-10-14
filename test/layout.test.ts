import { describe, expect, it } from "vitest";
import { ModelRegistry, V5_MAX_ANSI } from "../src/shared/definitions";
import { parseLayout, type ViaDefinition } from "../src/shared/layout";

describe("V5 Max layout", () => {
  const { layout } = V5_MAX_ANSI;

  it("has every switch from the firmware layout, including the knob press", () => {
    expect(layout.keys).toHaveLength(98);
    expect(new Set(layout.keys.map((k) => k.id)).size).toBe(98);
    const knob = layout.keys.find((k) => k.encoder !== undefined)!;
    expect(knob).toMatchObject({ row: 0, col: 18, encoder: 0 });
    expect(layout.encoders).toBe(1);
  });

  it("places keys where the firmware's keyboard.json puts them", () => {
    const at = (id: string) => layout.keys.find((k) => k.id === id)!;
    expect(at("0,0")).toMatchObject({ x: 0, y: 0, w: 1 });
    expect(at("1,13")).toMatchObject({ x: 13, y: 1.25, w: 2 }); // Backspace
    expect(at("3,12")).toMatchObject({ x: 12.75, y: 3.25, w: 2.25 }); // Enter
    expect(at("4,14")).toMatchObject({ x: 14.25, y: 4.5 }); // Up arrow, dropped a quarter
    expect(at("5,6")).toMatchObject({ x: 3.75, w: 6.25 }); // Space
    expect(at("4,18")).toMatchObject({ x: 18.5, h: 2 }); // Keypad Enter
    expect(layout.width).toBeCloseTo(19.5);
    expect(layout.height).toBeCloseTo(6.5);
  });

  it("knows the effects and Keychron's custom lighting modes", () => {
    expect(V5_MAX_ANSI.effects[0]).toEqual({ id: 1, name: "Solid Color" });
    expect(V5_MAX_ANSI.effects.at(-1)).toEqual({ id: 22, name: "Solid Splash" });
    expect(V5_MAX_ANSI.perKeyMode).toBe(23);
    expect(V5_MAX_ANSI.mixedMode).toBe(24);
  });

  it("ships factory keymaps for all four layers", () => {
    expect(V5_MAX_ANSI.defaults?.layers).toHaveLength(4);
    expect(V5_MAX_ANSI.defaults?.layers[0][0]).toBe(0x29); // Esc
    expect(V5_MAX_ANSI.defaults?.encoders[0][0]).toEqual([0xaa, 0xa9]); // Volume down / up
  });
});

describe("layout parsing", () => {
  const definition = (keymap: unknown[][]): ViaDefinition => ({
    name: "Test",
    vendorId: "0x1234",
    productId: "0x0001",
    matrix: { rows: 2, cols: 3 },
    layouts: { keymap },
  });

  it("applies KLE offsets and sizes to the next key only", () => {
    const l = parseLayout(definition([["0,0", { x: 0.5, w: 2 }, "0,1", "0,2"]]));
    expect(l.keys.map((k) => [k.x, k.w])).toEqual([
      [0, 1],
      [1.5, 2],
      [3.5, 1],
    ]);
  });

  it("filters layout options", () => {
    const keymap = [["0,0\n\n\n\n\n\n\n\n0,0", "0,1\n\n\n\n\n\n\n\n0,1"]];
    expect(parseLayout(definition(keymap)).keys.map((k) => k.id)).toEqual(["0,0"]);
    expect(parseLayout(definition(keymap), [1]).keys.map((k) => k.id)).toEqual(["0,1"]);
  });

  it("registers imported definitions by vendor and product id", () => {
    const registry = new ModelRegistry();
    expect(registry.find(0x3434, 0x0950)?.definition.name).toBe("Keychron V5 Max ANSI Knob");
    registry.add(definition([["0,0"]]));
    expect(registry.find(0x1234, 0x0001)?.definition.name).toBe("Test");
    expect(() => registry.add({ name: "Broken" })).toThrow(/vendorId/);
  });
});
