import assert from "node:assert/strict";
import fs from "node:fs";
import {
  canMergeControlRoomRegions,
  controlRoomTileUrl,
  controlRoomScreenCount,
  createControlRoomRegions,
  createControlRoomSlots,
  defaultControlRoomMachines,
  mergeControlRoomRegions,
  moveControlRoomSquareFocus,
  normalizeControlRoomCustomUrl,
  normalizeControlRoomLayout,
  normalizeControlRoomRegions,
  normalizeControlRoomSlots,
  normalizeControlRoomViewModes,
  normalizePoweredOffSlotIds,
  normalizeControlRoomMachines,
  resizeControlRoomSlots,
  splitControlRoomRegion,
  swapControlRoomSlots
} from "../src/controlRoomState";
import { advanceCompletionGlow, type CompletionGlowTracker } from "../src/controlRoomCompletion";
import { normalizeSavedDashboards } from "../src/controlRoomDashboards";
import { adjacentPowerSettingIndex, resolveControlRoomShortcut } from "../src/controlRoomShortcuts";

const shortcutEvent = (code: string) => ({ code, key: code === "Digit3" ? "3" : code === "Digit1" ? "1" : code === "KeyB" ? "b" : code, ctrlKey: true, altKey: false, metaKey: false });
assert.equal(resolveControlRoomShortcut(shortcutEvent("ArrowRight"), new Set(["ControlLeft", "Digit3", "ArrowRight"])), "model-right");
assert.equal(resolveControlRoomShortcut(shortcutEvent("ArrowLeft"), new Set(["ControlLeft", "Digit3", "ArrowLeft"])), "model-left");
assert.equal(resolveControlRoomShortcut({ ...shortcutEvent("ArrowRight"), key: "ArrowRight" }, new Set(["ControlLeft", "Digit2", "2", "ArrowRight", "arrowright"])), "scroll-up");
assert.equal(resolveControlRoomShortcut({ ...shortcutEvent("ArrowLeft"), key: "ArrowLeft" }, new Set(["ControlLeft", "Digit2", "2", "ArrowLeft", "arrowleft"])), "scroll-down");
assert.equal(resolveControlRoomShortcut({ ...shortcutEvent("Digit2"), key: "2" }, new Set(["ControlLeft", "KeyB", "b", "Digit2", "2"])), "chat-cycle");
assert.equal(resolveControlRoomShortcut(shortcutEvent("Digit3"), new Set(["ControlLeft", "KeyB", "Digit3"])), "fast-toggle");
assert.equal(resolveControlRoomShortcut(shortcutEvent("Digit1"), new Set(["ControlLeft", "KeyB", "Digit1"])), "mic-toggle");
assert.equal(resolveControlRoomShortcut({ ...shortcutEvent("Digit1"), ctrlKey: false }, new Set(["KeyB", "Digit1"])), null);
assert.equal(adjacentPowerSettingIndex(3, "left", 6), 2);
assert.equal(adjacentPowerSettingIndex(0, "left", 6), 0, "model movement should clamp at the left edge");
assert.equal(adjacentPowerSettingIndex(5, "right", 6), 5, "model movement should clamp at the right edge");

const machines = normalizeControlRoomMachines([
  { id: "one", name: "Machine One", url: "https://one.example.test/", token: "secret-one" },
  { id: "two", name: "Machine Two", url: "https://two.example.test", token: "secret-two" },
  { id: "one", name: "Duplicate", url: "https://duplicate.example.test", token: "ignored" },
  { id: "invalid", name: "Invalid", url: "file:///tmp/remote", token: "ignored" }
]);

assert.equal(machines.length, 2, "invalid and duplicate machines should be discarded");
assert.equal(machines[0].url, "https://one.example.test", "machine URLs should be normalized");
assert.equal(normalizeControlRoomCustomUrl(" https://dash.example.test/live "), "https://dash.example.test/live");
assert.equal(normalizeControlRoomCustomUrl("javascript:alert(1)"), "", "custom dashboards must be limited to http and https");
assert.equal(normalizeControlRoomCustomUrl("file:///c:/secrets"), "", "custom dashboards must not load local files");

assert.deepEqual(normalizeControlRoomLayout({ columns: 8, rows: 3 }), { columns: 8, rows: 3 });
assert.deepEqual(normalizeControlRoomLayout({ columns: 1, rows: 1 }), { columns: 1, rows: 1 });
assert.deepEqual(normalizeControlRoomLayout({ columns: 2, rows: 2 }), { columns: 2, rows: 2 });
assert.deepEqual(normalizeControlRoomLayout({ columns: 3, rows: 3 }), { columns: 3, rows: 3 });
assert.deepEqual(
  normalizeControlRoomLayout({ columns: 9, rows: 4 }),
  { columns: 5, rows: 2 },
  "unsupported layout values should fall back to the five-by-two default"
);
assert.equal(controlRoomScreenCount({ columns: 8, rows: 3 }), 24, "layout dimensions should determine screen count");
assert.equal(moveControlRoomSquareFocus(["a", "b", "c"], "", "next"), "a", "clockwise focus should begin at the first square");
assert.equal(moveControlRoomSquareFocus(["a", "b", "c"], "", "previous"), "c", "counter-clockwise focus should begin at the last square");
assert.equal(moveControlRoomSquareFocus(["a", "b", "c"], "c", "next"), "c", "knob focus should stop at the final square so another detent can switch rooms");
assert.equal(moveControlRoomSquareFocus(["a", "b", "c"], "a", "previous"), "a", "knob focus should stop at the first square so another detent can switch rooms");

const slots = createControlRoomSlots(machines, 10);
assert.equal(slots.length, 10, "the display wall should default to ten workspaces");
assert.deepEqual(
  slots.slice(0, 4).map((slot) => slot.machineId),
  ["", "", "", ""],
  "new workspaces should start terminated instead of opening arbitrary machines"
);
assert.equal(new Set(slots.map((slot) => slot.id)).size, slots.length, "every workspace needs an independent storage scope");

const regionLayout = { columns: 5 as const, rows: 2 as const };
const baseRegions = createControlRoomRegions(slots, regionLayout);
assert.equal(baseRegions.length, 10, "an unmerged wall should expose one region per workspace");
assert.equal(canMergeControlRoomRegions(baseRegions[0], baseRegions[1]), true, "horizontal neighbours should be mergeable");
assert.equal(canMergeControlRoomRegions(baseRegions[0], baseRegions[5]), true, "vertical neighbours should be mergeable");
assert.equal(canMergeControlRoomRegions(baseRegions[0], baseRegions[2]), false, "non-adjacent regions must not merge");

const horizontalMerge = mergeControlRoomRegions(baseRegions, baseRegions[0].id, baseRegions[1].id);
const horizontalRegion = horizontalMerge.find((region) => region.id === baseRegions[0].id)!;
assert.deepEqual(
  { row: horizontalRegion.row, column: horizontalRegion.column, rowSpan: horizontalRegion.rowSpan, columnSpan: horizontalRegion.columnSpan, masterSlotId: horizontalRegion.masterSlotId },
  { row: 0, column: 0, rowSpan: 1, columnSpan: 2, masterSlotId: slots[0].id },
  "merging should expand the source square and keep its content as the visible master"
);
assert.equal(horizontalMerge.length, 9, "the covered square should be parked rather than rendered");
assert.equal(slots.length, 10, "merging must not discard parked workspace state");

const verticalSplit = splitControlRoomRegion(horizontalMerge, horizontalRegion.id, "vertical", slots, regionLayout);
assert.equal(verticalSplit.length, 10, "splitting should restore the parked square");
assert.deepEqual(
  verticalSplit.filter((region) => region.row === 0 && region.column < 2).map((region) => region.masterSlotId),
  [slots[0].id, slots[1].id],
  "a vertical split should restore each original workspace identity to its cell"
);

const topPair = horizontalMerge;
const bottomPair = mergeControlRoomRegions(baseRegions, baseRegions[5].id, baseRegions[6].id);
const combinedRows = [
  ...topPair.filter((region) => ![baseRegions[5].id, baseRegions[6].id].includes(region.id)),
  ...bottomPair.filter((region) => region.id === baseRegions[5].id)
];
const mergedBlock = mergeControlRoomRegions(combinedRows, baseRegions[0].id, baseRegions[5].id);
const blockRegion = mergedBlock.find((region) => region.id === baseRegions[0].id)!;
assert.deepEqual(
  { rowSpan: blockRegion.rowSpan, columnSpan: blockRegion.columnSpan },
  { rowSpan: 2, columnSpan: 2 },
  "equal-width regions should merge into a rectangular block"
);
const horizontalSplit = splitControlRoomRegion(mergedBlock, blockRegion.id, "horizontal", slots, regionLayout);
assert.equal(horizontalSplit.some((region) => region.row === 1 && region.column === 0 && region.columnSpan === 2), true, "a horizontal split should restore the covered lower row");

assert.deepEqual(
  normalizeControlRoomRegions(undefined, slots, regionLayout),
  baseRegions,
  "older saved layouts should migrate to one region per square without changing square state"
);

const switchedSlots = swapControlRoomSlots(slots, "workspace-1", "workspace-4");
assert.equal(switchedSlots[0].id, "workspace-4", "moving a square should relocate its stable workspace identity");
assert.equal(switchedSlots[3].id, "workspace-1", "the destination square should switch back into the source position");
assert.equal(switchedSlots[0].machineId, slots[3].machineId, "the full square contents should move with its identity");
assert.deepEqual(
  normalizeControlRoomSlots(switchedSlots, machines, switchedSlots.length),
  switchedSlots,
  "a switched square order should survive application restart"
);

const expandedSlots = resizeControlRoomSlots(slots, 16, machines);
assert.deepEqual(expandedSlots.slice(0, 10), slots, "existing workspaces should survive grid expansion unchanged");
assert.deepEqual(
  expandedSlots.slice(10).map((slot) => slot.machineId),
  ["", "", "", "", "", ""],
  "newly added workspaces must start terminated instead of choosing random machines"
);
assert.equal(resizeControlRoomSlots(expandedSlots, 24, machines).length, 24, "the grid should support eight columns by three rows");
assert.deepEqual(
  resizeControlRoomSlots([{ id: "workspace-1", machineId: "", customUrl: "https://dash.example.test/" }], 1, machines),
  [{ id: "workspace-1", machineId: "", customUrl: "https://dash.example.test/" }],
  "custom dashboard assignments should survive resize and restart"
);
assert.equal(normalizeControlRoomCustomUrl("example.com/path"), "https://example.com/path", "bare dashboard hosts should default to HTTPS");
assert.equal(normalizeControlRoomCustomUrl("http://example.com/path"), "http://example.com/path", "explicit HTTP dashboard URLs should remain supported");

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

assert.equal(defaultControlRoomMachines.length, 4, "the native app should know all configured remotes before credentials arrive");
assert.equal(defaultControlRoomMachines[2]?.id, "thinkcentre-11", "ThinkCentre 11 should be available as a default machine");
assert.equal(defaultControlRoomMachines[3]?.id, "thinkcentre-1", "TC1 should be available as a default machine");

assert.deepEqual(normalizeSavedDashboards([
  { id: "ops", name: "Operations", url: "https://ops.example.test/", credentialMode: "form", hasCredentials: true, autoSubmit: true },
  { id: "monitor", name: "Agent monitor", url: "https://monitor.example.test/", credentialMode: "access-key", hasCredentials: true, autoSubmit: true },
  { id: "ops", name: "Duplicate", url: "https://duplicate.example.test" },
  { id: "unsafe", name: "Unsafe", url: "javascript:alert(1)" }
]), [
  { id: "ops", name: "Operations", url: "https://ops.example.test/", credentialMode: "form", hasCredentials: true, autoSubmit: true },
  { id: "monitor", name: "Agent monitor", url: "https://monitor.example.test/", credentialMode: "access-key", hasCredentials: true, autoSubmit: true }
]);

let glowTracker: CompletionGlowTracker = { chatId: null, pendingJobIds: [] };
let glowAdvance = advanceCompletionGlow(glowTracker, "chat-one", [
  { id: "job-one", status: "running" },
  { id: "job-two", status: "queued" }
]);
glowTracker = glowAdvance.tracker;
assert.equal(glowAdvance.completedJobId, null, "active work must not trigger the completion glow");
glowAdvance = advanceCompletionGlow(glowTracker, "chat-one", [
  { id: "job-one", status: "completed", finishedAt: "2026-08-01T10:00:00Z" },
  { id: "job-two", status: "running" }
]);
glowTracker = glowAdvance.tracker;
assert.equal(glowAdvance.completedJobId, null, "a completed task must wait while another queued task is still active");
glowAdvance = advanceCompletionGlow(glowTracker, "chat-one", [
  { id: "job-one", status: "completed", finishedAt: "2026-08-01T10:00:00Z" },
  { id: "job-two", status: "completed", finishedAt: "2026-08-01T10:01:00Z" }
]);
assert.equal(glowAdvance.completedJobId, "job-two", "the final completed task should trigger the glow when the queue drains");
assert.equal(
  advanceCompletionGlow(glowAdvance.tracker, "chat-one", [
    { id: "job-two", status: "completed", finishedAt: "2026-08-01T10:01:00Z" }
  ]).completedJobId,
  null,
  "an already observed completion must not glow again"
);
const switchedChat = advanceCompletionGlow(
  { chatId: "chat-one", pendingJobIds: ["old-job"] },
  "chat-two",
  [{ id: "old-job", status: "completed", finishedAt: "2026-08-01T10:02:00Z" }]
);
assert.equal(switchedChat.completedJobId, null, "switching chats must not inherit another chat's completion");

const controlRoomSource = fs.readFileSync(new URL("../src/ControlRoom.tsx", import.meta.url), "utf8");
const controlRoomCss = fs.readFileSync(new URL("../src/control-room.css", import.meta.url), "utf8");
const appSource = fs.readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const shortcutOverlaySource = fs.readFileSync(new URL("../src/ShortcutControlOverlay.tsx", import.meta.url), "utf8");
assert.match(appSource, /<ShortcutControlOverlay feedback=\{shortcutOverlay\.feedback\}/, "shortcut feedback should render inside the focused remote square");
assert.doesNotMatch(controlRoomSource, /<ShortcutControlOverlay/, "shortcut feedback must not cover the entire Control Room window");
assert.doesNotMatch(shortcutOverlaySource, /feedback\.detail/, "shortcut feedback should not render a secondary movement caption");
const wrapperSource = fs.readFileSync(new URL("../windows/Build-WebViewWrapper.ps1", import.meta.url), "utf8");
assert.match(controlRoomSource, /terminateSlot\(slot\.id\)/, "each live workspace should expose termination");
assert.match(controlRoomSource, /beginMoveSlot\(slot\.id\)/, "active and terminated squares should expose the move control");
assert.match(controlRoomSource, /swapControlRoomSlots\(current, movingSlotId, targetSlotId\)/, "choosing a destination should switch the two complete squares");
assert.match(controlRoomSource, /event\.key === "Escape"\) setMovingSlotId\(""\)/, "Escape should cancel square movement");
assert.match(controlRoomSource, /targetSlotId === movingSlotId/, "clicking the source square should cancel movement");
assert.match(controlRoomSource, /is-move-target/, "non-source squares should become dedicated move destinations");
assert.match(controlRoomSource, /codex-control-room-frame-state/, "native iframe failures should reach the affected square");
assert.match(controlRoomSource, /control-room-page-failure/, "failed pages should receive a subdued in-app replacement surface");
assert.match(controlRoomSource, /name=\{slot\.id\}/, "every iframe should expose its workspace identity to the native wrapper");
assert.match(controlRoomSource, /Select machine to start/, "terminated workspaces should require an explicit machine selection");
assert.match(controlRoomSource, /Load custom URL/, "every square should expose the custom dashboard editor");
assert.match(controlRoomSource, /Open saved dashboard/, "terminated squares should offer the saved dashboard library");
assert.match(controlRoomSource, /codex-control-room-dashboard-save/, "settings should send saved dashboard changes to the native vault");
assert.match(controlRoomSource, /<option value="access-key">Access key only<\/option>/, "saved dashboards should offer a one-secret access-key login mode");
assert.match(controlRoomSource, /draft\.credentialMode !== "access-key"/, "access-key dashboards should not ask for a username");
assert.match(controlRoomSource, /dashboardId: slot\.dashboardId/, "saved dashboard identity should be restored with its square");
assert.match(controlRoomSource, /!isCustomUrl && \(/, "custom URL squares must omit the statistics mode button");
assert.match(controlRoomSource, /event\.ctrlKey[\s\S]{0,160}event\.key === "ArrowDown"/, "Ctrl+Down should broadcast the global bottom command");
assert.match(appSource, /if \(isFreshControlRoomStart\) return true;/, "restarted workspaces should open with their sidebar active");
assert.match(appSource, /isFreshControlRoomStart[\s\S]{0,180}\? null[\s\S]{0,180}: firstChatId/, "freshly restarted workspaces should not choose a random chat");
assert.match(appSource, /codex-control-room-scroll-all-request/, "focused child chats should relay Ctrl+Down to the wall");
assert.match(appSource, /menu-open:\$\{controlRoomSlotId\}/, "each workspace should remember whether its side menu was open");
assert.match(appSource, /localStorage\.setItem\(controlRoomMenuOpenKey, String\(menuOpen\)\)/, "side menu state should persist as it changes");
assert.match(appSource, /<a href=\{href\} target="_blank" rel="noreferrer">/, "URLs in responses should request a separate browser window");
assert.match(wrapperSource, /window-state\.json/, "the Windows wrapper should persist its monitor placement");
assert.match(controlRoomSource, /codex-control-room-fullscreen/, "settings should send native fullscreen commands");
assert.match(controlRoomSource, /event\.key === "F11"/, "F11 should toggle fullscreen");
assert.match(controlRoomSource, /Exit fullscreen/, "settings should expose a clear way to leave fullscreen");
assert.match(controlRoomSource, /control-room-wake-identity/, "powered-off squares should retain their previous identity");
assert.match(controlRoomSource, /workspaceContext\?\.projectName/, "powered-off chat squares should show their last project");
assert.match(controlRoomSource, /workspaceContext\?\.chatTitle/, "powered-off chat squares should show their last chat");
assert.match(controlRoomSource, /poweredOffPrimary[\s\S]{0,220}chatProjectName \|\| ""/, "the project should be the primary display-off chat identity");
assert.match(controlRoomSource, /poweredOffSecondary[\s\S]{0,220}chatTitle \|\| ""/, "the chat should be the secondary display-off chat identity");
assert.match(controlRoomSource, /poweredOffPrimary && <strong>/, "missing legacy project metadata should not become a large placeholder");
assert.match(controlRoomSource, /workspaceContexts: Record<string, WorkspaceContext>/, "display-off chat identity should persist across restarts");
assert.match(controlRoomSource, /localStorage\.setItem\(storedWorkspaceContextsKey/, "display-off chat identity should have browser fallback persistence");
assert.match(appSource, /projectName: selectedChatForActions\?\.projectName/, "chat tiles should report their selected project to the wall");
assert.match(appSource, /chatTitle: selectedChatForActions\?\.title/, "chat tiles should report their selected chat to the wall");
assert.match(appSource, /codex-control-room-task-complete/, "chat tiles should report queue-draining completions to the wall");
assert.match(appSource, /addEventListener\("pointerdown", reportControlRoomInteraction, true\)/, "a tap inside the embedded chat should report activity and dismiss its glow");
assert.match(controlRoomSource, /is-task-complete/, "completed chats should receive a dedicated visual state");
assert.match(controlRoomCss, /control-room-task-complete-glow 1\.4s cubic-bezier\(0\.77, 0, 0\.175, 1\) infinite/, "completed chat overlay should fade smoothly in and out");
assert.match(controlRoomCss, /\.control-room-tile\.is-task-complete::after \{[\s\S]{0,120}inset: 0;/, "completed chat overlay should cover the entire square");
assert.match(controlRoomCss, /background: rgba\(82, 245, 139, 0\.8\)/, "completed chat overlay should reach 0.8 green opacity");
assert.match(controlRoomCss, /50% \{ opacity: 1; \}/, "completed chat overlay should reach its full configured opacity at the pulse peak");
assert.match(controlRoomCss, /inset 0 0 0 4px rgba\(87, 255, 148, 1\)/, "completed chat glow should use a strong green border");
assert.match(controlRoomSource, /delete next\[slotId\]/, "completion dismissal should remove only the selected square's glow");
assert.match(controlRoomSource, /dismissCompletionGlow\(message\.slotId\)/, "an embedded chat tap should dismiss only its own square");
assert.match(controlRoomSource, /frame === document\.activeElement/, "a cross-origin dashboard tap should resolve its individual square");
assert.match(controlRoomSource, /control-room-completion-dismiss/, "each glowing square should expose its own full-square dismissal target");
assert.doesNotMatch(controlRoomSource, /onPointerDownCapture=\{dismissCompletionGlows\}/, "the wall must not globally clear completion glows");
assert.match(controlRoomSource, /!isPoweredOff && !isFrozen && nativeStateHydrated && \([\s\S]{0,120}<iframe/, "powered-off and frozen squares must unmount their iframe and stop its network activity");
assert.match(controlRoomSource, /codex-control-room-frozen-square-capture/, "live squares should expose native screenshot freezing");
assert.match(controlRoomSource, /freezeCaptureTimeoutMs = 15_000/, "a failed native capture should not leave the camera button loading forever");
assert.match(controlRoomSource, /frozenSlotIds: Array\.from\(frozenSlots\)/, "frozen state should survive an application restart");
assert.match(controlRoomCss, /\.control-room-terminated-content > strong[^}]*clamp\(22px, 2vw, 38px\)/, "terminated square titles should be legible from across the room");
assert.match(controlRoomCss, /\.control-room-wake-identity strong[\s\S]{0,180}clamp\(28px, 2\.2vw, 44px\)/, "the previous workspace identity should dominate display-off squares");
assert.match(controlRoomCss, /\.control-room-wake-status[\s\S]{0,180}font-size: 10px/, "the generic display-off label should remain subordinate");
assert.match(controlRoomSource, /savedDashboard\?\.name \|\| new URL\(customUrl\)\.hostname/, "saved custom dashboards should display their saved name instead of their URL");
assert.match(appSource, /controlRoomBackgroundSyncIntervalMs = 30_000/, "idle chat squares should use a low-frequency reconciliation loop");
assert.match(appSource, /controlRoomActiveJobSyncIntervalMs = 10_000/, "active chat squares should rely on sockets between lightweight HTTP reconciliations");
assert.match(appSource, /controlRoomSessionActivitySyncIntervalMs = 30_000/, "session discovery should be throttled inside Control Room squares");
assert.match(appSource, /isControlRoomTile && socketLive \? controlRoomBackgroundSyncIntervalMs : backgroundSyncIntervalMs/, "chat squares should restore fast HTTP fallback when their socket is unavailable");
assert.match(wrapperSource, /FormBorderStyle = FormBorderStyle\.None/, "native fullscreen should remove the Windows frame");
assert.match(wrapperSource, /fullscreen = isFullscreen/, "native fullscreen state should persist with window placement");
assert.match(wrapperSource, /codex-control-room-window-state/, "the Windows wrapper should confirm fullscreen state to the UI");
assert.match(wrapperSource, /controller\.AcceleratorKeyPressed \+= HandleAcceleratorKeyPressed/, "the native wrapper should reserve the knob focus shortcuts");
assert.match(wrapperSource, /SetWindowsHookEx\(WhKeyboardLl, globalKeyboardCallback/, "the global hotkey owner should acknowledge completion light from any foreground application");
assert.match(wrapperSource, /HandleGlobalKeyboardEvent[\s\S]{0,500}AcknowledgeCompletionLight/, "global keyboard events should dismiss the completion light without recording key contents");
assert.match(wrapperSource, /eventArgs\.VirtualKey == 0x25[\s\S]{0,120}0x27/, "the native wrapper should map left and right shortcuts to focus navigation");
assert.doesNotMatch(wrapperSource, /rapidKnob|gapMilliseconds|knobRoomSwitchCooldown/, "room switching should not depend on rotation speed or timing");
assert.match(controlRoomSource, /nextSlotId === currentSlotId[\s\S]{0,180}codex-control-room-switch-request/, "turning past either square endpoint should request a room switch");
assert.match(wrapperSource, /message\.type == "codex-control-room-switch-request"[\s\S]{0,180}SwitchControlRoom\(message\.direction\)/, "the wrapper should switch rooms only after an endpoint request");
assert.match(wrapperSource, /direction == "next" \? 1 : -1/, "square and room traversal should use the same configured knob direction");
assert.match(wrapperSource, /FindWindow\(null, ControlRoomWindowTitle\(instanceId\)\)/, "open control rooms should be found directly without scanning every process");
assert.doesNotMatch(wrapperSource, /Process\.GetProcesses\(\)/, "knob routing should not scan every process on each detent");
assert.match(wrapperSource, /GetWindowThreadProcessId\(targetWindow, out targetProcessId\)[\s\S]{0,120}AllowSetForegroundWindow\(targetProcessId\)/, "the global hotkey owner should grant foreground rights to the room handling the detent");
assert.match(wrapperSource, /SetForegroundWindow\(windowHandle\)[\s\S]{0,120}SendMessage\(windowHandle, ActivateControlRoomMessage/, "the active source room should grant the target foreground access before handing off focus");
assert.match(wrapperSource, /SendMessage\(windowHandle, ActivateControlRoomMessage, new IntPtr/, "the selected room should synchronously receive WebView and endpoint focus");
assert.match(wrapperSource, /webView\.Select\(\)[\s\S]{0,100}webView\.Focus\(\)[\s\S]{0,120}PostKnobFocus/, "room activation should focus the WebView before selecting its endpoint square");
assert.match(wrapperSource, /ClearKnobFocus\(\)[\s\S]{0,180}SendMessage/, "the departing room should explicitly clear its focused square");
assert.match(wrapperSource, /openWindows\.TryGetValue\(instanceIds\[targetIndex\], out windowHandle\)/, "room switching should skip control rooms that are not open");
assert.match(wrapperSource, /eventArgs\.VirtualKey == 0x30/, "the native wrapper should reserve the top-left pad key for display-off");
assert.match(wrapperSource, /"turn-off-display"/, "the native wrapper should send a named display-off action");
assert.match(wrapperSource, /eventArgs\.VirtualKey == 0x39/, "the native wrapper should reserve the top-right pad key for far-view focus");
assert.match(wrapperSource, /"toggle-far-view-focus"/, "the native wrapper should send a named far-view toggle action");
assert.match(controlRoomSource, /message\.action === "toggle-far-view-focus" && slotId/, "far-view pad actions should require a focused square");
assert.match(controlRoomSource, /control-room-knob-focus/, "the wall should receive native knob focus navigation");
assert.match(controlRoomSource, /is-terminated-focus/, "terminated squares should render a distinct knob focus treatment");
assert.match(controlRoomSource, /farViewFocusEnabled/, "the Control Room should persist its far-view focus option");
assert.match(controlRoomSource, /sourceWidth \* 2/, "far-view focus should double the selected square width");
assert.match(controlRoomCss, /\.control-room-tile\.is-far-view-focused[\s\S]{0,800}transform: scale\(1\.4\)[\s\S]{0,120}transform-origin: 0 0/, "far-view focus should lift the square and scale its live page to 140 percent without changing the control path");
assert.match(controlRoomSource, /storedLastActiveSlotKey/, "each room should persist its last interacted square");
assert.match(controlRoomSource, /focusableSlotIds\.includes\(rememberedSlotId\)/, "new knob focus should restore the last interacted visible square");
assert.match(controlRoomSource, /onPointerDownCapture=[\s\S]{0,300}data-control-room-slot-id/, "pointer interaction should update the last active square");
assert.match(appSource, /codex-control-room-active/, "embedded chats should report direct user interaction to their parent square");
assert.match(controlRoomSource, /message\.type === "codex-control-room-active"[\s\S]{0,120}rememberActiveSlot/, "the wall should remember interaction reported from an embedded chat");
assert.match(wrapperSource, /RegisterHotKey\(Handle, PreviousKnobHotkeyId/, "one open wrapper should register knob rotation globally");
assert.match(wrapperSource, /GetForegroundWindow\(\)/, "global knob routing should detect whether a Control Room is already active");
assert.match(wrapperSource, /last-active-control-room\.txt/, "global knob routing should remember the most recently active room");
assert.match(wrapperSource, /"resume-next" : "resume-previous"/, "rotation from another app should restore focus inside the last active room");
assert.match(controlRoomSource, /ref=\{\(node\) => \{ tileRefs\.current\[slot\.id\] = node; \}\}/, "terminated squares should expose a focusable tile reference");
assert.match(controlRoomSource, /useMemo\(\(\) => visibleSlots\.map\(\(slot\) => slot\.id\)/, "knob traversal should include live, display-off, frozen, and terminated squares");
assert.match(controlRoomSource, /event\.code !== "Digit1"[\s\S]{0,100}has\("KeyB"\)/, "the wall should recognize Ctrl+B+1 for non-live focused squares");
assert.match(controlRoomSource, /poweredOffSlots\.has\(slotId\)[\s\S]{0,180}setSlotDisplay\(slotId, true\)/, "knob press should wake a focused display-off square");
assert.match(controlRoomSource, /frozenSlots\.has\(slotId\)[\s\S]{0,180}clearFrozenSlot\(slotId\)/, "knob press should resume a focused frozen square");
assert.match(controlRoomSource, /document\.hasFocus\(\)/, "knob focus should clear when the Control Room window loses focus");
assert.match(controlRoomSource, /message\.direction === "clear"\) clearKeyboardFocus\(\)/, "native room switching should clear stale square focus explicitly");
assert.match(controlRoomSource, /onPointerMove=\{keyboardFocusedSlotId \? clearKeyboardFocus/, "mouse movement should clear knob focus");
assert.match(wrapperSource, /WorkingArea\.IntersectsWith\(bounds\)/, "saved window placement should be rejected when every monitor is disconnected");
assert.match(wrapperSource, /UserDataFolderName = \"\$csUserDataFolder\"/, "each native instance should receive an explicit WebView2 memory folder");
assert.match(wrapperSource, /SHGetKnownFolderPath[\s\S]{0,500}0x00010000/, "native state must bypass packaged LocalAppData redirection");
assert.match(wrapperSource, /control-room-state\.json/, "each Control Room instance should keep a native grid snapshot");
assert.match(wrapperSource, /codex-control-room-state-save/, "the native wrapper should persist grid snapshots sent by the wall");
assert.match(wrapperSource, /CapturePreviewAsync/, "the native wrapper should capture a frozen square without keeping its iframe alive");
assert.match(wrapperSource, /GetSystemTimes/, "the native wrapper should sample host CPU without spawning helper processes");
assert.match(wrapperSource, /GlobalMemoryStatusEx/, "the native wrapper should sample host RAM through the Windows API");
assert.match(wrapperSource, /new DriveInfo\("C:\\\\"\)\.AvailableFreeSpace/, "the native wrapper should report free C drive space");
assert.match(wrapperSource, /Environment\.GetProcessInfos\(\)/, "instance RAM should include this Control Room's WebView2 processes");
assert.match(wrapperSource, /resourceUsageTimer\.Interval = 2000/, "resource telemetry should use a lightweight two-second cadence");
assert.match(controlRoomSource, /codex-control-room-resource-usage/, "the Control Room should receive native resource telemetry");
assert.match(controlRoomSource, /ROOM RAM/, "the header should identify per-instance Control Room memory");
assert.match(controlRoomCss, /\.control-room-host-metrics/, "host metrics should have a compact top-bar treatment");
assert.match(wrapperSource, /frozen-squares/, "frozen screenshots should survive Windows application restarts");
assert.match(controlRoomSource, /nativeStateHydratedRef/, "browser fallback state must not overwrite the native snapshot during startup");
assert.match(wrapperSource, /DashboardForNavigation/, "saved dashboard authentication should recover its origin association after reboot");
assert.match(appSource, /defaultChatMessageViewMode: ChatMessageViewMode = \"final\"/, "new chats should default to Final mode");
assert.match(wrapperSource, /instanceId = InstanceId/, "the native wrapper should identify its instance to the wall");
assert.match(controlRoomSource, /codex-control-room-profiles-request/, "the wall should request native profiles after its listener is ready");
assert.match(controlRoomSource, /authenticationRetryMs = 10_000/, "square authentication retries should not overlap slow remote verification");
assert.match(controlRoomSource, /!machine\?\.token/, "the wall must not submit empty fallback credentials before native profiles arrive");
assert.doesNotMatch(controlRoomSource, /}, 2000\);/, "the wall must not flood connecting squares every two seconds");
assert.match(wrapperSource, /message\.type == "codex-control-room-profiles-request"[\s\S]{0,160}SendMachineProfiles\(\)/, "the native wrapper should answer profile requests");
assert.match(wrapperSource, /NewWindowRequested[\s\S]{0,700}Process\.Start/, "links opened by response tiles should launch through Windows");
assert.match(wrapperSource, /UseShellExecute = true/, "external links should use the user's default browser");
assert.doesNotMatch(wrapperSource, /NewWindowRequested[\s\S]{0,250}CoreWebView2\.Navigate\(args\.Uri\)/, "new-window links must not replace Control Room");
assert.match(wrapperSource, /FrameNavigationStarting/, "the Windows wrapper should authorize trusted iframe navigations before policy checks");
assert.match(wrapperSource, /FrameCreated[\s\S]{0,800}NavigationCompleted/, "the Windows wrapper should observe completed iframe navigation");
assert.match(wrapperSource, /HttpStatusCode >= 400/, "HTTP error pages should be replaced as failures");
assert.match(wrapperSource, /codex-control-room-frame-state/, "the Windows wrapper should identify a failed square to the wall");
assert.match(wrapperSource, /AdditionalAllowedFrameAncestors = TrustedFrameAncestor/, "embedded sites should allow only the Control Room origin as an extra ancestor");
assert.match(wrapperSource, /frame\.NavigationStarting[\s\S]{0,500}AdditionalAllowedFrameAncestors = TrustedFrameAncestor/, "nested external pages should receive the same trusted frame authorization");
assert.match(wrapperSource, /--allow-running-insecure-content/, "explicit HTTP dashboards should load inside the HTTPS Control Room shell");
assert.match(wrapperSource, /"Shared",[\s\S]{0,100}"saved-dashboards\.json"/, "all Control Room instances should use one shared dashboard vault");
assert.match(wrapperSource, /FileSystemWatcher\(directory, Path\.GetFileName\(dashboardStorePath\)\)/, "open Control Rooms should receive shared dashboard updates immediately");
assert.match(wrapperSource, /ProtectedData\.Protect\(clear, null, DataProtectionScope\.CurrentUser\)/, "dashboard credentials should be encrypted for the current Windows account");
assert.match(wrapperSource, /BasicAuthenticationRequested/, "saved dashboards should support HTTP Basic authentication");
assert.match(wrapperSource, /AutoFillDashboard\(frame, slotId, navigatedUrl\)/, "saved form credentials should be applied only to the selected dashboard square");
assert.match(wrapperSource, /dashboard\.credentialMode == "access-key"[\s\S]{0,160}!string\.IsNullOrEmpty\(dashboard\.encryptedPassword\)/, "access-key dashboards should require only one encrypted secret");
assert.match(wrapperSource, /mode ===? 'access-key'|mode==='access-key'/, "the native wrapper should target a single access-key field");
assert.match(wrapperSource, /input\[name\*=\\"access-key\\" i\]/, "access-key autofill should recognize explicitly named key inputs");
assert.match(wrapperSource, /saved\.Scheme != navigated\.Scheme \|\| saved\.Host != navigated\.Host \|\| saved\.Port != navigated\.Port/, "form credentials must never be filled outside the saved dashboard origin");
assert.doesNotMatch(controlRoomSource, /encryptedPassword|encryptedUsername/, "encrypted credential material should never be exposed to the web UI");
assert.match(wrapperSource, /GetLeftPart\(UriPartial\.Authority\)/, "frame authorization should be restricted to the installed Control Room origin");
assert.doesNotMatch(wrapperSource, /Fetch\.requestPaused|Fetch\.fulfillRequest/, "iframe compatibility must not reconstruct or proxy another project's responses");
assert.match(controlRoomSource, /control-room-instance/, "named instances should be visibly identifiable in the wall header");

const installerSource = fs.readFileSync(new URL("../windows/ControlRoom/Install-ControlRoom.ps1", import.meta.url), "utf8");
const fleetInstallerSource = fs.readFileSync(new URL("../windows/ControlRoom/Install-Six-ControlRoomInstances.ps1", import.meta.url), "utf8");
const padProgrammerSource = fs.readFileSync(new URL("./program-control-room-knob.ts", import.meta.url), "utf8");
assert.match(padProgrammerSource, /index: 3, gesture: "top-left key", shortcut: "Ctrl\+Alt\+0"/, "physical top-left must use vendor index 3 from the pad's rotated matrix");
assert.match(padProgrammerSource, /index: 15, gesture: "top-right key", shortcut: "Ctrl\+Alt\+9"/, "physical top-right must use vendor index 15 from the pad's rotated matrix");
assert.match(padProgrammerSource, /index: 0, gesture: "bottom-left key", shortcut: "Left Ctrl", bytes: \[32, 1, 0, 0\]/, "physical bottom-left must act as held Left Ctrl");
assert.match(padProgrammerSource, /index: 12, gesture: "bottom-right key", shortcut: "Enter", bytes: \[32, 0, 40, 0\]/, "physical bottom-right must act as Enter");
assert.match(padProgrammerSource, /index: 17, gesture: "counter-clockwise"[\s\S]{0,80}bytes: \[32, 5, 79, 0\]/, "knob 1 counter-clockwise should move focus to the next square");
assert.match(padProgrammerSource, /index: 18, gesture: "clockwise"[\s\S]{0,80}bytes: \[32, 5, 80, 0\]/, "knob 1 clockwise should move focus to the previous square");
assert.match(padProgrammerSource, /index: 16, gesture: "knob 1 press", shortcut: "Ctrl\+B\+1"/, "knob 1 press should use macro chord Ctrl+B+1");
assert.match(padProgrammerSource, /index: 19, gesture: "knob 2 press", shortcut: "Ctrl\+B\+2"/, "knob 2 press should use macro chord Ctrl+B+2");
assert.match(padProgrammerSource, /index: 22, gesture: "knob 3 press", shortcut: "Ctrl\+B\+3"/, "knob 3 press should use macro chord Ctrl+B+3");
assert.match(padProgrammerSource, /index: 20, gesture: "knob 2 rotate left", shortcut: "Ctrl\+2\+ArrowRight"/, "knob 2 left should use reversed ArrowRight");
assert.match(padProgrammerSource, /index: 21, gesture: "knob 2 rotate right", shortcut: "Ctrl\+2\+ArrowLeft"/, "knob 2 right should use reversed ArrowLeft");
assert.match(padProgrammerSource, /index: 23, gesture: "knob 3 rotate left", shortcut: "Ctrl\+3\+ArrowRight"/, "knob 3 left should use reversed ArrowRight");
assert.match(padProgrammerSource, /index: 24, gesture: "knob 3 rotate right", shortcut: "Ctrl\+3\+ArrowLeft"/, "knob 3 right should use reversed ArrowLeft");
assert.match(installerSource, /\$isNamedInstance/, "the installer should distinguish default and named instances");
assert.match(installerSource, /CodexRemote\.ControlRoom\.\$InstanceId/, "named instances should have unique Windows app identities");
assert.match(installerSource, /CodexControlRoom-\$InstanceId/, "named instances should have isolated WebView2 memory folders");
assert.match(installerSource, /\$InstallRoot = \$BaseInstallRoot/, "the default instance should retain its legacy installation root");
assert.match(installerSource, /CustomIconPath/, "an installation should accept a custom shortcut and executable icon");
assert.match(installerSource, /control-room-1\.ico/, "the default Control Room installer should retain the numbered Control Room icon");
assert.match(installerSource, /Set-ShortcutAppUserModelId\.ps1/, "installed shortcuts should share the executable AppUserModelID");
assert.match(fleetInstallerSource, /Number = 6; Id = "instance-6"/, "the desktop fleet should define six independent instances");
assert.match(fleetInstallerSource, /control-room-\$\(\$instance\.Number\)\.ico/, "every fleet shortcut should receive its numbered icon");

console.log("Control room checks passed");
