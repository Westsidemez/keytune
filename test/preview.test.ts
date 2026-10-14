import { describe, expect, it } from "vitest";
import { Keyboard } from "../src/shared/keyboard";
import { SimulatedKeyboard } from "../src/shared/simulator";
import { V5_MAX_ANSI } from "../src/shared/definitions";
import { createPreview, painterFor } from "../src/renderer/preview";
import { hexToHsv, hsvHex, hsvToRgb, rgbToHsv } from "../src/renderer/color";

async function state() {
  const sim = new SimulatedKeyboard(V5_MAX_ANSI);
  const keyboard = await Keyboard.connect(sim, { vendorId: 0x3434, productId: 0x0950, productName: "V5 Max" }, V5_MAX_ANSI);
  return keyboard;
}

describe("lighting preview", () => {
  it("lights only keys that have an LED", async () => {
    const k = await state();
    const solid = V5_MAX_ANSI.effects.find((e) => /solid color/i.test(e.name))!;
    await k.setEffect(solid.id);
    await k.setColor(0, 255);
    await k.setBrightness(255);
    const s = k.state;
    const frame = createPreview({ layout: V5_MAX_ANSI.layout, model: V5_MAX_ANSI, lighting: s.lighting!, ledMap: s.ledMap, cols: s.cols })(0);
    const lit = [...frame.values()].filter(Boolean);
    expect(lit.length).toBe(s.lighting!.ledCount);
    expect(lit[0]).toEqual([255, 0, 0]);
  });

  it("shows per-key colours in per-key mode", async () => {
    const k = await state();
    await k.setEffect(V5_MAX_ANSI.perKeyMode!);
    await k.setPerKeyColors(new Map([[0, { h: 85, s: 255, v: 255 }]]));
    await k.setPerKeyType(0);
    await k.setBrightness(255);
    const s = k.state;
    const key = V5_MAX_ANSI.layout.keys.find((key) => key.row >= 0 && s.ledMap[key.row * s.cols + key.col] === 0)!;
    const frame = createPreview({ layout: V5_MAX_ANSI.layout, model: V5_MAX_ANSI, lighting: s.lighting!, ledMap: s.ledMap, cols: s.cols })(0);
    expect(frame.get(key.id)).toEqual(hsvToRgb({ h: 85, s: 255, v: 255 }));
  });

  it("turns everything off for effect 0", async () => {
    const k = await state();
    await k.setEffect(0);
    const s = k.state;
    const frame = createPreview({ layout: V5_MAX_ANSI.layout, model: V5_MAX_ANSI, lighting: s.lighting!, ledMap: s.ledMap, cols: s.cols })(1);
    expect([...frame.values()].every((c) => c === null)).toBe(true);
  });

  it("has a painter for every effect on the V5 Max", () => {
    for (const e of V5_MAX_ANSI.effects) expect(typeof painterFor(e.name)).toBe("function");
  });
});

describe("colour conversion", () => {
  it("round-trips hex and HSV in QMK units", () => {
    expect(hsvHex({ h: 0, s: 255, v: 255 })).toBe("#ff0000");
    expect(hexToHsv("#00ff00")).toEqual({ h: 85, s: 255, v: 255 });
    expect(hexToHsv("nope")).toBeNull();
    for (const rgb of [[255, 122, 61], [10, 200, 90], [0, 0, 0], [255, 255, 255]] as [number, number, number][]) {
      const back = hsvToRgb(rgbToHsv(rgb));
      back.forEach((c, i) => expect(Math.abs(c - rgb[i])).toBeLessThanOrEqual(4));
    }
  });
});
