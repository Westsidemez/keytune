// Shared page frame: the keyboard on top, the view's tools below, the inspector on the right.

import type { ReactNode } from "react";

export function Workspace({ keyboard, panel, inspector, toolbar, compact }: { keyboard?: ReactNode; panel?: ReactNode; inspector?: ReactNode; toolbar?: ReactNode; compact?: boolean }) {
  return (
    <div className={`workspace${inspector ? "" : " no-inspector"}${compact ? " compact-stage" : ""}`}>
      <div className="workspace-main">
        {keyboard && (
          <div className="stage">
            {toolbar && <div className="stage-toolbar">{toolbar}</div>}
            {keyboard}
          </div>
        )}
        {panel && <div className="panel">{panel}</div>}
      </div>
      {inspector && <aside className="inspector">{inspector}</aside>}
    </div>
  );
}

export function Page({ title, subtitle, actions, children }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </header>
      <div className="page-body">{children}</div>
    </div>
  );
}
