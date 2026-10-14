import { describe, expect, it } from "vitest";
import { MACRO_FILE_FORMAT, parseMacroFile, toKeytuneMacros } from "../src/shared/launcherMacros";
import { encodeMacroSteps } from "../src/shared/macros";
import { kc } from "../src/shared/keycodes";
import { parseAppAction, type AppMacro } from "../src/shared/appMacros";

describe("Keytune macro files", () => {
  const onboard = [
    encodeMacroSteps([{ type: "shortcut", mods: [kc("LGUI"), kc("LSFT")], key: kc("4") }]),
    new Uint8Array(),
    encodeMacroSteps([{ type: "text", text: "hello" }, { type: "delay", ms: 120 }, { type: "tap", key: kc("ENT") }]),
  ];
  const app: AppMacro[] = [
    {
      id: "a1",
      name: "Hold shift",
      trigger: 0x7f68,
      actions: [{ type: "down", key: "shift" }, { type: "delay", ms: 500 }, { type: "up", key: "shift" }, { type: "shortcut", mods: ["cmd"], key: "c" }],
    },
    { id: "a2", name: "Open notes", trigger: 0x7f69, actions: [{ type: "open", target: "Notes" }, { type: "shell", command: "echo hi" }] },
  ];

  it("round-trips onboard macros, names and app macros", () => {
    const file = JSON.parse(JSON.stringify(toKeytuneMacros(onboard, ["Screenshot", null, "Greeting"], app, { name: "Test", vendorId: 1, productId: 2 })));
    expect(file.format).toBe(MACRO_FILE_FORMAT);
    const read = parseMacroFile(file)!;
    expect(read.source).toBe("keytune");
    expect(read.macros).toEqual(onboard);
    expect(read.names).toEqual(["Screenshot", null, "Greeting"]);
    expect(read.appMacros).toEqual(app.map((m) => ({ name: m.name, actions: m.actions })));
  });

  it("reads a file with only app macros", () => {
    const read = parseMacroFile({ format: MACRO_FILE_FORMAT, version: 1, macros: [], appMacros: [{ name: "  ", actions: [{ type: "text", text: "x" }] }] })!;
    expect(read.macros).toEqual([]);
    expect(read.appMacros).toEqual([{ name: "Imported app macro", actions: [{ type: "text", text: "x" }] }]);
  });

  it("drops app actions it can't run", () => {
    expect(parseAppAction({ type: "launch-missiles" })).toBeNull();
    expect(parseAppAction({ type: "shortcut", mods: ["cmd", "hyper"], key: "v" })).toEqual({ type: "shortcut", mods: ["cmd"], key: "v" });
    expect(parseAppAction({ type: "delay", ms: 1e9 })).toEqual({ type: "delay", ms: 60_000 });
    expect(parseAppAction({ type: "shell" })).toBeNull();
  });
});
