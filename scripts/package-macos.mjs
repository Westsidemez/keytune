// Packages out/ into release/Keytune-darwin-arm64/Keytune.app,
// then launches the packaged app once in smoke-test mode to prove it starts and renders.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { packager } from "@electron/packager";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const releaseRoot = path.join(root, "release");
const productName = "Keytune";
const appPath = path.join(releaseRoot, `${productName}-darwin-arm64`, `${productName}.app`);

for (const relative of ["out/main/index.js", "out/preload/index.js", "out/renderer/index.html", "out/renderer/trayTemplate.png", "build/icon.icns"]) {
  if (!fs.existsSync(path.join(root, relative))) throw new Error(`Missing ${relative}; run npm run build first`);
}

fs.rmSync(releaseRoot, { recursive: true, force: true });
await packager({
  dir: root,
  name: productName,
  platform: "darwin",
  arch: "arm64",
  electronVersion: "43.4.1",
  out: releaseRoot,
  overwrite: true,
  prune: true,
  icon: path.join(root, "build/icon.icns"),
  appBundleId: "io.keytune.app",
  appVersion: pkg.version,
  buildVersion: pkg.version,
  appCategoryType: "public.app-category.utilities",
  extendInfo: {
    NSAppleEventsUsageDescription: "Keytune presses keys and types text for your app macros.",
    LSMultipleInstancesProhibited: true,
  },
  ignore: /^\/(?:\.[^/]+|src|docs|scripts|test|build|release|vite\.config\.ts|vitest\.config\.ts|tsconfig\.json)(?:\/|$)/,
});

for (const relative of ["Contents/Info.plist", `Contents/MacOS/${productName}`, "Contents/Resources/app/out/main/index.js", "Contents/Resources/app/out/renderer/index.html", "Contents/Resources/electron.icns"]) {
  if (!fs.existsSync(path.join(appPath, relative))) throw new Error(`Packaged app is missing ${relative}`);
}

// Smoke test: the packaged app opens the demo keyboard offscreen and saves a screenshot.
const shot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "keytune-smoke-")), "keymap.png");
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const run = spawnSync(path.join(appPath, "Contents/MacOS", productName), [`--smoke-screenshot=${shot}`, "--smoke-view=keymap", "--smoke-self-test"], { stdio: "inherit", timeout: 90_000, env });
if (run.error) throw run.error;
if (run.status !== 0) throw new Error(`Packaged app smoke test exited with ${run.status}`);
const size = fs.existsSync(shot) ? fs.statSync(shot).size : 0;
if (size < 20_000) throw new Error(`Packaged app smoke test produced no usable screenshot (${size} bytes)`);
console.log(`Packaged ${appPath} (smoke screenshot ${Math.round(size / 1024)} KB)`);
