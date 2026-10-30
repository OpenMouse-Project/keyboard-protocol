import { WootingHidClient } from "./wooting/hid.ts";
import { WuqueHidClient } from "./wuque/hid.ts";
import { KochiHidClient } from "./kochi/hid.ts";
import { RazerKeyboardHidClient } from "./razer/hid.ts";
import { LogitechKeyboardHidClient } from "./logitech/hid.ts";
import { SteelSeriesKeyboardHidClient } from "./steelseries/hid.ts";
import { ArbiterKeyboardHidClient } from "./arbiter/hid.ts";

export type SupportedClient =
  | WootingHidClient
  | WuqueHidClient
  | KochiHidClient
  | RazerKeyboardHidClient
  | LogitechKeyboardHidClient
  | SteelSeriesKeyboardHidClient
  | ArbiterKeyboardHidClient;

export interface DeviceDriver {
  brand: string;
  supports(device: HIDDevice): boolean;
  create(device: HIDDevice): SupportedClient | null;
  score(device: HIDDevice): number;
}

export const DEVICE_DRIVERS: readonly DeviceDriver[] = [
  { brand: "Kochi", supports: (device) => KochiHidClient.isSupported(device), create: (device) => new KochiHidClient(device), score: () => 6 },
  { brand: "Wooting", supports: (device) => WootingHidClient.isSupported(device), create: (device) => new WootingHidClient(device), score: () => 6 },
  { brand: "Wuque Studio", supports: (device) => WuqueHidClient.isSupported(device), create: (device) => new WuqueHidClient(device), score: () => 6 },
  { brand: "Razer", supports: (device) => RazerKeyboardHidClient.isSupported(device), create: (device) => new RazerKeyboardHidClient(device), score: () => 6 },
  { brand: "Logitech", supports: (device) => LogitechKeyboardHidClient.isSupported(device), create: (device) => new LogitechKeyboardHidClient(device), score: () => 6 },
  { brand: "SteelSeries", supports: (device) => SteelSeriesKeyboardHidClient.isSupported(device), create: (device) => new SteelSeriesKeyboardHidClient(device), score: () => 6 },
  { brand: "Arbiter Studio", supports: (device) => ArbiterKeyboardHidClient.isSupported(device), create: (device) => new ArbiterKeyboardHidClient(device), score: () => 6 },
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
