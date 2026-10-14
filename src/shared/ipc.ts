// Contract between the renderer and the main process (exposed as window.studio).

import type { AppMacro } from "./appMacros";
import type { Profile } from "./profile";
import type { ViaDefinition } from "./layout";

export type ThemePreference = "system" | "dark" | "light";
export type LabelPreference = "auto" | "mac" | "win";

export interface Settings {
  theme: ThemePreference;
  labels: LabelPreference;
  /** Keep running in the menu bar when the window closes, so app macros keep working. */
  keepInMenuBar: boolean;
  launchAtLogin: boolean;
  /** Show the Fn layer's function in the corner of each key. */
  showSecondLayer: boolean;
  /** Switch the on-screen layer when the keyboard reports a layer change. */
  followKeyboardLayer: boolean;
  /** Macro names, per keyboard ("vid:pid"), by onboard slot. */
  macroNames: Record<string, (string | null)[]>;
  appMacros: AppMacro[];
  definitions: ViaDefinition[];
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  labels: "auto",
  keepInMenuBar: true,
  launchAtLogin: false,
  showSecondLayer: true,
  followKeyboardLayer: true,
  macroNames: {},
  appMacros: [],
  definitions: [],
};

export interface StoredProfile {
  id: string;
  kind: "profile" | "backup";
  profile: Profile;
}

export interface AppMacroStatus {
  /** macOS Accessibility permission, needed to type text and press shortcuts. */
  accessibility: "granted" | "denied" | "not-needed";
  registered: number;
  failed: { id: string; name: string; accelerator: string }[];
}

export interface StudioHost {
  platform: "darwin" | "win32" | "linux";
  version: string;
  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  listProfiles(keyboard?: string): Promise<StoredProfile[]>;
  saveProfile(entry: StoredProfile): Promise<void>;
  deleteProfile(id: string): Promise<void>;
  exportJson(defaultName: string, data: unknown): Promise<boolean>;
  importJson(): Promise<unknown | null>;
  /** Pick a file, folder or app in Finder; returns its path. */
  chooseFile(): Promise<string | null>;
  /** Download a keyboard's definition from VIA's online library; null when it has none. */
  fetchViaDefinition(vendorId: number, productId: number): Promise<unknown | null>;
  appMacroStatus(): Promise<AppMacroStatus>;
  requestAccessibility(): Promise<AppMacroStatus>;
  runAppMacro(id: string): Promise<void>;
  /** Ask Chromium for HID devices with a user gesture; returns once permission is granted. */
  scanDevices(): Promise<void>;
  openExternal(url: string): Promise<void>;
  /** The newest macro export (e.g. "Keychron V5 Max Macro.json") in Downloads from the last 30 days. */
  findMacroDownload(): Promise<{ name: string; modified: number; data: unknown } | null>;
  /** While recording a macro, stop menu shortcuts (⌘Q, ⌘W…) from firing. */
  setRecording(on: boolean): Promise<void>;
  onCommand(listener: (command: string) => void): () => void;
}

declare global {
  interface Window {
    studio?: StudioHost;
  }
}
