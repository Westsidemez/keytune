// Profiles and backups: save, restore, import and export whole setups.

import { useEffect, useState } from "react";
import type { StoredProfile } from "../../shared/ipc";
import { ALL_SECTIONS, applyProfile, exportViaLayout, importViaLayout, isProfileFormat, parseProfile, snapshot, type Profile, type ProfileSection, type ViaLayoutFile } from "../../shared/profile";
import { Page } from "../components/Workspace";
import { Button, Card, Empty, Icon, Modal } from "../components/ui";
import { addDefinition, errorMessage, getState, host, keyboardId, macroNames, perform, setState, toast, updateSettings, useStudio } from "../store";

const SECTION_NAMES: Record<ProfileSection, string> = { keymap: "Keymap & knob", macros: "Onboard macros", lighting: "Lighting", advanced: "Advanced settings" };

export function ProfilesView() {
  const kb = useStudio((s) => s.kb)!;
  const version = useStudio((s) => s.profilesVersion);
  const [entries, setEntries] = useState<StoredProfile[]>([]);
  const [applying, setApplying] = useState<StoredProfile | null>(null);
  const [naming, setNaming] = useState(false);
  const id = keyboardId(kb);

  useEffect(() => {
    host
      .listProfiles(id)
      .then(setEntries)
      .catch((e) => toast(`Could not read profiles: ${errorMessage(e)}`, "error"));
  }, [id, version]);

  const refresh = () => setState((s) => ({ profilesVersion: s.profilesVersion + 1 }));
  const profiles = entries.filter((e) => e.kind === "profile");
  const backups = entries.filter((e) => e.kind === "backup");

  return (
    <Page
      title="Profiles"
      subtitle={`Complete setups for ${kb.info.productName}. A backup is saved automatically when the keyboard connects and before big changes.`}
      actions={
        <>
          <Button onClick={() => void importFile()}>
            <Icon name="upload" size={15} /> Import…
          </Button>
          <Button onClick={() => void exportVia()}>
            <Icon name="download" size={15} /> Export for VIA…
          </Button>
          <Button kind="primary" onClick={() => setNaming(true)}>
            <Icon name="plus" size={15} /> Save current setup
          </Button>
        </>
      }
    >
      <Card title="Saved profiles">
        {profiles.length ? (
          <ul className="profile-list">
            {profiles.map((e) => (
              <ProfileRow key={e.id} entry={e} onApply={() => setApplying(e)} onChanged={refresh} />
            ))}
          </ul>
        ) : (
          <Empty title="No profiles yet" icon="profiles">
            Save your setup to switch between work, gaming or travel layouts in one click.
          </Empty>
        )}
      </Card>
      <Card title="Backups" subtitle="The 30 most recent are kept for each keyboard.">
        {backups.length ? (
          <ul className="profile-list">
            {backups.map((e) => (
              <ProfileRow key={e.id} entry={e} onApply={() => setApplying(e)} onChanged={refresh} />
            ))}
          </ul>
        ) : (
          <Empty title="No backups yet">{getState().connection.demo ? "The demo keyboard isn't backed up automatically." : "One is made when the keyboard connects."}</Empty>
        )}
      </Card>
      {applying && <ApplyDialog entry={applying} onClose={() => setApplying(null)} />}
      {naming && (
        <NameDialog
          title="Save current setup"
          initial="My setup"
          action="Save profile"
          onClose={() => setNaming(false)}
          onSave={async (name) => {
            const current = getState().kb;
            if (!current) return;
            await host.saveProfile({ id: `profile-${Date.now()}`, kind: "profile", profile: snapshot(current, name, macroNames()) });
            toast("Profile saved: keymap, knob, macros, lighting and settings", "success");
            refresh();
          }}
        />
      )}
    </Page>
  );
}

function ProfileRow({ entry, onApply, onChanged }: { entry: StoredProfile; onApply: () => void; onChanged: () => void }) {
  const p = entry.profile;
  const [renaming, setRenaming] = useState(false);
  const parts = ALL_SECTIONS.filter((s) => p[s] !== undefined).map((s) => SECTION_NAMES[s]);
  return (
    <li className="profile-row">
      <span className={`profile-icon ${entry.kind}`}>
        <Icon name={entry.kind === "backup" ? "undo" : "profiles"} size={16} />
      </span>
      <div className="profile-text">
        <strong>{p.name}</strong>
        <small>
          {new Date(p.createdAt).toLocaleString()} · {parts.join(", ")}
        </small>
      </div>
      <div className="row-actions">
        <Button small kind="primary" onClick={onApply}>
          {entry.kind === "backup" ? "Restore…" : "Apply…"}
        </Button>
        <Button small onClick={() => void host.exportJson(`${p.name.replace(/[^\w -]+/g, "")}.json`, p).catch((e) => toast(errorMessage(e), "error"))}>
          Export
        </Button>
        {entry.kind === "profile" && (
          <Button small kind="ghost" onClick={() => setRenaming(true)}>
            Rename
          </Button>
        )}
        <button
          className="icon-btn"
          title="Delete"
          onClick={async () => {
            if (!window.confirm(`Delete “${p.name}”?`)) return;
            await host.deleteProfile(entry.id);
            onChanged();
          }}
        >
          <Icon name="trash" size={15} />
        </button>
      </div>
      {renaming && (
        <NameDialog
          title="Rename profile"
          initial={p.name}
          action="Rename"
          onClose={() => setRenaming(false)}
          onSave={async (name) => {
            await host.saveProfile({ ...entry, profile: { ...p, name } });
            onChanged();
          }}
        />
      )}
    </li>
  );
}

function NameDialog({ title, initial, action, onClose, onSave }: { title: string; initial: string; action: string; onClose: () => void; onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState(initial);
  const save = async () => {
    if (!name.trim()) return;
    try {
      await onSave(name.trim());
      onClose();
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  };
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button kind="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button kind="primary" onClick={() => void save()} disabled={!name.trim()}>
            {action}
          </Button>
        </>
      }
    >
      <label className="field">
        <span>Name</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void save()} />
      </label>
    </Modal>
  );
}

function ApplyDialog({ entry, onClose }: { entry: StoredProfile; onClose: () => void }) {
  const p = entry.profile;
  const available = ALL_SECTIONS.filter((s) => p[s] !== undefined);
  const [sections, setSections] = useState<Set<ProfileSection>>(new Set(available));
  const [progress, setProgress] = useState<string | null>(null);

  const apply = async () => {
    const keyboard = getState().keyboard;
    if (!keyboard) return;
    const chosen = [...sections];
    const before = snapshot(keyboard.state, "Before applying", macroNames());
    setProgress("Saving a backup");
    try {
      if (!getState().connection.demo) await host.saveProfile({ id: `backup-${Date.now()}`, kind: "backup", profile: { ...before, name: `Before “${p.name}”` } });
      await perform(
        `Apply “${p.name}”`,
        () => applyProfile(keyboard, p, chosen, setProgress),
        () => applyProfile(keyboard, before, chosen),
      );
      await restoreMacroNames(p, chosen);
      toast(`Applied “${p.name}”`, "success");
      setState((s) => ({ profilesVersion: s.profilesVersion + 1 }));
      onClose();
    } catch (error) {
      toast(`Could not apply: ${errorMessage(error)}`, "error");
      setProgress(null);
    }
  };

  return (
    <Modal
      title={`${entry.kind === "backup" ? "Restore" : "Apply"} “${p.name}”`}
      onClose={() => !progress && onClose()}
      footer={
        <>
          <Button kind="ghost" onClick={onClose} disabled={!!progress}>
            Cancel
          </Button>
          <Button kind="primary" onClick={() => void apply()} disabled={!!progress || sections.size === 0}>
            {progress ?? "Write to keyboard"}
          </Button>
        </>
      }
    >
      <p className="muted">Choose what to write. Only settings that differ are sent, and a backup of the current setup is saved first.</p>
      <div className="check-list">
        {available.map((s) => (
          <label key={s} className="check">
            <input
              type="checkbox"
              checked={sections.has(s)}
              onChange={(e) => {
                const next = new Set(sections);
                if (e.target.checked) next.add(s);
                else next.delete(s);
                setSections(next);
              }}
            />
            {SECTION_NAMES[s]}
          </label>
        ))}
      </div>
    </Modal>
  );
}

async function restoreMacroNames(profile: Profile, sections: ProfileSection[]): Promise<void> {
  if (!sections.includes("macros") || !profile.macros) return;
  const names = profile.macros.names;
  if (!names.some(Boolean)) return;
  const s = getState();
  if (s.connection.demo) return;
  await updateSettings({ macroNames: { ...s.settings.macroNames, [keyboardId()]: names } });
}

/** Import a Keytune profile, a VIA saved layout, or a VIA keyboard definition. */
export async function importFile(): Promise<void> {
  try {
    const data = (await host.importJson()) as Record<string, unknown> | null;
    if (!data) return;
    const s = getState();
    if (isProfileFormat(data.format)) {
      const profile = parseProfile(data);
      await host.saveProfile({ id: `profile-${Date.now()}`, kind: "profile", profile });
      toast(`Imported “${profile.name}”. Apply it from Profiles.`, "success");
    } else if (Array.isArray(data.layers)) {
      if (!s.kb) throw new Error("Connect the keyboard before importing a layout");
      const { profile, unknown } = importViaLayout(data as unknown as ViaLayoutFile, s.kb, s.model?.definition.customKeycodes);
      await host.saveProfile({ id: `profile-${Date.now()}`, kind: "profile", profile: { ...profile, name: `${profile.name} (VIA)` } });
      toast(unknown.length ? `Imported, but ${unknown.length} keycodes weren't recognised (${unknown.slice(0, 3).join(", ")}…); those keys keep their current setting.` : "Imported the VIA layout. Apply it from Profiles.", unknown.length ? "error" : "success");
    } else if (data.matrix && data.layouts) {
      const model = await addDefinition(data);
      toast(`Added the definition for ${model.definition.name}`, "success");
    } else {
      throw new Error("This file isn't a profile, a VIA layout or a VIA keyboard definition");
    }
    setState((st) => ({ profilesVersion: st.profilesVersion + 1, view: getState().kb ? "profiles" : getState().view }));
  } catch (error) {
    toast(`Import failed: ${errorMessage(error)}`, "error");
  }
}

export async function exportProfile(): Promise<void> {
  const kb = getState().kb;
  if (!kb) return;
  const profile = snapshot(kb, `${kb.info.productName} ${new Date().toLocaleDateString()}`, macroNames());
  await host.exportJson(`${kb.info.productName}.json`, profile).catch((e) => toast(errorMessage(e), "error"));
}

async function exportVia(): Promise<void> {
  const s = getState();
  if (!s.kb) return;
  await host.exportJson(`${s.kb.info.productName} (VIA).json`, exportViaLayout(s.kb, s.model?.definition.customKeycodes)).catch((e) => toast(errorMessage(e), "error"));
}
