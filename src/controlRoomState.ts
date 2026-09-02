export type ControlRoomMachine = {
  id: string;
  name: string;
  url: string;
  token: string;
};

export type ControlRoomSlot = {
  id: string;
  machineId: string;
  customUrl?: string;
  dashboardId?: string;
};

export type ControlRoomViewMode = "chat" | "tracker";

export type ControlRoomRegion = {
  id: string;
  row: number;
  column: number;
  rowSpan: number;
  columnSpan: number;
  masterSlotId: string;
};

export type ControlRoomSplitDirection = "vertical" | "horizontal";

export const controlRoomColumnOptions = [1, 2, 3, 4, 5, 6, 7, 8] as const;
export const controlRoomRowOptions = [1, 2, 3] as const;

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
    id: "thinkcentre-11",
    name: "ThinkCentre 11",
    url: "https://mobile-harness-remote-windows-cloudflare-thinkcentre-11.bit68-infra.com",
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

export function normalizeControlRoomCustomUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
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
  const safeCount = Math.max(1, Math.min(24, Math.floor(count)));

  return Array.from({ length: safeCount }, (_, index) => ({
    id: `workspace-${index + 1}`,
    machineId: ""
  }));
}

export function normalizeControlRoomSlots(
  value: unknown,
  machines: ControlRoomMachine[],
  count: number
): ControlRoomSlot[] {
  const safeCount = Math.max(1, Math.min(24, Math.floor(count)));
  if (!Array.isArray(value)) return createControlRoomSlots(machines, safeCount);

  const machineIds = new Set(machines.map((machine) => machine.id));
  const availableIds = Array.from({ length: 24 }, (_, index) => `workspace-${index + 1}`);
  const usedIds = new Set<string>();

  return Array.from({ length: safeCount }, (_, index) => {
    const candidate = value[index];
    const item = candidate && typeof candidate === "object" ? candidate as Record<string, unknown> : {};
    const requestedId = typeof item.id === "string" && availableIds.includes(item.id) && !usedIds.has(item.id) ? item.id : "";
    const id = requestedId || availableIds.find((candidateId) => !usedIds.has(candidateId))!;
    const customUrl = typeof item.customUrl === "string" ? normalizeControlRoomCustomUrl(item.customUrl) : "";
    const dashboardId = typeof item.dashboardId === "string" ? item.dashboardId.trim() : "";
    const requestedMachineId = typeof item.machineId === "string" ? item.machineId : "";
    usedIds.add(id);
    return {
      id,
      machineId: customUrl ? "" : requestedMachineId === "" || machineIds.has(requestedMachineId) ? requestedMachineId : "",
      ...(customUrl ? { customUrl, ...(dashboardId ? { dashboardId } : {}) } : {})
    };
  });
}

function regionCellIndexes(region: Pick<ControlRoomRegion, "row" | "column" | "rowSpan" | "columnSpan">, layout: ControlRoomLayout): number[] {
  const indexes: number[] = [];
  for (let row = region.row; row < region.row + region.rowSpan; row += 1) {
    for (let column = region.column; column < region.column + region.columnSpan; column += 1) {
      indexes.push(row * layout.columns + column);
    }
  }
  return indexes;
}

export function createControlRoomRegions(slots: ControlRoomSlot[], layout: ControlRoomLayout): ControlRoomRegion[] {
  return slots.map((slot, index) => ({
    id: slot.id,
    row: Math.floor(index / layout.columns),
    column: index % layout.columns,
    rowSpan: 1,
    columnSpan: 1,
    masterSlotId: slot.id
  }));
}

export function normalizeControlRoomRegions(
  value: unknown,
  slots: ControlRoomSlot[],
  layout: ControlRoomLayout
): ControlRoomRegion[] {
  if (!Array.isArray(value)) return createControlRoomRegions(slots, layout);

  const slotIndexById = new Map(slots.map((slot, index) => [slot.id, index]));
  const covered = new Set<number>();
  const regionIds = new Set<string>();
  const regions: ControlRoomRegion[] = [];

  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") continue;
    const item = candidate as Record<string, unknown>;
    const masterSlotId = typeof item.masterSlotId === "string" ? item.masterSlotId : "";
    const masterIndex = slotIndexById.get(masterSlotId);
    const row = Number.isInteger(item.row) ? Number(item.row) : -1;
    const column = Number.isInteger(item.column) ? Number(item.column) : -1;
    const rowSpan = Number.isInteger(item.rowSpan) ? Number(item.rowSpan) : 0;
    const columnSpan = Number.isInteger(item.columnSpan) ? Number(item.columnSpan) : 0;
    if (masterIndex === undefined || row < 0 || column < 0 || rowSpan < 1 || columnSpan < 1) continue;
    if (row + rowSpan > layout.rows || column + columnSpan > layout.columns) continue;
    const indexes = regionCellIndexes({ row, column, rowSpan, columnSpan }, layout);
    if (!indexes.includes(masterIndex) || indexes.some((index) => index >= slots.length || covered.has(index))) continue;
    const requestedId = typeof item.id === "string" && item.id.trim() ? item.id.trim() : masterSlotId;
    const id = regionIds.has(requestedId) ? masterSlotId : requestedId;
    if (regionIds.has(id)) continue;
    indexes.forEach((index) => covered.add(index));
    regionIds.add(id);
    regions.push({ id, row, column, rowSpan, columnSpan, masterSlotId });
  }

  slots.forEach((slot, index) => {
    if (covered.has(index)) return;
    const id = regionIds.has(slot.id) ? `region-${slot.id}-${index}` : slot.id;
    regionIds.add(id);
    regions.push({
      id,
      row: Math.floor(index / layout.columns),
      column: index % layout.columns,
      rowSpan: 1,
      columnSpan: 1,
      masterSlotId: slot.id
    });
  });

  return regions.sort((a, b) => a.row - b.row || a.column - b.column);
}

export function canMergeControlRoomRegions(first: ControlRoomRegion, second: ControlRoomRegion): boolean {
  const touchesHorizontally = first.row === second.row && first.rowSpan === second.rowSpan && (
    first.column + first.columnSpan === second.column || second.column + second.columnSpan === first.column
  );
  const touchesVertically = first.column === second.column && first.columnSpan === second.columnSpan && (
    first.row + first.rowSpan === second.row || second.row + second.rowSpan === first.row
  );
  return touchesHorizontally || touchesVertically;
}

export function mergeControlRoomRegions(
  regions: ControlRoomRegion[],
  sourceRegionId: string,
  targetRegionId: string
): ControlRoomRegion[] {
  const source = regions.find((region) => region.id === sourceRegionId);
  const target = regions.find((region) => region.id === targetRegionId);
  if (!source || !target || !canMergeControlRoomRegions(source, target)) return regions;
  const row = Math.min(source.row, target.row);
  const column = Math.min(source.column, target.column);
  const merged: ControlRoomRegion = {
    id: source.id,
    row,
    column,
    rowSpan: Math.max(source.row + source.rowSpan, target.row + target.rowSpan) - row,
    columnSpan: Math.max(source.column + source.columnSpan, target.column + target.columnSpan) - column,
    masterSlotId: source.masterSlotId
  };
  return [...regions.filter((region) => region.id !== source.id && region.id !== target.id), merged]
    .sort((a, b) => a.row - b.row || a.column - b.column);
}

export function splitControlRoomRegion(
  regions: ControlRoomRegion[],
  regionId: string,
  direction: ControlRoomSplitDirection,
  slots: ControlRoomSlot[],
  layout: ControlRoomLayout
): ControlRoomRegion[] {
  const region = regions.find((candidate) => candidate.id === regionId);
  if (!region) return regions;
  if (direction === "vertical" && region.columnSpan < 2) return regions;
  if (direction === "horizontal" && region.rowSpan < 2) return regions;

  const masterIndex = slots.findIndex((slot) => slot.id === region.masterSlotId);
  const first = { ...region };
  const second = { ...region };

  if (direction === "vertical") {
    const firstSpan = Math.ceil(region.columnSpan / 2);
    first.columnSpan = firstSpan;
    second.column = region.column + firstSpan;
    second.columnSpan = region.columnSpan - firstSpan;
  } else {
    const firstSpan = Math.ceil(region.rowSpan / 2);
    first.rowSpan = firstSpan;
    second.row = region.row + firstSpan;
    second.rowSpan = region.rowSpan - firstSpan;
  }

  const firstIndexes = regionCellIndexes(first, layout);
  const masterInFirst = firstIndexes.includes(masterIndex);
  const restored = masterInFirst ? second : first;
  const restoredIndex = regionCellIndexes(restored, layout)[0];
  const restoredSlot = slots[restoredIndex];
  if (!restoredSlot || masterIndex < 0) return regions;

  const occupiedRegionIds = new Set(regions.filter((candidate) => candidate.id !== region.id).map((candidate) => candidate.id));
  let restoredRegionId = `region-${restoredSlot.id}`;
  let suffix = 2;
  while (occupiedRegionIds.has(restoredRegionId) || restoredRegionId === region.id) {
    restoredRegionId = `region-${restoredSlot.id}-${suffix}`;
    suffix += 1;
  }
  first.masterSlotId = masterInFirst ? region.masterSlotId : restoredSlot.id;
  first.id = masterInFirst ? region.id : restoredRegionId;
  second.masterSlotId = masterInFirst ? restoredSlot.id : region.masterSlotId;
  second.id = masterInFirst ? restoredRegionId : region.id;

  return [...regions.filter((candidate) => candidate.id !== region.id), first, second]
    .sort((a, b) => a.row - b.row || a.column - b.column);
}

export function swapControlRoomSlots(slots: ControlRoomSlot[], firstSlotId: string, secondSlotId: string): ControlRoomSlot[] {
  const firstIndex = slots.findIndex((slot) => slot.id === firstSlotId);
  const secondIndex = slots.findIndex((slot) => slot.id === secondSlotId);
  if (firstIndex < 0 || secondIndex < 0 || firstIndex === secondIndex) return slots;

  const next = [...slots];
  [next[firstIndex], next[secondIndex]] = [next[secondIndex], next[firstIndex]];
  return next;
}

export function resizeControlRoomSlots(
  current: ControlRoomSlot[],
  count: number,
  machines: ControlRoomMachine[]
): ControlRoomSlot[] {
  const safeCount = Math.max(1, Math.min(24, Math.floor(count)));
  const preserved = current.slice(0, safeCount);
  const usedIds = new Set(preserved.map((slot) => slot.id));
  const availableIds = Array.from({ length: 24 }, (_, index) => `workspace-${index + 1}`);

  return [
    ...preserved,
    ...Array.from({ length: Math.max(0, safeCount - preserved.length) }, () => {
      const id = availableIds.find((candidateId) => !usedIds.has(candidateId))!;
      usedIds.add(id);
      return { id, machineId: "" };
    })
  ];
}

export function normalizePoweredOffSlotIds(value: unknown, slots: ControlRoomSlot[]): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const slotIds = new Set(slots.map((slot) => slot.id));
  return [...new Set(value.filter((candidate): candidate is string => typeof candidate === "string" && slotIds.has(candidate)))];
}

export function moveControlRoomSquareFocus(
  focusableSlotIds: string[],
  currentSlotId: string,
  direction: "previous" | "next"
): string {
  if (!focusableSlotIds.length) return "";
  const currentIndex = focusableSlotIds.indexOf(currentSlotId);
  if (currentIndex < 0) return direction === "previous" ? focusableSlotIds.at(-1)! : focusableSlotIds[0];
  const offset = direction === "previous" ? -1 : 1;
  const nextIndex = currentIndex + offset;
  return focusableSlotIds[Math.max(0, Math.min(focusableSlotIds.length - 1, nextIndex))];
}

export function normalizeControlRoomViewModes(value: unknown, slots: ControlRoomSlot[]): Record<string, ControlRoomViewMode> {
  if (!value || typeof value !== "object") return {};
  const item = value as Record<string, unknown>;
  return Object.fromEntries(
    slots.flatMap((slot) => (item[slot.id] === "tracker" ? [[slot.id, "tracker" as const]] : []))
  );
}

export function controlRoomTileUrl(
  machine: ControlRoomMachine,
  slotId: string,
  parentOrigin: string,
  viewMode: ControlRoomViewMode = "chat",
  startToken = ""
): string {
  const url = new URL(machine.url);
  url.searchParams.set("control-room-tile", "1");
  url.searchParams.set("control-room-slot", slotId);
  url.searchParams.set("control-room-origin", parentOrigin);
  if (viewMode === "tracker") url.searchParams.set("control-room-view", "tracker");
  if (startToken) url.searchParams.set("control-room-start", startToken);
  return url.toString();
}
