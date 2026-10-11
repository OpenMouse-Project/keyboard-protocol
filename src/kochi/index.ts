/**
 * Kochi Hummingbird 68's system-mode protocol. Independently implemented from
 * observations of the public HB68 configurator and physical 1CA2:0901 hardware.
 * See docs/kochi-hb68.md for evidence and the intentionally limited scope.
 */
export const KOCHI_VENDOR_ID = 0x1ca2;
export const KOCHI_HB68_PRODUCT_ID = 0x0901;
export const KOCHI_CONFIG_USAGE_PAGE = 0xffa0;
export const KOCHI_CONFIG_USAGE = 1;
export const KOCHI_REPORT_ID = 0;
export const KOCHI_REPORT_SIZE = 64;
export type KochiSystemMode = "win" | "mac";

/** Only the commands exercised on the HB68; no firmware/calibration commands. */
export const KOCHI_COMMAND = {
  name: 0x26,
  queryWin: 0x21,
  queryMac: 0x22,
  setWin: 0x30,
  setMac: 0x31,
} as const;
export type KochiCommand = (typeof KOCHI_COMMAND)[keyof typeof KOCHI_COMMAND];

/** Header checksum covers header fields and the final declared payload byte. */
export function kochiChecksum(frame: Uint8Array): number {
  const length = frame[1];
  if (length === undefined || length < 1 || length > 60 || frame.length < length + 4) {
    throw new RangeError("Invalid Kochi payload length.");
  }
  return (0x35 + frame[0]! + length + frame[2]! + frame[length + 3]!) & 0xff;
}

export function encodeKochiCommand(command: KochiCommand): Uint8Array<ArrayBuffer> {
  if (!Object.values(KOCHI_COMMAND).includes(command)) throw new RangeError("Unsupported Kochi command.");
  const frame = new Uint8Array(KOCHI_REPORT_SIZE);
  frame.set([0x5c, 3, 0, 0, command, 0xff, 0xff]);
  frame[3] = kochiChecksum(frame);
  return frame;
}

/** Mode queries reply as [reserved, command, 0|1|FF, FF]. FF is unsupported. */
export function kochiReplyPayload(frame: Uint8Array, command: KochiCommand): Uint8Array | null {
  const length = frame[1];
  if (frame[0] !== 0x5c || frame[2] !== 0x80 || length === undefined
    || length < 3 || length > 60 || frame.length < length + 4
    || frame[5] !== command || frame[3] !== kochiChecksum(frame)) return null;
  return frame.slice(4, length + 4);
}

export function decodeKochiName(frame: Uint8Array): string | null {
  const payload = kochiReplyPayload(frame, KOCHI_COMMAND.name);
  if (!payload || payload.length < 34) return null;
  const name = payload.slice(2, 34);
  const end = name.indexOf(0);
  return new TextDecoder().decode(end < 0 ? name : name.slice(0, end)).trim() || null;
}

export function decodeKochiModeQuery(frame: Uint8Array, mode: KochiSystemMode): boolean | null {
  const payload = kochiReplyPayload(frame, mode === "win" ? KOCHI_COMMAND.queryWin : KOCHI_COMMAND.queryMac);
  if (!payload || payload.length !== 4 || payload[3] !== 0xff) return null;
  return payload[2] === 0 ? false : payload[2] === 1 ? true : null;
}

export function decodeKochiModeAck(frame: Uint8Array, mode: KochiSystemMode): boolean {
  const payload = kochiReplyPayload(frame, mode === "win" ? KOCHI_COMMAND.setWin : KOCHI_COMMAND.setMac);
  return payload?.length === 4 && payload[2] === 1 && payload[3] === 0xff;
}

export function assertKochiMode(mode: KochiSystemMode): void {
  if (mode !== "win" && mode !== "mac") throw new RangeError("Expected Windows or Mac mode.");
}
