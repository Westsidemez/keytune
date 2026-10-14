// Key test: watch the switch matrix live, count presses and catch chattering switches.

import { useEffect, useRef, useState } from "react";
import { KeyboardView } from "../components/KeyboardView";
import { Workspace } from "../components/Workspace";
import { Button, Card, Empty } from "../components/ui";
import { demoSimulator, getState, useStudio } from "../store";
import { hidCodeFor } from "../hidCodes";
import { labelContext, keyLabel } from "../labels";

interface KeyStats {
  presses: number;
  chatter: number;
}

/** A second press this soon after a release is almost certainly switch chatter. */
const CHATTER_MS = 35;

export function KeyTestView() {
  const kb = useStudio((s) => s.kb)!;
  const model = useStudio((s) => s.model)!;
  const demo = useStudio((s) => s.connection.demo);
  const [down, setDown] = useState<Set<string>>(new Set());
  const [stats, setStats] = useState<Map<string, KeyStats>>(new Map());
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const prev = useRef<Set<string>>(new Set());
  const lastUp = useRef(new Map<string, number>());

  const keyByHid = useRef(new Map<number, string>());
  useEffect(() => {
    const map = new Map<number, string>();
    for (const key of model.layout.keys) if (key.row >= 0) map.set(kb.keymap[0][key.row * kb.cols + key.col], `${key.row},${key.col}`);
    keyByHid.current = map;
  }, [model, kb.keymap, kb.cols]);

  // Hardware view: poll the switch matrix.
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const keyboard = getState().keyboard;
      if (stopped || !keyboard) return;
      try {
        const matrix = await keyboard.matrixState();
        const now = new Set<string>();
        matrix.forEach((row, r) => row.forEach((on, c) => on && now.add(`${r},${c}`)));
        const before = prev.current;
        const pressed = [...now].filter((id) => !before.has(id));
        const released = [...before].filter((id) => !now.has(id));
        if (pressed.length || released.length) {
          setStats((s) => {
            const next = new Map(s);
            for (const id of pressed) {
              const st = next.get(id) ?? { presses: 0, chatter: 0 };
              next.set(id, { ...st, presses: st.presses + 1 });
            }
            return next;
          });
          setDown(now);
          if (pressed.length) setLog((l) => [...pressed.map((id) => describeKey(id)), ...l].slice(0, 40));
        }
        prev.current = now;
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
      if (!stopped) timer = setTimeout(poll, 30);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);

  // OS key events: precise timing for chatter, and they drive the demo keyboard's switches.
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input, textarea, select")) return;
      const hid = hidCodeFor(e.code);
      const id = hid !== undefined ? keyByHid.current.get(hid) : undefined;
      if (!id) return;
      e.preventDefault();
      if (demo && demoSimulator) {
        if (e.type === "keydown") demoSimulator.pressed.add(id);
        else demoSimulator.pressed.delete(id);
      }
      if (e.type === "keyup") lastUp.current.set(id, e.timeStamp);
      else if (!e.repeat) {
        const up = lastUp.current.get(id);
        if (up !== undefined && e.timeStamp - up < CHATTER_MS) {
          setStats((s) => {
            const st = s.get(id) ?? { presses: 0, chatter: 0 };
            return new Map(s).set(id, { ...st, chatter: st.chatter + 1 });
          });
        }
      }
    };
    window.addEventListener("keydown", handle);
    window.addEventListener("keyup", handle);
    return () => {
      window.removeEventListener("keydown", handle);
      window.removeEventListener("keyup", handle);
      demoSimulator?.pressed.clear();
    };
  }, [demo]);

  const describeKey = (id: string) => {
    const key = model.layout.keys.find((k) => k.id === id);
    const s = getState();
    if (!key || !s.kb) return id;
    return keyLabel(s.kb.keymap[0][key.row * s.kb.cols + key.col], labelContext(s), s.settings.appMacros).label || id;
  };

  const matrixKeys = model.layout.keys.filter((k) => k.row >= 0);
  const tested = matrixKeys.filter((k) => stats.has(k.id)).length;
  const chattering = [...stats.entries()].filter(([, s]) => s.chatter > 0);
  const total = [...stats.values()].reduce((n, s) => n + s.presses, 0);

  return (
    <Workspace
      keyboard={
        <KeyboardView
          mode="test"
          decorate={(key) => {
            const st = stats.get(key.id);
            const classes = [down.has(key.id) ? "down" : "", st ? "tested" : "", st?.chatter ? "chatter" : ""].filter(Boolean).join(" ");
            return classes || st ? { className: classes, content: st ? <><span className="legend"><span className="main">{describeKey(key.id)}</span></span><span className="count">{st.presses}</span></> : undefined } : undefined;
          }}
        />
      }
      panel={
        <div className="test-panel">
          <div className="stat-row">
            <div className="stat">
              <strong>
                {tested}/{matrixKeys.length}
              </strong>
              <span>keys tested</span>
            </div>
            <div className="stat">
              <strong>{total}</strong>
              <span>presses</span>
            </div>
            <div className={`stat${chattering.length ? " bad" : ""}`}>
              <strong>{chattering.length}</strong>
              <span>possible chatter</span>
            </div>
            <Button
              onClick={() => {
                setStats(new Map());
                setLog([]);
              }}
            >
              Reset
            </Button>
          </div>
          {error && <p className="banner warn">Can't read the switches: {error}</p>}
          <Card title="Recent presses">
            {log.length ? (
              <div className="press-log">
                {log.map((l, i) => (
                  <span key={i} className="chip">
                    {l}
                  </span>
                ))}
              </div>
            ) : (
              <Empty title="Press any key">Each switch lights up while it's held and turns green once it has worked.{demo ? " In demo mode, type on your own keyboard." : ""}</Empty>
            )}
          </Card>
        </div>
      }
      inspector={
        <div className="inspector-body">
          <div className="inspector-title">
            <span className="eyebrow">Key test</span>
            <h2>Check every switch</h2>
          </div>
          <Card>
            <p className="muted">This reads the switches straight from the keyboard, so it works for Fn and keys your computer ignores. Layers and macros don't matter here.</p>
          </Card>
          <Card title="Chatter">
            {chattering.length ? (
              <ul className="used-on">
                {chattering.map(([id, s]) => (
                  <li key={id}>
                    <span className="chip bad">{describeKey(id)}</span> {s.chatter}× double press within {CHATTER_MS} ms
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">None detected. A key that types twice will show here; raising debounce under Advanced usually fixes it.</p>
            )}
          </Card>
        </div>
      }
    />
  );
}
