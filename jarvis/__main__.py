"""J.A.R.V.I.S. entry point: window, web view, screen placement, tray, single instance."""

import argparse
import os
import signal
import sys

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB_DIR = os.path.join(APP_DIR, "web")
ICON = os.path.join(APP_DIR, "assets", "jarvis.svg")


def _gpu_drivers():
    """Kernel drivers of the machine's GPUs, e.g. {"i915", "nvidia"} or {"amdgpu"}."""
    import glob
    out = set()
    for d in glob.glob("/sys/class/drm/card[0-9]*/device/driver"):
        try:
            out.add(os.path.basename(os.readlink(d)))
        except OSError:
            pass
    return out


def _hybrid_igpu():
    """"intel" / "radeon" when an NVIDIA dGPU sits next to an integrated GPU (hybrid laptop), else None."""
    drv = _gpu_drivers()
    if "nvidia" not in drv:
        return None
    return "intel" if drv & {"i915", "xe"} else "radeon" if "amdgpu" in drv else None


def _prefer_igpu():
    """Hybrid laptops: render with the integrated GPU (Mesa EGL) so the HUD never wakes the NVIDIA dGPU."""
    mesa = "/usr/share/glvnd/egl_vendor.d/50_mesa.json"
    if _hybrid_igpu() and os.path.exists(mesa):
        os.environ.setdefault("__EGL_VENDOR_LIBRARY_FILENAMES", mesa)
        os.environ.setdefault("__GLX_VENDOR_LIBRARY_NAME", "mesa")


def _webengine_flags(software=False):
    """Pick a working Chromium GPU path.

    On hybrid NVIDIA laptops QtWebEngine composites through Vulkan, and when it picks NVIDIA's Vulkan driver
    its buffers can't be shared with the iGPU-rendered Qt window, so the page goes blank. There we pin Vulkan
    to the iGPU's Mesa driver (on Arch, install.sh can fetch Intel's into .vulkan/ without root), or fall back
    to CPU compositing. Other machines (one GPU) are left alone. `--software` / the "software_render" setting
    force CPU compositing if the screen stays blank.
    """
    import glob
    from . import config
    flags = os.environ.get("QTWEBENGINE_CHROMIUM_FLAGS", "")
    igpu = _hybrid_igpu()
    if software or config.get("software_render", False):
        flags += " --disable-gpu-compositing"
    elif igpu and "VK_ICD_FILENAMES" not in os.environ:
        candidates = sorted(glob.glob(f"/usr/share/vulkan/icd.d/{igpu}_icd*.json")) + \
            [os.path.join(APP_DIR, ".vulkan", "intel_icd.json")]
        icd = next((c for c in candidates if os.path.exists(c) and "hasvk" not in c), None)
        if icd:
            # only the iGPU driver: also keeps Chromium from waking the NVIDIA dGPU
            os.environ["VK_ICD_FILENAMES"] = icd
        else:
            flags += " --disable-gpu-compositing"
    os.environ["QTWEBENGINE_CHROMIUM_FLAGS"] = flags.strip()


def parse_args():
    p = argparse.ArgumentParser(prog="jarvis")
    p.add_argument("--autostart", action="store_true", help="launched at login: wait for the built-in screen")
    p.add_argument("--screen", help="output name (prefix) to show on, e.g. eDP-1 or HDMI-A-1 (default: setting, else auto)")
    p.add_argument("--windowed", action="store_true", help="don't go fullscreen")
    p.add_argument("--screenshot", metavar="DIR", help="dev: capture every menu to PNGs and exit")
    p.add_argument("--view", choices=["home", "systems", "files", "terminal", "apps", "processes", "control", "protocols", "power", "console"],
                   help="menu to open on start")
    p.add_argument("--listen", action="store_true", help="start listening for a voice command (Meta+J)")
    p.add_argument("--say", metavar="TEXT", help='send a command, e.g. --say "status"')
    p.add_argument("--software", action="store_true", help="CPU compositing (if the screen stays blank)")
    p.add_argument("--no-gpu-pin", action="store_true", help="don't force iGPU rendering")
    return p.parse_args()


def main():
    args = parse_args()
    if not args.no_gpu_pin:
        _prefer_igpu()
    _webengine_flags(args.software)

    from PySide6.QtCore import QTimer, QUrl, Qt
    from PySide6.QtGui import QAction, QColor, QSurfaceFormat, QDesktopServices, QGuiApplication, QIcon, QKeySequence, QShortcut
    from PySide6.QtNetwork import QLocalServer, QLocalSocket
    from PySide6.QtWebChannel import QWebChannel
    from PySide6.QtWebEngineCore import QWebEnginePage, QWebEngineProfile, QWebEngineSettings
    from PySide6.QtWebEngineWidgets import QWebEngineView
    from PySide6.QtWidgets import QApplication, QMainWindow, QMenu, QSystemTrayIcon

    from . import config, kwin
    from .bridge import Bridge

    # Opaque window surface: with an alpha channel KWin blends the desktop wallpaper through
    # the GPU-composited web content, washing the HUD out to grey.
    fmt = QSurfaceFormat.defaultFormat()
    fmt.setAlphaBufferSize(0)
    QSurfaceFormat.setDefaultFormat(fmt)
    QGuiApplication.setDesktopFileName("jarvis")
    app = QApplication(sys.argv)
    app.setApplicationName("jarvis")
    app.setApplicationDisplayName("J.A.R.V.I.S.")
    app.setWindowIcon(QIcon(ICON))
    app.setQuitOnLastWindowClosed(False)
    signal.signal(signal.SIGINT, lambda *_: app.quit())
    sigtimer = QTimer()  # lets Python handle Ctrl+C
    sigtimer.start(300)
    sigtimer.timeout.connect(lambda: None)

    # ---- single instance ---------------------------------------------------
    sock_name = f"jarvis-{os.getuid()}"
    if not args.screenshot:
        probe = QLocalSocket()
        probe.connectToServer(sock_name)
        if probe.waitForConnected(300):
            msg = "listen" if args.listen else ("cmd:" + args.say) if args.say else "show"
            probe.write(msg.encode())
            probe.flush()
            probe.waitForBytesWritten(300)
            print("J.A.R.V.I.S. is already running - message delivered.")
            return 0
        QLocalServer.removeServer(sock_name)
    server = QLocalServer()

    # A named, on-disk profile: Qt 6's default profile is off-the-record, so localStorage (game high
    # scores, Celestia's chips, Hina's donuts) was wiped at every restart.
    profile = QWebEngineProfile("jarvis", app)
    profile.setPersistentStoragePath(os.path.join(
        os.environ.get("XDG_DATA_HOME", os.path.expanduser("~/.local/share")), "jarvis", "webengine"))

    class Page(QWebEnginePage):
        def javaScriptConsoleMessage(self, level, message, line, source):
            tag = ["info", "warn", "ERROR"][min(int(level.value) if hasattr(level, "value") else int(level), 2)]
            print(f"[js {tag}] {message} ({os.path.basename(source)}:{line})", flush=True)

        def acceptNavigationRequest(self, url, nav_type, is_main):
            if url.scheme() in ("http", "https"):
                QDesktopServices.openUrl(url)
                return False
            return super().acceptNavigationRequest(url, nav_type, is_main)

    class Window(QMainWindow):
        def __init__(self):
            super().__init__()
            self.setWindowTitle("J.A.R.V.I.S.")
            self.setWindowIcon(QIcon(ICON))
            self.setWindowFlag(Qt.FramelessWindowHint, True)
            self.setStyleSheet("background:#02070b;")
            self.setAttribute(Qt.WA_TranslucentBackground, False)
            self.resize(1280, 800)
            self.quitting = False
            self.want_fullscreen = config.get("fullscreen", True) and not args.windowed
            self.view = QWebEngineView(self)
            self.page = Page(profile, self.view)
            self.page.setBackgroundColor(QColor("#02070b"))
            s = self.page.settings()
            s.setAttribute(QWebEngineSettings.LocalContentCanAccessFileUrls, True)
            s.setAttribute(QWebEngineSettings.LocalContentCanAccessRemoteUrls, False)
            s.setAttribute(QWebEngineSettings.ShowScrollBars, False)
            self.view.setPage(self.page)
            self.view.setContextMenuPolicy(Qt.NoContextMenu)
            self.setCentralWidget(self.view)
            self.bridge = Bridge(self)
            self.channel = QWebChannel(self.page)
            self.channel.registerObject("bridge", self.bridge)
            self.page.setWebChannel(self.channel)
            url = QUrl.fromLocalFile(os.path.join(WEB_DIR, "index.html"))
            if args.view:
                url.setFragment(args.view)
            self.view.load(url)
            for seq, act in (("F11", "fullscreen"), ("Ctrl+Q", "quit")):
                QShortcut(QKeySequence(seq), self, activated=lambda a=act: self.request(a))

        # -- screen placement ---------------------------------------------------
        def target_screen(self):
            """The screen to show on: the configured output if it's connected, else the built-in panel
            (laptops), else the primary monitor. Never a second screen unless the user picked it."""
            want = (args.screen or config.get("screen") or "auto").lower()
            screens = QGuiApplication.screens()
            if want != "auto":
                for sc in screens:
                    if sc.name().lower() == want:
                        return sc
                for sc in screens:
                    if sc.name().lower().startswith(want):
                        return sc
            for sc in screens:  # any built-in panel
                if sc.name().lower().startswith(("edp", "lvds", "dsi")):
                    return sc
            return QGuiApplication.primaryScreen()

        def place(self):
            sc = self.target_screen()
            if sc is None:
                return
            if self.windowHandle() is None:
                self.winId()  # create native window so we can pick its screen
            on_target = self.windowHandle().screen() is sc
            if self.isVisible() and on_target and (self.isFullScreen() == self.want_fullscreen):
                return
            if self.isFullScreen():
                self.showNormal()
            self.windowHandle().setScreen(sc)
            self.setGeometry(sc.availableGeometry())
            if self.want_fullscreen:
                self.showFullScreen()
            else:
                self.showMaximized()
            self.raise_()
            self.activateWindow()
            self.kwin_place(sc)
            print(f"[jarvis] showing on {sc.name()} ({sc.geometry().width()}x{sc.geometry().height()})", flush=True)

        def kwin_place(self, sc=None):
            # Wayland: KWin decides where normal windows go, so ask it to move us to the target.
            sc = sc or self.target_screen()
            if sc is not None and not args.screenshot:
                QTimer.singleShot(350, lambda: kwin.move_to_output(sc.name(), maximize=not self.isFullScreen()))

        def bring_up(self):
            self.bridge.set_paused(False)
            self.place()
            self.show()
            self.raise_()
            self.activateWindow()

        # -- window actions from UI / tray ---------------------------------------
        def request(self, action):
            if action == "minimize":
                self.showMinimized()
            elif action == "fullscreen":
                self.want_fullscreen = not self.isFullScreen()
                config.set_value("fullscreen", self.want_fullscreen)
                if self.want_fullscreen:
                    self.showFullScreen()
                else:
                    self.showNormal()
                    self.showMaximized()
                    self.kwin_place()
            elif action == "hide":
                self.hide()
                self.bridge.set_paused(True)
            elif action == "show":
                self.bring_up()
            elif action == "replace":
                self.place()
            elif action == "quit":
                self.quitting = True
                app.quit()

        def closeEvent(self, ev):
            if not self.quitting and QSystemTrayIcon.isSystemTrayAvailable() and not args.screenshot:
                ev.ignore()
                self.request("hide")
            else:
                ev.accept()
                app.quit()

    win = Window()

    def handle_message(msg):
        win.bring_up()
        if msg == "listen":
            QTimer.singleShot(300, lambda: win.page.runJavaScript("JARVIS.voice && JARVIS.voice.listen()"))
        elif msg.startswith("cmd:"):
            import json as _json
            js = f"JARVIS.show('console'); JARVIS.console.run({_json.dumps(msg[4:])})"
            QTimer.singleShot(300, lambda: win.page.runJavaScript(js))

    def on_message():
        c = server.nextPendingConnection()
        if c:
            c.waitForReadyRead(300)
            handle_message(bytes(c.readAll()).decode(errors="replace").strip() or "show")
    if not args.screenshot:
        server.newConnection.connect(on_message)
        server.listen(sock_name)

    # ---- tray ------------------------------------------------------------------
    tray = None
    if QSystemTrayIcon.isSystemTrayAvailable() and not args.screenshot:
        tray = QSystemTrayIcon(QIcon(ICON), app)
        tray.setToolTip("J.A.R.V.I.S.")
        menu = QMenu()
        for label, act in (("Show J.A.R.V.I.S.", "show"), ("Move to my screen", "replace"),
                           ("Toggle fullscreen", "fullscreen"), (None, None), ("Quit", "quit")):
            if label is None:
                menu.addSeparator()
                continue
            a = QAction(label, menu)
            a.triggered.connect(lambda _=False, x=act: win.request(x))
            menu.addAction(a)
        tray.setContextMenu(menu)
        def on_tray(reason):
            if reason == QSystemTrayIcon.Trigger:
                win.request("hide" if win.isVisible() else "show")
        tray.activated.connect(on_tray)
        tray.show()
        app._tray_menu = menu

    # Global shortcuts: Meta+J talk, Meta+Shift+J show/hide
    if not args.screenshot and config.get("hotkeys", True):
        from .hotkeys import Hotkeys
        hk = Hotkeys(app)

        def on_hotkey(action):
            if action == "listen":
                handle_message("listen")
            elif action == "toggle":
                win.request("hide" if win.isVisible() and win.isActiveWindow() else "show")
        hk.pressed.connect(on_hotkey)
        QTimer.singleShot(2000, hk.register)
        app._hotkeys = hk

    # Follow the built-in screen when monitors are plugged/unplugged or the lid opens.
    def screens_changed(*_):
        QTimer.singleShot(1500, lambda: win.isVisible() and win.place())
    app.screenAdded.connect(screens_changed)
    app.screenRemoved.connect(screens_changed)

    # ---- show --------------------------------------------------------------------
    if args.screenshot:
        win.want_fullscreen = False
        win.resize(1920, 1200)
        win.show()
        from .screenshot import run_capture
        run_capture(win, args.screenshot, app)
    elif args.autostart:
        # At login the panel may not be enumerated yet; wait up to ~12 s for it (~3 s on a desktop).
        tries = {"n": 0}

        def wait_for_screen():
            tries["n"] += 1
            name = win.target_screen().name().lower()
            want = (args.screen or config.get("screen") or "auto").lower()
            ready = name.startswith(("edp", "lvds", "dsi")) if want == "auto" else name.startswith(want)
            if ready or tries["n"] > (6 if want == "auto" else 24):
                win.bring_up()
            else:
                QTimer.singleShot(500, wait_for_screen)
        QTimer.singleShot(800, wait_for_screen)
    else:
        win.bring_up()
    if args.listen or args.say:
        QTimer.singleShot(7000, lambda: handle_message("listen" if args.listen else "cmd:" + args.say))

    code = app.exec()
    win.bridge.pty.close_all()
    win.bridge.music.shutdown()
    win.bridge.pool.shutdown(wait=False, cancel_futures=True)
    server.close()
    return code


if __name__ == "__main__":
    sys.exit(main())
