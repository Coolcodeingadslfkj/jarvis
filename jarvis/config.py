"""Persistent settings (~/.config/jarvis/config.json) and login autostart."""

import json
import os
import sys

CONFIG_DIR = os.path.join(os.environ.get("XDG_CONFIG_HOME", os.path.expanduser("~/.config")), "jarvis")
CONFIG_FILE = os.path.join(CONFIG_DIR, "config.json")
AUTOSTART_FILE = os.path.join(os.environ.get("XDG_CONFIG_HOME", os.path.expanduser("~/.config")),
                              "autostart", "jarvis.desktop")
APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

DEFAULTS = {
    "screen": "auto",         # auto = the built-in screen (laptop) or the primary monitor; else an output name
    "theme": "dark",          # dark | light | system (follow KDE) | time (light 07:00-19:00)
    "skin": "jarvis",         # whole-app theme: jarvis | celestia (web/js/skins.js)
    "accent": "jarvis",       # J.A.R.V.I.S. theme colour (web/js/hud.js ACCENTS)
    "fullscreen": True,
    "interval_ms": 1000,
    "fps": 20,
    "eco_on_battery": True,
    "voice": True,            # speak replies (Piper: trained J.A.R.V.I.S. voice, else British "Alan")
    "voice_rate": 1.0,
    "wake_word": False,       # always listen for "Jarvis" (offline, Vosk)
    "hotkeys": True,          # Meta+J talk, Meta+Shift+J show/hide (KDE global shortcuts)
    "speak_briefing": True,   # read the HOME briefing aloud when J.A.R.V.I.S. starts
    "alerts": True,           # battery / thermal / disk / memory warnings
    "alerts_desktop": True,
    "alerts_voice": True,
    "weather_location": "",   # empty = locate by IP; or e.g. "Dayton, Ohio"
    "weather_unit": "auto",   # auto | fahrenheit | celsius
    "terminal_prompt": True,  # J.A.R.V.I.S. bash prompt + banner in the TERMINAL menu
    "boot_animation": True,
    "show_hidden": False,
    "temp_warn": 75,
    "temp_crit": 90,
    "software_render": False, # CPU compositing, for GPUs/drivers where the HUD stays blank
}

_cache = None


def load():
    global _cache
    if _cache is None:
        data = dict(DEFAULTS)
        try:
            with open(CONFIG_FILE) as f:
                data.update(json.load(f))
        except (OSError, ValueError):
            pass
        if data.get("_v", 1) < 2:
            # v2: voice became local (Piper) and on by default; old files saved the old default
            data["voice"] = True
            data["_v"] = 2
        _cache = data
    return dict(_cache)


def get(key, default=None):
    return load().get(key, default)


def set_value(key, value):
    load()
    _cache[key] = value
    os.makedirs(CONFIG_DIR, exist_ok=True)
    tmp = CONFIG_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(_cache, f, indent=2)
    os.replace(tmp, CONFIG_FILE)


def autostart_enabled():
    return os.path.exists(AUTOSTART_FILE)


def autostart_entry():
    run = os.path.join(APP_DIR, "run.sh")
    return f"""[Desktop Entry]
Type=Application
Name=J.A.R.V.I.S.
Comment=Just A Rather Very Intelligent System - system HUD
Exec="{run}" --autostart
Icon=jarvis
Terminal=false
Categories=System;Monitor;
X-GNOME-Autostart-enabled=true
X-KDE-autostart-phase=2
"""


def set_autostart(enabled):
    if enabled:
        os.makedirs(os.path.dirname(AUTOSTART_FILE), exist_ok=True)
        with open(AUTOSTART_FILE, "w") as f:
            f.write(autostart_entry())
    elif os.path.exists(AUTOSTART_FILE):
        os.remove(AUTOSTART_FILE)


if __name__ == "__main__":  # used by install.sh
    if len(sys.argv) > 1 and sys.argv[1] == "autostart-on":
        set_autostart(True)
    elif len(sys.argv) > 1 and sys.argv[1] == "autostart-off":
        set_autostart(False)
