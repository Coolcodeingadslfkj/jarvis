"""MUSIC menu backend: follows Spotify over MPRIS, runs cava for the bar visualizer while Spotify plays,
and fetches time-synced lyrics.

Spotify on Linux doesn't share its own lyrics, so lyrics come from LRCLIB (lrclib.net, a free, open
lyrics database): the track's title, artist, album and length are sent there, and the answer is cached in
~/.cache/jarvis/lyrics. cava only runs while Spotify is playing *and* the HUD shows something that uses
the bars (the MUSIC menu, or dancing Hina), so it costs nothing otherwise. While it runs the HUD draws
at 60 fps for smooth bars (js/app.js), which costs more CPU only during playback.
"""

import hashlib
import json
import os
import re
import shutil
import subprocess
import threading
import time
import urllib.parse
import urllib.request

from PySide6.QtCore import QObject, QTimer, Signal

from . import control

SPOTIFY = "org.mpris.MediaPlayer2.spotify"
BARS = 48
CACHE = os.path.join(os.environ.get("XDG_CACHE_HOME", os.path.expanduser("~/.cache")), "jarvis", "lyrics")
CAVA_CONF = f"""[general]
framerate = 60
bars = {BARS}
autosens = 1
sleep_timer = 0
[input]
method = pipewire
source = auto
[output]
method = raw
raw_target = /dev/stdout
data_format = ascii
ascii_max_range = 1000
bar_delimiter = 59
frame_delimiter = 10
channels = mono
[smoothing]
noise_reduction = 35
"""


def spotify_state():
    """Spotify's track and playback state, or None when Spotify isn't running."""
    if SPOTIFY not in control._players():
        return None
    p = control._unwrap(control._busctl_json("call", SPOTIFY, "/org/mpris/MediaPlayer2", "org.freedesktop.DBus.Properties",
                                             "GetAll", "s", "org.mpris.MediaPlayer2.Player"))[0]
    md = p.get("Metadata", {}) or {}
    artist = md.get("xesam:artist") or []
    return {"status": p.get("PlaybackStatus", "Stopped"), "id": md.get("mpris:trackid", ""),
            "title": md.get("xesam:title", ""), "artist": ", ".join(artist) if isinstance(artist, list) else str(artist),
            "album": md.get("xesam:album", ""), "art": control._local_art(md.get("mpris:artUrl", "")),
            "length": (md.get("mpris:length") or 0) / 1e6, "position": (p.get("Position") or 0) / 1e6}


# ------------------------------------------------------------------ lyrics
def _lrc(text):
    """Parse LRC ("[mm:ss.xx] line") into [[seconds, line], ...]."""
    out = []
    for line in (text or "").splitlines():
        stamps = re.findall(r"\[(\d+):(\d+(?:\.\d+)?)\]", line)
        words = re.sub(r"\[[^\]]*\]", "", line).strip()
        for m, s in stamps:
            out.append([int(m) * 60 + float(s), words])
    return sorted(out)


def _get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "JARVIS-HUD (local desktop app)"})
    with urllib.request.urlopen(req, timeout=8) as r:
        return json.load(r)


def lyrics(artist, title, album="", duration=0):
    """{"synced": [[t, line], ...] or [], "plain": str, "source": str}; cached, misses included."""
    key = hashlib.sha1(f"{artist}\n{title}\n{round(duration)}".encode()).hexdigest()
    path = os.path.join(CACHE, key + ".json")
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        pass
    q = {"artist_name": artist, "track_name": title}
    if album:
        q["album_name"] = album
    if duration:
        q["duration"] = round(duration)
    best = None
    try:
        best = _get("https://lrclib.net/api/get?" + urllib.parse.urlencode(q))
    except Exception:
        pass
    good = lambda d: d and len(_lrc(d.get("syncedLyrics"))) >= 5  # noqa: E731 (skip junk single-line entries)
    if not good(best):
        try:
            found = _get("https://lrclib.net/api/search?" + urllib.parse.urlencode({"artist_name": artist, "track_name": title}))
            synced = [d for d in found if good(d)]
            pool = synced or [d for d in found if d.get("plainLyrics")]
            if pool:
                best = min(pool, key=lambda d: abs((d.get("duration") or 0) - duration) if duration else 0)
        except Exception as e:
            if best is None:
                return {"synced": [], "plain": "", "source": "", "error": str(e)}   # offline: don't cache
    res = {"synced": _lrc(best.get("syncedLyrics")) if good(best) else [],
           "plain": (best or {}).get("plainLyrics") or "", "source": "LRCLIB" if best else ""}
    os.makedirs(CACHE, exist_ok=True)
    with open(path, "w") as f:
        json.dump(res, f)
    return res


# ------------------------------------------------------------------ watcher + visualizer
class Music(QObject):
    """Polls Spotify, pushes its state, and runs cava while Spotify plays and the HUD wants bars."""
    state = Signal(str)   # JSON of spotify_state() (or null), on change and with each position update
    bars = Signal(str)    # one cava frame: "v;v;v;..." with values 0-1000

    def __init__(self, pool, parent=None):
        super().__init__(parent)
        self.pool = pool
        self.want = False          # set by the HUD: something visible draws the bars
        self.playing = False
        self._cava = None
        self._busy = False
        self._last = None
        self._conf = os.path.join(os.environ.get("XDG_RUNTIME_DIR") or "/tmp", f"jarvis-cava-{os.getpid()}.conf")
        self._state_done = _Relay(self)
        self._state_done.done.connect(self._on_state)
        self.timer = QTimer(self)
        self.timer.timeout.connect(self._poll)
        self.timer.start(1500)
        self._poll()

    def _poll(self):
        if self._busy:
            return
        self._busy = True

        def work():
            try:
                s = spotify_state()
            except Exception:
                s = None
            self._state_done.done.emit(json.dumps(s))
        self.pool.submit(work)

    def _on_state(self, js):
        self._busy = False
        s = json.loads(js)
        self.playing = bool(s and s["status"] == "Playing")
        # tell the HUD on any change, and every poll while playing (position for the lyrics)
        if js != self._last or self.playing:
            self._last = js
            self.state.emit(js)
        self._update_cava()

    def set_want(self, want):
        self.want = bool(want)
        self._update_cava()

    def _update_cava(self):
        run = self.want and self.playing and shutil.which("cava") is not None
        if run and not self._cava:
            with open(self._conf, "w") as f:
                f.write(CAVA_CONF)
            self._cava = subprocess.Popen(["cava", "-p", self._conf], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                          stdin=subprocess.DEVNULL, text=True, bufsize=1)
            threading.Thread(target=self._read, args=(self._cava,), daemon=True).start()
        elif not run and self._cava:
            self.stop()
            self.bars.emit("")   # visualizer falls back to rest

    def _read(self, proc):
        last = 0.0
        for line in proc.stdout:
            now = time.monotonic()
            if now - last >= 1 / 62:   # cava's own rate (60 fps); never flood the web channel
                last = now
                self.bars.emit(line.strip().rstrip(";"))

    def stop(self):
        p, self._cava = self._cava, None
        if p and p.poll() is None:
            p.terminate()
            try:
                p.wait(timeout=2)
            except subprocess.TimeoutExpired:
                p.kill()

    def shutdown(self):
        self.timer.stop()
        self.stop()
        try:
            os.unlink(self._conf)
        except OSError:
            pass


class _Relay(QObject):
    done = Signal(str)   # hands a worker thread's result back to the GUI thread
