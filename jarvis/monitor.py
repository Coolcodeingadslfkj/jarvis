"""Hardware telemetry: CPU, RAM, disks, network, battery, temperatures and fans."""

import glob
import os
import re
import time
from collections import deque

import psutil

from . import gpu

HISTORY = 90  # samples (seconds) kept for sparklines


def _read(path, default=None):
    try:
        with open(path) as f:
            return f.read().strip()
    except OSError:
        return default


def _read_int(path, default=None):
    v = _read(path)
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


class HwmonReader:
    """Reads /sys/class/hwmon directly (faster and more complete than psutil)."""

    def __init__(self):
        self.chips = []
        for d in sorted(glob.glob("/sys/class/hwmon/hwmon*")):
            name = _read(os.path.join(d, "name"), "?")
            temps, fans = [], []
            for f in sorted(glob.glob(os.path.join(d, "temp*_input"))):
                idx = os.path.basename(f)[4:-6]
                label = _read(os.path.join(d, f"temp{idx}_label")) or f"temp{idx}"
                temps.append((label, f))
            for f in sorted(glob.glob(os.path.join(d, "fan*_input"))):
                idx = os.path.basename(f)[3:-6]
                label = _read(os.path.join(d, f"fan{idx}_label")) or f"Fan {idx}"
                fans.append((label, f))
            self.chips.append({"name": name, "temps": temps, "fans": fans})

    SLOW_MS = 4        # chips slower than this to read (EC / SMM / WMI backed) ...
    SLOW_EVERY = 5.0   # ... are refreshed only every few seconds

    def read(self):
        out = []
        now = time.monotonic()
        for chip in self.chips:
            if chip.get("cache") is not None and now - chip["at"] < self.SLOW_EVERY:
                out.append(chip["cache"])
                continue
            t0 = time.perf_counter()
            temps = []
            for label, f in chip["temps"]:
                v = _read_int(f)
                if v is not None and -40000 < v < 150000:
                    temps.append({"label": label, "value": round(v / 1000, 1)})
            fans = []
            for label, f in chip["fans"]:
                v = _read_int(f)
                if v is not None:
                    fans.append({"label": label, "rpm": v})
            data = {"chip": chip["name"], "temps": temps, "fans": fans}
            slow = (time.perf_counter() - t0) * 1000 > self.SLOW_MS
            chip["cache"], chip["at"] = (data, now) if slow else (None, 0)
            out.append(data)
        return out


def _nice_chip(name, n):
    names = {
        "coretemp": "CPU",
        "k10temp": "CPU",
        "zenpower": "CPU",
        "cpu_thermal": "CPU",
        "amdgpu": "Radeon GPU",
        "xe": "Intel GPU",
        "thinkpad": "ThinkPad",
        "nvme": "NVMe SSD",
        "spd5118": "RAM",
        "alienware_wmi": "Alienware",
        "dell_ddv": "Dell",
        "dell_smm": "Dell SMM",
        "BAT0": "Battery",
        "BAT1": "Battery",
        "acpitz": "ACPI",
        "iwlwifi_1": "Wi-Fi",
    }
    if name.startswith("mt79") or name.startswith("iwl"):
        return "Wi-Fi"
    return names.get(name, name) + (f" {n}" if n else "")


def _battery_dir():
    """The first battery's sysfs dir (BAT0, BAT1, CMB0... depending on the laptop)."""
    for d in sorted(glob.glob("/sys/class/power_supply/*")):
        if _read(os.path.join(d, "type")) == "Battery" and _read(os.path.join(d, "scope"), "System") == "System":
            return d + "/"
    return "/sys/class/power_supply/BAT0/"


class Monitor:
    def __init__(self):
        self.hwmon = HwmonReader()
        self.gpu = gpu.GpuReader()
        self.hist = {k: deque([0] * HISTORY, maxlen=HISTORY)
                     for k in ("cpu", "gpu", "ram", "net_up", "net_down",
                               "disk_r", "disk_w", "cpu_temp", "gpu_temp", "igpu")}
        self._last_t = time.monotonic()
        self._last_net = psutil.net_io_counters()
        self._last_disk = psutil.disk_io_counters()
        psutil.cpu_percent(percpu=True)
        self._cpu_max = None
        try:
            self._cpu_max = psutil.cpu_freq().max
        except Exception:
            pass
        self._model = self._cpu_model()
        self._boot = psutil.boot_time()

    @staticmethod
    def _cpu_model():
        for line in (_read("/proc/cpuinfo", "") or "").splitlines():
            if line.startswith("model name"):
                return line.split(":", 1)[1].strip()
        return "CPU"

    def collect(self):
        now = time.monotonic()
        dt = max(now - self._last_t, 1e-3)
        self._last_t = now

        per = psutil.cpu_percent(percpu=True)
        cpu_total = round(sum(per) / len(per), 1) if per else 0
        try:
            freq = psutil.cpu_freq()
            cur_freq = round(freq.current)
        except Exception:
            cur_freq = None
        vm = psutil.virtual_memory()
        sw = psutil.swap_memory()

        net = psutil.net_io_counters()
        up = (net.bytes_sent - self._last_net.bytes_sent) / dt
        down = (net.bytes_recv - self._last_net.bytes_recv) / dt
        self._last_net = net

        disk = psutil.disk_io_counters()
        dr = dw = 0
        if disk and self._last_disk:
            dr = (disk.read_bytes - self._last_disk.read_bytes) / dt
            dw = (disk.write_bytes - self._last_disk.write_bytes) / dt
        self._last_disk = disk

        sensors = self.hwmon.read()
        cpu_temp, core_temps, nvme_temp, ram_temps, wifi_temp = None, [], None, [], None
        fan_chips = {}
        sensor_groups = []
        counts = {}
        for s in sensors:
            name = s["chip"]
            counts[name] = counts.get(name, 0) + 1
            if name == "coretemp":
                for t in s["temps"]:
                    if t["label"].startswith("Package"):
                        cpu_temp = t["value"]
                    elif t["label"].startswith("Core"):
                        core_temps.append(t)
            elif name in ("k10temp", "zenpower"):  # AMD Ryzen: Tctl/Tdie = package, Tccd* = core complexes
                for t in s["temps"]:
                    if t["label"] in ("Tdie", "Tctl") and (cpu_temp is None or t["label"] == "Tdie"):
                        cpu_temp = t["value"]
                    elif t["label"].startswith("Tccd"):
                        core_temps.append({"label": "CCD" + t["label"][4:], "value": t["value"]})
            elif name == "cpu_thermal" and cpu_temp is None and s["temps"]:  # ARM boards
                cpu_temp = s["temps"][0]["value"]
            elif name == "nvme" and nvme_temp is None and s["temps"]:
                nvme_temp = s["temps"][0]["value"]
            elif name == "spd5118" and s["temps"]:
                ram_temps.append(s["temps"][0]["value"])
            elif (name.startswith("mt79") or name.startswith("iwl")) and s["temps"]:
                wifi_temp = s["temps"][0]["value"]
            elif name in ("alienware_wmi", "thinkpad", "dell_smm", "asus", "hp"):
                for t in s["temps"]:
                    if t["label"] == "CPU" and cpu_temp is None:
                        cpu_temp = t["value"]
            if s["fans"]:
                fan_chips[name] = s["fans"]
            if s["temps"]:
                sensor_groups.append({
                    "name": _nice_chip(name, counts[name] if name in ("nvme", "spd5118") else 0),
                    "temps": s["temps"][:12],
                })
        fans = next((fan_chips[c] for c in ("alienware_wmi", "dell_smm", "dell_ddv", "thinkpad")
                     if c in fan_chips), next(iter(fan_chips.values()), []))
        core_temps.sort(key=lambda t: int(re.sub(r"\D", "", t["label"]) or 0))
        if cpu_temp is None and core_temps:
            cpu_temp = max(t["value"] for t in core_temps)
        if cpu_temp is None:  # last resort: the ACPI thermal zone usually tracks the CPU
            acpi = next((s["temps"] for s in sensors if s["chip"] == "acpitz" and s["temps"]), None)
            cpu_temp = max(t["value"] for t in acpi) if acpi else None

        g = self.gpu.read()

        disks = []
        seen_dev = set()
        for p in psutil.disk_partitions(all=False):
            if p.device in seen_dev or p.fstype in ("squashfs", "tmpfs", "overlay"):
                continue
            if p.mountpoint.startswith(("/snap", "/var/lib/docker", "/boot")):
                continue
            try:
                u = psutil.disk_usage(p.mountpoint)
            except OSError:
                continue
            seen_dev.add(p.device)
            disks.append({"mount": p.mountpoint, "device": p.device, "fs": p.fstype,
                          "total": u.total, "used": u.used, "percent": u.percent})

        bat = None
        b = psutil.sensors_battery()
        if b:
            bat = {"percent": round(b.percent, 1), "plugged": b.power_plugged,
                   "secsleft": b.secsleft if isinstance(b.secsleft, int) and b.secsleft > 0 else None,
                   "status": _read(_battery_dir() + "status", ""),
                   "power_w": self._battery_power()}

        h = self.hist
        h["cpu"].append(cpu_total)
        h["ram"].append(vm.percent)
        h["gpu"].append(g["nvidia"]["util"] or 0)
        h["igpu"].append(g["intel"]["util"] or 0)
        h["net_up"].append(up)
        h["net_down"].append(down)
        h["disk_r"].append(dr)
        h["disk_w"].append(dw)
        h["cpu_temp"].append(cpu_temp or 0)
        h["gpu_temp"].append(g["nvidia"]["temp"] or 0)

        return {
            "time": time.time(),
            "uptime": time.time() - self._boot,
            "hostname": os.uname().nodename,
            "kernel": os.uname().release,
            "cpu": {
                "model": self._model,
                "percent": cpu_total,
                "per_core": per,
                "freq": cur_freq,
                "freq_max": self._cpu_max,
                "temp": cpu_temp,
                "core_temps": core_temps,
                "load": os.getloadavg(),
                "procs": len(psutil.pids()),
            },
            "ram": {"percent": vm.percent, "used": vm.total - vm.available, "total": vm.total,
                    "cached": getattr(vm, "cached", 0), "temps": ram_temps,
                    "swap_percent": sw.percent, "swap_used": sw.used, "swap_total": sw.total},
            "gpu": g,
            "disks": disks,
            "disk_io": {"read": dr, "write": dw, "temp": nvme_temp},
            "net": {"up": up, "down": down, "sent": net.bytes_sent, "recv": net.bytes_recv,
                    "wifi_temp": wifi_temp},
            "battery": bat,
            "fans": fans,
            "sensors": sensor_groups,
            "history": {k: list(v) for k, v in h.items()},
        }

    @staticmethod
    def _battery_power():
        base = _battery_dir()
        p = _read_int(base + "power_now")
        if p is not None:
            return round(p / 1e6, 1)
        c, v = _read_int(base + "current_now"), _read_int(base + "voltage_now")
        if c is not None and v is not None:
            return round(c * v / 1e12, 1)
        return None
