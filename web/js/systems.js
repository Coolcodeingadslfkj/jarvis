/* SYSTEMS menu: live performance + thermals. */
(function () {
  const J = (window.JARVIS = window.JARVIS || {});
  const $ = (id) => document.getElementById(id);

  const gCpu = new HUD.RingGauge($("g-cpu"), { label: "CPU LOAD" });
  const gGpu = new HUD.RingGauge($("g-gpu"), { label: "GPU LOAD" });
  const gRam = new HUD.RingGauge($("g-ram"), { label: "MEMORY" });
  const gBat = new HUD.RingGauge($("g-bat"), { label: "BATTERY" });
  const core = new HUD.Core($("core"));
  const spCpu = new HUD.Sparkline($("sp-cpu"), [{ key: "cpu" }, { key: "cpu_temp", rgb: "warn", fill: false, dash: true }], { label: "LOAD % / TEMP °C · 90s" });
  const spGpu = new HUD.Sparkline($("sp-gpu"), [{ key: "gpu" }, { key: "igpu", rgb: "alt", fill: false }, { key: "gpu_temp", rgb: "warn", fill: false, dash: true }], { label: "dGPU % / iGPU % / TEMP °C" });
  const spRam = new HUD.Sparkline($("sp-ram"), [{ key: "ram" }], { label: "MEMORY % · 90s" });
  const spNet = new HUD.Sparkline($("sp-net"), [{ key: "net_down" }, { key: "net_up", rgb: "alt" }], { auto: true, label: "NET ↓ / ↑" });

  // Spin fan icons from the shared render loop (CSS infinite animations are too costly here).
  let fanRpm = [];
  const fanAngle = [];
  HUD.loop((dt) => {
    const box = $("fans");
    if (!box.offsetParent) return;
    fanRpm.forEach((rpm, i) => {
      const svg = box.children[i] && box.children[i].firstElementChild;
      if (!svg) return;
      // visual speed only - a real 2400 RPM would just look like a blur
      fanAngle[i] = ((fanAngle[i] || 0) + dt * rpm * 0.15) % 360;
      svg.style.transform = `rotate(${fanAngle[i]}deg)`;
    });
  });

  let threadsBuilt = 0;
  function buildThreads(n) {
    const box = $("threads");
    box.innerHTML = "";
    box.style.gridTemplateColumns = `repeat(${Math.min(n, 8)}, 1fr)`;
    for (let i = 0; i < n; i++) {
      const d = document.createElement("div");
      d.className = "thread";
      d.innerHTML = `<span>T${i}</span><i></i>`;
      box.appendChild(d);
    }
    threadsBuilt = n;
  }

  function setBar(id, pct, level) {
    const el = $(id);
    el.className = "bar" + (level ? " " + level : "");
    el.firstElementChild.style.width = Math.max(0, Math.min(100, pct)) + "%";
  }

  function txt(id, v, level) {
    const el = $(id);
    if (!el) return;
    el.textContent = v;
    el.classList.toggle("warn", level === "warn");
    el.classList.toggle("crit", level === "crit");
  }

  J.systems = {
    update(d) {
      const cpu = d.cpu, ram = d.ram, nv = d.gpu.nvidia, ig = d.gpu.intel, h = d.history;
      // CPU
      $("cpu-model").textContent = cpu.model.replace(/\(R\)|\(TM\)/g, "").replace(/\s+/g, " ");
      gCpu.set(cpu.percent, { temp: cpu.temp });
      txt("cpu-temp", HUD.fmtTemp(cpu.temp), HUD.tempLevel(cpu.temp));
      txt("cpu-freq", cpu.freq ? (cpu.freq >= 1000 ? (cpu.freq / 1000).toFixed(2) + " GHz" : cpu.freq + " MHz") : "--");
      txt("cpu-load", cpu.load.map((x) => x.toFixed(2)).join(" "));
      txt("cpu-procs", cpu.procs);
      if (threadsBuilt !== cpu.per_core.length) buildThreads(cpu.per_core.length);
      const th = $("threads").children;
      cpu.per_core.forEach((v, i) => {
        const bar = th[i].lastElementChild;
        bar.style.height = Math.max(2, v) + "%";
        const lvl = HUD.pctLevel(v);
        bar.style.background = lvl ? `linear-gradient(to top, rgb(${HUD.rgbFor(lvl)}), rgba(${HUD.rgbFor(lvl)},.25))` : "";
      });
      $("coretemps").innerHTML = cpu.core_temps.slice(0, 10).map((t) =>
        `<div class="${HUD.tempLevel(t.value)}"><small>${HUD.esc(t.label.replace("Core ", "C"))}</small>${Math.round(t.value)}°</div>`).join("");
      spCpu.set(h);

      // GPU
      const state = nv.state || "absent";
      const badge = $("gpu-state");
      badge.textContent = state.toUpperCase();
      badge.className = "state-badge " + state;
      $("gpu-name").textContent = nv.name || (nv.present ? "GPU" : "NO GPU DETECTED");
      const sleeping = state === "standby" || state === "idle";
      gGpu.set(nv.util || 0, { temp: sleeping ? null : nv.temp, sub: sleeping ? "STANDBY" : "", text: sleeping ? "0" : null });
      txt("gpu-temp", sleeping ? (nv.temp ? HUD.fmtTemp(nv.temp) + " (last)" : "asleep") : HUD.fmtTemp(nv.temp), HUD.tempLevel(nv.temp));
      txt("gpu-clock", nv.clock != null ? `${Math.round(nv.clock)} / ${Math.round(nv.clock_max || 0)} MHz` : "--");
      txt("gpu-power", nv.power_w != null ? `${nv.power_w} W${nv.power_limit_w ? " / " + Math.round(nv.power_limit_w) + " W" : ""}` : "--");
      txt("gpu-memutil", nv.mem_util != null ? nv.mem_util + "%" : "--");
      const vp = nv.vram_total ? (100 * (nv.vram_used || 0)) / nv.vram_total : 0;
      setBar("b-vram", vp, HUD.pctLevel(vp));
      txt("gpu-vram", nv.vram_total ? `${HUD.fmtBytes(nv.vram_used || 0, 1)} / ${HUD.fmtBytes(nv.vram_total, 0)}` : "--");
      setBar("b-igpu", ig.util || 0);
      txt("igpu-freq", ig.present ? `${ig.freq ?? "--"} / ${ig.freq_max ?? "--"} MHz` : "n/a");
      $("gpu-note").textContent = state === "standby"
        ? "dGPU powered down (D3cold) to save battery - wakes automatically when an app uses it."
        : state === "idle" ? "dGPU idle - polling paused so it can power down." : state === "error" ? (nv.error || "") : "";
      spGpu.set(h);

      // Core
      const gpuPct = sleeping ? 0 : nv.util || 0;
      core.set({ cpu: cpu.percent, gpu: gpuPct, ram: ram.percent, igpu: ig.util || 0 }, cpu.per_core, {
        cpu: HUD.tempLevel(cpu.temp) || HUD.pctLevel(cpu.percent),
        gpu: HUD.tempLevel(nv.temp) || HUD.pctLevel(gpuPct),
      });
      txt("cl-cpu", Math.round(cpu.percent) + "%", HUD.pctLevel(cpu.percent));
      txt("cl-cpu-t", HUD.fmtTemp(cpu.temp), HUD.tempLevel(cpu.temp));
      txt("cl-gpu", Math.round(gpuPct) + "%", HUD.pctLevel(gpuPct));
      txt("cl-gpu-t", sleeping ? "STANDBY" : HUD.fmtTemp(nv.temp), HUD.tempLevel(nv.temp));
      txt("cl-ram", Math.round(ram.percent) + "%", HUD.pctLevel(ram.percent));
      const rt = ram.temps && ram.temps.length ? Math.max(...ram.temps) : null;
      txt("cl-ram-t", HUD.fmtTemp(rt), HUD.tempLevel(rt));
      txt("cl-igpu", Math.round(ig.util || 0) + "%");
      txt("cl-igpu-t", ig.freq != null ? ig.freq + " MHz" : "--");
      $("core-host").textContent = `${d.hostname.toUpperCase()} · LINUX ${d.kernel}`;

      // RAM
      gRam.set(ram.percent, { sub: HUD.fmtBytes(ram.used, 1) });
      $("ram-total").textContent = HUD.fmtBytes(ram.total, 1) + " TOTAL";
      txt("ram-used", HUD.fmtBytes(ram.used, 2));
      txt("ram-cache", HUD.fmtBytes(ram.cached, 1));
      txt("ram-temp", ram.temps.length ? ram.temps.map((t) => Math.round(t) + "°").join(" / ") : "--", HUD.tempLevel(rt));
      setBar("b-swap", ram.swap_percent, HUD.pctLevel(ram.swap_percent));
      txt("swap-v", `${HUD.fmtBytes(ram.swap_used, 1)}`);
      spRam.set(h);

      // Storage + net
      $("disks").innerHTML = d.disks.map((x) =>
        `<div class="bar-row"><span class="l" title="${HUD.esc(x.device)}">${HUD.esc(x.mount)}</span><div class="bar ${HUD.pctLevel(x.percent)}"><i style="width:${x.percent}%"></i></div><span class="v">${HUD.fmtBytes(x.total - x.used, 0)} free</span></div>`).join("");
      $("nvme-temp").textContent = d.disk_io.temp != null ? "NVMe " + HUD.fmtTemp(d.disk_io.temp) : "";
      $("disk-io").textContent = `R ${HUD.fmtRate(d.disk_io.read)} · W ${HUD.fmtRate(d.disk_io.write)}`;
      $("net-rate").textContent = `${HUD.fmtRate(d.net.down)} / ${HUD.fmtRate(d.net.up)}`;
      txt("net-recv", HUD.fmtBytes(d.net.recv));
      txt("net-sent", HUD.fmtBytes(d.net.sent));
      txt("wifi-temp", HUD.fmtTemp(d.net.wifi_temp), HUD.tempLevel(d.net.wifi_temp));
      spNet.set(h);

      // Battery
      const b = d.battery;
      if (b) {
        const lvl = b.percent < 15 && !b.plugged ? "crit" : b.percent < 30 && !b.plugged ? "warn" : "";
        gBat.set(b.percent, { level: lvl, sub: b.plugged ? "AC POWER" : "ON BATTERY" });
        $("bat-status").textContent = (b.status || "").toUpperCase();
        txt("bat-src", b.plugged ? "AC adapter" : "Battery");
        txt("bat-power", b.power_w != null ? b.power_w + " W" : "--");
        txt("bat-left", b.secsleft ? HUD.fmtDur(b.secsleft) : b.plugged ? "∞" : "--");
      } else {
        gBat.set(0, { text: "AC", sub: "NO BATTERY" });
      }
      // Fans: update in place so the spin animation doesn't restart every second.
      const fans = (d.fans || []).slice(0, 3), fanBox = $("fans");
      if (fanBox.children.length !== fans.length) {
        fanBox.innerHTML = fans.map((f) => `<div class="fan"><svg><use href="#i-fan"/></svg>${HUD.esc(f.label)}<b></b></div>`).join("");
      }
      fans.forEach((f, i) => { fanBox.children[i].lastElementChild.textContent = f.rpm + " RPM"; });
      fanRpm = fans.map((f) => f.rpm);

      // Thermal matrix
      const groups = [...d.sensors];
      if (nv.temp != null && !sleeping && !groups.some((g) => /gpu/i.test(g.name))) groups.unshift({ name: nv.name || "GPU", temps: [{ label: "Core", value: nv.temp }] });
      $("temps").innerHTML = groups.map((g) =>
        `<div class="tgroup"><div class="grp">${HUD.esc(g.name.toUpperCase())}</div>` +
        g.temps.map((t) => `<div class="row"><span>${HUD.esc(t.label)}</span><b class="${HUD.tempLevel(t.value)}">${t.value.toFixed(1)}°</b></div>`).join("") + `</div>`).join("");
    },
  };
})();
