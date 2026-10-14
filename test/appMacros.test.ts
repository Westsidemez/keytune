import { describe, expect, it } from "vitest";
import { APP_TRIGGERS, describeAppAction, isAppTrigger, newAppMacro, nextFreeTrigger, triggerAccelerator, validateAppMacros, type AppMacro } from "../src/shared/appMacros";
import { HYPER, MEH, kc, withMods } from "../src/shared/keycodes";
import { hidCodeFor } from "../src/renderer/hidCodes";

describe("app macro triggers", () => {
  it("offers 96 distinct triggers on F13–F24", () => {
    expect(APP_TRIGGERS).toHaveLength(96);
    expect(new Set(APP_TRIGGERS).size).toBe(96);
    for (const t of APP_TRIGGERS) {
      expect(t & 0xff).toBeGreaterThanOrEqual(kc("F13"));
      expect(t & 0xff).toBeLessThanOrEqual(kc("F24"));
      expect(t >> 8).toBeGreaterThan(0);
    }
  });

  it("starts with Hyper and Meh combinations", () => {
    expect(APP_TRIGGERS[0]).toBe(withMods(HYPER, kc("F13")));
    expect(APP_TRIGGERS[12]).toBe(withMods(MEH, kc("F13")));
  });

  it("converts triggers to Electron accelerators", () => {
    expect(triggerAccelerator(withMods(HYPER, kc("F13")))).toBe("Control+Alt+Shift+Super+F13");
    expect(triggerAccelerator(withMods(MEH, kc("F24")))).toBe("Control+Alt+Shift+F24");
    expect(() => triggerAccelerator(kc("A"))).toThrow();
  });

  it("allocates the next free trigger and stops when full", () => {
    const macros: AppMacro[] = [];
    for (let i = 0; i < APP_TRIGGERS.length; i++) macros.push(newAppMacro(macros, `m${i}`));
    expect(new Set(macros.map((m) => m.trigger)).size).toBe(96);
    expect(nextFreeTrigger(macros)).toBeUndefined();
    expect(() => newAppMacro(macros)).toThrow(/96/);
    expect(nextFreeTrigger(macros.slice(1))).toBe(APP_TRIGGERS[0]);
  });

  it("recognises triggers", () => {
    expect(isAppTrigger(APP_TRIGGERS[50])).toBe(true);
    expect(isAppTrigger(kc("F13"))).toBe(false);
  });

  it("drops malformed stored macros", () => {
    const good = { id: "a", name: "A", trigger: APP_TRIGGERS[0], actions: [] };
    expect(validateAppMacros([good, { id: 1 }, null, "x"])).toEqual([good]);
    expect(validateAppMacros("nope")).toEqual([]);
  });

  it("describes actions", () => {
    expect(describeAppAction({ type: "shortcut", mods: ["cmd", "shift"], key: "t" })).toBe("Press ⌘⇧T");
    expect(describeAppAction({ type: "delay", ms: 200 })).toBe("Wait 200 ms");
  });
});

describe("recording key codes", () => {
  it("maps browser key codes to HID usages", () => {
    expect(hidCodeFor("KeyA")).toBe(kc("A"));
    expect(hidCodeFor("Digit0")).toBe(kc("0"));
    expect(hidCodeFor("Digit1")).toBe(kc("1"));
    expect(hidCodeFor("F12")).toBe(kc("F12"));
    expect(hidCodeFor("F13")).toBe(kc("F13"));
    expect(hidCodeFor("Numpad1")).toBe(kc("P1"));
    expect(hidCodeFor("Numpad0")).toBe(kc("P0"));
    expect(hidCodeFor("MetaRight")).toBe(kc("RGUI"));
    expect(hidCodeFor("ArrowUp")).toBe(kc("UP"));
    expect(hidCodeFor("Fn")).toBeUndefined();
  });
});
