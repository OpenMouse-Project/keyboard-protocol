import type { KeyboardStatus } from "../keyboard-types.ts";
import {
  decodeWootingAnalogReport,
  decodeWootingDeviceConfig,
  decodeWootingProfileIndex,
  decodeWootingProfileMetadata,
  decodeWootingVersion,
  encodeWootingCommand,
  encodeWootingProfileCommand,
  isWootingReply,
  wootingFeatureReport,
  wootingProductName,
  WOOTING_ANALOG_USAGE_PAGE,
  WOOTING_ANALOG_USAGE_PAGE_ALT,
  WOOTING_COMMAND,
  WOOTING_CONFIG_USAGE,
  WOOTING_CONFIG_USAGE_PAGE,
  WOOTING_CONFIG_USAGE_PAGE_STANDARD,
  WOOTING_PRODUCTS,
  WOOTING_STATUS_ERROR,
  WOOTING_VENDOR_ID,
  type WootingAnalogKey,
  WOOTING_MAGIC_MULTI,
  WOOTING_MAGIC_WORD_1,
} from "@openmouse/keyboard-protocol/wooting";

/** Settle delay so the analog-stream collect window never overlaps a reply. */
function wootingDelay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/**
 * Wooting analog keyboard (60HE+) HID control — read-only identity plus
 * profile discovery.
 *
 * The host is a device control panel, so a keyboard has no home in the mouse
 * settings grid: `ui.settingsReady` stays false and this exposes no setters,
 * so nothing here can change a key, curve, or profile. The job is narrow and
 * honest: recognise a supported Wooting board on its vendor config interface,
 * connect, and report what it is — firmware, layout, serial, active profile,
 * profile names.
 *
 * Device identity always succeeds — it comes from the `HIDDevice` metadata.
 * Every live config read is best-effort: the 60HE+ config interface declares
 * only an input report, so whether the browser permits the outgoing feature
 * report is hardware/Chrome-specific. When it is not permitted the driver still
 * connects and identifies the board; it just omits the live lines.
 */

const CONFIG_RESPONSE_TIMEOUT_MS = 400;
/** How long to gather input reports for a multi-report reply (ack + data). */
const COLLECT_WINDOW_MS = 130;
/**
 * Upper bound on profile slots probed via get_profile_metadata before giving
 * up. Real boards ship ≤ 4; the cap only bounds a board that answers every
 * probe with garbage.
 */
const MAX_PROFILE_PROBE_SLOTS = 8;
/** Pending single-reply read: resolvers handed to the input-report listener. */
export interface WootingResponseWaiter {
  resolve: (data: Uint8Array) => void;
  reject: (error: Error) => void;
}

/** Timeout handle guarding a pending single-reply read. */
export type WootingResponseTimer = ReturnType<typeof setTimeout>;

export class WootingHidClient {
  readonly device: HIDDevice;

  private responseWaiter: WootingResponseWaiter | null = null;
  private responseTimer: WootingResponseTimer | null = null;

  // Each command's raw reply is read once per connection and cached, so a
  // failure (or a device that just will not answer) never re-spams writes on
  // every background refresh.
  private readonly replies = new Map<number, Uint8Array | null>();

  // Serializes command sends so a profile read and a status refresh never share
  // the single input-report reply channel at the same time.
  private commandLock: Promise<unknown> = Promise.resolve();

  // When set, input reports are accumulated here instead of resolving a single
  // waiter — used to gather a multi-report reply (ack + data) for one command.
  private collecting: Uint8Array[] | null = null;

  private readonly onInputReport = (event: HIDInputReportEvent): void => {
    const bytes = new Uint8Array(
      event.data.buffer.slice(event.data.byteOffset, event.data.byteOffset + event.data.byteLength),
    );
    if (this.collecting) {
      this.collecting.push(bytes);
      return;
    }
    const waiter = this.responseWaiter;
    if (!waiter) return;
    this.clearPendingRead();
    waiter.resolve(bytes);
  };

  private listening = false;

  constructor(device: HIDDevice) {
    this.device = device;
  }

  /**
   * Wooting VID plus the command-capable config collection: usage page `0xFF55`
   * (ARM, 60HE+ and later) or `0x1337` (Standard, One / Two / original 60HE),
   * usage `0x01`. Only these collections are matched — a board also presents a
   * legacy `0xFF00` collection and the analog stream, and matching those would
   * list the same physical keyboard several times.
   */
  static isSupported(device: HIDDevice): boolean {
    if (device.vendorId !== WOOTING_VENDOR_ID) return false;
    if (!WOOTING_PRODUCTS[device.productId]) return false;
    return WootingHidClient.configCollection(device.collections) !== null;
  }

  /** The command-capable config collection, if this device exposes one. */
  private static configCollection(
    collections: readonly HIDCollectionInfo[],
  ): HIDCollectionInfo | null {
    for (const collection of collections) {
      if (collection.usage === WOOTING_CONFIG_USAGE
        && (collection.usagePage === WOOTING_CONFIG_USAGE_PAGE
          || collection.usagePage === WOOTING_CONFIG_USAGE_PAGE_STANDARD)) {
        return collection;
      }
      const nested = WootingHidClient.configCollection(collection.children);
      if (nested) return nested;
    }
    return null;
  }

  async open(): Promise<void> {
    if (!this.device.opened) await this.device.open();
    if (!this.listening) {
      this.device.addEventListener("inputreport", this.onInputReport);
      this.listening = true;
    }
  }

  async close(): Promise<void> {
    if (this.listening) {
      this.device.removeEventListener("inputreport", this.onInputReport);
      this.listening = false;
    }
    if (this.device.opened) await this.device.close();
  }

  /**
   * Subscribe to the live analog key stream. The board pushes a full snapshot
   * of the currently-pressed keys as input reports on its analog interface
   * (0xFF53, or 0xFF54 on some PIDs — a sibling of the config interface).
   * Opens that interface, forwards each decoded frame to `onFrame`, and
   * resolves to a stop function that detaches the listener. Rejects if the
   * analog interface is not available to the page.
   */
  async startAnalog(onFrame: (keys: WootingAnalogKey[]) => void): Promise<() => void> {
    const analog = await this.analogDevice();
    if (!analog) {
      throw new Error("This Wooting's analog interface is not available to OpenMouse.");
    }
    if (!analog.opened) await analog.open();
    const listener = (event: HIDInputReportEvent): void => {
      const data = new Uint8Array(
        event.data.buffer.slice(event.data.byteOffset, event.data.byteOffset + event.data.byteLength),
      );
      onFrame(decodeWootingAnalogReport(data));
    };
    analog.addEventListener("inputreport", listener);
    return () => analog.removeEventListener("inputreport", listener);
  }

  /** The sibling analog-stream interface (same board, usage page 0xFF53/0xFF54). */
  private async analogDevice(): Promise<HIDDevice | null> {
    const hid = (globalThis.navigator as Navigator | undefined)?.hid;
    if (!hid) return null;
    const devices = await hid.getDevices();
    return devices.find((device) =>
      device.vendorId === WOOTING_VENDOR_ID
      && device.productId === this.device.productId
      && device.collections.some((collection) =>
        (collection.usagePage === WOOTING_ANALOG_USAGE_PAGE
          || collection.usagePage === WOOTING_ANALOG_USAGE_PAGE_ALT)
        && collection.usage === WOOTING_CONFIG_USAGE),
    ) ?? null;
  }

  async readStatus(): Promise<KeyboardStatus> {
    await this.open();
    // Sequential: each reply is awaited before the next command is sent, so the
    // input-report answers never interleave.
    const version = await this.command(WOOTING_COMMAND.getVersion);
    const config = await this.command(WOOTING_COMMAND.getDeviceConfig);
    const serial = await this.command(WOOTING_COMMAND.getSerial);
    const profile = await this.readProfileState();

    const name = wootingProductName(this.device.productId);
    const firmwareVersion = version ? decodeWootingVersion(version) : null;
    const layout = config?.subarray(4).some((byte) => byte !== 0)
      ? decodeWootingDeviceConfig(config)?.layout ?? null
      : null;
    const lines: string[] = [];
    if (version) lines.push(firmwareVersion ? `Firmware: ${firmwareVersion}` : `Version reply: ${wootingHexPreview(version, 20)}`);
    if (config) {
      // A header-only config answer has no payload to decode — show the raw
      // bytes, never an invented layout.
      lines.push(layout ? `Layout: ${layout}` : `Config reply: ${wootingHexPreview(config, 20)}`);
    }
    return {
      brand: "Wooting",
      name,
      ui: {
        family: "wooting",
        // Keyboard analog controls have no place in the mouse settings grid yet.
        settingsReady: false,
        defaultDisplayName: name,
      },
      connectionType: "Wired",
      connectionDetail: "USB",
      firmware: lines,
      firmwareVersion,
      layout,
      serial: serial ? wootingSerialText(serial) : null,
      activeProfile: profile.active,
      profileCount: profile.count,
      profileNames: profile.names,
    };
  }

  /**
   * Active profile slot plus the named-slot census. Never throws: every leg is
   * best-effort and an unreadable board reports nulls the host renders as
   * "unknown" rather than a guessed slot.
   *
   * GetDigitalProfilesCount answers 0x66 on ARM, so slot existence is probed
   * one metadata read at a time (wootswitch): the census stops at the first
   * slot the board reports empty. A nameless-but-populated slot still counts
   * (name null), because the metadata length prefix is what proves existence.
   */
  private async readProfileState(): Promise<{
    active: number | null;
    count: number | null;
    names: readonly (string | null)[];
  }> {
    const indexReply = await this.command(WOOTING_COMMAND.getCurrentKeyboardProfileIndex);
    const active = indexReply ? decodeWootingProfileIndex(indexReply)?.active ?? null : null;
    // GetDigitalProfilesCount answers 0x66 on ARM — probe per-slot metadata
    // instead (wootswitch). A direct count is still tried first: Standard
    // boards answer it and it costs one round trip.
    const direct = await this.command(WOOTING_COMMAND.getDigitalProfilesCount);
    if (direct && direct[3] !== WOOTING_STATUS_ERROR && direct.length > 4) {
      const count = direct[4]!;
      return { active, count, names: await this.readProfileNames(count) };
    }
    const names: (string | null)[] = [];
    let count: number | null = null;
    for (let slot = 0; slot < MAX_PROFILE_PROBE_SLOTS; slot += 1) {
      const reply = await this.sendProfileCommand(WOOTING_COMMAND.getProfileMetadata, slot).catch(() => null);
      const decoded = reply ? decodeWootingProfileMetadata(reply) : null;
      if (!decoded?.exists) break;
      names.push(decoded.name);
      count = slot + 1;
    }
    return { active, count, names };
  }

  /** Profile names for slots `0..slotCount`, null where the board stays silent. */
  private async readProfileNames(slotCount: number): Promise<(string | null)[]> {
    const names: (string | null)[] = [];
    for (let slot = 0; slot < slotCount; slot += 1) {
      const reply = await this.sendProfileCommand(WOOTING_COMMAND.getProfileMetadata, slot).catch(() => null);
      names.push(reply ? decodeWootingProfileMetadata(reply)?.name ?? null : null);
    }
    return names;
  }

  // ---------------------------------------------------------------------------
  // Report I/O
  // ---------------------------------------------------------------------------

  /**
   * Best-effort live read of a command's raw reply, attempted once per connection
   * and then cached. Never throws: on any failure it returns null, the caller
   * falls back to whatever it has, and the failure is remembered so a background
   * refresh does not try (and fail) the write again.
   */
  private async command(commandId: number): Promise<Uint8Array | null> {
    if (this.replies.has(commandId)) return this.replies.get(commandId) ?? null;
    const raw = await this.sendCommand(commandId).catch(() => null);
    this.replies.set(commandId, raw);
    return raw;
  }

  /**
   * Live (uncached) read of the connected profile's actuation / rapid-trigger
   * settings: the current profile index plus the raw analog-profile "main part"
   * reply, for the analog UI to decode.
   */
  async readAnalogProfile(): Promise<{ index: number | null; reports: Uint8Array[]; note: string }> {
    const indexReply = await this.sendCommand(WOOTING_COMMAND.getCurrentKeyboardProfileIndex).catch(() => null);
    const decoded = indexReply ? decodeWootingProfileIndex(indexReply) : null;
    // get_keyboard_profile (0x39) carries the actuation (nested field 1 = mm ×
    // 20480) and rapid-trigger fields. Read it over the working channel
    // (feature, magic 0xD1, current-profile selector 0xFFFF).
    const command = new Uint8Array([
      WOOTING_MAGIC_MULTI, WOOTING_MAGIC_WORD_1, WOOTING_COMMAND.getKeyboardProfile, 0xff, 0xff, 0x00, 0x00,
    ]);
    const reports = await this.collectCommand(command, false).catch(() => []);
    const note = reports.some((report) => report.subarray(4).some((byte) => byte !== 0))
      ? "get_keyboard_profile"
      : "no body";
    return { index: decoded?.active ?? null, reports, note };
  }

  /**
   * Send a command and gather every input report it triggers within a short
   * window. `viaOutput` chooses Wootility's output-report channel (id 2) versus
   * the feature-report channel.
   */
  private async collectCommand(command: Uint8Array, viaOutput: boolean): Promise<Uint8Array[]> {
    const run = this.commandLock.then(async () => {
      this.collecting = [];
      try {
        if (viaOutput) {
          const report = new Uint8Array(62);
          report.set(command.subarray(0, 62));
          await this.device.sendReport(2, report);
        } else {
          await this.device.sendFeatureReport(this.featureReportId(), command.slice());
        }
      } catch (error) {
        this.collecting = null;
        throw error;
      }
      await wootingDelay(COLLECT_WINDOW_MS);
      const reports = this.collecting ?? [];
      this.collecting = null;
      return reports;
    });
    this.commandLock = run.then(() => undefined, () => undefined);
    return run;
  }

  /** Serialize command sends so overlapping callers never share the reply channel. */
  private async sendCommand(commandId: number, param0 = 0): Promise<Uint8Array | null> {
    const run = this.commandLock.then(() => this.probeCommand(commandId, param0));
    this.commandLock = run.then(() => undefined, () => undefined);
    return run;
  }

  /** Serialize a slot-taking command (profile argument placement is variant-specific). */
  private async sendProfileCommand(commandId: number, slot: number): Promise<Uint8Array | null> {
    // Slot reads are static per connection (profile names live in flash), so
    // they share the once-per-connection cache: a silent board pays its
    // timeouts once, not on every background refresh.
    const key = 0x10000 | ((commandId << 8) | (slot & 0xff));
    if (this.replies.has(key)) return this.replies.get(key) ?? null;
    const run = this.commandLock.then(() => this.probeRawCommand(encodeWootingProfileCommand(commandId, slot)));
    this.commandLock = run.then(() => undefined, () => undefined);
    const raw = await run.catch(() => null);
    this.replies.set(key, raw);
    return raw;
  }

  /**
   * Send a command on the config interface's declared feature report and read the
   * reply. ARM boards answer with the multi-report magic (0xD1), so commands go
   * out in that form. The answer arrives as an input report (matching Wooting's
   * own tooling); a feature GET is tried only as a fallback. Returns the raw
   * reply for the matching command, or null if nothing usable came back.
   */
  private async probeCommand(commandId: number, param0 = 0): Promise<Uint8Array | null> {
    // Magic + command payload, without hidapi's leading report-index byte —
    // WebHID carries the report id separately.
    return this.probeRawCommand(encodeWootingCommand(commandId, param0, 0, 0, 0, { multiReport: true }));
  }

  /** Send a pre-encoded command buffer and read its reply off both channels. */
  private async probeRawCommand(buffer: Uint8Array): Promise<Uint8Array | null> {
    const reportId = this.featureReportId();
    const body = wootingFeatureReport(buffer).data;

    const inputReply = this.nextInputReport();
    inputReply.catch(() => {}); // guard: this promise may go unused

    try {
      await this.device.sendFeatureReport(reportId, body);
    } catch {
      this.clearPendingRead();
      return null;
    }

    const viaInput = await inputReply.catch(() => null);
    if (viaInput && isWootingReply(viaInput)) return viaInput;

    this.clearPendingRead();
    const viaFeature = await this.device.receiveFeatureReport(reportId)
      .then((view) => new Uint8Array(view.buffer, view.byteOffset, view.byteLength))
      .catch(() => null);
    return viaFeature && isWootingReply(viaFeature) ? viaFeature : null;
  }

  /** Report id of the config collection's declared feature report (0 if none). */
  private featureReportId(): number {
    const collection = WootingHidClient.configCollection(this.device.collections);
    return collection?.featureReports?.[0]?.reportId ?? 0;
  }

  /** Resolve with the next input report, or reject on timeout. */
  private nextInputReport(): Promise<Uint8Array> {
    const { promise, resolve, reject } = Promise.withResolvers<Uint8Array>();
    this.responseWaiter = { resolve, reject };
    this.responseTimer = setTimeout(() => {
      this.clearPendingRead();
      reject(new Error("Wooting keyboard did not answer the config request."));
    }, CONFIG_RESPONSE_TIMEOUT_MS);
    return promise;
  }

  private clearPendingRead(): void {
    if (this.responseTimer !== null) {
      clearTimeout(this.responseTimer);
      this.responseTimer = null;
    }
    this.responseWaiter = null;
  }

}

/** Serial bytes as text; falls back to hex when the payload is not printable. */
function wootingSerialText(reply: Uint8Array): string {
  const body = reply.subarray(4);
  const printable = [...body].every((byte) => byte === 0 || (byte >= 0x20 && byte < 0x7f));
  if (!printable) return [...body].map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
  return String.fromCharCode(...[...body].filter((byte) => byte !== 0));
}

/** First `count` bytes of a buffer as spaced hex, with an ellipsis if truncated. */
function wootingHexPreview(bytes: Uint8Array, count: number): string {
  const shown = [...bytes.subarray(0, count)].map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
  return bytes.length > count ? `${shown} …` : shown;
}
