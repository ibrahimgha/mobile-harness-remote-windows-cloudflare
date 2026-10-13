import assert from "node:assert/strict";
import fs from "node:fs";
import { keepScreenAwake, type ScreenWakeLockStatus } from "../src/screenWakeLock.js";

class FakeLock extends EventTarget {
  released = false;
  releases = 0;
  release() {
    this.releases += 1;
    this.releaseFromBrowser();
    return Promise.resolve();
  }
  releaseFromBrowser() {
    if (this.released) return;
    this.released = true;
    this.dispatchEvent(new Event("release"));
  }
}

function fixture(supported = true) {
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const requests: { resolve: (lock: FakeLock) => void; reject: (error: Error) => void }[] = [];
  const navigator = supported ? {
    wakeLock: { request: (type: string) => {
      assert.equal(type, "screen");
      return new Promise<FakeLock>((resolve, reject) => { requests.push({ resolve, reject }); });
    } }
  } : {};
  const view = Object.assign(new EventTarget(), { document, navigator });
  const statuses: ScreenWakeLockStatus[] = [];
  const controller = keepScreenAwake(view as unknown as Window, (status) => { statuses.push(status); });
  return {
    view, document, requests, statuses, controller,
    visibility(state: string) {
      document.visibilityState = state;
      document.dispatchEvent(new Event("visibilitychange"));
    },
    async grant(index: number) {
      const lock = new FakeLock();
      requests[index].resolve(lock);
      await settle();
      return lock;
    }
  };
}

async function settle() { for (let i = 0; i < 5; i += 1) await Promise.resolve(); }

{
  const f = fixture();
  assert.deepEqual(f.statuses, ["requesting"]);
  f.controller.retry();
  f.view.dispatchEvent(new Event("focus"));
  assert.equal(f.requests.length, 1, "one pending request per popup");
  const lock = await f.grant(0);
  assert.equal(f.statuses.at(-1), "active");
  f.controller.retry();
  f.view.dispatchEvent(new Event("pageshow"));
  assert.equal(f.requests.length, 1, "retain the active lock across rerenders/focus");
  f.visibility("hidden");
  assert.equal(f.statuses.at(-1), "paused");
  assert.equal(lock.releases, 1);
  f.controller.retry();
  assert.equal(f.requests.length, 1, "never acquire while hidden");
  f.visibility("visible");
  const next = await f.grant(1);
  assert.equal(f.statuses.at(-1), "active");
  f.controller.stop();
  f.controller.stop();
  assert.equal(next.releases, 1, "cancel/send cleanup releases exactly once");
  const statusCount = f.statuses.length;
  f.view.dispatchEvent(new Event("focus"));
  f.view.dispatchEvent(new Event("pageshow"));
  f.visibility("hidden");
  f.visibility("visible");
  f.controller.retry();
  assert.equal(f.requests.length, 2, "remove all listeners on close");
  assert.equal(f.statuses.length, statusCount, "no callbacks after close");
}
{
  const f = fixture();
  f.controller.stop();
  const late = await f.grant(0);
  assert.equal(late.releases, 1, "late grant after cancel must not leak");
  assert.deepEqual(f.statuses, ["requesting"]);
}
{
  const f = fixture();
  f.visibility("hidden");
  f.visibility("visible");
  const stale = await f.grant(0);
  assert.equal(stale.releases, 1);
  assert.equal(f.requests.length, 2, "reacquire after a visibility race");
  const fresh = await f.grant(1);
  assert.equal(f.statuses.at(-1), "active");
  f.controller.stop();
  assert.equal(fresh.releases, 1);
}
{
  const f = fixture();
  f.view.dispatchEvent(new Event("pagehide"));
  const late = await f.grant(0);
  assert.equal(late.releases, 1);
  assert.equal(f.statuses.at(-1), "paused");
  assert.equal(f.requests.length, 1);
  f.view.dispatchEvent(new Event("pageshow"));
  await f.grant(1);
  assert.equal(f.statuses.at(-1), "active", "BFCache restore reacquires");
  f.controller.stop();
}
{
  const f = fixture();
  f.requests[0].reject(new Error("Power policy denied"));
  await settle();
  assert.equal(f.statuses.at(-1), "unavailable");
  assert.equal(f.requests.length, 1, "no automatic denial retry loop");
  f.controller.retry();
  const lock = await f.grant(1);
  lock.releaseFromBrowser();
  assert.equal(f.statuses.at(-1), "unavailable");
  assert.equal(f.requests.length, 2, "respect an OS-initiated release");
  f.view.dispatchEvent(new Event("focus"));
  await f.grant(2);
  assert.equal(f.statuses.at(-1), "active");
  f.controller.stop();
}
{
  const f = fixture();
  const alreadyReleased = new FakeLock();
  alreadyReleased.releaseFromBrowser();
  f.requests[0].resolve(alreadyReleased);
  await settle();
  assert.equal(f.statuses.at(-1), "unavailable", "never claim a released sentinel is active");
  f.controller.stop();
}
{
  const f = fixture();
  f.visibility("hidden");
  f.requests[0].reject(new Error("Hidden document"));
  await settle();
  assert.equal(f.statuses.at(-1), "paused");
  f.visibility("visible");
  const lock = await f.grant(1);
  lock.release = () => Promise.reject(new Error("Already inactive"));
  f.controller.stop();
  await settle(); // release errors must not become unhandled rejections.
}
{
  const f = fixture(false);
  assert.deepEqual(f.statuses, ["unsupported"]);
  f.controller.retry();
  assert.equal(f.requests.length, 0);
  f.controller.stop();
}

const overlay = fs.readFileSync("src/DictationRecordingOverlay.tsx", "utf8");
assert.match(overlay, /const lock = keepScreenAwake\(window, setScreenWakeLockStatus\)/);
assert.match(overlay, /lock\.stop\(\);[\s\S]*?\}, \[\]\);/, "wake lock belongs to popup mount, not recording phase changes");
assert.match(overlay, /data-screen-wake-lock=\{screenWakeLockStatus\}/);
assert.match(overlay, /screenWakeLockRef\.current\?\.retry\(\)/);
assert.match(fs.readFileSync("src/ControlRoom.tsx", "utf8"), /allow="[^"]*microphone; screen-wake-lock"/);
assert.doesNotMatch(fs.readFileSync("src/screenWakeLock.ts", "utf8"), /setInterval|setTimeout|createElement\(["']video/);
console.log("Screen wake lock: lifecycle, foreground restore, races, policy denial, retry, and cleanup passed.");
