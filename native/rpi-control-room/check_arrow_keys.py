#!/usr/bin/env python3
"""Real GTK/WebKit keyboard test; run with xvfb-run -a /usr/bin/python3."""

import importlib.util
import json
import subprocess
import tempfile
import time
from pathlib import Path

spec = importlib.util.spec_from_file_location("control_room", Path(__file__).with_name("control_room.py"))
room = importlib.util.module_from_spec(spec)
spec.loader.exec_module(room)
Gtk, GLib = room.Gtk, room.GLib


def wait_for(predicate, timeout=15):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        while Gtk.events_pending():
            Gtk.main_iteration_do(False)
        if predicate():
            return
        time.sleep(0.01)
    raise AssertionError("Timed out waiting for GTK/WebKit")


def evaluate(view, script):
    result = []

    def finished(webview, task, _data):
        result.append(webview.run_javascript_finish(task).get_js_value().to_string())

    view.run_javascript(script, None, finished, None)
    wait_for(lambda: bool(result))
    return json.loads(result[0])


def send_keys(*keys):
    subprocess.run(["xdotool", "key", "--clearmodifiers", *keys], check=True)


with tempfile.TemporaryDirectory(prefix="control-room-keys-") as temporary:
    room.DATA_PATH = Path(temporary)
    room.STATE_PATH = room.DATA_PATH / "state.json"
    state = room.blank_state(5, 1)
    state["fullscreen"] = False
    for tile in state["tiles"][:2]:
        tile.update(mode="browser", url="about:blank")
    state["tiles"][2].update(mode="off", url="about:blank")
    state["tiles"][3].update(mode="frozen", url="about:blank")
    app = Gtk.Application(application_id="com.bit68.ControlRoomArrowTest")
    app.register(None)
    window = room.ControlRoomWindow(app, {"version": 2}, state)
    window.show_all()
    views = [tile.webview for tile in window.tiles if tile.webview]
    assert len(views) == 2
    html = """<!doctype html><style>body {width:5000px;height:5000px}</style>
    <script>window.keys=[]; for(const type of ['keydown','keyup'])
    document.addEventListener(type,e=>keys.push({type:e.type,key:e.key,
    ctrl:e.ctrlKey,shift:e.shiftKey,trusted:e.isTrusted}));</script>"""
    for view in views:
        view.load_html(html, None)
    wait_for(lambda: all(not view.is_loading() for view in views))
    subprocess.run(["xdotool", "windowfocus", str(window.get_window().get_xid())], check=True)
    views[0].grab_focus()
    wait_for(lambda: views[0].has_focus())
    send_keys("Down", "Right", "Up", "Left", "ctrl+Down", "shift+Right")
    expected = ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight"]
    for view in views:
        wait_for(lambda: evaluate(view, "JSON.stringify(keys.filter(e=>e.key.startsWith('Arrow')).length)") == 12)
        events = evaluate(view, "JSON.stringify(keys.filter(e=>e.key.startsWith('Arrow')))")
        assert [e["key"] for e in events if e["type"] == "keydown"] == expected, events
        assert [e["key"] for e in events if e["type"] == "keyup"] == expected, events
        assert all(e["trusted"] for e in events), events
        assert events[8]["ctrl"], events
        assert events[10]["shift"], events
        evaluate(view, "keys=[];window.scrollTo(0,0);JSON.stringify(true)")
    # Reverse focus: the other square must still receive each event only once.
    views[1].grab_focus()
    send_keys("Down", "Right")
    for view in views:
        wait_for(lambda: evaluate(view, "JSON.stringify(keys.length)") == 4)
        wait_for(lambda: evaluate(view, "JSON.stringify(scrollY>0 && scrollX>0)"))
        evaluate(view, "keys=[];JSON.stringify(true)")
    # Ordinary text keys stay in the focused square.
    send_keys("a")
    wait_for(lambda: evaluate(views[1], "JSON.stringify(keys.length)") == 2)
    assert evaluate(views[0], "JSON.stringify(keys)") == []
    for view in views:
        evaluate(view, "keys=[];JSON.stringify(true)")
    # Arrows also broadcast when focus is on a native toolbar control.
    window.shell.get_children()[0].get_children()[0].grab_focus()
    send_keys("Down", "KP_Left")
    for view in views:
        wait_for(lambda: evaluate(view, "JSON.stringify(keys.length)") == 4)
        assert evaluate(view, "JSON.stringify(keys.map(e=>e.key))") == ["ArrowDown", "ArrowDown", "ArrowLeft", "ArrowLeft"]
    window.destroy()
    print("PASS: trusted arrow press/release, modifiers, scrolling, focus, dormant squares, ordinary keys")
