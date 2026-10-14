// Electron main process: window, menu bar, HID permissions, storage and app macros.

import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray, session, type MenuItemConstructorOptions } from "electron";
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
  app.setPath("userData", fs.mkdtempSync(path.join(app.getPath("temp"), "keychron-studio-smoke-")));
} else if (!app.requestSingleInstanceLock()) app.quit();

app.on("second-instance", () => showWindow());

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1120,
    minHeight: 740,
    show: false,
    title: "Keychron Studio",
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
  tray.setToolTip("Keychron Studio");
  const rebuild = () => {
    const macros = storage.settings().appMacros;
    tray?.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Open Keychron Studio", click: () => showWindow() },
        { type: "separator" },
        { label: macros.length ? `${macros.length} app macro${macros.length === 1 ? "" : "s"} active` : "No app macros", enabled: false },
        ...macros.slice(0, 12).map((m) => ({ label: `Run “${m.name}”`, click: () => void runner.run(m.id, 0).catch(() => undefined) })),
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
  ipcMain.handle("appMacros:status", () => runner.status());
  ipcMain.handle("appMacros:requestAccess", () => runner.requestAccessibility());
  ipcMain.handle("appMacros:run", (_e, id: string) => runner.run(id, 0));
  ipcMain.handle("hid:scan", async (event) => {
    // requestDevice needs a user gesture; executeJavaScript can supply one.
    await event.sender.executeJavaScript(
      `navigator.hid.requestDevice({ filters: [{ usagePage: 0xff60, usage: 0x61 }] }).then(() => true, () => false)`,
      true,
    );
  });
  ipcMain.handle("window:recording", (event, on: boolean) => {
    event.sender.setIgnoreMenuShortcuts(Boolean(on));
  });
  ipcMain.handle("shell:openExternal", (_e, url: string) => {
    if (!/^https:\/\//.test(url)) throw new Error("Only https links can be opened");
    return shell.openExternal(url);
  });
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

app.on("window-all-closed", () => {
  if (!isMac && !tray) app.quit();
});
