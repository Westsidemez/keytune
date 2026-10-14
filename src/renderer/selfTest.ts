// End-to-end check run by the packaged app's smoke test: drives the real store and
// actions against the demo keyboard and verifies what reached its simulated firmware.

import { HYPER, kc, macroKey, modTap } from "../shared/keycodes";
import { encodeMacroSteps } from "../shared/macros";
import { applyProfile, snapshot } from "../shared/profile";
import { assignEncoder, assignKey, paintKeys, setEffect, setLightingValue, swapKeys, writeMacros } from "./actions";
import { demoSimulator, getState, redo, undo } from "./store";

export async function selfTest(): Promise<string[]> {
  const failures: string[] = [];
  const check = (ok: boolean, what: string) => ok || failures.push(what);
  const s = getState();
  const sim = demoSimulator;
  const keyboard = s.keyboard;
  if (!sim || !keyboard || !s.model) return ["Demo keyboard did not connect"];
  const cols = sim.cols;
  const at = (layer: number, r: number, c: number) => sim.keymap[layer * sim.rows * cols + r * cols + c];

  await assignKey(0, 2, 1, kc("F13"));
  check(at(0, 2, 1) === kc("F13"), "assigning a key reaches the keyboard");
  await undo();
  check(at(0, 2, 1) === kc("Q"), "undo restores the key");
  await redo();
  check(at(0, 2, 1) === kc("F13"), "redo re-applies the key");
  await undo();

  await swapKeys(0, [3, 1], [3, 2]);
  check(at(0, 3, 1) === kc("S") && at(0, 3, 2) === kc("A"), "swapping keys");
  await undo();
  check(at(0, 3, 1) === kc("A"), "undoing a swap");

  await assignEncoder(0, 0, true, kc("MNXT"));
  check(keyboard.state.encoders[0][0][1] === kc("MNXT"), "knob mapping");

  check(at(0, 3, 0) === modTap(HYPER, kc("ESC")), "demo seed: Caps Lock is Esc/Hyper");

  const macros = keyboard.state.macros.data.slice();
  macros[7] = encodeMacroSteps([{ type: "text", text: "self test" }]);
  await writeMacros(macros);
  check(new TextDecoder().decode(keyboard.state.macros.data[7]) === "self test", "writing macros");
  await assignKey(1, 2, 2, macroKey(7));
  check(at(1, 2, 2) === macroKey(7), "macro on a key");

  const perKey = s.model.perKeyMode!;
  await setEffect(perKey);
  check(sim.rgb.mode === perKey, "switching effect");
  await paintKeys(new Map([[0, { h: 85, s: 255, v: 255 }]]), new Map([[0, keyboard.state.lighting!.perKey!.colors[0]]]));
  check(sim.perKey[0].h === 85, "painting a key");
  await setLightingValue("brightness", 40, false);
  await setLightingValue("brightness", 60, true, 200);
  check(sim.rgb.v === 60, "brightness");
  await undo();
  check(sim.rgb.v === 200, "undoing brightness");

  const saved = snapshot(keyboard.state, "Self test");
  await assignKey(0, 2, 1, kc("Z"));
  await applyProfile(keyboard, saved);
  check(at(0, 2, 1) === kc("Q"), "applying a profile");

  return failures;
}
