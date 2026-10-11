"""QWebChannel bridge between the HTML HUD and the Python backend.

The JS side calls `bridge.call(id, method, argsJson)`; the work runs on a thread
pool and the result comes back through the `reply(id, json)` signal so the UI
never blocks. Telemetry is pushed once per second through `stats(json)`.
"""

import json
import os
import shutil
import subprocess
import time
import traceback
from concurrent.futures import ThreadPoolExecutor

from PySide6.QtCore import QObject, QTimer, Signal, Slot

from . import apps, commands, config, control, files, music, persona, power, procs, protocols, weather
from .monitor import Monitor
from .terminal import PtyManager
from .voice import Voice


class Bridge(QObject):
    reply = Signal(str, str)
    stats = Signal(str)
    event = Signal(str)          # push events from Python (e.g. screen changes, tray actions)
    ptyData = Signal(str, str)   # terminal session id, output
    ptyExit = Signal(str, int)
    voiceState = Signal(str)
    voicePartial = Signal(str)
    voiceHeard = Signal(str)
    voiceLevel = Signal(float)
    voiceWake = Signal()
    spotify = Signal(str)        # MUSIC: Spotify state (JSON) on change and while playing
    vizBars = Signal(str)        # MUSIC: one visualizer frame, "v;v;...;v" (0-1000), "" when stopped
    _done = Signal(str, str)
    _dnd_signal = Signal(bool)
    _stats_done = Signal(str)

    def __init__(self, window_ctl, parent=None):
        super().__init__(parent)
        self.win = window_ctl
        self.pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="jarvis")
        self.stat_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="jarvis-stats")
        self.monitor = Monitor()
        self.latest = {}
        self._busy = False
        self._done.connect(self.reply)
        self._dnd_signal.connect(self.set_dnd)  # protocols run off-thread; D-Bus call must happen here
        self._stats_done.connect(self._on_stats)
        self.timer = QTimer(self)
        self.timer.timeout.connect(self._tick)
        self.timer.start(int(config.get("interval_ms", 1000)))
        self._alerted, self._hot = {}, {}
        self._dnd_cookie = None
        self.voice = Voice(self)
        self.voice.state.connect(self.voiceState)
        self.voice.partial.connect(self.voicePartial)
        self.voice.heard.connect(self.voiceHeard)
        self.voice.level.connect(self.voiceLevel)
        self.voice.wake.connect(self.voiceWake)
        self.voice.wake.connect(lambda: self.win.request("show") if not self.win.isVisible() else None)
        self.voice.set_wake_word(bool(config.get("wake_word", False)))
        self.pty = PtyManager(self)
        self.pty.data.connect(self.ptyData)
        self.pty.exited.connect(self.ptyExit)
        self.music = music.Music(self.pool, self)
        self.music.state.connect(self.spotify)
        self.music.bars.connect(self.vizBars)

    # ---------------------------------------------------------------- stats
    def _tick(self):
        if self._busy:
            return
        self._busy = True

        def work():
            try:
                data = self.monitor.collect()
                self.latest = data
                self._stats_done.emit(json.dumps(data, default=str))
            except Exception:
                traceback.print_exc()
                self._stats_done.emit("")
        self.stat_pool.submit(work)

    def _on_stats(self, payload):
        self._busy = False
        if payload:
            self.stats.emit(payload)
            try:
                self._check_alerts(self.latest)
            except Exception:
                traceback.print_exc()

    # ---------------------------------------------------------------- alerts
    def push(self, **event):
        self.event.emit(json.dumps(event, default=str))

    def _alert(self, key, title, text, level="warn", cooldown=600):
        now = time.monotonic()
        if now - self._alerted.get(key, -1e9) < cooldown:
            return
        self._alerted[key] = now
        self.push(type="alert", level=level, title=title, text=text)
        if config.get("alerts_desktop", True) and shutil.which("notify-send"):
            subprocess.Popen(["notify-send", "-a", "J.A.R.V.I.S.", "-i", "jarvis",
                              "-u", "critical" if level == "crit" else "normal", title, text])
        if config.get("voice", True) and config.get("alerts_voice", True):
            self.voice.speak(f"{title}. {text}")

    def _check_alerts(self, d):
        if not config.get("alerts", True):
            return
        crit = float(config.get("temp_crit", 90))
        cpu_t = d["cpu"].get("temp") or 0
        self._hot["cpu"] = self._hot.get("cpu", 0) + 1 if cpu_t >= crit else 0
        if self._hot["cpu"] >= 15:  # sustained for ~15 s, not a single spike
            self._alert("cpu-hot", "Thermal warning", persona.line("cpu_hot", f"CPU temperature is {cpu_t:.0f} degrees, sir.", t=f"{cpu_t:.0f}"), "crit")
        nv = d["gpu"]["nvidia"]
        gpu_t = nv.get("temp") or 0 if nv.get("state") == "active" else 0
        self._hot["gpu"] = self._hot.get("gpu", 0) + 1 if gpu_t >= crit else 0
        if self._hot["gpu"] >= 15:
            self._alert("gpu-hot", "Thermal warning", persona.line("gpu_hot", f"GPU temperature is {gpu_t:.0f} degrees, sir.", t=f"{gpu_t:.0f}"), "crit")
        b = d.get("battery")
        if b and not b["plugged"]:
            for lvl, sev in ((5, "crit"), (10, "crit"), (20, "warn")):
                if b["percent"] <= lvl:
                    self._alert(f"bat-{lvl}", "Power cell low", persona.line("battery_low", f"Battery at {b['percent']:.0f} percent. I suggest plugging in.", p=f"{b['percent']:.0f}"), sev, 3600)
                    break
        elif b and b["plugged"]:
            for k in ("bat-5", "bat-10", "bat-20"):
                self._alerted.pop(k, None)
        if d["ram"]["percent"] >= 95:
            self._alert("ram", "Memory critical", f"Memory usage at {d['ram']['percent']:.0f} percent.", "warn")
        for disk in d.get("disks", []):
            if disk["percent"] >= 95:
                self._alert("disk-" + disk["mount"], "Storage nearly full", f"{disk['mount']} is {disk['percent']:.0f} percent full.", "warn", 3600)

    def set_paused(self, paused):
        # Slow the sampling down when the window is hidden to save power.
        self.timer.setInterval(5000 if paused else int(config.get("interval_ms", 1000)))

    # ---------------------------------------------------------------- RPC
    @Slot(str, str, str)
    def call(self, req_id, method, args_json):
        try:
            args = json.loads(args_json or "{}")
        except ValueError:
            args = {}
        fn = getattr(self, "rpc_" + method, None)
        if fn is None:
            self._done.emit(req_id, json.dumps({"ok": False, "error": f"Unknown method {method}"}))
            return

        def work():
            try:
                result = fn(**args)
                out = {"ok": True, "result": result}
            except Exception as e:
                out = {"ok": False, "error": str(e) or e.__class__.__name__}
            self._done.emit(req_id, json.dumps(out, default=str))
        if method in self.MAIN_THREAD:
            work()  # touches Qt objects; must stay on the GUI thread
        else:
            self.pool.submit(work)

    MAIN_THREAD = {"screens", "window", "set_config", "info", "term_open", "term_close", "term_cwd", "term_style", "dnd", "dnd_state",
                   "music_want"}

    # ---------------------------------------------------------------- control
    def rpc_control_state(self):
        out = {}
        for k, fn in (("audio", control.audio), ("displays", control.displays), ("night", control.night_light),
                      ("bluetooth", control.bluetooth), ("media", control.media)):
            try:
                out[k] = fn()
            except Exception as e:
                out[k] = {"error": str(e)}
        out["dnd"] = self._dnd_cookie is not None
        return out

    def rpc_wifi(self, rescan=False):
        return control.wifi(rescan)

    def rpc_wifi_set(self, enabled):
        return control.set_wifi(enabled)

    def rpc_wifi_connect(self, ssid, password=None):
        return control.wifi_connect(ssid, password)

    def rpc_volume(self, kind="sink", value=None, mute=None):
        return control.set_volume(kind, value, mute)

    def rpc_audio_device(self, kind, name):
        return control.set_default_device(kind, name)

    def rpc_brightness(self, display, percent):
        return control.set_brightness(display, percent)

    def rpc_night_light(self, enabled):
        return control.set_night_light(enabled)

    def rpc_bluetooth(self, enabled):
        return control.set_bluetooth(enabled)

    def rpc_media(self, player=None, action="PlayPause"):
        return control.media_cmd(player, action)

    # -- music (Spotify)
    def rpc_music_want(self, want):
        """The HUD shows something that draws the visualizer; cava runs only then (and while Spotify plays)."""
        self.music.set_want(want)

    def rpc_lyrics(self, artist, title, album="", duration=0):
        return music.lyrics(artist, title, album, float(duration or 0))

    def rpc_screenshot(self, mode="full"):
        return control.screenshot(mode)

    def rpc_updates(self):
        return control.updates()

    def rpc_distro(self):
        from . import distro
        return distro.info()

    def rpc_mic_ready(self):
        """Unmute the default microphone (called when the user explicitly starts push-to-talk)."""
        src = control.audio().get("source", {})
        changed = False
        if src.get("muted"):
            control.set_volume("source", mute=False)
            changed = True
        if src.get("volume", 100) < 20:
            control.set_volume("source", 70)
            changed = True
        return changed

    def rpc_dnd_state(self):
        return self._dnd_cookie is not None

    def rpc_dnd(self, enabled):
        self.set_dnd(enabled)
        return self._dnd_cookie is not None

    def set_dnd(self, enabled):
        """Do Not Disturb via the notification server's Inhibit (held for as long as J.A.R.V.I.S. runs)."""
        from PySide6.QtDBus import QDBusConnection, QDBusInterface
        if enabled and self._dnd_cookie is None:
            iface = QDBusInterface("org.freedesktop.Notifications", "/org/freedesktop/Notifications",
                                   "org.freedesktop.Notifications", QDBusConnection.sessionBus())
            r = iface.call("Inhibit", "jarvis", "J.A.R.V.I.S. focus", {})
            if r.arguments():
                self._dnd_cookie = int(r.arguments()[0])
        elif not enabled and self._dnd_cookie is not None:
            subprocess.run(["busctl", "--user", "call", "org.freedesktop.Notifications", "/org/freedesktop/Notifications",
                            "org.freedesktop.Notifications", "UnInhibit", "u", str(self._dnd_cookie)], capture_output=True)
            self._dnd_cookie = None
        self.push(type="dnd", enabled=self._dnd_cookie is not None)

    # ---------------------------------------------------------------- home
    def rpc_weather(self, force=False):
        return weather.forecast(config.get("weather_location", ""), config.get("weather_unit", "auto"), force)

    def rpc_recent(self):
        return apps.recent_files()

    # ---------------------------------------------------------------- apps
    def rpc_apps(self, force=False):
        return apps.list_apps(force)

    def rpc_app_launch(self, id):
        return apps.launch(id)

    def rpc_app_favorite(self, id):
        return apps.toggle_favorite(id)

    # ---------------------------------------------------------------- protocols
    def rpc_protocols(self):
        return {"protocols": protocols.load(), "steps": protocols.STEP_TYPES}

    def rpc_protocol_save(self, proto):
        return protocols.save(proto)

    def rpc_protocol_delete(self, id):
        return protocols.delete(id)

    def rpc_protocol_restore(self):
        return protocols.restore_defaults()

    def rpc_protocol_run(self, id):
        proto = next((p for p in protocols.load() if p["id"] == id), None) or protocols.find(id)
        if not proto:
            raise ValueError("Unknown protocol")
        self.push(type="protocol", phase="start", id=proto["id"], name=proto["name"])

        def ui(step):
            if step["step"] == "say":
                self.voice.speak(str(step["value"]), float(config.get("voice_rate", 1.0))) if config.get("voice", True) else None
            self.push(type="protocol-ui", **step)

        def dnd(on):
            self._dnd_request = on
            self._dnd_signal.emit(bool(on))
        res = protocols.run(proto, ui, dnd)
        self.push(type="protocol", phase="done", id=proto["id"], name=proto["name"], results=res)
        return res

    # ---------------------------------------------------------------- terminal
    @Slot(str, str)
    def ptyWrite(self, sid, text):
        self.pty.write(sid, text)

    @Slot(str, int, int)
    def ptyResize(self, sid, cols, rows):
        self.pty.resize(sid, cols, rows)

    def rpc_term_open(self, cols=100, rows=30, cwd=None, command=None, accent="0;225;255", skin="jarvis"):
        return self.pty.open(cols, rows, cwd, command, styled=config.get("terminal_prompt", True), accent=accent, skin=skin)

    def rpc_term_style(self, skin="jarvis", accent="0;225;255"):
        self.pty.set_style(skin, accent)
        return True

    def rpc_term_close(self, id):
        self.pty.close(id)
        return True

    def rpc_term_cwd(self, id):
        return self.pty.cwd(id)

    @Slot(str)
    def log(self, msg):
        print("[ui]", msg, flush=True)

    # -- general
    def rpc_info(self):
        return {"user": os.environ.get("USER", "user"), "home": os.path.expanduser("~"),
                "hostname": os.uname().nodename, "config": config.load(),
                "autostart": config.autostart_enabled(),
                "tts": self._tts_available(), "stt": self.voice.stt_available()}

    def rpc_set_config(self, key, value):
        changed = config.get(key) != value
        config.set_value(key, value)
        if key == "skin" and changed and config.get("voice", True):
            self.voice.speak(persona.intro(value) or "", float(config.get("voice_rate", 1.0)))
        if key == "autostart":
            config.set_autostart(bool(value))
        if key == "wake_word":
            self.voice.set_wake_word(bool(value))
        if key == "interval_ms":
            self.timer.setInterval(int(value))
        return config.load()

    def rpc_system_theme(self):
        """'light' or 'dark' from the KDE colour scheme (window background luminance)."""
        import configparser
        cp = configparser.RawConfigParser(strict=False)
        try:
            cp.read(os.path.expanduser("~/.config/kdeglobals"))
            r, g, b = (int(x) for x in cp["Colors:Window"]["BackgroundNormal"].split(",")[:3])
            return "light" if (0.299 * r + 0.587 * g + 0.114 * b) > 140 else "dark"
        except Exception:
            name = cp.get("General", "ColorScheme", fallback="") if cp.has_section("General") else ""
            return "dark" if "dark" in name.lower() else "light" if name else "dark"

    def rpc_screens(self):
        """Connected screens for the Display setting."""
        from PySide6.QtGui import QGuiApplication
        out = []
        for sc in QGuiApplication.screens():
            builtin = sc.name().lower().startswith(("edp", "lvds", "dsi"))
            label = "Built-in screen" if builtin else " ".join(x for x in (sc.manufacturer(), sc.model()) if x).strip() or "Monitor"
            g = sc.geometry()
            out.append({"name": sc.name(), "label": f"{label} ({sc.name()}, {g.width()}×{g.height()})", "builtin": builtin})
        return out

    def rpc_window(self, action):
        self.win.request(action)
        return True

    # -- files
    def rpc_places(self):
        return files.places()

    def rpc_list(self, path, hidden=False):
        return files.list_dir(path, hidden)

    def rpc_open(self, path):
        return files.open_path(path)

    def rpc_reveal(self, path):
        return files.reveal(path)

    def rpc_terminal(self, path):
        return files.terminal(path)

    def rpc_mkdir(self, parent, name):
        return files.mkdir(parent, name)

    def rpc_mkfile(self, parent, name):
        return files.mkfile(parent, name)

    def rpc_rename(self, path, name):
        return files.rename(path, name)

    def rpc_copy(self, paths, dest):
        return files.copy(paths, dest)

    def rpc_move(self, paths, dest):
        return files.move(paths, dest)

    def rpc_trash(self, paths):
        return files.trash(paths)

    def rpc_delete(self, paths):
        return files.delete_permanently(paths)

    def rpc_search(self, root, query, hidden=False):
        return files.search(root, query, hidden)

    def rpc_properties(self, path):
        return files.properties(path)

    def rpc_preview(self, path):
        return files.read_text_preview(path)

    # -- processes
    def rpc_procs(self, sort="cpu", query="", limit=80):
        return procs.top(sort, limit, query)

    def rpc_kill(self, pids, force=False):
        out = []
        for pid in pids:
            try:
                out.append({"pid": pid, "name": procs.kill(pid, force), "ok": True})
            except Exception as e:
                out.append({"pid": pid, "ok": False, "error": str(e)})
        return out

    # -- power
    def rpc_power_caps(self):
        return power.capabilities()

    def rpc_power(self, action):
        ok, msg = power.perform(action)
        if not ok:
            raise RuntimeError(msg)
        return msg

    # -- console
    def rpc_command(self, text):
        return commands.handle(text, self.latest)

    # ---------------------------------------------------------------- voice
    def _tts_available(self):
        return self.voice.tts_available()

    @Slot(str)
    def speak(self, text):
        if config.get("voice", True):
            self.voice.speak(text, float(config.get("voice_rate", 1.0)))

    @Slot()
    def listen(self):
        self.voice.listen()

    @Slot()
    def stopListening(self):
        self.voice.stop_listening()

    @Slot()
    def stopSpeaking(self):
        self.voice.stop_speaking()
