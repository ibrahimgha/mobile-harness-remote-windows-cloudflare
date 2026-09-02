import { Activity, ArrowDownToLine, ArrowLeftRight, Camera, Columns2, Combine, ExternalLink, Globe2, KeyRound, LayoutDashboard, Link2, Loader2, Maximize2, MessageSquare, Minimize2, MonitorCog, Play, Plus, Power, RefreshCw, Rows2, Save, ScanSearch, Settings2, SquareX, Trash2, Wifi, WifiOff, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  canMergeControlRoomRegions,
  controlRoomColumnOptions,
  controlRoomRowOptions,
  controlRoomScreenCount,
  controlRoomTileUrl,
  createControlRoomRegions,
  createControlRoomSlots,
  defaultControlRoomLayout,
  defaultControlRoomMachines,
  normalizeControlRoomLayout,
  normalizeControlRoomCustomUrl,
  normalizeControlRoomMachines,
  mergeControlRoomRegions,
  moveControlRoomSquareFocus,
  normalizeControlRoomRegions,
  normalizeControlRoomSlots,
  normalizeControlRoomViewModes,
  normalizePoweredOffSlotIds,
  resizeControlRoomSlots,
  splitControlRoomRegion,
  swapControlRoomSlots,
  type ControlRoomLayout,
  type ControlRoomMachine,
  type ControlRoomRegion,
  type ControlRoomSlot,
  type ControlRoomSplitDirection,
  type ControlRoomViewMode
} from "./controlRoomState";
import {
  emptySavedDashboardDraft,
  normalizeSavedDashboards,
  type SavedDashboard,
  type SavedDashboardDraft
} from "./controlRoomDashboards";
import "./control-room.css";

type TileConnection = "connecting" | "online" | "unauthorized" | "offline";

type ControlRoomStatusMessage = {
  type: "codex-control-room-status";
  slotId: string;
  status: "ready" | "authenticated" | "unauthorized";
  serverName?: string;
  projectName?: string;
  chatTitle?: string;
};

type ControlRoomCompletionMessage = {
  type: "codex-control-room-task-complete" | "codex-control-room-task-complete-dismiss" | "codex-control-room-active";
  slotId: string;
  chatId?: string;
  jobId?: string;
};

type WorkspaceContext = {
  projectName: string;
  chatTitle: string;
};

type NativeProfilesMessage = {
  type: "codex-control-room-profiles";
  instanceId?: unknown;
  instanceName?: unknown;
  machines: unknown;
};

type NativeWindowStateMessage = {
  type: "codex-control-room-window-state";
  fullscreen?: unknown;
};

type NativeFrameStateMessage = {
  type: "codex-control-room-frame-state";
  slotId?: unknown;
  failed?: unknown;
  detail?: unknown;
};

type NativeProfilesRequest = {
  type: "codex-control-room-profiles-request";
};

type NativeDashboardsMessage = {
  type: "codex-control-room-dashboards";
  dashboards?: unknown;
  error?: unknown;
  requestId?: unknown;
};

type NativeControlRoomStateMessage = {
  type: "codex-control-room-state";
  state?: unknown;
};

type NativeFrozenSquareMessage = {
  type: "codex-control-room-frozen-square";
  slotId?: unknown;
  dataUrl?: unknown;
  error?: unknown;
};

type NativeResourceUsageMessage = {
  type: "codex-control-room-resource-usage";
  cpuPercent?: unknown;
  memoryUsedPercent?: unknown;
  driveFreeBytes?: unknown;
  instanceWorkingSetBytes?: unknown;
};

type NativeKnobFocusMessage = {
  type: "codex-control-room-knob-focus";
  direction?: unknown;
};

type NativeControlPadActionMessage = {
  type: "codex-control-room-pad-action";
  action?: unknown;
};

type ControlRoomResourceUsage = {
  cpuPercent: number;
  memoryUsedPercent: number;
  driveFreeBytes: number;
  instanceWorkingSetBytes: number;
};

type ControlRoomPersistentState = {
  version: 1;
  layout: ControlRoomLayout;
  slots: ControlRoomSlot[];
  regions: ControlRoomRegion[];
  poweredOffSlotIds: string[];
  frozenSlotIds: string[];
  viewModes: Record<string, ControlRoomViewMode>;
  workspaceContexts: Record<string, WorkspaceContext>;
  settingsOpen: boolean;
  farViewFocusEnabled: boolean;
  dashboardEditorOpen: boolean;
  dashboardDraft: SavedDashboardDraft;
};

type FarViewPopup = {
  slotId: string;
  style: CSSProperties;
};

function KnobFocusOverlay({ index, terminated = false }: { index: number; terminated?: boolean }) {
  return (
    <div className={`control-room-knob-focus${terminated ? " is-terminated-focus" : ""}`} aria-hidden="true">
      <span>{terminated ? "TERMINATED FOCUS" : "KNOB FOCUS"} · {String(index + 1).padStart(2, "0")}</span>
    </div>
  );
}

declare global {
  interface Window {
    chrome?: {
      webview?: {
        addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
        removeEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
        postMessage(message: unknown): void;
      };
    };
  }
}

const storedProfilesKey = "codex-control-room-machines-v1";
const storedSlotsKey = "codex-control-room-slots-v1";
const storedPoweredOffSlotsKey = "codex-control-room-powered-off-slots-v1";
const storedFrozenSlotsKey = "codex-control-room-frozen-slots-v1";
const storedLayoutKey = "codex-control-room-layout-v1";
const storedViewModesKey = "codex-control-room-view-modes-v1";
const storedRegionsKey = "codex-control-room-regions-v1";
const storedWorkspaceContextsKey = "codex-control-room-workspace-contexts-v1";
const storedLastActiveSlotKey = "codex-control-room-last-active-slot-v1";
const authenticationRetryMs = 10_000;
const freezeCaptureTimeoutMs = 15_000;

function readStoredMachines(): ControlRoomMachine[] {
  try {
    const parsed = normalizeControlRoomMachines(JSON.parse(localStorage.getItem(storedProfilesKey) ?? "null"));
    return parsed.length ? parsed : defaultControlRoomMachines;
  } catch {
    return defaultControlRoomMachines;
  }
}

function readStoredLayout(): ControlRoomLayout {
  try {
    return normalizeControlRoomLayout(JSON.parse(localStorage.getItem(storedLayoutKey) ?? "null"));
  } catch {
    return defaultControlRoomLayout;
  }
}

function readStoredSlots(machines: ControlRoomMachine[], count: number): ControlRoomSlot[] {
  try {
    const raw = JSON.parse(localStorage.getItem(storedSlotsKey) ?? "null") as unknown;
    return normalizeControlRoomSlots(raw, machines, count);
  } catch {
    return createControlRoomSlots(machines, count);
  }
}

function readStoredPoweredOffSlots(slots: ControlRoomSlot[]): Set<string> {
  try {
    return new Set(normalizePoweredOffSlotIds(JSON.parse(localStorage.getItem(storedPoweredOffSlotsKey) ?? "null"), slots));
  } catch {
    return new Set();
  }
}

function readStoredFrozenSlots(slots: ControlRoomSlot[]): Set<string> {
  try {
    return new Set(normalizePoweredOffSlotIds(JSON.parse(localStorage.getItem(storedFrozenSlotsKey) ?? "null"), slots));
  } catch {
    return new Set();
  }
}

function readStoredViewModes(slots: ControlRoomSlot[]): Record<string, ControlRoomViewMode> {
  try {
    return normalizeControlRoomViewModes(JSON.parse(localStorage.getItem(storedViewModesKey) ?? "null"), slots);
  } catch {
    return {};
  }
}

function readStoredRegions(slots: ControlRoomSlot[], layout: ControlRoomLayout): ControlRoomRegion[] {
  try {
    return normalizeControlRoomRegions(JSON.parse(localStorage.getItem(storedRegionsKey) ?? "null"), slots, layout);
  } catch {
    return createControlRoomRegions(slots, layout);
  }
}

function normalizeWorkspaceContexts(value: unknown, slots: ControlRoomSlot[]): Record<string, WorkspaceContext> {
  if (!value || typeof value !== "object") return {};
  const slotIds = new Set(slots.map((slot) => slot.id));
  const normalized: Record<string, WorkspaceContext> = {};
  for (const [slotId, context] of Object.entries(value)) {
    if (!slotIds.has(slotId) || !context || typeof context !== "object") continue;
    const candidate = context as Partial<WorkspaceContext>;
    const projectName = typeof candidate.projectName === "string" ? candidate.projectName.trim() : "";
    const chatTitle = typeof candidate.chatTitle === "string" ? candidate.chatTitle.trim() : "";
    if (projectName || chatTitle) normalized[slotId] = { projectName, chatTitle };
  }
  return normalized;
}

function readStoredWorkspaceContexts(slots: ControlRoomSlot[]): Record<string, WorkspaceContext> {
  try {
    return normalizeWorkspaceContexts(JSON.parse(localStorage.getItem(storedWorkspaceContextsKey) ?? "null"), slots);
  } catch {
    return {};
  }
}

function connectionLabel(connection: TileConnection) {
  if (connection === "online") return "Live";
  if (connection === "unauthorized") return "Authentication needed";
  if (connection === "offline") return "Unavailable";
  return "Connecting";
}

function formatResourcePercent(value: number) {
  return `${Math.round(value)}%`;
}

function formatResourceBytes(value: number) {
  const gibibytes = value / 1024 ** 3;
  return `${gibibytes >= 100 ? Math.round(gibibytes) : gibibytes.toFixed(1)} GB`;
}

function resourceMetricTone(kind: "cpu" | "memory" | "disk", value: number) {
  if (kind === "disk") return value <= 10 * 1024 ** 3 ? "is-danger" : value <= 25 * 1024 ** 3 ? "is-warning" : "";
  return value >= 90 ? "is-danger" : value >= 75 ? "is-warning" : "";
}

function CustomUrlEditor({
  slotNumber,
  value,
  error,
  onChange,
  onSubmit,
  onCancel
}: {
  slotNumber: number;
  value: string;
  error: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="control-room-url-editor" role="dialog" aria-labelledby={`custom-url-title-${slotNumber}`}>
      <form onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
        <div className="control-room-url-editor-heading">
          <span><Link2 size={15} /> CUSTOM DASHBOARD</span>
          <button type="button" onClick={onCancel} aria-label={`Cancel custom URL for workspace ${slotNumber}`}><X size={14} /></button>
        </div>
        <strong id={`custom-url-title-${slotNumber}`}>Load a URL in square {String(slotNumber).padStart(2, "0")}</strong>
        <label>
          <span>Dashboard URL</span>
          <input
            type="url"
            inputMode="url"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="https://dashboard.example.com"
            autoFocus
            required
          />
        </label>
        <small className={error ? "is-error" : ""}>{error || "Paste any website address. Missing https:// is added automatically."}</small>
        <div className="control-room-url-editor-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="submit" className="is-primary"><Globe2 size={14} /> Load URL</button>
        </div>
      </form>
    </div>
  );
}

function SavedDashboardEditor({
  draft,
  error,
  onChange,
  onSave,
  onCancel
}: {
  draft: SavedDashboardDraft;
  error: string;
  onChange: (draft: SavedDashboardDraft) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const editing = Boolean(draft.id);
  return (
    <form className="control-room-dashboard-editor" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
      <div className="control-room-dashboard-editor-heading">
        <span><KeyRound size={13} /> {editing ? "EDIT DASHBOARD" : "NEW DASHBOARD"}</span>
        <button type="button" onClick={onCancel} aria-label="Close saved dashboard editor"><X size={13} /></button>
      </div>
      <label>
        <span>Name</span>
        <input value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} placeholder="Operations dashboard" autoFocus required />
      </label>
      <label>
        <span>URL</span>
        <input type="url" inputMode="url" value={draft.url} onChange={(event) => onChange({ ...draft, url: event.target.value })} placeholder="https://dashboard.example.com" required />
      </label>
      <label>
        <span>Login method</span>
        <select value={draft.credentialMode} onChange={(event) => onChange({ ...draft, credentialMode: event.target.value as SavedDashboardDraft["credentialMode"] })}>
          <option value="none">No saved credentials</option>
          <option value="form">Website login form</option>
          <option value="access-key">Access key only</option>
          <option value="basic">HTTP Basic authentication</option>
        </select>
      </label>
      {draft.credentialMode !== "none" && (
        <div className="control-room-dashboard-credentials">
          {draft.credentialMode !== "access-key" && (
            <label>
              <span>Username</span>
              <input autoComplete="off" value={draft.username} onChange={(event) => onChange({ ...draft, username: event.target.value })} placeholder={editing ? "Leave blank to keep saved username" : "Username or email"} />
            </label>
          )}
          <label>
            <span>{draft.credentialMode === "access-key" ? "Access key" : "Password"}</span>
            <input type="password" autoComplete="new-password" value={draft.password} onChange={(event) => onChange({ ...draft, password: event.target.value })} placeholder={editing ? `Leave blank to keep saved ${draft.credentialMode === "access-key" ? "access key" : "password"}` : draft.credentialMode === "access-key" ? "Access key" : "Password"} />
          </label>
          {(draft.credentialMode === "form" || draft.credentialMode === "access-key") && (
            <label className="control-room-dashboard-auto-submit">
              <input type="checkbox" checked={draft.autoSubmit} onChange={(event) => onChange({ ...draft, autoSubmit: event.target.checked })} />
              <span>{draft.credentialMode === "access-key" ? "Fill and submit access-key forms automatically" : "Fill and submit common login forms automatically"}</span>
            </label>
          )}
        </div>
      )}
      <small className={error ? "is-error" : ""}>{error || "Credentials are encrypted for your Windows account and never stored in the page."}</small>
      <div className="control-room-dashboard-editor-actions">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="submit" className="is-primary"><Save size={13} /> Save</button>
      </div>
    </form>
  );
}

export function ControlRoom() {
  const [instance, setInstance] = useState({ id: "default", name: "" });
  const [machines, setMachines] = useState<ControlRoomMachine[]>(readStoredMachines);
  const [layout, setLayout] = useState<ControlRoomLayout>(readStoredLayout);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [farViewFocusEnabled, setFarViewFocusEnabled] = useState(false);
  const [farViewPopup, setFarViewPopup] = useState<FarViewPopup | null>(null);
  const [movingSlotId, setMovingSlotId] = useState("");
  const [arrangeMode, setArrangeMode] = useState(false);
  const [mergeSourceRegionId, setMergeSourceRegionId] = useState("");
  const [fullscreen, setFullscreen] = useState(() => Boolean(document.fullscreenElement));
  const [slots, setSlots] = useState<ControlRoomSlot[]>(() => {
    const storedMachines = readStoredMachines();
    return readStoredSlots(storedMachines, controlRoomScreenCount(readStoredLayout()));
  });
  const [regions, setRegions] = useState<ControlRoomRegion[]>(() => {
    const storedMachines = readStoredMachines();
    const storedLayout = readStoredLayout();
    const storedSlots = readStoredSlots(storedMachines, controlRoomScreenCount(storedLayout));
    return readStoredRegions(storedSlots, storedLayout);
  });
  const [poweredOffSlots, setPoweredOffSlots] = useState<Set<string>>(() => {
    const storedMachines = readStoredMachines();
    const storedSlots = readStoredSlots(storedMachines, controlRoomScreenCount(readStoredLayout()));
    return readStoredPoweredOffSlots(storedSlots);
  });
  const [frozenSlots, setFrozenSlots] = useState<Set<string>>(() => {
    const storedMachines = readStoredMachines();
    const storedSlots = readStoredSlots(storedMachines, controlRoomScreenCount(readStoredLayout()));
    return readStoredFrozenSlots(storedSlots);
  });
  const [frozenImages, setFrozenImages] = useState<Record<string, string>>({});
  const [freezingSlots, setFreezingSlots] = useState<Set<string>>(new Set());
  const [viewModes, setViewModes] = useState<Record<string, ControlRoomViewMode>>(() => {
    const storedMachines = readStoredMachines();
    return readStoredViewModes(readStoredSlots(storedMachines, controlRoomScreenCount(readStoredLayout())));
  });
  const [connections, setConnections] = useState<Record<string, TileConnection>>({});
  const [pageFailures, setPageFailures] = useState<Record<string, string>>({});
  const [serverNames, setServerNames] = useState<Record<string, string>>({});
  const [workspaceContexts, setWorkspaceContexts] = useState<Record<string, WorkspaceContext>>(() => {
    const storedMachines = readStoredMachines();
    return readStoredWorkspaceContexts(readStoredSlots(storedMachines, controlRoomScreenCount(readStoredLayout())));
  });
  const [resourceUsage, setResourceUsage] = useState<ControlRoomResourceUsage | null>(null);
  const [completionGlows, setCompletionGlows] = useState<Record<string, string>>({});
  const [keyboardFocusedSlotId, setKeyboardFocusedSlotId] = useState("");
  const [reloadKeys, setReloadKeys] = useState<Record<string, number>>({});
  const [startTokens, setStartTokens] = useState<Record<string, string>>({});
  const [urlEditorSlotId, setUrlEditorSlotId] = useState("");
  const [customUrlDraft, setCustomUrlDraft] = useState("");
  const [customUrlError, setCustomUrlError] = useState("");
  const [savedDashboards, setSavedDashboards] = useState<SavedDashboard[]>([]);
  const [dashboardEditorOpen, setDashboardEditorOpen] = useState(false);
  const [dashboardDraft, setDashboardDraft] = useState<SavedDashboardDraft>(emptySavedDashboardDraft);
  const [dashboardError, setDashboardError] = useState("");
  const frameRefs = useRef<Record<string, HTMLIFrameElement | null>>({});
  const tileRefs = useRef<Record<string, HTMLElement | null>>({});
  const gridRef = useRef<HTMLElement | null>(null);
  const freezeTimeoutsRef = useRef<Record<string, number>>({});
  const authenticationAttemptAtRef = useRef<Record<string, number>>({});
  const dashboardSavePendingRef = useRef("");
  const keyboardFocusedSlotIdRef = useRef("");
  const lastActiveSlotIdRef = useRef(localStorage.getItem(storedLastActiveSlotKey) ?? "");
  const focusableSlotIdsRef = useRef<string[]>([]);
  const controlPadPressedCodesRef = useRef(new Set<string>());
  const nativeStateHydratedRef = useRef(!window.chrome?.webview);
  const [nativeStateHydrated, setNativeStateHydrated] = useState(!window.chrome?.webview);
  const browserLedInstanceIdRef = useRef("");
  if (!browserLedInstanceIdRef.current) browserLedInstanceIdRef.current = `browser-${crypto.randomUUID()}`;

  const machineById = useMemo(() => new Map(machines.map((machine) => [machine.id, machine])), [machines]);
  const slotById = useMemo(() => new Map(slots.map((slot) => [slot.id, slot])), [slots]);
  const visibleRegions = useMemo(() => [...regions].sort((a, b) => a.row - b.row || a.column - b.column), [regions]);
  const visibleSlots = useMemo(() => visibleRegions.flatMap((region) => {
    const slot = slotById.get(region.masterSlotId);
    return slot ? [slot] : [];
  }), [slotById, visibleRegions]);
  const hasMergedRegions = regions.some((region) => region.rowSpan > 1 || region.columnSpan > 1);
  const terminatedCount = visibleSlots.filter((slot) => !slot.machineId && !slot.customUrl).length;
  const customUrlCount = visibleSlots.filter((slot) => Boolean(slot.customUrl)).length;
  const poweredOffCount = visibleSlots.filter((slot) => poweredOffSlots.has(slot.id)).length;
  const activeCount = visibleSlots.filter((slot) => (slot.machineId || slot.customUrl) && !poweredOffSlots.has(slot.id)).length;
  const onlineCount = visibleSlots.filter((slot) => (slot.machineId || slot.customUrl) && !poweredOffSlots.has(slot.id) && connections[slot.id] === "online").length;
  const localControlToken = useMemo(() => machines.find((machine) => {
    try {
      return new URL(machine.url).origin === window.location.origin;
    } catch {
      return false;
    }
  })?.token ?? "", [machines]);
  const ledInstanceId = window.chrome?.webview ? (instance.name ? instance.id : "") : browserLedInstanceIdRef.current;
  const flashingSquareCount = Object.keys(completionGlows).length;
  const focusableSlotIds = useMemo(() => visibleSlots.map((slot) => slot.id), [visibleSlots]);
  focusableSlotIdsRef.current = focusableSlotIds;

  const clearKeyboardFocus = useCallback(() => {
    keyboardFocusedSlotIdRef.current = "";
    setKeyboardFocusedSlotId("");
  }, []);

  const rememberActiveSlot = useCallback((slotId: string) => {
    if (!focusableSlotIdsRef.current.includes(slotId)) return;
    lastActiveSlotIdRef.current = slotId;
    localStorage.setItem(storedLastActiveSlotKey, slotId);
  }, []);

  const focusKeyboardSlot = useCallback((slotId: string) => {
    keyboardFocusedSlotIdRef.current = slotId;
    setKeyboardFocusedSlotId(slotId);
    if (!slotId) return;
    rememberActiveSlot(slotId);
    window.requestAnimationFrame(() => (frameRefs.current[slotId] ?? tileRefs.current[slotId])?.focus());
  }, [rememberActiveSlot]);

  const restoreKeyboardFocus = useCallback((direction: "previous" | "next") => {
    const focusableSlotIds = focusableSlotIdsRef.current;
    const rememberedSlotId = lastActiveSlotIdRef.current;
    const nextSlotId = focusableSlotIds.includes(rememberedSlotId)
      ? rememberedSlotId
      : moveControlRoomSquareFocus(focusableSlotIds, "", direction);
    focusKeyboardSlot(nextSlotId);
  }, [focusKeyboardSlot]);

  const moveKeyboardFocus = useCallback((direction: "previous" | "next") => {
    const currentSlotId = keyboardFocusedSlotIdRef.current;
    if (!currentSlotId) {
      restoreKeyboardFocus(direction);
      return;
    }
    const nextSlotId = moveControlRoomSquareFocus(
      focusableSlotIdsRef.current,
      currentSlotId,
      direction
    );
    if (currentSlotId && nextSlotId === currentSlotId) {
      window.chrome?.webview?.postMessage({ type: "codex-control-room-switch-request", direction });
      return;
    }
    focusKeyboardSlot(nextSlotId);
  }, [focusKeyboardSlot, restoreKeyboardFocus]);

  const sendAuthentication = useCallback(
    (slotId: string) => {
      const slot = slots.find((candidate) => candidate.id === slotId);
      const machine = slot ? machineById.get(slot.machineId) : null;
      const frame = frameRefs.current[slotId];

      if (!slot || !machine?.token || !frame?.contentWindow) {
        return;
      }

      const now = Date.now();
      if (now - (authenticationAttemptAtRef.current[slotId] ?? 0) < authenticationRetryMs) return;
      authenticationAttemptAtRef.current[slotId] = now;

      frame.contentWindow.postMessage(
        {
          type: "codex-control-room-auth",
          slotId,
          token: machine.token
        },
        new URL(machine.url).origin
      );
    },
    [machineById, slots]
  );

  useEffect(() => {
    const receiveStatus = (event: MessageEvent<unknown>) => {
      if (!event.data || typeof event.data !== "object") return;
      const message = event.data as Partial<ControlRoomStatusMessage>;
      if (message.type !== "codex-control-room-status" || typeof message.slotId !== "string") return;

      const slot = slots.find((candidate) => candidate.id === message.slotId);
      const machine = slot ? machineById.get(slot.machineId) : null;
      if (!machine || event.origin !== new URL(machine.url).origin) return;

      if (message.status === "ready") {
        setConnections((current) => ({ ...current, [message.slotId!]: "connecting" }));
        sendAuthentication(message.slotId);
      } else {
        setConnections((current) => ({
          ...current,
          [message.slotId!]: message.status === "authenticated" ? "online" : "unauthorized"
        }));
      }

      if (message.serverName) {
        setServerNames((current) => ({ ...current, [message.slotId!]: message.serverName! }));
      }
      if (typeof message.projectName === "string" || typeof message.chatTitle === "string") {
        setWorkspaceContexts((current) => {
          const next = {
            ...current,
            [message.slotId!]: {
            projectName: typeof message.projectName === "string" ? message.projectName : current[message.slotId!]?.projectName ?? "",
            chatTitle: typeof message.chatTitle === "string" ? message.chatTitle : current[message.slotId!]?.chatTitle ?? ""
            }
          };
          localStorage.setItem(storedWorkspaceContextsKey, JSON.stringify(next));
          return next;
        });
      }
    };

    window.addEventListener("message", receiveStatus);
    return () => window.removeEventListener("message", receiveStatus);
  }, [machineById, sendAuthentication, slots]);

  const dismissCompletionGlow = useCallback((slotId: string) => {
    setCompletionGlows((current) => {
      if (!current[slotId]) return current;
      const next = { ...current };
      delete next[slotId];
      return next;
    });
  }, []);

  useEffect(() => {
    const receiveCompletionState = (event: MessageEvent<unknown>) => {
      if (!event.data || typeof event.data !== "object") return;
      const message = event.data as Partial<ControlRoomCompletionMessage>;
      if (
        (message.type !== "codex-control-room-task-complete" && message.type !== "codex-control-room-task-complete-dismiss" && message.type !== "codex-control-room-active") ||
        typeof message.slotId !== "string"
      ) return;

      const slot = slots.find((candidate) => candidate.id === message.slotId);
      const machine = slot ? machineById.get(slot.machineId) : null;
      const frame = slot ? frameRefs.current[slot.id] : null;
      if (!machine || event.origin !== new URL(machine.url).origin || event.source !== frame?.contentWindow) return;

      if (message.type === "codex-control-room-active") {
        rememberActiveSlot(message.slotId);
        return;
      }

      if (message.type === "codex-control-room-task-complete" && typeof message.chatId === "string") {
        setCompletionGlows((current) => ({ ...current, [message.slotId!]: message.chatId! }));
      } else {
        dismissCompletionGlow(message.slotId);
      }
    };

    window.addEventListener("message", receiveCompletionState);
    return () => window.removeEventListener("message", receiveCompletionState);
  }, [dismissCompletionGlow, machineById, rememberActiveSlot, slots]);

  useEffect(() => {
    if (!ledInstanceId) return;

    const report = () => {
      void fetch("/api/control-room/led", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(localControlToken ? { "x-control-token": localControlToken } : {})
        },
        body: JSON.stringify({
          instanceId: ledInstanceId,
          flashing: flashingSquareCount > 0,
          flashingSquares: flashingSquareCount
        })
      }).catch(() => undefined);
    };

    report();
    const heartbeat = window.setInterval(report, 5_000);
    return () => window.clearInterval(heartbeat);
  }, [flashingSquareCount, ledInstanceId, localControlToken]);

  useEffect(() => {
    if (!ledInstanceId) return;
    const removeInstance = () => {
      void fetch(`/api/control-room/led/${encodeURIComponent(ledInstanceId)}`, {
        method: "DELETE",
        headers: localControlToken ? { "x-control-token": localControlToken } : undefined,
        keepalive: true
      }).catch(() => undefined);
    };
    window.addEventListener("pagehide", removeInstance);
    return () => window.removeEventListener("pagehide", removeInstance);
  }, [ledInstanceId, localControlToken]);

  useEffect(() => {
    const dismissAfterEmbeddedDashboardTap = () => {
      window.setTimeout(() => {
        if (!(document.activeElement instanceof HTMLIFrameElement)) return;
        const focusedSlotId = Object.entries(frameRefs.current).find(([, frame]) => frame === document.activeElement)?.[0];
        if (focusedSlotId) {
          rememberActiveSlot(focusedSlotId);
          dismissCompletionGlow(focusedSlotId);
        }
      }, 0);
    };
    window.addEventListener("blur", dismissAfterEmbeddedDashboardTap);
    return () => window.removeEventListener("blur", dismissAfterEmbeddedDashboardTap);
  }, [dismissCompletionGlow, rememberActiveSlot]);

  useEffect(() => {
    const receiveNativeMessage = (event: MessageEvent<unknown>) => {
      if (!event.data || typeof event.data !== "object") return;
      const message = event.data as Partial<NativeProfilesMessage> | Partial<NativeWindowStateMessage> | Partial<NativeFrameStateMessage> | Partial<NativeDashboardsMessage> | Partial<NativeControlRoomStateMessage> | Partial<NativeFrozenSquareMessage> | Partial<NativeResourceUsageMessage> | Partial<NativeKnobFocusMessage> | Partial<NativeControlPadActionMessage>;
      if (message.type === "codex-control-room-knob-focus") {
        if (message.direction === "clear") clearKeyboardFocus();
        if (message.direction === "entry-previous") focusKeyboardSlot(focusableSlotIdsRef.current.at(-1) ?? "");
        if (message.direction === "entry-next") focusKeyboardSlot(focusableSlotIdsRef.current[0] ?? "");
        if (message.direction === "resume-previous") restoreKeyboardFocus("previous");
        if (message.direction === "resume-next") restoreKeyboardFocus("next");
        if (message.direction === "previous" || message.direction === "next") moveKeyboardFocus(message.direction);
        return;
      }
      if (message.type === "codex-control-room-pad-action") {
        const slotId = keyboardFocusedSlotIdRef.current;
        if (message.action === "acknowledge-completion-light") {
          void fetch("/api/control-room/led/acknowledge", {
            method: "POST",
            headers: localControlToken ? { "x-control-token": localControlToken } : undefined
          }).catch(() => undefined);
          return;
        }
        if (message.action === "turn-off-display" && slotId) setSlotDisplay(slotId, false);
        if (message.action === "toggle-far-view-focus" && slotId) setFarViewFocusEnabled((current) => !current);
        return;
      }
      if (message.type === "codex-control-room-resource-usage") {
        const values = [message.cpuPercent, message.memoryUsedPercent, message.driveFreeBytes, message.instanceWorkingSetBytes];
        if (!values.every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0)) return;
        setResourceUsage({
          cpuPercent: message.cpuPercent as number,
          memoryUsedPercent: message.memoryUsedPercent as number,
          driveFreeBytes: message.driveFreeBytes as number,
          instanceWorkingSetBytes: message.instanceWorkingSetBytes as number
        });
        return;
      }
      if (message.type === "codex-control-room-state") {
        if (message.state && typeof message.state === "object") {
          const state = message.state as Partial<ControlRoomPersistentState>;
          const nextLayout = normalizeControlRoomLayout(state.layout);
          const storedMachines = readStoredMachines();
          const nextSlots = normalizeControlRoomSlots(state.slots, storedMachines, controlRoomScreenCount(nextLayout));
          const nextRegions = normalizeControlRoomRegions(state.regions, nextSlots, nextLayout);
          const nextPoweredOffSlotIds = normalizePoweredOffSlotIds(state.poweredOffSlotIds, nextSlots);
          const nextFrozenSlotIds = normalizePoweredOffSlotIds(state.frozenSlotIds, nextSlots);
          const nextViewModes = normalizeControlRoomViewModes(state.viewModes, nextSlots);
          const nextWorkspaceContexts = normalizeWorkspaceContexts(state.workspaceContexts, nextSlots);
          localStorage.setItem(storedLayoutKey, JSON.stringify(nextLayout));
          localStorage.setItem(storedSlotsKey, JSON.stringify(nextSlots));
          localStorage.setItem(storedRegionsKey, JSON.stringify(nextRegions));
          localStorage.setItem(storedPoweredOffSlotsKey, JSON.stringify(nextPoweredOffSlotIds));
          localStorage.setItem(storedFrozenSlotsKey, JSON.stringify(nextFrozenSlotIds));
          localStorage.setItem(storedViewModesKey, JSON.stringify(nextViewModes));
          localStorage.setItem(storedWorkspaceContextsKey, JSON.stringify(nextWorkspaceContexts));
          setLayout(nextLayout);
          setSlots(nextSlots);
          setRegions(nextRegions);
          setPoweredOffSlots(new Set(nextPoweredOffSlotIds));
          setFrozenSlots(new Set(nextFrozenSlotIds));
          const visibleMasterSlotIds = new Set(nextRegions.map((region) => region.masterSlotId));
          for (const slotId of nextFrozenSlotIds.filter((slotId) => visibleMasterSlotIds.has(slotId))) {
            window.chrome?.webview?.postMessage({ type: "codex-control-room-frozen-square-request", slotId });
          }
          setViewModes(nextViewModes);
          setWorkspaceContexts(nextWorkspaceContexts);
          if (typeof state.settingsOpen === "boolean") setSettingsOpen(state.settingsOpen);
          if (typeof state.farViewFocusEnabled === "boolean") setFarViewFocusEnabled(state.farViewFocusEnabled);
          if (typeof state.dashboardEditorOpen === "boolean") setDashboardEditorOpen(state.dashboardEditorOpen);
          if (state.dashboardDraft && typeof state.dashboardDraft === "object") {
            setDashboardDraft({ ...emptySavedDashboardDraft, ...state.dashboardDraft });
          }
        }
        nativeStateHydratedRef.current = true;
        setNativeStateHydrated(true);
        return;
      }
      if (message.type === "codex-control-room-window-state") {
        if (typeof message.fullscreen === "boolean") setFullscreen(message.fullscreen);
        return;
      }
      if (message.type === "codex-control-room-frozen-square") {
        if (typeof message.slotId !== "string") return;
        const slotId = message.slotId;
        const freezeTimeout = freezeTimeoutsRef.current[slotId];
        if (freezeTimeout) window.clearTimeout(freezeTimeout);
        delete freezeTimeoutsRef.current[slotId];
        setFreezingSlots((current) => {
          const next = new Set(current);
          next.delete(slotId);
          return next;
        });
        if (typeof message.dataUrl === "string" && message.dataUrl.startsWith("data:image/png;base64,")) {
          setPageFailures((current) => {
            if (!current[slotId]) return current;
            const next = { ...current };
            delete next[slotId];
            return next;
          });
          setFrozenImages((current) => ({ ...current, [slotId]: message.dataUrl as string }));
          setFrozenSlots((current) => {
            const next = new Set(current).add(slotId);
            localStorage.setItem(storedFrozenSlotsKey, JSON.stringify([...next]));
            return next;
          });
        } else if (typeof message.error === "string" && message.error) {
          setPageFailures((current) => ({ ...current, [slotId]: message.error as string }));
          setFrozenSlots((current) => {
            const next = new Set(current);
            next.delete(slotId);
            localStorage.setItem(storedFrozenSlotsKey, JSON.stringify([...next]));
            return next;
          });
        }
        return;
      }
      if (message.type === "codex-control-room-frame-state") {
        if (typeof message.slotId !== "string" || typeof message.failed !== "boolean") return;
        const slotId = message.slotId;
        const failed = message.failed;
        const detail = typeof message.detail === "string" ? message.detail : "Page did not load";
        setPageFailures((current) => {
          const next = { ...current };
          if (failed) next[slotId] = detail;
          else delete next[slotId];
          return next;
        });
        if (failed) setConnections((current) => ({ ...current, [slotId]: "offline" }));
        return;
      }
      if (message.type === "codex-control-room-dashboards") {
        if (Array.isArray(message.dashboards)) setSavedDashboards(normalizeSavedDashboards(message.dashboards));
        const matchesSave = typeof message.requestId === "string" && message.requestId === dashboardSavePendingRef.current;
        if (matchesSave && typeof message.error === "string" && message.error) {
          dashboardSavePendingRef.current = "";
          setDashboardError(message.error);
        } else if (matchesSave) {
          dashboardSavePendingRef.current = "";
          setDashboardError("");
          setDashboardEditorOpen(false);
        }
        return;
      }
      if (message.type !== "codex-control-room-profiles") return;
      if (typeof message.instanceId === "string" && typeof message.instanceName === "string") {
        setInstance({ id: message.instanceId, name: message.instanceName });
      }
      const nextMachines = normalizeControlRoomMachines(message.machines);
      if (!nextMachines.length) return;

      localStorage.setItem(storedProfilesKey, JSON.stringify(nextMachines));
      setMachines(nextMachines);
      setSlots((current) => {
        const nextMachineIds = new Set(nextMachines.map((machine) => machine.id));
        const next = current.map((slot) => ({
          ...slot,
          machineId: slot.customUrl || slot.machineId === "" || nextMachineIds.has(slot.machineId) ? slot.machineId : ""
        }));
        localStorage.setItem(storedSlotsKey, JSON.stringify(next));
        return next;
      });
      setConnections((current) =>
        Object.fromEntries(
          Object.entries(current).map(([slotId, connection]) => [slotId, connection === "unauthorized" ? "connecting" : connection])
        )
      );
    };

    const webview = window.chrome?.webview;
    webview?.addEventListener("message", receiveNativeMessage);
    webview?.postMessage({ type: "codex-control-room-profiles-request" } satisfies NativeProfilesRequest);
    webview?.postMessage({ type: "codex-control-room-dashboards-request" });
    return () => webview?.removeEventListener("message", receiveNativeMessage);
  }, [clearKeyboardFocus, focusKeyboardSlot, localControlToken, moveKeyboardFocus, restoreKeyboardFocus]);

  useEffect(() => {
    if (!keyboardFocusedSlotId || focusableSlotIds.includes(keyboardFocusedSlotId)) return;
    clearKeyboardFocus();
  }, [clearKeyboardFocus, focusableSlotIds, keyboardFocusedSlotId]);

  useLayoutEffect(() => {
    if (!farViewFocusEnabled || !keyboardFocusedSlotId) {
      setFarViewPopup(null);
      return;
    }

    const region = visibleRegions.find((candidate) => candidate.masterSlotId === keyboardFocusedSlotId);
    const grid = gridRef.current;
    if (!region || !grid) {
      setFarViewPopup(null);
      return;
    }

    const updatePopup = () => {
      const gridRect = grid.getBoundingClientRect();
      const gap = 4;
      const padding = 4;
      const innerWidth = Math.max(0, gridRect.width - (padding * 2));
      const cellWidth = (innerWidth - (gap * Math.max(0, layout.columns - 1))) / layout.columns;
      const sourceLeft = gridRect.left + padding + (region.column * (cellWidth + gap));
      const sourceWidth = (cellWidth * region.columnSpan) + (gap * Math.max(0, region.columnSpan - 1));
      const popupWidth = Math.min(sourceWidth * 2, window.innerWidth - (padding * 2));
      const popupLeft = Math.max(padding, Math.min(sourceLeft + (sourceWidth / 2) - (popupWidth / 2), window.innerWidth - popupWidth - padding));
      const popupTop = gridRect.top + 8;
      const popupHeight = Math.max(240, window.innerHeight - popupTop - 8);
      setFarViewPopup({
        slotId: keyboardFocusedSlotId,
        style: {
          left: `${popupLeft}px`,
          top: `${popupTop}px`,
          width: `${popupWidth}px`,
          height: `${popupHeight}px`
        }
      });
    };

    updatePopup();
    window.addEventListener("resize", updatePopup);
    return () => window.removeEventListener("resize", updatePopup);
  }, [farViewFocusEnabled, keyboardFocusedSlotId, layout.columns, visibleRegions]);

  useEffect(() => {
    const receiveKnobPress = (event: KeyboardEvent) => {
      controlPadPressedCodesRef.current.add(event.code);
      if (!event.ctrlKey || event.code !== "Digit1" || !controlPadPressedCodesRef.current.has("KeyB")) return;
      const slotId = keyboardFocusedSlotIdRef.current;
      if (!slotId) return;
      if (poweredOffSlots.has(slotId)) {
        event.preventDefault();
        event.stopPropagation();
        setSlotDisplay(slotId, true);
      } else if (frozenSlots.has(slotId)) {
        event.preventDefault();
        event.stopPropagation();
        clearFrozenSlot(slotId);
      }
    };
    const releaseControlPadKey = (event: KeyboardEvent) => controlPadPressedCodesRef.current.delete(event.code);
    const clearControlPadKeys = () => controlPadPressedCodesRef.current.clear();
    window.addEventListener("keydown", receiveKnobPress);
    window.addEventListener("keyup", releaseControlPadKey);
    window.addEventListener("blur", clearControlPadKeys);
    return () => {
      window.removeEventListener("keydown", receiveKnobPress);
      window.removeEventListener("keyup", releaseControlPadKey);
      window.removeEventListener("blur", clearControlPadKeys);
    };
  }, [frozenSlots, poweredOffSlots]);

  useEffect(() => {
    if (!keyboardFocusedSlotId || poweredOffSlots.has(keyboardFocusedSlotId) || frozenSlots.has(keyboardFocusedSlotId)) return;
    window.requestAnimationFrame(() => frameRefs.current[keyboardFocusedSlotId]?.focus());
  }, [frozenSlots, keyboardFocusedSlotId, poweredOffSlots]);

  useEffect(() => {
    const clearAfterWindowBlur = () => window.setTimeout(() => {
      if (!document.hasFocus()) clearKeyboardFocus();
    }, 0);
    window.addEventListener("blur", clearAfterWindowBlur);
    return () => window.removeEventListener("blur", clearAfterWindowBlur);
  }, [clearKeyboardFocus]);

  useEffect(() => () => {
    for (const timeout of Object.values(freezeTimeoutsRef.current)) window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    const webview = window.chrome?.webview;
    if (!webview || !nativeStateHydrated || !nativeStateHydratedRef.current) return;
    const state: ControlRoomPersistentState = {
      version: 1,
      layout,
      slots,
      regions,
      poweredOffSlotIds: Array.from(poweredOffSlots),
      frozenSlotIds: Array.from(frozenSlots),
      viewModes,
      workspaceContexts,
      settingsOpen,
      farViewFocusEnabled,
      dashboardEditorOpen,
      dashboardDraft
    };
    webview.postMessage({ type: "codex-control-room-state-save", state });
  }, [dashboardDraft, dashboardEditorOpen, farViewFocusEnabled, frozenSlots, layout, nativeStateHydrated, poweredOffSlots, regions, settingsOpen, slots, viewModes, workspaceContexts]);

  useEffect(() => {
    const syncBrowserFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", syncBrowserFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncBrowserFullscreen);
  }, []);

  useEffect(() => {
    const webview = window.chrome?.webview;
    if (!webview || !savedDashboards.length) return;
    for (const slot of slots) {
      if (!slot.dashboardId || !savedDashboards.some((dashboard) => dashboard.id === slot.dashboardId)) continue;
      webview.postMessage({
        type: "codex-control-room-dashboard-activate",
        slotId: slot.id,
        dashboardId: slot.dashboardId,
        url: slot.customUrl ?? ""
      });
    }
  }, [savedDashboards, slots]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      for (const slot of slots) {
        const connection = connections[slot.id];
        if (!connection || connection === "connecting") sendAuthentication(slot.id);
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [connections, sendAuthentication, slots]);

  useEffect(() => {
    if (!settingsOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSettingsOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [settingsOpen]);

  useEffect(() => {
    if (!movingSlotId) return;
    const cancelMoveOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMovingSlotId("");
    };
    window.addEventListener("keydown", cancelMoveOnEscape);
    return () => window.removeEventListener("keydown", cancelMoveOnEscape);
  }, [movingSlotId]);

  useEffect(() => {
    if (!arrangeMode) return;
    const cancelArrangeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (mergeSourceRegionId) setMergeSourceRegionId("");
      else setArrangeMode(false);
    };
    window.addEventListener("keydown", cancelArrangeOnEscape);
    return () => window.removeEventListener("keydown", cancelArrangeOnEscape);
  }, [arrangeMode, mergeSourceRegionId]);

  const scrollAllToBottom = useCallback(() => {
    for (const slot of slots) {
      const machine = machineById.get(slot.machineId);
      const frame = frameRefs.current[slot.id];
      if (!machine || !frame?.contentWindow || poweredOffSlots.has(slot.id)) continue;
      frame.contentWindow.postMessage({ type: "codex-control-room-scroll-bottom", slotId: slot.id }, new URL(machine.url).origin);
    }
  }, [machineById, poweredOffSlots, slots]);

  const toggleFullscreen = useCallback(() => {
    const enabled = !fullscreen;
    const webview = window.chrome?.webview;
    if (webview) {
      webview.postMessage({ type: "codex-control-room-fullscreen", enabled });
      return;
    }

    if (enabled) {
      void document.documentElement.requestFullscreen();
    } else if (document.fullscreenElement) {
      void document.exitFullscreen();
    }
  }, [fullscreen]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.ctrlKey && !event.altKey && !event.metaKey && event.key === "ArrowDown") {
        event.preventDefault();
        scrollAllToBottom();
      } else if (event.key === "F11") {
        event.preventDefault();
        toggleFullscreen();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [scrollAllToBottom, toggleFullscreen]);

  useEffect(() => {
    const receiveScrollRequest = (event: MessageEvent<unknown>) => {
      if (!event.data || typeof event.data !== "object") return;
      const message = event.data as Record<string, unknown>;
      if (message.type !== "codex-control-room-scroll-all-request" || typeof message.slotId !== "string") return;
      const slot = slots.find((candidate) => candidate.id === message.slotId);
      const machine = slot ? machineById.get(slot.machineId) : null;
      const frame = slot ? frameRefs.current[slot.id] : null;
      if (!machine || event.origin !== new URL(machine.url).origin || event.source !== frame?.contentWindow) return;
      scrollAllToBottom();
    };
    window.addEventListener("message", receiveScrollRequest);
    return () => window.removeEventListener("message", receiveScrollRequest);
  }, [machineById, scrollAllToBottom, slots]);

  function selectMachine(slotId: string, machineId: string) {
    clearFrozenSlot(slotId);
    delete authenticationAttemptAtRef.current[slotId];
    window.chrome?.webview?.postMessage({ type: "codex-control-room-dashboard-activate", slotId, dashboardId: "" });
    setSlots((current) => {
      const next = current.map((slot) => (slot.id === slotId ? { id: slot.id, machineId } : slot));
      localStorage.setItem(storedSlotsKey, JSON.stringify(next));
      return next;
    });
    setConnections((current) => ({ ...current, [slotId]: "connecting" }));
    setPageFailures((current) => {
      const next = { ...current };
      delete next[slotId];
      return next;
    });
    setServerNames((current) => {
      const next = { ...current };
      delete next[slotId];
      return next;
    });
    setWorkspaceContexts((current) => {
      if (!current[slotId]) return current;
      const next = { ...current };
      delete next[slotId];
      localStorage.setItem(storedWorkspaceContextsKey, JSON.stringify(next));
      return next;
    });
    setReloadKeys((current) => ({ ...current, [slotId]: (current[slotId] ?? 0) + 1 }));
  }

  function terminateSlot(slotId: string) {
    clearFrozenSlot(slotId);
    delete authenticationAttemptAtRef.current[slotId];
    window.chrome?.webview?.postMessage({ type: "codex-control-room-dashboard-activate", slotId, dashboardId: "" });
    setSlots((current) => {
      const next = current.map((slot) => (slot.id === slotId ? { id: slot.id, machineId: "" } : slot));
      localStorage.setItem(storedSlotsKey, JSON.stringify(next));
      return next;
    });
    setPoweredOffSlots((current) => {
      const next = new Set(current);
      next.delete(slotId);
      localStorage.setItem(storedPoweredOffSlotsKey, JSON.stringify([...next]));
      return next;
    });
    setConnections((current) => {
      const next = { ...current };
      delete next[slotId];
      return next;
    });
    setPageFailures((current) => {
      const next = { ...current };
      delete next[slotId];
      return next;
    });
    setServerNames((current) => {
      const next = { ...current };
      delete next[slotId];
      return next;
    });
    setWorkspaceContexts((current) => {
      if (!current[slotId]) return current;
      const next = { ...current };
      delete next[slotId];
      localStorage.setItem(storedWorkspaceContextsKey, JSON.stringify(next));
      return next;
    });
    setViewModes((current) => {
      const next = { ...current };
      delete next[slotId];
      localStorage.setItem(storedViewModesKey, JSON.stringify(next));
      return next;
    });
    setStartTokens((current) => {
      const next = { ...current };
      delete next[slotId];
      return next;
    });
  }

  function restartTerminatedSlot(slotId: string, machineId: string) {
    if (!machineById.has(machineId)) return;
    setStartTokens((current) => ({ ...current, [slotId]: `${Date.now()}-${Math.random().toString(16).slice(2)}` }));
    selectMachine(slotId, machineId);
  }

  function openCustomUrlEditor(slot: ControlRoomSlot) {
    setUrlEditorSlotId(slot.id);
    setCustomUrlDraft(slot.customUrl ?? "https://");
    setCustomUrlError("");
  }

  function closeCustomUrlEditor() {
    setUrlEditorSlotId("");
    setCustomUrlDraft("");
    setCustomUrlError("");
  }

  function activateCustomUrl(slotId: string, customUrl: string, dashboardId = "") {
    clearFrozenSlot(slotId);
    window.chrome?.webview?.postMessage({ type: "codex-control-room-dashboard-activate", slotId, dashboardId, url: customUrl });
    setSlots((current) => {
      const next = current.map((slot) => (slot.id === slotId ? { id: slot.id, machineId: "", customUrl, ...(dashboardId ? { dashboardId } : {}) } : slot));
      localStorage.setItem(storedSlotsKey, JSON.stringify(next));
      return next;
    });
    setPoweredOffSlots((current) => {
      const next = new Set(current);
      next.delete(slotId);
      localStorage.setItem(storedPoweredOffSlotsKey, JSON.stringify([...next]));
      return next;
    });
    setViewModes((current) => {
      const next = { ...current };
      delete next[slotId];
      localStorage.setItem(storedViewModesKey, JSON.stringify(next));
      return next;
    });
    setConnections((current) => ({ ...current, [slotId]: "connecting" }));
    setPageFailures((current) => {
      const next = { ...current };
      delete next[slotId];
      return next;
    });
    setWorkspaceContexts((current) => {
      if (!current[slotId]) return current;
      const next = { ...current };
      delete next[slotId];
      localStorage.setItem(storedWorkspaceContextsKey, JSON.stringify(next));
      return next;
    });
    setReloadKeys((current) => ({ ...current, [slotId]: (current[slotId] ?? 0) + 1 }));
  }

  function loadCustomUrl(slotId: string) {
    const customUrl = normalizeControlRoomCustomUrl(customUrlDraft);
    if (!customUrl) {
      setCustomUrlError("Enter a valid website address");
      return;
    }
    activateCustomUrl(slotId, customUrl);
    closeCustomUrlEditor();
  }

  function launchSavedDashboard(slotId: string, dashboardId: string) {
    const dashboard = savedDashboards.find((candidate) => candidate.id === dashboardId);
    if (!dashboard) return;
    activateCustomUrl(slotId, dashboard.url, dashboardId);
  }

  function openSavedDashboardEditor(dashboard?: SavedDashboard) {
    setDashboardError("");
    setDashboardDraft(dashboard ? {
      id: dashboard.id,
      name: dashboard.name,
      url: dashboard.url,
      credentialMode: dashboard.credentialMode,
      username: "",
      password: "",
      autoSubmit: dashboard.autoSubmit
    } : { ...emptySavedDashboardDraft });
    setDashboardEditorOpen(true);
  }

  function saveDashboard() {
    const name = dashboardDraft.name.trim();
    const url = normalizeControlRoomCustomUrl(dashboardDraft.url);
    if (!name) {
      setDashboardError("Enter a dashboard name");
      return;
    }
    if (!url) {
      setDashboardError("Enter a valid website address");
      return;
    }
    if (!window.chrome?.webview) {
      setDashboardError("Saved credentials require the Windows Control Room app");
      return;
    }
    const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    dashboardSavePendingRef.current = requestId;
    window.chrome.webview.postMessage({
      type: "codex-control-room-dashboard-save",
      requestId,
      dashboard: { ...dashboardDraft, name, url }
    });
  }

  function deleteDashboard(dashboard: SavedDashboard) {
    if (!window.confirm(`Delete saved dashboard “${dashboard.name}”?`)) return;
    window.chrome?.webview?.postMessage({ type: "codex-control-room-dashboard-delete", dashboardId: dashboard.id });
  }

  function reloadSlot(slotId: string) {
    delete authenticationAttemptAtRef.current[slotId];
    setConnections((current) => ({ ...current, [slotId]: "connecting" }));
    setPageFailures((current) => {
      const next = { ...current };
      delete next[slotId];
      return next;
    });
    setReloadKeys((current) => ({ ...current, [slotId]: (current[slotId] ?? 0) + 1 }));
  }

  function setSlotViewMode(slotId: string, mode: ControlRoomViewMode) {
    delete authenticationAttemptAtRef.current[slotId];
    setViewModes((current) => {
      const next = { ...current, [slotId]: mode };
      localStorage.setItem(storedViewModesKey, JSON.stringify(next));
      return next;
    });
    setConnections((current) => ({ ...current, [slotId]: "connecting" }));
  }

  function setSlotDisplay(slotId: string, poweredOn: boolean) {
    if (!poweredOn) clearFrozenSlot(slotId);
    setPoweredOffSlots((current) => {
      const next = new Set(current);
      if (poweredOn) next.delete(slotId);
      else next.add(slotId);
      localStorage.setItem(storedPoweredOffSlotsKey, JSON.stringify([...next]));
      return next;
    });

  }

  function clearFrozenSlot(slotId: string) {
    const freezeTimeout = freezeTimeoutsRef.current[slotId];
    if (freezeTimeout) window.clearTimeout(freezeTimeout);
    delete freezeTimeoutsRef.current[slotId];
    setFreezingSlots((current) => {
      if (!current.has(slotId)) return current;
      const next = new Set(current);
      next.delete(slotId);
      return next;
    });
    window.chrome?.webview?.postMessage({ type: "codex-control-room-frozen-square-delete", slotId });
    setFrozenSlots((current) => {
      if (!current.has(slotId)) return current;
      const next = new Set(current);
      next.delete(slotId);
      localStorage.setItem(storedFrozenSlotsKey, JSON.stringify([...next]));
      return next;
    });
    setFrozenImages((current) => {
      if (!current[slotId]) return current;
      const next = { ...current };
      delete next[slotId];
      return next;
    });
  }

  function freezeSlot(slotId: string) {
    const webview = window.chrome?.webview;
    const tile = tileRefs.current[slotId];
    if (!webview || !tile || freezingSlots.has(slotId)) return;
    const rect = tile.getBoundingClientRect();
    setPageFailures((current) => {
      if (!current[slotId]) return current;
      const next = { ...current };
      delete next[slotId];
      return next;
    });
    setFreezingSlots((current) => new Set(current).add(slotId));
    freezeTimeoutsRef.current[slotId] = window.setTimeout(() => {
      delete freezeTimeoutsRef.current[slotId];
      setFreezingSlots((current) => {
        const next = new Set(current);
        next.delete(slotId);
        return next;
      });
      setPageFailures((current) => ({ ...current, [slotId]: "Screenshot capture timed out. Try freezing the square again." }));
    }, freezeCaptureTimeoutMs);
    webview.postMessage({
      type: "codex-control-room-frozen-square-capture",
      slotId,
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height
    });
  }

  function saveRegions(next: ControlRoomRegion[]) {
    localStorage.setItem(storedRegionsKey, JSON.stringify(next));
    setRegions(next);
  }

  function enterArrangeMode() {
    setMovingSlotId("");
    setMergeSourceRegionId("");
    setArrangeMode(true);
    setSettingsOpen(false);
  }

  function exitArrangeMode() {
    setMergeSourceRegionId("");
    setArrangeMode(false);
  }

  function beginRegionMerge(regionId: string) {
    setMergeSourceRegionId((current) => current === regionId ? "" : regionId);
  }

  function finishRegionMerge(targetRegionId: string) {
    if (!mergeSourceRegionId || mergeSourceRegionId === targetRegionId) {
      setMergeSourceRegionId("");
      return;
    }
    const next = mergeControlRoomRegions(regions, mergeSourceRegionId, targetRegionId);
    if (next !== regions) saveRegions(next);
    setMergeSourceRegionId("");
  }

  function splitRegion(regionId: string, direction: ControlRoomSplitDirection) {
    const next = splitControlRoomRegion(regions, regionId, direction, slots, layout);
    if (next !== regions) saveRegions(next);
    setMergeSourceRegionId("");
  }

  function beginMoveSlot(slotId: string) {
    closeCustomUrlEditor();
    setSettingsOpen(false);
    setArrangeMode(false);
    setMergeSourceRegionId("");
    setMovingSlotId(slotId);
  }

  function finishMoveSlot(targetSlotId: string) {
    if (!movingSlotId || targetSlotId === movingSlotId) {
      setMovingSlotId("");
      return;
    }
    setSlots((current) => {
      const next = swapControlRoomSlots(current, movingSlotId, targetSlotId);
      localStorage.setItem(storedSlotsKey, JSON.stringify(next));
      return next;
    });
    setRegions((current) => {
      const next = current.map((region) => ({
        ...region,
        masterSlotId: region.masterSlotId === movingSlotId
          ? targetSlotId
          : region.masterSlotId === targetSlotId
            ? movingSlotId
            : region.masterSlotId
      }));
      localStorage.setItem(storedRegionsKey, JSON.stringify(next));
      return next;
    });
    setMovingSlotId("");
  }

  function applyLayout(nextLayout: ControlRoomLayout) {
    const normalizedLayout = normalizeControlRoomLayout(nextLayout);
    if (normalizedLayout.columns === layout.columns && normalizedLayout.rows === layout.rows) return;
    if (hasMergedRegions && (normalizedLayout.columns !== layout.columns || normalizedLayout.rows !== layout.rows)) return;
    const nextCount = controlRoomScreenCount(normalizedLayout);
    const nextSlots = resizeControlRoomSlots(slots, nextCount, machines);
    const nextSlotIds = new Set(nextSlots.map((slot) => slot.id));

    setLayout(normalizedLayout);
    localStorage.setItem(storedLayoutKey, JSON.stringify(normalizedLayout));

    setSlots(nextSlots);
    localStorage.setItem(storedSlotsKey, JSON.stringify(nextSlots));
    const nextRegions = createControlRoomRegions(nextSlots, normalizedLayout);
    setRegions(nextRegions);
    localStorage.setItem(storedRegionsKey, JSON.stringify(nextRegions));
    setMovingSlotId("");

    setPoweredOffSlots((current) => {
      const next = new Set([...current].filter((slotId) => nextSlotIds.has(slotId)));
      localStorage.setItem(storedPoweredOffSlotsKey, JSON.stringify([...next]));
      return next;
    });
    setFrozenSlots((current) => {
      const removed = [...current].filter((slotId) => !nextSlotIds.has(slotId));
      for (const slotId of removed) window.chrome?.webview?.postMessage({ type: "codex-control-room-frozen-square-delete", slotId });
      const next = new Set([...current].filter((slotId) => nextSlotIds.has(slotId)));
      localStorage.setItem(storedFrozenSlotsKey, JSON.stringify([...next]));
      return next;
    });
    setConnections((current) => Object.fromEntries(Object.entries(current).filter(([slotId]) => nextSlotIds.has(slotId))));
    setPageFailures((current) => Object.fromEntries(Object.entries(current).filter(([slotId]) => nextSlotIds.has(slotId))));
    setServerNames((current) => Object.fromEntries(Object.entries(current).filter(([slotId]) => nextSlotIds.has(slotId))));
    setReloadKeys((current) => Object.fromEntries(Object.entries(current).filter(([slotId]) => nextSlotIds.has(slotId))));
    setStartTokens((current) => Object.fromEntries(Object.entries(current).filter(([slotId]) => nextSlotIds.has(slotId))));
    setWorkspaceContexts((current) => {
      const next = Object.fromEntries(Object.entries(current).filter(([slotId]) => nextSlotIds.has(slotId)));
      localStorage.setItem(storedWorkspaceContextsKey, JSON.stringify(next));
      return next;
    });
    setViewModes((current) => {
      const next = Object.fromEntries(Object.entries(current).filter(([slotId]) => nextSlotIds.has(slotId)));
      localStorage.setItem(storedViewModesKey, JSON.stringify(next));
      return next;
    });
  }

  return (
    <main
      className={`control-room-shell${movingSlotId ? " is-moving-square" : ""}${arrangeMode ? " is-arranging" : ""}${keyboardFocusedSlotId ? " has-knob-focus" : ""}`}
      onPointerMove={keyboardFocusedSlotId ? clearKeyboardFocus : undefined}
      onPointerDownCapture={(event) => {
        const tile = (event.target as Element).closest<HTMLElement>("[data-control-room-slot-id]");
        const slotId = tile?.dataset.controlRoomSlotId;
        if (slotId) rememberActiveSlot(slotId);
      }}
    >
      <header className="control-room-header">
        <button
          className={`control-room-settings${settingsOpen ? " is-open" : ""}`}
          type="button"
          aria-label="Screen layout settings"
          aria-expanded={settingsOpen}
          aria-controls="control-room-layout-settings"
          title="Screen layout"
          onClick={() => setSettingsOpen((current) => !current)}
        >
          <Settings2 size={17} />
        </button>
        <div className="control-room-brand">
          <span className="control-room-mark"><MonitorCog size={17} /></span>
          <strong>Codex Control Room</strong>
          {instance.id !== "default" && instance.name && (
            <span className="control-room-instance" title={`Independent instance: ${instance.name}`}>{instance.name}</span>
          )}
          <span className="control-room-workspace-count">{visibleRegions.length} workspaces</span>
          {resourceUsage && (
            <div
              className="control-room-host-metrics"
              aria-label={`Host CPU ${formatResourcePercent(resourceUsage.cpuPercent)}, RAM ${formatResourcePercent(resourceUsage.memoryUsedPercent)}, C drive ${formatResourceBytes(resourceUsage.driveFreeBytes)} free, this Control Room ${formatResourceBytes(resourceUsage.instanceWorkingSetBytes)}`}
            >
              <span className={resourceMetricTone("cpu", resourceUsage.cpuPercent)} title="Host CPU usage"><small>CPU</small><strong>{formatResourcePercent(resourceUsage.cpuPercent)}</strong></span>
              <span className={resourceMetricTone("memory", resourceUsage.memoryUsedPercent)} title="Host RAM used"><small>RAM</small><strong>{formatResourcePercent(resourceUsage.memoryUsedPercent)}</strong></span>
              <span className={resourceMetricTone("disk", resourceUsage.driveFreeBytes)} title="Free space on C drive"><small>C FREE</small><strong>{formatResourceBytes(resourceUsage.driveFreeBytes)}</strong></span>
              <span title="RAM used by this Control Room instance"><small>ROOM RAM</small><strong>{formatResourceBytes(resourceUsage.instanceWorkingSetBytes)}</strong></span>
            </div>
          )}
        </div>
        {arrangeMode ? (
          <button className="control-room-arrange-done" type="button" onClick={exitArrangeMode}>
            <Combine size={14} />
            <span><strong>ARRANGE MODE</strong><small>{mergeSourceRegionId ? "Choose a glowing neighbor · Esc cancels" : "Merge or split squares · Esc exits"}</small></span>
            <b>DONE</b>
          </button>
        ) : (
          <div className="control-room-health" aria-label={`${onlineCount} of ${activeCount} active workspaces online; ${customUrlCount} custom dashboards; ${poweredOffCount} displays off; ${terminatedCount} terminated`}>
            <span className={activeCount > 0 && onlineCount === activeCount ? "is-all-online" : ""} />
            <strong>{onlineCount}</strong>
            <span>/ {activeCount} live</span>
            {poweredOffCount > 0 && <span className="control-room-standby-count">· {poweredOffCount} off</span>}
            {customUrlCount > 0 && <span className="control-room-standby-count">· {customUrlCount} custom</span>}
            {terminatedCount > 0 && <span className="control-room-standby-count">· {terminatedCount} terminated</span>}
          </div>
        )}
      </header>

      {settingsOpen && (
        <aside
          className="control-room-settings-panel"
          id="control-room-layout-settings"
          role="dialog"
          aria-labelledby="control-room-layout-title"
        >
          <div className="control-room-settings-heading">
            <div>
              <span>DISPLAY MATRIX</span>
              <strong id="control-room-layout-title">Screen layout</strong>
            </div>
            <button type="button" onClick={() => setSettingsOpen(false)} aria-label="Close screen layout settings" title="Close">
              <X size={14} />
            </button>
          </div>

          <fieldset className="control-room-layout-fieldset">
            <legend>Columns</legend>
            <div className="control-room-layout-options is-columns">
              {controlRoomColumnOptions.map((columns) => (
                <button
                  type="button"
                  key={columns}
                  aria-pressed={layout.columns === columns}
                  disabled={hasMergedRegions && layout.columns !== columns}
                  title={hasMergedRegions && layout.columns !== columns ? "Split merged squares before changing the grid" : undefined}
                  onClick={() => applyLayout({ ...layout, columns })}
                >
                  {columns}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="control-room-layout-fieldset">
            <legend>Rows</legend>
            <div className="control-room-layout-options is-rows">
              {controlRoomRowOptions.map((rows) => (
                <button
                  type="button"
                  key={rows}
                  aria-pressed={layout.rows === rows}
                  disabled={hasMergedRegions && layout.rows !== rows}
                  title={hasMergedRegions && layout.rows !== rows ? "Split merged squares before changing the grid" : undefined}
                  onClick={() => applyLayout({ ...layout, rows })}
                >
                  {rows}
                </button>
              ))}
            </div>
          </fieldset>

          {hasMergedRegions && <p className="control-room-layout-lock"><Combine size={12} /> Split merged squares before changing rows or columns.</p>}

          <button className="control-room-arrange-launch" type="button" onClick={enterArrangeMode}>
            <Combine size={16} />
            <span><strong>Merge or split squares</strong><small>Lossless layout editing · parked squares stay saved</small></span>
          </button>

          <button
            className="control-room-far-view"
            type="button"
            aria-pressed={farViewFocusEnabled}
            onClick={() => setFarViewFocusEnabled((current) => !current)}
          >
            <ScanSearch size={16} />
            <span>
              <strong>Far view focus</strong>
              <small>Focused square · 2× width · 140% zoom</small>
            </span>
          </button>

          <section className="control-room-saved-dashboards" aria-labelledby="saved-dashboards-title">
            <div className="control-room-saved-dashboards-heading">
              <div>
                <span>DASHBOARD VAULT</span>
                <strong id="saved-dashboards-title">Saved dashboards</strong>
              </div>
              {!dashboardEditorOpen && (
                <button type="button" onClick={() => openSavedDashboardEditor()} aria-label="Add saved dashboard" title="Add dashboard"><Plus size={14} /></button>
              )}
            </div>
            {dashboardEditorOpen ? (
              <SavedDashboardEditor
                draft={dashboardDraft}
                error={dashboardError}
                onChange={(draft) => { setDashboardDraft(draft); setDashboardError(""); }}
                onSave={saveDashboard}
                onCancel={() => { dashboardSavePendingRef.current = ""; setDashboardEditorOpen(false); setDashboardError(""); }}
              />
            ) : savedDashboards.length ? (
              <div className="control-room-saved-dashboard-list">
                {savedDashboards.map((dashboard) => (
                  <div className="control-room-saved-dashboard-row" key={dashboard.id}>
                    <button type="button" onClick={() => openSavedDashboardEditor(dashboard)} title={`Edit ${dashboard.name}`}>
                      <LayoutDashboard size={14} />
                      <span><strong>{dashboard.name}</strong><small>{new URL(dashboard.url).hostname}</small></span>
                      {dashboard.hasCredentials && <KeyRound size={11} aria-label="Credentials saved" />}
                    </button>
                    <button type="button" onClick={() => deleteDashboard(dashboard)} aria-label={`Delete ${dashboard.name}`} title="Delete dashboard"><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
            ) : (
              <button className="control-room-saved-dashboard-empty" type="button" onClick={() => openSavedDashboardEditor()}>
                <LayoutDashboard size={16} />
                <span><strong>Save your first dashboard</strong><small>URLs and encrypted sign-in details</small></span>
              </button>
            )}
          </section>

          <button className="control-room-scroll-all" type="button" onClick={scrollAllToBottom}>
            <ArrowDownToLine size={16} />
            <span><strong>Scroll every window to bottom</strong><small>Ctrl + ↓</small></span>
          </button>

          <button
            className="control-room-fullscreen"
            type="button"
            aria-pressed={fullscreen}
            onClick={toggleFullscreen}
          >
            {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            <span>
              <strong>{fullscreen ? "Exit fullscreen" : "Fullscreen"}</strong>
              <small>F11 · fills this display</small>
            </span>
          </button>

          <div className="control-room-layout-total" aria-live="polite">
            <strong>{controlRoomScreenCount(layout)}</strong>
            <span>screens</span>
            <small>{layout.columns} columns × {layout.rows} {layout.rows === 1 ? "row" : "rows"}</small>
          </div>
        </aside>
      )}

      <section
        className="control-room-grid"
        ref={gridRef}
        aria-label="Codex remote workspaces"
        style={{
          gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))`
        }}
      >
        {visibleRegions.map((region) => {
          const slot = slotById.get(region.masterSlotId);
          if (!slot) return null;
          const index = region.row * layout.columns + region.column;
          const regionStyle = {
            gridColumn: `${region.column + 1} / span ${region.columnSpan}`,
            gridRow: `${region.row + 1} / span ${region.rowSpan}`
          };
          const mergeSourceRegion = mergeSourceRegionId ? regions.find((candidate) => candidate.id === mergeSourceRegionId) : undefined;
          const isMergeSource = mergeSourceRegionId === region.id;
          const isMergeTarget = Boolean(mergeSourceRegion && !isMergeSource && canMergeControlRoomRegions(mergeSourceRegion, region));
          const hasMergeCandidate = regions.some((candidate) => candidate.id !== region.id && canMergeControlRoomRegions(region, candidate));
          const machine = machineById.get(slot.machineId);
          const customUrl = slot.customUrl ?? "";
          const isCustomUrl = Boolean(customUrl);
          const connection = connections[slot.id] ?? "connecting";
          const isPoweredOff = poweredOffSlots.has(slot.id);
          const isFrozen = frozenSlots.has(slot.id);
          const isKeyboardFocused = keyboardFocusedSlotId === slot.id;
          const isFarViewFocused = farViewFocusEnabled && isKeyboardFocused && farViewPopup?.slotId === slot.id;
          const tileStyle: CSSProperties = isFarViewFocused ? { ...regionStyle, ...farViewPopup.style } : regionStyle;
          const pageFailure = pageFailures[slot.id] ?? "";
          const viewMode = viewModes[slot.id] ?? "chat";
          const urlEditorOpen = urlEditorSlotId === slot.id;
          const isMoveSource = movingSlotId === slot.id;
          const isMoveTarget = Boolean(movingSlotId) && !isMoveSource;
          const arrangeOverlay = arrangeMode ? (
            <div className={`control-room-arrange-overlay${isMergeSource ? " is-source" : ""}${isMergeTarget ? " is-target" : ""}${mergeSourceRegionId && !isMergeSource && !isMergeTarget ? " is-incompatible" : ""}`}>
              <div className="control-room-arrange-actions">
                {!mergeSourceRegionId ? (
                  <button type="button" onClick={() => beginRegionMerge(region.id)} disabled={!hasMergeCandidate}>
                    <Combine size={18} />
                    <span><strong>{hasMergeCandidate ? "MERGE FROM HERE" : "NO ADJACENT MATCH"}</strong><small>{hasMergeCandidate ? "Then choose a glowing neighbor" : "Needs an equal edge"}</small></span>
                  </button>
                ) : isMergeSource ? (
                  <button type="button" onClick={() => setMergeSourceRegionId("")}>
                    <X size={18} />
                    <span><strong>MERGE SOURCE</strong><small>Click to cancel selection</small></span>
                  </button>
                ) : isMergeTarget ? (
                  <button type="button" onClick={() => finishRegionMerge(region.id)}>
                    <Combine size={18} />
                    <span><strong>MERGE HERE</strong><small>Source content remains visible</small></span>
                  </button>
                ) : (
                  <button type="button" disabled>
                    <Combine size={18} />
                    <span><strong>NOT COMPATIBLE</strong><small>Edges must align exactly</small></span>
                  </button>
                )}
                {!mergeSourceRegionId && region.columnSpan > 1 && (
                  <button type="button" onClick={() => splitRegion(region.id, "vertical")}>
                    <Columns2 size={18} />
                    <span><strong>SPLIT VERTICALLY</strong><small>Creates left and right squares</small></span>
                  </button>
                )}
                {!mergeSourceRegionId && region.rowSpan > 1 && (
                  <button type="button" onClick={() => splitRegion(region.id, "horizontal")}>
                    <Rows2 size={18} />
                    <span><strong>SPLIT HORIZONTALLY</strong><small>Creates top and bottom squares</small></span>
                  </button>
                )}
              </div>
              <span className="control-room-arrange-size">{region.columnSpan} × {region.rowSpan} CELLS · {region.columnSpan * region.rowSpan - 1} PARKED</span>
            </div>
          ) : null;
          if (!machine && !isCustomUrl) {
            return (
              <article
                className={`control-room-tile is-terminated${isKeyboardFocused ? " is-knob-focused" : ""}${isFarViewFocused ? " is-far-view-focused" : ""}${isMoveSource ? " is-move-source" : ""}${isMoveTarget ? " is-move-target" : ""}${arrangeMode ? " is-arrange-ready" : ""}${isMergeSource ? " is-merge-source" : ""}${isMergeTarget ? " is-merge-target" : ""}`}
                key={region.id}
                data-control-room-slot-id={slot.id}
                style={tileStyle}
                tabIndex={-1}
                ref={(node) => { tileRefs.current[slot.id] = node; }}
              >
                <span className="control-room-terminated-index">{String(index + 1).padStart(2, "0")}</span>
                {!movingSlotId && (
                  <button className="control-room-move-trigger is-terminated-trigger" type="button" onClick={() => beginMoveSlot(slot.id)} aria-label={`Move workspace ${index + 1}`} title="Move square">
                    <ArrowLeftRight size={13} />
                  </button>
                )}
                <div className="control-room-terminated-content" inert={Boolean(movingSlotId) || arrangeMode}>
                  <SquareX size={22} />
                  <strong>TERMINATED</strong>
                  <span>No machine or chat is running</span>
                  <label className="control-room-saved-dashboard-select">
                    <span className="sr-only">Open a saved dashboard in workspace {index + 1}</span>
                    <select value="" disabled={!savedDashboards.length} onChange={(event) => launchSavedDashboard(slot.id, event.target.value)}>
                      <option value="" disabled>{savedDashboards.length ? "Open saved dashboard" : "No saved dashboards"}</option>
                      {savedDashboards.map((dashboard) => <option key={dashboard.id} value={dashboard.id}>{dashboard.name}</option>)}
                    </select>
                    <LayoutDashboard size={13} aria-hidden="true" />
                  </label>
                  <label>
                    <span className="sr-only">Select a machine to start workspace {index + 1}</span>
                    <select value="" onChange={(event) => restartTerminatedSlot(slot.id, event.target.value)}>
                      <option value="" disabled>Select machine to start</option>
                      {machines.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
                    </select>
                    <Play size={12} aria-hidden="true" />
                  </label>
                  <button className="control-room-custom-url-launch" type="button" onClick={() => openCustomUrlEditor(slot)}>
                    <Link2 size={13} /> Load custom URL
                  </button>
                </div>
                {urlEditorOpen && (
                  <CustomUrlEditor
                    slotNumber={index + 1}
                    value={customUrlDraft}
                    error={customUrlError}
                    onChange={(value) => { setCustomUrlDraft(value); setCustomUrlError(""); }}
                    onSubmit={() => loadCustomUrl(slot.id)}
                    onCancel={closeCustomUrlEditor}
                  />
                )}
                {isKeyboardFocused && <KnobFocusOverlay index={index} terminated />}
                {arrangeOverlay}
                {movingSlotId && (
                  <button className="control-room-move-destination" type="button" onClick={() => finishMoveSlot(slot.id)}>
                    <ArrowLeftRight size={20} />
                    <strong>{isMoveSource ? "MOVING THIS SQUARE" : `SWITCH WITH ${String(index + 1).padStart(2, "0")}`}</strong>
                    <span>{isMoveSource ? "Click here or press Esc to cancel" : "Click to move here"}</span>
                  </button>
                )}
              </article>
            );
          }

          const savedDashboard = slot.dashboardId ? savedDashboards.find((dashboard) => dashboard.id === slot.dashboardId) : undefined;
          const tileUrl = isCustomUrl ? customUrl : controlRoomTileUrl(machine!, slot.id, window.location.origin, viewMode, startTokens[slot.id]);
          const tileLabel = isCustomUrl ? savedDashboard?.name || new URL(customUrl).hostname : machine!.name;
          const workspaceContext = workspaceContexts[slot.id];
          const chatProjectName = workspaceContext?.projectName.trim();
          const chatTitle = workspaceContext?.chatTitle.trim();
          const customUrlHost = isCustomUrl ? new URL(customUrl).hostname : "";
          const customUrlPath = isCustomUrl ? new URL(customUrl).pathname.replace(/\/$/, "") : "";
          const poweredOffPrimary = isCustomUrl
            ? tileLabel
            : viewMode === "tracker"
              ? machine!.name
              : chatProjectName || "";
          const poweredOffSecondary = isCustomUrl
            ? "Saved dashboard"
            : viewMode === "tracker"
              ? "Live summary tracker"
              : chatTitle || "";
          const poweredOffTertiary = isCustomUrl
            ? [customUrlHost, customUrlPath].filter(Boolean).join("")
            : viewMode === "chat"
              ? machine!.name
              : serverNames[slot.id] || machine!.name;
          return (
            <article
              className={`control-room-tile is-${connection}${isCustomUrl ? " is-custom-url" : ""}${isPoweredOff ? " is-powered-off" : ""}${isFrozen ? " is-frozen" : ""}${pageFailure ? " is-page-failed" : ""}${completionGlows[slot.id] ? " is-task-complete" : ""}${isKeyboardFocused ? " is-knob-focused" : ""}${isFarViewFocused ? " is-far-view-focused" : ""}${isMoveSource ? " is-move-source" : ""}${isMoveTarget ? " is-move-target" : ""}${arrangeMode ? " is-arrange-ready" : ""}${isMergeSource ? " is-merge-source" : ""}${isMergeTarget ? " is-merge-target" : ""}`}
              key={region.id}
              data-control-room-slot-id={slot.id}
              style={tileStyle}
              tabIndex={-1}
              ref={(node) => { tileRefs.current[slot.id] = node; }}
            >
              <div className="control-room-live-surface" aria-hidden={isPoweredOff || isFrozen || Boolean(movingSlotId) || arrangeMode} inert={isPoweredOff || isFrozen || Boolean(movingSlotId) || arrangeMode}>
                <div className="control-room-tilebar">
                  <span className="control-room-index">{String(index + 1).padStart(2, "0")}</span>
                  <label>
                    <span className="sr-only">Machine for workspace {index + 1}</span>
                    <select value={isCustomUrl ? "__custom__" : slot.machineId} onChange={(event) => selectMachine(slot.id, event.target.value)}>
                      {isCustomUrl && <option value="__custom__">{savedDashboard?.name || "Custom URL"}</option>}
                      {machines.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
                    </select>
                  </label>
                  <span className="control-room-server-name">{isCustomUrl ? tileLabel : serverNames[slot.id] || machine!.name}</span>
                  <span className="control-room-connection" title={isCustomUrl ? "Custom dashboard" : connectionLabel(connection)}>
                    {isCustomUrl ? <Globe2 size={13} /> : connection === "connecting" ? <Loader2 className="spin" size={13} /> : connection === "online" ? <Wifi size={13} /> : <WifiOff size={13} />}
                    {isCustomUrl ? "Dashboard" : connectionLabel(connection)}
                  </span>
                  {!isCustomUrl && (
                    <button
                      className={`control-room-mode-toggle${viewMode === "tracker" ? " is-tracker" : ""}`}
                      type="button"
                      onClick={() => setSlotViewMode(slot.id, viewMode === "tracker" ? "chat" : "tracker")}
                      aria-label={`${viewMode === "tracker" ? "Show full chat" : "Show live machine tracker"} in workspace ${index + 1}`}
                      title={viewMode === "tracker" ? "Show full chat" : "Show live machine tracker"}
                    >
                      {viewMode === "tracker" ? <MessageSquare size={13} /> : <Activity size={13} />}
                    </button>
                  )}
                  <button className="control-room-move-trigger" type="button" onClick={() => beginMoveSlot(slot.id)} aria-label={`Move workspace ${index + 1}`} title="Move square">
                    <ArrowLeftRight size={13} />
                  </button>
                  <button type="button" onClick={() => openCustomUrlEditor(slot)} aria-label={`Load custom URL in workspace ${index + 1}`} title="Load custom URL">
                    <Link2 size={13} />
                  </button>
                  <button type="button" onClick={() => reloadSlot(slot.id)} aria-label={`Reload workspace ${index + 1}`} title="Reload workspace">
                    <RefreshCw size={13} />
                  </button>
                  <button type="button" onClick={() => freezeSlot(slot.id)} disabled={!window.chrome?.webview || freezingSlots.has(slot.id)} aria-label={`Freeze workspace ${index + 1} as a screenshot`} title="Freeze as screenshot (zero live resources)">
                    {freezingSlots.has(slot.id) ? <Loader2 className="spin" size={13} /> : <Camera size={13} />}
                  </button>
                  <button type="button" onClick={() => setSlotDisplay(slot.id, false)} aria-label={`Turn off display for workspace ${index + 1}`} title="Turn display off">
                    <Power size={13} />
                  </button>
                  <button className="control-room-terminate" type="button" onClick={() => terminateSlot(slot.id)} aria-label={`Terminate workspace ${index + 1}`} title="Terminate workspace">
                    <SquareX size={13} />
                  </button>
                  <a href={tileUrl} target="_blank" rel="noreferrer" aria-label={`Open ${tileLabel} separately`} title="Open separately">
                    <ExternalLink size={13} />
                  </a>
                </div>
                {!isPoweredOff && !isFrozen && nativeStateHydrated && (
                  <iframe
                    key={`${slot.id}-${viewMode}-${reloadKeys[slot.id] ?? 0}`}
                    ref={(node) => { frameRefs.current[slot.id] = node; }}
                    src={tileUrl}
                    name={slot.id}
                    title={`Workspace ${index + 1} — ${tileLabel}`}
                    onFocus={() => rememberActiveSlot(slot.id)}
                    onLoad={() => {
                      setConnections((current) => ({ ...current, [slot.id]: isCustomUrl ? "online" : "connecting" }));
                      if (!isCustomUrl) window.setTimeout(() => sendAuthentication(slot.id), 150);
                    }}
                    onError={() => {
                      setConnections((current) => ({ ...current, [slot.id]: "offline" }));
                      setPageFailures((current) => ({ ...current, [slot.id]: "Page did not load" }));
                    }}
                    allow="clipboard-read; clipboard-write; microphone"
                  />
                )}
              </div>
              {isKeyboardFocused && (
                <KnobFocusOverlay index={index} />
              )}
              {isFrozen && !movingSlotId && (
                <button className="control-room-frozen" type="button" onClick={() => clearFrozenSlot(slot.id)} aria-label={`Resume frozen workspace ${index + 1}`} title="Resume live workspace">
                  {frozenImages[slot.id] ? <img src={frozenImages[slot.id]} alt="" /> : <span className="control-room-frozen-loading"><Loader2 className="spin" size={22} /> Loading frozen screenshot</span>}
                  <span className="control-room-frozen-label"><Camera size={14} /> FROZEN · CLICK TO RESUME</span>
                </button>
              )}
              {pageFailure && !isPoweredOff && !movingSlotId && (
                <section className="control-room-page-failure" aria-live="polite">
                  <span className="control-room-page-failure-mark"><WifiOff size={20} /></span>
                  <span className="control-room-page-failure-status">PAGE UNAVAILABLE</span>
                  <strong>{tileLabel} didn’t load</strong>
                  <small>{pageFailure}</small>
                  <div className="control-room-page-failure-actions">
                    <button type="button" onClick={() => reloadSlot(slot.id)}><RefreshCw size={13} /> Retry</button>
                    <a href={tileUrl} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Browser</a>
                  </div>
                </section>
              )}
              {completionGlows[slot.id] && !movingSlotId && (
                <button
                  className="control-room-completion-dismiss"
                  type="button"
                  onPointerDown={() => dismissCompletionGlow(slot.id)}
                  aria-label={`Dismiss completed task glow for workspace ${index + 1}`}
                  title="Task complete · tap to dismiss"
                />
              )}
              {urlEditorOpen && (
                <CustomUrlEditor
                  slotNumber={index + 1}
                  value={customUrlDraft}
                  error={customUrlError}
                  onChange={(value) => { setCustomUrlDraft(value); setCustomUrlError(""); }}
                  onSubmit={() => loadCustomUrl(slot.id)}
                  onCancel={closeCustomUrlEditor}
                />
              )}
              {isPoweredOff && !movingSlotId && (
                <button
                  className="control-room-wake"
                  type="button"
                  onClick={() => setSlotDisplay(slot.id, true)}
                  aria-label={`Turn on ${[poweredOffPrimary, poweredOffSecondary, poweredOffTertiary].filter(Boolean).join(", ")} in workspace ${index + 1}`}
                  title="Turn display on"
                >
                  <Power size={16} />
                  <span className="control-room-wake-status">DISPLAY OFF</span>
                  <span className="control-room-wake-identity">
                    {poweredOffPrimary && <strong>{poweredOffPrimary}</strong>}
                    {poweredOffSecondary && <span>{poweredOffSecondary}</span>}
                    {poweredOffTertiary && <small>{poweredOffTertiary}</small>}
                  </span>
                  <span className="control-room-wake-hint">Workspace {String(index + 1).padStart(2, "0")} · click to wake</span>
                </button>
              )}
              {isPoweredOff && !movingSlotId && (
                <button className="control-room-move-trigger is-powered-off-trigger" type="button" onClick={() => beginMoveSlot(slot.id)} aria-label={`Move powered-off workspace ${index + 1}`} title="Move square">
                  <ArrowLeftRight size={13} />
                </button>
              )}
              {arrangeOverlay}
              {movingSlotId && (
                <button className="control-room-move-destination" type="button" onClick={() => finishMoveSlot(slot.id)}>
                  <ArrowLeftRight size={20} />
                  <strong>{isMoveSource ? "MOVING THIS SQUARE" : `SWITCH WITH ${String(index + 1).padStart(2, "0")}`}</strong>
                  <span>{isMoveSource ? "Click here or press Esc to cancel" : "Click to move here"}</span>
                </button>
              )}
            </article>
          );
        })}
      </section>
    </main>
  );
}
