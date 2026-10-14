// Settings and saved profiles under the app's user-data folder.

import fs from "node:fs";
import path from "node:path";
import { DEFAULT_SETTINGS, type Settings, type StoredProfile } from "../shared/ipc";
import { validateAppMacros } from "../shared/appMacros";

/** Automatic backups kept per keyboard; the oldest are removed first. */
export const BACKUPS_PER_KEYBOARD = 30;

export class Storage {
  private readonly settingsFile: string;
  private readonly profileDir: string;
  private cache: Settings | null = null;

  constructor(root: string) {
    this.settingsFile = path.join(root, "settings.json");
    this.profileDir = path.join(root, "profiles");
    fs.mkdirSync(this.profileDir, { recursive: true });
  }

  settings(): Settings {
    if (this.cache) return this.cache;
    let stored: Partial<Settings> = {};
    try {
      stored = JSON.parse(fs.readFileSync(this.settingsFile, "utf8"));
    } catch {
      // First run or unreadable file: start from defaults.
    }
    this.cache = { ...DEFAULT_SETTINGS, ...stored, appMacros: validateAppMacros(stored.appMacros) };
    return this.cache;
  }

  updateSettings(patch: Partial<Settings>): Settings {
    const next = { ...this.settings(), ...patch };
    writeAtomic(this.settingsFile, JSON.stringify(next, null, 2));
    this.cache = next;
    return next;
  }

  listProfiles(keyboard?: string): StoredProfile[] {
    const entries: StoredProfile[] = [];
    for (const name of fs.readdirSync(this.profileDir)) {
      if (!name.endsWith(".json")) continue;
      try {
        const entry = JSON.parse(fs.readFileSync(path.join(this.profileDir, name), "utf8")) as StoredProfile;
        if (keyboard && keyboardKey(entry) !== keyboard) continue;
        entries.push(entry);
      } catch {
        // Skip damaged files rather than hiding every other profile.
      }
    }
    return entries.sort((a, b) => b.profile.createdAt.localeCompare(a.profile.createdAt));
  }

  saveProfile(entry: StoredProfile): void {
    if (!/^[\w-]+$/.test(entry.id)) throw new Error("Invalid profile id");
    writeAtomic(path.join(this.profileDir, `${entry.id}.json`), JSON.stringify(entry));
    if (entry.kind === "backup") this.pruneBackups(keyboardKey(entry));
  }

  deleteProfile(id: string): void {
    if (!/^[\w-]+$/.test(id)) throw new Error("Invalid profile id");
    fs.rmSync(path.join(this.profileDir, `${id}.json`), { force: true });
  }

  private pruneBackups(keyboard: string): void {
    const backups = this.listProfiles(keyboard).filter((e) => e.kind === "backup");
    for (const old of backups.slice(BACKUPS_PER_KEYBOARD)) this.deleteProfile(old.id);
  }
}

export function keyboardKey(entry: StoredProfile): string {
  const k = entry.profile.keyboard;
  return `${k.vendorId.toString(16)}:${k.productId.toString(16)}`;
}

function writeAtomic(file: string, contents: string): void {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, contents);
  fs.renameSync(temp, file);
}
