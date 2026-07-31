import assert from "node:assert/strict";
import fs from "node:fs";
import {
  controlRoomTileUrl,
  controlRoomScreenCount,
  createControlRoomSlots,
  defaultControlRoomMachines,
  normalizeControlRoomLayout,
  normalizeControlRoomViewModes,
  normalizePoweredOffSlotIds,
  normalizeControlRoomMachines,
  resizeControlRoomSlots
} from "../src/controlRoomState";

const machines = normalizeControlRoomMachines([
  { id: "one", name: "Machine One", url: "https://one.example.test/", token: "secret-one" },
  { id: "two", name: "Machine Two", url: "https://two.example.test", token: "secret-two" },
  { id: "one", name: "Duplicate", url: "https://duplicate.example.test", token: "ignored" },
  { id: "invalid", name: "Invalid", url: "file:///tmp/remote", token: "ignored" }
]);

assert.equal(machines.length, 2, "invalid and duplicate machines should be discarded");
assert.equal(machines[0].url, "https://one.example.test", "machine URLs should be normalized");

assert.deepEqual(normalizeControlRoomLayout({ columns: 8, rows: 3 }), { columns: 8, rows: 3 });
assert.deepEqual(
  normalizeControlRoomLayout({ columns: 9, rows: 4 }),
  { columns: 5, rows: 2 },
  "unsupported layout values should fall back to the five-by-two default"
);
assert.equal(controlRoomScreenCount({ columns: 8, rows: 3 }), 24, "layout dimensions should determine screen count");

const slots = createControlRoomSlots(machines, 10);
assert.equal(slots.length, 10, "the display wall should default to ten workspaces");
assert.deepEqual(
  slots.slice(0, 4).map((slot) => slot.machineId),
  ["one", "two", "one", "two"],
  "workspaces should alternate across available machines"
);
assert.equal(new Set(slots.map((slot) => slot.id)).size, slots.length, "every workspace needs an independent storage scope");

const expandedSlots = resizeControlRoomSlots(slots, 16, machines);
assert.deepEqual(expandedSlots.slice(0, 10), slots, "existing workspaces should survive grid expansion unchanged");
assert.deepEqual(
  expandedSlots.slice(10).map((slot) => slot.machineId),
  ["", "", "", "", "", ""],
  "newly added workspaces must start terminated instead of choosing random machines"
);
assert.equal(resizeControlRoomSlots(expandedSlots, 24, machines).length, 24, "the grid should support eight columns by three rows");

assert.deepEqual(
  normalizePoweredOffSlotIds(["workspace-2", "workspace-2", "workspace-9", "missing", 3], slots),
  ["workspace-2", "workspace-9"],
  "standby state should persist only unique, configured workspace IDs"
);

assert.deepEqual(
  normalizeControlRoomViewModes({ "workspace-1": "tracker", "workspace-2": "chat", missing: "tracker" }, slots),
  { "workspace-1": "tracker" },
  "only tracker modes for configured workspaces need to be persisted"
);

const tileUrl = new URL(controlRoomTileUrl(machines[0], "workspace-3", "https://control.example.test", "tracker", "restart-1"));
assert.equal(tileUrl.searchParams.get("control-room-tile"), "1");
assert.equal(tileUrl.searchParams.get("control-room-slot"), "workspace-3");
assert.equal(tileUrl.searchParams.get("control-room-origin"), "https://control.example.test");
assert.equal(tileUrl.searchParams.get("control-room-view"), "tracker");
assert.equal(tileUrl.searchParams.get("control-room-start"), "restart-1");
assert.equal(tileUrl.searchParams.has("token"), false, "control tokens must never be placed in iframe URLs");

assert.equal(defaultControlRoomMachines.length, 3, "the native app should know all configured remotes before credentials arrive");
assert.equal(defaultControlRoomMachines[2]?.id, "thinkcentre-1", "TC1 should be available as a default machine");

const controlRoomSource = fs.readFileSync(new URL("../src/ControlRoom.tsx", import.meta.url), "utf8");
const appSource = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const wrapperSource = fs.readFileSync(new URL("../windows/Build-WebViewWrapper.ps1", import.meta.url), "utf8");
assert.match(controlRoomSource, /terminateSlot\(slot\.id\)/, "each live workspace should expose termination");
assert.match(controlRoomSource, /Select machine to start/, "terminated workspaces should require an explicit machine selection");
assert.match(controlRoomSource, /event\.ctrlKey[\s\S]{0,160}event\.key === "ArrowDown"/, "Ctrl+Down should broadcast the global bottom command");
assert.match(appSource, /if \(isFreshControlRoomStart\) return true;/, "restarted workspaces should open with their sidebar active");
assert.match(appSource, /isFreshControlRoomStart[\s\S]{0,180}\? null[\s\S]{0,180}: firstChatId/, "freshly restarted workspaces should not choose a random chat");
assert.match(appSource, /codex-control-room-scroll-all-request/, "focused child chats should relay Ctrl+Down to the wall");
assert.match(appSource, /menu-open:\$\{controlRoomSlotId\}/, "each workspace should remember whether its side menu was open");
assert.match(appSource, /localStorage\.setItem\(controlRoomMenuOpenKey, String\(menuOpen\)\)/, "side menu state should persist as it changes");
assert.match(wrapperSource, /window-state\.json/, "the Windows wrapper should persist its monitor placement");
assert.match(wrapperSource, /WorkingArea\.IntersectsWith\(bounds\)/, "saved window placement should be rejected when every monitor is disconnected");

console.log("Control room checks passed");
