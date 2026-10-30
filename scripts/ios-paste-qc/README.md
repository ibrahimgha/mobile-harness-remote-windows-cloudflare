# iOS paste regression QC

Serve the small production frontend build together with `fixture.js` and
`serve.py` on the Mac mini (loopback port 8769). The fixture mocks every Remote
API and contains only dummy text; it cannot submit a real worker prompt.
Open `http://127.0.0.1:8769/?chat=paste-fixture` on the iPhone 17 Pro simulator.
Run `ScrollTopTests.swift` in the existing XCTest harness, using a task-owned
derived-data directory.

The test enters a partial prompt and two Return keys through the native iOS
keyboard, then feeds a controlled multiline ClipboardEvent into the real
application paste handler without moving the caret. It verifies the exact
result and persistence stability. This checks iOS's actual DIV/BR editing DOM
and the production paste path; it does not assert the system edit-menu gesture.

`scripts/check-run-status-browser.mjs` adds Chromium/WebKit coverage for native
line breaks, intentional selection replacement, emoji, trailing newlines and
DOM/text caret round trips. Run with `--webkit` for WebKit. Supply the installed
Playwright package through `PLAYWRIGHT_CORE` when not installed in the project.

Remove task-owned builds, transferred assets and simulator scratch after QC.
Preserve concise results and do not alter user chats, windows or credentials.
