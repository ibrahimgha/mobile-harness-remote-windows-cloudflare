import assert from "node:assert/strict";
import {
  controlRoomTileUrl,
  createControlRoomSlots,
  defaultControlRoomMachines,
  normalizeControlRoomMachines
} from "../src/controlRoomState";

const machines = normalizeControlRoomMachines([
  { id: "one", name: "Machine One", url: "https://one.example.test/", token: "secret-one" },
  { id: "two", name: "Machine Two", url: "https://two.example.test", token: "secret-two" },
  { id: "one", name: "Duplicate", url: "https://duplicate.example.test", token: "ignored" },
  { id: "invalid", name: "Invalid", url: "file:///tmp/remote", token: "ignored" }
]);

assert.equal(machines.length, 2, "invalid and duplicate machines should be discarded");
assert.equal(machines[0].url, "https://one.example.test", "machine URLs should be normalized");

const slots = createControlRoomSlots(machines, 10);
assert.equal(slots.length, 10, "the display wall should default to ten workspaces");
assert.deepEqual(
  slots.slice(0, 4).map((slot) => slot.machineId),
  ["one", "two", "one", "two"],
  "workspaces should alternate across available machines"
);
assert.equal(new Set(slots.map((slot) => slot.id)).size, slots.length, "every workspace needs an independent storage scope");

const tileUrl = new URL(controlRoomTileUrl(machines[0], "workspace-3", "https://control.example.test"));
assert.equal(tileUrl.searchParams.get("control-room-tile"), "1");
assert.equal(tileUrl.searchParams.get("control-room-slot"), "workspace-3");
assert.equal(tileUrl.searchParams.get("control-room-origin"), "https://control.example.test");
assert.equal(tileUrl.searchParams.has("token"), false, "control tokens must never be placed in iframe URLs");

assert.equal(defaultControlRoomMachines.length, 3, "the native app should know all configured remotes before credentials arrive");
assert.equal(defaultControlRoomMachines[2]?.id, "thinkcentre-1", "TC1 should be available as a default machine");

console.log("Control room checks passed");
