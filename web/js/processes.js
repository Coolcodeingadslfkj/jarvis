/* TASKS menu: process list with end task / force kill. */
(function () {
  const J = (window.JARVIS = window.JARVIS || {});
  const $ = (id) => document.getElementById(id);
  const esc = HUD.esc;
  const st = { sort: "cpu", query: "", sel: null, rows: [], active: false, busy: false };

  const spC = new HUD.Sparkline($("sp-p-cpu"), [{ key: "cpu" }]);
  const spR = new HUD.Sparkline($("sp-p-ram"), [{ key: "ram" }]);
  const spG = new HUD.Sparkline($("sp-p-gpu"), [{ key: "gpu" }, { key: "igpu", rgb: "alt", fill: false }]);

  async function refresh() {
    if (!st.active || st.busy) return;
    st.busy = true;
    try {
      const res = await API.call("procs", { sort: st.sort, query: st.query, limit: 120 });
      st.rows = res.items;
      $("p-total").textContent = `${res.total} RUNNING`;
      render();
    } catch (e) { HUD.toast(e.message, true); }
    st.busy = false;
  }

  function render() {
    const maxMem = Math.max(1, ...st.rows.map((r) => r.mem));
    $("p-table").innerHTML = `<thead><tr><th>PID</th><th>NAME</th><th>USER</th><th>CPU</th><th></th><th>MEMORY</th><th>STATE</th><th>COMMAND</th></tr></thead><tbody>` +
      st.rows.map((r) => `<tr data-pid="${r.pid}" class="${st.sel === r.pid ? "sel" : ""}">
        <td class="m">${r.pid}</td><td>${esc(r.name)}${r.self ? ' <span class="muted mono">(jarvis)</span>' : ""}</td>
        <td class="m">${esc(r.user)}</td><td class="m ${HUD.pctLevel(r.cpu)}">${r.cpu.toFixed(1)}%</td>
        <td class="bar-cell"><div class="bar ${HUD.pctLevel(r.cpu)}"><i style="width:${Math.min(100, r.cpu)}%"></i></div></td>
        <td class="m">${HUD.fmtBytes(r.mem)} <div class="bar" style="height:3px;margin-top:3px"><i style="width:${(100 * r.mem) / maxMem}%"></i></div></td>
        <td class="m">${esc(r.status)}</td><td class="cmd" title="${esc(r.cmd)}">${esc(r.cmd)}</td></tr>`).join("") + `</tbody>`;
    const sel = st.rows.find((r) => r.pid === st.sel);
    $("p-term").disabled = $("p-kill").disabled = !sel || sel.self;
    $("p-info").innerHTML = sel
      ? `<dl class="kv"><dt>Name</dt><dd>${esc(sel.name)}</dd><dt>PID</dt><dd>${sel.pid}</dd><dt>User</dt><dd>${esc(sel.user)}</dd>
         <dt>CPU</dt><dd>${sel.cpu}%</dd><dt>Memory</dt><dd>${HUD.fmtBytes(sel.mem)}</dd><dt>State</dt><dd>${esc(sel.status)}</dd></dl>
         <div class="preview" style="max-height:140px">${esc(sel.cmd || "(kernel thread)")}</div>`
      : "Select a process.";
  }

  async function kill(pids, name, force) {
    const ok = await J.modal({
      title: force ? "FORCE KILL" : "END TASK", danger: true,
      text: `${force ? "Force kill (SIGKILL)" : "Terminate (SIGTERM)"} ${pids.length > 1 ? pids.length + " processes named" : ""} "${name}"${pids.length === 1 ? ` (PID ${pids[0]})` : ""}?` +
        (force ? "\nUnsaved work in that program will be lost." : ""),
      confirm: force ? "KILL" : "END TASK",
    });
    if (!ok) return false;
    try {
      const res = await API.call("kill", { pids, force });
      const bad = res.filter((r) => !r.ok);
      if (bad.length) HUD.toast(bad.map((b) => `PID ${b.pid}: ${b.error}`).join("\n"), true);
      else HUD.toast(`${force ? "KILLED" : "TERMINATED"} ${name}`);
      setTimeout(refresh, 400);
      return true;
    } catch (e) { HUD.toast(e.message, true); return false; }
  }

  $("p-table").addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-pid]");
    if (tr) { st.sel = +tr.dataset.pid; render(); }
  });
  document.querySelectorAll("[data-sort]").forEach((b) => b.addEventListener("click", () => {
    if (!b.closest("#view-processes")) return;
    st.sort = b.dataset.sort;
    document.querySelectorAll("#view-processes [data-sort]").forEach((x) => x.classList.toggle("on", x === b));
    refresh();
  }));
  let t;
  $("p-filter").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => { st.query = e.target.value.trim(); refresh(); }, 250); });
  const selRow = () => st.rows.find((r) => r.pid === st.sel);
  $("p-term").addEventListener("click", () => { const r = selRow(); if (r) kill([r.pid], r.name, false); });
  $("p-kill").addEventListener("click", () => { const r = selRow(); if (r) kill([r.pid], r.name, true); });

  setInterval(refresh, 2000);

  J.processes = {
    onShow() { st.active = true; refresh(); },
    onHide() { st.active = false; },
    kill,
    keys(e) {
      if (HUD.isTyping(e)) return;
      if (e.key === "Delete" && st.sel) { const r = selRow(); if (r && !r.self) kill([r.pid], r.name, e.shiftKey); e.preventDefault(); }
    },
    update(d) {
      spC.set(d.history); spR.set(d.history); spG.set(d.history);
      $("ps-cpu").textContent = d.cpu.percent.toFixed(0) + "%";
      $("ps-ram").textContent = d.ram.percent.toFixed(0) + "%";
      $("ps-gpu").textContent = (d.gpu.nvidia.util || 0) + "%";
    },
  };
})();
