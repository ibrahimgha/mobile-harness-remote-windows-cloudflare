import { Activity, ExternalLink, Loader2, MessageSquare, MonitorCog, Power, RefreshCw, Settings2, Wifi, WifiOff, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  controlRoomColumnOptions,
  controlRoomRowOptions,
  controlRoomScreenCount,
  controlRoomTileUrl,
  createControlRoomSlots,
  defaultControlRoomLayout,
  defaultControlRoomMachines,
  normalizeControlRoomLayout,
  normalizeControlRoomMachines,
  normalizeControlRoomViewModes,
  normalizePoweredOffSlotIds,
  type ControlRoomLayout,
  type ControlRoomMachine,
  type ControlRoomSlot,
  type ControlRoomViewMode
} from "./controlRoomState";
import "./control-room.css";

type TileConnection = "connecting" | "online" | "unauthorized" | "offline";

type ControlRoomStatusMessage = {
  type: "codex-control-room-status";
  slotId: string;
  status: "ready" | "authenticated" | "unauthorized";
  serverName?: string;
};

type NativeProfilesMessage = {
  type: "codex-control-room-profiles";
  machines: unknown;
};

declare global {
  interface Window {
    chrome?: {
      webview?: {
        addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
        removeEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
      };
    };
  }
}

const storedProfilesKey = "codex-control-room-machines-v1";
const storedSlotsKey = "codex-control-room-slots-v1";
const storedPoweredOffSlotsKey = "codex-control-room-powered-off-slots-v1";
const storedLayoutKey = "codex-control-room-layout-v1";
const storedViewModesKey = "codex-control-room-view-modes-v1";

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
  const defaults = createControlRoomSlots(machines, count);

  try {
    const raw = JSON.parse(localStorage.getItem(storedSlotsKey) ?? "null") as unknown;
    if (!Array.isArray(raw)) return defaults;

    const machineIds = new Set(machines.map((machine) => machine.id));
    return defaults.map((fallback, index) => {
      const candidate = raw[index];
      const item = candidate && typeof candidate === "object" ? (candidate as Record<string, unknown>) : {};
      const requestedMachineId = typeof item.machineId === "string" ? item.machineId : "";
      return {
        ...fallback,
        machineId: machineIds.has(requestedMachineId) ? requestedMachineId : fallback.machineId
      };
    });
  } catch {
    return defaults;
  }
}

function readStoredPoweredOffSlots(slots: ControlRoomSlot[]): Set<string> {
  try {
    return new Set(normalizePoweredOffSlotIds(JSON.parse(localStorage.getItem(storedPoweredOffSlotsKey) ?? "null"), slots));
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

function connectionLabel(connection: TileConnection) {
  if (connection === "online") return "Live";
  if (connection === "unauthorized") return "Authentication needed";
  if (connection === "offline") return "Unavailable";
  return "Connecting";
}

export function ControlRoom() {
  const [machines, setMachines] = useState<ControlRoomMachine[]>(readStoredMachines);
  const [layout, setLayout] = useState<ControlRoomLayout>(readStoredLayout);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [slots, setSlots] = useState<ControlRoomSlot[]>(() => {
    const storedMachines = readStoredMachines();
    return readStoredSlots(storedMachines, controlRoomScreenCount(readStoredLayout()));
  });
  const [poweredOffSlots, setPoweredOffSlots] = useState<Set<string>>(() => {
    const storedMachines = readStoredMachines();
    const storedSlots = readStoredSlots(storedMachines, controlRoomScreenCount(readStoredLayout()));
    return readStoredPoweredOffSlots(storedSlots);
  });
  const [viewModes, setViewModes] = useState<Record<string, ControlRoomViewMode>>(() => {
    const storedMachines = readStoredMachines();
    return readStoredViewModes(readStoredSlots(storedMachines, controlRoomScreenCount(readStoredLayout())));
  });
  const [connections, setConnections] = useState<Record<string, TileConnection>>({});
  const [serverNames, setServerNames] = useState<Record<string, string>>({});
  const [reloadKeys, setReloadKeys] = useState<Record<string, number>>({});
  const frameRefs = useRef<Record<string, HTMLIFrameElement | null>>({});

  const machineById = useMemo(() => new Map(machines.map((machine) => [machine.id, machine])), [machines]);
  const poweredOffCount = poweredOffSlots.size;
  const activeCount = slots.length - poweredOffCount;
  const onlineCount = slots.filter((slot) => !poweredOffSlots.has(slot.id) && connections[slot.id] === "online").length;

  const sendAuthentication = useCallback(
    (slotId: string) => {
      const slot = slots.find((candidate) => candidate.id === slotId);
      const machine = slot ? machineById.get(slot.machineId) : null;
      const frame = frameRefs.current[slotId];

      if (!slot || !machine || !frame?.contentWindow) {
        return;
      }

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
    };

    window.addEventListener("message", receiveStatus);
    return () => window.removeEventListener("message", receiveStatus);
  }, [machineById, sendAuthentication, slots]);

  useEffect(() => {
    const receiveNativeProfiles = (event: MessageEvent<unknown>) => {
      if (!event.data || typeof event.data !== "object") return;
      const message = event.data as Partial<NativeProfilesMessage>;
      if (message.type !== "codex-control-room-profiles") return;
      const nextMachines = normalizeControlRoomMachines(message.machines);
      if (!nextMachines.length) return;

      localStorage.setItem(storedProfilesKey, JSON.stringify(nextMachines));
      setMachines(nextMachines);
      setSlots((current) => {
        const nextMachineIds = new Set(nextMachines.map((machine) => machine.id));
        const next = current.map((slot, index) => ({
          ...slot,
          machineId: nextMachineIds.has(slot.machineId) ? slot.machineId : nextMachines[index % nextMachines.length].id
        }));
        localStorage.setItem(storedSlotsKey, JSON.stringify(next));
        return next;
      });
      setReloadKeys((current) =>
        Object.fromEntries(slots.map((slot) => [slot.id, (current[slot.id] ?? 0) + 1]))
      );
    };

    const webview = window.chrome?.webview;
    webview?.addEventListener("message", receiveNativeProfiles);
    return () => webview?.removeEventListener("message", receiveNativeProfiles);
  }, [slots]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      for (const slot of slots) {
        if (connections[slot.id] !== "online") sendAuthentication(slot.id);
      }
    }, 2000);
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

  function selectMachine(slotId: string, machineId: string) {
    setSlots((current) => {
      const next = current.map((slot) => (slot.id === slotId ? { ...slot, machineId } : slot));
      localStorage.setItem(storedSlotsKey, JSON.stringify(next));
      return next;
    });
    setConnections((current) => ({ ...current, [slotId]: "connecting" }));
    setServerNames((current) => {
      const next = { ...current };
      delete next[slotId];
      return next;
    });
    setReloadKeys((current) => ({ ...current, [slotId]: (current[slotId] ?? 0) + 1 }));
  }

  function reloadSlot(slotId: string) {
    setConnections((current) => ({ ...current, [slotId]: "connecting" }));
    setReloadKeys((current) => ({ ...current, [slotId]: (current[slotId] ?? 0) + 1 }));
  }

  function setSlotViewMode(slotId: string, mode: ControlRoomViewMode) {
    setViewModes((current) => {
      const next = { ...current, [slotId]: mode };
      localStorage.setItem(storedViewModesKey, JSON.stringify(next));
      return next;
    });
    setConnections((current) => ({ ...current, [slotId]: "connecting" }));
  }

  function setSlotDisplay(slotId: string, poweredOn: boolean) {
    setPoweredOffSlots((current) => {
      const next = new Set(current);
      if (poweredOn) next.delete(slotId);
      else next.add(slotId);
      localStorage.setItem(storedPoweredOffSlotsKey, JSON.stringify([...next]));
      return next;
    });

  }

  function applyLayout(nextLayout: ControlRoomLayout) {
    const normalizedLayout = normalizeControlRoomLayout(nextLayout);
    const nextCount = controlRoomScreenCount(normalizedLayout);
    const nextSlotIds = new Set(Array.from({ length: nextCount }, (_, index) => `workspace-${index + 1}`));

    setLayout(normalizedLayout);
    localStorage.setItem(storedLayoutKey, JSON.stringify(normalizedLayout));

    setSlots((current) => {
      const defaults = createControlRoomSlots(machines, nextCount);
      const machineIds = new Set(machines.map((machine) => machine.id));
      const next = defaults.map((fallback, index) => {
        const existing = current[index];
        return existing && machineIds.has(existing.machineId)
          ? { ...fallback, machineId: existing.machineId }
          : fallback;
      });
      localStorage.setItem(storedSlotsKey, JSON.stringify(next));
      return next;
    });

    setPoweredOffSlots((current) => {
      const next = new Set([...current].filter((slotId) => nextSlotIds.has(slotId)));
      localStorage.setItem(storedPoweredOffSlotsKey, JSON.stringify([...next]));
      return next;
    });
    setConnections((current) => Object.fromEntries(Object.entries(current).filter(([slotId]) => nextSlotIds.has(slotId))));
    setServerNames((current) => Object.fromEntries(Object.entries(current).filter(([slotId]) => nextSlotIds.has(slotId))));
    setReloadKeys((current) => Object.fromEntries(Object.entries(current).filter(([slotId]) => nextSlotIds.has(slotId))));
    setViewModes((current) => {
      const next = Object.fromEntries(Object.entries(current).filter(([slotId]) => nextSlotIds.has(slotId)));
      localStorage.setItem(storedViewModesKey, JSON.stringify(next));
      return next;
    });
  }

  return (
    <main className="control-room-shell">
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
          <span>{slots.length} workspaces</span>
        </div>
        <div className="control-room-health" aria-label={`${onlineCount} of ${activeCount} active workspaces online; ${poweredOffCount} displays off`}>
          <span className={activeCount > 0 && onlineCount === activeCount ? "is-all-online" : ""} />
          <strong>{onlineCount}</strong>
          <span>/ {activeCount} live</span>
          {poweredOffCount > 0 && <span className="control-room-standby-count">· {poweredOffCount} off</span>}
        </div>
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
                  onClick={() => applyLayout({ ...layout, rows })}
                >
                  {rows}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="control-room-layout-total" aria-live="polite">
            <strong>{controlRoomScreenCount(layout)}</strong>
            <span>screens</span>
            <small>{layout.columns} columns × {layout.rows} {layout.rows === 1 ? "row" : "rows"}</small>
          </div>
        </aside>
      )}

      <section
        className="control-room-grid"
        aria-label="Codex remote workspaces"
        style={{
          gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))`
        }}
      >
        {slots.map((slot, index) => {
          const machine = machineById.get(slot.machineId) ?? machines[0];
          const connection = connections[slot.id] ?? "connecting";
          const isPoweredOff = poweredOffSlots.has(slot.id);
          const viewMode = viewModes[slot.id] ?? "chat";
          if (!machine) return null;

          const tileUrl = controlRoomTileUrl(machine, slot.id, window.location.origin, viewMode);
          return (
            <article className={`control-room-tile is-${connection}${isPoweredOff ? " is-powered-off" : ""}`} key={slot.id}>
              <div className="control-room-live-surface" aria-hidden={isPoweredOff} inert={isPoweredOff}>
                <div className="control-room-tilebar">
                  <span className="control-room-index">{String(index + 1).padStart(2, "0")}</span>
                  <label>
                    <span className="sr-only">Machine for workspace {index + 1}</span>
                    <select value={slot.machineId} onChange={(event) => selectMachine(slot.id, event.target.value)}>
                      {machines.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
                    </select>
                  </label>
                  <span className="control-room-server-name">{serverNames[slot.id] || machine.name}</span>
                  <span className="control-room-connection" title={connectionLabel(connection)}>
                    {connection === "connecting" ? <Loader2 className="spin" size={13} /> : connection === "online" ? <Wifi size={13} /> : <WifiOff size={13} />}
                    {connectionLabel(connection)}
                  </span>
                  <button
                    className={`control-room-mode-toggle${viewMode === "tracker" ? " is-tracker" : ""}`}
                    type="button"
                    onClick={() => setSlotViewMode(slot.id, viewMode === "tracker" ? "chat" : "tracker")}
                    aria-label={`${viewMode === "tracker" ? "Show full chat" : "Show live machine tracker"} in workspace ${index + 1}`}
                    title={viewMode === "tracker" ? "Show full chat" : "Show live machine tracker"}
                  >
                    {viewMode === "tracker" ? <MessageSquare size={13} /> : <Activity size={13} />}
                  </button>
                  <button type="button" onClick={() => reloadSlot(slot.id)} aria-label={`Reload workspace ${index + 1}`} title="Reload workspace">
                    <RefreshCw size={13} />
                  </button>
                  <button type="button" onClick={() => setSlotDisplay(slot.id, false)} aria-label={`Turn off display for workspace ${index + 1}`} title="Turn display off">
                    <Power size={13} />
                  </button>
                  <a href={machine.url} target="_blank" rel="noreferrer" aria-label={`Open ${machine.name} separately`} title="Open separately">
                    <ExternalLink size={13} />
                  </a>
                </div>
                <iframe
                  key={`${slot.id}-${viewMode}-${reloadKeys[slot.id] ?? 0}`}
                  ref={(node) => { frameRefs.current[slot.id] = node; }}
                  src={tileUrl}
                  title={`Workspace ${index + 1} — ${machine.name}`}
                  onLoad={() => {
                    setConnections((current) => ({ ...current, [slot.id]: "connecting" }));
                    window.setTimeout(() => sendAuthentication(slot.id), 150);
                  }}
                  onError={() => setConnections((current) => ({ ...current, [slot.id]: "offline" }))}
                  allow="clipboard-read; clipboard-write; microphone"
                />
              </div>
              {isPoweredOff && (
                <button
                  className="control-room-wake"
                  type="button"
                  onClick={() => setSlotDisplay(slot.id, true)}
                  aria-label={`Turn on display for workspace ${index + 1}`}
                  title="Turn display on"
                >
                  <Power size={22} />
                  <strong>DISPLAY OFF</strong>
                  <span>Workspace {String(index + 1).padStart(2, "0")} · click to wake</span>
                </button>
              )}
            </article>
          );
        })}
      </section>
    </main>
  );
}
