import { describe, expect, it, vi } from "vitest";

const board = vi.hoisted(() => ({ text: "original" }));
vi.mock("electron", () => ({
  clipboard: { readText: () => board.text, writeText: (t: string) => (board.text = t) },
  globalShortcut: {},
  shell: {},
  systemPreferences: {},
}));

import { runActions } from "../src/main/appMacroRunner";
import type { KeyOp } from "../src/shared/appKeyEvents";

describe("app macro runner", () => {
  it("sends keys after a paste without waiting, then puts the clipboard back", async () => {
    const posted: string[] = [];
    const post = async (ops: KeyOp[]) => {
      posted.push(ops.map((o) => (o.kind === "key" ? `${o.down ? "+" : "-"}${o.key}` : "wait")).join(" ") + ` (${board.text})`);
    };
    const started = Date.now();
    await runActions([{ type: "text", text: "hello" }, { type: "shortcut", mods: [], key: "return" }], post);
    expect(Date.now() - started).toBeLessThan(100);
    expect(posted[1]).toBe("+return -return (hello)");
    expect(board.text).toBe("hello");
    await vi.waitFor(() => expect(board.text).toBe("original"), { timeout: 1000 });
  });

  it("lets one paste be read before the next text replaces it", async () => {
    const pastes: { text: string; at: number }[] = [];
    await runActions([{ type: "text", text: "one" }, { type: "text", text: "two" }], async () => {
      pastes.push({ text: board.text, at: Date.now() });
    });
    expect(pastes.map((p) => p.text)).toEqual(["one", "two"]);
    expect(pastes[1].at - pastes[0].at).toBeGreaterThanOrEqual(300);
    await vi.waitFor(() => expect(board.text).toBe("original"), { timeout: 1000 });
  });
});
