#!/usr/bin/env python3
"""Native, persistent multi-tab control room for a Raspberry Pi display.

GTK owns the grid and controls. Every live square is a direct WebKit view—not
an iframe and not a React control-room page. Empty/off/terminated/frozen
squares have no WebKit process.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import threading
import time
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any

os.environ.setdefault("WEBKIT_DISABLE_DMABUF_RENDERER", "1")
os.environ.setdefault("WEBKIT_DISABLE_COMPOSITING_MODE", "1")

import gi

gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import Gdk, GLib, Gtk, WebKit2  # noqa: E402


APP_ID = "com.bit68.CodexControlRoomNative"
BASE = Path.home() / ".config/codex-control-room-native"
CONFIG_PATH = Path(os.environ.get("CODEX_CONTROL_ROOM_CONFIG", BASE / "config.json"))
STATE_PATH = Path(os.environ.get("CODEX_CONTROL_ROOM_STATE", BASE / "state.json"))
DATA_PATH = Path.home() / ".local/share/codex-control-room-native"
DEFAULT_COLUMNS = 5
DEFAULT_ROWS = 3
CONNECTION_RETRY_SECONDS = max(1, int(os.environ.get("CODEX_CONTROL_ROOM_RETRY_SECONDS", "900")))


def atomic_json(path: Path, value: Any, mode: int = 0o600) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2), encoding="utf-8")
    os.chmod(temporary, mode)
    temporary.replace(path)


def blank_state(columns: int = DEFAULT_COLUMNS, rows: int = DEFAULT_ROWS) -> dict[str, Any]:
    return {
        "version": 2,
        "columns": columns,
        "rows": rows,
        "fullscreen": True,
        "nextId": columns * rows + 1,
        "tiles": [
            {"id": f"tab-{index + 1}", "row": index // columns, "column": index % columns,
             "rowSpan": 1, "columnSpan": 1, "mode": "empty", "url": "", "title": ""}
            for index in range(columns * rows)
        ],
    }


def normalize_url(value: str) -> str:
    value = value.strip()
    if not value:
        return ""
    parsed = urllib.parse.urlparse(value)
    if not parsed.scheme:
        value = "https://" + value
        parsed = urllib.parse.urlparse(value)
    return value if parsed.scheme in ("http", "https") and parsed.netloc else ""


def css() -> bytes:
    return b"""
    * { font-family: 'DejaVu Sans', sans-serif; }
    window, .shell { background: #050807; color: #eff6f1; }
    .topbar { min-height: 50px; padding: 0 14px; background: #0d1211; border-bottom: 1px solid #34403b; }
    .brand { font-size: 18px; font-weight: 800; letter-spacing: 1px; color: #f4faf6; }
    .subbrand { font: 700 9px monospace; letter-spacing: 2px; color: #63dbc0; }
    .status { font: 700 10px monospace; letter-spacing: 1px; color: #84928b; }
    .button { min-height: 28px; min-width: 28px; padding: 0 7px; background: #151b19; color: #bac5bf; border: 1px solid #37423d; border-radius: 2px; }
    .button:hover { color: #72efd3; border-color: #4b806f; }
    .danger:hover { color: #ff9a91; border-color: #8e4b46; }
    .grid { background: #26302c; }
    .tile { background: #080c0b; border: 1px solid #35423c; }
    .tabbar { min-height: 34px; padding: 0 5px; background: #121816; border-bottom: 1px solid #34413b; }
    .tab-index { min-width: 20px; font: 700 9px monospace; color: #66736d; }
    .source-select button { min-height: 24px; min-width: 132px; padding: 0 7px; background: #070a09; color: #e0e8e3; border: 1px solid #303b36; border-radius: 2px; font-size: 10px; font-weight: 800; }
    .page-title { font-size: 11px; font-weight: 700; color: #d9e4de; }
    .page-host { font: 700 9px monospace; color: #62d8bd; }
    .tile-status { font: 800 9px monospace; letter-spacing: 1px; color: #62d8bd; }
    .empty, .off, .frozen { background: #050807; }
    .empty-title { font-size: 29px; font-weight: 800; color: #dfe8e3; }
    .empty-copy { font-size: 11px; color: #68756f; }
    .url-entry { min-height: 36px; min-width: 330px; padding: 0 10px; background: #0e1412; color: #eef4f0; border: 1px solid #415049; border-radius: 3px; font: 12px monospace; }
    .open-button { min-height: 36px; padding: 0 18px; background: #63dbc0; color: #06110e; border: 0; border-radius: 3px; font-weight: 900; }
    .open-button:hover { background: #82ead2; }
    .state-kicker { font: 800 10px monospace; letter-spacing: 3px; color: #4e5a55; }
    .state-title { font-size: 30px; font-weight: 900; color: #d4ded8; }
    .state-url { font: 11px monospace; color: #67746e; }
    .wake { margin-top: 14px; }
    .frozen-image { background: #050807; }
    .menu-title { font-weight: 900; color: #eff6f1; }
    .menu-note { font-size: 10px; color: #7d8983; }
    .system-metric { padding: 3px 8px; background: #111816; border: 1px solid #314039; }
    .system-metric-name { font: 800 8px monospace; letter-spacing: 1px; color: #75847c; }
    .system-metric-value { font: 900 14px monospace; color: #dce8e1; }
    .tracker-head { min-height: 50px; padding: 5px 9px; background: #09130e; border-bottom: 1px solid #2b4738; }
    .tracker-name { font-size: 18px; font-weight: 900; color: #eef8f2; }
    .tracker-live { font: 900 9px monospace; letter-spacing: 2px; color: #66eba7; }
    .tracker-metric-label { font: 800 8px monospace; letter-spacing: 1px; color: #73837a; }
    .tracker-metric-value { font: 900 24px monospace; color: #eef8f2; }
    .tracker-running { color: #65f2a4; }
    .tracker-section { min-height: 24px; padding: 0 8px; background: #0b120f; border-bottom: 1px solid #22352a; }
    .tracker-section-title { font: 900 9px monospace; letter-spacing: 1px; color: #8b9991; }
    .run-row { min-height: 36px; padding: 2px 8px; border-bottom: 1px solid #17251e; }
    .run-title { font-size: 12px; font-weight: 800; color: #e8f1eb; }
    .run-sub { font-size: 9px; color: #74827a; }
    .run-time { font: 900 13px monospace; color: #66eba7; }
    .tracker-empty { padding: 16px; color: #65736b; font-weight: 700; }
    .tracker-error { padding: 5px 8px; color: #ff9e95; background: #2a1010; font-size: 10px; }
    .limit-row { padding: 5px; }
    .limit-card { padding: 4px 7px; background: #0a120e; border: 1px solid #263c30; }
    .limit-value { font: 900 15px monospace; color: #eaf3ed; }
    progressbar trough { min-height: 4px; background: #233128; border: 0; }
    progressbar progress { min-height: 4px; background: #65e7a4; border: 0; }
    popover { background: #111715; color: #e9f0ec; border: 1px solid #46534d; }
    combobox button, spinbutton, checkbutton { color: #e9f0ec; background: #171e1b; }
    separator { background: #36413c; }
    """


def add_class(widget: Gtk.Widget, *names: str) -> Gtk.Widget:
    for name in names:
        widget.get_style_context().add_class(name)
    return widget


def text_label(value: str = "", *classes: str, xalign: float = 0.0) -> Gtk.Label:
    item = Gtk.Label(label=value, xalign=xalign)
    item.set_ellipsize(3)
    add_class(item, *classes)
    return item


def elapsed_label(started: str, finished: str | None = None) -> str:
    try:
        start = datetime.fromisoformat(started.replace("Z", "+00:00")).timestamp()
        end = datetime.fromisoformat(finished.replace("Z", "+00:00")).timestamp() if finished else time.time()
        seconds = max(0, int(end - start))
    except (ValueError, TypeError):
        return "—"
    hours, remainder = divmod(seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    return f"{hours}h {minutes:02d}m" if hours else f"{minutes}m {seconds:02d}s"


class TrackerBody(Gtk.Box):
    """Native Codex statistics panel; no WebKit process is created."""

    def __init__(self, tile: "BrowserTile", machine: dict[str, Any]) -> None:
        super().__init__(orientation=Gtk.Orientation.VERTICAL)
        self.tile = tile
        self.machine = machine
        self.in_flight = False
        self.snapshot: dict[str, Any] | None = None
        head = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=10)
        add_class(head, "tracker-head")
        identity = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=0)
        identity.pack_start(text_label("● LIVE MACHINE", "tracker-live"), False, False, 0)
        identity.pack_start(text_label(machine["name"], "tracker-name"), False, False, 0)
        head.pack_start(identity, True, True, 0)
        self.running_value = self.metric(head, "ACTIVE NOW", True)
        self.done_value = self.metric(head, "DONE TODAY", False)
        self.pack_start(head, False, False, 0)
        self.error = text_label("", "tracker-error")
        self.error.set_no_show_all(True)
        self.pack_start(self.error, False, False, 0)
        self.content = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        self.pack_start(self.content, True, True, 0)
        self.refresh()
        GLib.timeout_add_seconds(5, self.refresh)

    def metric(self, head: Gtk.Box, name: str, running: bool) -> Gtk.Label:
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=0)
        box.pack_start(text_label(name, "tracker-metric-label", xalign=1.0), False, False, 0)
        value = text_label("0", "tracker-metric-value", *(('tracker-running',) if running else ()), xalign=1.0)
        box.pack_start(value, False, False, 0)
        head.pack_start(box, False, False, 8)
        return value

    def refresh(self) -> bool:
        if not self.get_parent() or self.in_flight:
            return bool(self.get_parent())
        self.in_flight = True
        threading.Thread(target=self.fetch, daemon=True).start()
        return True

    def fetch(self) -> None:
        try:
            request = urllib.request.Request(
                self.machine["url"].rstrip("/") + "/api/control-room/tracker",
                headers={"x-control-token": self.machine["token"], "User-Agent": "CodexControlRoomNative/2"},
            )
            with urllib.request.urlopen(request, timeout=12) as response:
                payload = json.load(response)
            if not payload.get("ok"):
                raise RuntimeError(payload.get("message", "Statistics unavailable"))
            GLib.idle_add(self.apply, payload, "")
        except Exception as exc:
            GLib.idle_add(self.apply, None, str(exc))

    def apply(self, payload: dict[str, Any] | None, error: str) -> bool:
        self.in_flight = False
        if not self.get_parent():
            return False
        if error:
            self.error.set_text(error); self.error.show()
            return False
        self.error.hide(); self.snapshot = payload
        self.running_value.set_text(str(payload.get("runningCount", 0)))
        self.done_value.set_text(str(payload.get("completedSinceDayStart", 0)))
        self.render_runs(payload)
        return False

    def section(self, title: str, runs: list[dict[str, Any]], limit: int, active: bool) -> Gtk.Box:
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        heading = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL)
        add_class(heading, "tracker-section")
        heading.pack_start(text_label(title, "tracker-section-title"), True, True, 0)
        heading.pack_start(text_label(str(len(runs)), "tracker-section-title", xalign=1.0), False, False, 0)
        box.pack_start(heading, False, False, 0)
        if not runs:
            box.pack_start(text_label("No active jobs on this machine", "tracker-empty", xalign=0.5), False, False, 0)
        for run in runs[:limit]:
            row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=8)
            add_class(row, "run-row")
            row.pack_start(text_label("●" if active else "✓", "tracker-live"), False, False, 0)
            copy = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
            copy.pack_start(text_label(run.get("title", "Untitled"), "run-title"), False, False, 0)
            copy.pack_start(text_label(run.get("projectName", "Unknown project"), "run-sub"), False, False, 0)
            row.pack_start(copy, True, True, 0)
            meta = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
            meta.pack_start(text_label(elapsed_label(run.get("startedAt", ""), run.get("finishedAt")), "run-time", xalign=1.0), False, False, 0)
            model = str(run.get("model", "")).removeprefix("gpt-")
            speed = "Fast" if run.get("speed") == "priority" else "Standard"
            meta.pack_start(text_label(f"{model} · {run.get('reasoningEffort', '')} · {speed}", "run-sub", xalign=1.0), False, False, 0)
            row.pack_start(meta, False, False, 0)
            box.pack_start(row, False, False, 0)
        return box

    def render_runs(self, payload: dict[str, Any]) -> None:
        for child in self.content.get_children():
            self.content.remove(child); child.destroy()
        running = payload.get("running") or []
        self.content.pack_start(self.section("CURRENTLY RUNNING", running, 8, True), False, False, 0)
        remaining = max(1, 5 - min(4, len(running)))
        self.content.pack_start(self.section("RECENT RUNS", payload.get("recent") or [], remaining, False), False, False, 0)
        usage = payload.get("usage") or {}
        limits = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=5)
        add_class(limits, "limit-row")
        resets_available = usage.get("resetCreditsAvailable")
        limits.pack_start(self.limit_card("5-HOUR LIMIT", usage.get("fiveHour"), resets_available), True, True, 0)
        limits.pack_start(self.limit_card("WEEKLY LIMIT", usage.get("weekly"), resets_available), True, True, 0)
        self.content.pack_end(limits, False, False, 0)
        self.content.show_all()

    def limit_card(self, name: str, value: dict[str, Any] | None, resets_available: Any = None) -> Gtk.Box:
        card = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=2)
        add_class(card, "limit-card")
        row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL)
        row.pack_start(text_label(name, "tracker-metric-label"), True, True, 0)
        used = min(100.0, max(0.0, float((value or {}).get("usedPercent", 0))))
        row.pack_start(text_label(f"{round(100 - used)}%", "limit-value", xalign=1.0), False, False, 0)
        card.pack_start(row, False, False, 0)
        card.pack_start(Gtk.ProgressBar(fraction=used / 100), False, False, 0)
        details = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=5)
        resets_at = (value or {}).get("resetsAt")
        reset_label = "Reset unavailable"
        if isinstance(resets_at, (int, float)):
            reset_label = "Resets " + datetime.fromtimestamp(resets_at).astimezone().strftime("%a, %b %d, %Y, %I:%M %p").replace(" 0", " ")
        details.pack_start(text_label(reset_label, "run-sub"), True, True, 0)
        count_label = "Resets available —" if not isinstance(resets_available, (int, float)) else f"{int(resets_available)} resets available"
        details.pack_start(text_label(count_label, "run-sub", xalign=1.0), False, False, 0)
        card.pack_start(details, False, False, 0)
        return card


class BrowserTile(Gtk.Box):
    def __init__(self, window: "ControlRoomWindow", tile: dict[str, Any], position: int) -> None:
        super().__init__(orientation=Gtk.Orientation.VERTICAL)
        self.window = window
        self.tile = tile
        self.position = position
        self.webview: WebKit2.WebView | None = None
        self.tracker_body: TrackerBody | None = None
        self.connection_retry_timer = 0
        self.frozen_path = DATA_PATH / "frozen" / f"{tile['id']}.png"
        add_class(self, "tile")
        self.render()

    def clear(self) -> None:
        self.cancel_connection_retry()
        for child in self.get_children():
            self.remove(child)
            child.destroy()
        self.webview = None
        self.tracker_body = None

    def render(self) -> None:
        self.clear()
        mode = self.tile.get("mode", "empty")
        if mode == "browser":
            self.render_browser()
        elif mode == "tracker":
            self.render_tracker()
        elif mode == "off":
            self.render_state("DISPLAY OFF", "Turn display on", "off")
        elif mode == "frozen":
            self.render_frozen()
        else:
            self.render_empty()
        self.show_all()

    def browser_bar(self) -> Gtk.Box:
        bar = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=4)
        add_class(bar, "tabbar")
        bar.pack_start(text_label(f"{self.position:02d}", "tab-index"), False, False, 0)
        current_item = self.window.item_by_id(self.tile.get("libraryId", ""))
        source = Gtk.ComboBoxText()
        add_class(source, "source-select")
        if not current_item:
            source.append("__custom__", self.tile.get("title") or self.window.name_for_url(self.tile.get("url", "")))
        for item in self.window.library:
            source.append(item["id"], item["name"])
        source.set_active_id(current_item["id"] if current_item else "__custom__")
        source.connect("changed", self.source_changed)
        bar.pack_start(source, False, False, 0)
        title = self.tile.get("title") or self.window.name_for_url(self.tile.get("url", ""))
        bar.pack_start(text_label(title, "page-title"), True, True, 0)
        is_machine = bool(current_item and current_item.get("type") == "machine")
        status = "LIVE" if is_machine else "DASHBOARD" if current_item else "WEBSITE"
        bar.pack_start(text_label(f"● {status}", "tile-status", xalign=1.0), False, False, 0)
        if is_machine:
            stats = Gtk.Button(label="▥" if self.tile.get("mode") == "browser" else "▤")
            add_class(stats, "button")
            stats.set_tooltip_text("Show live statistics" if self.tile.get("mode") == "browser" else "Show Codex Remote")
            stats.connect("clicked", lambda *_: self.toggle_tracker())
            bar.pack_start(stats, False, False, 0)
        for symbol, tip, action in (
            ("⇄", "Move, merge, or split square", self.show_options),
            ("⌁", "Load another URL", self.load_url_dialog),
            ("↻", "Reload", self.reload),
            ("▣", "Freeze as screenshot", self.freeze),
            ("⏻", "Turn display off", self.display_off),
            ("⊠", "Terminate square", self.terminate),
            ("↗", "Open separately", self.open_external),
        ):
            button = Gtk.Button(label=symbol)
            add_class(button, "button", *(('danger',) if tip == "Terminate square" else ()))
            button.set_tooltip_text(tip)
            button.connect("clicked", lambda _b, callback=action: callback())
            bar.pack_start(button, False, False, 0)
        return bar

    def render_browser(self) -> None:
        self.pack_start(self.browser_bar(), False, False, 0)
        self.webview = WebKit2.WebView.new_with_context(self.window.web_context)
        settings = self.webview.get_settings()
        settings.set_enable_javascript(True)
        settings.set_enable_media_stream(True)
        settings.set_enable_webrtc(True)
        settings.set_enable_page_cache(True)
        settings.set_enable_smooth_scrolling(False)
        settings.set_hardware_acceleration_policy(WebKit2.HardwareAccelerationPolicy.NEVER)
        self.webview.connect("notify::title", self.title_changed)
        self.webview.connect("notify::uri", self.uri_changed)
        self.webview.connect("load-changed", self.load_changed)
        self.webview.connect("load-failed", self.load_failed)
        self.webview.connect("permission-request", self.permission_requested)
        self.webview.connect("decide-policy", self.decide_policy)
        self.webview.connect("create", self.new_window_requested)
        self.pack_start(self.webview, True, True, 0)
        self.webview.load_uri(self.tile["url"])

    def render_tracker(self) -> None:
        machine = self.window.item_by_id(self.tile.get("libraryId", ""))
        if not machine or machine.get("type") != "machine":
            self.tile["mode"] = "browser"
            self.window.save_state()
            self.render_browser()
            return
        self.pack_start(self.browser_bar(), False, False, 0)
        self.tracker_body = TrackerBody(self, machine)
        self.pack_start(self.tracker_body, True, True, 0)

    def render_empty(self) -> None:
        add_class(self, "empty")
        content = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10)
        content.set_halign(Gtk.Align.CENTER)
        content.set_valign(Gtk.Align.CENTER)
        content.pack_start(text_label("Open a tab", "empty-title", xalign=0.5), False, False, 0)
        content.pack_start(text_label("Any website or Codex Remote", "empty-copy", xalign=0.5), False, False, 0)
        row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=6)
        entry = Gtk.Entry()
        entry.set_placeholder_text("URL or hostname")
        add_class(entry, "url-entry")
        entry.connect("activate", lambda *_: self.navigate(entry.get_text()))
        row.pack_start(entry, True, True, 0)
        button = Gtk.Button(label="OPEN")
        add_class(button, "open-button")
        button.connect("clicked", lambda *_: self.navigate(entry.get_text()))
        row.pack_start(button, False, False, 0)
        content.pack_start(row, False, False, 0)
        choices = Gtk.ComboBoxText()
        choices.append("", "Saved dashboards and machines…")
        for item in self.window.library:
            choices.append(item["id"], item["name"])
        choices.set_active(0)
        choices.connect("changed", self.library_selected)
        saved_row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=6)
        saved_row.pack_start(choices, True, True, 0)
        options = Gtk.MenuButton(label="OPTIONS")
        add_class(options, "button")
        options.set_popover(self.action_popover())
        saved_row.pack_start(options, False, False, 0)
        content.pack_start(saved_row, False, False, 0)
        self.pack_start(content, True, True, 0)

    def render_state(self, kicker: str, button_text: str, style: str) -> None:
        add_class(self, style)
        content = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=7)
        content.set_halign(Gtk.Align.CENTER)
        content.set_valign(Gtk.Align.CENTER)
        content.pack_start(text_label(kicker, "state-kicker", xalign=0.5), False, False, 0)
        content.pack_start(text_label(self.tile.get("title") or self.window.name_for_url(self.tile.get("url", "")), "state-title", xalign=0.5), False, False, 0)
        content.pack_start(text_label(self.tile.get("url", ""), "state-url", xalign=0.5), False, False, 0)
        wake = Gtk.Button(label=button_text)
        add_class(wake, "button", "wake")
        wake.connect("clicked", lambda *_: self.resume_display())
        content.pack_start(wake, False, False, 0)
        menu = Gtk.MenuButton(label="Options")
        add_class(menu, "button")
        menu.set_popover(self.action_popover())
        content.pack_start(menu, False, False, 0)
        self.pack_start(content, True, True, 0)

    def render_frozen(self) -> None:
        add_class(self, "frozen")
        overlay = Gtk.Overlay()
        if self.frozen_path.exists():
            image = Gtk.Image.new_from_file(str(self.frozen_path))
            image.set_halign(Gtk.Align.FILL)
            image.set_valign(Gtk.Align.FILL)
            add_class(image, "frozen-image")
            overlay.add(image)
        else:
            overlay.add(text_label("Frozen preview unavailable", "state-title", xalign=0.5))
        badge = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=4)
        badge.set_halign(Gtk.Align.CENTER)
        badge.set_valign(Gtk.Align.CENTER)
        badge.pack_start(text_label("FROZEN · ZERO LIVE RESOURCES", "state-kicker", xalign=0.5), False, False, 0)
        badge.pack_start(text_label(self.tile.get("title") or self.window.name_for_url(self.tile.get("url", "")), "state-title", xalign=0.5), False, False, 0)
        resume = Gtk.Button(label="Resume tab")
        add_class(resume, "button")
        resume.connect("clicked", lambda *_: self.resume_display())
        badge.pack_start(resume, False, False, 0)
        overlay.add_overlay(badge)
        self.pack_start(overlay, True, True, 0)

    def action_popover(self) -> Gtk.Popover:
        popover = Gtk.Popover()
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=5, margin=9)
        box.pack_start(text_label("Square options", "menu-title"), False, False, 0)
        actions = [
            ("Open in external browser", self.open_external, False),
            ("Freeze as screenshot", self.freeze, False),
            ("Turn display off", self.display_off, False),
            ("Move left", lambda: self.window.move_tile(self.tile, 0, -1), False),
            ("Move right", lambda: self.window.move_tile(self.tile, 0, 1), False),
            ("Move up", lambda: self.window.move_tile(self.tile, -1, 0), False),
            ("Move down", lambda: self.window.move_tile(self.tile, 1, 0), False),
            ("Merge with right", lambda: self.window.merge_tile(self.tile, "right"), False),
            ("Merge with below", lambda: self.window.merge_tile(self.tile, "down"), False),
            ("Split square", lambda: self.window.split_tile(self.tile), False),
            ("Terminate tab", self.terminate, True),
        ]
        for title, callback, danger in actions:
            button = Gtk.Button(label=title)
            add_class(button, "button", *(('danger',) if danger else ()))
            button.connect("clicked", lambda _b, cb=callback, p=popover: (p.popdown(), cb()))
            box.pack_start(button, False, False, 0)
        box.show_all()
        popover.add(box)
        return popover

    def library_selected(self, combo: Gtk.ComboBoxText) -> None:
        item_id = combo.get_active_id()
        if not item_id:
            return
        item = next((candidate for candidate in self.window.library if candidate["id"] == item_id), None)
        if item:
            self.tile["libraryId"] = item_id
            self.tile["title"] = item["name"]
            self.tile["authInjected"] = False
            self.navigate(item["url"])

    def source_changed(self, combo: Gtk.ComboBoxText) -> None:
        item_id = combo.get_active_id()
        if not item_id or item_id == "__custom__" or item_id == self.tile.get("libraryId"):
            return
        item = self.window.item_by_id(item_id)
        if not item:
            return
        self.tile.update({"libraryId": item_id, "title": item["name"], "authInjected": False, "mode": "browser"})
        self.navigate(item["url"])

    def show_options(self) -> None:
        popover = self.action_popover()
        popover.set_relative_to(self)
        popover.show_all()
        popover.popup()

    def load_url_dialog(self) -> None:
        dialog = Gtk.Dialog(title="Load URL", transient_for=self.window, modal=True)
        dialog.add_button("Cancel", Gtk.ResponseType.CANCEL)
        dialog.add_button("Open", Gtk.ResponseType.OK)
        entry = Gtk.Entry(text=self.tile.get("url", ""))
        entry.set_placeholder_text("https://example.com/")
        add_class(entry, "url-entry")
        content = dialog.get_content_area()
        content.set_margin_top(12); content.set_margin_bottom(12); content.set_margin_start(12); content.set_margin_end(12)
        content.add(entry)
        dialog.show_all(); entry.grab_focus()
        response = dialog.run()
        value = entry.get_text()
        dialog.destroy()
        if response == Gtk.ResponseType.OK:
            self.tile.update({"libraryId": "", "title": "", "authInjected": False, "mode": "browser"})
            self.navigate(value)

    def toggle_tracker(self) -> None:
        self.tile["mode"] = "tracker" if self.tile.get("mode") == "browser" else "browser"
        self.window.save_state(); self.render()

    def display_off(self) -> None:
        self.tile["resumeMode"] = self.tile.get("mode", "browser")
        self.set_mode("off")

    def resume_display(self) -> None:
        mode = self.tile.pop("resumeMode", "browser")
        self.set_mode(mode if mode in ("browser", "tracker") else "browser")

    def navigate(self, value: str) -> None:
        url = normalize_url(value)
        if not url:
            return
        self.tile.update({"url": url, "mode": "browser"})
        self.window.save_state()
        if self.webview:
            self.webview.load_uri(url)
        else:
            self.render()

    def set_mode(self, mode: str) -> None:
        self.tile["mode"] = mode
        self.window.save_state()
        self.render()

    def terminate(self) -> None:
        self.tile.update({"mode": "empty", "url": "", "title": "", "libraryId": ""})
        if self.frozen_path.exists():
            self.frozen_path.unlink()
        self.window.save_state()
        self.render()

    def freeze(self) -> None:
        if not self.webview and self.tile.get("mode") != "tracker":
            return
        self.tile["resumeMode"] = self.tile.get("mode", "browser")
        DATA_PATH.joinpath("frozen").mkdir(parents=True, exist_ok=True)
        if self.webview:
            self.webview.get_snapshot(WebKit2.SnapshotRegion.VISIBLE, WebKit2.SnapshotOptions.NONE, None, self.snapshot_ready, None)
        else:
            GLib.idle_add(self.capture_native_snapshot)

    def capture_native_snapshot(self) -> bool:
        translated = self.translate_coordinates(self.window, 0, 0)
        allocation = self.get_allocation()
        if translated and self.window.get_window():
            pixbuf = Gdk.pixbuf_get_from_window(self.window.get_window(), translated[0], translated[1], allocation.width, allocation.height)
            if pixbuf:
                pixbuf.savev(str(self.frozen_path), "png", [], [])
                self.set_mode("frozen")
        return False

    def snapshot_ready(self, webview: WebKit2.WebView, result: Any, _data: Any) -> None:
        try:
            surface = webview.get_snapshot_finish(result)
            surface.write_to_png(str(self.frozen_path))
            self.set_mode("frozen")
        except Exception as exc:
            print(f"snapshot failed for {self.tile['id']}: {exc}", flush=True)

    def launch_external(self, uri: str) -> None:
        if uri.startswith(("http://", "https://")):
            subprocess.Popen(["xdg-open", uri], start_new_session=True)

    def open_external(self) -> None:
        self.launch_external(self.tile.get("url", ""))

    def go_back(self) -> None:
        if self.webview and self.webview.can_go_back():
            self.webview.go_back()

    def go_forward(self) -> None:
        if self.webview and self.webview.can_go_forward():
            self.webview.go_forward()

    def reload(self) -> None:
        if self.webview:
            self.webview.reload()
        elif self.tracker_body:
            self.tracker_body.refresh()

    def cancel_connection_retry(self) -> None:
        if self.connection_retry_timer:
            GLib.source_remove(self.connection_retry_timer)
            self.connection_retry_timer = 0

    def schedule_connection_retry(self) -> None:
        if not self.connection_retry_timer:
            self.connection_retry_timer = GLib.timeout_add_seconds(
                CONNECTION_RETRY_SECONDS, self.retry_dead_connection
            )

    def retry_dead_connection(self) -> bool:
        if self.tile.get("mode") != "browser" or not self.webview:
            self.connection_retry_timer = 0
            return GLib.SOURCE_REMOVE
        self.webview.reload()
        return GLib.SOURCE_CONTINUE

    def title_changed(self, webview: WebKit2.WebView, _param: Any) -> None:
        title = webview.get_title() or ""
        if title and title != self.tile.get("title"):
            self.tile["title"] = title
            self.window.queue_save()

    def uri_changed(self, webview: WebKit2.WebView, _param: Any) -> None:
        uri = webview.get_uri() or ""
        if uri.startswith(("http://", "https://")):
            self.tile["url"] = uri
            self.window.queue_save()

    def load_changed(self, webview: WebKit2.WebView, event: WebKit2.LoadEvent) -> None:
        if event != WebKit2.LoadEvent.FINISHED:
            return
        self.cancel_connection_retry()
        item = self.window.item_by_id(self.tile.get("libraryId", ""))
        if not item:
            return
        if item.get("type") == "machine" and item.get("token") and not self.tile.get("authInjected"):
            script = f"localStorage.setItem('control-token', {json.dumps(item['token'])}); true;"
            self.tile["authInjected"] = True
            self.window.save_state()
            webview.run_javascript(script, None, lambda view, result: (view.run_javascript_finish(result), view.reload()), None)
        elif item.get("type") == "dashboard":
            self.window.autofill_dashboard(webview, item)

    def load_failed(
        self,
        _webview: WebKit2.WebView,
        _event: WebKit2.LoadEvent,
        _failing_uri: str,
        error: GLib.Error,
    ) -> bool:
        if error.matches(WebKit2.network_error_quark(), WebKit2.NetworkError.CANCELLED):
            return False
        if error.domain == GLib.quark_to_string(WebKit2.network_error_quark()):
            self.schedule_connection_retry()
        return False

    def permission_requested(self, webview: WebKit2.WebView, request: Any) -> bool:
        item = self.window.item_by_id(self.tile.get("libraryId", ""))
        current_uri = webview.get_uri() or ""
        configured_uri = item.get("url", "") if item else ""
        current_origin = urllib.parse.urlsplit(current_uri)[:2]
        configured_origin = urllib.parse.urlsplit(configured_uri)[:2]
        is_configured_machine = bool(
            item
            and item.get("type") == "machine"
            and current_origin == configured_origin
            and current_origin[0] in ("http", "https")
        )
        is_audio_only = bool(
            isinstance(request, WebKit2.UserMediaPermissionRequest)
            and request.get_property("is-for-audio-device")
            and not request.get_property("is-for-video-device")
        )
        if is_configured_machine and is_audio_only:
            request.allow()
        else:
            request.deny()
        return True

    def decide_policy(self, _webview: WebKit2.WebView, decision: Any, decision_type: Any) -> bool:
        if decision_type != WebKit2.PolicyDecisionType.NAVIGATION_ACTION:
            return False
        action = decision.get_navigation_action()
        if not action or action.get_navigation_type() != WebKit2.NavigationType.LINK_CLICKED:
            return False
        request = action.get_request()
        uri = request.get_uri() if request else ""
        if not uri.startswith(("http://", "https://")):
            return False
        decision.ignore()
        self.launch_external(uri)
        return True

    def new_window_requested(self, _webview: WebKit2.WebView, action: Any) -> WebKit2.WebView | None:
        request = action.get_request()
        uri = request.get_uri() if request else ""
        if uri:
            self.launch_external(uri)
        return None


class ControlRoomWindow(Gtk.ApplicationWindow):
    def __init__(self, app: Gtk.Application, config: dict[str, Any], state: dict[str, Any]) -> None:
        super().__init__(application=app, title="Codex Control Room — vm13")
        self.config = config
        self.state = state
        self.save_timer = 0
        self.tiles: list[BrowserTile] = []
        self.library = [*config.get("dashboards", []), *config.get("machines", [])]
        self.previous_cpu: tuple[int, int] | None = None
        self.set_decorated(False)
        self.set_default_size(1920, 1080)
        self.connect("key-press-event", self.key_pressed)
        provider = Gtk.CssProvider()
        provider.load_from_data(css())
        Gtk.StyleContext.add_provider_for_screen(Gdk.Screen.get_default(), provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
        self.web_context = WebKit2.WebContext.get_default()
        self.web_context.set_cache_model(WebKit2.CacheModel.WEB_BROWSER)
        manager = self.web_context.get_cookie_manager()
        DATA_PATH.mkdir(parents=True, exist_ok=True)
        manager.set_persistent_storage(str(DATA_PATH / "cookies.sqlite"), WebKit2.CookiePersistentStorage.SQLITE)
        self.shell = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
        add_class(self.shell, "shell")
        self.add(self.shell)
        self.shell.pack_start(self.topbar(), False, False, 0)
        self.grid = Gtk.Grid(row_spacing=2, column_spacing=2, row_homogeneous=True, column_homogeneous=True)
        add_class(self.grid, "grid")
        self.shell.pack_start(self.grid, True, True, 0)
        self.rebuild_grid()
        if state.get("fullscreen", True):
            self.fullscreen()

    def topbar(self) -> Gtk.Box:
        bar = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=10)
        add_class(bar, "topbar")
        settings = Gtk.MenuButton(label="☰")
        add_class(settings, "button")
        settings.set_popover(self.settings_popover())
        bar.pack_start(settings, False, False, 0)
        identity = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=0)
        identity.pack_start(text_label("NATIVE MULTI-TAB DISPLAY · VM13", "subbrand"), False, False, 0)
        identity.pack_start(text_label("CONTROL ROOM", "brand"), False, False, 0)
        bar.pack_start(identity, True, True, 0)
        self.cpu_value = self.system_metric(bar, "CPU")
        self.ram_value = self.system_metric(bar, "RAM")
        self.status_label = text_label("", "status", xalign=1.0)
        bar.pack_start(self.status_label, False, False, 0)
        GLib.timeout_add_seconds(1, self.update_status)
        self.update_status()
        return bar

    def system_metric(self, bar: Gtk.Box, name: str) -> Gtk.Label:
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=0)
        add_class(box, "system-metric")
        box.pack_start(text_label(name, "system-metric-name", xalign=1.0), False, False, 0)
        value = text_label("—", "system-metric-value", xalign=1.0)
        box.pack_start(value, False, False, 0)
        bar.pack_start(box, False, False, 0)
        return value

    def settings_popover(self) -> Gtk.Popover:
        popover = Gtk.Popover()
        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=7, margin=11)
        box.pack_start(text_label("Control room settings", "menu-title"), False, False, 0)
        for title, minimum, maximum, key in (("Columns", 1, 8, "columns"), ("Rows", 1, 3, "rows")):
            row = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=10)
            row.pack_start(text_label(title), True, True, 0)
            spin = Gtk.SpinButton.new_with_range(minimum, maximum, 1)
            spin.set_value(self.state[key])
            spin.connect("value-changed", lambda control, setting=key: self.resize_layout(setting, control.get_value_as_int()))
            row.pack_start(spin, False, False, 0)
            box.pack_start(row, False, False, 0)
        for title, callback in (
            ("Toggle fullscreen   F11", self.toggle_fullscreen),
            ("Scroll all tabs to bottom   Ctrl+↓", self.scroll_all_bottom),
            ("Reload all live tabs", self.reload_all),
        ):
            button = Gtk.Button(label=title)
            add_class(button, "button")
            button.connect("clicked", lambda _b, cb=callback, p=popover: (p.popdown(), cb()))
            box.pack_start(button, False, False, 0)
        box.pack_start(text_label("Layouts and tabs persist across reboots.", "menu-note"), False, False, 0)
        box.show_all()
        popover.add(box)
        return popover

    def rebuild_grid(self) -> None:
        for child in self.grid.get_children():
            self.grid.remove(child)
            child.destroy()
        self.tiles = []
        ordered = sorted(self.state["tiles"], key=lambda item: (item["row"], item["column"]))
        for position, tile in enumerate(ordered, 1):
            pane = BrowserTile(self, tile, position)
            self.tiles.append(pane)
            self.grid.attach(pane, tile["column"], tile["row"], tile.get("columnSpan", 1), tile.get("rowSpan", 1))
        self.grid.show_all()

    def save_state(self) -> None:
        atomic_json(STATE_PATH, self.state)

    def queue_save(self) -> None:
        if self.save_timer:
            GLib.source_remove(self.save_timer)
        self.save_timer = GLib.timeout_add(400, self._save_from_timer)

    def _save_from_timer(self) -> bool:
        self.save_timer = 0
        self.save_state()
        return False

    def item_by_id(self, item_id: str) -> dict[str, Any] | None:
        return next((item for item in self.library if item.get("id") == item_id), None)

    def name_for_url(self, url: str) -> str:
        item = next((candidate for candidate in self.library if candidate.get("url", "").rstrip("/") == url.rstrip("/")), None)
        if item:
            return item["name"]
        try:
            return urllib.parse.urlparse(url).hostname or "Tab"
        except ValueError:
            return "Tab"

    def autofill_dashboard(self, webview: WebKit2.WebView, item: dict[str, Any]) -> None:
        credential = item.get("credential") or {}
        if credential.get("mode") not in ("access-key", "form"):
            return
        payload = json.dumps(credential)
        script = """(function(c){const vis=e=>e&&!e.disabled&&e.type!=='hidden'&&e.getClientRects().length;
        const first=s=>{for(const q of s)for(const e of document.querySelectorAll(q))if(vis(e))return e};let u,p,t;
        if(c.mode==='access-key'){t=first(['input[name*="key" i]','input[id*="key" i]','input[name*="token" i]','input[type="password"]']);}
        else{u=first(['input[autocomplete="username"]','input[type="email"]','input[name*="user" i]','input[type="text"]']);p=first(['input[type="password"]']);t=p||u;}
        const set=(e,v)=>{if(!e)return;const d=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value');d&&d.set?d.set.call(e,v):e.value=v;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}))};
        c.mode==='access-key'?set(t,c.password):(set(u,c.username),set(p,c.password));if(c.autoSubmit&&t)setTimeout(()=>{const f=t.form||(u&&u.form);if(f)f.requestSubmit?f.requestSubmit():f.submit();else first(['button[type="submit"]','input[type="submit"]'])?.click()},250)})(%s);""" % payload
        webview.run_javascript(script, None, None, None)

    def occupied(self, row: int, column: int, ignore: dict[str, Any] | None = None) -> dict[str, Any] | None:
        for tile in self.state["tiles"]:
            if tile is ignore:
                continue
            if tile["row"] <= row < tile["row"] + tile.get("rowSpan", 1) and tile["column"] <= column < tile["column"] + tile.get("columnSpan", 1):
                return tile
        return None

    def move_tile(self, tile: dict[str, Any], dr: int, dc: int) -> None:
        row, column = tile["row"] + dr, tile["column"] + dc
        if row < 0 or column < 0 or row + tile.get("rowSpan", 1) > self.state["rows"] or column + tile.get("columnSpan", 1) > self.state["columns"]:
            return
        other = self.occupied(row, column, tile)
        if other and other.get("rowSpan", 1) == tile.get("rowSpan", 1) and other.get("columnSpan", 1) == tile.get("columnSpan", 1):
            other["row"], tile["row"] = tile["row"], other["row"]
            other["column"], tile["column"] = tile["column"], other["column"]
        elif not other:
            tile["row"], tile["column"] = row, column
        else:
            return
        self.save_state(); self.rebuild_grid()

    def merge_tile(self, tile: dict[str, Any], direction: str) -> None:
        if direction == "right":
            target = self.occupied(tile["row"], tile["column"] + tile.get("columnSpan", 1), tile)
            compatible = target and target["row"] == tile["row"] and target.get("rowSpan", 1) == tile.get("rowSpan", 1)
            if compatible:
                tile["columnSpan"] = tile.get("columnSpan", 1) + target.get("columnSpan", 1)
            else:
                return
        else:
            target = self.occupied(tile["row"] + tile.get("rowSpan", 1), tile["column"], tile)
            compatible = target and target["column"] == tile["column"] and target.get("columnSpan", 1) == tile.get("columnSpan", 1)
            if compatible:
                tile["rowSpan"] = tile.get("rowSpan", 1) + target.get("rowSpan", 1)
            else:
                return
        self.state["tiles"].remove(target)
        self.save_state(); self.rebuild_grid()

    def split_tile(self, tile: dict[str, Any]) -> None:
        width, height = tile.get("columnSpan", 1), tile.get("rowSpan", 1)
        if width == 1 and height == 1:
            return
        if width >= height and width > 1:
            first = width // 2; second = width - first
            tile["columnSpan"] = first
            row, column, row_span, column_span = tile["row"], tile["column"] + first, height, second
        else:
            first = height // 2; second = height - first
            tile["rowSpan"] = first
            row, column, row_span, column_span = tile["row"] + first, tile["column"], second, width
        new_id = f"tab-{self.state['nextId']}"; self.state["nextId"] += 1
        self.state["tiles"].append({"id": new_id, "row": row, "column": column, "rowSpan": row_span, "columnSpan": column_span, "mode": "empty", "url": "", "title": ""})
        self.save_state(); self.rebuild_grid()

    def resize_layout(self, key: str, value: int) -> None:
        if value == self.state[key]:
            return
        self.state[key] = value
        # Layout resizing intentionally normalizes merged regions, preserves tabs
        # in reading order, and creates only empty tabs for added cells.
        ordered = sorted(self.state["tiles"], key=lambda item: (item["row"], item["column"]))
        capacity = self.state["columns"] * self.state["rows"]
        ordered = ordered[:capacity]
        while len(ordered) < capacity:
            new_id = f"tab-{self.state['nextId']}"; self.state["nextId"] += 1
            ordered.append({"id": new_id, "mode": "empty", "url": "", "title": ""})
        for index, tile in enumerate(ordered):
            tile.update({"row": index // self.state["columns"], "column": index % self.state["columns"], "rowSpan": 1, "columnSpan": 1})
        self.state["tiles"] = ordered
        self.save_state(); self.rebuild_grid()

    def toggle_fullscreen(self) -> None:
        state = self.get_window().get_state() if self.get_window() else 0
        enabled = not bool(state & Gdk.WindowState.FULLSCREEN)
        self.state["fullscreen"] = enabled
        self.save_state()
        self.fullscreen() if enabled else self.unfullscreen()

    def scroll_all_bottom(self) -> None:
        for tile in self.tiles:
            if tile.webview:
                tile.webview.run_javascript("window.scrollTo(0, document.documentElement.scrollHeight);", None, None, None)

    def reload_all(self) -> None:
        for tile in self.tiles:
            tile.reload()

    def update_status(self) -> bool:
        live = sum(1 for tile in self.state["tiles"] if tile.get("mode") in ("browser", "tracker"))
        dormant = len(self.state["tiles"]) - live
        try:
            fields = [int(value) for value in Path("/proc/stat").read_text().splitlines()[0].split()[1:]]
            idle, total = fields[3] + fields[4], sum(fields)
            if self.previous_cpu:
                idle_delta, total_delta = idle - self.previous_cpu[0], total - self.previous_cpu[1]
                cpu = 100 * (1 - idle_delta / total_delta) if total_delta else 0
                self.cpu_value.set_text(f"{cpu:.0f}%")
            self.previous_cpu = (idle, total)
            memory = {}
            for line in Path("/proc/meminfo").read_text().splitlines():
                key, value = line.split(":", 1)
                memory[key] = int(value.strip().split()[0])
            used = memory["MemTotal"] - memory["MemAvailable"]
            self.ram_value.set_text(f"{100 * used / memory['MemTotal']:.0f}%")
        except (OSError, ValueError, KeyError):
            pass
        self.status_label.set_text(f"{self.state['columns']}×{self.state['rows']}  ·  {live} LIVE  ·  {dormant} DORMANT  ·  {time.strftime('%H:%M:%S')}")
        return True

    def key_pressed(self, _widget: Gtk.Widget, event: Gdk.EventKey) -> bool:
        ctrl = bool(event.state & Gdk.ModifierType.CONTROL_MASK)
        if event.keyval == Gdk.KEY_F11:
            self.toggle_fullscreen(); return True
        if ctrl and event.keyval == Gdk.KEY_Down:
            self.scroll_all_bottom(); return True
        return False


def load_files() -> tuple[dict[str, Any], dict[str, Any]]:
    config = json.loads(CONFIG_PATH.read_text(encoding="utf-8")) if CONFIG_PATH.exists() else {"version": 2, "dashboards": [], "machines": []}
    try:
        state = json.loads(STATE_PATH.read_text(encoding="utf-8")) if STATE_PATH.exists() and STATE_PATH.stat().st_size else blank_state()
    except (json.JSONDecodeError, OSError):
        if STATE_PATH.exists():
            STATE_PATH.replace(STATE_PATH.with_suffix(f".corrupt-{int(time.time())}.json"))
        state = blank_state()
    if config.get("version") != 2 or state.get("version") != 2:
        raise ValueError("configuration/state version must be 2")
    if not STATE_PATH.exists():
        atomic_json(STATE_PATH, state)
    return config, state


class App(Gtk.Application):
    def __init__(self) -> None:
        super().__init__(application_id=APP_ID)

    def do_activate(self) -> None:
        existing = self.get_active_window()
        if existing:
            existing.present()
            return
        config, state = load_files()
        window = ControlRoomWindow(self, config, state)
        window.show_all(); window.present()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--validate", action="store_true")
    args = parser.parse_args()
    if args.validate:
        config, state = load_files()
        assert 1 <= state["columns"] <= 8 and 1 <= state["rows"] <= 3
        assert all(normalize_url(item.get("url", "")) for item in [*config.get("dashboards", []), *config.get("machines", [])])
        print(f"valid: {len(config.get('dashboards', []))} dashboards, {len(config.get('machines', []))} machines, {len(state['tiles'])} squares")
    else:
        raise SystemExit(App().run(None))
