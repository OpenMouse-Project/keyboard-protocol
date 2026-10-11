import { WootingHidClient } from "./wooting/hid.ts";
import { WuqueHidClient } from "./wuque/hid.ts";

export type SupportedClient = WootingHidClient | WuqueHidClient;

export interface DeviceDriver {
  brand: string;
  supports(device: HIDDevice): boolean;
  create(device: HIDDevice): SupportedClient | null;
  score(device: HIDDevice): number;
}

export const DEVICE_DRIVERS: readonly DeviceDriver[] = [
  { brand: "Wooting", supports: (device) => WootingHidClient.isSupported(device), create: (device) => new WootingHidClient(device), score: () => 6 },
  { brand: "Wuque Studio", supports: (device) => WuqueHidClient.isSupported(device), create: (device) => new WuqueHidClient(device), score: () => 6 },
];

function driverFor(device: HIDDevice): DeviceDriver | undefined {
  return DEVICE_DRIVERS.find((driver) => driver.supports(device));
}

export function createSupportedClient(device: HIDDevice): SupportedClient | null {
  return driverFor(device)?.create(device) ?? null;
}

export function clientSupportScore(device: HIDDevice): number {
  return driverFor(device)?.score(device) ?? 0;
}

export function deviceBrand(client: SupportedClient): string {
  return driverFor(client.device)?.brand ?? "Unknown";
}
