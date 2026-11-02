#!/usr/bin/env python3
"""Exercise real WebKit connection failures on an isolated Xvfb display."""

import importlib.util
import os
import socket
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

source = os.environ.get("CONTROL_ROOM_TEST_SOURCE", str(Path(__file__).with_name("control_room.py")))
spec = importlib.util.spec_from_file_location("control_room", source)
room = importlib.util.module_from_spec(spec)
spec.loader.exec_module(room)
Gtk, GLib, Gio = room.Gtk, room.GLib, room.Gio
room.QUICK_CONNECTION_RETRY_SECONDS = (1, 1, 1)
room.CONNECTION_RETRY_SECONDS = 1


def wait_for(predicate, timeout=10):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        while Gtk.events_pending():
            Gtk.main_iteration_do(False)
        if predicate():
            return
        time.sleep(0.01)
    raise AssertionError("Timed out waiting for recovery")


class Page(BaseHTTPRequestHandler):
    status = 200
    requests = 0
    mode = "normal"
    slow_started = threading.Event()
    slow_release = threading.Event()

    def do_GET(self):
        Page.requests += 1
        if self.path == "/slow-image":
            Page.slow_started.set()
            Page.slow_release.wait(10)
        self.send_response(503 if self.path == "/broken-frame" else Page.status)
        self.send_header("Content-Type", "text/html")
        self.end_headers()
        body = b"<html><title>Recovered dashboard</title><body>Online</body></html>"
        if self.path == "/dashboard" and Page.mode == "iframe":
            body += b'<iframe src="/broken-frame"></iframe>'
        if self.path == "/dashboard" and Page.mode == "slow":
            body += b'<img src="/slow-image">'
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            # The hung-resource test deliberately cancels this connection.
            pass

    def log_message(self, *_args):
        pass


with tempfile.TemporaryDirectory(prefix="control-room-recovery-") as temporary:
    room.DATA_PATH = Path(temporary)
    room.STATE_PATH = room.DATA_PATH / "state.json"
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    state = room.blank_state(1, 1)
    state["fullscreen"] = False
    url = f"http://127.0.0.1:{port}/dashboard"
    state["tiles"][0].update(mode="browser", url=url, title="Cloudflare Tunnel error")
    app = Gtk.Application(application_id="com.bit68.ControlRoomRecoveryTest")
    app.register(None)
    failures = []
    original_load_failed = room.BrowserTile.load_failed

    def record_failure(self, webview, event, uri, error):
        failures.append(error)
        return original_load_failed(self, webview, event, uri, error)

    room.BrowserTile.load_failed = record_failure
    config = {"version": 2, "dashboards": [{"id": "other", "type": "dashboard", "name": "Other dashboard", "url": url + "/other"}]}
    window = room.ControlRoomWindow(app, config, state)
    window.show_all()
    tile = window.tiles[0]
    wait_for(lambda: bool(failures))
    assert failures[0].domain == "g-io-error-quark", failures[0]
    assert tile.connection_retry_timer, "GIO connection failure must schedule an automatic retry"
    assert tile.connection_notice.get_visible()
    assert tile.tile["url"] == url
    server = ThreadingHTTPServer(("127.0.0.1", port), Page)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        wait_for(lambda: tile.webview.get_title() == "Recovered dashboard" and not tile.webview.is_loading())
        assert not tile.connection_notice.get_visible()
        assert not tile.connection_retry_timer
        assert tile.connection_retry_attempt == 0
        assert tile.page_title_label.get_text() == "Recovered dashboard"
        assert tile.source_combo.get_active_text() == "Recovered dashboard"
        assert not tile.tile.get("libraryId") and tile.tile["url"] == url
        # A failed subframe must not hide a healthy main dashboard.
        Page.mode = "iframe"
        tile.reload()
        wait_for(lambda: not tile.webview.is_loading())
        assert not tile.navigation_failed and not tile.connection_retry_timer
        assert not tile.connection_notice.get_visible()
        # Recovery becomes visible on main-document commit, even if an image hangs.
        Page.mode = "slow"
        room.PAGE_LOAD_TIMEOUT_SECONDS = 1
        route_error = GLib.Error.new_literal(Gio.io_error_quark(), "No route to host", Gio.IOErrorEnum.HOST_UNREACHABLE)
        tile.load_failed(tile.webview, room.WebKit2.LoadEvent.STARTED, url, route_error)
        tile.reload()
        wait_for(Page.slow_started.is_set)
        wait_for(lambda: not tile.connection_notice.get_visible())
        assert tile.webview.is_loading()
        wait_for(lambda: bool(tile.connection_retry_timer))
        assert tile.connection_error == "Page load timed out"
        Page.mode = "normal"
        Page.slow_release.set()
        room.PAGE_LOAD_TIMEOUT_SECONDS = 30
        wait_for(lambda: not tile.navigation_failed and not tile.webview.is_loading() and not tile.connection_retry_timer)
        assert not tile.connection_notice.get_visible()
        # A renderer crash must restart automatically, too.
        tile.webview.terminate_web_process()
        wait_for(lambda: bool(tile.connection_retry_timer))
        wait_for(lambda: not tile.navigation_failed and not tile.webview.is_loading() and not tile.connection_retry_timer)
        assert not tile.connection_notice.get_visible()
        # Server errors must continue retrying beyond the initial retry sequence.
        Page.status = 503
        start = Page.requests
        tile.reload()
        wait_for(lambda: Page.requests >= start + 5 and bool(tile.connection_retry_timer))
        assert tile.connection_notice.get_visible()
        Page.status = 200
        wait_for(lambda: not tile.navigation_failed and not tile.webview.is_loading() and not tile.connection_retry_timer)
        assert not tile.connection_notice.get_visible()
        # No-route-to-host is the same GIO family as the real refused connection.
        error = GLib.Error.new_literal(Gio.io_error_quark(), "No route to host", Gio.IOErrorEnum.HOST_UNREACHABLE)
        assert tile.load_failed(tile.webview, room.WebKit2.LoadEvent.STARTED, url, error)
        assert tile.connection_retry_timer
        tile.reload()  # Manual retry restores the configured URL, not an error page.
        wait_for(lambda: not tile.webview.is_loading() and not tile.connection_retry_timer)
        assert not tile.connection_notice.get_visible()
        cancelled = GLib.Error.new_literal(Gio.io_error_quark(), "Cancelled", Gio.IOErrorEnum.CANCELLED)
        assert not tile.load_failed(tile.webview, room.WebKit2.LoadEvent.STARTED, url, cancelled)
        assert not tile.connection_retry_timer
        tile.load_failed(tile.webview, room.WebKit2.LoadEvent.STARTED, url, error)
        tile.display_off()
        assert not tile.connection_retry_timer and tile.webview is None
        assert not tile.load_timeout_timer
        print("PASS: GIO recovery, subframe isolation, hung resource timeout, renderer restart, repeated HTTP 503, manual retry, cancellation, display off")
    finally:
        window.destroy()
        Page.slow_release.set()
        server.shutdown()
        server.server_close()
