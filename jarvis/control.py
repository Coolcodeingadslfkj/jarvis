"""System controls for the CONTROL menu: audio, brightness, night light, Wi-Fi, Bluetooth,
media players (MPRIS), screenshots. Uses PipeWire/KDE/NetworkManager/BlueZ via their CLIs and D-Bus.
No root needed."""

import json
import os
import re
import shutil
import subprocess
import time


def _run(cmd, timeout=6, check=False):
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    if check and r.returncode != 0:
        raise RuntimeError((r.stderr or r.stdout).strip() or f"{cmd[0]} failed")
    return r.stdout


def _busctl_json(*args, system=False):
    out = _run(["busctl", "--system" if system else "--user", "--json=short", *args])
    return json.loads(out) if out.strip() else None


def _unwrap(v):
    """busctl JSON {"type":..,"data":..} -> plain python."""
    if isinstance(v, dict) and set(v) == {"type", "data"}:
        return _unwrap(v["data"])
    if isinstance(v, dict):
        return {k: _unwrap(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_unwrap(x) for x in v]
    return v


# ------------------------------------------------------------------ audio
def _wp_volume(target):
    out = _run(["wpctl", "get-volume", target])
    m = re.search(r"Volume:\s*([\d.]+)", out)
    return {"volume": round(float(m.group(1)) * 100) if m else 0, "muted": "MUTED" in out}


def audio():
    if not shutil.which("wpctl"):
        return {"available": False}
    sink, source = _wp_volume("@DEFAULT_AUDIO_SINK@"), _wp_volume("@DEFAULT_AUDIO_SOURCE@")
    sinks, sources, dsink, dsource = [], [], "", ""
    if shutil.which("pactl"):
        try:
            dsink = _run(["pactl", "get-default-sink"]).strip()
            dsource = _run(["pactl", "get-default-source"]).strip()
            sinks = [{"name": s["name"], "label": s.get("description", s["name"])}
                     for s in json.loads(_run(["pactl", "-f", "json", "list", "sinks"]) or "[]")]
            sources = [{"name": s["name"], "label": s.get("description", s["name"])}
                       for s in json.loads(_run(["pactl", "-f", "json", "list", "sources"]) or "[]")
                       if not s["name"].endswith(".monitor")]
        except Exception:
            pass
    return {"available": True, "sink": sink, "source": source, "sinks": sinks, "sources": sources,
            "default_sink": dsink, "default_source": dsource}


def set_volume(kind, value=None, mute=None):
    target = "@DEFAULT_AUDIO_SOURCE@" if kind == "source" else "@DEFAULT_AUDIO_SINK@"
    if value is not None:
        v = max(0, min(150, float(value))) / 100.0
        _run(["wpctl", "set-volume", "-l", "1.5", target, f"{v:.2f}"], check=True)
    if mute is not None:
        _run(["wpctl", "set-mute", target, "toggle" if mute == "toggle" else ("1" if mute else "0")], check=True)
    return _wp_volume(target)


def set_default_device(kind, name):
    _run(["pactl", "set-default-source" if kind == "source" else "set-default-sink", name], check=True)
    return True


# ------------------------------------------------------------------ brightness
def displays():
    try:
        names = _unwrap(_busctl_json("get-property", "org.kde.ScreenBrightness", "/org/kde/ScreenBrightness",
                                     "org.kde.ScreenBrightness", "DisplaysDBusNames"))
    except Exception:
        return []
    out = []
    for n in names or []:
        try:
            p = _unwrap(_busctl_json("call", "org.kde.ScreenBrightness", f"/org/kde/ScreenBrightness/{n}",
                                     "org.freedesktop.DBus.Properties", "GetAll", "s", "org.kde.ScreenBrightness.Display"))[0]
            mx = p.get("MaxBrightness") or 1
            out.append({"id": n, "label": p.get("Label", n), "internal": p.get("IsInternal", False),
                        "percent": round(100 * p.get("Brightness", 0) / mx), "max": mx})
        except Exception:
            continue
    out.sort(key=lambda d: not d["internal"])
    return out


def set_brightness(display_id, percent):
    if not re.fullmatch(r"display\d+", display_id or ""):
        raise ValueError("bad display id")
    d = next((x for x in displays() if x["id"] == display_id), None)
    if not d:
        raise ValueError("display not found")
    val = int(max(1, min(100, float(percent))) / 100 * d["max"])
    _run(["busctl", "--user", "call", "org.kde.ScreenBrightness", f"/org/kde/ScreenBrightness/{display_id}",
          "org.kde.ScreenBrightness.Display", "SetBrightness", "iu", str(val), "0"], check=True)
    return True


def set_all_brightness(percent):
    for d in displays():
        set_brightness(d["id"], percent)
    return True


# ------------------------------------------------------------------ night light
def night_light():
    try:
        p = _unwrap(_busctl_json("call", "org.kde.KWin", "/org/kde/KWin/NightLight", "org.freedesktop.DBus.Properties",
                                 "GetAll", "s", "org.kde.KWin.NightLight"))[0]
        return {"available": p.get("available", False), "enabled": p.get("enabled", False), "running": p.get("running", False),
                "temperature": p.get("currentTemperature"), "target": p.get("targetTemperature"), "daylight": p.get("daylight")}
    except Exception:
        return {"available": False}


def set_night_light(enabled):
    kwc = shutil.which("kwriteconfig6") or shutil.which("kwriteconfig5") or "kwriteconfig6"
    _run([kwc, "--file", "kwinrc", "--group", "NightColor", "--key", "Active", "true" if enabled else "false"], check=True)
    _run(["busctl", "--user", "call", "org.kde.KWin", "/KWin", "org.kde.KWin", "reconfigure"])
    time.sleep(0.4)
    return night_light()


# ------------------------------------------------------------------ network
def wifi(rescan=False):
    if not shutil.which("nmcli"):
        return {"available": False}
    radio = _run(["nmcli", "-t", "-f", "WIFI", "radio"]).strip() == "enabled"
    nets = []
    if radio:
        out = _run(["nmcli", "-t", "-e", "yes", "-f", "IN-USE,SSID,SIGNAL,SECURITY,CHAN", "dev", "wifi", "list",
                    "--rescan", "yes" if rescan else "no"], timeout=15)
        seen = {}
        for line in out.splitlines():
            parts = re.split(r"(?<!\\):", line)
            if len(parts) < 5 or not parts[1]:
                continue
            ssid = parts[1].replace("\\:", ":")
            n = {"active": parts[0] == "*", "ssid": ssid, "signal": int(parts[2] or 0), "security": parts[3], "channel": parts[4]}
            if ssid not in seen or n["active"] or n["signal"] > seen[ssid]["signal"]:
                seen[ssid] = n
        nets = sorted(seen.values(), key=lambda n: (not n["active"], -n["signal"]))
    known = set(_run(["nmcli", "-t", "-f", "NAME,TYPE", "con", "show"]).replace("802-11-wireless", "wifi").split("\n"))
    for n in nets:
        n["known"] = f"{n['ssid']}:wifi" in known
    active = []
    for line in _run(["nmcli", "-t", "-f", "NAME,TYPE,DEVICE", "con", "show", "--active"]).splitlines():
        name, typ, dev = (line.split(":") + ["", "", ""])[:3]
        if typ != "loopback":
            active.append({"name": name, "type": typ.replace("802-11-wireless", "wifi").replace("802-3-ethernet", "ethernet"), "device": dev})
    ips = []
    try:
        for a in json.loads(_run(["ip", "-j", "-4", "addr"])):
            if a["ifname"] != "lo":
                for i in a.get("addr_info", []):
                    ips.append({"iface": a["ifname"], "ip": i["local"]})
    except Exception:
        pass
    return {"available": True, "radio": radio, "networks": nets[:30], "active": active, "ips": ips}


def set_wifi(enabled):
    _run(["nmcli", "radio", "wifi", "on" if enabled else "off"], check=True)
    return True


def wifi_connect(ssid, password=None):
    known = _run(["nmcli", "-t", "-f", "NAME", "con", "show"]).splitlines()
    if ssid in known and not password:
        _run(["nmcli", "con", "up", "id", ssid], timeout=40, check=True)
    else:
        cmd = ["nmcli", "dev", "wifi", "connect", ssid]
        if password:
            cmd += ["password", password]
        _run(cmd, timeout=40, check=True)
    return f"Connected to {ssid}"


# ------------------------------------------------------------------ bluetooth
def bluetooth():
    try:
        powered = _unwrap(_busctl_json("get-property", "org.bluez", "/org/bluez/hci0", "org.bluez.Adapter1", "Powered", system=True))
    except Exception:
        return {"available": False}
    devices = []
    try:
        try:
            raw = _unwrap(_busctl_json("call", "org.kde.kded6", "/modules/bluedevil", "org.kde.BlueDevil", "allDevices"))
        except Exception:  # Plasma 5
            raw = _unwrap(_busctl_json("call", "org.kde.kded5", "/modules/bluedevil", "org.kde.BlueDevil", "allDevices"))
        for path, d in (raw[0] if raw else {}).items():
            if d.get("name"):
                devices.append({"name": d.get("name"), "address": d.get("address"), "connected": d.get("connected") == "true",
                                "paired": d.get("paired") == "true", "icon": d.get("icon", "")})
    except Exception:
        pass
    devices.sort(key=lambda d: (not d["connected"], not d["paired"], d["name"]))
    return {"available": True, "powered": bool(powered), "devices": devices}


def set_bluetooth(enabled):
    if enabled:
        _run(["rfkill", "unblock", "bluetooth"])
    _run(["busctl", "--system", "set-property", "org.bluez", "/org/bluez/hci0", "org.bluez.Adapter1", "Powered", "b",
          "true" if enabled else "false"], check=True)
    return True


# ------------------------------------------------------------------ media (MPRIS)
ART_DIR = os.path.join(os.environ.get("XDG_CACHE_HOME", os.path.expanduser("~/.cache")), "jarvis", "art")
_art_pending = set()
_art_failed = {}


def _fetch_art(url, path):
    import urllib.request
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=8) as r:
            data = r.read(5 * 1024 * 1024)
        if not data:
            raise ValueError("empty image")
        os.makedirs(ART_DIR, exist_ok=True)
        with open(path + ".tmp", "wb") as f:
            f.write(data)
        os.replace(path + ".tmp", path)
    except Exception:
        _art_failed[url] = time.monotonic()
    finally:
        _art_pending.discard(url)


def _local_art(url):
    """Album art as a file:// URL. The HUD page may not load remote URLs, so http(s) art (Spotify's)
    is downloaded once into ~/.cache/jarvis/art; until that finishes the card shows the plain icon."""
    if not url.startswith(("http://", "https://")):
        return url
    # Spotify still reports its retired image host; the same image id lives on i.scdn.co
    url = re.sub(r"^https?://open\.spotify\.com/image/", "https://i.scdn.co/image/", url)
    import hashlib
    path = os.path.join(ART_DIR, hashlib.sha1(url.encode()).hexdigest() + ".jpg")
    if os.path.exists(path):
        return "file://" + path
    if url not in _art_pending and time.monotonic() - _art_failed.get(url, -1e9) > 300:
        import threading
        _art_pending.add(url)
        threading.Thread(target=_fetch_art, args=(url, path), daemon=True).start()
    return ""


def _players():
    try:
        names = _busctl_json("list")
        return [x["name"] for x in names if x["name"].startswith("org.mpris.MediaPlayer2.")]
    except Exception:
        return []


def media():
    out = []
    for name in _players():
        try:
            p = _unwrap(_busctl_json("call", name, "/org/mpris/MediaPlayer2", "org.freedesktop.DBus.Properties",
                                     "GetAll", "s", "org.mpris.MediaPlayer2.Player"))[0]
            md = p.get("Metadata", {}) or {}
            ident = name.split(".")[-1]
            try:
                ident = _unwrap(_busctl_json("get-property", name, "/org/mpris/MediaPlayer2", "org.mpris.MediaPlayer2", "Identity"))
            except Exception:
                pass
            artist = md.get("xesam:artist") or []
            out.append({"id": name, "player": ident, "status": p.get("PlaybackStatus", "Stopped"),
                        "title": md.get("xesam:title", ""), "artist": ", ".join(artist) if isinstance(artist, list) else str(artist),
                        "album": md.get("xesam:album", ""), "art": _local_art(md.get("mpris:artUrl", "")),
                        "length": (md.get("mpris:length") or 0) / 1e6, "position": (p.get("Position") or 0) / 1e6,
                        "can_next": p.get("CanGoNext", False), "can_prev": p.get("CanGoPrevious", False)})
        except Exception:
            continue
    out.sort(key=lambda m: m["status"] != "Playing")
    return out


def media_cmd(player, action):
    if action not in ("PlayPause", "Play", "Pause", "Next", "Previous", "Stop"):
        raise ValueError("bad media action")
    players = _players()
    if not player:
        live = media()
        player = live[0]["id"] if live else None
    if player not in players:
        raise RuntimeError("No media player is running")
    _run(["busctl", "--user", "call", player, "/org/mpris/MediaPlayer2", "org.mpris.MediaPlayer2.Player", action], check=True)
    return True


# ------------------------------------------------------------------ screenshots / misc
def screenshot(mode="full"):
    folder = os.path.expanduser("~/Pictures/Screenshots")
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, time.strftime("jarvis-%Y%m%d-%H%M%S.png"))
    flag = {"full": "-f", "region": "-r", "window": "-a", "screen": "-m"}.get(mode, "-f")
    if mode == "region":
        # region selection is interactive: let spectacle run on its own
        subprocess.Popen(["spectacle", "-b", "-n", flag, "-o", path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         start_new_session=True)
        return path
    _run(["spectacle", "-b", "-n", flag, "-o", path], timeout=20, check=True)
    return path


def updates():
    """Pending package updates for this distribution (see distro.py)."""
    from . import distro
    return distro.updates()
