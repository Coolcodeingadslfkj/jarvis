"""PROTOCOLS: named macros ("House Party Protocol") made of simple steps.

Steps run in order on a worker thread. Steps that need the UI (switching menus, terminal
commands, theme, speech) are forwarded to the page through the `ui` callback.
"""

import json
import os
import time
import uuid

from . import apps, config, control, distro, files, procs

FILE = os.path.join(config.CONFIG_DIR, "protocols.json")

STEP_TYPES = {
    "say":        {"label": "Speak",              "arg": "text"},
    "notify":     {"label": "Desktop notification", "arg": "text"},
    "launch":     {"label": "Launch app",          "arg": "app"},
    "open":       {"label": "Open file / folder / URL", "arg": "text"},
    "command":    {"label": "Run in terminal",     "arg": "text"},
    "close":      {"label": "Close app (process name)", "arg": "text"},
    "volume":     {"label": "Set volume %",        "arg": "number"},
    "mute":       {"label": "Mute speakers",       "arg": "bool"},
    "brightness": {"label": "Set brightness %",    "arg": "number"},
    "nightlight": {"label": "Night light",         "arg": "bool"},
    "dnd":        {"label": "Do not disturb",      "arg": "bool"},
    "wifi":       {"label": "Wi-Fi",               "arg": "bool"},
    "bluetooth":  {"label": "Bluetooth",           "arg": "bool"},
    "media":      {"label": "Media",               "arg": "choice", "choices": ["PlayPause", "Play", "Pause", "Next", "Previous"]},
    "theme":      {"label": "HUD theme",           "arg": "choice", "choices": ["dark", "light"]},
    "view":       {"label": "Show menu",           "arg": "choice",
                   "choices": ["home", "systems", "files", "terminal", "apps", "processes", "control", "protocols", "power", "console"]},
    "power":      {"label": "Power action (asks first)", "arg": "choice", "choices": ["lock", "suspend", "hibernate", "reboot", "poweroff"]},
    "wait":       {"label": "Wait seconds",        "arg": "number"},
}


def _p(name, icon, desc, steps, builtin=True):
    return {"id": name.lower().replace(" ", "-"), "name": name, "icon": icon, "description": desc, "steps": steps,
            "builtin": builtin}


DEFAULTS = [
    _p("House Party", "party", "Turn it up: speakers loud, notifications on, lights bright, music playing.", [
        {"type": "say", "value": "House Party Protocol engaged. Let's get this party started, sir."},
        {"type": "mute", "value": False}, {"type": "volume", "value": 85}, {"type": "dnd", "value": False},
        {"type": "nightlight", "value": False}, {"type": "brightness", "value": 100}, {"type": "media", "value": "Play"},
    ]),
    _p("Focus", "focus", "Deep work: do not disturb, quiet audio, chat apps closed.", [
        {"type": "dnd", "value": True}, {"type": "close", "value": "Discord"}, {"type": "volume", "value": 30},
        {"type": "view", "value": "terminal"},
        {"type": "say", "value": "Focus protocol engaged. Notifications are silenced, sir."},
    ]),
    _p("Night Owl", "night", "Easy on the eyes: dark HUD, night light, dimmed screens, low volume.", [
        {"type": "theme", "value": "dark"}, {"type": "nightlight", "value": True}, {"type": "brightness", "value": 30},
        {"type": "volume", "value": 25}, {"type": "say", "value": "Night mode active. Get some rest soon, sir."},
    ]),
    _p("Daylight", "day", "Bright and clear: light HUD, night light off, full brightness.", [
        {"type": "theme", "value": "light"}, {"type": "nightlight", "value": False}, {"type": "brightness", "value": 85},
        {"type": "say", "value": "Good morning, sir. Daylight protocol engaged."},
    ]),
    _p("Diagnostics", "diag", "Full system check in the terminal: updates, failed services, errors, disk.", [
        {"type": "say", "value": "Running full system diagnostics."},
        {"type": "command", "value": "echo '== Pending updates =='; " + (distro.COMMANDS["pending"] or "echo 'n/a'") + "; echo; echo '== Failed services =='; "
                                     "systemctl --failed --no-pager; echo; echo '== Errors this boot =='; journalctl -p 3 -b --no-pager | tail -20; "
                                     "echo; echo '== Disks =='; df -h -x tmpfs -x devtmpfs; echo; echo '== Sensors =='; sensors 2>/dev/null | grep -E 'CPU|GPU|Composite|Package'"},
    ]),
    _p("Clean Slate", "clean", "Housekeeping in the terminal: clear thumbnail cache and old packages (asks for sudo).", [
        {"type": "say", "value": "Clean Slate protocol. Removing caches you won't miss."},
        {"type": "command", "value": "du -sh ~/.cache/thumbnails 2>/dev/null; rm -rf ~/.cache/thumbnails/*; echo 'Thumbnail cache cleared.'; "
                                     + (distro.COMMANDS["clean"] or "true")},
    ]),
    _p("Lockdown", "lock", "Leaving the desk: pause media, mute, lock the session.", [
        {"type": "media", "value": "Pause"}, {"type": "mute", "value": True},
        {"type": "say", "value": "Securing the workstation."}, {"type": "wait", "value": 2}, {"type": "power", "value": "lock"},
    ]),
]


def load():
    try:
        with open(FILE) as f:
            data = json.load(f)
    except (OSError, ValueError):
        data = {"custom": [], "hidden": []}
    hidden = set(data.get("hidden", []))
    builtin = [p for p in DEFAULTS if p["id"] not in hidden]
    overrides = {p["id"]: p for p in data.get("custom", [])}
    out = [overrides.pop(p["id"], p) for p in builtin]
    out += list(overrides.values())
    return out


def _save(data):
    os.makedirs(config.CONFIG_DIR, exist_ok=True)
    with open(FILE, "w") as f:
        json.dump(data, f, indent=2)


def _raw():
    try:
        with open(FILE) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {"custom": [], "hidden": []}


def save(proto):
    data = _raw()
    proto = dict(proto)
    proto["id"] = proto.get("id") or (proto["name"].lower().replace(" ", "-") + "-" + uuid.uuid4().hex[:4])
    proto["builtin"] = any(p["id"] == proto["id"] for p in DEFAULTS)
    for s in proto.get("steps", []):
        if s.get("type") not in STEP_TYPES:
            raise ValueError(f"Unknown step type {s.get('type')}")
    data["custom"] = [p for p in data.get("custom", []) if p["id"] != proto["id"]] + [proto]
    _save(data)
    return proto


def delete(pid):
    data = _raw()
    data["custom"] = [p for p in data.get("custom", []) if p["id"] != pid]
    if any(p["id"] == pid for p in DEFAULTS):
        data.setdefault("hidden", []).append(pid)
    _save(data)
    return True


def restore_defaults():
    data = _raw()
    ids = {p["id"] for p in DEFAULTS}
    data["hidden"] = []
    data["custom"] = [p for p in data.get("custom", []) if p["id"] not in ids]
    _save(data)
    return True


def find(name):
    n = name.lower().replace("protocol", "").strip(" -")
    for p in load():
        if p["name"].lower() == n or p["id"] == n:
            return p
    for p in load():
        if n and (n in p["name"].lower() or p["name"].lower() in n):
            return p
    return None


def _bool(v):
    return v if isinstance(v, bool) else str(v).lower() in ("1", "true", "on", "yes")


def run(proto, ui, dnd, log=print):
    """Execute a protocol. ui(dict) forwards UI steps; dnd(bool) toggles do-not-disturb."""
    results = []
    for i, s in enumerate(proto.get("steps", [])):
        t, v = s.get("type"), s.get("value")
        ok, msg = True, ""
        try:
            if t == "launch":
                lst = apps.list_apps()
                app = next((a for a in lst if a["id"] == v), None) or \
                    next((a for a in lst if str(v).lower() in a["name"].lower()), None)
                if not app:
                    raise RuntimeError(f"app '{v}' not found")
                msg = apps.launch(app["id"])
            elif t == "open":
                if str(v).startswith(("http://", "https://")):
                    import webbrowser
                    webbrowser.open(v)
                else:
                    files.open_path(v)
            elif t == "close":
                found = procs.find_by_name(str(v))
                for p in found:
                    p.terminate()
                msg = f"{len(found)} closed"
            elif t == "volume":
                control.set_volume("sink", float(v))
            elif t == "mute":
                control.set_volume("sink", mute=_bool(v))
            elif t == "brightness":
                control.set_all_brightness(float(v))
            elif t == "nightlight":
                control.set_night_light(_bool(v))
            elif t == "wifi":
                control.set_wifi(_bool(v))
            elif t == "bluetooth":
                control.set_bluetooth(_bool(v))
            elif t == "media":
                try:
                    control.media_cmd(None, v)
                except RuntimeError as e:
                    msg = str(e)
            elif t == "dnd":
                dnd(_bool(v))
            elif t == "notify":
                import subprocess
                subprocess.Popen(["notify-send", "-a", "J.A.R.V.I.S.", "-i", "jarvis", "J.A.R.V.I.S.", str(v)])
            elif t == "wait":
                time.sleep(max(0, min(60, float(v))))
            elif t in ("say", "command", "theme", "view", "power"):
                ui({"step": t, "value": v})
            else:
                raise ValueError(f"unknown step {t}")
        except Exception as e:
            ok, msg = False, str(e)
            log(f"[protocol] {proto['name']} step {i + 1} ({t}) failed: {e}")
        results.append({"type": t, "ok": ok, "msg": msg})
    return results
