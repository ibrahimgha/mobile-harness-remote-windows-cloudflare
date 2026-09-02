import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ControlRoomLedCoordinator } from "../server/controlRoomLed.js";

let now = Date.parse("2026-08-03T12:00:00.000Z");
const applied: boolean[] = [];
const coordinator = new ControlRoomLedCoordinator({
  now: () => now,
  heartbeatTtlMs: 15_000,
  refreshMs: 60_000,
  apply(flashing) {
    applied.push(flashing);
    return { connected: true, product: "test-pad", serialNumber: "test-serial" };
  }
});

coordinator.start();
await coordinator.settled();
assert.deepEqual(applied, [false], "startup must turn the pad off");

coordinator.report("default", true, 2);
await coordinator.settled();
assert.equal(coordinator.status().flashing, true);
assert.equal(coordinator.status().flashingSquares, 2);
assert.deepEqual(applied, [false, true], "the first flashing room must start the LED");

coordinator.report("secondary", false, 0);
await coordinator.settled();
assert.equal(coordinator.status().flashing, true, "an idle room must not cancel another room's flashing state");
assert.deepEqual(applied, [false, true]);

coordinator.acknowledge();
await coordinator.settled();
assert.equal(coordinator.status().flashing, false, "a keyboard acknowledgment must turn off the completion light");
assert.equal(coordinator.status().acknowledged, true);
assert.deepEqual(applied, [false, true, false]);

coordinator.report("default", true, 2);
await coordinator.settled();
assert.deepEqual(applied, [false, true, false], "an unchanged heartbeat must not relight an acknowledged completion");

coordinator.report("secondary", true, 1);
await coordinator.settled();
assert.equal(coordinator.status().flashing, true, "a later completion must relight the pad");
assert.deepEqual(applied, [false, true, false, true]);

coordinator.remove("default");
coordinator.remove("secondary");
await coordinator.settled();
assert.equal(coordinator.status().flashing, false);
assert.deepEqual(applied, [false, true, false, true, false], "removing the final flashing room must turn the LED off");

coordinator.report("instance-3", true, 1);
await coordinator.settled();
now += 16_000;
coordinator.report("secondary", false, 0);
await coordinator.settled();
assert.equal(coordinator.status().flashing, false, "expired room heartbeats must stop the LED");
assert.deepEqual(applied, [false, true, false, true, false, true, false]);

coordinator.stop();
await coordinator.settled();

const controlRoomSource = readFileSync(new URL("../src/ControlRoom.tsx", import.meta.url), "utf8");
assert.match(controlRoomSource, /fetch\("\/api\/control-room\/led"/, "Control Room must report completion-glow state");
assert.match(controlRoomSource, /window\.setInterval\(report, 5_000\)/, "Control Room must keep its LED report alive");
assert.match(controlRoomSource, /flashing: flashingSquareCount > 0/, "LED state must follow the aggregate square glow count");

const serverSource = readFileSync(new URL("../server/index.ts", import.meta.url), "utf8");
assert.match(serverSource, /app\.post\("\/api\/control-room\/led"/, "server must expose the LED heartbeat route");
assert.match(serverSource, /app\.post\("\/api\/control-room\/led\/off"/, "server must expose the shutdown off route");
assert.match(serverSource, /app\.post\("\/api\/control-room\/led\/acknowledge"/, "server must expose keyboard acknowledgment for the completion light");
assert.match(controlRoomSource, /action === "acknowledge-completion-light"/, "native keyboard input must acknowledge the completion light");
console.log("Control Room LED aggregation checks passed");
