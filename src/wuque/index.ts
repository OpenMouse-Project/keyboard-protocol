/**
 * Wuque Studio analog keyboard vendor HID protocol — transport-independent codec.
 *
 * Reverse-engineered from the vendor web configurator at
 * `https://drives-hid.wuquestudio.cn/` and confirmed against a physical
 * BABAO60 HE (`0x1CA6:0x1B10`, firmware protocol 1.2.1.0). Requests are 64-byte
 * output reports (report id 0); replies echo `[group, subCommand]` and carry the
 * payload from byte 2. See `./framing.ts` for the shared wire contract.
 */

export * from "./framing.ts";
export * from "./device.ts";
export * from "./keys.ts";
export * from "./performance.ts";
export * from "./lighting.ts";
export * from "./macro.ts";
