// Electron main process: window, menu bar, HID permissions, storage and app macros.

import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, net, shell, Tray, session, type MenuItemConstructorOptions } from "electron";
import fs from "node:fs";
import path from "node:path";
import { Storage } from "./storage";
import { AppMacroRunner } from "./appMacroRunner";
import type { Settings, StoredProfile } from "../shared/ipc";

const KEYCHRON_VENDOR = 0x3434;
const isMac = process.platform === "darwin";
const smoke = process.argv.find((a) => a.startsWith("--smoke-screenshot="))?.split("=")[1];

let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let storage: Storage;
const runner = new AppMacroRunner((message) => console.error(message));

if (smoke) {
  // Smoke tests never touch the user's settings or profiles.
  app.setPath("userData", fs.mkdtempSync(path.join(app.getPath("temp"), "keytune-smoke-")));
} else {
  moveOldUserData();
  if (!app.requestSingleInstanceLock()) app.quit();
}

/** The app used to be called "Keychron Studio"; bring its settings, profiles and window state across once. */
function moveOldUserData(): void {
  const from = path.join(app.getPath("appData"), "Keychron Studio");
  const to = app.getPath("userData");
  if (!fs.existsSync(from) || fs.existsSync(path.join(to, "settings.json"))) return;
  try {
    fs.cpSync(from, to, { recursive: true, force: false, filter: (source) => !/Singleton/.test(path.basename(source)) });
  } catch (error) {
    console.error(`Could not copy settings from ${from}: ${error}`);
  }
}

app.on("second-instance", () => showWindow());

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1120,
    minHeight: 740,
    show: false,
    title: "Keytune",
    backgroundColor: "#0c0d10",
    titleBarStyle: isMac ? "hiddenInset" : "default",
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [`--studio-version=${app.getVersion()}`],
      // The smoke test captures a hidden window, which needs offscreen painting.
      offscreen: Boolean(smoke),
    },
  });
  win.loadFile(path.join(__dirname, "../renderer/index.html"), smoke ? { query: { demo: "1", smoke: "1" } } : undefined);
  win.once("ready-to-show", () => {
    if (!smoke) win.show();
  });
  win.on("close", (event) => {
    if (!quitting && storage.settings().keepInMenuBar && storage.settings().appMacros.length > 0) {
      event.preventDefault();
      win.hide();
      if (isMac) app.dock?.hide();
    }
  });
  win.on("closed", () => {
    window = null;
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  return win;
}

function showWindow(): void {
  if (isMac) void app.dock?.show();
  if (!window) window = createWindow();
  else {
    window.show();
    window.focus();
  }
}

function sendCommand(command: string): void {
  showWindow();
  window?.webContents.send("studio:command", command);
}

function setupHidPermissions(): void {
  const ses = session.defaultSession;
  // The app only loads its own bundled page, so it may use any HID device the
  // renderer asks for; the renderer filters on the raw HID usage page.
  ses.setPermissionCheckHandler((_wc, permission) => permission === "hid" || permission === "clipboard-sanitized-write");
  ses.setDevicePermissionHandler((details) => details.deviceType === "hid");
  ses.on("select-hid-device", (event, details, callback) => {
    event.preventDefault();
    const preferred = details.deviceList.find((d) => d.vendorId === KEYCHRON_VENDOR) ?? details.deviceList[0];
    callback(preferred?.deviceId ?? "");
  });
}

function setupMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" as const }] : []),
    {
      label: "File",
      submenu: [
        { label: "Back Up Now", accelerator: "CmdOrCtrl+B", click: () => sendCommand("backup") },
        { label: "Import…", accelerator: "CmdOrCtrl+O", click: () => sendCommand("import") },
        { label: "Export Profile…", accelerator: "CmdOrCtrl+E", click: () => sendCommand("export") },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { label: "Undo", accelerator: "CmdOrCtrl+Z", click: () => sendCommand("undo") },
        { label: "Redo", accelerator: "Shift+CmdOrCtrl+Z", click: () => sendCommand("redo") },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
        { type: "separator" },
        { label: "Command Palette…", accelerator: "CmdOrCtrl+K", click: () => sendCommand("palette") },
      ],
    },
    {
      label: "View",
      submenu: [
        { label: "Keymap", accelerator: "CmdOrCtrl+1", click: () => sendCommand("view:keymap") },
        { label: "Lighting", accelerator: "CmdOrCtrl+2", click: () => sendCommand("view:lighting") },
        { label: "Macros", accelerator: "CmdOrCtrl+3", click: () => sendCommand("view:macros") },
        { label: "Advanced", accelerator: "CmdOrCtrl+4", click: () => sendCommand("view:advanced") },
        { label: "Key Test", accelerator: "CmdOrCtrl+5", click: () => sendCommand("view:test") },
        { label: "Profiles", accelerator: "CmdOrCtrl+6", click: () => sendCommand("view:profiles") },
        { type: "separator" },
        { role: "reload" },
        { role: "toggleDevTools" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function setupTray(): void {
  if (tray) return;
  const icon = nativeImage.createFromPath(path.join(__dirname, "../renderer/trayTemplate.png"));
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip("Keytune");
  const rebuild = () => {
    const macros = storage.settings().appMacros;
    tray?.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Open Keytune", click: () => showWindow() },
        { type: "separator" },
        { label: macros.length ? `${macros.length} app macro${macros.length === 1 ? "" : "s"} active` : "No app macros", enabled: false },
        ...macros.slice(0, 12).map((m) => ({ label: `Run “${m.name}”`, click: () => void runner.run(m.id, false).catch(() => undefined) })),
        { type: "separator" },
        {
          label: "Quit",
          click: () => {
            quitting = true;
            app.quit();
          },
        },
      ]),
    );
  };
  rebuild();
  trayRebuild = rebuild;
}
let trayRebuild = () => {};

function applySettings(settings: Settings): void {
  runner.register(settings.appMacros);
  if (app.isPackaged && process.platform !== "linux") app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin, openAsHidden: true });
  if (settings.keepInMenuBar && settings.appMacros.length > 0) setupTray();
  else if (tray) {
    tray.destroy();
    tray = null;
  }
  trayRebuild();
}

function setupIpc(): void {
  ipcMain.handle("settings:get", () => storage.settings());
  ipcMain.handle("settings:set", (_e, patch: Partial<Settings>) => {
    const next = storage.updateSettings(patch);
    applySettings(next);
    return next;
  });
  ipcMain.handle("profiles:list", (_e, keyboard?: string) => storage.listProfiles(keyboard));
  ipcMain.handle("profiles:save", (_e, entry: StoredProfile) => storage.saveProfile(entry));
  ipcMain.handle("profiles:delete", (_e, id: string) => storage.deleteProfile(id));
  ipcMain.handle("file:export", async (_e, defaultName: string, data: unknown) => {
    const result = await dialog.showSaveDialog(window!, { defaultPath: defaultName, filters: [{ name: "JSON", extensions: ["json"] }] });
    if (result.canceled || !result.filePath) return false;
    fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2));
    return true;
  });
  ipcMain.handle("file:import", async () => {
    const result = await dialog.showOpenDialog(window!, { properties: ["openFile"], filters: [{ name: "JSON", extensions: ["json"] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const text = fs.readFileSync(result.filePaths[0], "utf8");
    if (text.length > 5_000_000) throw new Error("That file is too large to be a keyboard file");
    return JSON.parse(text);
  });
  ipcMain.handle("file:choose", async () => {
    const result = await dialog.showOpenDialog(window!, { title: "Choose what to open", buttonLabel: "Choose", properties: ["openFile", "openDirectory"] });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle("definitions:fetchVia", (_e, vendorId: number, productId: number) => fetchViaDefinition(vendorId, productId));
  ipcMain.handle("appMacros:status", () => runner.status());
  ipcMain.handle("appMacros:requestAccess", () => runner.requestAccessibility());
  ipcMain.handle("appMacros:run", (_e, id: string) => runner.run(id, false));
  ipcMain.handle("hid:scan", async (event) => {
    // requestDevice needs a user gesture; executeJavaScript can supply one.
    await event.sender.executeJavaScript(
      `navigator.hid.requestDevice({ filters: [{ usagePage: 0xff60, usage: 0x61 }] }).then(() => true, () => false)`,
      true,
    );
  });
  ipcMain.handle("macros:findDownload", () => findMacroDownload());
  ipcMain.handle("window:recording", (event, on: boolean) => {
    event.sender.setIgnoreMenuShortcuts(Boolean(on));
  });
  ipcMain.handle("shell:openExternal", (_e, url: string) => {
    if (!/^https:\/\//.test(url)) throw new Error("Only https links can be opened");
    return shell.openExternal(url);
  });
}

/**
 * VIA's online library serves every keyboard it supports as /definitions/<v3|v2>/<vendorProductId>.json.
 * Unknown ids fall through to the web app's HTML page, so anything that isn't a JSON definition means "none".
 */
async function fetchViaDefinition(vendorId: number, productId: number): Promise<unknown | null> {
  if (!Number.isInteger(vendorId) || !Number.isInteger(productId) || vendorId < 0 || vendorId > 0xffff || productId < 0 || productId > 0xffff) return null;
  const id = vendorId * 0x10000 + productId;
  for (const version of ["v3", "v2"]) {
    try {
      const response = await net.fetch(`https://www.usevia.app/definitions/${version}/${id}.json`, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) continue;
      const text = await response.text();
      if (text.length > 5_000_000 || !text.trimStart().startsWith("{")) continue;
      const data = JSON.parse(text) as { vendorProductId?: unknown; matrix?: unknown };
      if (data.vendorProductId === id && data.matrix) return data;
    } catch {
      // Offline or unreachable: the user can still add the file by hand.
    }
  }
  return null;
}

/** Newest "*macro*.json" in Downloads from the last 30 days (Keychron Launcher exports "<Keyboard> Macro.json"). */
function findMacroDownload(): { name: string; modified: number; data: unknown } | null {
  const dir = app.getPath("downloads");
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
  const candidates = names
    .filter((n) => /macro.*\.json$/i.test(n))
    .map((n) => {
      try {
        const stat = fs.statSync(path.join(dir, n));
        return stat.isFile() && stat.size < 2_000_000 && stat.mtimeMs > cutoff ? { name: n, modified: stat.mtimeMs } : null;
      } catch {
        return null;
      }
    })
    .filter((c): c is { name: string; modified: number } => c !== null)
    .sort((a, b) => b.modified - a.modified);
  for (const c of candidates) {
    try {
      return { ...c, data: JSON.parse(fs.readFileSync(path.join(dir, c.name), "utf8")) };
    } catch {
      // Not JSON; try the next one.
    }
  }
  return null;
}

async function runSmokeTest(file: string): Promise<void> {
  const win = createWindow();
  window = win;
  await new Promise<void>((resolve) => win.webContents.once("did-finish-load", () => resolve()));
  const view = process.argv.find((a) => a.startsWith("--smoke-view="))?.split("=")[1] ?? "keymap";
  if (process.argv.includes("--smoke-self-test")) {
    const failures = (await win.webContents.executeJavaScript("window.__selfTest()", true)) as string[];
    if (failures.length) {
      console.error(`Self test failed:\n- ${failures.join("\n- ")}`);
      app.exit(1);
      return;
    }
    console.log("Self test passed");
  }
  await win.webContents.executeJavaScript(`window.__smokeReady?.(${JSON.stringify(view)})`, true);
  await new Promise((r) => setTimeout(r, 1500));
  const image = await win.webContents.capturePage();
  fs.writeFileSync(file, image.toPNG());
  quitting = true;
  app.exit(0);
}

app.whenReady().then(async () => {
  storage = new Storage(app.getPath("userData"));
  setupHidPermissions();
  setupIpc();
  setupMenu();
  if (smoke) {
    if (isMac) app.dock?.hide();
    await runSmokeTest(smoke);
    return;
  }
  applySettings(storage.settings());
  const hidden = app.getLoginItemSettings().wasOpenedAsHidden;
  if (!hidden || storage.settings().appMacros.length === 0) showWindow();
  app.on("activate", () => showWindow());
});

app.on("before-quit", () => {
  quitting = true;
});

app.on("will-quit", () => runner.dispose());

app.on("window-all-closed", () => {
  if (!isMac && !tray) app.quit();
});
