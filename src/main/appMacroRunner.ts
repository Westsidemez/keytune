// Runs app macros when their trigger shortcut fires.
// macOS: CoreGraphics key events via JavaScript for Automation (needs Accessibility);
// Windows: keybd_event via PowerShell. Keys are sent as single down/up events so they can be held.

import { clipboard, globalShortcut, shell, systemPreferences } from "electron";
import { execFile, spawn } from "node:child_process";
import { triggerAccelerator, type AppMacro, type AppMacroAction, type ShortcutMod } from "../shared/appMacros";
import { HeldKeys, isKeyAction, type KeyAction, type KeyOp } from "../shared/appKeyEvents";
import type { AppMacroStatus } from "../shared/ipc";

/** The trigger key is still held when the shortcut fires; wait for it to be released. */
const RELEASE_DELAY_MS = 180;
const SHELL_TIMEOUT_MS = 60_000;

const MAC_KEY_CODES: Record<string, number> = {
  a: 0, s: 1, d: 2, f: 3, h: 4, g: 5, z: 6, x: 7, c: 8, v: 9, b: 11, q: 12, w: 13, e: 14, r: 15, y: 16, t: 17,
  "1": 18, "2": 19, "3": 20, "4": 21, "6": 22, "5": 23, "=": 24, "9": 25, "7": 26, "-": 27, "8": 28, "0": 29,
  "]": 30, o: 31, u: 32, "[": 33, i: 34, p: 35, return: 36, l: 37, j: 38, "'": 39, k: 40, ";": 41, "\\": 42,
  ",": 43, "/": 44, n: 45, m: 46, ".": 47, tab: 48, space: 49, "`": 50, delete: 51, escape: 53,
  f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97, f7: 98, f8: 100, f9: 101, f10: 109, f11: 103, f12: 111,
  f13: 105, f14: 107, f15: 113, f16: 106, f17: 64, f18: 79, f19: 80, f20: 90,
  cmd: 55, rcmd: 54, shift: 56, rshift: 60, alt: 58, ralt: 61, ctrl: 59, rctrl: 62,
  home: 115, pageup: 116, forwarddelete: 117, end: 119, pagedown: 121, left: 123, right: 124, down: 125, up: 126,
};

const MAC_FLAGS: Record<ShortcutMod, number> = { shift: 0x20000, ctrl: 0x40000, alt: 0x80000, cmd: 0x100000 };

/** Windows virtual-key codes. */
const WIN_VK: Record<string, number> = (() => {
  const map: Record<string, number> = {
    return: 0x0d, tab: 0x09, space: 0x20, delete: 0x08, escape: 0x1b, forwarddelete: 0x2e, home: 0x24, end: 0x23, pageup: 0x21, pagedown: 0x22,
    left: 0x25, up: 0x26, right: 0x27, down: 0x28, "-": 0xbd, "=": 0xbb, "[": 0xdb, "]": 0xdd, "\\": 0xdc, ";": 0xba, "'": 0xde, "`": 0xc0, ",": 0xbc, ".": 0xbe, "/": 0xbf,
    ctrl: 0xa2, rctrl: 0xa3, shift: 0xa0, rshift: 0xa1, alt: 0xa4, ralt: 0xa5, cmd: 0x5b, rcmd: 0x5c,
  };
  for (const c of "abcdefghijklmnopqrstuvwxyz") map[c] = c.toUpperCase().charCodeAt(0);
  for (const c of "0123456789") map[c] = c.charCodeAt(0);
  for (let i = 1; i <= 24; i++) map[`f${i}`] = 0x6f + i;
  return map;
})();

export class AppMacroRunner {
  private macros: AppMacro[] = [];
  private failed: AppMacroStatus["failed"] = [];
  private running = false;

  constructor(private readonly log: (message: string) => void) {}

  /** Register global shortcuts for every macro, replacing the previous set. */
  register(macros: AppMacro[]): void {
    for (const m of this.macros) {
      try {
        globalShortcut.unregister(triggerAccelerator(m.trigger));
      } catch {
        // Trigger may never have registered.
      }
    }
    this.macros = macros;
    this.failed = [];
    for (const macro of macros) {
      let accelerator = "";
      try {
        accelerator = triggerAccelerator(macro.trigger);
        const ok = globalShortcut.register(accelerator, () => void this.run(macro.id));
        if (!ok) this.failed.push({ id: macro.id, name: macro.name, accelerator });
      } catch {
        this.failed.push({ id: macro.id, name: macro.name, accelerator });
      }
    }
  }

  status(): AppMacroStatus {
    return {
      accessibility: process.platform === "darwin" ? (systemPreferences.isTrustedAccessibilityClient(false) ? "granted" : "denied") : "not-needed",
      registered: this.macros.length - this.failed.length,
      failed: this.failed,
    };
  }

  requestAccessibility(): AppMacroStatus {
    if (process.platform === "darwin") systemPreferences.isTrustedAccessibilityClient(true);
    return this.status();
  }

  async run(id: string, delay = RELEASE_DELAY_MS): Promise<void> {
    const macro = this.macros.find((m) => m.id === id);
    if (!macro || this.running) return;
    this.running = true;
    try {
      await sleep(delay);
      await runActions(macro.actions);
    } catch (error) {
      this.log(`App macro "${macro.name}" failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    } finally {
      this.running = false;
    }
  }
}

/** Run a macro. Consecutive key steps go out in one batch; held keys are released at the end. */
export async function runActions(actions: AppMacroAction[], post: (ops: KeyOp[]) => Promise<void> = postKeys): Promise<void> {
  const held = new HeldKeys();
  let batch: KeyAction[] = [];
  const flush = async () => {
    if (!batch.length) return;
    const ops = held.plan(batch);
    batch = [];
    await post(ops);
  };
  try {
    for (const action of actions) {
      if (isKeyAction(action)) {
        batch.push(action);
        continue;
      }
      await flush();
      if (action.type === "open") await openTarget(action.target);
      else if (action.type === "shell") await runShell(action.command);
      else if (action.type === "text") {
        // Pasting handles any characters (emoji, accents) and long text instantly.
        const previous = clipboard.readText();
        clipboard.writeText(action.text);
        await post(held.plan([{ type: "shortcut", mods: [process.platform === "darwin" ? "cmd" : "ctrl"], key: "v" }]));
        await sleep(350);
        if (clipboard.readText() === action.text) clipboard.writeText(previous);
      }
    }
    await flush();
  } finally {
    if (held.size) await post(held.releaseAll()).catch(() => undefined);
  }
}

/** Send key events to the system. */
async function postKeys(ops: KeyOp[]): Promise<void> {
  if (!ops.length) return;
  const waitMs = ops.reduce((n, op) => n + (op.kind === "wait" ? op.ms : 0), 0);
  const timeout = 10_000 + waitMs;
  if (process.platform === "darwin") {
    const lines = ops.map((op) => {
      if (op.kind === "wait") return `delay(${op.ms / 1000});`;
      const code = MAC_KEY_CODES[op.key];
      if (code === undefined) throw new Error(`Unknown key ${op.key}`);
      const flags = op.mods.reduce((f, m) => f | MAC_FLAGS[m], 0);
      return `post(${code}, ${op.down}, ${flags}); delay(0.008);`;
    });
    const script = [
      "ObjC.import('CoreGraphics');",
      "function post(code, down, flags) { var e = $.CGEventCreateKeyboardEvent(null, code, down); $.CGEventSetFlags(e, flags); $.CGEventPost($.kCGHIDEventTap, e); }",
      ...lines,
    ].join("\n");
    await execFileAsync("osascript", ["-l", "JavaScript", "-e", script], timeout);
    return;
  }
  if (process.platform === "win32") {
    const lines = ops.map((op) => {
      if (op.kind === "wait") return `Start-Sleep -Milliseconds ${Math.round(op.ms)}`;
      const vk = WIN_VK[op.key];
      if (vk === undefined) throw new Error(`Unknown key ${op.key}`);
      return `[W.K]::keybd_event(${vk}, 0, ${op.down ? 0 : 2}, [UIntPtr]::Zero); Start-Sleep -Milliseconds 8`;
    });
    const script = [`Add-Type -Name K -Namespace W -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);'`, ...lines].join("; ");
    await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], timeout);
    return;
  }
  throw new Error("App macro key presses are not supported on this system");
}

async function openTarget(target: string): Promise<void> {
  const t = target.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t) || t.startsWith("mailto:")) {
    await shell.openExternal(t);
  } else if (t.startsWith("/") || t.startsWith("~") || /^[A-Za-z]:\\/.test(t)) {
    const error = await shell.openPath(t.replace(/^~/, process.env.HOME ?? "~"));
    if (error) throw new Error(error);
  } else if (process.platform === "darwin") {
    await execFileAsync("open", ["-a", t]);
  } else {
    await shell.openPath(t);
  }
}

function runShell(command: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child =
      process.platform === "win32"
        ? spawn("cmd.exe", ["/d", "/s", "/c", command], { windowsHide: true })
        : spawn(process.env.SHELL || "/bin/zsh", ["-lc", command], { env: process.env });
    const timer = setTimeout(() => child.kill(), SHELL_TIMEOUT_MS);
    let stderr = "";
    child.stderr?.on("data", (d) => (stderr = (stderr + String(d)).slice(-2000)));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Command exited with ${code}${stderr ? `: ${stderr.trim()}` : ""}`));
    });
  });
}

function execFileAsync(file: string, args: string[], timeout = 10_000): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout }, (error, _stdout, stderr) => {
      if (error) reject(new Error(stderr?.trim() || error.message));
      else resolve();
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
