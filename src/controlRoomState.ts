export type ControlRoomMachine = {
  id: string;
  name: string;
  url: string;
  token: string;
};

export type ControlRoomSlot = {
  id: string;
  machineId: string;
};

export const controlRoomColumnOptions = [4, 5, 6, 7] as const;
export const controlRoomRowOptions = [1, 2] as const;

export type ControlRoomLayout = {
  columns: (typeof controlRoomColumnOptions)[number];
  rows: (typeof controlRoomRowOptions)[number];
};

export const defaultControlRoomLayout: ControlRoomLayout = {
  columns: 5,
  rows: 2
};

export const controlRoomSlotCount = 10;

export const defaultControlRoomMachines: ControlRoomMachine[] = [
  {
    id: "ibrahim-hp",
    name: "Ibrahim HP",
    url: "https://mobile-harness-remote-windows-cloudflare-ibrahim-hp.bit68-infra.com",
    token: ""
  },
  {
    id: "thinkcentre-10",
    name: "ThinkCentre 10",
    url: "https://mobile-harness-remote-windows-cloudflare-thinkcentre-10.bit68-infra.com",
    token: ""
  },
  {
    id: "thinkcentre-1",
    name: "TC1",
    url: "https://mobile-harness-remote-windows-cloudflare-thinkcentre-1.bit68-infra.com",
    token: ""
  }
];

export function normalizeMachineUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export function normalizeControlRoomMachines(value: unknown): ControlRoomMachine[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const machines: ControlRoomMachine[] = [];

  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    const item = candidate as Record<string, unknown>;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const url = typeof item.url === "string" ? normalizeMachineUrl(item.url) : "";
    const token = typeof item.token === "string" ? item.token : "";

    if (!id || !name || !/^https?:\/\//i.test(url) || seen.has(id)) {
      continue;
    }

    seen.add(id);
    machines.push({ id, name, url, token });
  }

  return machines;
}

export function normalizeControlRoomLayout(value: unknown): ControlRoomLayout {
  if (!value || typeof value !== "object") {
    return defaultControlRoomLayout;
  }

  const item = value as Record<string, unknown>;
  const columns = controlRoomColumnOptions.find((candidate) => candidate === item.columns);
  const rows = controlRoomRowOptions.find((candidate) => candidate === item.rows);

  return {
    columns: columns ?? defaultControlRoomLayout.columns,
    rows: rows ?? defaultControlRoomLayout.rows
  };
}

export function controlRoomScreenCount(layout: ControlRoomLayout): number {
  return layout.columns * layout.rows;
}

export function createControlRoomSlots(machines: ControlRoomMachine[], count = controlRoomSlotCount): ControlRoomSlot[] {
  const safeCount = Math.max(1, Math.min(16, Math.floor(count)));
  const fallbackMachineId = machines[0]?.id ?? "";

  return Array.from({ length: safeCount }, (_, index) => ({
    id: `workspace-${index + 1}`,
    machineId: machines[index % Math.max(1, machines.length)]?.id ?? fallbackMachineId
  }));
}

export function normalizePoweredOffSlotIds(value: unknown, slots: ControlRoomSlot[]): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const slotIds = new Set(slots.map((slot) => slot.id));
  return [...new Set(value.filter((candidate): candidate is string => typeof candidate === "string" && slotIds.has(candidate)))];
}

export function controlRoomTileUrl(machine: ControlRoomMachine, slotId: string, parentOrigin: string): string {
  const url = new URL(machine.url);
  url.searchParams.set("control-room-tile", "1");
  url.searchParams.set("control-room-slot", slotId);
  url.searchParams.set("control-room-origin", parentOrigin);
  return url.toString();
}
