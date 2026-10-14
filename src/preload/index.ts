import { contextBridge, ipcRenderer } from "electron";
import type { StudioHost } from "../shared/ipc";

const host: StudioHost = {
  platform: process.platform as StudioHost["platform"],
  version: process.argv.find((a) => a.startsWith("--studio-version="))?.split("=")[1] ?? "",
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (patch) => ipcRenderer.invoke("settings:set", patch),
  listProfiles: (keyboard) => ipcRenderer.invoke("profiles:list", keyboard),
  saveProfile: (entry) => ipcRenderer.invoke("profiles:save", entry),
  deleteProfile: (id) => ipcRenderer.invoke("profiles:delete", id),
  exportJson: (name, data) => ipcRenderer.invoke("file:export", name, data),
  importJson: () => ipcRenderer.invoke("file:import"),
  appMacroStatus: () => ipcRenderer.invoke("appMacros:status"),
  requestAccessibility: () => ipcRenderer.invoke("appMacros:requestAccess"),
  runAppMacro: (id) => ipcRenderer.invoke("appMacros:run", id),
  scanDevices: () => ipcRenderer.invoke("hid:scan"),
  openExternal: (url) => ipcRenderer.invoke("shell:openExternal", url),
  findMacroDownload: () => ipcRenderer.invoke("macros:findDownload"),
  setRecording: (on) => ipcRenderer.invoke("window:recording", on),
  onCommand: (listener) => {
    const handler = (_event: unknown, command: string) => listener(command);
    ipcRenderer.on("studio:command", handler);
    return () => ipcRenderer.removeListener("studio:command", handler);
  },
};

contextBridge.exposeInMainWorld("studio", host);
