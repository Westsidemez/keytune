import { describe, expect, it } from "vitest";
import { Keyboard, changedRanges, runs } from "../src/shared/keyboard";
import { SimulatedKeyboard } from "../src/shared/simulator";
import { V5_MAX_ANSI } from "../src/shared/definitions";
import { encodeMacroSteps, splitMacroBuffer } from "../src/shared/macros";
import { kc, macroKey, withMods, MOD } from "../src/shared/keycodes";
import { FEATURE } from "../src/shared/protocol/commands";

const identity = { vendorId: 0x3434, productId: 0x0950, productName: "Keychron V5 Max" };

async function connect(options = {}) {
  const sim = new SimulatedKeyboard(V5_MAX_ANSI, options);
  const keyboard = await Keyboard.connect(sim, identity, V5_MAX_ANSI);
  return { sim, keyboard };
}

describe("Keyboard against the simulated V5 Max", () => {
  it("reads identity, features and limits", async () => {
    const { keyboard } = await connect();
    const s = keyboard.state;
    expect(s.info.viaProtocol).toBe(12);
    expect(s.info.keychronProtocol).toBe(2);
    expect(s.info.firmware).toBe("v1.1.1 Sep  2 2026");
    expect(s.info.mcu).toBe("STM32F401");
    expect(s.info.bootloader).toBe("STM32 DFU");
    expect(keyboard.hasFeature(FEATURE.KEYCHRON_RGB)).toBe(true);
    expect(s.layers).toBe(4);
    expect(s.macros).toMatchObject({ count: 16, bufferSize: 1567 });
  });

  it("reads the factory keymap and knob", async () => {
    const { keyboard } = await connect();
    expect(keyboard.state.keymap).toEqual(V5_MAX_ANSI.defaults!.layers);
    expect(keyboard.state.encoders).toEqual(V5_MAX_ANSI.defaults!.encoders);
  });

  it("maps every lit switch to an LED", async () => {
    const { keyboard, sim } = await connect();
    expect(keyboard.state.lighting?.ledCount).toBe(97);
    expect(keyboard.state.ledMap.filter((l) => l !== null)).toHaveLength(97);
    expect(keyboard.state.ledMap[0 * 19 + 0]).toBe(sim.ledFor(0, 0));
    expect(keyboard.state.ledMap[0 * 19 + 18]).toBeNull(); // knob press
  });

  it("reads lighting, zones and indicators", async () => {
    const { keyboard } = await connect();
    const l = keyboard.state.lighting!;
    expect(l).toMatchObject({ brightness: 200, effect: 24, speed: 127, hue: 0, sat: 255 });
    expect(l.perKey?.colors).toHaveLength(97);
    expect(l.mixed?.effectsPerRegion).toBe(5);
    expect(l.mixed?.zones[0][0]).toEqual({ effect: 5, hue: 0, sat: 255, speed: 127, time: 5000 });
    expect(l.indicators).toEqual({ supported: 3, disabled: 0, hsv: { h: 0, s: 0, v: 255 } });
  });

  it("reads advanced settings", async () => {
    const { keyboard } = await connect();
    const a = keyboard.state.advanced;
    expect(a.debounce).toEqual({ type: 0, time: 5 });
    expect(a.snapClicks).toHaveLength(20);
    expect(a.sleep).toEqual({ backlightOff: 30, idleSleep: 1800 });
    expect(a.nkro).toEqual({ enabled: false, settable: false, adaptive: true });
  });

  it("writes single keys and knob directions", async () => {
    const { keyboard, sim } = await connect();
    await keyboard.setKeycode(0, 3, 0, withMods(MOD.CTRL | MOD.SHIFT | MOD.ALT | MOD.GUI, kc("ESC")));
    expect(sim.keymap[3 * 19]).toBe(0x0f29);
    expect(keyboard.keycodeAt(0, 3, 0)).toBe(0x0f29);
    await keyboard.setEncoder(1, 0, true, kc("MNXT"));
    expect(keyboard.state.encoders[1][0]).toEqual([V5_MAX_ANSI.defaults!.encoders[1][0][0], kc("MNXT")]);
  });

  it("writes a whole keymap sending only changed bytes", async () => {
    const { keyboard, sim } = await connect();
    const next = keyboard.state.keymap.map((l) => l.slice());
    next[2][5] = kc("F13");
    next[3][100] = kc("F14");
    const before = sim.log.length;
    await keyboard.writeKeymap(next);
    const writes = sim.log.slice(before).filter((r) => r[0] === 0x13);
    expect(writes).toHaveLength(2);
    expect(Array.from(sim.keymap.slice(2 * 114 + 5, 2 * 114 + 6))).toEqual([kc("F13")]);
    expect(sim.keymap[3 * 114 + 100]).toBe(kc("F14"));
  });

  it("resets the keymap to factory defaults", async () => {
    const { keyboard } = await connect();
    await keyboard.setKeycode(0, 1, 1, kc("Q"));
    await keyboard.resetKeymap();
    expect(keyboard.state.keymap[0][1 * 19 + 1]).toBe(kc("1"));
  });

  it("stores macros and reads them back", async () => {
    const { keyboard, sim } = await connect();
    const data = keyboard.state.macros.data.slice();
    data[0] = encodeMacroSteps([{ type: "shortcut", mods: [kc("LALT"), kc("LGUI")], key: kc("BSLS") }]);
    data[5] = encodeMacroSteps([{ type: "text", text: "Kind regards,\nM" }]);
    await keyboard.writeMacros(data);
    const stored = splitMacroBuffer(sim.macroBuffer, 16);
    expect(Array.from(stored[0])).toEqual(Array.from(data[0]));
    expect(Array.from(stored[5])).toEqual(Array.from(data[5]));
    expect(keyboard.macroBytesUsed()).toBe(data[0].length + data[5].length + 16);
  });

  it("refuses macros larger than the keyboard's storage", async () => {
    const { keyboard } = await connect({ macroBufferSize: 32 });
    const data = keyboard.state.macros.data.slice();
    data[0] = encodeMacroSteps([{ type: "text", text: "x".repeat(40) }]);
    await expect(keyboard.writeMacros(data)).rejects.toThrow(/need/);
  });

  it("saves each RGB value so firmware persists it", async () => {
    const { keyboard, sim } = await connect();
    await keyboard.setBrightness(120);
    await keyboard.setEffect(5);
    await keyboard.setSpeed(40);
    await keyboard.setColor(170, 200);
    expect(sim.rgb).toMatchObject({ v: 120, mode: 5, speed: 40, h: 170, s: 200 });
    expect(sim.saves.rgbMatrix).toBe(4);
  });

  it("paints per-key colours in contiguous runs", async () => {
    const { keyboard, sim } = await connect();
    const changes = new Map([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 40].map((i) => [i, { h: 85, s: 255, v: 255 }] as const));
    const before = sim.log.length;
    await keyboard.setPerKeyColors(changes);
    const writes = sim.log.slice(before).filter((r) => r[0] === 0xa8 && r[1] === 0x0a);
    expect(writes.map((r) => [r[2], r[3]])).toEqual([
      [0, 9],
      [9, 2],
      [40, 1],
    ]);
    expect(sim.perKey[10]).toEqual({ h: 85, s: 255, v: 255 });
    await keyboard.saveKeychronLighting();
    expect(sim.saves.keychronRgb).toBe(1);
  });

  it("edits mixed-lighting zones and timelines", async () => {
    const { keyboard, sim } = await connect();
    await keyboard.setMixedRegions(new Map([[3, 1], [4, 1]]));
    expect(sim.regions[3]).toBe(1);
    const timeline = [
      { effect: 5, hue: 0, sat: 255, speed: 127, time: 5000 },
      { effect: 11, hue: 0, sat: 255, speed: 90, time: 10000 },
      { effect: 1, hue: 20, sat: 230, speed: 0, time: 70000 },
    ];
    await keyboard.setMixedZone(0, timeline);
    expect(sim.effectList[0].slice(0, 3)).toEqual(timeline);
    expect(sim.effectList[0][3].effect).toBe(0);
    expect(keyboard.state.lighting?.mixed?.zones[0]).toHaveLength(5);
  });

  it("rejects mixed effects the firmware does not allow", async () => {
    const { keyboard } = await connect();
    await expect(keyboard.setMixedZone(1, [{ effect: 24, hue: 0, sat: 0, speed: 0, time: 1000 }])).rejects.toThrow(/rejected/);
  });

  it("updates indicators, debounce, snap click and sleep", async () => {
    const { keyboard, sim } = await connect();
    await keyboard.setIndicators(0b10, { h: 85, s: 255, v: 200 });
    expect(sim.indicators).toEqual({ disabled: 2, h: 85, s: 255, v: 200 });
    await keyboard.setDebounce(2, 8);
    expect(sim.debounce).toEqual({ type: 2, time: 8 });
    const pairs = keyboard.state.advanced.snapClicks!.slice();
    pairs[0] = { type: 2, keys: [kc("A"), kc("D")] };
    pairs[12] = { type: 1, keys: [kc("W"), kc("S")] };
    await keyboard.setSnapClicks(pairs);
    expect(sim.snapClicks[0]).toEqual({ type: 2, keys: [kc("A"), kc("D")] });
    expect(sim.snapClicks[12]).toEqual({ type: 1, keys: [kc("W"), kc("S")] });
    expect(sim.saves.snapClick).toBe(1);
    await keyboard.setSleep({ backlightOff: 60, idleSleep: 600 });
    expect(sim.lpm).toEqual({ backlit: 60, idle: 600 });
    await expect(keyboard.setSleep({ backlightOff: 1, idleSleep: 600 })).rejects.toThrow(/rejected/);
  });

  it("follows layer changes the keyboard announces", async () => {
    const { keyboard, sim } = await connect();
    let changes = 0;
    keyboard.subscribe(() => changes++);
    sim.notifyLayers(2, 3);
    await new Promise((r) => setTimeout(r, 0));
    expect(keyboard.state.activeLayers).toEqual({ defaultLayer: 2, topLayer: 3 });
    expect(changes).toBe(1);
  });

  it("reads which switches are pressed", async () => {
    const { keyboard, sim } = await connect();
    sim.pressed.add("2,1").add("5,6").add("0,18");
    const m = await keyboard.matrixState();
    expect(m).toHaveLength(6);
    expect(m[2][1]).toBe(true);
    expect(m[5][6]).toBe(true);
    expect(m[0][18]).toBe(true);
    expect(m.flat().filter(Boolean)).toHaveLength(3);
  });

  it("assigns macros to keys", async () => {
    const { keyboard, sim } = await connect();
    await keyboard.setKeycode(0, 1, 15, macroKey(3));
    expect(sim.keymap[1 * 19 + 15]).toBe(0x7703);
  });

  it("survives a dropped reply", async () => {
    const sim = new SimulatedKeyboard(V5_MAX_ANSI, { dropReplies: 1 });
    const keyboard = await Keyboard.connect(sim, identity, V5_MAX_ANSI);
    expect(keyboard.state.info.viaProtocol).toBe(12);
  });
});

describe("write planning", () => {
  it("merges nearby differences", () => {
    const a = new Uint8Array(40);
    const b = a.slice();
    b[2] = 1;
    b[5] = 1;
    b[30] = 1;
    expect(changedRanges(a, b)).toEqual([
      [2, 6],
      [30, 31],
    ]);
  });

  it("groups indices into runs", () => {
    expect(runs([5, 1, 2, 3, 9, 3])).toEqual([
      [1, 4],
      [5, 6],
      [9, 10],
    ]);
  });
});
