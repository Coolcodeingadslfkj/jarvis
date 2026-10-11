"""KDE global shortcuts owned by J.A.R.V.I.S. (kglobalaccel over D-Bus).

Meta+J        talk to J.A.R.V.I.S. (push-to-talk)
Meta+Shift+J  show / hide the HUD
Users can rebind them in System Settings > Shortcuts > J.A.R.V.I.S.
"""

import subprocess

from PySide6.QtCore import QObject, Signal, Slot
from PySide6.QtDBus import QDBusConnection

META, SHIFT = 0x10000000, 0x02000000
KEY_J = 0x4A
ACTIONS = {
    "listen": ("Talk to J.A.R.V.I.S.", META | KEY_J),
    "toggle": ("Show / hide J.A.R.V.I.S.", META | SHIFT | KEY_J),
}


def _accel(*args):
    return subprocess.run(["busctl", "--user", "call", "org.kde.kglobalaccel", "/kglobalaccel",
                           "org.kde.KGlobalAccel", *args], capture_output=True, text=True, timeout=5)


class Hotkeys(QObject):
    pressed = Signal(str)

    def register(self):
        ok = True
        for action, (label, key) in ACTIONS.items():
            ident = ["4", "jarvis", action, "J.A.R.V.I.S.", label]
            try:
                _accel("doRegister", "as", *ident)
                # flag 2 = SetPresent: keeps a user-chosen binding, otherwise uses our default key
                r = _accel("setShortcut", "asaiu", *ident, "1", str(key), "2")
                ok = ok and r.returncode == 0
            except Exception:
                ok = False
        QDBusConnection.sessionBus().connect("org.kde.kglobalaccel", "/component/jarvis", "org.kde.kglobalaccel.Component",
                                             "globalShortcutPressed", self, "2_on_pressed(QString,QString,qlonglong)")
        return ok

    @Slot(str, str, "qlonglong")
    def _on_pressed(self, component, action, _ts):
        if component == "jarvis":
            self.pressed.emit(action)
