// Builds the app into out/: main and preload with esbuild, the renderer with Vite.

import { build as esbuild } from "esbuild";
import { build as vite } from "vite";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

console.log("Type checking…");
execFileSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), "--noEmit", "-p", "tsconfig.json"], { stdio: "inherit" });

fs.rmSync(path.join(root, "out"), { recursive: true, force: true });

const common = { bundle: true, platform: "node", format: "cjs", target: "node22", external: ["electron"], sourcemap: false, logLevel: "warning" };
await esbuild({ ...common, entryPoints: ["src/main/index.ts"], outfile: "out/main/index.js" });
await esbuild({ ...common, entryPoints: ["src/preload/index.ts"], outfile: "out/preload/index.js" });

await vite({ configFile: path.join(root, "vite.config.ts"), logLevel: "warn" });

console.log("Built out/main, out/preload and out/renderer");
