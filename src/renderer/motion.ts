// Whether lighting previews may animate: the window is visible and in front, and macOS "Reduce motion" is off.
// Paused previews keep showing their last frame.

const reduce = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
let focused = typeof document !== "undefined" ? document.hasFocus() : true;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") {
  window.addEventListener("focus", () => {
    focused = true;
    notify();
  });
  window.addEventListener("blur", () => {
    focused = false;
    notify();
  });
  document.addEventListener("visibilitychange", notify);
  reduce?.addEventListener("change", notify);
}

export const reducedMotion = (): boolean => !!reduce?.matches;

export function motionAllowed(): boolean {
  return !reducedMotion() && focused && document.visibilityState === "visible";
}

export function onMotionChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
