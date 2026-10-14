import { describe, expect, it } from "vitest";
import { Transport, TimeoutError, UnsupportedCommandError, type HidLink } from "../src/shared/protocol/transport";

/** A link whose replies are scripted per request. */
class ScriptedLink implements HidLink {
  sent: Uint8Array[] = [];
  private listener: ((r: Uint8Array) => void) | null = null;
  constructor(private readonly respond: (req: Uint8Array, index: number) => Uint8Array[] | null) {}
  async send(report: Uint8Array) {
    this.sent.push(report);
    const replies = this.respond(report, this.sent.length - 1);
    for (const r of replies ?? []) queueMicrotask(() => this.listener?.(r));
  }
  onReport(listener: (r: Uint8Array) => void) {
    this.listener = listener;
    return () => (this.listener = null);
  }
  push(bytes: number[]) {
    const r = new Uint8Array(32);
    r.set(bytes);
    this.listener?.(r);
  }
}

const report = (bytes: number[]) => {
  const r = new Uint8Array(32);
  r.set(bytes);
  return r;
};

describe("Transport", () => {
  it("pads requests to 32 bytes and resolves with the echoed reply", async () => {
    const link = new ScriptedLink((req) => [report([req[0], 0x00, 0x0c])]);
    const t = new Transport(link);
    const reply = await t.request([0x01]);
    expect(link.sent[0].length).toBe(32);
    expect(reply[2]).toBe(0x0c);
  });

  it("runs one request at a time, in order", async () => {
    const order: number[] = [];
    const link = new ScriptedLink((req) => {
      order.push(req[1]);
      return [report([req[0], req[1]])];
    });
    const t = new Transport(link);
    const results = await Promise.all([1, 2, 3].map((n) => t.request([0x04, n, 0, 0], { echo: 3 })));
    expect(order).toEqual([1, 2, 3]);
    expect(results.map((r) => r[1])).toEqual([1, 2, 3]);
  });

  it("routes unsolicited layer notifications to listeners, not to the pending request", async () => {
    const link = new ScriptedLink((req) => [report([0xa3, 2, 3]), report([req[0], 9])]);
    const t = new Transport(link);
    const seen: number[][] = [];
    t.onUnsolicited((r) => seen.push([r[0], r[1], r[2]]));
    const reply = await t.request([0x11]);
    expect(reply[1]).toBe(9);
    expect(seen).toEqual([[0xa3, 2, 3]]);
  });

  it("matches Keychron grouped commands on their sub-command", async () => {
    const link = new ScriptedLink((req) => [report([0xa7, 0x05, 0, 0, 1, 5]), report([req[0], req[1], 0, 7])]);
    const t = new Transport(link);
    const reply = await t.request([0xa7, 0x0b]);
    expect(reply[1]).toBe(0x0b);
    expect(reply[3]).toBe(7);
  });

  it("raises UnsupportedCommandError when firmware answers 0xFF", async () => {
    const link = new ScriptedLink(() => [report([0xff])]);
    const t = new Transport(link);
    await expect(t.request([0xa8, 0x01])).rejects.toBeInstanceOf(UnsupportedCommandError);
  });

  it("retries after a timeout and ignores the late reply to the first attempt", async () => {
    let calls = 0;
    const link = new ScriptedLink((req) => {
      calls++;
      return calls === 1 ? null : [report([req[0], req[1], req[2], req[3], 0xaa])];
    });
    const t = new Transport(link, { timeoutMs: 20, retries: 1 });
    const reply = await t.request([0x12, 0, 28, 28], { echo: 3 });
    expect(calls).toBe(2);
    expect(reply[4]).toBe(0xaa);
  });

  it("does not accept a stale reply whose echoed parameters differ", async () => {
    const link = new ScriptedLink((req) => (req[2] === 0 ? null : [report([0x12, 0, 0, 28, 0x11]), report([0x12, 0, 28, 28, 0x22])]));
    const t = new Transport(link, { timeoutMs: 20, retries: 0 });
    await expect(t.request([0x12, 0, 0, 28], { echo: 3 })).rejects.toBeInstanceOf(TimeoutError);
    const reply = await t.request([0x12, 0, 28, 28], { echo: 3 });
    expect(reply[4]).toBe(0x22);
  });

  it("gives up after the configured retries", async () => {
    const link = new ScriptedLink(() => null);
    const t = new Transport(link, { timeoutMs: 10, retries: 2 });
    await expect(t.request([0x01])).rejects.toBeInstanceOf(TimeoutError);
    expect(link.sent.length).toBe(3);
  });

  it("rejects pending work after close", async () => {
    const link = new ScriptedLink(() => null);
    const t = new Transport(link, { timeoutMs: 1000 });
    t.close();
    await expect(t.request([0x01])).rejects.toThrow(/disconnected/);
  });
});
