import { createRoot } from "react-dom/client";
import { App } from "./App";
import { commandHandlers, getState, init, setState, type View } from "./store";
import { exportProfile, importFile } from "./views/Profiles";
import { selfTest } from "./selfTest";
import "./styles.css";

commandHandlers.import = importFile;
commandHandlers.export = exportProfile;

declare global {
  interface Window {
    /** Used by the packaged app's smoke test to open a view on the demo keyboard. */
    __smokeReady?: (view: string) => Promise<void>;
    __selfTest?: () => Promise<string[]>;
  }
}

window.__smokeReady = async (view: string) => {
  for (let i = 0; i < 100 && getState().connection.status !== "connected"; i++) await new Promise((r) => setTimeout(r, 50));
  const s = getState();
  const [name, option] = view.split(":");
  if (name === "lighting") localStorage.setItem("studio.effectGalleryView", option === "list" ? "list" : "grid");
  if (name === "macros") localStorage.setItem("studio.macroLibraryLayout", option === "list" ? "list" : "grid");
  setState({ view: name as View });
  if (name === "macros" && option === "code") {
    await new Promise((r) => setTimeout(r, 200));
    document.querySelectorAll<HTMLButtonElement>(".editor-top .segmented button")[1]?.click();
  }
  if (name === "macros" && option === "app") {
    await new Promise((r) => setTimeout(r, 200));
    const items = document.querySelectorAll<HTMLElement>(".macro-library .slots")[1]?.querySelectorAll<HTMLElement>(".slot-item");
    (items && items.length > 1 ? items[0] : items?.[0])?.click();
  }
  if (name === "keymap" && s.model) {
    const key = s.model.layout.keys.find((k) => k.row === 3 && k.col === 0);
    if (key) setState({ selection: { kind: "key", id: key.id } });
  }
  if (name === "lighting" && option && s.keyboard && s.model) {
    if (option === "paint" && s.model.perKeyMode !== undefined) await s.keyboard.setEffect(s.model.perKeyMode);
  }
  if (name === "palette") setState({ view: "keymap", paletteOpen: true });
  if (option === "light") setState((st) => ({ settings: { ...st.settings, theme: "light" } }));
  if (name === "connect") {
    s.keyboard?.close();
    setState({ keyboard: null, kb: null, model: null, connection: { status: "searching" }, view: "keymap" });
  }
};

window.__selfTest = async () => {
  for (let i = 0; i < 100 && getState().connection.status !== "connected"; i++) await new Promise((r) => setTimeout(r, 50));
  return selfTest();
};

createRoot(document.getElementById("root")!).render(<App />);
void init();
