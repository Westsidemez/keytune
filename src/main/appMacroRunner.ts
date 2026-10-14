// Runs app macros when their trigger shortcut fires.
// macOS: CoreGraphics key events via JavaScript for Automation (needs Accessibility);
// Windows: keybd_event via PowerShell. Keys are sent as single down/up events so they can be held.
// Both run in one long-lived helper process, so a macro doesn't pay for starting a script each time.

import { clipboard, globalShortcut, shell, systemPreferences } from "electron";
import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { triggerAccelerator, type AppMacro, type AppMacroAction, type ShortcutMod } from "../shared/appMacros";
import { HeldKeys, isKeyAction, type KeyAction, type KeyOp } from "../shared/appKeyEvents";
import type { AppMacroStatus } from "../shared/ipc";

/** The trigger keys are still down when the shortcut fires; wait (at most this long) for them to be released. */
const RELEASE_WAIT_MAX_MS = 400;
/** Time the target app gets to read a pasted text before the clipboard is restored. */
const PASTE_SETTLE_MS = 350;
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
const MAC_MOD_MASK = 0x1e0000;

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
/** Windows generic Ctrl, Alt, Shift and both Windows keys. */
const WIN_MOD_VKS = [0x11, 0x12, 0x10, 0x5b, 0x5c];

/** A request to the key helper: wait for keys to be let go, then post key events ([code, down, flags] or [-ms] to wait). */
interface KeyRequest {
  release?: { keys: number[]; mods: number; maxMs: number };
  ops: ([number, boolean, number] | [number])[];
}

// Reads one JSON request per line and answers "ok" or "err <message>".
const MAC_HELPER = String.raw`
ObjC.import('Foundation'); ObjC.import('CoreGraphics');
var input = $.NSFileHandle.fileHandleWithStandardInput, output = $.NSFileHandle.fileHandleWithStandardOutput, buf = '';
function reply(s) { output.writeData($(s + '\n').dataUsingEncoding($.NSUTF8StringEncoding)); }
function held(r) {
  if ($.CGEventSourceFlagsState(1) & r.mods) return true;
  for (var i = 0; i < r.keys.length; i++) if ($.CGEventSourceKeyState(1, r.keys[i])) return true;
  return false;
}
function perform(req) {
  if (req.release) { var end = Date.now() + req.release.maxMs; while (Date.now() < end && held(req.release)) delay(0.004); }
  for (var i = 0; i < req.ops.length; i++) {
    var op = req.ops[i];
    if (op.length === 1) { delay(op[0] / 1000); continue; }
    var e = $.CGEventCreateKeyboardEvent(null, op[0], op[1]);
    $.CGEventSetFlags(e, op[2]);
    $.CGEventPost($.kCGHIDEventTap, e);
    delay(0.003);
  }
}
// Load the CoreGraphics calls now rather than on the first macro.
held({ mods: 0, keys: [0] });
$.CGEventCreateKeyboardEvent(null, 0, true);
while (true) {
  var data = input.availableData;
  if (Number(data.length) === 0) break;
  buf += $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding).js;
  var nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    var line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    try { perform(JSON.parse(line)); reply('ok'); } catch (err) { reply('err ' + String(err).replace(/\n/g, ' ')); }
  }
}
`;

const WIN_HELPER = String.raw`
Add-Type -Name K -Namespace W -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra); [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vk);'
while ($null -ne ($line = [Console]::In.ReadLine())) {
  try {
    $req = ConvertFrom-Json $line
    if ($req.release) {
      $keys = @($req.release.keys)
      $sw = [Diagnostics.Stopwatch]::StartNew()
      while ($sw.ElapsedMilliseconds -lt $req.release.maxMs -and @($keys | Where-Object { [W.K]::GetAsyncKeyState($_) -band 0x8000 }).Count) { Start-Sleep -Milliseconds 4 }
    }
    foreach ($op in @($req.ops)) {
      if ($op.Count -eq 1) { Start-Sleep -Milliseconds $op[0]; continue }
      [W.K]::keybd_event($op[0], 0, $(if ($op[1]) { 0 } else { 2 }), [UIntPtr]::Zero)
      Start-Sleep -Milliseconds 3
    }
    [Console]::Out.WriteLine('ok')
  } catch { [Console]::Out.WriteLine('err ' + $_.Exception.Message) }
}
`;

/** The long-lived process that posts key events. Requests are answered in order. */
class KeyHelper {
  private child?: ChildProcessWithoutNullStreams;
  private pending: { resolve: () => void; reject: (e: Error) => void; timer: NodeJS.Timeout }[] = [];
  private out = "";

  /** Start the helper ahead of the first macro so it is already warm. */
  warm(): void {
    if (process.platform === "darwin" || process.platform === "win32") this.process();
  }

  send(req: KeyRequest): Promise<void> {
    const waitMs = req.ops.reduce((n, op) => n + (op.length === 1 ? op[0] : 0), 0) + (req.release?.maxMs ?? 0);
    const child = this.process();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error("Key helper stopped responding")), 10_000 + waitMs);
      this.pending.push({ resolve, reject, timer });
      child.stdin.write(`${JSON.stringify(req)}\n`);
    });
  }

  dispose(): void {
    this.child?.kill();
    this.child = undefined;
  }

  private process(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child;
    let child: ChildProcessWithoutNullStreams;
    if (process.platform === "darwin") child = spawn("osascript", ["-l", "JavaScript", "-e", MAC_HELPER]);
    else if (process.platform === "win32") child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", WIN_HELPER], { windowsHide: true });
    else throw new Error("App macro key presses are not supported on this system");
    this.child = child;
    this.out = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      this.out += chunk;
      let nl: number;
      while ((nl = this.out.indexOf("\n")) >= 0) {
        const line = this.out.slice(0, nl).trim();
        this.out = this.out.slice(nl + 1);
        const next = this.pending.shift();
        if (!next) continue;
        clearTimeout(next.timer);
        if (line === "ok") next.resolve();
        else next.reject(new Error(line.replace(/^err /, "")));
      }
    });
    child.stderr.on("data", (d) => (stderr = (stderr + String(d)).slice(-2000)));
    child.stdin.on("error", () => undefined);
    const ended = (reason: string) => {
      if (this.child !== child) return;
      this.child = undefined;
      this.rejectAll(new Error(stderr.trim() || reason));
    };
    child.on("error", (e) => ended(e.message));
    child.on("exit", (code) => ended(`Key helper exited with ${code}`));
    return child;
  }

  private fail(error: Error): void {
    this.dispose();
    this.rejectAll(error);
  }

  private rejectAll(error: Error): void {
    for (const p of this.pending.splice(0)) {
      clearTimeout(p.timer);
      p.reject(error);
    }
  }
}

const keyHelper = new KeyHelper();

/** The clipboard as it was before a macro pasted text, put back once the paste has been read. */
const pasted = { previous: undefined as string | undefined, text: "", at: 0, timer: undefined as NodeJS.Timeout | undefined };

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
    if (macros.length) {
      try {
        keyHelper.warm();
      } catch {
        // Unsupported system; running a macro reports it.
      }
    }
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

  /** Run a macro. `fromTrigger`: started by its shortcut, so wait for the trigger keys to be let go first. */
  async run(id: string, fromTrigger = true): Promise<void> {
    const macro = this.macros.find((m) => m.id === id);
    if (!macro || this.running) return;
    this.running = true;
    try {
      if (fromTrigger) await keyHelper.send({ release: triggerRelease(macro.trigger), ops: [] });
      await runActions(macro.actions);
    } catch (error) {
      this.log(`App macro "${macro.name}" failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    } finally {
      this.running = false;
    }
  }

  dispose(): void {
    keyHelper.dispose();
  }
}

/** Keys of a trigger the helper waits on: all modifiers plus the F key. */
function triggerRelease(trigger: number): KeyRequest["release"] & {} {
  const fKey = `f${13 + (trigger & 0xff) - 0x68}`;
  if (process.platform === "win32") return { keys: [...WIN_MOD_VKS, WIN_VK[fKey]], mods: 0, maxMs: RELEASE_WAIT_MAX_MS };
  const code = MAC_KEY_CODES[fKey];
  return { keys: code === undefined ? [] : [code], mods: MAC_MOD_MASK, maxMs: RELEASE_WAIT_MAX_MS };
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
        // Pasting handles any characters (emoji, accents) and long text instantly. Later key
        // events queue behind the paste, so only a second paste has to wait for the first to be read.
        if (pasted.timer) {
          clearTimeout(pasted.timer);
          pasted.timer = undefined;
          await sleep(pasted.at + PASTE_SETTLE_MS - Date.now());
        }
        if (pasted.previous === undefined) pasted.previous = clipboard.readText();
        clipboard.writeText(action.text);
        await post(held.plan([{ type: "shortcut", mods: [process.platform === "darwin" ? "cmd" : "ctrl"], key: "v" }]));
        pasted.text = action.text;
        pasted.at = Date.now();
        pasted.timer = setTimeout(restoreClipboard, PASTE_SETTLE_MS);
      }
    }
    await flush();
  } finally {
    if (held.size) await post(held.releaseAll()).catch(() => undefined);
  }
}

function restoreClipboard(): void {
  if (pasted.previous !== undefined && clipboard.readText() === pasted.text) clipboard.writeText(pasted.previous);
  pasted.previous = undefined;
  pasted.timer = undefined;
}

/** Send key events to the system. */
async function postKeys(ops: KeyOp[]): Promise<void> {
  if (!ops.length) return;
  const mac = process.platform === "darwin";
  const codes = mac ? MAC_KEY_CODES : WIN_VK;
  await keyHelper.send({
    ops: ops.map((op) => {
      if (op.kind === "wait") return [Math.round(op.ms)];
      const code = codes[op.key];
      if (code === undefined) throw new Error(`Unknown key ${op.key}`);
      return [code, op.down, mac ? op.mods.reduce((f, m) => f | MAC_FLAGS[m], 0) : 0];
    }),
  });
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
  return new Promise((r) => setTimeout(r, Math.max(0, ms)));
}
