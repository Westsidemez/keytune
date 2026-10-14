// App state, connection management and undoable actions.

import { useRef, useSyncExternalStore } from "react";
import { Keyboard, type KeyboardState } from "../shared/keyboard";
import { ModelRegistry, V5_MAX_ANSI, type KeyboardModel } from "../shared/definitions";
import { SimulatedKeyboard } from "../shared/simulator";
import { DEFAULT_SETTINGS, type AppMacroStatus, type Settings, type StudioHost } from "../shared/ipc";
import { snapshot, type Profile } from "../shared/profile";
import { encodeMacroSteps } from "../shared/macros";
import { HYPER, kc, macroKey, modTap, type Platform } from "../shared/keycodes";
import { WebHidLink, deviceKey, hidAvailable, rawHidDevices } from "./hid";

export type View = "keymap" | "lighting" | "macros" | "advanced" | "test" | "profiles" | "settings";

export type Selection = { kind: "key"; id: string } | { kind: "encoder"; index: number; action: "ccw" | "cw" | "press" } | null;

export interface Toast {
  id: number;
  message: string;
  kind: "info" | "success" | "error";
  action?: { label: string; run: () => void };
}

interface HistoryEntry {
  label: string;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

export interface ConnectionState {
  status: "unavailable" | "searching" | "connecting" | "connected" | "unsupported" | "error";
  message?: string;
  progress?: number;
  demo?: boolean;
  device?: { vendorId: number; productId: number; productName: string };
}

export interface StudioState {
  view: View;
  connection: ConnectionState;
  keyboard: Keyboard | null;
  kb: KeyboardState | null;
  model: KeyboardModel | null;
  layer: number;
  selection: Selection;
  settings: Settings;
  appMacroStatus: AppMacroStatus | null;
  undo: HistoryEntry[];
  redo: HistoryEntry[];
  toasts: Toast[];
  busy: string | null;
  paletteOpen: boolean;
  /** Bumped when stored profiles change, so lists reload. */
  profilesVersion: number;
}

let state: StudioState = {
  view: "keymap",
  connection: { status: hidAvailable() ? "searching" : "unavailable" },
  keyboard: null,
  kb: null,
  model: null,
  layer: 0,
  selection: null,
  settings: DEFAULT_SETTINGS,
  appMacroStatus: null,
  undo: [],
  redo: [],
  toasts: [],
  busy: null,
  paletteOpen: false,
  profilesVersion: 0,
};

const listeners = new Set<() => void>();

export function getState(): StudioState {
  return state;
}

export function setState(patch: Partial<StudioState> | ((s: StudioState) => Partial<StudioState>)): void {
  state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Select from the store. The result is cached per state, so selectors may build new objects. */
export function useStudio<T>(selector: (s: StudioState) => T): T {
  const cache = useRef<{ state: StudioState; value: T } | null>(null);
  return useSyncExternalStore(subscribe, () => {
    if (cache.current?.state === state) return cache.current.value;
    const value = selector(state);
    cache.current = { state, value };
    return value;
  });
}

/** Host bridge; a stand-in keeps the UI usable in a plain browser. */
export const host: StudioHost = window.studio ?? browserHost();

// --- toasts -------------------------------------------------------------------

let toastId = 0;
export function toast(message: string, kind: Toast["kind"] = "info", action?: Toast["action"]): void {
  const id = ++toastId;
  setState((s) => ({ toasts: [...s.toasts.slice(-3), { id, message, kind, action }] }));
  setTimeout(() => setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === "error" ? 7000 : 3500);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// --- undoable changes ------------------------------------------------------------

/** Apply a change to the keyboard and remember how to undo it. */
export async function perform(label: string, apply: () => Promise<void>, revert: () => Promise<void>): Promise<boolean> {
  try {
    await apply();
    setState((s) => ({ undo: [...s.undo.slice(-99), { label, undo: revert, redo: apply }], redo: [] }));
    return true;
  } catch (error) {
    toast(`${label} failed: ${errorMessage(error)}`, "error");
    return false;
  }
}

export async function undo(): Promise<void> {
  const entry = state.undo[state.undo.length - 1];
  if (!entry) return;
  try {
    await entry.undo();
    setState((s) => ({ undo: s.undo.slice(0, -1), redo: [...s.redo, entry] }));
    toast(`Undid: ${entry.label}`);
  } catch (error) {
    toast(`Could not undo: ${errorMessage(error)}`, "error");
  }
}

export async function redo(): Promise<void> {
  const entry = state.redo[state.redo.length - 1];
  if (!entry) return;
  try {
    await entry.redo();
    setState((s) => ({ redo: s.redo.slice(0, -1), undo: [...s.undo, entry] }));
    toast(`Redid: ${entry.label}`);
  } catch (error) {
    toast(`Could not redo: ${errorMessage(error)}`, "error");
  }
}

/** Run a longer job with a progress overlay. */
export async function busy<T>(label: string, job: () => Promise<T>): Promise<T | undefined> {
  setState({ busy: label });
  try {
    return await job();
  } catch (error) {
    toast(`${label} failed: ${errorMessage(error)}`, "error");
    return undefined;
  } finally {
    setState({ busy: null });
  }
}

// --- settings ----------------------------------------------------------------------

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  setState((s) => ({ settings: { ...s.settings, ...patch } }));
  try {
    const saved = await host.setSettings(patch);
    setState({ settings: saved });
    if ("appMacros" in patch) setState({ appMacroStatus: await host.appMacroStatus() });
  } catch (error) {
    toast(`Could not save settings: ${errorMessage(error)}`, "error");
  }
}

export function keyboardId(kb: KeyboardState | null = state.kb): string {
  return kb ? deviceKey(kb.info) : "";
}

/** Demo keyboard macro names live in memory so they never mix with a real keyboard's. */
let demoNames: (string | null)[] = ["Toggle sidebar", null, "Next tab", "Previous tab", "Desktop left", "Desktop right"];

export function macroNames(): (string | undefined)[] {
  const names = state.connection.demo ? demoNames : (state.settings.macroNames[keyboardId()] ?? []);
  return names.map((n) => n ?? undefined);
}

export async function setMacroName(index: number, name: string): Promise<void> {
  if (state.connection.demo) {
    demoNames = [...demoNames];
    while (demoNames.length <= index) demoNames.push(null);
    demoNames[index] = name.trim() || null;
    setState((s) => ({ settings: { ...s.settings } }));
    return;
  }
  const id = keyboardId();
  const names = [...(state.settings.macroNames[id] ?? [])];
  while (names.length <= index) names.push(null);
  names[index] = name.trim() || null;
  await updateSettings({ macroNames: { ...state.settings.macroNames, [id]: names } });
}

/** Label style: Mac or Windows legends, following the layer when set to automatic. */
export function labelPlatform(s: StudioState = state): Platform {
  if (s.settings.labels !== "auto") return s.settings.labels;
  if (s.model?.layerNames[s.layer]?.startsWith("Windows")) return "win";
  if (s.model?.layerNames[s.layer]?.startsWith("Mac")) return "mac";
  return host.platform === "win32" ? "win" : "mac";
}

// --- connection ----------------------------------------------------------------------

let registry = new ModelRegistry();
/** The simulated keyboard behind demo mode, so the key test can press its keys. */
export let demoSimulator: SimulatedKeyboard | null = null;
let activeDevice: HIDDevice | null = null;
let activeLink: WebHidLink | null = null;
let connecting = false;
const ignored = new Set<string>();

export function models(): ModelRegistry {
  return registry;
}

export async function init(): Promise<void> {
  try {
    const settings = await host.getSettings();
    registry = new ModelRegistry(settings.definitions);
    setState({ settings, appMacroStatus: await host.appMacroStatus() });
  } catch (error) {
    toast(`Could not load settings: ${errorMessage(error)}`, "error");
  }
  host.onCommand((command) => void runCommand(command));
  const params = new URLSearchParams(location.search);
  if (params.get("demo") === "1") {
    await connectDemo();
    return;
  }
  if (!hidAvailable()) return;
  navigator.hid.addEventListener("connect", () => void findKeyboard());
  navigator.hid.addEventListener("disconnect", (event) => {
    if (event.device === activeDevice) void handleDisconnect("Keyboard unplugged");
  });
  void findKeyboard();
  setInterval(() => {
    if (!state.keyboard && !connecting && state.connection.status !== "unsupported") void findKeyboard(true);
  }, 2500);
}

async function findKeyboard(scan = false): Promise<void> {
  if (state.keyboard || connecting) return;
  try {
    if (scan) await host.scanDevices();
    const devices = (await rawHidDevices()).filter((d) => !ignored.has(deviceKey(d)));
    const known = devices.find((d) => registry.find(d.vendorId, d.productId));
    const candidate = known ?? devices.find((d) => d.vendorId === 0x3434);
    if (!candidate) {
      if (state.connection.status !== "searching") setState({ connection: { status: "searching" } });
      return;
    }
    const model = registry.find(candidate.vendorId, candidate.productId);
    if (!model) {
      setState({
        connection: {
          status: "unsupported",
          device: { vendorId: candidate.vendorId, productId: candidate.productId, productName: candidate.productName },
        },
      });
      return;
    }
    await connectDevice(candidate, model);
  } catch (error) {
    setState({ connection: { status: "error", message: errorMessage(error) } });
  }
}

export async function retryConnection(): Promise<void> {
  ignored.clear();
  setState({ connection: { status: "searching" } });
  await findKeyboard(true);
}

/** Register an imported VIA definition and connect if it matches the waiting keyboard. */
export async function addDefinition(definition: unknown): Promise<KeyboardModel> {
  const model = registry.add(definition);
  const definitions = [...state.settings.definitions.filter((d) => !(d.vendorId === model.definition.vendorId && d.productId === model.definition.productId)), model.definition];
  await updateSettings({ definitions });
  if (state.connection.status === "unsupported") await retryConnection();
  return model;
}

async function connectDevice(device: HIDDevice, model: KeyboardModel): Promise<void> {
  connecting = true;
  const identity = { vendorId: device.vendorId, productId: device.productId, productName: device.productName || model.definition.name };
  setState({ connection: { status: "connecting", progress: 0, message: "Opening keyboard", device: identity } });
  const link = new WebHidLink(device);
  try {
    await link.open();
    const keyboard = await Keyboard.connect(link, identity, model, (step, fraction) =>
      setState({ connection: { status: "connecting", progress: fraction, message: step, device: identity } }),
    );
    activeDevice = device;
    activeLink = link;
    attach(keyboard, model, { status: "connected", device: identity });
    await backupOnConnect();
  } catch (error) {
    await link.close().catch(() => undefined);
    ignored.add(deviceKey(device));
    setState({
      connection: {
        status: "error",
        device: identity,
        message: `${errorMessage(error)}. If Keychron Launcher or VIA is open in a browser, close it and try again.`,
      },
    });
  } finally {
    connecting = false;
  }
}

function attach(keyboard: Keyboard, model: KeyboardModel, connection: ConnectionState): void {
  const sync = () => {
    const kb = keyboard.state;
    setState((s) => {
      let layer = s.layer;
      const before = s.kb?.activeLayers;
      if (s.settings.followKeyboardLayer && before && (before.topLayer !== kb.activeLayers.topLayer || before.defaultLayer !== kb.activeLayers.defaultLayer)) {
        layer = kb.activeLayers.topLayer;
      }
      return { kb, layer };
    });
  };
  keyboard.subscribe(sync);
  setState({
    keyboard,
    kb: keyboard.state,
    model,
    connection,
    layer: keyboard.state.activeLayers.defaultLayer < keyboard.state.layers ? keyboard.state.activeLayers.defaultLayer : 0,
    selection: null,
    undo: [],
    redo: [],
  });
}

async function handleDisconnect(message: string): Promise<void> {
  state.keyboard?.close();
  await activeLink?.close().catch(() => undefined);
  activeDevice = null;
  activeLink = null;
  setState({ keyboard: null, kb: null, model: null, selection: null, undo: [], redo: [], connection: { status: "searching" } });
  toast(message);
}

export async function disconnect(): Promise<void> {
  if (state.connection.demo) {
    state.keyboard?.close();
    setState({ keyboard: null, kb: null, model: null, selection: null, undo: [], redo: [], connection: { status: "searching" } });
    void findKeyboard(true);
    return;
  }
  await handleDisconnect("Disconnected");
}

export async function connectDemo(): Promise<void> {
  if (state.keyboard) await disconnect();
  const sim = new SimulatedKeyboard(V5_MAX_ANSI, { latencyMs: 1 });
  seedDemo(sim);
  // A product id no real keyboard uses, so demo profiles never mix with a real V5 Max.
  const identity = { vendorId: 0x3434, productId: 0xfffe, productName: "Keychron V5 Max (demo)" };
  const keyboard = await Keyboard.connect(sim, identity, V5_MAX_ANSI);
  attach(keyboard, V5_MAX_ANSI, { status: "connected", demo: true, device: identity });
  demoSimulator = sim;
}

function seedDemo(sim: SimulatedKeyboard): void {
  const macros = [
    encodeMacroSteps([{ type: "shortcut", mods: [kc("LALT"), kc("LGUI")], key: kc("BSLS") }]),
    new Uint8Array(),
    encodeMacroSteps([{ type: "shortcut", mods: [kc("LCTL")], key: kc("TAB") }]),
    encodeMacroSteps([{ type: "shortcut", mods: [kc("LCTL"), kc("LSFT")], key: kc("TAB") }]),
    encodeMacroSteps([{ type: "shortcut", mods: [kc("LCTL")], key: kc("LEFT") }]),
    encodeMacroSteps([{ type: "shortcut", mods: [kc("LCTL")], key: kc("RGHT") }]),
  ];
  let offset = 0;
  for (const m of macros) {
    sim.macroBuffer.set(m, offset);
    offset += m.length + 1;
  }
  const cols = sim.cols;
  const numpad: [number, number, number][] = [
    [1, 16, macroKey(2)],
    [1, 17, macroKey(3)],
    [1, 18, macroKey(0)],
    [2, 18, macroKey(4)],
    [3, 18, macroKey(5)],
  ];
  for (const [r, c, code] of numpad) sim.keymap[r * cols + c] = code;
  sim.keymap[3 * cols] = modTap(HYPER, kc("ESC")); // Caps Lock: tap for Esc, hold for Hyper
}

async function backupOnConnect(): Promise<void> {
  const kb = state.kb;
  if (!kb || state.connection.demo) return;
  try {
    const id = keyboardId(kb);
    const latest = (await host.listProfiles(id)).find((e) => e.kind === "backup");
    const profile = snapshot(kb, `Connected ${new Date().toLocaleString()}`, macroNames());
    if (latest && sameSetup(latest.profile, profile)) return;
    await host.saveProfile({ id: `backup-${Date.now()}`, kind: "backup", profile });
    setState((s) => ({ profilesVersion: s.profilesVersion + 1 }));
  } catch (error) {
    toast(`Automatic backup failed: ${errorMessage(error)}`, "error");
  }
}

export function sameSetup(a: Profile, b: Profile): boolean {
  const pick = (p: Profile) => JSON.stringify([p.keymap, p.encoders, p.macros?.data, p.lighting, p.advanced]);
  return pick(a) === pick(b);
}

export async function backupNow(name = `Backup ${new Date().toLocaleString()}`): Promise<void> {
  const kb = state.kb;
  if (!kb) return;
  await host.saveProfile({ id: `backup-${Date.now()}`, kind: "backup", profile: snapshot(kb, name, macroNames()) });
  setState((s) => ({ profilesVersion: s.profilesVersion + 1 }));
  toast("Backup saved", "success");
}

// --- commands from the menu / palette ---------------------------------------------------

export const commandHandlers: Record<string, () => void | Promise<void>> = {
  undo,
  redo,
  palette: () => setState((s) => ({ paletteOpen: !s.paletteOpen })),
  backup: () => backupNow(),
};

async function runCommand(command: string): Promise<void> {
  // The menu owns ⌘Z, so text fields get their own undo back here.
  const field = document.activeElement;
  if ((command === "undo" || command === "redo") && field instanceof HTMLElement && field.matches("input, textarea")) {
    document.execCommand(command);
    return;
  }
  if (command.startsWith("view:")) {
    setState({ view: command.slice(5) as View });
    return;
  }
  await commandHandlers[command]?.();
}

function browserHost(): StudioHost {
  let settings = { ...DEFAULT_SETTINGS };
  return {
    platform: navigator.platform.toLowerCase().includes("win") ? "win32" : "darwin",
    version: "dev",
    getSettings: async () => settings,
    setSettings: async (patch) => (settings = { ...settings, ...patch }),
    listProfiles: async () => [],
    saveProfile: async () => undefined,
    deleteProfile: async () => undefined,
    exportJson: async () => false,
    importJson: async () => null,
    appMacroStatus: async () => ({ accessibility: "not-needed", registered: 0, failed: [] }),
    requestAccessibility: async () => ({ accessibility: "not-needed", registered: 0, failed: [] }),
    runAppMacro: async () => undefined,
    scanDevices: async () => {
      await navigator.hid?.requestDevice({ filters: [{ usagePage: 0xff60, usage: 0x61 }] }).catch(() => undefined);
    },
    openExternal: async (url) => void window.open(url, "_blank"),
    setRecording: async () => undefined,
    onCommand: () => () => undefined,
  };
}
