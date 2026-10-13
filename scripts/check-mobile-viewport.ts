import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installMobileViewport } from "../src/mobileViewport";

const attributes = new Map<string, string>();
const styles = new Map<string, { value: string; priority: string }>();
const frames = new Map<number, FrameRequestCallback>();
let frameId = 0;
const timeouts = new Map<number, () => void>();
const intervals = new Map<number, () => void>();
let timerId = 0;
let activeElement: { tagName?: string; isContentEditable?: boolean } | null = null;
const viewport = Object.assign(new EventTarget(), { height: 797, offsetTop: 0, scale: 1 });
const document = Object.assign(new EventTarget(), {
  visibilityState: "visible",
  documentElement: {
    clientHeight: 797,
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    removeAttribute: (name: string) => attributes.delete(name),
    style: {
      getPropertyValue: (name: string) => styles.get(name)?.value ?? "",
      getPropertyPriority: (name: string) => styles.get(name)?.priority ?? "",
      setProperty: (name: string, value: string, priority = "") => styles.set(name, { value, priority }),
      removeProperty: (name: string) => styles.delete(name)
    }
  }
});
Object.defineProperty(document, "activeElement", { get: () => activeElement });
const view = Object.assign(new EventTarget(), {
  document, visualViewport: viewport, innerHeight: 797,
  requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; },
  cancelAnimationFrame: (id: number) => { frames.delete(id); },
  setTimeout: (callback: () => void) => { timeouts.set(++timerId, callback); return timerId; },
  clearTimeout: (id: number) => { timeouts.delete(id); },
  setInterval: (callback: () => void) => { intervals.set(++timerId, callback); return timerId; },
  clearInterval: (id: number) => { intervals.delete(id); },
  scrollTo: () => { throw Error("Viewport synchronization must never scroll the page or editor"); }
});
const flush = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(0)); };
const flushTimeouts = () => { const pending = [...timeouts.values()]; timeouts.clear(); pending.forEach(callback => callback()); flush(); };
const tickWatchdog = () => { [...intervals.values()].forEach(callback => callback()); flush(); };
const height = () => styles.get("--app-height")?.value;
const top = () => styles.get("--app-viewport-top")?.value;
const stop = installMobileViewport(view as unknown as Window);
assert.equal(height(), "797px");
assert.equal(top(), "0px");
assert.equal(attributes.get("data-mobile-viewport"), "true");
activeElement = { tagName: "TEXTAREA" };
viewport.height = 401;
viewport.offsetTop = 396;
viewport.dispatchEvent(new Event("resize"));
viewport.dispatchEvent(new Event("scroll"));
assert.equal(frames.size, 1, "Keyboard animation events coalesce to one layout update per frame");
flush();
assert.equal(height(), "401px", "Use visible viewport, not full layout height");
assert.equal(top(), "396px", "Track WebKit's visual viewport pan without resetting document scroll");
activeElement = { tagName: "BUTTON" };
document.dispatchEvent(new Event("focusout"));
flush();
assert.equal(height(), "797px", "Reject a stale keyboard-sized viewport after editor focus leaves");
assert.equal(top(), "0px", "A repaired viewport must return to the layout viewport origin");
flushTimeouts();
activeElement = { tagName: "TEXTAREA" };
viewport.dispatchEvent(new Event("resize"));flush();
assert.equal(height(), "401px", "Keep the keyboard-sized viewport while an editor is focused");
viewport.offsetTop = 0;
viewport.dispatchEvent(new Event("scroll"));flush();
assert.equal(top(), "0px");
viewport.scale = 2;viewport.height = 200;viewport.offsetTop = 70;
viewport.dispatchEvent(new Event("resize"));flush();
assert.equal(height(), "401px", "Pinch zoom retains ordinary browser magnification and panning");
assert.equal(top(), "0px");
viewport.scale = 1;viewport.height = 0;
viewport.dispatchEvent(new Event("resize"));flush();
assert.equal(height(), "401px", "Ignore transient zero-sized viewports");
viewport.height = 797;viewport.offsetTop = -3;
view.dispatchEvent(new Event("pageshow"));flush();
assert.equal(height(), "797px", "Restore full height after closing keyboard or resuming app");
assert.equal(top(), "0px", "Rubber-band overscroll must not position the app above the viewport");
viewport.height = 420;
viewport.offsetTop = 377;
activeElement = { tagName: "BUTTON" };
tickWatchdog();
assert.equal(height(), "797px", "The watchdog self-heals a missed final visualViewport event");
activeElement = { tagName: "TEXTAREA" };
viewport.height = 797;
viewport.offsetTop = 0;
tickWatchdog();
assert.equal(height(), "797px", "The watchdog also observes a delayed viewport recovery while focus remains");
viewport.dispatchEvent(new Event("resize"));
stop();flush();
assert.equal(attributes.has("data-mobile-viewport"), false);
assert.equal(styles.size, 0);
assert.equal(frames.size, 0);
assert.equal(timeouts.size, 0, "Cleanup cancels settling measurements");
assert.equal(intervals.size, 0, "Cleanup cancels the recovery watchdog");
viewport.dispatchEvent(new Event("resize"));view.dispatchEvent(new Event("resize"));
assert.equal(frames.size, 0, "Cleanup removes event listeners");
styles.set("--app-height", { value: "88vh", priority: "important" });
attributes.set("data-mobile-viewport", "previous");
installMobileViewport(view as unknown as Window)();
assert.deepEqual(styles.get("--app-height"), { value: "88vh", priority: "important" });
assert.equal(attributes.get("data-mobile-viewport"), "previous");
installMobileViewport({ visualViewport: null } as Window)();
const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
assert.match(css, /html\[data-mobile-viewport="true"\] #root\s*\{[^}]*inset: var\(--app-viewport-top, 0px\) 0 auto;[^}]*height: var\(--app-height, 100dvh\);[^}]*min-height: 0;/,
  "The root must not retain a full-layout min-height or fixed bottom inset above the keyboard");
const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
assert.match(app, /if \(isControlRoomTile \|\| window\.top !== window \|\| !window\.matchMedia\("\(pointer: coarse\)"\)\.matches\) return;\s*return installMobileViewport\(window\)/,
  "Desktop windows and embedded Control Room squares keep their existing geometry");
console.log("Mobile viewport: keyboard resize/pan, event coalescing, zoom, restore, cleanup, and Control Room isolation passed.");
