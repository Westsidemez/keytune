import { describe, expect, it } from "vitest";
import { HeldKeys, type KeyOp } from "../src/shared/appKeyEvents";

const keys = (ops: KeyOp[]) => ops.map((o) => (o.kind === "wait" ? `wait ${o.ms}` : `${o.down ? "+" : "-"}${o.key} [${o.mods.join(",")}]`));

describe("app macro key events", () => {
  it("taps a shortcut by pressing and releasing its modifiers around the key", () => {
    expect(keys(new HeldKeys().plan([{ type: "shortcut", mods: ["cmd", "shift"], key: "4" }]))).toEqual([
      "+cmd [cmd]",
      "+shift [shift,cmd]",
      "+4 [shift,cmd]",
      "-4 [shift,cmd]",
      "-shift [cmd]",
      "-cmd []",
    ]);
  });

  it("keeps a held modifier on every key until it is released", () => {
    const held = new HeldKeys();
    const ops = held.plan([
      { type: "down", key: "shift" },
      { type: "shortcut", mods: [], key: "right" },
      { type: "delay", ms: 50 },
      { type: "shortcut", mods: [], key: "right" },
      { type: "up", key: "shift" },
      { type: "shortcut", mods: [], key: "a" },
    ]);
    expect(keys(ops)).toEqual(["+shift [shift]", "+right [shift]", "-right [shift]", "wait 50", "+right [shift]", "-right [shift]", "-shift []", "+a []", "-a []"]);
    expect(held.size).toBe(0);
  });

  it("doesn't press a held modifier again for a shortcut", () => {
    const held = new HeldKeys();
    const ops = held.plan([{ type: "down", key: "rcmd" }, { type: "shortcut", mods: ["cmd"], key: "tab" }]);
    expect(keys(ops)).toEqual(["+rcmd [cmd]", "+tab [cmd]", "-tab [cmd]"]);
  });

  it("releases whatever is still held at the end, keys before modifiers", () => {
    const held = new HeldKeys();
    held.plan([{ type: "down", key: "alt" }, { type: "down", key: "a" }, { type: "down", key: "a" }]);
    expect(keys(held.releaseAll())).toEqual(["-a [alt]", "-alt []"]);
    expect(held.size).toBe(0);
  });

  it("ignores releasing a key that isn't held", () => {
    expect(new HeldKeys().plan([{ type: "up", key: "shift" }])).toEqual([]);
  });
});
