# Native Raspberry Pi control room

This is a GTK application for a dedicated Raspberry Pi display. It starts as a
grid of empty, generic squares. Loading a URL turns a square into an independent
mini browser tab backed directly by WebKit—there is no React control-room page,
iframe nesting, or hard-coded dashboard layout.

Each square has navigation, address entry, reload, external-browser open,
display-off, screenshot freeze, terminate, move, merge, and split controls.
Global settings provide 1–8 columns, 1–3 rows, fullscreen, reload-all, and
scroll-all-to-bottom. Layout, URLs, titles, modes, and cookies persist reboots.

Arrow keys (including keypad arrows and modifier combinations) are broadcast to
every live browser square while the control room is active. Each page receives
native key presses and releases, so its normal scrolling and keyboard shortcuts
apply. Empty, display-off, frozen, and native tracker squares have no browser to
receive them. The focused square receives each event once. Scroll-all-to-bottom
remains available in Settings; Ctrl+Down now goes to every live browser as well.

Run the isolated GTK/WebKit keyboard integration check without affecting the
display user's control room:

```sh
xvfb-run -a /usr/bin/python3 native/rpi-control-room/check_arrow_keys.py
```

The installed configuration contains credentials and must remain mode `0600`.
Browser cookies live in the display user's WebKitGTK profile and survive restarts.

Runtime dependencies on Debian/Raspberry Pi OS:

```sh
sudo apt install python3-gi gir1.2-gtk-3.0 gir1.2-webkit2-4.1 libwebkit2gtk-4.1-0
```

The deployment script at `scripts/deploy-rpi-control-room.ps1` imports only the
shared saved-dashboard and machine libraries. It never imports another control
room's square contents or layout.
