import { ExternalLink, Loader2, MonitorCog, RefreshCw, Settings2, Wifi, WifiOff } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  controlRoomSlotCount,
  controlRoomTileUrl,
  createControlRoomSlots,
  defaultControlRoomMachines,
  normalizeControlRoomMachines,
  type ControlRoomMachine,
  type ControlRoomSlot
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

function readStoredMachines(): ControlRoomMachine[] {
  try {
    const parsed = normalizeControlRoomMachines(JSON.parse(localStorage.getItem(storedProfilesKey) ?? "null"));
    return parsed.length ? parsed : defaultControlRoomMachines;
  } catch {
    return defaultControlRoomMachines;
  }
}

function readStoredSlots(machines: ControlRoomMachine[]): ControlRoomSlot[] {
  try {
    const raw = JSON.parse(localStorage.getItem(storedSlotsKey) ?? "null") as unknown;
    if (!Array.isArray(raw) || raw.length !== controlRoomSlotCount) {
      return createControlRoomSlots(machines);
    }

    const machineIds = new Set(machines.map((machine) => machine.id));
    return raw.map((candidate, index) => {
      const item = candidate && typeof candidate === "object" ? (candidate as Record<string, unknown>) : {};
      const requestedMachineId = typeof item.machineId === "string" ? item.machineId : "";
      return {
        id: `workspace-${index + 1}`,
        machineId: machineIds.has(requestedMachineId) ? requestedMachineId : (machines[index % machines.length]?.id ?? "")
      };
    });
  } catch {
    return createControlRoomSlots(machines);
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
  const [slots, setSlots] = useState<ControlRoomSlot[]>(() => readStoredSlots(readStoredMachines()));
  const [connections, setConnections] = useState<Record<string, TileConnection>>({});
  const [serverNames, setServerNames] = useState<Record<string, string>>({});
  const [reloadKeys, setReloadKeys] = useState<Record<string, number>>({});
  const frameRefs = useRef<Record<string, HTMLIFrameElement | null>>({});

  const machineById = useMemo(() => new Map(machines.map((machine) => [machine.id, machine])), [machines]);
  const onlineCount = Object.values(connections).filter((value) => value === "online").length;

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

  return (
    <main className="control-room-shell">
      <header className="control-room-header">
        <button className="control-room-settings" type="button" aria-label="Settings" title="Settings will be configured next">
          <Settings2 size={17} />
        </button>
        <div className="control-room-brand">
          <span className="control-room-mark"><MonitorCog size={17} /></span>
          <strong>Codex Control Room</strong>
          <span>{slots.length} workspaces</span>
        </div>
        <div className="control-room-health" aria-label={`${onlineCount} of ${slots.length} workspaces online`}>
          <span className={onlineCount === slots.length ? "is-all-online" : ""} />
          <strong>{onlineCount}</strong>
          <span>/ {slots.length} live</span>
        </div>
      </header>

      <section className="control-room-grid" aria-label="Codex remote workspaces">
        {slots.map((slot, index) => {
          const machine = machineById.get(slot.machineId) ?? machines[0];
          const connection = connections[slot.id] ?? "connecting";
          if (!machine) return null;

          const tileUrl = controlRoomTileUrl(machine, slot.id, window.location.origin);
          return (
            <article className={`control-room-tile is-${connection}`} key={slot.id}>
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
                <button type="button" onClick={() => reloadSlot(slot.id)} aria-label={`Reload workspace ${index + 1}`} title="Reload workspace">
                  <RefreshCw size={13} />
                </button>
                <a href={machine.url} target="_blank" rel="noreferrer" aria-label={`Open ${machine.name} separately`} title="Open separately">
                  <ExternalLink size={13} />
                </a>
              </div>
              <iframe
                key={`${slot.id}-${reloadKeys[slot.id] ?? 0}`}
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
            </article>
          );
        })}
      </section>
    </main>
  );
}

