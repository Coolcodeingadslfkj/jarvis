/* CONTROL: audio, displays, night light, quick toggles, media, Wi-Fi and Bluetooth. */
(function () {
  const J = (window.JARVIS = window.JARVIS || {});
  const $ = (id) => document.getElementById(id);
  const esc = HUD.esc;
  let st = {}, net = null, dragging = null, timer = null;

  const paint = (r) => r.style.setProperty("--p", r.value + "%");
  function debounce(fn, ms = 120) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
  async function call(m, a, ok) {
    try { const r = await API.call(m, a); if (ok) HUD.toast(ok); return r; } catch (e) { HUD.toast(e.message, true); throw e; }
  }

  // ------------------------------------------------------------ audio
  const setVol = debounce((kind, value) => call("volume", { kind, value }));
  for (const kind of ["sink", "source"]) {
    const r = $("vol-" + kind);
    r.addEventListener("input", () => { paint(r); $(`vol-${kind}-v`).textContent = r.value + "%"; dragging = kind; setVol(kind, +r.value); });
    r.addEventListener("change", () => { dragging = null; });
  }
  $("sink-select").addEventListener("change", (e) => call("audio_device", { kind: "sink", name: e.target.value }, "OUTPUT SWITCHED"));
  $("source-select").addEventListener("change", (e) => call("audio_device", { kind: "source", name: e.target.value }, "INPUT SWITCHED"));

  function applyAudio(a) {
    if (!a || !a.available) return;
    for (const kind of ["sink", "source"]) {
      const v = a[kind], r = $("vol-" + kind);
      if (dragging !== kind) { r.value = v.volume; paint(r); $(`vol-${kind}-v`).textContent = v.volume + "%"; }
      document.querySelector(`[data-ctl=mute-${kind}]`).classList.toggle("muted", v.muted);
    }
    const opt = (list, cur) => list.map((d) => `<option value="${esc(d.name)}"${d.name === cur ? " selected" : ""}>${esc(d.label)}</option>`).join("");
    if (document.activeElement !== $("sink-select")) $("sink-select").innerHTML = opt(a.sinks, a.default_sink);
    if (document.activeElement !== $("source-select")) $("source-select").innerHTML = opt(a.sources, a.default_source);
  }

  // ------------------------------------------------------------ displays
  const setBright = debounce((display, percent) => call("brightness", { display, percent }), 150);
  function applyDisplays(ds) {
    const box = $("bright-list");
    if (!Array.isArray(ds) || !ds.length) { box.innerHTML = '<div class="muted mono">No adjustable displays.</div>'; return; }
    if (box.children.length !== ds.length) {
      box.innerHTML = ds.map((d) => `<div class="ctl-row"><label title="${esc(d.label)}">${HUD.icon(d.internal ? "desktop" : "screen", "")} ${esc(d.internal ? "Built-in" : d.label)}</label>
        <input type="range" class="hud-range" min="1" max="100" data-display="${d.id}"><span class="ctl-val"></span></div>`).join("");
      box.querySelectorAll("[data-display]").forEach((r) => r.addEventListener("input", () => {
        paint(r); r.nextElementSibling.textContent = r.value + "%"; dragging = r.dataset.display; setBright(r.dataset.display, +r.value);
      }));
      box.querySelectorAll("[data-display]").forEach((r) => r.addEventListener("change", () => (dragging = null)));
    }
    ds.forEach((d) => {
      const r = box.querySelector(`[data-display="${d.id}"]`);
      if (r && dragging !== d.id) { r.value = d.percent; paint(r); r.nextElementSibling.textContent = d.percent + "%"; }
    });
  }
  function applyNight(n) {
    $("nl-toggle").classList.toggle("on", !!(n && n.enabled));
    $("nl-temp").textContent = n && n.available ? `${n.temperature}K` : "";
  }
  $("nl-toggle").addEventListener("click", async () => {
    const on = !$("nl-toggle").classList.contains("on");
    applyNight(await call("night_light", { enabled: on }, on ? "NIGHT LIGHT ON" : "NIGHT LIGHT OFF"));
  });

  // ------------------------------------------------------------ toggles
  function applyToggles() {
    const q = (k) => document.querySelector(`[data-qt=${k}]`);
    q("dnd").classList.toggle("on", !!st.dnd);
    q("bt").classList.toggle("on", !!(st.bluetooth && st.bluetooth.powered));
    q("wifi").classList.toggle("on", !!(net && net.radio));
    q("theme").classList.toggle("on", HUD.theme.mode === "light");
    q("wake").classList.toggle("on", !!J.config?.wake_word);
  }
  document.querySelector(".qt-grid").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-qt]");
    if (!b) return;
    const k = b.dataset.qt, on = !b.classList.contains("on");
    try {
      if (k === "dnd") { st.dnd = await call("dnd", { enabled: on }, on ? "DO NOT DISTURB" : "NOTIFICATIONS RESUMED"); }
      else if (k === "wifi") { await call("wifi_set", { enabled: on }, on ? "WI-FI ON" : "WI-FI OFF"); setTimeout(loadNet, 1500); if (net) net.radio = on; }
      else if (k === "bt") { await call("bluetooth", { enabled: on }, on ? "BLUETOOTH ON" : "BLUETOOTH OFF"); setTimeout(refresh, 800); }
      else if (k === "theme") J.toggleTheme();
      else if (k === "shot" || k === "region") {
        if (k === "shot") { await new Promise((r) => setTimeout(r, 300)); }
        const p = await call("screenshot", { mode: k === "shot" ? "full" : "region" });
        HUD.toast(k === "shot" ? "SAVED " + p : "SELECT A REGION…");
      } else if (k === "lock") J.power.ask("lock");
      else if (k === "wake") { await J.setConfig("wake_word", on); }
    } catch (err) { /* toast already shown */ }
    setTimeout(applyToggles, 100);
  });
  document.querySelector(".ctl-audio").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-ctl]");
    if (!b) return;
    if (b.dataset.ctl === "refresh") return refresh();
    const kind = b.dataset.ctl === "mute-source" ? "source" : "sink";
    const r = await call("volume", { kind, mute: "toggle" });
    b.classList.toggle("muted", r.muted);
  });

  // ------------------------------------------------------------ network
  async function loadNet(rescan = false) {
    try { net = await API.call("wifi", { rescan }); } catch (e) { $("wifi-list").innerHTML = `<div class="muted">${esc(e.message)}</div>`; return; }
    if (!net.available) { $("wifi-list").innerHTML = '<div class="muted">NetworkManager not available.</div>'; return; }
    $("net-ips").textContent = net.ips.map((i) => `${i.iface} ${i.ip}`).join(" · ");
    $("net-active").innerHTML = net.active.length
      ? net.active.map((a) => `<div><span class="${a.type === "wifi" || a.type === "ethernet" ? "" : "muted"}">● ${esc(a.name)}</span> <span class="muted">${esc(a.type)} · ${esc(a.device)}</span></div>`).join("")
      : '<span class="warn">OFFLINE</span>';
    const bars = (sig) => [25, 50, 70, 85].map((t, i) => `<i class="${sig >= t ? "on" : ""}" style="height:${5 + i * 3.5}px"></i>`).join("");
    $("wifi-list").innerHTML = !net.radio ? '<div class="muted mono" style="padding:10px">Wi-Fi radio is off.</div>' :
      net.networks.map((n) => `<div class="wifi${n.active ? " active" : ""}"><span class="bars">${bars(n.signal)}</span>
        <span class="ssid">${esc(n.ssid)}</span><span class="sec">${n.security ? "🔒 " + esc(n.security) : "OPEN"} · ${n.signal}%</span>
        ${n.active ? '<span class="state-badge active">CONNECTED</span>' : `<button class="hud-btn" data-ssid="${esc(n.ssid)}" data-known="${n.known ? 1 : 0}" data-secure="${n.security ? 1 : 0}">CONNECT</button>`}</div>`).join("");
    applyToggles();
  }
  $("wifi-scan").addEventListener("click", () => { $("wifi-list").innerHTML = '<div class="muted mono" style="padding:10px">SCANNING…</div>'; loadNet(true); });
  $("wifi-list").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-ssid]");
    if (!b) return;
    const ssid = b.dataset.ssid;
    let password = null;
    if (b.dataset.secure === "1" && b.dataset.known !== "1") {
      password = await J.modal({ title: "WI-FI PASSWORD", text: `Network "${ssid}"`, input: "", confirm: "CONNECT", password: true });
      if (!password) return;
    }
    b.textContent = "…"; b.disabled = true;
    try { HUD.toast((await API.call("wifi_connect", { ssid, password })).toUpperCase()); } catch (err) { HUD.toast(err.message, true); }
    loadNet();
  });

  // ------------------------------------------------------------ bluetooth
  function applyBt(b) {
    if (!b || !b.available) { $("bt-state").textContent = "UNAVAILABLE"; $("bt-list").textContent = "No Bluetooth adapter."; return; }
    $("bt-state").textContent = b.powered ? "POWERED" : "OFF";
    $("bt-list").innerHTML = b.devices.length
      ? b.devices.map((d) => `<div class="bt-dev"><span>${esc(d.name)}</span><span class="${d.connected ? "" : "muted"}">${d.connected ? "CONNECTED" : d.paired ? "PAIRED" : ""}</span></div>`).join("")
      : (b.powered ? "No paired devices. Pair new devices in System Settings → Bluetooth." : "Bluetooth is off.");
  }

  // ------------------------------------------------------------ refresh
  function apply(s) {
    st = s;
    applyAudio(s.audio); applyDisplays(s.displays); applyNight(s.night); applyBt(s.bluetooth);
    J.renderMedia($("ctl-media"), s.media || [], $("cm-player"));
    applyToggles();
  }
  async function refresh() {
    try { apply(await API.call("control_state")); } catch (e) {}
  }
  API.onEvent((ev) => { if (ev.type === "dnd") { st.dnd = ev.enabled; applyToggles(); } });

  J.control = {
    apply,
    onShow() { refresh(); loadNet(); clearInterval(timer); timer = setInterval(() => { if ($("view-control").classList.contains("active")) refresh(); else clearInterval(timer); }, 3000); },
    refresh,
  };
})();
