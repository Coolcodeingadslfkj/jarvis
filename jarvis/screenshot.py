"""Dev helper: walk through every menu and save PNG captures (used for visual checks)."""

import os

from PySide6.QtCore import QTimer

VIEWS = ["home", "systems", "files", "terminal", "apps", "processes", "control", "protocols", "power", "console"]


def run_capture(win, out_dir, app):
    os.environ["JARVIS_DRY_POWER"] = "1"  # never power off while capturing
    os.environ["JARVIS_MUTE"] = "1"       # and never talk through the speakers
    os.makedirs(out_dir, exist_ok=True)
    steps = [("boot", None, 1500)]
    for v in VIEWS:
        steps.append((v, f"JARVIS.show('{v}')", 3500))
    steps.append(("console-cmd", "JARVIS.show('console'); JARVIS.console.run('status')", 4000))
    steps.append(("power-modal", "JARVIS.show('power'); JARVIS.power.ask('reboot')", 1500))
    idx = {"i": 0}

    def next_step():
        if idx["i"] >= len(steps):
            app.quit()
            return
        name, js, delay = steps[idx["i"]]
        idx["i"] += 1
        if js:
            win.page.runJavaScript(js)

        def grab():
            path = os.path.join(out_dir, f"{idx['i']:02d}-{name}.png")
            win.view.grab().save(path)
            print("[shot]", path, flush=True)
            next_step()
        QTimer.singleShot(delay, grab)

    # give the boot sequence time to finish before capturing menus
    QTimer.singleShot(4500, next_step)
