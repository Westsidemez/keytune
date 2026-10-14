// WebHID access to keyboards' raw HID interface (usage page 0xFF60, usage 0x61).

import type { HidLink } from "../shared/protocol/transport";

export const RAW_USAGE_PAGE = 0xff60;
export const RAW_USAGE = 0x61;

export class WebHidLink implements HidLink {
  constructor(readonly device: HIDDevice) {}

  async open(): Promise<void> {
    if (!this.device.opened) await this.device.open();
  }

  async close(): Promise<void> {
    if (this.device.opened) await this.device.close();
  }

  async send(report: Uint8Array): Promise<void> {
    await this.device.sendReport(0, report as Uint8Array<ArrayBuffer>);
  }

  onReport(listener: (report: Uint8Array) => void): () => void {
    const handler = (event: HIDInputReportEvent) => {
      listener(new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength).slice());
    };
    this.device.addEventListener("inputreport", handler);
    return () => this.device.removeEventListener("inputreport", handler);
  }
}

export function isRawHid(device: HIDDevice): boolean {
  return device.collections.some((c) => c.usagePage === RAW_USAGE_PAGE && c.usage === RAW_USAGE);
}

export function hidAvailable(): boolean {
  return typeof navigator !== "undefined" && "hid" in navigator;
}

export async function rawHidDevices(): Promise<HIDDevice[]> {
  if (!hidAvailable()) return [];
  const devices = await navigator.hid.getDevices();
  return devices.filter(isRawHid);
}

export function deviceKey(device: Pick<HIDDevice, "vendorId" | "productId">): string {
  return `${device.vendorId.toString(16)}:${device.productId.toString(16)}`;
}
