# Third-party notices

Keytune is licensed under the GNU General Public License v3.0 or later (see `LICENSE`). It includes material from these projects:

| Material | Source | Licence |
| --- | --- | --- |
| `src/shared/data/qmk-keycodes.json` (keycode values) | `quantum/keycodes.h` in [Keychron's QMK firmware](https://github.com/Keychron/qmk_firmware), a fork of [QMK](https://github.com/qmk/qmk_firmware) | GPL-2.0-or-later |
| `src/shared/data/v5-max.json` (Keychron V5 Max definitions and default keymaps) | `keyboards/keychron/v5_max` in Keychron's QMK firmware | GPL-2.0-or-later |
| Built-in lighting menu effect names in `src/shared/definitions.ts` | `src/common-menus` in [the-via/reader](https://github.com/the-via/reader) | GPL-3.0 |

`scripts/generate-firmware-data.mjs` regenerates the two data files from a firmware checkout.

At runtime Keytune downloads keyboard definitions from VIA's library (`usevia.app`, built from [the-via/keyboards](https://github.com/the-via/keyboards), GPL-3.0) when a keyboard isn't already known.

The app is built with Electron, React, Vite and TypeScript, and tested with Vitest. Their licences (MIT, BSD and Apache-2.0) are listed in each package under `node_modules`, and the packaged app includes Electron's and Chromium's licence files.
