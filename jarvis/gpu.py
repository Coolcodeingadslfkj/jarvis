"""GPU telemetry: NVIDIA (NVML / nvidia-smi), AMD Radeon (amdgpu sysfs) and Intel (i915 / xe sysfs).

read() returns {"nvidia": <main GPU>, "intel": <integrated GPU next to it>}. The key names are historical:
"nvidia" is the main GPU (a discrete NVIDIA or AMD card, or the integrated GPU when there is no discrete
one) and "intel" is the integrated Intel / AMD GPU of a hybrid laptop ({"present": False} otherwise).

The NVIDIA laptop GPU uses runtime power management: when nothing uses it, it
drops into D3cold. Opening the device (NVML / nvidia-smi) wakes it, so polling
it every second would keep it awake forever and drain the battery. We therefore
read the PCI runtime_status from sysfs (which never wakes the GPU), and when the
GPU has been idle for a while we stop querying it for a cool-down window so it
can go back to sleep.
"""

import glob
import os
import re
import shutil
import subprocess
import time

try:
    import pynvml
except Exception:  # pragma: no cover
    pynvml = None

IDLE_SAMPLES_BEFORE_BACKOFF = 15
BACKOFF_SECONDS = 45


def _read(path, default=None):
    try:
        with open(path) as f:
            return f.read().strip()
    except OSError:
        return default


def _find_nvidia_pci():
    for d in glob.glob("/sys/bus/pci/drivers/nvidia/0000:*"):
        if _read(os.path.join(d, "class"), "").startswith("0x03"):
            return d
    return None


def _cards():
    """[(card dir, kernel driver)] for every GPU."""
    out = []
    for d in sorted(glob.glob("/sys/class/drm/card*")):
        if "-" in os.path.basename(d):
            continue
        try:
            out.append((d, os.path.basename(os.readlink(os.path.join(d, "device", "driver")))))
        except OSError:
            pass
    return out


def _int(path):
    try:
        return int(_read(path))
    except (TypeError, ValueError):
        return None


def _pci_name(card, fallback):
    """Marketing name from pci.ids, e.g. "Radeon 680M" or "Arc Graphics"."""
    vendor = (_read(os.path.join(card, "device", "vendor"), "") or "")[2:].lower()
    device = (_read(os.path.join(card, "device", "device"), "") or "")[2:].lower()
    for db in ("/usr/share/hwdata/pci.ids", "/usr/share/misc/pci.ids", "/usr/share/pci.ids"):
        try:
            with open(db, encoding="utf-8", errors="replace") as f:
                in_vendor = False
                for line in f:
                    if line.startswith("#") or not line.strip():
                        continue
                    if not line.startswith("\t"):
                        in_vendor = line.startswith(vendor + "  ")
                    elif in_vendor and line.startswith("\t" + device + "  "):
                        name = line.split("  ", 1)[1].strip()
                        m = re.search(r"\[([^\]]+)\]", name)
                        name = m.group(1) if m else name
                        return name if fallback.split()[0].lower() in name.lower() else f"{fallback.split()[0]} {name}"
        except OSError:
            continue
    return fallback


def _hwmon(card):
    return next(iter(sorted(glob.glob(os.path.join(card, "device", "hwmon", "hwmon*")))), None)


def _amd_sclk(card):
    """(current, max) shader clock in MHz."""
    cur = mx = None
    hw = _hwmon(card)
    if hw and _int(os.path.join(hw, "freq1_input")):
        cur = round(_int(os.path.join(hw, "freq1_input")) / 1e6)
    levels = []
    for line in (_read(os.path.join(card, "device", "pp_dpm_sclk"), "") or "").splitlines():
        m = re.match(r"\s*\d+:\s*(\d+)\s*[Mm]hz(\s*\*)?", line)
        if m:
            levels.append(int(m.group(1)))
            if m.group(2) and cur is None:
                cur = int(m.group(1))
    if levels:
        mx = max(levels)
    return cur, mx


def _amd_vram_total(card):
    return _int(os.path.join(card, "device", "mem_info_vram_total")) or 0


class GpuReader:
    def __init__(self):
        self.nv_pci = _find_nvidia_pci()
        cards = _cards()
        intel = [c for c, drv in cards if drv in ("i915", "xe")]
        amd = [c for c, drv in cards if drv == "amdgpu"]
        # an AMD APU's VRAM is a small carve-out of system RAM; a discrete Radeon has its own
        amd_dgpu = [c for c in amd if _amd_vram_total(c) > 2 * 2**30]
        amd_igpu = [c for c in amd if c not in amd_dgpu]
        self.igpu = (intel or amd_igpu or [None])[0]
        self.amd_dgpu = amd_dgpu[0] if amd_dgpu else None
        self._names = {}
        self.nv_name = None
        self._idle_count = 0
        self._backoff_until = 0
        self._last = None
        self._nvml = None
        self.has_nvidia = self.nv_pci is not None and (pynvml is not None or shutil.which("nvidia-smi"))

    # -- NVIDIA ------------------------------------------------------------
    def _runtime_status(self):
        if not self.nv_pci:
            return None
        return _read(os.path.join(self.nv_pci, "power", "runtime_status"))

    def _nvml_open(self):
        # Kept open only while the GPU is awake; closed again so it can power down.
        if self._nvml is None:
            pynvml.nvmlInit()
            self._nvml = pynvml.nvmlDeviceGetHandleByIndex(0)
        return self._nvml

    def _nvml_close(self):
        if self._nvml is not None:
            self._nvml = None
            try:
                pynvml.nvmlShutdown()
            except Exception:
                pass

    def _query_nvml(self):
        try:
            h = self._nvml_open()
            name = pynvml.nvmlDeviceGetName(h)
            if isinstance(name, bytes):
                name = name.decode()
            util = pynvml.nvmlDeviceGetUtilizationRates(h)
            mem = pynvml.nvmlDeviceGetMemoryInfo(h)
            out = {
                "name": name,
                "util": util.gpu,
                "mem_util": util.memory,
                "temp": pynvml.nvmlDeviceGetTemperature(h, pynvml.NVML_TEMPERATURE_GPU),
                "vram_used": mem.used,
                "vram_total": mem.total,
            }
            for key, fn in (("power_w", lambda: pynvml.nvmlDeviceGetPowerUsage(h) / 1000),
                            ("power_limit_w", lambda: pynvml.nvmlDeviceGetEnforcedPowerLimit(h) / 1000),
                            ("clock", lambda: pynvml.nvmlDeviceGetClockInfo(h, pynvml.NVML_CLOCK_GRAPHICS)),
                            ("clock_max", lambda: pynvml.nvmlDeviceGetMaxClockInfo(h, pynvml.NVML_CLOCK_GRAPHICS)),
                            ("mem_clock", lambda: pynvml.nvmlDeviceGetClockInfo(h, pynvml.NVML_CLOCK_MEM)),
                            ("fan", lambda: pynvml.nvmlDeviceGetFanSpeed(h)),
                            ("pstate", lambda: pynvml.nvmlDeviceGetPerformanceState(h))):
                try:
                    out[key] = round(fn(), 1)
                except Exception:
                    out[key] = None
            try:
                procs = pynvml.nvmlDeviceGetGraphicsRunningProcesses(h) + \
                    pynvml.nvmlDeviceGetComputeRunningProcesses(h)
                out["processes"] = len({p.pid for p in procs})
            except Exception:
                out["processes"] = None
            return out
        except Exception:
            self._nvml_close()
            raise

    def _query_smi(self):
        fields = "name,utilization.gpu,utilization.memory,temperature.gpu,memory.used,memory.total," \
                 "power.draw,power.limit,clocks.gr,clocks.max.gr,clocks.mem"
        r = subprocess.run(["nvidia-smi", f"--query-gpu={fields}", "--format=csv,noheader,nounits"],
                           capture_output=True, text=True, timeout=3)
        v = [x.strip() for x in r.stdout.splitlines()[0].split(",")]

        def num(x):
            try:
                return float(x)
            except ValueError:
                return None
        return {"name": v[0], "util": num(v[1]), "mem_util": num(v[2]), "temp": num(v[3]),
                "vram_used": (num(v[4]) or 0) * 2**20, "vram_total": (num(v[5]) or 0) * 2**20,
                "power_w": num(v[6]), "power_limit_w": num(v[7]), "clock": num(v[8]),
                "clock_max": num(v[9]), "mem_clock": num(v[10]), "fan": None, "pstate": None,
                "processes": None}

    def _nvidia(self):
        base = {"present": bool(self.has_nvidia), "state": "absent", "name": self.nv_name or "NVIDIA GPU",
                "util": 0, "temp": None, "vram_used": None, "vram_total": None, "power_w": None,
                "clock": None, "clock_max": None}
        if not self.has_nvidia:
            return base
        status = self._runtime_status()
        now = time.monotonic()
        if status == "suspended":
            self._nvml_close()
            self._idle_count = 0
            base["state"] = "standby"
            if self._last:
                base["vram_total"] = self._last.get("vram_total")
                base["clock_max"] = self._last.get("clock_max")
            return base
        if now < self._backoff_until:
            base["state"] = "idle"
            if self._last:
                base.update({k: self._last.get(k) for k in ("vram_total", "clock_max", "temp")})
            return base
        try:
            data = self._query_nvml() if pynvml else self._query_smi()
        except Exception as e:
            try:
                data = self._query_smi()
            except Exception:
                base["state"] = "error"
                base["error"] = str(e)
                return base
        self.nv_name = data.get("name") or self.nv_name
        self._last = data
        base.update(data)
        base["state"] = "active"
        # Let the GPU sleep again if nothing is using it.
        if (data.get("util") or 0) < 1 and not data.get("processes"):
            self._idle_count += 1
            if self._idle_count >= IDLE_SAMPLES_BEFORE_BACKOFF:
                self._idle_count = 0
                self._backoff_until = now + BACKOFF_SECONDS
                self._nvml_close()
        else:
            self._idle_count = 0
        return base

    # -- AMD discrete ----------------------------------------------------------
    def _amd(self, card):
        name = self._names.setdefault(card, _pci_name(card, "AMD Radeon GPU"))
        base = {"present": True, "state": "active", "name": name, "util": 0, "temp": None, "vram_used": None,
                "vram_total": _amd_vram_total(card) or None, "power_w": None, "power_limit_w": None,
                "clock": None, "clock_max": None, "mem_util": None}
        if _read(os.path.join(card, "device", "power", "runtime_status")) == "suspended":
            base["state"] = "standby"  # reading more would wake it
            return base
        dev, hw = os.path.join(card, "device"), _hwmon(card)
        base["util"] = _int(os.path.join(dev, "gpu_busy_percent")) or 0
        base["mem_util"] = _int(os.path.join(dev, "mem_busy_percent"))
        base["vram_used"] = _int(os.path.join(dev, "mem_info_vram_used"))
        base["clock"], base["clock_max"] = _amd_sclk(card)
        if hw:
            t = _int(os.path.join(hw, "temp1_input"))
            base["temp"] = round(t / 1000, 1) if t is not None else None
            pw = _int(os.path.join(hw, "power1_average")) or _int(os.path.join(hw, "power1_input"))
            base["power_w"] = round(pw / 1e6, 1) if pw else None
            cap = _int(os.path.join(hw, "power1_cap"))
            base["power_limit_w"] = round(cap / 1e6) if cap else None
        return base

    # -- integrated (Intel i915 / xe, AMD APU) -----------------------------------
    def _integrated(self):
        card = self.igpu
        if not card:
            return {"present": False, "util": 0}
        drv = os.path.basename(os.readlink(os.path.join(card, "device", "driver")))
        out = {"present": True, "name": self._names.setdefault(card, _pci_name(card, "AMD Radeon Graphics" if drv == "amdgpu"
                                                                                 else "Intel Graphics")),
               "freq": None, "freq_max": None, "util": 0, "temp": None}
        if drv == "amdgpu":  # real utilisation, not just a clock ratio
            out["util"] = _int(os.path.join(card, "device", "gpu_busy_percent")) or 0
            out["freq"], out["freq_max"] = _amd_sclk(card)
            hw = _hwmon(card)
            t = _int(os.path.join(hw, "temp1_input")) if hw else None
            out["temp"] = round(t / 1000, 1) if t is not None else None
            return out
        if drv == "xe":
            gt = os.path.join(card, "device", "tile0", "gt0", "freqs")
            act, mx = _int(os.path.join(gt, "act_freq")), _int(os.path.join(gt, "max_freq"))
        else:
            act = _int(os.path.join(card, "gt_act_freq_mhz"))
            mx = _int(os.path.join(card, "gt_max_freq_mhz")) or _int(os.path.join(card, "gt_RP0_freq_mhz"))
        out.update(freq=act, freq_max=mx, util=round(100 * act / mx, 1) if act is not None and mx else 0)
        return out

    def read(self):
        if self.has_nvidia:
            return {"nvidia": self._nvidia(), "intel": self._integrated()}
        if self.amd_dgpu:
            return {"nvidia": self._amd(self.amd_dgpu), "intel": self._integrated()}
        ig = self._integrated()
        if not ig["present"]:
            return {"nvidia": self._nvidia(), "intel": ig}
        # no discrete GPU: the integrated one is the main GPU
        main = {"present": True, "state": "active", "name": ig["name"], "util": ig["util"], "temp": ig["temp"],
                "vram_used": None, "vram_total": None, "power_w": None, "power_limit_w": None,
                "clock": ig["freq"], "clock_max": ig["freq_max"], "mem_util": None, "integrated": True}
        if self.igpu and os.path.basename(os.readlink(os.path.join(self.igpu, "device", "driver"))) == "amdgpu":
            main["vram_used"] = _int(os.path.join(self.igpu, "device", "mem_info_vram_used"))
            main["vram_total"] = _amd_vram_total(self.igpu) or None
        return {"nvidia": main, "intel": {"present": False, "util": 0}}
