// App shell: navigation rail, top bar, the current view, and connection screens.

import { useEffect } from "react";
import { Button, Icon, ICONS, Segmented } from "./components/ui";
import { Palette } from "./components/Palette";
import { KeymapView } from "./views/Keymap";
import { LightingView } from "./views/Lighting";
import { MacrosView } from "./views/Macros";
import { AdvancedView } from "./views/Advanced";
import { KeyTestView } from "./views/KeyTest";
import { ProfilesView, importFile } from "./views/Profiles";
import { SettingsView } from "./views/Settings";
import { connectDemo, disconnect, host, redo, retryConnection, setState, undo, useStudio, type View } from "./store";

const NAV: { view: View; label: string; icon: keyof typeof ICONS; needsKeyboard: boolean }[] = [
  { view: "keymap", label: "Keymap", icon: "keymap", needsKeyboard: true },
  { view: "lighting", label: "Lighting", icon: "lighting", needsKeyboard: true },
  { view: "macros", label: "Macros", icon: "macros", needsKeyboard: true },
  { view: "advanced", label: "Advanced", icon: "advanced", needsKeyboard: true },
  { view: "test", label: "Key test", icon: "test", needsKeyboard: true },
  { view: "profiles", label: "Profiles", icon: "profiles", needsKeyboard: true },
];

export function App() {
  const view = useStudio((s) => s.view);
  const connected = useStudio((s) => s.connection.status === "connected");
  const theme = useStudio((s) => s.settings.theme);
  const busy = useStudio((s) => s.busy);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const apply = () => (document.documentElement.dataset.theme = theme === "system" ? (media.matches ? "light" : "dark") : theme);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.platform = host.platform;
    // Shortcuts for the plain-browser build; the desktop app gets them from its menu.
    if (window.studio) return;
    const key = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === "k") (e.preventDefault(), setState((s) => ({ paletteOpen: !s.paletteOpen })));
      if (e.key === "z" && !(e.target as HTMLElement).closest("input, textarea")) (e.preventDefault(), void (e.shiftKey ? redo() : undo()));
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const content = view === "settings" ? <SettingsView /> : !connected ? <ConnectScreen /> : <CurrentView view={view} />;

  return (
    <div className="app">
      <nav className="rail">
        <div className="rail-brand" title="Keychron Studio">
          <span className="brand-mark" />
        </div>
        {NAV.map((n) => (
          <button key={n.view} className={`rail-item${view === n.view ? " on" : ""}`} disabled={n.needsKeyboard && !connected} onClick={() => setState({ view: n.view, selection: null })}>
            <Icon name={n.icon} size={20} />
            <span>{n.label}</span>
          </button>
        ))}
        <span className="rail-spacer" />
        <button className={`rail-item${view === "settings" ? " on" : ""}`} onClick={() => setState({ view: "settings" })}>
          <Icon name="settings" size={20} />
          <span>Settings</span>
        </button>
      </nav>
      <div className="main">
        <TopBar />
        <main className="content">{content}</main>
      </div>
      <Palette />
      <Toasts />
      {busy && (
        <div className="busy">
          <div className="spinner" />
          <span>{busy}…</span>
        </div>
      )}
    </div>
  );
}

function CurrentView({ view }: { view: View }) {
  switch (view) {
    case "keymap":
      return <KeymapView />;
    case "lighting":
      return <LightingView />;
    case "macros":
      return <MacrosView />;
    case "advanced":
      return <AdvancedView />;
    case "test":
      return <KeyTestView />;
    case "profiles":
      return <ProfilesView />;
    default:
      return <SettingsView />;
  }
}

function TopBar() {
  const connection = useStudio((s) => s.connection);
  const kb = useStudio((s) => s.kb);
  const model = useStudio((s) => s.model);
  const layer = useStudio((s) => s.layer);
  const view = useStudio((s) => s.view);
  const undoEntry = useStudio((s) => s.undo[s.undo.length - 1]);
  const redoEntry = useStudio((s) => s.redo[s.redo.length - 1]);
  const showLayers = kb && model && (view === "keymap" || view === "macros");

  return (
    <header className="topbar">
      <div className="topbar-left">
        {kb ? (
          <button className="device-pill" onClick={() => setState({ view: "advanced" })} title="Keyboard details">
            <span className={`status-dot${connection.demo ? " demo" : ""}`} />
            <span className="device-name">{kb.info.productName}</span>
            {kb.info.firmware && <small>{kb.info.firmware}</small>}
          </button>
        ) : (
          <span className="device-pill idle">
            <span className="status-dot off" />
            <span className="device-name">{connection.status === "connecting" ? "Connecting…" : "No keyboard"}</span>
          </span>
        )}
        {connection.demo && (
          <Button small kind="ghost" onClick={() => void disconnect()}>
            Leave demo
          </Button>
        )}
      </div>
      <div className="topbar-center">
        {showLayers && (
          <Segmented
            value={layer}
            onChange={(l) => setState({ layer: l })}
            options={kb.keymap.map((_, i) => ({
              value: i,
              label: (
                <span className="layer-tab">
                  {model.layerNames[i] ?? `Layer ${i}`}
                  {kb.activeLayers.topLayer === i && <span className="live-dot" title="The keyboard is on this layer" />}
                </span>
              ),
            }))}
          />
        )}
      </div>
      <div className="topbar-right">
        <button className="icon-btn" disabled={!undoEntry} onClick={() => void undo()} title={undoEntry ? `Undo: ${undoEntry.label} (⌘Z)` : "Nothing to undo"}>
          <Icon name="undo" />
        </button>
        <button className="icon-btn" disabled={!redoEntry} onClick={() => void redo()} title={redoEntry ? `Redo: ${redoEntry.label} (⇧⌘Z)` : "Nothing to redo"}>
          <Icon name="redo" />
        </button>
        <button className="search-btn" onClick={() => setState({ paletteOpen: true })}>
          <Icon name="search" size={15} />
          <span>Search</span>
          <kbd>⌘K</kbd>
        </button>
      </div>
    </header>
  );
}

function ConnectScreen() {
  const c = useStudio((s) => s.connection);
  return (
    <div className="connect">
      <div className={`connect-art ${c.status}`}>
        <div className="art-board">
          {Array.from({ length: 30 }, (_, i) => (
            <span key={i} style={{ animationDelay: `${(i % 10) * 0.12 + Math.floor(i / 10) * 0.2}s` }} />
          ))}
        </div>
        <div className="art-cable" />
      </div>
      {c.status === "connecting" ? (
        <>
          <h1>Reading {c.device?.productName ?? "keyboard"}</h1>
          <p>{c.message}</p>
          <div className="progress">
            <span style={{ width: `${Math.round((c.progress ?? 0) * 100)}%` }} />
          </div>
        </>
      ) : c.status === "unsupported" ? (
        <>
          <h1>Found {c.device?.productName || "a keyboard"}</h1>
          <p>There's no built-in layout for it yet. Add its VIA definition file (JSON) from Keychron's website and it connects straight away.</p>
          <div className="connect-actions">
            <Button kind="primary" onClick={() => void importFile()}>
              Add definition…
            </Button>
            <Button onClick={() => void host.openExternal("https://www.keychron.com/pages/firmware-and-json-files-of-the-keychron-qmk-keyboards")}>Find the file</Button>
            <Button kind="ghost" onClick={() => void retryConnection()}>
              Look again
            </Button>
          </div>
        </>
      ) : c.status === "error" ? (
        <>
          <h1>Couldn't talk to the keyboard</h1>
          <p>{c.message}</p>
          <div className="connect-actions">
            <Button kind="primary" onClick={() => void retryConnection()}>
              Try again
            </Button>
            <Button kind="ghost" onClick={() => void connectDemo()}>
              Use demo keyboard
            </Button>
          </div>
        </>
      ) : c.status === "unavailable" ? (
        <>
          <h1>USB access isn't available here</h1>
          <p>Open Keychron Studio as the desktop app to connect a keyboard. You can still explore with the demo keyboard.</p>
          <div className="connect-actions">
            <Button kind="primary" onClick={() => void connectDemo()}>
              Use demo keyboard
            </Button>
          </div>
        </>
      ) : (
        <>
          <h1>Plug in your Keychron</h1>
          <p>Connect it with a USB-C cable and set the switch on its back to cable mode. Bluetooth and 2.4 GHz can't change settings.</p>
          <div className="connect-actions">
            <Button kind="primary" onClick={() => void retryConnection()}>
              Look again
            </Button>
            <Button kind="ghost" onClick={() => void connectDemo()}>
              Try the demo keyboard
            </Button>
          </div>
          <p className="muted small">Close Keychron Launcher and VIA first; only one app can talk to the keyboard at a time.</p>
        </>
      )}
    </div>
  );
}

function Toasts() {
  const toasts = useStudio((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          {t.kind === "success" && <Icon name="check" size={15} />}
          <span>{t.message}</span>
          {t.action && (
            <button
              onClick={() => {
                t.action!.run();
                setState((s) => ({ toasts: s.toasts.filter((x) => x.id !== t.id) }));
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
