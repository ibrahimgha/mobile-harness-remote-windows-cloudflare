import { devices, HID } from "node-hid";

const sideKeyboardVendorId = 0x0816;
const sideKeyboardProductId = 0x2475;
const sideKeyboardUsagePage = 0xff00;
const sideKeyboardUsage = 2;
const reportLength = 65;
const ledHeartbeatTtlMs = 15_000;
const ledReconcileIntervalMs = 5_000;
const ledRefreshMs = 10_000;

const lightOff = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] as const;
const lightFlash = [1, 0, 2, 4, 2, 0, 1, 0, 64, 255, 255] as const;

type LedReport = {
  flashing: boolean;
  flashingSquares: number;
  seenAt: number;
};

type LedApplyResult = {
  connected: boolean;
  product?: string;
  serialNumber?: string;
};

export type ControlRoomLedStatus = {
  enabled: boolean;
  supported: boolean;
  connected: boolean;
  flashing: boolean;
  activeInstanceIds: string[];
  flashingInstanceIds: string[];
  flashingSquares: number;
  acknowledged: boolean;
  product?: string;
  serialNumber?: string;
  lastAppliedAt?: string;
  lastError?: string;
};

export type ControlRoomLedCoordinatorOptions = {
  enabled?: boolean;
  now?: () => number;
  apply?: (flashing: boolean) => LedApplyResult | Promise<LedApplyResult>;
  heartbeatTtlMs?: number;
  refreshMs?: number;
};

function sideKeyboardPath(): { path: string; product?: string; serialNumber?: string } | null {
  const info = devices().find((candidate) =>
    candidate.vendorId === sideKeyboardVendorId &&
    candidate.productId === sideKeyboardProductId &&
    candidate.usagePage === sideKeyboardUsagePage &&
    candidate.usage === sideKeyboardUsage &&
    typeof candidate.path === "string"
  );
  return info?.path ? { path: info.path, product: info.product, serialNumber: info.serialNumber } : null;
}

function writeLightState(flashing: boolean): LedApplyResult {
  if (process.platform !== "win32") return { connected: false };

  const info = sideKeyboardPath();
  if (!info) return { connected: false };

  const light = flashing ? lightFlash : lightOff;
  const report = Buffer.alloc(reportLength);
  report[0] = 0;
  report[1] = 6;
  report[2] = 11;
  report[3] = light.length;
  report[4] = 0;
  report[5] = 0;
  light.forEach((value, index) => {
    report[index + 6] = value;
  });

  const device = new HID(info.path);
  try {
    device.write([...report]);
    const response = device.readTimeout(1_500);
    if (response[0] !== 0xaa || response[1] !== 11) {
      throw new Error(`SIDE-KEYBOARD returned an unexpected LED response: ${response.slice(0, 8).join(",")}`);
    }
    return { connected: true, product: info.product, serialNumber: info.serialNumber };
  } finally {
    device.close();
  }
}

export class ControlRoomLedCoordinator {
  private readonly reports = new Map<string, LedReport>();
  private readonly enabled: boolean;
  private readonly now: () => number;
  private readonly applyState: (flashing: boolean) => LedApplyResult | Promise<LedApplyResult>;
  private readonly heartbeatTtlMs: number;
  private readonly refreshMs: number;
  private desiredFlashing = false;
  private completionVersion = 0;
  private acknowledgedVersion = 0;
  private appliedFlashing: boolean | null = null;
  private connected = false;
  private product: string | undefined;
  private serialNumber: string | undefined;
  private lastAppliedAt: number | undefined;
  private lastError: string | undefined;
  private applyQueue: Promise<void> = Promise.resolve();
  private reconcileTimer: NodeJS.Timeout | undefined;

  constructor(options: ControlRoomLedCoordinatorOptions = {}) {
    this.enabled = options.enabled ?? process.env.CONTROL_ROOM_LED_ENABLED !== "false";
    this.now = options.now ?? Date.now;
    this.applyState = options.apply ?? writeLightState;
    this.heartbeatTtlMs = options.heartbeatTtlMs ?? ledHeartbeatTtlMs;
    this.refreshMs = options.refreshMs ?? ledRefreshMs;
  }

  start(): void {
    if (this.reconcileTimer) return;
    this.queueApply(true);
    this.reconcileTimer = setInterval(() => this.reconcile(), ledReconcileIntervalMs);
    this.reconcileTimer.unref();
  }

  stop(): void {
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    this.reconcileTimer = undefined;
    this.reports.clear();
    this.desiredFlashing = false;
    this.queueApply(true);
  }

  report(instanceId: string, flashing: boolean, flashingSquares: number): ControlRoomLedStatus {
    const previous = this.reports.get(instanceId);
    const normalizedSquares = flashing ? Math.max(1, Math.min(24, Math.floor(flashingSquares))) : 0;
    if (flashing && (!previous?.flashing || normalizedSquares > previous.flashingSquares)) {
      this.completionVersion += 1;
    }
    this.reports.set(instanceId, {
      flashing,
      flashingSquares: normalizedSquares,
      seenAt: this.now()
    });
    this.reconcile();
    return this.status();
  }

  remove(instanceId: string): ControlRoomLedStatus {
    this.reports.delete(instanceId);
    this.reconcile();
    return this.status();
  }

  forceOff(): ControlRoomLedStatus {
    this.reports.clear();
    this.acknowledgedVersion = this.completionVersion;
    this.desiredFlashing = false;
    this.queueApply(true);
    return this.status();
  }

  acknowledge(): ControlRoomLedStatus {
    this.acknowledgedVersion = this.completionVersion;
    this.reconcile();
    return this.status();
  }

  async settled(): Promise<void> {
    await this.applyQueue;
  }

  status(): ControlRoomLedStatus {
    this.pruneExpired();
    const activeReports = [...this.reports.entries()];
    const flashingReports = activeReports.filter(([, report]) => report.flashing);
    return {
      enabled: this.enabled,
      supported: process.platform === "win32",
      connected: this.connected,
      flashing: this.desiredFlashing,
      activeInstanceIds: activeReports.map(([instanceId]) => instanceId).sort(),
      flashingInstanceIds: flashingReports.map(([instanceId]) => instanceId).sort(),
      flashingSquares: flashingReports.reduce((sum, [, report]) => sum + report.flashingSquares, 0),
      acknowledged: this.acknowledgedVersion >= this.completionVersion,
      ...(this.product ? { product: this.product } : {}),
      ...(this.serialNumber ? { serialNumber: this.serialNumber } : {}),
      ...(this.lastAppliedAt ? { lastAppliedAt: new Date(this.lastAppliedAt).toISOString() } : {}),
      ...(this.lastError ? { lastError: this.lastError } : {})
    };
  }

  private pruneExpired(): void {
    const cutoff = this.now() - this.heartbeatTtlMs;
    for (const [instanceId, report] of this.reports) {
      if (report.seenAt < cutoff) this.reports.delete(instanceId);
    }
  }

  private reconcile(): void {
    this.pruneExpired();
    const hasFlashingReport = [...this.reports.values()].some((report) => report.flashing);
    const nextFlashing = hasFlashingReport && this.acknowledgedVersion < this.completionVersion;
    const stateChanged = nextFlashing !== this.desiredFlashing;
    this.desiredFlashing = nextFlashing;
    const refreshDue = !this.lastAppliedAt || this.now() - this.lastAppliedAt >= this.refreshMs;
    if (stateChanged || this.appliedFlashing !== nextFlashing || refreshDue) this.queueApply(refreshDue);
  }

  private queueApply(force: boolean): void {
    if (!this.enabled) return;
    const requestedState = this.desiredFlashing;
    if (!force && this.appliedFlashing === requestedState) return;

    this.applyQueue = this.applyQueue
      .then(async () => {
        const state = this.desiredFlashing;
        if (!force && this.appliedFlashing === state) return;
        try {
          const result = await this.applyState(state);
          this.connected = result.connected;
          this.product = result.product;
          this.serialNumber = result.serialNumber;
          this.appliedFlashing = result.connected ? state : null;
          this.lastAppliedAt = this.now();
          this.lastError = result.connected ? undefined : "SIDE-KEYBOARD is not connected";
        } catch (error) {
          this.connected = false;
          this.appliedFlashing = null;
          this.lastAppliedAt = this.now();
          this.lastError = error instanceof Error ? error.message : String(error);
        }
      })
      .catch(() => undefined);
  }
}

export const controlRoomLed = new ControlRoomLedCoordinator();
