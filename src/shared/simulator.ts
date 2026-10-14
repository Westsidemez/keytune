// In-memory Keychron keyboard that answers raw HID reports the way the
// firmware does. It is written from the C handlers (quantum/via.c,
// keyboards/keychron/common/keychron_raw_hid.c, rgb/keychron_rgb.c,
// snap_click/snap_click.c, debounce, wireless, nkro.c) with their absolute
// byte offsets, independently of the client code, so tests catch offset
// mistakes. It also powers the app's demo keyboard.

import type { HidLink } from "./protocol/transport";
import type { KeyboardModel } from "./definitions";

export interface SimulatorOptions {
  macroCount?: number;
  macroBufferSize?: number;
  layers?: number;
  /** Delay before each reply, in ms. */
  latencyMs?: number;
  firmware?: string;
  /** Drop the reply to the next N requests (to exercise timeouts). */
  dropReplies?: number;
  /** False to act as a plain VIA keyboard without Keychron's commands. */
  keychron?: boolean;
  /** VIA channel the lighting answers on (3 RGB matrix, 2 underglow, 1 backlight); 0 for none. */
  lightingChannel?: number;
}

interface Hsv {
  h: number;
  s: number;
  v: number;
}

const EFFECT_LAYERS = 2;
const EFFECTS_PER_LAYER = 5;
const SNAP_CLICK_COUNT = 20;

export class SimulatedKeyboard implements HidLink {
  readonly rows: number;
  readonly cols: number;
  readonly layers: number;
  keymap: Uint16Array;
  encoders: Uint16Array; // [layer][encoder][dir]
  macroCount: number;
  macroBuffer: Uint8Array;
  rgb = { enabled: true, mode: 24, h: 0, s: 255, v: 200, speed: 127 };
  perKeyType = 0;
  ledCount: number;
  perKey: Hsv[];
  regions: Uint8Array;
  effectList: { effect: number; hue: number; sat: number; speed: number; time: number }[][];
  indicators = { disabled: 0, h: 0, s: 0, v: 255 };
  debounce = { type: 0, time: 5 };
  snapClicks: { type: number; keys: [number, number] }[];
  lpm = { backlit: 30, idle: 1800 };
  nkro = false;
  language = 0;
  defaultLayer = 0;
  topLayer = 0;
  pressed = new Set<string>();
  /** Every request received, for assertions. */
  readonly log: Uint8Array[] = [];
  /** Number of writes that reached flash, keyed by area. */
  readonly saves: Record<string, number> = {};
  private readonly ledIndex: Map<string, number>;
  private readonly listeners = new Set<(report: Uint8Array) => void>();
  private readonly encoderCount: number;
  private rgbValueMask = 0;
  private dropReplies: number;

  constructor(
    readonly model: KeyboardModel,
    private readonly options: SimulatorOptions = {},
  ) {
    this.rows = model.definition.matrix.rows;
    this.cols = model.definition.matrix.cols;
    this.layers = options.layers ?? Math.max(4, model.defaults?.layers.length ?? 4);
    this.encoderCount = model.layout.encoders;
    this.keymap = new Uint16Array(this.layers * this.rows * this.cols);
    model.defaults?.layers.forEach((layer, l) => layer.forEach((code, i) => (this.keymap[l * this.rows * this.cols + i] = code)));
    this.encoders = new Uint16Array(this.layers * Math.max(1, this.encoderCount) * 2);
    model.defaults?.encoders.forEach((layer, l) =>
      layer.forEach(([ccw, cw], e) => {
        this.encoders[(l * this.encoderCount + e) * 2] = ccw;
        this.encoders[(l * this.encoderCount + e) * 2 + 1] = cw;
      }),
    );
    this.macroCount = options.macroCount ?? 16;
    this.macroBuffer = new Uint8Array(options.macroBufferSize ?? 1567);
    this.dropReplies = options.dropReplies ?? 0;

    // LED order follows the layout's key order, which is how Keychron numbers them.
    this.ledIndex = new Map();
    let led = 0;
    for (const key of [...model.layout.keys].filter((k) => k.row >= 0).sort((a, b) => a.y - b.y || a.x - b.x)) {
      // The knob's push switch has no LED.
      if (!this.ledIndex.has(key.id) && key.encoder === undefined) {
        this.ledIndex.set(key.id, led++);
      }
    }
    this.ledCount = led;
    this.perKey = Array.from({ length: this.ledCount }, (_, i) => ({ h: (i * 7) % 256, s: 255, v: 255 }));
    this.regions = new Uint8Array(this.ledCount);
    for (const key of model.layout.keys) {
      const idx = this.ledIndex.get(key.id);
      if (idx !== undefined) this.regions[idx] = key.color === "#cccccc" ? 0 : 1;
    }
    this.effectList = Array.from({ length: EFFECT_LAYERS }, () => Array.from({ length: EFFECTS_PER_LAYER }, () => ({ effect: 0, hue: 0, sat: 0, speed: 0, time: 0 })));
    this.effectList[0][0] = { effect: 5, hue: 0, sat: 255, speed: 127, time: 5000 };
    this.effectList[1][0] = { effect: 2, hue: 0, sat: 255, speed: 127, time: 5000 };
    this.snapClicks = Array.from({ length: SNAP_CLICK_COUNT }, () => ({ type: 0, keys: [0, 0] as [number, number] }));
  }

  // --- HidLink -------------------------------------------------------------------

  async send(report: Uint8Array): Promise<void> {
    if (report.length !== 32) throw new Error(`Reports are 32 bytes (got ${report.length})`);
    const data = Uint8Array.from(report);
    this.log.push(Uint8Array.from(report));
    const reply = this.handle(data);
    if (this.dropReplies > 0) {
      this.dropReplies--;
      return;
    }
    if (reply) this.emit(reply, this.options.latencyMs ?? 0);
  }

  onReport(listener: (report: Uint8Array) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Simulate the user holding Fn or flipping the OS switch. */
  notifyLayers(defaultLayer: number, topLayer: number): void {
    this.defaultLayer = defaultLayer;
    this.topLayer = topLayer;
    const buf = new Uint8Array(32);
    buf[0] = 0xa3;
    buf[1] = defaultLayer;
    buf[2] = topLayer;
    this.emit(buf, 0);
  }

  ledFor(row: number, col: number): number | undefined {
    return this.ledIndex.get(`${row},${col}`);
  }

  private emit(report: Uint8Array, delay: number): void {
    const deliver = () => {
      for (const l of this.listeners) l(report);
    };
    if (delay > 0) setTimeout(deliver, delay);
    else queueMicrotask(deliver);
  }

  // --- firmware ----------------------------------------------------------------------

  private handle(data: Uint8Array): Uint8Array | null {
    if (this.options.keychron !== false && this.keychron(data)) return data;
    this.via(data);
    return data;
  }

  /** kc_raw_hid_rx: returns true when Keychron code handled the report. */
  private keychron(data: Uint8Array): boolean {
    switch (data[0]) {
      case 0xa0:
        data[1] = 0x02;
        data[2] = 0;
        data[3] = 2;
        return true;
      case 0xa1: {
        const text = this.options.firmware ?? "v1.1.1 Sep  2 2026";
        for (let i = 0; i < text.length; i++) data[1 + i] = text.charCodeAt(i);
        data[1 + text.length] = 0;
        return true;
      }
      case 0xa2: {
        // FEATURE_DEFAULT_LAYER | BLUETOOTH | P24G | STATE_NOTIFY | DYNAMIC_DEBOUNCE | SNAP_CLICK | KEYCHRON_RGB
        data[1] = 0;
        data[2] = 0x01 | 0x02 | 0x04 | 0x10 | 0x20 | 0x40 | 0x80;
        data[3] = (0x100 | 0x200) >> 8;
        return true;
      }
      case 0xa3:
        data[1] = this.defaultLayer;
        data[2] = this.topLayer;
        return true;
      case 0xa7:
        this.misc(data);
        return true;
      case 0xa8:
        this.rgbCommand(data);
        return true;
      default:
        return false;
    }
  }

  private misc(data: Uint8Array): void {
    switch (data[1]) {
      case 0x01:
        data[2] = 0;
        data[3] = 0x02;
        data[4] = 0x00;
        data[5] = 0x01 | 0x02 | 0x04 | 0x08 | 0x10 | 0x40 | 0x80; // no report rate on V5 Max
        break;
      case 0x02: {
        let i = 2;
        data[i++] = 0;
        data[i++] = 1; // DFU_INFO_CHIP
        const mcu = "STM32F401";
        data[i++] = mcu.length;
        for (const ch of mcu) data[i++] = ch.charCodeAt(0);
        data[i++] = 2; // DFU_INFO_TYPE
        data[i++] = 1;
        data[i++] = 1; // BL_TYPE_STM32
        break;
      }
      case 0x03:
        data[3] = this.language;
        data[2] = 0;
        break;
      case 0x04:
        this.language = data[2];
        data[2] = 0;
        break;
      case 0x05:
        data[2] = 0;
        data[3] = 0; // DEBOUNCE_SET_QMK
        data[4] = this.debounce.type;
        data[5] = this.debounce.time;
        break;
      case 0x06:
        if (data[2] < 7) {
          this.debounce = { type: data[2], time: data[3] };
          data[2] = 0;
          this.saved("debounce");
        } else data[2] = 1;
        break;
      case 0x07:
        data[3] = SNAP_CLICK_COUNT;
        data[2] = 0;
        break;
      case 0x08: {
        const start = data[2];
        const count = data[3];
        if (count > 9 || start + count > SNAP_CLICK_COUNT) {
          data[2] = 1;
          break;
        }
        for (let i = 0; i < count; i++) {
          const p = this.snapClicks[start + i];
          data[3 + i * 3] = p.type;
          data[4 + i * 3] = p.keys[0];
          data[5 + i * 3] = p.keys[1];
        }
        data[2] = 0;
        break;
      }
      case 0x09: {
        const start = data[2];
        const count = data[3];
        let ok = count <= 9 && start + count <= SNAP_CLICK_COUNT;
        for (let i = 0; ok && i < count; i++) {
          const type = data[4 + i * 3];
          if (type >= 6 || (type !== 0 && (data[5 + i * 3] === 0 || data[6 + i * 3] === 0))) ok = false;
        }
        if (ok) for (let i = 0; i < count; i++) this.snapClicks[start + i] = { type: data[4 + i * 3], keys: [data[5 + i * 3], data[6 + i * 3]] };
        data[2] = ok ? 0 : 1;
        break;
      }
      case 0x0a:
        this.saved("snapClick");
        data[2] = 0;
        break;
      case 0x0b:
        data[3] = this.lpm.backlit & 0xff;
        data[4] = this.lpm.backlit >> 8;
        data[5] = this.lpm.idle & 0xff;
        data[6] = this.lpm.idle >> 8;
        data[2] = 0;
        break;
      case 0x0c: {
        const backlit = data[2] | (data[3] << 8);
        const idle = data[4] | (data[5] << 8);
        if (backlit < 5 || idle < 60) data[2] = 1;
        else {
          this.lpm = { backlit, idle };
          this.saved("wireless");
          data[2] = 0;
        }
        break;
      }
      case 0x12:
        data[2] = 0;
        data[3] = (this.nkro ? 1 : 0) | (1 << 2); // adaptive NKRO build
        break;
      case 0x13:
        data[2] = 1; // adaptive builds refuse manual NKRO
        break;
      default:
        data[0] = 0xff;
        data[1] = 0;
    }
  }

  private rgbCommand(data: Uint8Array): void {
    const d = data.subarray(2); // handlers receive &data[2]
    let success = true;
    switch (data[1]) {
      case 0x01:
        d[1] = 0x01;
        d[2] = 0x00;
        break;
      case 0x02:
        this.saved("keychronRgb");
        break;
      case 0x03:
        d[1] = (1 << 0) | (1 << 1);
        d[2] = this.indicators.disabled;
        d[3] = this.indicators.h;
        d[4] = this.indicators.s;
        d[5] = this.indicators.v;
        break;
      case 0x04:
        this.indicators = { disabled: d[0], h: d[1], s: d[2], v: Math.max(128, d[3]) };
        break;
      case 0x05:
        d[1] = this.ledCount;
        break;
      case 0x06: {
        const row = d[0];
        if (row > this.rows) {
          success = false;
          break;
        }
        const mask = d[1] | (d[2] << 8) | (d[3] << 16);
        for (let c = 0; c < this.cols; c++) {
          const led = mask & (1 << c) ? this.ledIndex.get(`${row},${c}`) : undefined;
          d[1 + c] = led ?? 0xff;
        }
        break;
      }
      case 0x07:
        d[1] = this.perKeyType;
        break;
      case 0x08:
        if (d[0] >= 5) success = false;
        else this.perKeyType = d[0];
        break;
      case 0x09: {
        const start = d[0];
        const count = d[1];
        if (count > 9) {
          success = false;
          break;
        }
        for (let i = 0; i < count; i++) {
          const c = this.perKey[start + i] ?? { h: 0, s: 0, v: 0 };
          d[1 + i * 3] = c.h;
          d[2 + i * 3] = c.s;
          d[3 + i * 3] = c.v;
        }
        break;
      }
      case 0x0a: {
        const start = d[0];
        const count = d[1];
        if (count > 9) {
          success = false;
          break;
        }
        for (let i = 0; i < count; i++) this.perKey[start + i] = { h: d[2 + i * 3], s: d[3 + i * 3], v: d[4 + i * 3] };
        break;
      }
      case 0x0b:
        d[1] = EFFECT_LAYERS;
        d[2] = EFFECTS_PER_LAYER;
        break;
      case 0x0c: {
        const start = d[0];
        const count = d[1];
        if (count > 29 || start + count > this.ledCount) {
          success = false;
          break;
        }
        d.set(this.regions.subarray(start, start + count), 1);
        break;
      }
      case 0x0d: {
        const start = d[0];
        const count = d[1];
        if (count > 28 || start + count > this.ledCount) {
          success = false;
          break;
        }
        for (let i = 0; i < count; i++) if (d[2 + i] >= EFFECT_LAYERS) success = false;
        if (success) this.regions.set(d.subarray(2, 2 + count), start);
        break;
      }
      case 0x0e: {
        const [region, start, count] = [d[0], d[1], d[2]];
        if (count > 3 || region > EFFECT_LAYERS || start + count > EFFECTS_PER_LAYER) {
          success = false;
          break;
        }
        for (let i = 0; i < count; i++) {
          const e = this.effectList[region][start + i];
          d[1 + i * 8] = e.effect;
          d[2 + i * 8] = e.hue;
          d[3 + i * 8] = e.sat;
          d[4 + i * 8] = e.speed;
          d[5 + i * 8] = e.time & 0xff;
          d[6 + i * 8] = (e.time >>> 8) & 0xff;
          d[7 + i * 8] = (e.time >>> 16) & 0xff;
          d[8 + i * 8] = (e.time >>> 24) & 0xff;
        }
        break;
      }
      case 0x0f: {
        const [region, start, count] = [d[0], d[1], d[2]];
        if (count > 3 || region > EFFECT_LAYERS || start + count > EFFECTS_PER_LAYER) {
          success = false;
          break;
        }
        for (let i = 0; i < count; i++) if (d[3 + i * 8] >= 24) success = false;
        if (!success) break;
        for (let i = 0; i < count; i++) {
          const o = 3 + i * 8;
          this.effectList[region][start + i] = {
            effect: d[o],
            hue: d[o + 1],
            sat: d[o + 2],
            speed: d[o + 3],
            time: (d[o + 4] | (d[o + 5] << 8) | (d[o + 6] << 16) | (d[o + 7] << 24)) >>> 0,
          };
        }
        break;
      }
      default:
        data[0] = 0xff;
    }
    data[2] = success ? 0 : 1;
  }

  /** raw_hid_receive in quantum/via.c */
  private via(data: Uint8Array): void {
    const c = data.subarray(1); // command_data
    const keys = this.rows * this.cols;
    switch (data[0]) {
      case 0x01:
        c[0] = 0x00;
        c[1] = 0x0c;
        break;
      case 0x02:
        switch (c[0]) {
          case 0x01: {
            const up = 123456;
            c[1] = (up >>> 24) & 0xff;
            c[2] = (up >>> 16) & 0xff;
            c[3] = (up >>> 8) & 0xff;
            c[4] = up & 0xff;
            break;
          }
          case 0x03: {
            const offset = c[1];
            const bytesPerRow = Math.ceil(this.cols / 8);
            const rows = Math.floor(28 / bytesPerRow);
            let i = 2;
            for (let row = 0; row < rows && row + offset < this.rows; row++) {
              let value = 0;
              for (let col = 0; col < this.cols; col++) if (this.pressed.has(`${row + offset},${col}`)) value += 2 ** col;
              for (let b = bytesPerRow - 1; b >= 0; b--) c[i++] = Math.floor(value / 256 ** b) % 256;
            }
            break;
          }
          default:
            data[0] = 0xff;
        }
        break;
      case 0x03:
        if (c[0] === 0x05) {
          this.rgb.enabled = !this.rgb.enabled;
        } else if (c[0] !== 0x02) data[0] = 0xff;
        break;
      case 0x04: {
        const code = this.keymap[c[0] * keys + c[1] * this.cols + c[2]] ?? 0;
        c[3] = code >> 8;
        c[4] = code & 0xff;
        break;
      }
      case 0x05:
        this.keymap[c[0] * keys + c[1] * this.cols + c[2]] = (c[3] << 8) | c[4];
        this.saved("keymap");
        break;
      case 0x06:
        this.keymap.fill(0);
        this.model.defaults?.layers.forEach((layer, l) => layer.forEach((code, i) => (this.keymap[l * keys + i] = code)));
        this.saved("keymap");
        break;
      case 0x07:
      case 0x08:
      case 0x09:
        this.customValue(data);
        break;
      case 0x0c:
        c[0] = this.macroCount;
        break;
      case 0x0d:
        c[0] = this.macroBuffer.length >> 8;
        c[1] = this.macroBuffer.length & 0xff;
        break;
      case 0x0e: {
        const offset = (c[0] << 8) | c[1];
        const size = c[2];
        for (let i = 0; i < size; i++) c[3 + i] = offset + i < this.macroBuffer.length ? this.macroBuffer[offset + i] : 0;
        break;
      }
      case 0x0f: {
        const offset = (c[0] << 8) | c[1];
        const size = c[2];
        for (let i = 0; i < size; i++) if (offset + i < this.macroBuffer.length) this.macroBuffer[offset + i] = c[3 + i];
        this.saved("macros");
        break;
      }
      case 0x10:
        this.macroBuffer.fill(0);
        this.saved("macros");
        break;
      case 0x11:
        c[0] = this.layers;
        break;
      case 0x12: {
        const offset = (c[0] << 8) | c[1];
        const size = c[2];
        for (let i = 0; i < size; i++) {
          const byte = offset + i;
          const code = this.keymap[byte >> 1] ?? 0;
          c[3 + i] = byte % 2 === 0 ? code >> 8 : code & 0xff;
        }
        break;
      }
      case 0x13: {
        const offset = (c[0] << 8) | c[1];
        const size = c[2];
        for (let i = 0; i < size; i++) {
          const byte = offset + i;
          const index = byte >> 1;
          if (index >= this.keymap.length) continue;
          const code = this.keymap[index];
          this.keymap[index] = byte % 2 === 0 ? (c[3 + i] << 8) | (code & 0xff) : (code & 0xff00) | c[3 + i];
        }
        this.saved("keymap");
        break;
      }
      case 0x14: {
        const code = this.encoders[(c[0] * this.encoderCount + c[1]) * 2 + (c[2] ? 1 : 0)] ?? 0;
        c[3] = code >> 8;
        c[4] = code & 0xff;
        break;
      }
      case 0x15:
        this.encoders[(c[0] * this.encoderCount + c[1]) * 2 + (c[2] ? 1 : 0)] = (c[3] << 8) | c[4];
        this.saved("encoders");
        break;
      default:
        data[0] = 0xff;
    }
  }

  private customValue(data: Uint8Array): void {
    if (data[1] !== (this.options.lightingChannel ?? 3)) {
      data[0] = 0xff;
      return;
    }
    const id = data[2];
    const v = data.subarray(3);
    if (data[0] === 0x08) {
      if (id === 1) v[0] = this.rgb.v;
      else if (id === 2) v[0] = this.rgb.enabled ? this.rgb.mode : 0;
      else if (id === 3) v[0] = this.rgb.speed;
      else if (id === 4) {
        v[0] = this.rgb.h;
        v[1] = this.rgb.s;
      }
    } else if (data[0] === 0x07) {
      this.rgbValueMask |= 1 << id;
      if (id === 1) this.rgb.v = v[0];
      else if (id === 2) {
        if (v[0] === 0) this.rgb.enabled = false;
        else {
          this.rgb.enabled = true;
          this.rgb.mode = v[0];
        }
      } else if (id === 3) this.rgb.speed = v[0];
      else if (id === 4) {
        this.rgb.h = v[0];
        this.rgb.s = v[1];
      }
    } else {
      // via_qmk_rgb_matrix_save writes only when exactly one value changed.
      if ([1, 2, 3, 4].some((n) => this.rgbValueMask === 1 << n)) this.saved("rgbMatrix");
      this.rgbValueMask = 0;
    }
  }

  private saved(area: string): void {
    this.saves[area] = (this.saves[area] ?? 0) + 1;
  }
}
