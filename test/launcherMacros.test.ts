import { describe, expect, it } from "vitest";
import { parseMacroFile, toLauncherMacros } from "../src/shared/launcherMacros";
import { encodeMacroSteps } from "../src/shared/macros";
import { kc } from "../src/shared/keycodes";

describe("Keychron Launcher macro files", () => {
  it("reads Launcher's step lists", () => {
    // The shape Launcher writes to "<Keyboard> Macro.json".
    const file = [
      [
        [2, "KC_LCTL", "KC_LCTL"],
        [1, "KC_TAB", "KC_TAB"],
        [3, "KC_LCTL", "KC_LCTL"],
      ],
      [],
      [
        [5, "hello"],
        [4, 120],
        [1, "KC_ENTER", "KC_ENT"],
      ],
      [[6, ["KC_LGUI", "KC_SPC"]]],
    ];
    const result = parseMacroFile(file)!;
    expect(result.source).toBe("launcher");
    expect(result.unknown).toEqual([]);
    expect(result.macros[0]).toEqual(encodeMacroSteps([{ type: "shortcut", mods: [kc("LCTL")], key: kc("TAB") }]));
    expect(result.macros[1]).toEqual(new Uint8Array());
    expect(result.macros[2]).toEqual(encodeMacroSteps([{ type: "text", text: "hello" }, { type: "delay", ms: 120 }, { type: "tap", key: kc("ENT") }]));
    expect(result.macros[3]).toEqual(encodeMacroSteps([{ type: "down", key: kc("LGUI") }, { type: "down", key: kc("SPC") }, { type: "up", key: kc("SPC") }, { type: "up", key: kc("LGUI") }]));
  });

  it("accepts Launcher's long key names and reports ones it can't use", () => {
    const result = parseMacroFile([[[1, "Right Alt", "KC_RIGHT_ALT"], [1, "?", "KC_NOT_A_KEY"]]])!;
    expect(result.macros[0]).toEqual(encodeMacroSteps([{ type: "tap", key: kc("RALT") }]));
    expect(result.unknown).toEqual(["KC_NOT_A_KEY"]);
  });

  it("reads the { md5, macro, name } wrapper", () => {
    const result = parseMacroFile({ md5: "x", name: "Mine", macro: [[[1, "KC_A", "KC_A"]]] })!;
    expect(result.macros[0]).toEqual(encodeMacroSteps([{ type: "tap", key: kc("A") }]));
  });

  it("reads macros written as VIA code", () => {
    const result = parseMacroFile({ macros: [{ index: 2, name: "Next tab", code: "{+KC_LCTL}{KC_TAB}{-KC_LCTL}" }] })!;
    expect(result.source).toBe("via-code");
    expect(result.macros).toHaveLength(3);
    expect(result.names[2]).toBe("Next tab");
    expect(result.macros[2]).toEqual(encodeMacroSteps([{ type: "shortcut", mods: [kc("LCTL")], key: kc("TAB") }]));
    expect(parseMacroFile(["hi{KC_ENT}"])!.macros[0]).toEqual(encodeMacroSteps([{ type: "text", text: "hi" }, { type: "tap", key: kc("ENT") }]));
  });

  it("ignores files that aren't macros", () => {
    expect(parseMacroFile({ layers: [] })).toBeNull();
    expect(parseMacroFile(42)).toBeNull();
  });

  it("exports in a form it reads back", () => {
    const macros = [
      encodeMacroSteps([{ type: "shortcut", mods: [kc("LGUI"), kc("LSFT")], key: kc("4") }]),
      encodeMacroSteps([{ type: "text", text: "a b" }, { type: "delay", ms: 50 }]),
      new Uint8Array(),
    ];
    const file = JSON.parse(JSON.stringify(toLauncherMacros(macros)));
    expect(parseMacroFile(file)!.macros).toEqual(macros);
  });
});
