// Typed wrappers for the VIA protocol (quantum/via.c) and Keychron's
// extensions (keyboards/keychron/common/keychron_raw_hid.c and friends).
// Byte offsets below are absolute positions in the 32-byte report.

import { ProtocolError, Transport } from "./transport";

export const VIA = {
  GET_PROTOCOL_VERSION: 0x01,
  GET_KEYBOARD_VALUE: 0x02,
  SET_KEYBOARD_VALUE: 0x03,
  GET_KEYCODE: 0x04,
  SET_KEYCODE: 0x05,
  KEYMAP_RESET: 0x06,
  CUSTOM_SET_VALUE: 0x07,
  CUSTOM_GET_VALUE: 0x08,
  CUSTOM_SAVE: 0x09,
  EEPROM_RESET: 0x0a,
  BOOTLOADER_JUMP: 0x0b,
  MACRO_GET_COUNT: 0x0c,
  MACRO_GET_BUFFER_SIZE: 0x0d,
  MACRO_GET_BUFFER: 0x0e,
  MACRO_SET_BUFFER: 0x0f,
  MACRO_RESET: 0x10,
  GET_LAYER_COUNT: 0x11,
  KEYMAP_GET_BUFFER: 0x12,
  KEYMAP_SET_BUFFER: 0x13,
  GET_ENCODER: 0x14,
  SET_ENCODER: 0x15,
} as const;

export const KEYBOARD_VALUE = {
  UPTIME: 0x01,
  LAYOUT_OPTIONS: 0x02,
  SWITCH_MATRIX_STATE: 0x03,
  FIRMWARE_VERSION: 0x04,
  DEVICE_INDICATION: 0x05,
} as const;

export const RGB_MATRIX_CHANNEL = 3;
export const RGB_VALUE = { BRIGHTNESS: 1, EFFECT: 2, SPEED: 3, COLOR: 4 } as const;

export const KC = {
  GET_PROTOCOL_VERSION: 0xa0,
  GET_FIRMWARE_VERSION: 0xa1,
  GET_SUPPORT_FEATURE: 0xa2,
  GET_DEFAULT_LAYER: 0xa3,
  MISC: 0xa7,
  RGB: 0xa8,
} as const;

export const FEATURE = {
  DEFAULT_LAYER: 1 << 0,
  BLUETOOTH: 1 << 1,
  P24G: 1 << 2,
  ANALOG_MATRIX: 1 << 3,
  STATE_NOTIFY: 1 << 4,
  DYNAMIC_DEBOUNCE: 1 << 5,
  SNAP_CLICK: 1 << 6,
  KEYCHRON_RGB: 1 << 7,
  QUICK_START: 1 << 8,
  NKRO: 1 << 9,
} as const;

export const MISC_FEATURE = {
  DFU_INFO: 1 << 0,
  LANGUAGE: 1 << 1,
  DEBOUNCE: 1 << 2,
  SNAP_CLICK: 1 << 3,
  WIRELESS_LPM: 1 << 4,
  REPORT_RATE: 1 << 5,
  QUICK_START: 1 << 6,
  NKRO: 1 << 7,
} as const;

export const MISC = {
  GET_PROTOCOL_VERSION: 0x01,
  DFU_INFO_GET: 0x02,
  LANGUAGE_GET: 0x03,
  LANGUAGE_SET: 0x04,
  DEBOUNCE_GET: 0x05,
  DEBOUNCE_SET: 0x06,
  SNAP_CLICK_GET_INFO: 0x07,
  SNAP_CLICK_GET: 0x08,
  SNAP_CLICK_SET: 0x09,
  SNAP_CLICK_SAVE: 0x0a,
  WIRELESS_LPM_GET: 0x0b,
  WIRELESS_LPM_SET: 0x0c,
  NKRO_GET: 0x12,
  NKRO_SET: 0x13,
} as const;

export const RGB_CMD = {
  GET_PROTOCOL_VERSION: 0x01,
  SAVE: 0x02,
  GET_INDICATORS: 0x03,
  SET_INDICATORS: 0x04,
  GET_LED_COUNT: 0x05,
  GET_LED_INDEX: 0x06,
  PER_KEY_GET_TYPE: 0x07,
  PER_KEY_SET_TYPE: 0x08,
  PER_KEY_GET_COLOR: 0x09,
  PER_KEY_SET_COLOR: 0x0a,
  MIXED_GET_INFO: 0x0b,
  MIXED_GET_REGIONS: 0x0c,
  MIXED_SET_REGIONS: 0x0d,
  MIXED_GET_EFFECTS: 0x0e,
  MIXED_SET_EFFECTS: 0x0f,
} as const;

/** Largest data block VIA moves per report (32 - 4 header bytes). */
export const BUFFER_CHUNK = 28;
/** Per-key colours per report: (32 - 3 header bytes) / 3, capped by firmware at 9. */
export const COLOR_CHUNK = 9;
/** Mixed-RGB region bytes per write; firmware caps reads at 29 and writes at 28. */
export const REGION_CHUNK = 28;
/** Mixed-RGB effect entries per report (8 bytes each). */
export const EFFECT_CHUNK = 3;
/** Snap Click pairs per report (3 bytes each). */
export const SNAP_CHUNK = 9;

export interface HSV {
  h: number;
  s: number;
  v: number;
}

export interface MixedEffect {
  effect: number;
  hue: number;
  sat: number;
  speed: number;
  /** Milliseconds the effect plays before the zone moves to the next one. */
  time: number;
}

export interface IndicatorConfig {
  /** Bit mask of indicators this keyboard has (bit 0 Num Lock, 1 Caps Lock, 2 Scroll Lock, 3 Compose, 4 Kana). */
  supported: number;
  /** Bit mask of indicators the user turned off. */
  disabled: number;
  hsv: HSV;
}

export interface SnapClickPair {
  /** 0 off, 1 regular, 2 last input, 3 first key, 4 second key, 5 neutral. */
  type: number;
  keys: [number, number];
}

export interface SleepConfig {
  /** Seconds before the backlight turns off on wireless. */
  backlightOff: number;
  /** Seconds before the keyboard sleeps on wireless. */
  idleSleep: number;
}

export interface NkroState {
  enabled: boolean;
  settable: boolean;
  adaptive: boolean;
}

export class KeyboardProtocol {
  constructor(readonly transport: Transport) {}

  // --- VIA core ------------------------------------------------------------

  async viaProtocolVersion(): Promise<number> {
    const r = await this.transport.request([VIA.GET_PROTOCOL_VERSION]);
    return (r[1] << 8) | r[2];
  }

  async layerCount(): Promise<number> {
    const r = await this.transport.request([VIA.GET_LAYER_COUNT]);
    return r[1];
  }

  async keycode(layer: number, row: number, col: number): Promise<number> {
    const r = await this.transport.request([VIA.GET_KEYCODE, layer, row, col], { echo: 3 });
    return (r[4] << 8) | r[5];
  }

  async setKeycode(layer: number, row: number, col: number, keycode: number): Promise<void> {
    await this.transport.request([VIA.SET_KEYCODE, layer, row, col, keycode >> 8, keycode & 0xff], { echo: 3 });
  }

  /** Read the whole dynamic keymap as big-endian keycodes, layer-major then row then column. */
  async keymapBuffer(byteLength: number): Promise<Uint8Array> {
    return this.readBuffer(VIA.KEYMAP_GET_BUFFER, byteLength);
  }

  async setKeymapBuffer(offset: number, data: Uint8Array): Promise<void> {
    await this.writeBuffer(VIA.KEYMAP_SET_BUFFER, offset, data);
  }

  async resetKeymap(): Promise<void> {
    await this.transport.request([VIA.KEYMAP_RESET]);
  }

  async encoder(layer: number, index: number, clockwise: boolean): Promise<number> {
    const r = await this.transport.request([VIA.GET_ENCODER, layer, index, clockwise ? 1 : 0], { echo: 3 });
    return (r[4] << 8) | r[5];
  }

  async setEncoder(layer: number, index: number, clockwise: boolean, keycode: number): Promise<void> {
    await this.transport.request([VIA.SET_ENCODER, layer, index, clockwise ? 1 : 0, keycode >> 8, keycode & 0xff], { echo: 3 });
  }

  async macroCount(): Promise<number> {
    const r = await this.transport.request([VIA.MACRO_GET_COUNT]);
    return r[1];
  }

  async macroBufferSize(): Promise<number> {
    const r = await this.transport.request([VIA.MACRO_GET_BUFFER_SIZE]);
    return (r[1] << 8) | r[2];
  }

  async macroBuffer(byteLength: number): Promise<Uint8Array> {
    return this.readBuffer(VIA.MACRO_GET_BUFFER, byteLength);
  }

  async writeMacroBufferAt(offset: number, data: Uint8Array): Promise<void> {
    await this.writeBuffer(VIA.MACRO_SET_BUFFER, offset, data);
  }

  async resetMacros(): Promise<void> {
    await this.transport.request([VIA.MACRO_RESET]);
  }

  /** Pressed state of every switch, one bit per column. Needs VIA_INSECURE firmware (Keychron builds set it). */
  async matrixState(rows: number, cols: number): Promise<boolean[][]> {
    const bytesPerRow = Math.ceil(cols / 8);
    const rowsPerReport = Math.floor(28 / bytesPerRow);
    const state: boolean[][] = [];
    for (let offset = 0; offset < rows; offset += rowsPerReport) {
      const r = await this.transport.request([VIA.GET_KEYBOARD_VALUE, KEYBOARD_VALUE.SWITCH_MATRIX_STATE, offset], { echo: 2 });
      for (let row = offset; row < Math.min(rows, offset + rowsPerReport); row++) {
        let value = 0;
        const base = 3 + (row - offset) * bytesPerRow;
        for (let b = 0; b < bytesPerRow; b++) value = value * 256 + r[base + b];
        const bits: boolean[] = [];
        for (let col = 0; col < cols; col++) bits.push(Math.floor(value / 2 ** col) % 2 === 1);
        state.push(bits);
      }
    }
    return state;
  }

  async uptime(): Promise<number> {
    const r = await this.transport.request([VIA.GET_KEYBOARD_VALUE, KEYBOARD_VALUE.UPTIME], { echo: 1 });
    return ((r[2] << 24) >>> 0) + (r[3] << 16) + (r[4] << 8) + r[5];
  }

  /**
   * Flash the keyboard's lights so the user can spot it. Each indication
   * toggles the backlight without saving, so an even count restores it.
   */
  async indicate(flashes = 3, intervalMs = 180): Promise<void> {
    for (let i = 0; i < flashes * 2; i++) {
      await this.transport.request([VIA.SET_KEYBOARD_VALUE, KEYBOARD_VALUE.DEVICE_INDICATION, i], { echo: 1 });
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  // --- QMK RGB matrix (VIA custom channel 3) -------------------------------

  async rgbValue(valueId: number): Promise<number[]> {
    const r = await this.transport.request([VIA.CUSTOM_GET_VALUE, RGB_MATRIX_CHANNEL, valueId], { echo: 2 });
    return [r[3], r[4]];
  }

  /**
   * Apply and persist one RGB matrix value. Keychron firmware only writes the
   * value to flash when the save follows a single set, so each value is saved
   * on its own.
   */
  async setRgbValue(valueId: number, data: number[]): Promise<void> {
    await this.transport.request([VIA.CUSTOM_SET_VALUE, RGB_MATRIX_CHANNEL, valueId, ...data], { echo: 2 });
    await this.transport.request([VIA.CUSTOM_SAVE, RGB_MATRIX_CHANNEL, valueId], { echo: 2 });
  }

  // --- Keychron extensions ---------------------------------------------------

  async keychronProtocol(): Promise<{ version: number; commandSet: number }> {
    const r = await this.transport.request([KC.GET_PROTOCOL_VERSION]);
    return { version: r[1], commandSet: r[3] };
  }

  async firmwareVersion(): Promise<string> {
    const r = await this.transport.request([KC.GET_FIRMWARE_VERSION]);
    return ascii(r.subarray(1));
  }

  async supportedFeatures(): Promise<number> {
    const r = await this.transport.request([KC.GET_SUPPORT_FEATURE]);
    return r[2] | (r[3] << 8);
  }

  async activeLayers(): Promise<{ defaultLayer: number; topLayer: number }> {
    const r = await this.transport.request([KC.GET_DEFAULT_LAYER]);
    return { defaultLayer: r[1], topLayer: r[2] };
  }

  async miscProtocol(): Promise<{ version: number; features: number }> {
    const r = await this.misc(MISC.GET_PROTOCOL_VERSION);
    return { version: r[3] | (r[4] << 8), features: r[5] };
  }

  async dfuInfo(): Promise<{ mcu: string; bootloader: string }> {
    const r = await this.misc(MISC.DFU_INFO_GET);
    const length = r[4];
    const mcu = ascii(r.subarray(5, 5 + length));
    const type = r[5 + length + 2];
    return { mcu, bootloader: type === 1 ? "STM32 DFU" : type === 2 ? "WB32 DFU" : "Unknown" };
  }

  async debounce(): Promise<{ type: number; time: number }> {
    const r = await this.misc(MISC.DEBOUNCE_GET);
    return { type: r[4], time: r[5] };
  }

  async setDebounce(type: number, time: number): Promise<void> {
    await this.miscChecked(MISC.DEBOUNCE_SET, [type, time]);
  }

  async snapClickCount(): Promise<number> {
    const r = await this.misc(MISC.SNAP_CLICK_GET_INFO);
    return r[3];
  }

  async snapClicks(count: number): Promise<SnapClickPair[]> {
    const pairs: SnapClickPair[] = [];
    for (let start = 0; start < count; start += SNAP_CHUNK) {
      const n = Math.min(SNAP_CHUNK, count - start);
      const r = await this.miscChecked(MISC.SNAP_CLICK_GET, [start, n]);
      for (let i = 0; i < n; i++) {
        const o = 3 + i * 3;
        pairs.push({ type: r[o], keys: [r[o + 1], r[o + 2]] });
      }
    }
    return pairs;
  }

  async setSnapClicks(start: number, pairs: SnapClickPair[]): Promise<void> {
    for (let i = 0; i < pairs.length; i += SNAP_CHUNK) {
      const chunk = pairs.slice(i, i + SNAP_CHUNK);
      const body = chunk.flatMap((p) => [p.type, p.keys[0], p.keys[1]]);
      await this.miscChecked(MISC.SNAP_CLICK_SET, [start + i, chunk.length, ...body]);
    }
    await this.miscChecked(MISC.SNAP_CLICK_SAVE, []);
  }

  async sleep(): Promise<SleepConfig> {
    const r = await this.miscChecked(MISC.WIRELESS_LPM_GET, []);
    return { backlightOff: r[3] | (r[4] << 8), idleSleep: r[5] | (r[6] << 8) };
  }

  async setSleep(config: SleepConfig): Promise<void> {
    const { backlightOff: b, idleSleep: i } = config;
    await this.miscChecked(MISC.WIRELESS_LPM_SET, [b & 0xff, b >> 8, i & 0xff, i >> 8]);
  }

  async nkro(): Promise<NkroState> {
    const r = await this.miscChecked(MISC.NKRO_GET, []);
    return { enabled: (r[3] & 1) !== 0, settable: (r[3] & 2) !== 0, adaptive: (r[3] & 4) !== 0 };
  }

  async setNkro(enabled: boolean): Promise<void> {
    await this.miscChecked(MISC.NKRO_SET, [enabled ? 1 : 0]);
  }

  async rgbProtocol(): Promise<number> {
    const r = await this.rgb(RGB_CMD.GET_PROTOCOL_VERSION, []);
    return r[3] | (r[4] << 8);
  }

  async ledCount(): Promise<number> {
    const r = await this.rgb(RGB_CMD.GET_LED_COUNT, []);
    return r[3];
  }

  /** LED index for each column of a matrix row, or null where the switch has no LED. */
  async ledIndices(row: number, cols: number): Promise<(number | null)[]> {
    const mask = cols >= 24 ? 0xffffff : (1 << cols) - 1;
    const r = await this.rgb(RGB_CMD.GET_LED_INDEX, [row, mask & 0xff, (mask >> 8) & 0xff, (mask >> 16) & 0xff]);
    const result: (number | null)[] = [];
    for (let c = 0; c < cols; c++) result.push(r[3 + c] === 0xff ? null : r[3 + c]);
    return result;
  }

  async saveKeychronRgb(): Promise<void> {
    await this.rgb(RGB_CMD.SAVE, []);
  }

  async indicators(): Promise<IndicatorConfig> {
    const r = await this.rgb(RGB_CMD.GET_INDICATORS, []);
    return { supported: r[3], disabled: r[4], hsv: { h: r[5], s: r[6], v: r[7] } };
  }

  async setIndicators(disabled: number, hsv: HSV): Promise<void> {
    await this.rgb(RGB_CMD.SET_INDICATORS, [disabled, hsv.h, hsv.s, hsv.v]);
  }

  async perKeyType(): Promise<number> {
    const r = await this.rgb(RGB_CMD.PER_KEY_GET_TYPE, []);
    return r[3];
  }

  async setPerKeyType(type: number): Promise<void> {
    await this.rgb(RGB_CMD.PER_KEY_SET_TYPE, [type]);
  }

  async perKeyColors(count: number): Promise<HSV[]> {
    const colors: HSV[] = [];
    for (let start = 0; start < count; start += COLOR_CHUNK) {
      const n = Math.min(COLOR_CHUNK, count - start);
      const r = await this.rgb(RGB_CMD.PER_KEY_GET_COLOR, [start, n]);
      for (let i = 0; i < n; i++) colors.push({ h: r[3 + i * 3], s: r[4 + i * 3], v: r[5 + i * 3] });
    }
    return colors;
  }

  async setPerKeyColors(start: number, colors: HSV[]): Promise<void> {
    for (let i = 0; i < colors.length; i += COLOR_CHUNK) {
      const chunk = colors.slice(i, i + COLOR_CHUNK);
      await this.rgb(RGB_CMD.PER_KEY_SET_COLOR, [start + i, chunk.length, ...chunk.flatMap((c) => [c.h, c.s, c.v])]);
    }
  }

  async mixedInfo(): Promise<{ regions: number; effectsPerRegion: number }> {
    const r = await this.rgb(RGB_CMD.MIXED_GET_INFO, []);
    return { regions: r[3], effectsPerRegion: r[4] };
  }

  async mixedRegions(ledCount: number): Promise<number[]> {
    const regions: number[] = [];
    for (let start = 0; start < ledCount; start += REGION_CHUNK) {
      const n = Math.min(REGION_CHUNK, ledCount - start);
      const r = await this.rgb(RGB_CMD.MIXED_GET_REGIONS, [start, n]);
      for (let i = 0; i < n; i++) regions.push(r[3 + i]);
    }
    return regions;
  }

  async setMixedRegions(start: number, regions: number[]): Promise<void> {
    for (let i = 0; i < regions.length; i += REGION_CHUNK) {
      const chunk = regions.slice(i, i + REGION_CHUNK);
      await this.rgb(RGB_CMD.MIXED_SET_REGIONS, [start + i, chunk.length, ...chunk]);
    }
  }

  async mixedEffects(region: number, count: number): Promise<MixedEffect[]> {
    const effects: MixedEffect[] = [];
    for (let start = 0; start < count; start += EFFECT_CHUNK) {
      const n = Math.min(EFFECT_CHUNK, count - start);
      const r = await this.rgb(RGB_CMD.MIXED_GET_EFFECTS, [region, start, n]);
      for (let i = 0; i < n; i++) {
        const o = 3 + i * 8;
        effects.push({
          effect: r[o],
          hue: r[o + 1],
          sat: r[o + 2],
          speed: r[o + 3],
          time: (r[o + 4] | (r[o + 5] << 8) | (r[o + 6] << 16) | (r[o + 7] << 24)) >>> 0,
        });
      }
    }
    return effects;
  }

  async setMixedEffects(region: number, start: number, effects: MixedEffect[]): Promise<void> {
    for (let i = 0; i < effects.length; i += EFFECT_CHUNK) {
      const chunk = effects.slice(i, i + EFFECT_CHUNK);
      const body = chunk.flatMap((e) => [e.effect, e.hue, e.sat, e.speed, e.time & 0xff, (e.time >>> 8) & 0xff, (e.time >>> 16) & 0xff, (e.time >>> 24) & 0xff]);
      await this.rgb(RGB_CMD.MIXED_SET_EFFECTS, [region, start + i, chunk.length, ...body]);
    }
  }

  // --- helpers -------------------------------------------------------------

  private async readBuffer(command: number, byteLength: number): Promise<Uint8Array> {
    const data = new Uint8Array(byteLength);
    for (let offset = 0; offset < byteLength; offset += BUFFER_CHUNK) {
      const size = Math.min(BUFFER_CHUNK, byteLength - offset);
      const r = await this.transport.request([command, offset >> 8, offset & 0xff, size], { echo: 3 });
      data.set(r.subarray(4, 4 + size), offset);
    }
    return data;
  }

  private async writeBuffer(command: number, start: number, data: Uint8Array): Promise<void> {
    for (let i = 0; i < data.length; i += BUFFER_CHUNK) {
      const chunk = data.subarray(i, i + BUFFER_CHUNK);
      const offset = start + i;
      await this.transport.request([command, offset >> 8, offset & 0xff, chunk.length, ...chunk], { echo: 3 });
    }
  }

  private misc(sub: number, args: number[] = []): Promise<Uint8Array> {
    return this.transport.request([KC.MISC, sub, ...args]);
  }

  /** Misc commands that report success in byte 2. */
  private async miscChecked(sub: number, args: number[]): Promise<Uint8Array> {
    const r = await this.misc(sub, args);
    if (r[2] !== 0) throw new ProtocolError(`Keyboard rejected setting 0x${sub.toString(16)}`);
    return r;
  }

  private async rgb(sub: number, args: number[]): Promise<Uint8Array> {
    const r = await this.transport.request([KC.RGB, sub, ...args]);
    if (r[2] !== 0) throw new ProtocolError(`Keyboard rejected lighting command 0x${sub.toString(16)}`);
    return r;
  }
}

function ascii(bytes: Uint8Array): string {
  let text = "";
  for (const b of bytes) {
    if (b === 0) break;
    text += String.fromCharCode(b);
  }
  return text.trim();
}
