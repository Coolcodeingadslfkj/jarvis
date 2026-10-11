"""The Linux distribution's package manager: update checks and the shell commands the UI offers.

Supports Arch (pacman), Debian / Ubuntu / Kubuntu (apt), Fedora (dnf) and openSUSE (zypper).
"""

import re
import shutil
import subprocess
import time


def _os_release():
    info = {}
    try:
        with open("/etc/os-release") as f:
            for line in f:
                k, _, v = line.strip().partition("=")
                info[k] = v.strip('"')
    except OSError:
        pass
    return info


OS = _os_release()
NAME = OS.get("NAME") or "Linux"

if shutil.which("pacman"):
    PM = "pacman"
elif shutil.which("apt-get"):
    PM = "apt"
elif shutil.which("dnf"):
    PM = "dnf"
elif shutil.which("zypper"):
    PM = "zypper"
else:
    PM = None

# shell commands shown in the terminal / run by protocols; "" = not available on this system
COMMANDS = {
    "pacman": {
        "upgrade": "sudo pacman -Syu",
        "pending": "checkupdates || echo 'System is up to date.'",
        "clean": "if command -v paccache >/dev/null; then sudo paccache -rk2; else echo 'Install pacman-contrib for paccache'; fi",
        "orphans": "pacman -Qdtq || echo 'No orphans.'",
        "largest": "expac -H M '%m\\t%n' 2>/dev/null | sort -h | tail -20 || pacman -Qi | awk '/^Name/{n=$3}/^Installed Size/{print $4$5, n}' | sort -h | tail -20",
    },
    "apt": {
        "upgrade": "sudo apt update && sudo apt full-upgrade",
        "pending": "apt list --upgradable 2>/dev/null | tail -n +2 | grep . || echo 'System is up to date.'",
        "clean": "sudo apt autoremove && sudo apt clean",
        "orphans": "apt-get -s autoremove | grep '^Remv' || echo 'No orphans.'",
        "largest": "dpkg-query -Wf '${Installed-Size}\\t${Package}\\n' | sort -n | tail -20",
    },
    "dnf": {
        "upgrade": "sudo dnf upgrade",
        "pending": "dnf check-update -q || true",
        "clean": "sudo dnf autoremove && sudo dnf clean packages",
        "orphans": "dnf repoquery --unneeded -q 2>/dev/null || echo 'No orphans.'",
        "largest": "rpm -qa --qf '%{SIZE}\\t%{NAME}\\n' | sort -n | tail -20",
    },
    "zypper": {
        "upgrade": "sudo zypper dup",
        "pending": "zypper -q list-updates || true",
        "clean": "sudo zypper clean",
        "orphans": "zypper -q packages --unneeded || echo 'No orphans.'",
        "largest": "rpm -qa --qf '%{SIZE}\\t%{NAME}\\n' | sort -n | tail -20",
    },
}.get(PM, {"upgrade": "", "pending": "", "clean": "", "orphans": "", "largest": ""})


def info():
    """What the UI needs to label and run package commands."""
    return {"name": NAME, "pm": PM, "commands": COMMANDS}


def updates():
    """Pending package updates: {"available", "count", "packages": [{name, from, to}], "upgrade_cmd"}."""
    base = {"available": False, "upgrade_cmd": COMMANDS["upgrade"], "distro": NAME}
    pkgs, err = [], ""
    try:
        if PM == "pacman":
            if not shutil.which("checkupdates"):
                return dict(base, hint="Install pacman-contrib for update checks.")
            # checkupdates is safe: it syncs a temporary copy of the database
            r = subprocess.run(["checkupdates"], capture_output=True, text=True, timeout=120)
            for line in r.stdout.splitlines():
                m = re.match(r"(\S+) (\S+) -> (\S+)", line)
                if m:
                    pkgs.append({"name": m.group(1), "from": m.group(2), "to": m.group(3)})
            err = r.stderr.strip() if r.returncode not in (0, 2) else ""
        elif PM == "apt":
            # uses the package lists from the last `apt update` (Ubuntu refreshes them daily)
            r = subprocess.run(["apt", "list", "--upgradable"], capture_output=True, text=True, timeout=60,
                               env={"LANG": "C", "PATH": "/usr/bin:/bin"})
            for line in r.stdout.splitlines():
                m = re.match(r"([^/\s]+)/\S+ (\S+) \S+ \[upgradable from: ([^\]]+)\]", line)
                if m:
                    pkgs.append({"name": m.group(1), "from": m.group(3), "to": m.group(2)})
        elif PM == "dnf":
            r = subprocess.run(["dnf", "check-update", "-q"], capture_output=True, text=True, timeout=120)
            for line in r.stdout.splitlines():
                m = re.match(r"(\S+)\.\S+\s+(\S+)\s+\S+$", line)
                if m:
                    pkgs.append({"name": m.group(1), "from": "", "to": m.group(2)})
            err = r.stderr.strip() if r.returncode not in (0, 100) else ""
        elif PM == "zypper":
            r = subprocess.run(["zypper", "-q", "list-updates"], capture_output=True, text=True, timeout=120)
            for line in r.stdout.splitlines():
                cols = [c.strip() for c in line.split("|")]
                if len(cols) >= 6 and cols[0] == "v":
                    pkgs.append({"name": cols[2], "from": cols[3], "to": cols[4]})
        else:
            return dict(base, hint="Update checks aren't supported on this distribution.")
    except (OSError, subprocess.SubprocessError) as e:
        return dict(base, available=True, count=0, packages=[], checked=time.time(), error=str(e))
    return dict(base, available=True, count=len(pkgs), packages=pkgs, checked=time.time(), error=err)
