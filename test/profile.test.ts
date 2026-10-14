import { describe, expect, it } from "vitest";
import { Keyboard } from "../src/shared/keyboard";
import { SimulatedKeyboard } from "../src/shared/simulator";
import { V5_MAX_ANSI } from "../src/shared/definitions";
import { applyProfile, exportViaLayout, importViaLayout, macroToViaText, parseProfile, snapshot, viaTextToMacro } from "../src/shared/profile";
import { encodeMacroSteps } from "../src/shared/macros";
import { HYPER, kc, macroKey, modTap, MOD, withMods } from "../src/shared/keycodes";

const identity = { vendorId: 0x3434, productId: 0x0950, productName: "Keychron V5 Max" };

async function connect() {
  const sim = new SimulatedKeyboard(V5_MAX_ANSI);
  const keyboard = await Keyboard.connect(sim, identity, V5_MAX_ANSI);
  return { sim, keyboard };
}

async function customise(keyboard: Keyboard) {
  await keyboard.setKeycode(0, 3, 0, modTap(HYPER, kc("ESC")));
  await keyboard.setKeycode(1, 1, 16, macroKey(1));
  await keyboard.setEncoder(0, 0, true, kc("MNXT"));
  await keyboard.writeMacros([encodeMacroSteps([{ type: "text", text: "hello" }]), encodeMacroSteps([{ type: "shortcut", mods: [kc("LGUI")], key: kc("C") }])]);
  await keyboard.setPerKeyColors(new Map([[0, { h: 85, s: 255, v: 200 }], [5, { h: 170, s: 255, v: 255 }]]));
  await keyboard.setMixedRegions(new Map([[3, 1], [4, 1]]));
  await keyboard.setMixedZone(1, [{ effect: 3, hue: 20, sat: 255, speed: 100, time: 4000 }]);
  await keyboard.setBrightness(90);
  await keyboard.setColor(30, 200);
  await keyboard.setEffect(V5_MAX_ANSI.perKeyMode!);
  await keyboard.setDebounce(2, 8);
}

describe("profiles", () => {
  it("restores a full setup onto a factory-reset keyboard", async () => {
    const { keyboard } = await connect();
    await customise(keyboard);
    const saved = JSON.parse(JSON.stringify(snapshot(keyboard.state, "Work", ["Greeting", "Copy"])));
    const profile = parseProfile(saved);
    expect(profile.macros?.names).toEqual(expect.arrayContaining(["Greeting", "Copy"]));

    const fresh = await connect();
    await applyProfile(fresh.keyboard, profile);
    const a = keyboard.state;
    const b = fresh.keyboard.state;
    expect(b.keymap).toEqual(a.keymap);
    expect(b.encoders).toEqual(a.encoders);
    expect(b.macros.data).toEqual(a.macros.data);
    expect(b.lighting?.perKey).toEqual(a.lighting?.perKey);
    expect(b.lighting?.mixed?.regions).toEqual(a.lighting?.mixed?.regions);
    expect(b.lighting?.mixed?.zones).toEqual(a.lighting?.mixed?.zones);
    expect(b.lighting).toMatchObject({ brightness: 90, hue: 30, sat: 200, effect: V5_MAX_ANSI.perKeyMode });
    expect(b.advanced.debounce).toEqual({ type: 2, time: 8 });

    // The simulator's own memory agrees, so the writes really reached the "keyboard".
    expect(fresh.sim.keymap[3 * fresh.sim.cols]).toBe(modTap(HYPER, kc("ESC")));
    expect(fresh.sim.perKey[5]).toEqual({ h: 170, s: 255, v: 255 });
  });

  it("applies only the chosen sections", async () => {
    const { keyboard } = await connect();
    await customise(keyboard);
    const profile = snapshot(keyboard.state, "Work");
    const fresh = await connect();
    await applyProfile(fresh.keyboard, profile, ["lighting"]);
    expect(fresh.keyboard.state.keymap).toEqual(V5_MAX_ANSI.defaults!.layers);
    expect(fresh.keyboard.state.lighting?.brightness).toBe(90);
  });

  it("sends nothing when the keyboard already matches", async () => {
    const { keyboard, sim } = await connect();
    await customise(keyboard);
    const profile = snapshot(keyboard.state, "Same");
    const before = sim.log.length;
    await applyProfile(keyboard, profile, ["keymap", "macros", "advanced"]);
    expect(sim.log.length).toBe(before);
  });

  it("refuses a profile made for another keyboard", async () => {
    const { keyboard } = await connect();
    const profile = snapshot(keyboard.state, "Other");
    profile.keyboard.productId = 0x0951;
    await expect(applyProfile(keyboard, profile)).rejects.toThrow(/not Keychron V5 Max/);
  });

  it("rejects files that aren't profiles", () => {
    expect(() => parseProfile({ hello: 1 })).toThrow(/not a Keytune profile/);
  });
});

describe("VIA files", () => {
  it("writes and reads VIA macro text", () => {
    const bytes = encodeMacroSteps([
      { type: "text", text: "Hi {there}" },
      { type: "shortcut", mods: [kc("LCTL")], key: kc("C") },
      { type: "delay", ms: 120 },
      { type: "tap", key: kc("ENT") },
    ]);
    const text = macroToViaText(bytes);
    expect(text).toContain("{KC_ENT}");
    expect(text).toContain("{120}");
    expect(viaTextToMacro(text)).toEqual(bytes);
  });

  it("reads VIA chords as press-all, release-all", () => {
    expect(viaTextToMacro("{KC_LGUI,KC_SPC}")).toEqual(encodeMacroSteps([{ type: "down", key: kc("LGUI") }, { type: "down", key: kc("SPC") }, { type: "up", key: kc("SPC") }, { type: "up", key: kc("LGUI") }]));
  });

  it("round-trips a layout through VIA's format", async () => {
    const { keyboard } = await connect();
    await customise(keyboard);
    await keyboard.setKeycode(2, 2, 2, withMods(MOD.CTRL | MOD.SHIFT, kc("TAB")));
    const file = JSON.parse(JSON.stringify(exportViaLayout(keyboard.state, V5_MAX_ANSI.definition.customKeycodes)));
    const fresh = await connect();
    const { profile, unknown } = importViaLayout(file, fresh.keyboard.state, V5_MAX_ANSI.definition.customKeycodes);
    expect(unknown).toEqual([]);
    expect(profile.keymap).toEqual(keyboard.state.keymap);
    expect(profile.encoders).toEqual(keyboard.state.encoders);
    await applyProfile(fresh.keyboard, profile, ["keymap", "macros"]);
    expect(fresh.keyboard.state.macros.data).toEqual(keyboard.state.macros.data);
  });

  it("keeps the current key for unknown keycodes and reports them", async () => {
    const { keyboard } = await connect();
    const file = exportViaLayout(keyboard.state);
    file.layers[0][0] = "KC_DOES_NOT_EXIST";
    const { profile, unknown } = importViaLayout(file, keyboard.state);
    expect(unknown).toEqual(["KC_DOES_NOT_EXIST"]);
    expect(profile.keymap![0][0]).toBe(keyboard.state.keymap[0][0]);
  });

  it("refuses a layout for a different keyboard", async () => {
    const { keyboard } = await connect();
    const file = exportViaLayout(keyboard.state);
    file.vendorProductId = 0x12345678;
    expect(() => importViaLayout(file, keyboard.state)).toThrow(/different keyboard/);
  });
});
