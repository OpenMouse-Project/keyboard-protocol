import type { KeyboardStatus } from "../keyboard-types.ts";
import {
  ARBITER_COMMAND,
  ARBITER_KEYS_PER_PACKET,
  ARBITER_PRODUCTS,
  ARBITER_REPORT_ID,
  arbiterKeyMappingPackets,
  arbiterTravelPackets,
  assertArbiterTravelInRange,
  arbiterStatusName,
  decodeArbiterFirmware,
  decodeArbiterKeyMappingPacket,
  decodeArbiterLightEffect,
  decodeArbiterReply,
  decodeArbiterSerial,
  decodeArbiterTravelPacket,
  decodeArbiterUserMode,
  decodeArbiterWriteAck,
  encodeArbiterBoardProfile,
  encodeArbiterKeyMappingWrite,
  encodeArbiterLightEffectWrite,
  encodeArbiterShortRead,
  encodeArbiterTableRead,
  encodeArbiterTravelWrite,
  encodeArbiterUserModeWrite,
  isArbiterProfileChanged,
  type ArbiterCommand,
  type ArbiterKeyBinding,
  type ArbiterKeyTravel,
  type ArbiterKeyboardState,
  type ArbiterLightEffect,
  type ArbiterProduct,
  type ArbiterReply,
  type ArbiterUserMode,
} from "@openmouse/keyboard-protocol/arbiter";

const REPLY_TIMEOUT_MS = 1500;

/** Arbiter Studio keyboards on their vendor configuration collection (usage page 0xFF01/0xFF02). */
export class ArbiterKeyboardHidClient {
  readonly device: HIDDevice;
  private queue: Promise<unknown> = Promise.resolve();
  private listening = false;
  private faulted = false;
  private readonly profileListeners = new Set<() => void>();
  private pending: {
    command: ArbiterCommand;
    resolve: (reply: ArbiterReply) => void;
  } | null = null;

  constructor(device: HIDDevice) { this.device = device; }

  /** The catalog entry whose vendor id, product id and usage page this device exposes. */
  static productFor(device: HIDDevice): ArbiterProduct | undefined {
    return ARBITER_PRODUCTS.find((entry) =>
      entry.vendorId === device.vendorId && entry.productId === device.productId
      && ArbiterKeyboardHidClient.hasCollection(device.collections, entry.usagePage));
  }

  static isSupported(device: HIDDevice): boolean {
    return ArbiterKeyboardHidClient.productFor(device) !== undefined;
  }

  private static hasCollection(collections: readonly HIDCollectionInfo[], usagePage: number): boolean {
    for (const collection of collections) {
      if (collection.usagePage === usagePage && collection.usage === 1) return true;
      if (ArbiterKeyboardHidClient.hasCollection(collection.children, usagePage)) return true;
    }
    return false;
  }

  private requireProduct(): ArbiterProduct {
    const product = ArbiterKeyboardHidClient.productFor(this.device);
    if (!product) throw new Error("Not a supported Arbiter keyboard configuration interface.");
    return product;
  }

  async open(): Promise<void> {
    this.requireProduct();
    if (this.faulted) throw new Error("Reconnect the Arbiter keyboard after a failed transaction.");
    if (!this.device.opened) await this.device.open();
    // close() can land while open() is pending; release the device instead of
    // installing a listener on a session that was already closed.
    if (this.faulted) {
      if (this.device.opened) await this.device.close();
      throw new Error("Reconnect the Arbiter keyboard after a failed transaction.");
    }
    if (!this.listening) {
      this.device.addEventListener("inputreport", this.onReport);
      this.listening = true;
    }
  }

  async close(): Promise<void> {
    this.faulted = true;
    this.pending = null;
    if (this.listening) this.device.removeEventListener("inputreport", this.onReport);
    this.listening = false;
    if (this.device.opened) await this.device.close();
  }

  /** Called when a PRO model announces a profile switch it made itself. */
  onProfileChanged(listener: () => void): () => void {
    this.profileListeners.add(listener);
    return () => { this.profileListeners.delete(listener); };
  }

  private readonly onReport = (event: HIDInputReportEvent): void => {
    if (event.device !== this.device || event.reportId !== ARBITER_REPORT_ID) return;
    const frame = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
    if (isArbiterProfileChanged(frame)) {
      this.profileListeners.forEach((listener) => listener());
      return;
    }
    const reply = decodeArbiterReply(frame);
    if (reply && this.pending && reply.command === this.pending.command) this.pending.resolve(reply);
  };

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** One request and its reply. A failure marks the session unusable: replies carry no transaction id. */
  private async exchange(command: ArbiterCommand, frame: Uint8Array<ArrayBuffer>): Promise<ArbiterReply> {
    await this.open();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reply = new Promise<ArbiterReply>((resolve, reject) => {
      this.pending = { command, resolve };
      timer = setTimeout(() => reject(new Error(`The Arbiter keyboard did not answer command ${command}.`)), REPLY_TIMEOUT_MS);
    });
    try {
      const [answer] = await Promise.all([reply, this.device.sendReport(ARBITER_REPORT_ID, frame)]);
      if (answer.status !== 0) {
        throw new Error(`The Arbiter keyboard refused command ${command}: ${arbiterStatusName(answer.status)}.`);
      }
      return answer;
    } catch (error) {
      this.faulted = true;
      throw error;
    } finally {
      clearTimeout(timer);
      this.pending = null;
    }
  }

  private async readFirmwareString(): Promise<string> {
    const reply = await this.exchange(ARBITER_COMMAND.getFirmware, encodeArbiterShortRead(ARBITER_COMMAND.getFirmware));
    const version = decodeArbiterFirmware(reply);
    if (!version) throw new Error("The Arbiter keyboard returned an unreadable firmware version.");
    return version;
  }

  private async readSerialString(): Promise<string | null> {
    const reply = await this.exchange(ARBITER_COMMAND.getSerial, encodeArbiterShortRead(ARBITER_COMMAND.getSerial));
    return decodeArbiterSerial(reply);
  }

  /** Walk every packet of one table, checking that each reply is the index asked for. */
  private async readTable<T>(
    command: typeof ARBITER_COMMAND.getTravel | typeof ARBITER_COMMAND.getKeyMapping,
    total: number,
    expectedRows: number,
    decode: (reply: ArbiterReply) => { index: number; total: number; rows: T[] } | null,
  ): Promise<T[]> {
    const rows: T[] = [];
    for (let index = 0; index < total; index += 1) {
      const reply = await this.exchange(command, encodeArbiterTableRead(command, index, total));
      const packet = decode(reply);
      if (!packet || packet.index !== index) throw new Error("The Arbiter keyboard returned an out-of-order table packet.");
      if (packet.total !== total) throw new Error("The Arbiter keyboard reported an unexpected table size.");
      rows.push(...packet.rows);
    }
    if (rows.length !== expectedRows) throw new Error(`The Arbiter keyboard returned ${rows.length} entries; expected ${expectedRows}.`);
    return rows;
  }

  private readTravelTable(): Promise<ArbiterKeyTravel[]> {
    const product = this.requireProduct();
    return this.readTable(ARBITER_COMMAND.getTravel, arbiterTravelPackets(product), product.travelKeys, (reply) => {
      const packet = decodeArbiterTravelPacket(reply);
      return packet && { index: packet.index, total: packet.total, rows: packet.keys };
    });
  }

  /** Per-key actuation (`make`) and rapid-trigger (`break`) in tenths of a millimetre. */
  readTravel(): Promise<ArbiterKeyTravel[]> {
    return this.serialized(() => this.readTravelTable());
  }

  /**
   * Change travel for some keys and write the whole table back, preserving
   * every other key. Values are tenths of a millimetre and must be inside the
   * vendor app's ranges (actuation 1-38, rapid trigger 1-24); keys you do not
   * touch are written back as read, whatever they hold. The firmware takes the table in full, so the current
   * values are read first; the write is confirmed by reading it back.
   */
  setKeyTravel(updates: readonly { index: number; make?: number; break?: number }[]): Promise<ArbiterKeyTravel[]> {
    return this.serialized(async () => {
      const total = arbiterTravelPackets(this.requireProduct());
      const next = (await this.readTravelTable()).map((key) => ({ ...key }));
      for (const update of updates) {
        const key = next[update.index];
        if (!key) throw new RangeError(`Key ${update.index} is outside this keyboard's ${next.length}-key table.`);
        if (update.make !== undefined) { assertArbiterTravelInRange("actuation", update.make); key.make = update.make; }
        if (update.break !== undefined) { assertArbiterTravelInRange("rapidTrigger", update.break); key.break = update.break; }
      }
      const frames = this.travelFrames(next, total);
      for (const frame of frames) {
        const ack = await this.exchange(ARBITER_COMMAND.setTravel, frame);
        if (decodeArbiterWriteAck(ack, ARBITER_COMMAND.setTravel) === null) {
          throw new Error("The Arbiter keyboard did not acknowledge the travel write.");
        }
      }
      const confirmed = await this.readTravelTable();
      if (confirmed.length !== next.length || confirmed.some((key, i) => key.make !== next[i]!.make || key.break !== next[i]!.break)) {
        throw new Error("The Arbiter keyboard did not retain the travel write.");
      }
      return confirmed;
    });
  }

  /** Encode every packet first so a bad value is rejected before anything is sent. */
  private travelFrames(keys: readonly ArbiterKeyTravel[], total: number): Uint8Array<ArrayBuffer>[] {
    const frames: Uint8Array<ArrayBuffer>[] = [];
    for (let index = 0; index < total; index += 1) {
      frames.push(encodeArbiterTravelWrite(index, total, keys.slice(index * ARBITER_KEYS_PER_PACKET, (index + 1) * ARBITER_KEYS_PER_PACKET)));
    }
    return frames;
  }

  readLightEffect(): Promise<ArbiterLightEffect> {
    return this.serialized(() => this.readLight());
  }

  private async readLight(): Promise<ArbiterLightEffect> {
    const reply = await this.exchange(ARBITER_COMMAND.getLightEffect, encodeArbiterShortRead(ARBITER_COMMAND.getLightEffect));
    const light = decodeArbiterLightEffect(reply);
    if (!light) throw new Error("The Arbiter keyboard returned an unreadable light effect.");
    return light;
  }

  /** Write the light effect and confirm it by reading it back. */
  setLightEffect(light: ArbiterLightEffect): Promise<ArbiterLightEffect> {
    return this.serialized(async () => {
      const frame = encodeArbiterLightEffectWrite(light);
      const ack = await this.exchange(ARBITER_COMMAND.setLightEffect, frame);
      if (decodeArbiterWriteAck(ack, ARBITER_COMMAND.setLightEffect) === null) {
        throw new Error("The Arbiter keyboard did not acknowledge the light effect.");
      }
      const confirmed = await this.readLight();
      const sent = frame.slice(4, 4 + 26);
      const echoed = encodeArbiterLightEffectWrite(confirmed).slice(4, 4 + 26);
      if (sent.some((byte, i) => byte !== echoed[i])) throw new Error("The Arbiter keyboard did not retain the light effect.");
      return confirmed;
    });
  }

  private async readKeyBindingTable(): Promise<ArbiterKeyBinding[]> {
    const product = this.requireProduct();
    return this.readTable(ARBITER_COMMAND.getKeyMapping, arbiterKeyMappingPackets(product), product.bindingKeys * product.layers, (reply) => {
      const packet = decodeArbiterKeyMappingPacket(reply);
      return packet && { index: packet.index, total: packet.total, rows: packet.bindings };
    });
  }

  /** The keyboard's flat table is every key of layer 0, then every key of layer 1. */
  private splitLayers(flat: readonly ArbiterKeyBinding[]): ArbiterKeyBinding[][] {
    const { bindingKeys, layers } = this.requireProduct();
    return Array.from({ length: layers }, (_, layer) => flat.slice(layer * bindingKeys, (layer + 1) * bindingKeys).map((b) => ({ ...b })));
  }

  /** Key bindings by layer, then matrix key. The PRO models have a second (FN) layer. */
  readKeyBindings(): Promise<ArbiterKeyBinding[][]> {
    return this.serialized(async () => this.splitLayers(await this.readKeyBindingTable()));
  }

  /**
   * Rebind some keys and write the whole table back, confirmed by read-back.
   * `layer` defaults to 0. `param` defaults to 0, which is what the vendor app
   * writes for every binding it authors; keys you do not touch keep theirs.
   */
  setKeyBindings(updates: readonly { layer?: number; index: number; keyCode: number; param?: number }[]): Promise<ArbiterKeyBinding[][]> {
    return this.serialized(async () => {
      const product = this.requireProduct();
      const total = arbiterKeyMappingPackets(product);
      const layers = this.splitLayers(await this.readKeyBindingTable());
      for (const update of updates) {
        const layer = update.layer ?? 0;
        const binding = layers[layer]?.[update.index];
        if (!binding) throw new RangeError(`Key ${update.index} on layer ${layer} is outside this keyboard's ${product.layers}-layer, ${product.bindingKeys}-key table.`);
        binding.keyCode = update.keyCode;
        binding.param = update.param ?? 0;
      }
      const flat = layers.flat();
      const frames: Uint8Array<ArrayBuffer>[] = [];
      for (let index = 0; index < total; index += 1) {
        frames.push(encodeArbiterKeyMappingWrite(index, total, flat.slice(index * ARBITER_KEYS_PER_PACKET, (index + 1) * ARBITER_KEYS_PER_PACKET)));
      }
      for (const frame of frames) {
        const ack = await this.exchange(ARBITER_COMMAND.setKeyMapping, frame);
        if (decodeArbiterWriteAck(ack, ARBITER_COMMAND.setKeyMapping) === null) {
          throw new Error("The Arbiter keyboard did not acknowledge the key mapping write.");
        }
      }
      const confirmed = await this.readKeyBindingTable();
      if (confirmed.length !== flat.length || confirmed.some((b, i) => b.keyCode !== flat[i]!.keyCode || b.param !== flat[i]!.param)) {
        throw new Error("The Arbiter keyboard did not retain the key mapping write.");
      }
      return this.splitLayers(confirmed);
    });
  }

  /** Switch the active on-board profile. The keyboard only acknowledges it; there is no read-back command. */
  setBoardProfile(profile: number): Promise<void> {
    return this.serialized(async () => {
      const frame = encodeArbiterBoardProfile(profile, this.requireProduct().profiles);
      const ack = await this.exchange(ARBITER_COMMAND.setBoardProfile, frame);
      if (decodeArbiterWriteAck(ack, ARBITER_COMMAND.setBoardProfile) === null) {
        throw new Error("The Arbiter keyboard did not acknowledge the profile switch.");
      }
    });
  }

  private requireSuperTap(): void {
    if (!this.requireProduct().superTap) throw new Error("This Arbiter model does not support SuperTap.");
  }

  readUserMode(): Promise<ArbiterUserMode> {
    return this.serialized(async () => {
      this.requireSuperTap();
      return this.readUserModeValue();
    });
  }

  private async readUserModeValue(): Promise<ArbiterUserMode> {
    const reply = await this.exchange(ARBITER_COMMAND.getUserMode, encodeArbiterShortRead(ARBITER_COMMAND.getUserMode));
    const mode = decodeArbiterUserMode(reply);
    if (!mode) throw new Error("The Arbiter keyboard returned an unreadable user mode.");
    return mode;
  }

  /** Write the SuperTap user mode and confirm it by reading it back. */
  setUserMode(mode: ArbiterUserMode): Promise<ArbiterUserMode> {
    return this.serialized(async () => {
      this.requireSuperTap();
      const frame = encodeArbiterUserModeWrite(mode);
      const ack = await this.exchange(ARBITER_COMMAND.setUserMode, frame);
      if (decodeArbiterWriteAck(ack, ARBITER_COMMAND.setUserMode) === null) {
        throw new Error("The Arbiter keyboard did not acknowledge the user mode.");
      }
      const confirmed = await this.readUserModeValue();
      const echoed = encodeArbiterUserModeWrite(confirmed);
      if (frame.slice(4, 10).some((byte, i) => byte !== echoed[4 + i])) {
        throw new Error("The Arbiter keyboard did not retain the user mode.");
      }
      return confirmed;
    });
  }

  /**
   * An optional status read that may fail without sinking the status, unless the
   * failure killed the session: a timeout or refused command faults the client,
   * and returning a "successful" status after that would hide the need to reconnect.
   */
  private async optionalRead<T>(read: () => Promise<T>): Promise<T | null> {
    try {
      return await read();
    } catch (error) {
      if (this.faulted) throw error;
      return null;
    }
  }

  readStatus(): Promise<KeyboardStatus> {
    return this.serialized(async () => {
      const product = this.requireProduct();
      const firmwareVersion = await this.readFirmwareString();
      const serial = await this.optionalRead(() => this.readSerialString());
      const travel = await this.optionalRead(() => this.readTravelTable());
      const light = await this.optionalRead(() => this.readLight());
      const userMode = product.superTap ? await this.optionalRead(() => this.readUserModeValue()) : null;
      const arbiter: ArbiterKeyboardState = {
        vendorId: product.vendorId,
        productId: product.productId,
        protocol: product.protocol,
        layers: product.layers,
        profiles: product.profiles,
        superTap: product.superTap,
        verified: product.verified,
        travel,
        light,
        userMode,
      };
      return {
        brand: "Arbiter Studio",
        name: product.name,
        ui: {
          family: "arbiter",
          settingsReady: false,
          defaultDisplayName: product.name,
          statusNote: product.verified ? undefined : "Arbiter support is derived from the vendor's web configurator; this model has not been tested through OpenMouse.",
        },
        connectionType: "Wired",
        connectionDetail: "USB",
        firmware: [`Firmware: ${firmwareVersion}`],
        firmwareVersion,
        layout: null,
        serial,
        activeProfile: null,
        profileCount: product.profiles,
        profileNames: [],
        arbiter,
      };
    });
  }
}
