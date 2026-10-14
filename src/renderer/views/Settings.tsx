// App settings.

import { Page } from "../components/Workspace";
import { Button, Card, Segmented, Toggle } from "../components/ui";
import { host, models, setState, updateSettings, useStudio } from "../store";
import { importFile } from "./Profiles";
import { KEYCHRON_DEFINITIONS, VIA_DEFINITIONS } from "../../shared/definitions";

export function SettingsView() {
  const settings = useStudio((s) => s.settings);
  const status = useStudio((s) => s.appMacroStatus);
  const isMac = host.platform === "darwin";
  return (
    <Page title="Settings" subtitle={`Keychron Studio ${host.version}`}>
      <div className="settings-grid">
        <Card title="Appearance">
          <label className="field">
            <span>Theme</span>
            <Segmented
              value={settings.theme}
              onChange={(theme) => void updateSettings({ theme })}
              options={[
                { value: "system", label: "Match system" },
                { value: "dark", label: "Dark" },
                { value: "light", label: "Light" },
              ]}
            />
          </label>
          <label className="field">
            <span>Key legends</span>
            <Segmented
              value={settings.labels}
              onChange={(labels) => void updateSettings({ labels })}
              options={[
                { value: "auto", label: "Follow layer" },
                { value: "mac", label: "Mac" },
                { value: "win", label: "Windows" },
              ]}
            />
          </label>
          <Toggle label="Show Fn layer on keys" hint="A faint second legend shows what each key does with Fn held." checked={settings.showSecondLayer} onChange={(v) => void updateSettings({ showSecondLayer: v })} />
          <Toggle label="Follow the keyboard's layer" hint="Switch the on-screen layer when you hold Fn or flip the Mac/Windows switch." checked={settings.followKeyboardLayer} onChange={(v) => void updateSettings({ followKeyboardLayer: v })} />
        </Card>

        <Card title="App macros">
          <Toggle label={isMac ? "Keep running in the menu bar" : "Keep running in the tray"} hint="App macros only work while the app runs. Closing the window keeps it running." checked={settings.keepInMenuBar} onChange={(v) => void updateSettings({ keepInMenuBar: v })} />
          <Toggle label="Open at login" hint="Starts hidden, ready to run app macros." checked={settings.launchAtLogin} onChange={(v) => void updateSettings({ launchAtLogin: v })} />
          {status && (
            <dl className="facts">
              <dt>Active app macros</dt>
              <dd>{status.registered}</dd>
              {status.accessibility !== "not-needed" && (
                <>
                  <dt>Accessibility</dt>
                  <dd>
                    {status.accessibility === "granted" ? (
                      "Allowed"
                    ) : (
                      <Button small onClick={() => void host.requestAccessibility().then((s) => setState({ appMacroStatus: s }))}>
                        Allow…
                      </Button>
                    )}
                  </dd>
                </>
              )}
              {status.failed.length > 0 && (
                <>
                  <dt>Trigger conflicts</dt>
                  <dd>{status.failed.map((f) => f.name).join(", ")}</dd>
                </>
              )}
            </dl>
          )}
        </Card>

        <Card title="Keyboards" subtitle="Keyboards this app knows. Keyboards in VIA's library are added automatically when you plug them in; add any other VIA keyboard with its definition file (JSON).">
          <ul className="model-list">
            {models()
              .list()
              .map((m) => (
                <li key={`${m.definition.vendorId}:${m.definition.productId}`}>
                  <span>{m.definition.name}</span>
                  <small className="mono">
                    {m.definition.vendorId.replace(/^0x/i, "")}:{m.definition.productId.replace(/^0x/i, "")} {m.bundled ? "· built in" : "· added"}
                  </small>
                </li>
              ))}
          </ul>
          <div className="row-actions">
            <Button onClick={() => void importFile()}>Add definition…</Button>
            <Button kind="ghost" onClick={() => void host.openExternal(KEYCHRON_DEFINITIONS)}>
              Get definitions from Keychron
            </Button>
            <Button kind="ghost" onClick={() => void host.openExternal(VIA_DEFINITIONS)}>
              Browse VIA's library
            </Button>
          </div>
        </Card>

        <Card title="About">
          <p className="muted">Keychron Studio talks to the keyboard over USB with the same protocol as Keychron Launcher and VIA. Close those apps (and browser tabs using them) while this one is open.</p>
          <p className="muted small">Not affiliated with Keychron. Firmware is never modified.</p>
        </Card>
      </div>
    </Page>
  );
}
