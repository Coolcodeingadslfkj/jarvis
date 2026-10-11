"""Power / session control via KDE (graceful) with systemd-logind fallbacks. No root needed."""

import os
import shutil
import subprocess

LOGIND = ["org.freedesktop.login1", "/org/freedesktop/login1", "org.freedesktop.login1.Manager"]

ACTIONS = {
    "lock":      {"label": "Lock",         "logind": None},
    "logout":    {"label": "Log Out",      "logind": None},
    "suspend":   {"label": "Sleep",        "logind": "CanSuspend"},
    "hibernate": {"label": "Hibernate",    "logind": "CanHibernate"},
    "hybrid":    {"label": "Hybrid Sleep", "logind": "CanHybridSleep"},
    "reboot":    {"label": "Restart",      "logind": "CanReboot"},
    "poweroff":  {"label": "Shut Down",    "logind": "CanPowerOff"},
}


def _run(cmd, timeout=10):
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    return r.returncode, (r.stdout + r.stderr).strip()


def _logind_can(method):
    if not shutil.which("busctl"):
        return "unknown"
    try:
        code, out = _run(["busctl", "call", *LOGIND, method], timeout=3)
        if code == 0 and '"' in out:
            return out.split('"')[1]
    except Exception:
        pass
    return "unknown"


def _hibernate_notes():
    notes = []
    try:
        with open("/sys/power/state") as f:
            if "disk" not in f.read():
                notes.append("Kernel does not support suspend-to-disk.")
    except OSError:
        pass
    try:
        import psutil
        ram, swap = psutil.virtual_memory().total, psutil.swap_memory().total
        if swap < ram * 0.6:
            notes.append(f"Swap ({swap / 2**30:.1f} GiB) is smaller than RAM ({ram / 2**30:.1f} GiB); "
                         "hibernation may fail when memory is busy.")
    except Exception:
        pass
    try:
        with open("/proc/cmdline") as f:
            cmdline = f.read()
        if "resume=" not in cmdline and not os.path.exists(
                "/sys/firmware/efi/efivars/HibernateLocation-8cf2644b-4b0b-428f-9387-6d876050dc67"):
            notes.append("No resume= kernel parameter; systemd will try to resume via EFI variable. "
                         "If your session does not come back after hibernating, add resume=UUID=<swap uuid> "
                         "to the kernel command line and the 'resume' hook to mkinitcpio.")
    except OSError:
        pass
    return notes


def capabilities():
    caps = {}
    for key, a in ACTIONS.items():
        can = _logind_can(a["logind"]) if a["logind"] else "yes"
        caps[key] = {"label": a["label"], "available": can in ("yes", "challenge", "unknown"), "can": can}
    caps["hibernate"]["notes"] = _hibernate_notes()
    return caps


def _kde(method):
    if shutil.which("busctl") and os.environ.get("XDG_CURRENT_DESKTOP", "").upper().find("KDE") >= 0:
        code, out = _run(["busctl", "--user", "call", "org.kde.Shutdown", "/Shutdown", "org.kde.Shutdown", method], timeout=5)
        return code == 0
    return False


def perform(action):
    """Execute a power action. Returns (ok, message)."""
    if action not in ACTIONS:
        return False, f"Unknown action {action}"
    if os.environ.get("JARVIS_DRY_POWER"):
        return True, f"[dry run] {ACTIONS[action]['label']} would run now"
    try:
        if action == "lock":
            code, out = _run(["loginctl", "lock-session"])
            if code != 0:
                code, out = _run(["busctl", "--user", "call", "org.freedesktop.ScreenSaver", "/ScreenSaver",
                                  "org.freedesktop.ScreenSaver", "Lock"])
        elif action == "logout":
            if _kde("logout"):
                return True, "Logging out"
            sid = os.environ.get("XDG_SESSION_ID", "")
            code, out = _run(["loginctl", "terminate-session", sid])
        elif action in ("reboot", "poweroff"):
            # KDE's logoutAndX saves the session and closes apps gracefully first.
            if _kde("logoutAndReboot" if action == "reboot" else "logoutAndShutdown"):
                return True, ACTIONS[action]["label"] + " initiated"
            code, out = _run(["systemctl", action])
        elif action == "hybrid":
            code, out = _run(["systemctl", "hybrid-sleep"], timeout=30)
        else:
            code, out = _run(["systemctl", action], timeout=30)
    except subprocess.TimeoutExpired:
        return True, ACTIONS[action]["label"] + " in progress"
    except Exception as e:
        return False, str(e)
    if code == 0:
        return True, ACTIONS[action]["label"] + " initiated"
    return False, out or f"{action} failed (exit {code})"
