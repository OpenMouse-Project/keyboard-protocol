import type { KeyboardStatus } from "../keyboard-types.ts";
import {
  GLORIOUS_EVENT_COLLECTIONS,
  GLORIOUS_MODELS,
  GLORIOUS_PROFILES,
  GLORIOUS_TRANSPORTS,
  gloriousFrameAllowed,
  gmmkParseEvent,
  heParseEvent,
  type GloriousJob,
  type GloriousModel,
} from "@openmouse/keyboard-protocol/glorious";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function findCollection(collections: readonly HIDCollectionInfo[] | undefined, usagePage: number, usage: number): HIDCollectionInfo | null {
  for (const collection of collections ?? []) {
    if (collection.usagePage === usagePage && collection.usage === usage) return collection;
    const nested = findCollection(collection.children, usagePage, usage);
    if (nested) return nested;
  }
  return null;
}

/** Bytes of a report (report id not counted) as the descriptor declares it; 0 when it doesn't. */
function reportLength(collection: HIDCollectionInfo, reportId: number, output: boolean): number {
  const reports = (output ? collection.outputReports : collection.featureReports) ?? [];
  const report = reports.find((r) => (r.reportId ?? 0) === reportId);
  const bits = (report?.items ?? []).reduce((sum, item) => sum + (item.reportSize ?? 0) * (item.reportCount ?? 0), 0);
  return Math.ceil(bits / 8);
}

/**
 * Glorious keyboards on their stock firmware (GMMK Pro, GMMK 2, GMMK 3, HE,
 * Numpad, GMBK, Eternal). Write-only: the boards report none of their
 * settings, so the host keeps what it sent and hands this client the frames
 * planned by `@openmouse/keyboard-protocol/glorious`. A board flashed with
 * QMK has no Glorious settings collection and is left to the VIA driver.
 */
export class GloriousKeyboardHidClient {
  readonly device: HIDDevice;
  readonly model: GloriousModel;
  private queue: Promise<unknown> = Promise.resolve();
  private listening = false;
  private readonly profileListeners = new Set<(profile: number, layer: number) => void>();
  private readonly wait: (ms: number) => Promise<void>;

  constructor(device: HIDDevice, wait: (ms: number) => Promise<void> = sleep) {
    const model = GloriousKeyboardHidClient.modelFor(device);
    if (!model) throw new Error("Not a Glorious keyboard settings interface.");
    this.device = device;
    this.model = model;
    this.wait = wait;
  }

  /** The board this device is, when it exposes that board's settings collection. */
  static modelFor(device: HIDDevice): GloriousModel | undefined {
    const model = GLORIOUS_MODELS.find((m) => m.vendorId === device.vendorId && m.productId === device.productId);
    if (!model) return undefined;
    const t = GLORIOUS_TRANSPORTS[model.protocol];
    return findCollection(device.collections, t.usagePage, t.usage) ? model : undefined;
  }

  static isSupported(device: HIDDevice): boolean {
    return GloriousKeyboardHidClient.modelFor(device) !== undefined;
  }

  get name(): string {
    return this.model.name;
  }

  async open(): Promise<void> {
    if (!this.device.opened) await this.device.open();
    if (!this.listening) {
      this.device.addEventListener("inputreport", this.onReport);
      this.listening = true;
    }
  }

  async close(): Promise<void> {
    if (this.listening) this.device.removeEventListener("inputreport", this.onReport);
    this.listening = false;
    if (this.device.opened) await this.device.close();
  }

  /** Called with the 0-based profile and layer when they are switched on the board (GMMK and HE). */
  onProfileChanged(listener: (profile: number, layer: number) => void): () => void {
    this.profileListeners.add(listener);
    return () => { this.profileListeners.delete(listener); };
  }

  private readonly onReport = (event: HIDInputReportEvent): void => {
    const events = GLORIOUS_EVENT_COLLECTIONS[this.model.protocol];
    if (event.device !== this.device || !events || event.reportId !== events.reportId) return;
    const data = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
    const switched = this.model.protocol === "he" ? heParseEvent(data) : gmmkParseEvent(data);
    if (switched) this.profileListeners.forEach((listener) => listener(switched[0], switched[1]));
  };

  /** Identity only: nothing else can be read from these boards. */
  async readStatus(): Promise<KeyboardStatus> {
    return {
      brand: "Glorious",
      name: this.model.name,
      ui: {
        family: "glorious",
        settingsReady: true,
        defaultDisplayName: this.model.name,
        statusNote: "This keyboard can't report its settings; OpenMouse shows what it last sent.",
      },
      connectionType: "Wired",
      connectionDetail: "USB",
      firmware: [],
      firmwareVersion: null,
      layout: this.model.layout.toUpperCase(),
      serial: null,
      activeProfile: null,
      profileCount: GLORIOUS_PROFILES,
      profileNames: [],
      glorious: { model: this.model },
    };
  }

  /** The settings report's payload size from the descriptor (report id not counted). */
  payloadLength(): number {
    const t = GLORIOUS_TRANSPORTS[this.model.protocol];
    const collection = findCollection(this.device.collections, t.usagePage, t.usage);
    return collection ? reportLength(collection, t.reportId, t.output) : 0;
  }

  /** Sends a planned job frame by frame, with the pauses CORE leaves, one job at a time. */
  send(job: GloriousJob): Promise<void> {
    const next = this.queue.then(() => this.sendNow(job));
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async sendNow(job: GloriousJob): Promise<void> {
    const t = GLORIOUS_TRANSPORTS[this.model.protocol];
    const length = this.payloadLength();
    if (length < 63 || length > 1023) throw new Error(`Unexpected settings report size (${length} bytes); nothing was sent.`);
    const payloads = job.map(({ frame }) => {
      if (!gloriousFrameAllowed(this.model, frame)) throw new Error("Refusing a frame this keyboard is never sent.");
      const body = frame.subarray(1);
      if (body.subarray(length).some((byte) => byte !== 0)) throw new Error("A frame doesn't fit the keyboard's report; nothing was sent.");
      const payload = new Uint8Array(length);
      payload.set(body.subarray(0, length));
      return payload;
    });
    await this.open();
    for (let i = 0; i < job.length; i++) {
      if (t.output) await this.device.sendReport(t.reportId, payloads[i]!);
      else await this.device.sendFeatureReport(t.reportId, payloads[i]!);
      await this.wait(job[i]!.delayMs);
    }
  }
}
