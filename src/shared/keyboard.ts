// A connected keyboard: everything read from the device, plus live writes.
// Every change is applied to the keyboard immediately and mirrored here.

import {
  FEATURE,
  KeyboardProtocol,
  RGB_MATRIX_CHANNEL,
  MISC_FEATURE,
  RGB_VALUE,
  type HSV,
  type IndicatorConfig,
  type MixedEffect,
  type NkroState,
  type SleepConfig,
  type SnapClickPair,
} from "./protocol/commands";
import { Transport, UnsupportedCommandError, type HidLink } from "./protocol/transport";
import { buildModel, LIGHTING_CHANNEL, type KeyboardModel } from "./definitions";
import { joinMacroBuffer, macroBufferBytes, splitMacroBuffer } from "./macros";
import type { ViaDefinition } from "./layout";

export interface DeviceIdentity {
  vendorId: number;
  productId: number;
  productName: string;
}

export interface KeyboardInfo extends DeviceIdentity {
  viaProtocol: number;
  keychronProtocol?: number;
  firmware?: string;
  features: number;
  miscFeatures: number;
  mcu?: string;
  bootloader?: string;
}

export interface LightingState {
  brightness: number;
  effect: number;
  speed: number;
  hue: number;
  sat: number;
  ledCount: number;
  /** False for single-colour backlight, which has no speed or colour. */
  adjustable?: boolean;
  perKey?: { type: number; colors: HSV[] };
  mixed?: { effectsPerRegion: number; regions: number[]; zones: MixedEffect[][] };
  indicators?: IndicatorConfig;
}

export interface AdvancedState {
  debounce?: { type: number; time: number };
  snapClicks?: SnapClickPair[];
  sleep?: SleepConfig;
  nkro?: NkroState;
}

export interface KeyboardState {
  info: KeyboardInfo;
  layers: number;
  rows: number;
  cols: number;
  /** [layer][row * cols + col] */
  keymap: number[][];
  /** [layer][encoder] = [counter-clockwise, clockwise] */
  encoders: [number, number][][];
  macros: { count: number; bufferSize: number; data: Uint8Array[] };
  /** LED index per matrix position (row * cols + col), null where there is no LED. */
  ledMap: (number | null)[];
  lighting?: LightingState;
  advanced: AdvancedState;
  activeLayers: { defaultLayer: number; topLayer: number };
}

export type LoadProgress = (step: string, fraction: number) => void;

export class Keyboard {
  readonly protocol: KeyboardProtocol;
  state: KeyboardState;
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribeNotify: () => void;

  private constructor(
    private readonly transport: Transport,
    readonly model: KeyboardModel,
    state: KeyboardState,
  ) {
    this.protocol = new KeyboardProtocol(transport);
    this.state = state;
    this.unsubscribeNotify = transport.onUnsolicited((report) => {
      if (report[0] === 0xa3) {
        this.update((s) => ({ ...s, activeLayers: { defaultLayer: report[1], topLayer: report[2] } }));
      }
    });
  }

  static async connect(link: HidLink, identity: DeviceIdentity, model: KeyboardModel | ViaDefinition, progress: LoadProgress = () => {}): Promise<Keyboard> {
    const resolved = "layout" in model ? model : buildModel(model);
    const transport = new Transport(link);
    try {
      const state = await loadState(new KeyboardProtocol(transport), identity, resolved, progress);
      return new Keyboard(transport, resolved, state);
    } catch (error) {
      transport.close();
      throw error;
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.unsubscribeNotify();
    this.transport.close();
    this.listeners.clear();
  }

  hasFeature(flag: number): boolean {
    return (this.state.info.features & flag) !== 0;
  }

  hasMisc(flag: number): boolean {
    return (this.state.info.miscFeatures & flag) !== 0;
  }

  // --- keymap ----------------------------------------------------------------

  keycodeAt(layer: number, row: number, col: number): number {
    return this.state.keymap[layer]?.[row * this.state.cols + col] ?? 0;
  }

  async setKeycode(layer: number, row: number, col: number, keycode: number): Promise<void> {
    await this.protocol.setKeycode(layer, row, col, keycode);
    this.update((s) => {
      const keymap = s.keymap.map((l) => l.slice());
      keymap[layer][row * s.cols + col] = keycode;
      return { ...s, keymap };
    });
  }

  async setEncoder(layer: number, index: number, clockwise: boolean, keycode: number): Promise<void> {
    await this.protocol.setEncoder(layer, index, clockwise, keycode);
    this.update((s) => {
      const encoders = s.encoders.map((l) => l.map((e) => [...e] as [number, number]));
      encoders[layer][index][clockwise ? 1 : 0] = keycode;
      return { ...s, encoders };
    });
  }

  /** Write a full keymap, sending only the bytes that differ. */
  async writeKeymap(keymap: number[][]): Promise<void> {
    const { layers, rows, cols } = this.state;
    const current = keymapBytes(this.state.keymap, rows * cols);
    const next = keymapBytes(keymap.slice(0, layers), rows * cols);
    for (const [start, end] of changedRanges(current, next)) {
      await this.protocol.setKeymapBuffer(start, next.subarray(start, end));
    }
    this.update((s) => ({ ...s, keymap: keymap.slice(0, layers).map((l) => l.slice(0, rows * cols)) }));
  }

  async resetKeymap(): Promise<void> {
    await this.protocol.resetKeymap();
    const { layers, rows, cols } = this.state;
    const bytes = await this.protocol.keymapBuffer(layers * rows * cols * 2);
    const keymap = splitKeymap(bytes, layers, rows * cols);
    const encoders = await readEncoders(this.protocol, layers, this.model.layout.encoders);
    this.update((s) => ({ ...s, keymap, encoders }));
  }

  // --- macros ------------------------------------------------------------------

  macroBytesUsed(data = this.state.macros.data): number {
    return macroBufferBytes(data);
  }

  /** Replace the onboard macros. Only the changed span of the buffer is written. */
  async writeMacros(data: Uint8Array[]): Promise<void> {
    const { count, bufferSize } = this.state.macros;
    const padded = Array.from({ length: count }, (_, i) => data[i] ?? new Uint8Array());
    const next = joinMacroBuffer(padded, bufferSize);
    const current = joinMacroBuffer(this.state.macros.data, bufferSize);
    for (const [start, end] of changedRanges(current, next)) {
      await this.protocol.writeMacroBufferAt(start, next.subarray(start, end));
    }
    this.update((s) => ({ ...s, macros: { ...s.macros, data: padded.map((m) => m.slice()) } }));
  }

  async resetMacros(): Promise<void> {
    await this.protocol.resetMacros();
    const { count, bufferSize } = this.state.macros;
    const data = splitMacroBuffer(await this.protocol.macroBuffer(bufferSize), count);
    this.update((s) => ({ ...s, macros: { ...s.macros, data } }));
  }

  // --- lighting ------------------------------------------------------------------

  private get lightingChannel(): number {
    return this.model.lightingChannel ?? RGB_MATRIX_CHANNEL;
  }

  /** Pass persist=false while a slider is moving; the final value must be persisted. */
  async setBrightness(value: number, persist = true): Promise<void> {
    await this.protocol.setRgbValue(RGB_VALUE.BRIGHTNESS, [clamp8(value)], persist, this.lightingChannel);
    this.updateLighting({ brightness: clamp8(value) });
  }

  async setEffect(effect: number): Promise<void> {
    await this.protocol.setRgbValue(RGB_VALUE.EFFECT, [clamp8(effect)], true, this.lightingChannel);
    this.updateLighting({ effect: clamp8(effect) });
  }

  /** Pass persist=false while a slider is moving; the final value must be persisted. */
  async setSpeed(value: number, persist = true): Promise<void> {
    await this.protocol.setRgbValue(RGB_VALUE.SPEED, [clamp8(value)], persist, this.lightingChannel);
    this.updateLighting({ speed: clamp8(value) });
  }

  async setColor(hue: number, sat: number, persist = true): Promise<void> {
    await this.protocol.setRgbValue(RGB_VALUE.COLOR, [clamp8(hue), clamp8(sat)], persist, this.lightingChannel);
    this.updateLighting({ hue: clamp8(hue), sat: clamp8(sat) });
  }

  async setPerKeyType(type: number): Promise<void> {
    await this.protocol.setPerKeyType(type);
    const perKey = this.state.lighting?.perKey;
    if (perKey) this.updateLighting({ perKey: { ...perKey, type } });
  }

  /** Set colours for LED indices; contiguous runs go out in as few reports as possible. */
  async setPerKeyColors(changes: Map<number, HSV>): Promise<void> {
    const perKey = this.state.lighting?.perKey;
    if (!perKey) throw new Error("This keyboard has no per-key lighting");
    const colors = perKey.colors.slice();
    for (const [index, hsv] of changes) colors[index] = { h: clamp8(hsv.h), s: clamp8(hsv.s), v: clamp8(hsv.v) };
    for (const [start, end] of runs([...changes.keys()])) {
      await this.protocol.setPerKeyColors(start, colors.slice(start, end));
    }
    this.updateLighting({ perKey: { ...perKey, colors } });
  }

  async setMixedRegions(changes: Map<number, number>): Promise<void> {
    const mixed = this.state.lighting?.mixed;
    if (!mixed) throw new Error("This keyboard has no mixed lighting");
    const regions = mixed.regions.slice();
    for (const [index, region] of changes) regions[index] = region;
    for (const [start, end] of runs([...changes.keys()])) {
      await this.protocol.setMixedRegions(start, regions.slice(start, end));
    }
    this.updateLighting({ mixed: { ...mixed, regions } });
  }

  /** Replace one zone's effect timeline (unused slots are cleared). */
  async setMixedZone(region: number, effects: MixedEffect[]): Promise<void> {
    const mixed = this.state.lighting?.mixed;
    if (!mixed) throw new Error("This keyboard has no mixed lighting");
    const full = Array.from({ length: mixed.effectsPerRegion }, (_, i) => effects[i] ?? { effect: 0, hue: 0, sat: 0, speed: 0, time: 0 });
    await this.protocol.setMixedEffects(region, 0, full);
    const zones = mixed.zones.map((z) => z.slice());
    zones[region] = full;
    this.updateLighting({ mixed: { ...mixed, zones } });
  }

  async setIndicators(disabled: number, hsv: HSV): Promise<void> {
    await this.protocol.setIndicators(disabled, hsv);
    const indicators = this.state.lighting?.indicators;
    if (indicators) this.updateLighting({ indicators: { ...indicators, disabled, hsv: { ...hsv, v: Math.max(128, hsv.v) } } });
  }

  /** Persist per-key, mixed and indicator settings to the keyboard's flash. */
  async saveKeychronLighting(): Promise<void> {
    await this.protocol.saveKeychronRgb();
  }

  // --- advanced ------------------------------------------------------------------

  async setDebounce(type: number, time: number): Promise<void> {
    await this.protocol.setDebounce(type, time);
    this.updateAdvanced({ debounce: { type, time } });
  }

  async setSnapClicks(pairs: SnapClickPair[]): Promise<void> {
    await this.protocol.setSnapClicks(0, pairs);
    this.updateAdvanced({ snapClicks: pairs.map((p) => ({ type: p.type, keys: [...p.keys] as [number, number] })) });
  }

  async setSleep(config: SleepConfig): Promise<void> {
    await this.protocol.setSleep(config);
    this.updateAdvanced({ sleep: { ...config } });
  }

  async setNkro(enabled: boolean): Promise<void> {
    await this.protocol.setNkro(enabled);
    const nkro = this.state.advanced.nkro;
    if (nkro) this.updateAdvanced({ nkro: { ...nkro, enabled } });
  }

  async matrixState(): Promise<boolean[][]> {
    return this.protocol.matrixState(this.state.rows, this.state.cols);
  }

  async identify(): Promise<void> {
    await this.protocol.indicate();
  }

  // --- internals -------------------------------------------------------------------

  private updateLighting(patch: Partial<LightingState>): void {
    this.update((s) => (s.lighting ? { ...s, lighting: { ...s.lighting, ...patch } } : s));
  }

  private updateAdvanced(patch: Partial<AdvancedState>): void {
    this.update((s) => ({ ...s, advanced: { ...s.advanced, ...patch } }));
  }

  private update(change: (state: KeyboardState) => KeyboardState): void {
    this.state = change(this.state);
    for (const listener of this.listeners) listener();
  }
}

async function optional<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof UnsupportedCommandError) return undefined;
    throw error;
  }
}

async function loadState(protocol: KeyboardProtocol, identity: DeviceIdentity, model: KeyboardModel, progress: LoadProgress): Promise<KeyboardState> {
  progress("Reading keyboard", 0);
  const viaProtocol = await protocol.viaProtocolVersion();
  if (viaProtocol < 9) throw new Error(`This keyboard speaks VIA protocol ${viaProtocol}; version 9 or newer is required`);
  const kcProtocol = await optional(() => protocol.keychronProtocol());
  const features = kcProtocol ? ((await optional(() => protocol.supportedFeatures())) ?? 0) : 0;
  const misc = kcProtocol ? await optional(() => protocol.miscProtocol()) : undefined;
  const firmware = kcProtocol ? await optional(() => protocol.firmwareVersion()) : undefined;
  const miscFeatures = misc?.features ?? 0;
  const dfu = miscFeatures & MISC_FEATURE.DFU_INFO ? await optional(() => protocol.dfuInfo()) : undefined;

  const { rows, cols } = model.definition.matrix;
  const layers = await protocol.layerCount();
  progress("Reading keymap", 0.1);
  const keymap = splitKeymap(await protocol.keymapBuffer(layers * rows * cols * 2), layers, rows * cols);
  progress("Reading knob", 0.35);
  const encoders = await readEncoders(protocol, layers, model.layout.encoders);

  progress("Reading macros", 0.45);
  const macroCount = await protocol.macroCount();
  const bufferSize = macroCount ? await protocol.macroBufferSize() : 0;
  const macroData = macroCount ? splitMacroBuffer(await protocol.macroBuffer(bufferSize), macroCount) : [];

  progress("Reading lighting", 0.6);
  let lighting: LightingState | undefined;
  let ledMap: (number | null)[] = Array(rows * cols).fill(null);
  const channel = model.lightingChannel;
  const brightness = channel === undefined ? undefined : await optional(() => protocol.rgbValue(RGB_VALUE.BRIGHTNESS, channel));
  if (channel !== undefined && brightness) {
    const [effect] = await protocol.rgbValue(RGB_VALUE.EFFECT, channel);
    // Plain backlight has only brightness and effect.
    const colour = channel !== LIGHTING_CHANNEL.BACKLIGHT;
    const [speed] = colour ? await protocol.rgbValue(RGB_VALUE.SPEED, channel) : [0];
    const [hue, sat] = colour ? await protocol.rgbValue(RGB_VALUE.COLOR, channel) : [0, 0];
    lighting = { brightness: brightness[0], effect, speed, hue, sat, ledCount: 0, adjustable: colour };
    if (channel === RGB_MATRIX_CHANNEL && features & FEATURE.KEYCHRON_RGB) {
      const ledCount = await protocol.ledCount();
      ledMap = [];
      for (let row = 0; row < rows; row++) ledMap.push(...(await protocol.ledIndices(row, cols)));
      progress("Reading key colours", 0.7);
      const perKey = { type: await protocol.perKeyType(), colors: await protocol.perKeyColors(ledCount) };
      progress("Reading lighting zones", 0.82);
      const info = await protocol.mixedInfo();
      const regions = await protocol.mixedRegions(ledCount);
      const zones: MixedEffect[][] = [];
      for (let r = 0; r < info.regions; r++) zones.push(await protocol.mixedEffects(r, info.effectsPerRegion));
      const indicators = await optional(() => protocol.indicators());
      lighting = { ...lighting, ledCount, perKey, mixed: { effectsPerRegion: info.effectsPerRegion, regions, zones }, indicators };
    }
  }

  progress("Reading settings", 0.92);
  const advanced: AdvancedState = {};
  if (miscFeatures & MISC_FEATURE.DEBOUNCE) advanced.debounce = await optional(() => protocol.debounce());
  if (miscFeatures & MISC_FEATURE.SNAP_CLICK) {
    const count = await optional(() => protocol.snapClickCount());
    if (count) advanced.snapClicks = await protocol.snapClicks(count);
  }
  if (miscFeatures & MISC_FEATURE.WIRELESS_LPM) advanced.sleep = await optional(() => protocol.sleep());
  if (miscFeatures & MISC_FEATURE.NKRO) advanced.nkro = await optional(() => protocol.nkro());

  const activeLayers = (features & FEATURE.DEFAULT_LAYER ? await optional(() => protocol.activeLayers()) : undefined) ?? { defaultLayer: 0, topLayer: 0 };
  progress("Ready", 1);
  return {
    info: {
      ...identity,
      viaProtocol,
      keychronProtocol: kcProtocol?.version,
      firmware,
      features,
      miscFeatures,
      mcu: dfu?.mcu,
      bootloader: dfu?.bootloader,
    },
    layers,
    rows,
    cols,
    keymap,
    encoders,
    macros: { count: macroCount, bufferSize, data: macroData },
    ledMap,
    lighting,
    advanced,
    activeLayers,
  };
}

async function readEncoders(protocol: KeyboardProtocol, layers: number, count: number): Promise<[number, number][][]> {
  const encoders: [number, number][][] = [];
  for (let layer = 0; layer < layers; layer++) {
    const row: [number, number][] = [];
    for (let i = 0; i < count; i++) {
      const ccw = await optional(() => protocol.encoder(layer, i, false));
      if (ccw === undefined) return [];
      row.push([ccw, await protocol.encoder(layer, i, true)]);
    }
    encoders.push(row);
  }
  return encoders;
}

export function splitKeymap(bytes: Uint8Array, layers: number, keysPerLayer: number): number[][] {
  const keymap: number[][] = [];
  for (let l = 0; l < layers; l++) {
    const layer: number[] = [];
    for (let k = 0; k < keysPerLayer; k++) {
      const o = (l * keysPerLayer + k) * 2;
      layer.push((bytes[o] << 8) | bytes[o + 1]);
    }
    keymap.push(layer);
  }
  return keymap;
}

export function keymapBytes(keymap: number[][], keysPerLayer: number): Uint8Array {
  const bytes = new Uint8Array(keymap.length * keysPerLayer * 2);
  keymap.forEach((layer, l) => {
    for (let k = 0; k < keysPerLayer; k++) {
      const code = layer[k] ?? 0;
      bytes[(l * keysPerLayer + k) * 2] = code >> 8;
      bytes[(l * keysPerLayer + k) * 2 + 1] = code & 0xff;
    }
  });
  return bytes;
}

/** Byte ranges [start, end) where two equal-length buffers differ. Close ranges are merged. */
export function changedRanges(a: Uint8Array, b: Uint8Array, mergeGap = 8): [number, number][] {
  const ranges: [number, number][] = [];
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    if (a[i] === b[i]) continue;
    const last = ranges[ranges.length - 1];
    if (last && i - last[1] <= mergeGap) last[1] = i + 1;
    else ranges.push([i, i + 1]);
  }
  return ranges;
}

/** Group indices into contiguous [start, end) runs. */
export function runs(indices: number[]): [number, number][] {
  const sorted = [...new Set(indices)].sort((x, y) => x - y);
  const result: [number, number][] = [];
  for (const i of sorted) {
    const last = result[result.length - 1];
    if (last && last[1] === i) last[1] = i + 1;
    else result.push([i, i + 1]);
  }
  return result;
}

function clamp8(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}
