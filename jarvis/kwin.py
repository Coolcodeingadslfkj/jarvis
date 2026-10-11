"""Window placement through KWin scripting.

On Wayland a normal (non-fullscreen) window can't choose its own output; KWin places it where
the cursor is. We therefore ask KWin itself to move our window to the target output.
"""

import os
import shutil
import subprocess
import tempfile

SCRIPT = """
(function () {
  // Plasma 6 API; Plasma 5 (no workspace.screens / windowList) can only maximize.
  var target = null, outs = workspace.screens || [];
  for (var i = 0; i < outs.length; i++) if (outs[i].name.indexOf("%(screen)s") === 0) target = outs[i];
  var ws = workspace.windowList ? workspace.windowList() : workspace.clientList();
  for (var j = 0; j < ws.length; j++) {
    var w = ws[j];
    if (String(w.resourceClass) !== "jarvis" || !w.normalWindow) continue;
    if (target && w.output !== target) workspace.sendClientToScreen(w, target);
    if (%(maximize)s && !w.fullScreen) w.setMaximize(true, true);
  }
})();
"""


def _call(path, iface, method, sig="", *args):
    """A KWin D-Bus call through busctl (part of systemd, so it exists on every KDE distro, unlike qdbus6)."""
    cmd = ["busctl", "--user", "call", "org.kde.KWin", path, iface, method] + ([sig, *args] if sig else [])
    return subprocess.run(cmd, capture_output=True, text=True, timeout=5)


def move_to_output(screen_name, maximize=True):
    """Ask KWin to move J.A.R.V.I.S.'s window to the output whose name starts with screen_name."""
    if not shutil.which("busctl") or "KDE" not in os.environ.get("XDG_CURRENT_DESKTOP", "").upper():
        return False
    safe = "".join(c for c in screen_name if c.isalnum() or c in "-_")
    fd, path = tempfile.mkstemp(prefix="jarvis-kwin-", suffix=".js")
    try:
        with os.fdopen(fd, "w") as f:
            f.write(SCRIPT % {"screen": safe, "maximize": "true" if maximize else "false"})
        name = "jarvis_place"
        _call("/Scripting", "org.kde.kwin.Scripting", "unloadScript", "s", name)
        r = _call("/Scripting", "org.kde.kwin.Scripting", "loadScript", "ss", path, name)
        sid = r.stdout.strip().split()[-1] if r.stdout.strip() else ""  # "i 3"
        if not sid.lstrip("-").isdigit() or int(sid) < 0:
            return False
        ok = _call(f"/Scripting/Script{sid}", "org.kde.kwin.Script", "run").returncode == 0 or \
            _call(f"/{sid}", "org.kde.kwin.Script", "run").returncode == 0  # older Plasma 5 path
        _call("/Scripting", "org.kde.kwin.Scripting", "unloadScript", "s", name)
        return ok
    except Exception:
        return False
    finally:
        os.unlink(path)
