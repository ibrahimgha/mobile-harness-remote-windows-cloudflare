import assert from "node:assert/strict";
import "./check-mobile-viewport";
import { readFileSync } from "node:fs";
import { installStatusBarScrollBridge, supportsStatusBarScrollBridge } from "../src/statusBarScroll";
import { animateTranscriptScroll, scrollTranscriptToTop, transcriptScrollElements } from "../src/chatScroll";

const ios = { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X)", maxTouchPoints: 5 };
assert.equal(supportsStatusBarScrollBridge(ios, true), true);
assert.equal(supportsStatusBarScrollBridge({ ...ios, standalone: true }, false), true);
assert.equal(supportsStatusBarScrollBridge(ios, false), false, "Ordinary Safari must retain its native document layout");
assert.equal(supportsStatusBarScrollBridge({ userAgent: "Android Chrome", maxTouchPoints: 5 }, true), false);
assert.equal(supportsStatusBarScrollBridge({ userAgent: "Macintosh", maxTouchPoints: 0 }, true), false);
assert.equal(supportsStatusBarScrollBridge({ userAgent: "Macintosh", maxTouchPoints: 5 }, true), true);

const attributes = new Map<string, string>();
const fakeDocument = Object.assign(new EventTarget(), {
  documentElement: {
    getAttribute: (key: string) => attributes.get(key) ?? null,
    setAttribute: (key: string, value: string) => { attributes.set(key, value); },
    removeAttribute: (key: string) => { attributes.delete(key); }
  },
  visibilityState: "visible",
  activeElement: { matches: () => false }
});
const fakeView = Object.assign(new EventTarget(), {
  document: fakeDocument,
  scrollY: 0,
  visualViewport: new EventTarget(),
  setTimeout,
  clearTimeout,
  scrollTo({ top }: { top: number }) {
    this.scrollY = top;
    queueMicrotask(() => this.dispatchEvent(new Event("scroll")));
  }
});
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let requests = 0;
const stop = installStatusBarScrollBridge(fakeView as unknown as Window, () => {
  requests += 1;
  // A layout update inside the callback can synchronously report another
  // document scroll. The bridge must be disarmed before calling its consumer.
  fakeView.dispatchEvent(new Event("scroll"));
});
await delay(100);
assert.equal(fakeView.scrollY, 1);
fakeView.scrollTo({ top: 0 });
await delay(100);
assert.equal(requests, 1);
assert.equal(fakeView.scrollY, 0, "The bridge must not fight an unfinished native status-bar animation");
fakeView.scrollTo({ top: 0 });
await delay(100);
fakeView.scrollTo({ top: 0 });
await delay(650);
assert.equal(requests, 1, "One native gesture can report zero repeatedly; it must navigate only once");
assert.equal(fakeView.scrollY, 1, "The status-bar shortcut must re-arm after each tap");
fakeView.scrollTo({ top: 0 });
await delay(650);
assert.equal(requests, 2);
const focus = (editable: boolean) => {
  const event = new Event("focusin");
  Object.defineProperty(event, "target", { value: { matches: () => editable } });
  fakeDocument.dispatchEvent(event);
};
focus(false);
fakeView.scrollTo({ top: 0 });
await delay(650);
assert.equal(requests, 3, "The down button gaining focus must not suppress the next status-bar tap");
focus(true);
fakeView.scrollTo({ top: 0 });
await delay(100);
assert.equal(requests, 3, "Opening the keyboard must not count as a status-bar gesture");
fakeView.dispatchEvent(new Event("resize"));
fakeView.scrollTo({ top: 0 });
await delay(100);
assert.equal(requests, 3, "Viewport resizing must not navigate the chat");
fakeDocument.activeElement.matches = () => true;
fakeDocument.dispatchEvent(new Event("focusin"));
fakeView.scrollTo({ top: 0 });
await delay(100);
assert.equal(requests, 3, "Keyboard focus must not navigate the chat");
fakeView.scrollTo({ top: 270 });
await delay(650);
assert.equal(fakeView.scrollY, 270, "Re-arming while typing or opening Paste must not reset WebKit's focus pan");
fakeView.scrollTo({ top: 0 });
await delay(650);
assert.equal(requests, 4, "An existing native scroll offset still supports a status-bar tap while editing");
assert.equal(fakeView.scrollY, 0, "The bridge leaves an active editor's native scroll position alone");
fakeDocument.activeElement.matches = () => false;
const blur = new Event("focusout");
Object.defineProperty(blur, "target", { value: { matches: () => true } });
fakeDocument.dispatchEvent(blur);
await delay(600);
assert.equal(fakeView.scrollY, 1, "Dismissal restores the one-pixel native status-bar gesture range");
stop();
await delay(10);
assert.equal(attributes.has("data-status-bar-scroll"), false);
assert.equal(fakeView.scrollY, 0, "Cleanup must restore the original document offset");
assert.equal(requests, 4, "Cleanup must not cause a scroll-to-top request");

// Explicit navigation has exactly one owner, even with nested scrollable code,
// an editor, or the one-pixel iOS document bridge present.
const scrollCalls: ScrollToOptions[] = [];
const transcript = {
  scrollLeft: 12,
  scrollTo: (options: ScrollToOptions) => scrollCalls.push(options),
  querySelector: () => { throw new Error("Must not guess an inner scroll owner"); }
} as unknown as HTMLElement;
assert.deepEqual(transcriptScrollElements(transcript), [transcript]);
assert.equal(scrollTranscriptToTop(transcript), transcript);
assert.deepEqual(scrollCalls, [{ top: 0, left: 12, behavior: "instant" }],
  "One atomic scroll cancels smooth motion without conflicting scrollTop writes");

let nextFrameId = 1;
const frameCallbacks = new Map<number, FrameRequestCallback>();
const animationView = {
  requestAnimationFrame(callback: FrameRequestCallback) {
    const id = nextFrameId++;
    frameCallbacks.set(id, callback);
    return id;
  },
  cancelAnimationFrame(id: number) { frameCallbacks.delete(id); }
};
const runFrame = (timestamp: number) => {
  const callbacks = [...frameCallbacks.values()];
  frameCallbacks.clear();
  for (const callback of callbacks) callback(timestamp);
};
const animatedScroller = {
  scrollTop: 800,
  scrollHeight: 1000,
  clientHeight: 200,
  ownerDocument: { defaultView: animationView }
} as unknown as HTMLElement;
const topPositions: number[] = [];
const topAnimation = animateTranscriptScroll(animatedScroller, 0, { durationMs: 420, onScroll: () => topPositions.push(animatedScroller.scrollTop) });
for (const timestamp of [0, 105, 210, 315, 420]) runFrame(timestamp);
assert.equal(topAnimation.active, false);
assert.equal(animatedScroller.scrollTop, 0);
assert.ok(topPositions.slice(1).every((position, index) => position <= topPositions[index]), "Top animation must move monotonically upward");
animatedScroller.scrollTop = 0;
const bottomPositions: number[] = [];
const bottomAnimation = animateTranscriptScroll(animatedScroller, 800, { durationMs: 420, onScroll: () => bottomPositions.push(animatedScroller.scrollTop) });
for (const timestamp of [0, 105, 210, 315, 420]) runFrame(timestamp);
assert.equal(bottomAnimation.active, false);
assert.equal(animatedScroller.scrollTop, 800);
assert.ok(bottomPositions.slice(1).every((position, index) => position >= bottomPositions[index]), "Bottom animation must move monotonically downward");
assert.deepEqual(bottomPositions.map((position, index) => Math.round(position + topPositions[index])), [800, 800, 800, 800, 800, 800],
  "Top and bottom must use the same mirrored easing curve");
animatedScroller.scrollTop = 400;
const cancelledAnimation = animateTranscriptScroll(animatedScroller, 0, { durationMs: 420 });
runFrame(0);
cancelledAnimation.cancel();
runFrame(420);
assert.equal(animatedScroller.scrollTop, 400, "Manual cancellation must stop an in-flight animation");

const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const topHandler = app.slice(app.indexOf("const scrollChatToTop ="), app.indexOf("return installStatusBarScrollBridge"));
assert.match(topHandler, /\+\+chatScrollGenerationRef\.current/, "Top navigation invalidates queued bottom corrections");
assert.match(topHandler, /forceNextChatScrollRef\.current = false/);
assert.match(topHandler, /chatTopRequestedRef\.current = true/);
assert.match(topHandler, /prependScrollKeeperRef\.current\?\.stop\(\)/);
assert.match(topHandler, /const scroller = chatContentRef\.current/, "Top navigation targets the transcript, not a nested code block");
assert.match(topHandler, /animateTranscriptScroll\(scroller, 0/, "Top navigation must use the shared transcript animation");
assert.doesNotMatch(topHandler, /style\.overflow/, "Top navigation must not destroy and recreate active scroll layers");
assert.doesNotMatch(app, /collectScrollTargets|findScrollElementAtPoint|document\.scrollingElement|scrollIntoView/,
  "Chat navigation must not move the document, app shell, editor, or nested panels");
const releaseHandler = app.slice(app.indexOf("const releaseChatScroll ="), app.indexOf("const scrollChatToTop ="));
assert.match(releaseHandler, /chatScrollGenerationRef\.current \+= 1/, "Manual gestures cancel pending automatic navigation");
assert.match(releaseHandler, /if \(!loadingMoreMessagesRef\.current\) preserveChatScrollRef\.current = null/,
  "Scrolling during history fetch must preserve the reader's latest position when that page arrives");
const inputHandlers = app.slice(app.indexOf("const handleScrollKey ="), app.indexOf('window.addEventListener("scroll", handleCapturedScroll'));
for (const name of ["handleScrollKey", "handleScrollPointer", "handleWheel", "handleTouchMove"]) {
  assert.match(inputHandlers.slice(inputHandlers.indexOf(`const ${name} =`)), /releaseChatScroll\(\)/,
    `${name} must release all older automatic navigation`);
}
const bottomHandler = app.slice(app.indexOf("const scrollChatToBottom ="), app.indexOf("const releaseChatScroll ="));
assert.match(bottomHandler, /animateTranscriptScroll\(element, destination/, "Bottom navigation must use the shared transcript animation");
assert.doesNotMatch(bottomHandler, /dataset\.statusBarScroll/, "The iPhone PWA must not downgrade the button animation to an instant jump");
assert.doesNotMatch(bottomHandler, /900/, "Smooth bottom navigation must not snap back after the reader swipes away");
assert.doesNotMatch(app, /scroll-to-top-button|aria-label="Scroll to top of chat"|onClick=\{scrollChatToTop\}/,
  "Scroll-to-top belongs to the native iPhone status bar, not a header button or invisible web hit target");
assert.match(app, /isControlRoomTile \|\| window\.top !== window/, "Native bridge must not change Control Room document layout");
assert.match(app, /return installStatusBarScrollBridge\(window, scrollChatToTop\)/,
  "Removing the button must retain native status-bar navigation");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const threadStyles = styles.slice(styles.indexOf(".chat-thread {"), styles.indexOf(".chat-thread::after"));
assert.match(threadStyles, /flex: 0 0 auto/, "The transcript must retain its full content height in a flex parent");
assert.match(threadStyles, /overflow-x: clip/);
assert.match(threadStyles, /overflow-y: visible/,
  "Clipping horizontal overflow must not create a second vertical scroll container in WebKit");
assert.match(styles, /html\[data-status-bar-scroll="true"\][\s\S]*?overflow-y: scroll/,
  "WebKit needs a scrollable document for its system status-bar gesture");
assert.match(styles, /height: calc\(100% \+ 1px\)/);
assert.match(styles, /html\[data-status-bar-scroll="true"\] #root\s*\{\s*position: fixed/,
  "The one-pixel native gesture scroll range must not move the app UI");
console.log("Scroll-to-top navigation and iOS status-bar bridge checks passed.");
