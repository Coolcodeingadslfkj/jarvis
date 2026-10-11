"""Process listing and termination."""

import os
import signal

import psutil

_cache = {}
OWN_PID = os.getpid()


def top(sort="cpu", limit=60, query=""):
    ncpu = psutil.cpu_count() or 1
    rows = []
    seen = set()
    q = (query or "").lower()
    for p in psutil.process_iter(["pid", "name", "username", "memory_info", "status", "cmdline", "create_time"]):
        try:
            info = p.info
            pid = info["pid"]
            seen.add(pid)
            proc = _cache.get(pid)
            if proc is None or proc.info.get("create_time") != info.get("create_time"):
                _cache[pid] = p
                p.cpu_percent(None)
                cpu = 0.0
            else:
                cpu = proc.cpu_percent(None)
            name = info["name"] or "?"
            cmd = " ".join(info["cmdline"] or [])[:200]
            if q and q not in name.lower() and q not in cmd.lower() and q != str(pid):
                continue
            rows.append({"pid": pid, "name": name, "user": info["username"] or "",
                         "cpu": round(cpu / ncpu, 1),
                         "mem": info["memory_info"].rss if info["memory_info"] else 0,
                         "status": info["status"], "cmd": cmd, "self": pid == OWN_PID})
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            continue
    for pid in list(_cache):
        if pid not in seen:
            del _cache[pid]
    key = {"cpu": lambda r: r["cpu"], "mem": lambda r: r["mem"], "name": lambda r: r["name"].lower(),
           "pid": lambda r: r["pid"]}.get(sort, lambda r: r["cpu"])
    rows.sort(key=key, reverse=sort in ("cpu", "mem"))
    return {"total": len(seen), "items": rows[:limit]}


def kill(pid, force=False):
    pid = int(pid)
    if pid in (0, 1, OWN_PID):
        raise ValueError("Refusing to kill that process")
    p = psutil.Process(pid)
    name = p.name()
    p.send_signal(signal.SIGKILL if force else signal.SIGTERM)
    return name


def find_by_name(name):
    name = name.lower()
    return [p for p in psutil.process_iter(["pid", "name", "username"])
            if p.info["name"] and name in p.info["name"].lower()
            and p.info["username"] == psutil.Process().username() and p.pid != OWN_PID]
