import { describe, expect, it } from "vitest";
import {
  actionsToSteps,
  decodeMacro,
  decodeMacroSteps,
  encodeActions,
  encodeMacroSteps,
  joinMacroBuffer,
  splitMacroBuffer,
  stepsToActions,
  type MacroStep,
} from "../src/shared/macros";
import { kc } from "../src/shared/keycodes";

const bytes = (...values: number[]) => Uint8Array.from(values);
const LALT = kc("LALT");
const LGUI = kc("LGUI");
const BSLS = kc("BSLS");

describe("macro encoding", () => {
  it("decodes the Launcher's press/release sequence into one shortcut", () => {
    // L Alt down, L Win down, \ down, \ up, Win up, Alt up — as in the Launcher screenshot.
    const launcher = bytes(1, 2, LALT, 1, 2, LGUI, 1, 2, BSLS, 1, 3, BSLS, 1, 3, LGUI, 1, 3, LALT);
    expect(decodeMacroSteps(launcher)).toEqual([{ type: "shortcut", mods: [LALT, LGUI], key: BSLS }]);
  });

  it("encodes shortcuts as press, tap, release in reverse order", () => {
    const encoded = encodeMacroSteps([{ type: "shortcut", mods: [LALT, LGUI], key: BSLS }]);
    expect(Array.from(encoded)).toEqual([1, 2, LALT, 1, 2, LGUI, 1, 1, BSLS, 1, 3, LGUI, 1, 3, LALT]);
  });

  it("round-trips text, delays and taps", () => {
    const steps: MacroStep[] = [
      { type: "text", text: "Hello, world!\n" },
      { type: "delay", ms: 250 },
      { type: "tap", key: kc("ENT") },
    ];
    const encoded = encodeMacroSteps(steps);
    expect(Array.from(encoded.subarray(14, 21))).toEqual([1, 4, 0x32, 0x35, 0x30, 0x7c, 1]);
    expect(decodeMacroSteps(encoded)).toEqual(steps);
  });

  it("keeps unbalanced presses as separate steps", () => {
    const actions = decodeMacro(bytes(1, 2, LALT, 1, 1, kc("TAB")));
    expect(actionsToSteps(actions)).toEqual([
      { type: "down", key: LALT },
      { type: "tap", key: kc("TAB") },
    ]);
  });

  it("preserves bytes it does not understand", () => {
    const odd = bytes(0x41, 1, 9, 0x42);
    const actions = decodeMacro(odd);
    expect(actions).toEqual([
      { type: "text", text: "A" },
      { type: "raw", bytes: [1, 9] },
      { type: "text", text: "B" },
    ]);
    expect(Array.from(encodeActions(actions))).toEqual(Array.from(odd));
  });

  it("refuses text the keyboard cannot type", () => {
    expect(() => encodeMacroSteps([{ type: "text", text: "café" }])).toThrow(/cannot type "é"/);
  });

  it("refuses keycodes that do not fit a macro byte", () => {
    expect(() => encodeActions([{ type: "tap", key: 0x7e00 }])).toThrow(/basic keys/);
  });

  it("merges adjacent text steps when expanding", () => {
    expect(stepsToActions([{ type: "text", text: "ab" }, { type: "text", text: "cd" }])).toEqual([{ type: "text", text: "abcd" }]);
  });
});

describe("macro buffer", () => {
  it("splits NUL-separated macros and pads missing ones", () => {
    const buffer = bytes(0x61, 0, 0x62, 0x63, 0, 0, 0);
    const macros = splitMacroBuffer(buffer, 4);
    expect(macros.map((m) => Array.from(m))).toEqual([[0x61], [0x62, 0x63], [], []]);
  });

  it("joins macros into a zero-padded buffer", () => {
    const buffer = joinMacroBuffer([bytes(0x61), bytes(), bytes(0x62)], 8);
    expect(Array.from(buffer)).toEqual([0x61, 0, 0, 0x62, 0, 0, 0, 0]);
  });

  it("reports when macros do not fit", () => {
    expect(() => joinMacroBuffer([bytes(1, 2, 3, 4)], 4)).toThrow(/need 5 bytes/);
  });

  it("round-trips through split and join", () => {
    const macros = [encodeMacroSteps([{ type: "text", text: "hi" }]), new Uint8Array(), encodeMacroSteps([{ type: "delay", ms: 10 }])];
    const joined = joinMacroBuffer(macros, 64);
    expect(splitMacroBuffer(joined, 3).map((m) => Array.from(m))).toEqual(macros.map((m) => Array.from(m)));
  });
});
