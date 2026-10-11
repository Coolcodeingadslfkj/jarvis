"""Application launcher index for the APPS menu (desktop entries + themed icons + usage stats)."""

import configparser
import glob
import json
import os
import re
import shutil
import subprocess
import threading
import time

from . import config

USAGE_FILE = os.path.join(config.CONFIG_DIR, "apps.json")
DIRS = [os.path.expanduser("~/.local/share/applications"), "/usr/share/applications",
        "/var/lib/flatpak/exports/share/applications", os.path.expanduser("~/.local/share/flatpak/exports/share/applications")]
CATEGORY_MAP = [
    ("Development", "Development"), ("Game", "Games"), ("AudioVideo", "Media"), ("Audio", "Media"), ("Video", "Media"),
    ("Graphics", "Graphics"), ("Network", "Internet"), ("WebBrowser", "Internet"), ("Office", "Office"),
    ("Science", "Science"), ("Education", "Education"), ("Settings", "System"), ("System", "System"), ("Utility", "Utilities"),
]

_lock = threading.Lock()
_icons = None
_apps = {"at": 0, "list": []}


def _icon_themes():
    theme = "breeze-dark"
    cp = configparser.RawConfigParser(strict=False)
    try:
        cp.read(os.path.expanduser("~/.config/kdeglobals"))
        theme = cp.get("Icons", "Theme", fallback=theme)
    except Exception:
        pass
    order, seen = [], set()

    def add(name):
        if name in seen:
            return
        seen.add(name)
        for base in (os.path.expanduser("~/.local/share/icons"), os.path.expanduser("~/.icons"), "/usr/share/icons"):
            d = os.path.join(base, name)
            if os.path.isdir(d):
                order.append(d)
                idx = configparser.RawConfigParser(strict=False)
                try:
                    idx.read(os.path.join(d, "index.theme"))
                    for parent in idx.get("Icon Theme", "Inherits", fallback="").split(","):
                        if parent.strip():
                            add(parent.strip())
                except Exception:
                    pass
    for t in (theme, "breeze-dark", "breeze", "hicolor"):
        add(t)
    return order


def _size_score(path):
    if path.endswith(".svg"):
        return 10000
    m = re.search(r"/(\d+)(?:x\d+)?(?:@\d)?/", path)
    n = int(m.group(1)) if m else 32
    return n if n <= 256 else 256 - (n - 256) / 1000


def _icon_index():
    global _icons
    if _icons is not None:
        return _icons
    idx = {}
    for rank, theme_dir in enumerate(_icon_themes()):
        found = {}
        for dirpath, _dirs, files in os.walk(theme_dir, followlinks=True):
            if "/apps" not in dirpath and "/applications" not in dirpath:
                continue
            for f in files:
                name, ext = os.path.splitext(f)
                if ext not in (".svg", ".png"):
                    continue
                p = os.path.join(dirpath, f)
                if name not in found or _size_score(p) > _size_score(found[name]):
                    found[name] = p
        for k, v in found.items():
            idx.setdefault(k, v)  # earlier themes win
    for f in glob.glob("/usr/share/pixmaps/*"):
        name, ext = os.path.splitext(os.path.basename(f))
        if ext in (".svg", ".png", ".xpm"):
            idx.setdefault(name, f)
    _icons = idx
    return idx


def icon_path(icon):
    if not icon:
        return None
    if os.path.isabs(icon):
        return icon if os.path.exists(icon) else None
    idx = _icon_index()
    return idx.get(icon) or idx.get(icon.lower()) or idx.get(re.sub(r"\.(png|svg|xpm)$", "", icon))


def _usage():
    try:
        with open(USAGE_FILE) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {"launches": {}, "favorites": []}


def _save_usage(u):
    os.makedirs(config.CONFIG_DIR, exist_ok=True)
    with open(USAGE_FILE, "w") as f:
        json.dump(u, f)


def list_apps(force=False):
    with _lock:
        if not force and _apps["list"] and time.time() - _apps["at"] < 120:
            apps = _apps["list"]
        else:
            seen, apps = set(), []
            for d in DIRS:
                for f in sorted(glob.glob(os.path.join(d, "*.desktop"))):
                    base = os.path.basename(f)
                    if base in seen:
                        continue
                    seen.add(base)
                    cp = configparser.RawConfigParser(strict=False, interpolation=None)
                    try:
                        cp.read(f, encoding="utf-8")
                        e = cp["Desktop Entry"]
                    except Exception:
                        continue
                    if e.get("Type") != "Application" or e.get("NoDisplay", "false").lower() == "true" \
                            or e.get("Hidden", "false").lower() == "true":
                        continue
                    if "KDE" not in os.environ.get("XDG_CURRENT_DESKTOP", "KDE") and e.get("OnlyShowIn"):
                        continue
                    if e.get("OnlyShowIn") and "KDE" not in e.get("OnlyShowIn", ""):
                        continue
                    if e.get("NotShowIn") and "KDE" in e.get("NotShowIn", ""):
                        continue
                    cats = e.get("Categories", "")
                    group = next((g for k, g in CATEGORY_MAP if k in cats.split(";")), "Other")
                    apps.append({"id": base[:-8], "file": f, "name": e.get("Name", base[:-8]),
                                 "generic": e.get("GenericName", ""), "comment": e.get("Comment", ""),
                                 "keywords": e.get("Keywords", ""), "category": group,
                                 "icon": icon_path(e.get("Icon", "")), "terminal": e.get("Terminal", "false") == "true"})
            apps.sort(key=lambda a: a["name"].lower())
            _apps.update(at=time.time(), list=apps)
    u = _usage()
    out = []
    for a in apps:
        a = dict(a)
        a["launches"] = u["launches"].get(a["id"], 0)
        a["favorite"] = a["id"] in u["favorites"]
        out.append(a)
    return out


def launch(app_id):
    app = next((a for a in list_apps() if a["id"] == app_id), None)
    if not app:
        raise ValueError("Unknown application")
    if shutil.which("gio"):
        subprocess.Popen(["gio", "launch", app["file"]], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         start_new_session=True)
    else:
        subprocess.Popen(["gtk-launch", app["id"]], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         start_new_session=True)
    u = _usage()
    u["launches"][app_id] = u["launches"].get(app_id, 0) + 1
    _save_usage(u)
    return app["name"]


def toggle_favorite(app_id):
    u = _usage()
    if app_id in u["favorites"]:
        u["favorites"].remove(app_id)
    else:
        u["favorites"].append(app_id)
    _save_usage(u)
    return app_id in u["favorites"]


def recent_files(limit=12):
    """Recently used files from the freedesktop recently-used.xbel list."""
    import xml.etree.ElementTree as ET
    from urllib.parse import unquote, urlparse
    path = os.path.expanduser("~/.local/share/recently-used.xbel")
    try:
        root = ET.parse(path).getroot()
    except Exception:
        return []
    items = []
    for b in root.findall("bookmark"):
        href = b.get("href", "")
        if not href.startswith("file://"):
            continue
        p = unquote(urlparse(href).path)
        if os.path.exists(p):
            items.append({"path": p, "name": os.path.basename(p) or p, "when": b.get("modified") or b.get("visited") or "",
                          "dir": os.path.isdir(p)})
    items.sort(key=lambda x: x["when"], reverse=True)
    return items[:limit]
