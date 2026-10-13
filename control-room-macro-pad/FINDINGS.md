# Control Room Macro Pad: feasibility and project brief

Date: 2026-08-03

## Outcome

The photographed macro pad is a viable physical controller for the six installed Codex Control Room instances. It can reproduce most of Codex Micro's command, navigation, and room-selection behavior. The best route is:

1. Use the manufacturer's web configurator to make every physical control emit a unique, otherwise-unused key chord.
2. Add device-aware handling to the existing Windows WebView2 Control Room wrapper (or a small companion process) so commands work even when an embedded workspace has focus.
3. Feed live room/chat state from the existing Control Room APIs and WebSocket events into the helper.
4. Treat per-key status lighting as an experiment. The pad has a vendor-defined HID interface and the configurator can change global lighting, but per-key, real-time host-controlled RGB has not been verified.

The controller can deliver useful room and task controls without reverse-engineering the lighting protocol. Lighting can follow after the controls work.

## Hardware identification

> **Physical orientation:** With the knobs at the top and USB cable on the left, the vendor grid is rotated 90°. The physical top row is `3, 7, 11, 15`; the bottom row is `0, 4, 8, 12`. See [ORIENTATION.md](./ORIENTATION.md). Physical top-left is index `3`, top-right is `15`, bottom-left is `0`, and bottom-right is `12`.

Evidence from the supplied photos:

- 4×4 grid: 16 mechanical keys.
- Three rotary encoders; each appears pressable, yielding up to nine encoder gestures (left, right, press per knob).
- USB-C wired connection.
- Manual identifies Shenzhen Hongchengyi Technology Co., Ltd. and the browser configurator at `https://www.sdcx-tech.com`.

Evidence from the connected Windows machine:

- Bus-reported name: `SIDE-KEYBOARD`.
- USB vendor/product ID: `VID_0816`, `PID_2475`.
- Serial: `267E01678182`.
- It exposes a composite USB device with standard keyboard, mouse/consumer-control, and vendor-defined HID interfaces.

The vendor-defined HID interface matters because it is how the WebHID configurator stores profiles and lighting settings. The official configurator's deployed device catalog includes `0816_2475`, matching this unit.

## Confirmed manufacturer capabilities

The manufacturer's current documentation/configurator supports:

- Basic keyboard mappings.
- Mouse buttons and scrolling.
- Media controls.
- One-key key combinations.
- Recorded macros.
- Shortcut-based launching of Windows applications, files, and folders.
- Six onboard configuration layers.
- Lighting effects, brightness, speed, direction, and color configuration.
- Persistent onboard configuration: the configurator can be closed after saving.

Important limits and unknowns:

- The six layers advance one at a time in sequence; the manufacturer's FAQ says there is no direct jump to a chosen layer and no reliable external layer indicator.
- The public documentation does not describe a stable HID protocol.
- The deployed configurator uses WebHID output reports, but relying on its minified private protocol would be fragile.
- The configurator shows global lighting configuration. Nothing reviewed so far establishes separate, host-updated RGB for each key.
- The standard keyboard events do not identify which physical keyboard generated them. Device-specific capture therefore needs Windows Raw Input or the vendor HID interface.

## What Codex Micro does

OpenAI's Codex Micro is the right design reference. Its distinctive functions are:

- Six Agent Keys bound to live chats.
- Single-tap background selection and double-tap selection plus app focus.
- Per-agent status colors: idle, thinking, complete/unread, input required, error, and unassigned.
- Command keys for common actions such as approve, decline, fork/continue, push-to-talk, and send.
- A dial for composer navigation, reasoning effort, conversation scrolling, or custom actions.
- A four-direction control for plan mode, navigation history, and sidebar visibility.
- Multiple software layers.

The key lesson is that Codex Micro combines two systems: ordinary physical inputs and a state-aware application integration. This pad already covers the first system. We need to build the second around Control Room.

## Fit with this repository

The repository already contains most of the required state and action plumbing.

### Current room topology

Six independent Windows Control Room instances are installed:

| Pad number | Instance ID | Name | Executable |
| --- | --- | --- | --- |
| 1 | `default` | Default | `%LOCALAPPDATA%\CodexControlRoom\app\CodexControlRoom.exe` |
| 2 | `secondary` | Secondary | `%LOCALAPPDATA%\CodexControlRoom\instances\secondary\app\CodexControlRoom-secondary.exe` |
| 3 | `instance-3` | Instance 3 | `%LOCALAPPDATA%\CodexControlRoom\instances\instance-3\app\CodexControlRoom-instance-3.exe` |
| 4 | `instance-4` | Instance 4 | `%LOCALAPPDATA%\CodexControlRoom\instances\instance-4\app\CodexControlRoom-instance-4.exe` |
| 5 | `instance-5` | Instance 5 | `%LOCALAPPDATA%\CodexControlRoom\instances\instance-5\app\CodexControlRoom-instance-5.exe` |
| 6 | `instance-6` | Instance 6 | `%LOCALAPPDATA%\CodexControlRoom\instances\instance-6\app\CodexControlRoom-instance-6.exe` |

At inspection time, Default, Secondary, and Instance 3 were running. The other three were installed but stopped.

Each instance has its own app identity, WebView2 profile, encrypted credentials, layout, selected workspaces, and window state. That makes the first six physical keys a natural one-to-one room selector.

### Existing state signals

The app already exposes or computes:

- Per-machine tracker snapshots at `GET /api/control-room/tracker`.
- Active, completed, failed, and stopped runs.
- Queued and running jobs at `GET /api/jobs` and `GET /api/chats/:id/jobs`.
- Completion messages from embedded tiles to the parent Control Room.
- Connection state per room tile.
- Project and chat titles per tile.
- WebSocket state updates.
- Usage and reasoning settings.

These are enough to derive a Micro-like status model:

| Controller state | Available evidence | Suggested light/status |
| --- | --- | --- |
| Idle | Online tile, no active run, no unread completion | White |
| Thinking/running | Tracker or job is running | Blue |
| Complete/unread | Existing completion glow message | Green |
| Needs attention | Queued work, approval/input state if later surfaced | Amber |
| Failed/offline | Failed job, unauthorized or offline tile | Red |
| Unassigned/off | Empty or terminated slot | Off |

`Requires input` is the weakest mapping today. The current app does not expose a first-class approval/input-needed state comparable to ChatGPT's Codex Micro integration. Add it after the app exposes a trustworthy underlying signal.

### Existing actions

Useful authenticated endpoints already include:

- Stop a Codex run launched outside the built-in runner: `POST /api/chats/:id/external-run/stop`.
- Stop a runner job: `POST /api/chats/:id/jobs/:jobId/stop`.
- Remove, prioritize, or steer queued prompts.
- Submit and steer prompts.
- Change model/reasoning settings with `PATCH /api/run-settings`.
- Lower-level focus, text, and hotkey endpoints, guarded by configuration.

The parent Control Room already implements `Ctrl+ArrowDown` to scroll all rooms to the bottom and `F11` to toggle fullscreen.

### Missing integration seam

There is no device/action message contract yet. Add one, for example:

```text
codex-control-pad-action
  room.select        { roomId }
  tile.select        { slotId }
  tile.next          {}
  tile.previous      {}
  tile.scroll        { delta }
  tile.scrollBottom  {}
  run.stop           { slotId }
  run.steerNext      { slotId }
  view.toggleTracker { slotId }
  display.toggle     { slotId }
  room.fullscreen    {}
```

The native wrapper should validate a small allowlist and pass actions to the parent page via WebView2 messaging. The page can then route actions to the correct embedded tile using its existing `postMessage` pattern.

## Architecture options

| Option | Advantages | Limitations | Recommendation |
| --- | --- | --- | --- |
| Firmware shortcuts | Fastest; no code; profiles persist on the device | Focus-dependent; cannot identify the source keyboard; no live status; iframe focus makes parent shortcuts unreliable | Use for a one-hour proof of concept |
| AutoHotkey/PowerToys mapping | Quick global shortcut prototype | Normal keyboard can trigger the same chords; process/window matching becomes brittle; still no status channel | Useful temporary bridge, not the final design |
| Extend the WebView2 wrapper | Fits current deployment; can launch/focus exact app identities; can message the parent page; credentials remain in the existing native boundary | Requires C#/Win32 input handling in the generated wrapper | Best MVP for room and tile control |
| Native companion using Windows Raw Input | Distinguishes `VID_0816/PID_2475`; works across all six room processes; can consume API/WebSocket state; clean place for HID experiments | One more background process and installer component | Best long-term architecture |
| Direct WebHID in the Control Room page | May read/write the vendor HID interface; HTTPS origin already exists | Initial permission requires a user gesture; permissions are origin/profile scoped; WebView2 behavior must be tested; app must be open; private protocol is unstable | Keep as an experimental lighting/configuration path |

Recommended progression: extend the wrapper for the MVP. Extract a companion if multi-window routing or live HID output makes the wrapper unwieldy.

## Proposed physical layout

The pad has enough controls to use modes rather than trying to put every command on one layer.

### Layer 1: Rooms

```text
┌────────┬────────┬────────┬────────┐
│ Room 1 │ Room 2 │ Room 3 │ Room 4 │
├────────┼────────┼────────┼────────┤
│ Room 5 │ Room 6 │ Prev   │ Next   │
├────────┼────────┼────────┼────────┤
│ Tiles  │ Runs   │Tracker │Overview│
├────────┼────────┼────────┼────────┤
│ Full   │ Bottom │ Display│ Stop   │
└────────┴────────┴────────┴────────┘
```

- Room 1–6: launch if closed, restore, and focus the exact Control Room instance.
- Prev/Next: rotate through running instances.
- Tiles/Runs: enter the corresponding logical mode in the native helper. Do not depend on the pad's sequential firmware layers for critical state.
- Stop: stop the selected task only. Use hold/double-press or a confirmation pattern before any future “stop all” action.

### Layer 2: Tiles

Use the 4×4 keys as direct selectors for visible tiles 1–16. For layouts with more than 16 slots, use the center knob to page or move selection. A first press selects in the background; a quick second press can focus/open the selected tile, mirroring Codex Micro's single/double-tap behavior.

### Encoders

| Control | Left turn | Right turn | Press |
| --- | --- | --- | --- |
| Left knob | Previous room | Next room | Focus/restore current room |
| Center knob | Previous tile | Next tile | Select/open tile |
| Right knob | Scroll chat up | Scroll chat down | Jump to latest |

An alternate Runs mode can repurpose the right knob to lower/raise reasoning effort, with press opening the run settings control.

## Immediate proof of concept

No repository code is required for this test:

1. Open the official configurator in current Chrome or Edge.
2. Connect `SIDE-KEYBOARD` when prompted.
3. Save a backup/profile screenshot before changing anything.
4. Program Room 1–6 as unique chords such as `Ctrl+Alt+Shift+1` through `Ctrl+Alt+Shift+6`.
5. Program one key as `Ctrl+ArrowDown` and one as `F11`; these already work in the parent Control Room when it owns focus.
6. Bind the six room chords to launch/focus the exact installed executables using a temporary hotkey utility.
7. Test each encoder rotation and press; confirm what key sequences the firmware emits.
8. Test while focus is inside a workspace iframe. This is expected to reveal why native interception is needed.

Do not put control tokens, URLs containing tokens, PowerShell commands, or arbitrary shell text into device macros.

## MVP implementation plan

### Milestone 1: reliable room switching

- Give all 25 possible gestures unique key chords.
- Add Windows Raw Input or WebView2 accelerator handling to the wrapper.
- Match the physical source to `VID_0816/PID_2475` when Raw Input is used.
- Launch/restore/focus the six exact executables.
- Add a small tray/debug view showing the last decoded pad action.
- Preserve normal keyboard behavior.

Success criterion: every room key selects the intended instance from any focused app, without accidental activation from the laptop keyboard.

### Milestone 2: tile and run actions

- Add `codex-control-pad-action` native-to-web messages.
- Track an active room and active slot per room.
- Add a visible selected-tile outline to Control Room.
- Route next/previous/select/scroll-bottom/toggle-tracker/toggle-display.
- Route task stop through the existing authenticated endpoint, with a safety confirmation.

Success criterion: the user can move among rooms and tiles and operate the selected task without touching the mouse.

### Milestone 3: live state

- Normalize tracker, job, completion, and connection events into the six-state model.
- Show the same state in an on-screen pad overlay first.
- Investigate output reports on the vendor HID interface in a separate experimental module.
- If the firmware supports global lighting without per-key control, use whole-pad colors for the highest-priority state and keep per-tile state in the on-screen overlay.
- If independent LEDs are verified, map selected/priority tiles to physical keys.

Success criterion: state feedback is correct and stale state clears on disconnect, app exit, or token expiry.

## HID protocol investigation notes

The official configurator is a Next.js WebHID application. Its deployed code:

- Filters supported HID devices and includes a layout asset for `0816_2475`.
- Sends output reports with report ID `0` over a vendor-defined usage page.
- Reads device/profile/layer information.
- Supports global light configuration calls for effect, brightness, speed, direction, and color.
- Listens for a device light event.

This confirms bidirectional communication. It does **not** establish support for arbitrary per-key RGB updates. Before implementing output:

1. Capture reports from our device while changing one configurator setting at a time.
2. Record firmware/device-info responses and report lengths.
3. Never send guessed firmware-update, reset, or write commands.
4. Start with read-only device info, then a reversible global brightness/color change.
5. Keep protocol code isolated behind a feature flag and exact VID/PID/serial allowlist.

## Security and safety requirements

- Keep Control Room tokens out of firmware, source control, logs, process arguments, and pad profiles.
- Reuse the wrapper's DPAPI-encrypted machine profiles or load local secrets at runtime.
- Bind any helper API to loopback only.
- Use named action IDs and strict schemas; never accept arbitrary shell commands from pad input.
- Require deliberate confirmation for destructive actions such as stopping all tasks, terminating a room, or clearing queues.
- Rate-limit encoder repeats and de-bounce keys.
- On device disconnect, clear pressed state and stop repeat actions.
- Make room selection safe when an instance is missing or still launching.
- Avoid WebHID access from unrelated origins. Grant browser HID permission to the official configurator or the trusted Control Room origin.

## Implemented left-knob square focus

### Local command monitor

Open `http://127.0.0.1:8787/control-pad-monitor.html` as a square's custom URL to inspect commands delivered to its webpage. The monitor begins as a blank black canvas, renders the currently received chord in oversized Helvetica-style white type, starts fading after 3.65 seconds, and removes all visible content at exactly four seconds. It uses actual arrow glyphs for arrow-key events and retains the fullest chord while an onboard macro releases its keys.

The leftmost encoder is now reserved for keyboard focus inside the foreground Control Room:

| Gesture | Onboard shortcut | Control Room behavior |
| --- | --- | --- |
| Turn counter-clockwise | `Ctrl+Alt+Right` | Focus next assigned square, wrapping at the end |
| Turn clockwise | `Ctrl+Alt+Left` | Focus previous assigned square, wrapping at the start |
| Press | `Ctrl+Alt+1` | Deliver that trusted keypress to the focused square's webpage |
| Top-left key | `Ctrl+Alt+0` | Turn off the focused square's display |
| Top-right key | `Ctrl+Alt+9` | Toggle Far view focus for the currently focused square |

### Encoder chord layer

The three knobs now emit these onboard macro chords:

| Control | Rotate left | Press | Rotate right |
| --- | --- | --- | --- |
| Knob 1 | `Ctrl+Alt+Right` (next square) | `Ctrl+B+1` | `Ctrl+Alt+Left` (previous square) |
| Knob 2 | `Ctrl+2+ArrowRight` | `Ctrl+B+2` | `Ctrl+2+ArrowLeft` |
| Knob 3 | `Ctrl+3+ArrowRight` | `Ctrl+B+3` | `Ctrl+3+ArrowLeft` |

Knob 1 room switching is based only on square endpoints; rotation speed and timing are ignored. Each detent moves focus one square until it reaches the first or last focusable square. One additional detent outward switches to the adjacent open Control Room and focuses the corresponding endpoint square there. Closed rooms are skipped and never launched by the gesture. Switching explicitly clears the departing room's square focus and focuses the selected room's WebView so knob input continues there.

All visible squares participate in knob traversal, including live, display-off, frozen, and terminated squares. This prevents an empty Control Room from trapping rotation because it has no focusable endpoint.

Terminated squares show their knob focus with a coral `TERMINATED FOCUS` ring and label instead of the lime live-square focus treatment. Their tile container is programmatically focusable, so the visual state and keyboard-focus target remain synchronized during knob traversal.

The Screen layout panel includes a persistent **Far view focus** option for operating the wall from a greater distance. When enabled, the knob-focused square is lifted above a dimmed wall, expands to twice its grid width (clamped to the Control Room window), fills the usable height below the header, and renders its live webpage at 140% zoom. Moving focus recalculates the popup from the destination square's real grid geometry, including merged-square spans.

Cross-room transfer uses a synchronous native window message. The destination window is restored and foregrounded, its WebView is selected and focused, and then the matching endpoint square is selected before the source handles another detent.

Knob rotation is registered globally by one of the open native wrappers. If another application owns the foreground, the first detent restores the most recently active open Control Room and focuses the last square the user interacted with there. Square interaction is remembered for tile controls, powered-off and terminated surfaces, and clicks that transfer focus into an embedded webpage. Closed Control Rooms are never launched by this routing.

The current programmed physical-right rotation arrives as `next`, so room traversal maps `next` directly to the next open instance and `previous` to the previous open instance. Room direction must not apply an additional hardware inversion after the square-navigation mapping.

The pad's simple key format supports only modifiers plus one ordinary key, so the seven new multi-key chords use onboard macros M0–M6. The rotation macros use the actual USB HID ArrowLeft/ArrowRight keys. Each macro presses every constituent key, then releases them in reverse order. The programmer preserves macro slots M7–M15 and refuses to overwrite M0–M6 if an unrelated key has begun using one of those reserved slots.

The vendor layout for `VID_0816/PID_2475` identifies left-encoder slots 17, 18, and 16 respectively. Before programming active layer 0, their stored values were:

- Counter-clockwise/index 17: `[32, 0, 42, 0]` (`Backspace`).
- Clockwise/index 18: `[32, 0, 44, 0]` (`Space`).
- Press/index 16: `[32, 0, 83, 0]` (`Num Lock`).
- Physical bottom-left/index 0 now uses `[32, 1, 0, 0]` (held Left Ctrl).
- Physical bottom-right/index 12 now uses `[32, 0, 40, 0]` (Enter).
- Physical top-left/index 3 originally used `[32, 0, 86, 0]` (keypad `6`).

`npm run program:control-room-knob` uses the exact device serial `267E01678182`, changes only the three encoder slots plus physical top-left and top-right keys, restores the two buttons touched during orientation discovery, and verifies every value by reading it back. The counter-clockwise, clockwise, and press encoder values are `[32,5,79,0]`, `[32,5,80,0]`, and `[32,5,30,0]`; the modifier byte `5` is left Control plus left Alt and the second code byte is the USB HID key code.

The same command programs physical top-left/vendor index 3 as `[32,5,39,0]` (`Ctrl+Alt+0`) and verifies it by read-back. Focus navigation includes every assigned square, even when its display is off or its live page has been replaced by a frozen screenshot. Pressing the knob wakes a display-off square or resumes a frozen square; once its iframe returns, keyboard focus follows it automatically. Pressing the top-left key turns the selected square's display off, including clearing a frozen snapshot first.

Physical top-right/vendor index 15 is `[32,5,38,0]` (`Ctrl+Alt+9`). The native wrapper consumes that chord and sends `toggle-far-view-focus`; the webpage ignores it unless a square currently has knob focus, then toggles the persistent Far view focus mode.

The Windows wrapper consumes only `Ctrl+Alt+Left` and `Ctrl+Alt+Right`, then posts a named focus-navigation message to the wall. It deliberately leaves `Ctrl+Alt+1` untouched so WebView2 delivers a real, trusted OS keypress to the selected iframe. Mouse movement clears the selection immediately. Losing foreground-window focus clears it after `document.hasFocus()` confirms the blur was outside the Control Room rather than a normal focus transfer into its iframe.

## Decisions still needed before implementation

1. Whether Room keys should focus a Control Room window or also select a default tile within it.
2. Whether all six instances need live status at once, or whether the active room is enough.
3. Which 16 tile slots deserve direct keys when a room uses more than 16 slots.
4. Whether the Stop key should require double-tap, press-and-hold, or a second confirmation key.
5. Whether voice/dictation belongs on this controller. It is possible as an app action, but there is no dedicated microphone on this pad.
6. Whether lighting experimentation is worth maintaining against an undocumented vendor protocol.

## Sources

- OpenAI Codex Micro product page: https://openai.com/supply/co-lab/work-louder/
- Current Codex Micro manual section (fetched through the official Codex manual on 2026-08-03): https://learn.chatgpt.com/docs/features/codex-micro.md
- Work Louder Codex Micro setup guide: https://worklouder.cc/openai-micro-setup
- Manufacturer WebHID configurator: https://www.sdcx-tech.com/
- Manufacturer 16-key product page: https://szhcykb.com/products/16-key-customizable-mechanical-keyboard-capable-of-supporting-customized-key-operations-setting-of-shortcut-key-methods
- Manufacturer FAQ: https://szhcykb.com/blogs/q-a/frequently-asked-questions
- Chrome WebHID guide: https://developer.chrome.com/docs/capabilities/hid
- Microsoft Edge WebHID policy documentation: https://learn.microsoft.com/en-us/deployedge/microsoft-edge-browser-policies/defaultwebhidguardsetting
- Repository implementation evidence: `windows/ControlRoom/README.md`, `windows/ControlRoom/Install-Six-ControlRoomInstances.ps1`, `src/ControlRoom.tsx`, `src/controlRoomState.ts`, `server/index.ts`, and `server/externalRunControl.ts`.
