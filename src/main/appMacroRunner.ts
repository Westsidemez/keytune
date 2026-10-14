// Runs app macros when their trigger shortcut fires.
// macOS: System Events (needs Accessibility) for keystrokes; Windows: SendKeys.

import { clipboard, globalShortcut, shell, systemPreferences } from "electron";
import { execFile, spawn } from "node:child_process";
import { triggerAccelerator, type AppMacro, type AppMacroAction, type ShortcutMod } from "../shared/appMacros";
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
  home: 115, pageup: 116, forwarddelete: 117, end: 119, pagedown: 121, left: 123, right: 124, down: 125, up: 126,
};

const WIN_KEYS: Record<string, string> = {
  return: "{ENTER}", tab: "{TAB}", space: " ", delete: "{BACKSPACE}", escape: "{ESC}", forwarddelete: "{DELETE}",
  home: "{HOME}", end: "{END}", pageup: "{PGUP}", pagedown: "{PGDN}", left: "{LEFT}", right: "{RIGHT}", up: "{UP}", down: "{DOWN}",
};

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
      for (const action of macro.actions) await this.perform(action);
    } catch (error) {
      this.log(`App macro "${macro.name}" failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    } finally {
      this.running = false;
    }
  }

  private async perform(action: AppMacroAction): Promise<void> {
    switch (action.type) {
      case "delay":
        await sleep(Math.max(0, Math.min(60_000, action.ms)));
        return;
      case "open":
        await openTarget(action.target);
        return;
      case "shell":
        await runShell(action.command);
        return;
      case "text":
        await pasteText(action.text);
        return;
      case "shortcut":
        await pressShortcut(action.mods, action.key);
        return;
    }
  }
}

async function pasteText(text: string): Promise<void> {
  // Pasting handles any characters (emoji, accents) and long text instantly.
  const previous = clipboard.readText();
  clipboard.writeText(text);
  await pressShortcut(process.platform === "darwin" ? ["cmd"] : ["ctrl"], "v");
  await sleep(350);
  if (clipboard.readText() === text) clipboard.writeText(previous);
}

async function pressShortcut(mods: ShortcutMod[], key: string): Promise<void> {
  const name = key.toLowerCase();
  if (process.platform === "darwin") {
    const code = MAC_KEY_CODES[name];
    if (code === undefined) throw new Error(`Unknown key ${key}`);
    const using = mods.map((m) => ({ cmd: "command down", ctrl: "control down", alt: "option down", shift: "shift down" })[m]);
    const script = `tell application "System Events" to key code ${code}${using.length ? ` using {${using.join(", ")}}` : ""}`;
    await execFileAsync("osascript", ["-e", script]);
    return;
  }
  if (process.platform === "win32") {
    if (mods.includes("cmd")) throw new Error("The Windows key cannot be pressed by app macros");
    const prefix = mods.map((m) => ({ ctrl: "^", alt: "%", shift: "+", cmd: "" })[m]).join("");
    const keyText = WIN_KEYS[name] ?? (/^f\d+$/.test(name) ? `{${name.toUpperCase()}}` : name.replace(/[+^%~(){}[\]]/g, (c) => `{${c}}`));
    const script = `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${(prefix + keyText).replace(/'/g, "''")}')`;
    await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
    return;
  }
  throw new Error("App macro shortcuts are not supported on this system");
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

function execFileAsync(file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 10_000 }, (error, _stdout, stderr) => {
      if (error) reject(new Error(stderr?.trim() || error.message));
      else resolve();
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
