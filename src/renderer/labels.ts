// Key labels in the current context: platform legends, macro names and app macros.

import { describe, type KeyLabel, type LabelContext } from "../shared/keycodes";
import type { AppMacro } from "../shared/appMacros";
import { labelPlatform, macroNames, getState, type StudioState } from "./store";

export function labelContext(s: StudioState = getState()): LabelContext {
  return {
    platform: labelPlatform(s),
    customKeycodes: s.model?.definition.customKeycodes,
    macroNames: macroNames(),
    layerNames: s.model?.layerNames,
  };
}

export function keyLabel(code: number, ctx: LabelContext, appMacros: AppMacro[]): KeyLabel {
  const app = appMacros.find((m) => m.trigger === code);
  if (app) {
    const short = app.name.length > 10 ? `${app.name.slice(0, 9)}…` : app.name;
    return { label: short, title: `App macro “${app.name}”`, name: describe(code, ctx).name, kind: "macro" };
  }
  return describe(code, ctx);
}

export function hex(code: number): string {
  return `0x${code.toString(16).padStart(4, "0").toUpperCase()}`;
}
