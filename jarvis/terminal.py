"""Pseudo-terminal sessions for the TERMINAL menu (rendered by xterm.js in the HUD)."""

import codecs
import errno
import fcntl
import os
import pty
import pwd
import signal
import struct
import subprocess
import termios

from PySide6.QtCore import QObject, QSocketNotifier, Signal

MAX_READ = 256 * 1024
RCFILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shell", "jarvisrc.bash")
# Current theme for the shells (one line: "<skin> <r;g;b accent>"). jarvisrc.bash re-reads it before
# every prompt, so open tabs follow theme changes. Per app instance, in the session's runtime dir.
STYLE_FILE = os.path.join(os.environ.get("XDG_RUNTIME_DIR") or "/tmp", f"jarvis-term-style-{os.getpid()}")
# Bound in jarvisrc.bash: stash the typed line, then run an empty one so the shell restarts in the new theme.
RESTYLE_KEYS = "\x1b[9998~"
SKINS = ("jarvis", "celestia", "doom", "asahina")


def default_shell():
    return os.environ.get("SHELL") or pwd.getpwuid(os.getuid()).pw_shell or "/bin/bash"


class Session:
    def __init__(self, sid, pid, fd, notifier, styled=False):
        self.id, self.pid, self.fd, self.notifier = sid, pid, fd, notifier
        self.styled = styled   # running jarvisrc.bash (has the restyle key binding)
        self.decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")


class PtyManager(QObject):
    data = Signal(str, str)      # session id, output text
    exited = Signal(str, int)    # session id, exit status

    def __init__(self, parent=None):
        super().__init__(parent)
        self.sessions = {}
        self._procs = {}
        self._seq = 0
        self._skin = None

    def open(self, cols=100, rows=30, cwd=None, command=None, styled=True, accent="0;225;255", skin="jarvis"):
        cwd = os.path.expanduser(cwd or "~")
        if not os.path.isdir(cwd):
            cwd = os.path.expanduser("~")
        shell = default_shell()
        env = dict(os.environ)
        # Don't leak the HUD's rendering workarounds into user programs.
        for k in ("VK_ICD_FILENAMES", "__EGL_VENDOR_LIBRARY_FILENAMES", "__GLX_VENDOR_LIBRARY_NAME",
                  "QTWEBENGINE_CHROMIUM_FLAGS", "JARVIS_DRY_POWER"):
            env.pop(k, None)
        env.update({"TERM": "xterm-256color", "COLORTERM": "truecolor", "JARVIS_TERMINAL": "1",
                    "TERM_PROGRAM": "jarvis"})
        env["JARVIS_ACCENT"] = accent
        env["JARVIS_SKIN"] = skin if skin in SKINS else "jarvis"
        env["JARVIS_STYLE_FILE"] = STYLE_FILE
        self.set_style(skin, accent, restyle=False)
        styled = styled and os.path.basename(shell) == "bash" and os.path.exists(RCFILE)
        if styled:
            interactive = [shell, "--rcfile", RCFILE, "-i"]
        else:
            interactive = [shell, "-l"]
        if command:
            # run the command, then stay in an interactive shell
            env["JARVIS_NO_BANNER"] = "1"
            argv = [shell, "-c", f"{command}; echo; exec {' '.join(interactive)}"]
        else:
            argv = interactive
        # Spawn without forking Python itself (fork in a threaded process can deadlock):
        # util-linux `setsid --ctty` makes the pty the child's controlling terminal.
        fd, slave = pty.openpty()
        try:
            proc = subprocess.Popen(["setsid", "--ctty", *argv], stdin=slave, stdout=slave, stderr=slave,
                                    cwd=cwd, env=env, close_fds=True)
        finally:
            os.close(slave)
        pid = proc.pid
        self._procs[pid] = proc
        flags = fcntl.fcntl(fd, fcntl.F_GETFL)
        fcntl.fcntl(fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)
        self._seq += 1
        sid = f"t{self._seq}"
        notifier = QSocketNotifier(fd, QSocketNotifier.Read, self)
        sess = Session(sid, pid, fd, notifier, styled)
        notifier.activated.connect(lambda *_: self._read(sess))
        self.sessions[sid] = sess
        self.resize(sid, cols, rows)
        return {"id": sid, "pid": pid, "shell": os.path.basename(shell), "cwd": cwd}

    def set_style(self, skin, accent, restyle=True):
        """Record the HUD theme for the shells; idle ones redraw their banner and prompt right away."""
        skin = skin if skin in SKINS else "jarvis"
        try:
            with open(STYLE_FILE + ".tmp", "w") as f:
                f.write(f"{skin} {accent}\n")
            os.replace(STYLE_FILE + ".tmp", STYLE_FILE)
        except OSError:
            return
        changed, self._skin = self._skin is not None and skin != self._skin, skin
        if restyle and changed:
            for sess in list(self.sessions.values()):
                if sess.styled and self._idle(sess):
                    self.write(sess.id, RESTYLE_KEYS)
        # busy shells (an editor, an update...) pick the theme up at their next prompt

    def _idle(self, sess):
        """True when the shell itself is waiting at its prompt: foreground on the pty, no children."""
        try:
            if os.tcgetpgrp(sess.fd) != sess.pid:
                return False
            with open(f"/proc/{sess.pid}/task/{sess.pid}/children") as f:
                return not f.read().strip()
        except OSError:
            return False

    def _read(self, sess):
        chunks, total = [], 0
        while total < MAX_READ:
            try:
                b = os.read(sess.fd, 65536)
            except BlockingIOError:
                break
            except OSError as e:
                if e.errno == errno.EIO:  # child closed the pty
                    b = b""
                else:
                    raise
            if not b:
                if chunks:
                    self.data.emit(sess.id, "".join(chunks))
                self._finish(sess)
                return
            chunks.append(sess.decoder.decode(b))
            total += len(b)
        if chunks:
            self.data.emit(sess.id, "".join(chunks))

    def _finish(self, sess):
        if sess.id not in self.sessions:
            return
        sess.notifier.setEnabled(False)
        del self.sessions[sess.id]
        try:
            os.close(sess.fd)
        except OSError:
            pass
        status = 0
        proc = self._procs.pop(sess.pid, None)
        if proc is not None:
            try:
                status = proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                proc.kill()
                status = proc.wait()
        self.exited.emit(sess.id, status)

    def write(self, sid, text):
        sess = self.sessions.get(sid)
        if not sess:
            return
        data = text.encode("utf-8")
        while data:
            try:
                n = os.write(sess.fd, data)
                data = data[n:]
            except BlockingIOError:
                import select
                select.select([], [sess.fd], [], 1.0)
            except OSError:
                return

    def resize(self, sid, cols, rows):
        sess = self.sessions.get(sid)
        if sess and cols > 0 and rows > 0:
            fcntl.ioctl(sess.fd, termios.TIOCSWINSZ, struct.pack("HHHH", int(rows), int(cols), 0, 0))

    def close(self, sid):
        sess = self.sessions.get(sid)
        if not sess:
            return
        try:
            os.killpg(os.getpgid(sess.pid), signal.SIGHUP)
        except (ProcessLookupError, PermissionError):
            pass
        self._finish(sess)

    def cwd(self, sid):
        """Working directory of the session's foreground process (for 'open here' actions)."""
        sess = self.sessions.get(sid)
        if not sess:
            return None
        try:
            pgid = os.tcgetpgrp(sess.fd)
            return os.readlink(f"/proc/{pgid}/cwd")
        except OSError:
            try:
                return os.readlink(f"/proc/{sess.pid}/cwd")
            except OSError:
                return None

    def close_all(self):
        for sid in list(self.sessions):
            self.close(sid)
        try:
            os.remove(STYLE_FILE)
        except OSError:
            pass
