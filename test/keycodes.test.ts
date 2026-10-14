import { describe, expect, it } from "vitest";
import {
  describe as describeKey,
  HYPER,
  kc,
  keycodeName,
  layerTap,
  macroKey,
  MO,
  MOD,
  modTap,
  OSM,
  parseKeycode,
  pickerCatalogue,
  TG,
  withMods,
} from "../src/shared/keycodes";
import { V5_MAX_ANSI } from "../src/shared/definitions";

const custom = V5_MAX_ANSI.definition.customKeycodes;

describe("keycodes", () => {
  it("matches QMK's numeric values", () => {
    expect(kc("A")).toBe(0x04);
    expect(kc("ESC")).toBe(0x29);
    expect(kc("LGUI")).toBe(0xe3);
    expect(kc("UG_TOGG")).toBe(0x7820);
    expect(kc("QK_BOOT")).toBe(0x7c00);
    expect(MO(1)).toBe(0x5221);
    expect(macroKey(15)).toBe(0x770f);
  });

  it("labels keys for Mac and Windows", () => {
    expect(describeKey(kc("LGUI"), { platform: "mac" }).label).toBe("⌘ Command");
    expect(describeKey(kc("LGUI"), { platform: "win" }).label).toBe("Win");
    expect(describeKey(withMods(MOD.GUI | MOD.SHIFT, kc("4")), { platform: "mac" }).label).toBe("⇧⌘4");
    expect(describeKey(withMods(MOD.CTRL, kc("C")), { platform: "win" }).label).toBe("Ctrl+C");
    expect(describeKey(withMods(HYPER, kc("F13"))).label).toBe("HyperF13");
  });

  it("describes tap/hold keys with both actions", () => {
    const k = describeKey(modTap(HYPER, kc("ESC")));
    expect(k.kind).toBe("tap-hold");
    expect(k.label).toBe("Esc");
    expect(k.hold).toBe("Hyper");
    expect(describeKey(layerTap(2, kc("SPC")), { layerNames: ["Mac", "Mac Fn", "Windows"] }).title).toBe("Tap: Space · Hold: Windows");
  });

  it("uses the keyboard's custom keycodes", () => {
    expect(describeKey(0x7e04, { customKeycodes: custom }).label).toBe("MCtl");
    expect(describeKey(0x7e0e, { customKeycodes: custom }).label).toBe("2.4G");
  });

  it("shows macro names when given", () => {
    expect(describeKey(macroKey(2), { macroNames: [undefined, undefined, "Right tab"] }).label).toBe("Right tab");
    expect(describeKey(macroKey(3)).label).toBe("M3");
  });

  it("round-trips names through the parser", () => {
    const samples = [
      0x0000,
      0x0001,
      kc("A"),
      kc("F24"),
      kc("PENT"),
      withMods(MOD.CTRL | MOD.SHIFT, kc("TAB")),
      withMods(MOD.GUI | MOD.RIGHT, kc("Q")),
      withMods(HYPER, kc("F13")),
      modTap(MOD.CTRL, kc("A")),
      modTap(HYPER, kc("ESC")),
      layerTap(1, kc("SPC")),
      MO(3),
      TG(2),
      OSM(MOD.SHIFT),
      macroKey(7),
      0x7e05,
      kc("UG_VALU"),
      kc("NK_TOGG"),
      kc("MS_BTN1"),
    ];
    for (const code of samples) {
      const name = keycodeName(code, custom);
      expect(parseKeycode(name, custom), name).toBe(code);
    }
  });

  it("parses common VIA spellings", () => {
    expect(parseKeycode("KC_LCTL")).toBe(0xe0);
    expect(parseKeycode("LCTL(KC_C)")).toBe(withMods(MOD.CTRL, kc("C")));
    expect(parseKeycode("LCMD(LSFT(KC_4))")).toBe(withMods(MOD.GUI | MOD.SHIFT, kc("4")));
    expect(parseKeycode("LT(1, KC_SPC)")).toBe(layerTap(1, kc("SPC")));
    expect(parseKeycode("LCTL_T(KC_ESC)")).toBe(modTap(MOD.CTRL, kc("ESC")));
    expect(parseKeycode("MACRO(3)")).toBe(macroKey(3));
    expect(parseKeycode("0x5221")).toBe(MO(1));
    expect(parseKeycode("CUSTOM(0)", custom)).toBe(0x7e00);
    expect(parseKeycode("Left Option", custom)).toBe(0x7e00);
    expect(withMods(MOD.CTRL, kc("A"))).toBe(0x0104);
    expect(withMods(MOD.GUI | MOD.SHIFT, kc("4"))).toBe(0x0a21);
    expect(parseKeycode("NOT_A_KEY")).toBeNull();
  });

  it("builds a picker with every category populated", () => {
    const categories = pickerCatalogue({ layers: 4, macros: 16, customKeycodes: custom });
    expect(categories.map((c) => c.id)).toEqual(["basic", "mac", "windows", "media", "macros", "layers", "mouse", "lighting", "keyboard"]);
    for (const c of categories) expect(c.groups.length, c.id).toBeGreaterThan(0);
    const macros = categories.find((c) => c.id === "macros")!;
    expect(macros.groups[0].entries).toHaveLength(16);
    const keyboard = categories.find((c) => c.id === "keyboard")!;
    expect(keyboard.groups[0].entries.map((e) => describeKey(e.code, { customKeycodes: custom }).label)).toEqual(["BTH1", "BTH2", "BTH3", "2.4G", "Batt"]);
  });
});
