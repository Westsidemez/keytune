// Small shared controls.

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { HSV } from "../../shared/protocol/commands";
import { hexToHsv, hsvCss, hsvHex, hsvToRgb, SWATCHES } from "../color";

export function Icon({ name, size = 18 }: { name: keyof typeof ICONS; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ICONS[name]}
    </svg>
  );
}

export const ICONS = {
  keymap: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
    </>
  ),
  lighting: (
    <>
      <path d="M9 18h6M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3Z" />
    </>
  ),
  macros: (
    <>
      <path d="M4 7h10M4 12h7M4 17h10" />
      <path d="m16 10 4 2-4 2z" />
    </>
  ),
  advanced: (
    <>
      <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
      <circle cx="15" cy="6" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="17" cy="18" r="2" />
    </>
  ),
  test: (
    <>
      <path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3" />
      <path d="M7.5 15h9" />
    </>
  ),
  profiles: (
    <>
      <path d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </>
  ),
  undo: <path d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" />,
  redo: <path d="m15 14 5-5-5-5M20 9H9a5 5 0 0 0 0 10h3" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />,
  up: <path d="m6 15 6-6 6 6" />,
  down: <path d="m6 9 6 6 6-6" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  record: <circle cx="12" cy="12" r="6" fill="currentColor" stroke="none" />,
  play: <path d="m8 5 11 7-11 7z" />,
  check: <path d="m5 12 5 5 9-10" />,
  usb: (
    <>
      <path d="M12 3v14M8 7l4-4 4 4M7 13v2a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-3" />
      <circle cx="12" cy="20" r="1.5" />
    </>
  ),
  bolt: <path d="M13 3 5 14h6l-1 7 8-11h-6z" />,
  brush: (
    <>
      <path d="M9.5 14.5 18 6a2.1 2.1 0 0 0-3-3l-8.5 8.5" />
      <path d="M6.5 11.5c-2 0-3.5 1.5-3.5 3.5 0 1.5-1 2.5-2 3 4 1 8 0 8.5-3.5" />
    </>
  ),
  fill: <path d="M5 12 12 5l7 7-7 7zM19 15s2 2.2 2 3.5a2 2 0 0 1-4 0c0-1.3 2-3.5 2-3.5Z" />,
  picker: <path d="m14 7 3 3M5 19l1-4 9-9a2.1 2.1 0 0 1 3 3l-9 9zM4 20l1-1" />,
  download: <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />,
  upload: <path d="M12 20V9M7 14l5-5 5 5M5 4h14" />,
  knob: (
    <>
      <circle cx="12" cy="12" r="7" />
      <path d="M12 5v4" />
    </>
  ),
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
} as const;

export function Button({
  children,
  onClick,
  kind = "secondary",
  disabled,
  title,
  small,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: "primary" | "secondary" | "ghost" | "danger";
  disabled?: boolean;
  title?: string;
  small?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button type={type} className={`btn btn-${kind}${small ? " btn-small" : ""}`} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  );
}

export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  return (
    <label className={`toggle-row${disabled ? " disabled" : ""}`}>
      <span className="toggle-text">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch" aria-hidden />
    </label>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange, size }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; size?: "small" }) {
  return (
    <div className={`segmented${size ? " segmented-small" : ""}`} role="tablist">
      {options.map((o) => (
        <button key={String(o.value)} role="tab" aria-selected={o.value === value} className={o.value === value ? "on" : ""} title={o.title} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Slider that previews while dragging and commits once on release. */
export function Slider({
  label,
  value,
  min = 0,
  max = 255,
  step = 1,
  format = (v) => `${Math.round(((v - min) / (max - min)) * 100)}%`,
  onPreview,
  onCommit,
  disabled,
  background,
}: {
  label: ReactNode;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  format?: (v: number) => string;
  onPreview?: (v: number) => void;
  onCommit: (v: number, start: number) => void;
  disabled?: boolean;
  background?: string;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const start = useRef(value);
  const last = useRef(0);
  const shown = draft ?? value;
  const commit = () => {
    if (draft === null) return;
    const v = draft;
    setDraft(null);
    if (v !== start.current) onCommit(v, start.current);
  };
  return (
    <label className={`slider${disabled ? " disabled" : ""}`}>
      <span className="slider-head">
        <span>{label}</span>
        <output>{format(shown)}</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={shown}
        disabled={disabled}
        style={{ "--fill": `${((shown - min) / (max - min)) * 100}%`, ...(background ? { "--track": background } : {}) } as React.CSSProperties}
        onPointerDown={() => (start.current = value)}
        onKeyDown={() => draft === null && (start.current = value)}
        onChange={(e) => {
          const v = Number(e.target.value);
          setDraft(v);
          const now = performance.now();
          if (onPreview && now - last.current > 40) {
            last.current = now;
            onPreview(v);
          }
        }}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
    </label>
  );
}

/** Hue/saturation pad, value slider, hex field and swatches, in QMK 0-255 units. */
export function ColorPicker({
  value,
  onChange,
  onCommit,
  showValue = true,
  swatches = SWATCHES,
}: {
  value: HSV;
  onChange?: (hsv: HSV) => void;
  onCommit: (hsv: HSV, start: HSV) => void;
  showValue?: boolean;
  swatches?: HSV[];
}) {
  const [draft, setDraft] = useState<HSV | null>(null);
  const [hex, setHex] = useState<string | null>(null);
  const start = useRef(value);
  const pad = useRef<HTMLDivElement>(null);
  const shown = draft ?? value;
  const last = useRef(0);

  const move = (event: React.PointerEvent | PointerEvent) => {
    const rect = pad.current!.getBoundingClientRect();
    const h = Math.round(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) * 255);
    const s = Math.round((1 - Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))) * 255);
    const next = { ...shown, h, s };
    setDraft(next);
    const now = performance.now();
    if (onChange && now - last.current > 50) {
      last.current = now;
      onChange(next);
    }
    return next;
  };

  return (
    <div className="color-picker">
      <div
        ref={pad}
        className="hs-pad"
        onPointerDown={(e) => {
          start.current = value;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          move(e);
        }}
        onPointerMove={(e) => e.buttons && move(e)}
        onPointerUp={(e) => {
          const v = move(e);
          setDraft(null);
          onCommit(v, start.current);
        }}
      >
        <span className="hs-thumb" style={{ left: `${(shown.h / 255) * 100}%`, top: `${(1 - shown.s / 255) * 100}%`, background: hsvCss({ ...shown, v: 255 }) }} />
      </div>
      {showValue && (
        <Slider
          label="Brightness"
          value={shown.v}
          background={`linear-gradient(90deg, #000, ${hsvCss({ ...shown, v: 255 })})`}
          onPreview={(v) => onChange?.({ ...shown, v })}
          onCommit={(v) => onCommit({ ...value, v }, value)}
        />
      )}
      <div className="color-row">
        <span className="color-chip" style={{ background: hsvCss(shown) }} />
        <input
          className="hex"
          value={hex ?? hsvHex(shown)}
          spellCheck={false}
          onChange={(e) => setHex(e.target.value)}
          onBlur={() => {
            const parsed = hex ? hexToHsv(hex) : null;
            setHex(null);
            if (parsed) onCommit(showValue ? parsed : { ...parsed, v: value.v }, value);
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
      </div>
      <div className="swatches">
        {swatches.map((s, i) => (
          <button key={i} className="swatch" title={hsvHex(s)} style={{ background: hsvCss(s) }} onClick={() => onCommit(showValue ? s : { ...s, v: value.v }, value)} />
        ))}
      </div>
    </div>
  );
}

export function Card({ title, subtitle, actions, children, className }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className ?? ""}`}>
      {(title || actions) && (
        <header className="card-head">
          <div>
            {title && <h3>{title}</h3>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Modal({ title, children, onClose, footer }: { title: ReactNode; children: ReactNode; onClose: () => void; footer?: ReactNode }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={typeof title === "string" ? title : undefined}>
        <header>
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

export function Meter({ used, total, label }: { used: number; total: number; label?: ReactNode }) {
  const pct = total ? Math.min(100, (used / total) * 100) : 0;
  return (
    <div className={`meter${pct > 90 ? " meter-full" : ""}`}>
      <div className="meter-head">
        <span>{label}</span>
        <span>
          {used.toLocaleString()} / {total.toLocaleString()} bytes
        </span>
      </div>
      <div className="meter-track">
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function Empty({ title, children, icon }: { title: ReactNode; children?: ReactNode; icon?: keyof typeof ICONS }) {
  return (
    <div className="empty">
      {icon && (
        <span className="empty-icon">
          <Icon name={icon} size={22} />
        </span>
      )}
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}

export function rgbCss(rgb: [number, number, number] | null | undefined): string | undefined {
  return rgb ? `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})` : undefined;
}

export function hsvRgb(hsv: HSV): [number, number, number] {
  return hsvToRgb(hsv);
}

/** Native colour well that commits once, when the system picker is closed or confirmed. */
export function ColorInput({ value, onCommit, title }: { value: HSV; onCommit: (hsv: HSV) => void; title?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const commit = useRef(onCommit);
  commit.current = onCommit;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const changed = () => {
      const hsv = hexToHsv(el.value);
      setDraft(null);
      if (hsv) commit.current(hsv);
    };
    el.addEventListener("change", changed);
    return () => el.removeEventListener("change", changed);
  }, []);
  return <input ref={ref} type="color" className="color-input" title={title} value={draft ?? hsvHex(value)} onChange={(e) => setDraft(e.target.value)} />;
}
