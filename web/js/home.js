/* HOME: the daily briefing - greeting, weather, media, updates, quick launch, recent files, calendar. */
(function () {
  const J = (window.JARVIS = window.JARVIS || {});
  const $ = (id) => document.getElementById(id);
  const esc = HUD.esc;
  const TAU = Math.PI * 2;
  let wx = null, upd = null, stats = null, user = "", lastMedia = [];

  const reactor = new HUD.Reactor($("home-reactor"), { pulse: 0.6 });

  // ------------------------------------------------------------ weather icons (holographic line art)
  function drawWeather(ctx, kind, cx, cy, s, t, day = true) {
    const C = HUD.C;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    const stroke = (a = 1, w = 0.045) => { ctx.strokeStyle = `rgba(${C},${a})`; ctx.lineWidth = s * w; };
    function sun(x, y, r) {
      if (!day) {  // moon
        stroke(0.95); ctx.beginPath(); ctx.arc(x, y, r, 0.6, TAU - 0.6 + 0.0001); ctx.arc(x + r * 0.55, y - r * 0.25, r * 0.85, TAU - 0.9, 0.9, true); ctx.stroke();
        return;
      }
      stroke(0.95); ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
      stroke(0.7, 0.035);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU + t * 0.3;
        ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r * 1.4, y + Math.sin(a) * r * 1.4); ctx.lineTo(x + Math.cos(a) * r * 1.85, y + Math.sin(a) * r * 1.85); ctx.stroke();
      }
    }
    function cloud(x, y, w, a = 1) {
      stroke(a);
      ctx.fillStyle = `rgba(${HUD.theme.mode === "light" ? "245,250,252" : "2,14,20"},0.92)`;
      ctx.beginPath();
      ctx.moveTo(x - w * 0.5, y + w * 0.22);
      ctx.arc(x - w * 0.28, y + w * 0.02, w * 0.22, Math.PI * 0.6, Math.PI * 1.5);
      ctx.arc(x + w * 0.02, y - w * 0.12, w * 0.3, Math.PI * 1.1, Math.PI * 1.95);
      ctx.arc(x + w * 0.32, y + w * 0.06, w * 0.2, Math.PI * 1.5, Math.PI * 0.45);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    const k = kind || "cloud";
    if (k === "clear") sun(0, 0, s * 0.2);
    if (k === "partly") { sun(-s * 0.12, -s * 0.12, s * 0.15); cloud(s * 0.06, s * 0.08, s * 0.62); }
    if (["cloud", "rain", "snow", "storm", "fog"].includes(k)) cloud(0, -s * 0.04, s * 0.72);
    if (k === "rain") {
      stroke(0.85, 0.035);
      for (let i = 0; i < 4; i++) {
        const x = -s * 0.2 + i * s * 0.13, ph = ((t * 1.4 + i * 0.3) % 1);
        ctx.beginPath(); ctx.moveTo(x - ph * s * 0.04, s * 0.22 + ph * s * 0.14); ctx.lineTo(x - ph * s * 0.04 - s * 0.03, s * 0.3 + ph * s * 0.14); ctx.stroke();
      }
    }
    if (k === "snow") {
      ctx.fillStyle = `rgba(${C},0.9)`;
      for (let i = 0; i < 5; i++) {
        const x = -s * 0.22 + i * s * 0.11, ph = ((t * 0.5 + i * 0.37) % 1);
        ctx.beginPath(); ctx.arc(x + Math.sin(t * 2 + i) * s * 0.02, s * 0.2 + ph * s * 0.22, s * 0.022, 0, TAU); ctx.fill();
      }
    }
    if (k === "storm") {
      ctx.fillStyle = `rgba(${HUD.WARN},${0.6 + 0.4 * Math.abs(Math.sin(t * 3))})`;
      ctx.beginPath(); ctx.moveTo(s * 0.02, s * 0.14); ctx.lineTo(-s * 0.08, s * 0.32); ctx.lineTo(0, s * 0.32); ctx.lineTo(-s * 0.05, s * 0.46);
      ctx.lineTo(s * 0.1, s * 0.25); ctx.lineTo(s * 0.02, s * 0.25); ctx.closePath(); ctx.fill();
    }
    if (k === "fog") {
      stroke(0.7, 0.035);
      for (let i = 0; i < 3; i++) { const y = s * (0.22 + i * 0.08); ctx.beginPath(); ctx.moveTo(-s * 0.3 + Math.sin(t + i) * s * 0.03, y); ctx.lineTo(s * 0.3, y); ctx.stroke(); }
    }
    ctx.restore();
  }
  HUD.drawWeather = drawWeather;

  const wxIcon = $("wx-icon"), wxCtx = wxIcon.getContext("2d");
  HUD.loop((dt, t) => {
    if (!wx || !wxIcon.offsetParent) return;
    const { w, h } = HUD.fit(wxIcon);
    wxCtx.clearRect(0, 0, w, h);
    drawWeather(wxCtx, wx.kind, w / 2, h / 2, Math.min(w, h), t, wx.is_day);
    document.querySelectorAll(".wx-day canvas").forEach((c, i) => {
      const r = HUD.fit(c), x = c.getContext("2d");
      x.clearRect(0, 0, r.w, r.h);
      drawWeather(x, wx.days[i] && wx.days[i].kind, r.w / 2, r.h / 2, Math.min(r.w, r.h), t, true);
    });
  });
  const wxSpark = new HUD.Sparkline($("wx-hours"), [{ key: "temp" }, { key: "rain", rgb: "alt", fill: false, dash: true }], { auto: true, label: "NEXT 24 H · TEMP / RAIN %" });

  async function loadWeather(force = false) {
    try {
      wx = await API.call("weather", { force });
      $("wx-loc").textContent = wx.location;
      $("wx-temp").textContent = Math.round(wx.temp) + wx.unit;
      $("wx-text").textContent = wx.text;
      $("wx-feels").textContent = Math.round(wx.feels) + wx.unit;
      $("wx-hum").textContent = wx.humidity + "%";
      $("wx-wind").textContent = Math.round(wx.wind) + " " + wx.wind_unit;
      $("wx-sun").textContent = `↑${wx.sunrise} ↓${wx.sunset}`;
      wxSpark.set({ temp: wx.hours.map((h) => h.temp), rain: wx.hours.map((h) => h.rain) });
      $("wx-days").innerHTML = wx.days.slice(0, 5).map((d, i) => {
        const day = i === 0 ? "TODAY" : new Date(d.date + "T12:00").toLocaleDateString(undefined, { weekday: "short" }).toUpperCase();
        return `<div class="wx-day" title="${esc(d.text)}"><b>${day}</b><canvas></canvas><span>${Math.round(d.max)}° / ${Math.round(d.min)}°</span><small>☂ ${d.rain ?? 0}%</small></div>`;
      }).join("");
      brief();
    } catch (e) {
      $("wx-text").textContent = "Weather offline";
      $("wx-loc").textContent = e.message.slice(0, 60);
    }
  }

  // ------------------------------------------------------------ media card (shared with CONTROL)
  J.renderMedia = function (el, list, playerLabel) {
    const m = list && list[0];
    if (playerLabel) playerLabel.textContent = m ? m.player.toUpperCase() : "";
    if (!m) {
      el.innerHTML = `<div class="media-art"><svg><use href="#i-audio"/></svg></div><div class="media-info"><div class="media-title muted">Nothing playing</div>
        <div class="media-artist">Start music in any player (Spotify, browser, Elisa…) and it appears here.</div></div>`;
      return;
    }
    const art = m.art && /^(https?|file):/.test(m.art) ? `style="background-image:url('${esc(m.art)}')"` : "";
    el.innerHTML = `<div class="media-art" ${art}>${art ? "" : '<svg><use href="#i-audio"/></svg>'}</div>
      <div class="media-info"><div class="media-title">${esc(m.title || "Unknown track")}</div><div class="media-artist">${esc(m.artist || m.album || m.player)}</div>
      <div class="media-btns" data-player="${esc(m.id)}">
        <button data-media="Previous" title="Previous"><svg><use href="#i-prev"/></svg></button>
        <button data-media="PlayPause" title="Play / pause"><svg><use href="#i-${m.status === "Playing" ? "pause" : "play"}"/></svg></button>
        <button data-media="Next" title="Next"><svg><use href="#i-next"/></svg></button></div>
      ${m.length ? `<div class="bar media-progress"><i style="width:${Math.min(100, (100 * m.position) / m.length)}%"></i></div>` : ""}</div>`;
  };
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-media]");
    if (!b) return;
    const player = b.closest("[data-player]").dataset.player;
    try { await API.call("media", { player, action: b.dataset.media }); setTimeout(refreshMedia, 400); } catch (err) { HUD.toast(err.message, true); }
  });
  async function refreshMedia() {
    try {
      const st = await API.call("control_state");
      lastMedia = st.media || [];
      J.renderMedia($("home-media"), lastMedia, $("hm-player"));
      if (J.control && J.control.apply) J.control.apply(st);
    } catch (e) {}
  }

  // ------------------------------------------------------------ updates
  async function loadUpdates() {
    $("upd-body").textContent = "Checking repositories…";
    try {
      upd = await API.call("updates");
      if (!upd.available) { $("upd-body").textContent = upd.hint || "Update checks aren't available on this system."; return; }
      $("upd-when").textContent = "CHECKED " + new Date(upd.checked * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
      $("upd-body").innerHTML = upd.count
        ? `<div class="big" style="font-size:40px">${upd.count}</div><div style="margin-bottom:8px">packages can be upgraded</div>` +
          upd.packages.slice(0, 40).map((p) => `<div>${esc(p.name)} <span style="opacity:.6">${p.from ? esc(p.from) + " → " : ""}${esc(p.to)}</span></div>`).join("")
        : `<div class="big" style="font-size:40px">✓</div><div>System is fully up to date.</div>`;
      brief();
    } catch (e) { $("upd-body").textContent = "Update check failed: " + e.message; }
  }
  $("upd-check").addEventListener("click", loadUpdates);
  $("upd-run").addEventListener("click", () => upd && upd.upgrade_cmd && J.terminal.run(upd.upgrade_cmd, { newTab: true }));

  // ------------------------------------------------------------ quick launch, protocols, recent
  async function loadQuick() {
    try {
      const apps = await API.call("apps");
      const picks = [...apps.filter((a) => a.favorite), ...apps.filter((a) => !a.favorite && a.launches).sort((a, b) => b.launches - a.launches)];
      const defaults = ["firefox", "org.kde.dolphin", "org.kde.konsole", "brave-browser", "code", "discord", "steam", "spotify", "org.kde.kate", "org.kde.systemsettings"];
      for (const id of defaults) { const a = apps.find((x) => x.id === id); if (a && !picks.includes(a)) picks.push(a); }
      $("home-apps").innerHTML = picks.slice(0, 12).map((a) =>
        `<div class="qa" data-app="${esc(a.id)}" title="${esc(a.name)}">${J.appIcon(a)}<span>${esc(a.name)}</span></div>`).join("") ||
        '<div class="muted mono">Star apps in the APPS menu to pin them here.</div>';
    } catch (e) {}
    try {
      const p = await API.call("protocols");
      $("home-protos").innerHTML = p.protocols.map((x) => `<button class="hud-btn" data-proto="${esc(x.id)}">${esc(x.name.toUpperCase())}</button>`).join("");
    } catch (e) {}
    try {
      const r = await API.call("recent");
      $("home-recent").innerHTML = r.map((f) => `<div class="ri" data-path="${esc(f.path)}" title="${esc(f.path)}">${HUD.icon(f.dir ? "folder" : "file")}<span>${esc(f.name)}</span>
        <small>${f.when ? new Date(f.when).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""}</small></div>`).join("") ||
        '<div class="muted mono">No recent files.</div>';
    } catch (e) {}
  }
  $("home-apps").addEventListener("click", (e) => { const a = e.target.closest("[data-app]"); if (a) J.launchApp(a.dataset.app); });
  $("home-protos").addEventListener("click", (e) => { const b = e.target.closest("[data-proto]"); if (b) J.protocols.engage(b.dataset.proto); });
  $("home-recent").addEventListener("click", (e) => { const r = e.target.closest("[data-path]"); if (r) API.call("open", { path: r.dataset.path }).then(() => HUD.toast("OPENING " + r.querySelector("span").textContent)); });

  // ------------------------------------------------------------ calendar
  function calendar() {
    const now = new Date(), y = now.getFullYear(), m = now.getMonth();
    $("cal-month").textContent = now.toLocaleDateString(undefined, { month: "long", year: "numeric" }).toUpperCase();
    const first = new Date(y, m, 1), start = (first.getDay() + 6) % 7, days = new Date(y, m + 1, 0).getDate(), prev = new Date(y, m, 0).getDate();
    let html = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"].map((d) => `<div class="h">${d}</div>`).join("");
    for (let i = 0; i < 42; i++) {
      const d = i - start + 1;
      if (d < 1) html += `<div class="d o">${prev + d}</div>`;
      else if (d > days) html += `<div class="d o">${d - days}</div>`;
      else html += `<div class="d${d === now.getDate() ? " t" : ""}">${d}</div>`;
    }
    $("home-cal").innerHTML = html;
  }

  // ------------------------------------------------------------ briefing text
  function greeting() {
    const h = new Date().getHours();
    return h < 5 ? "Burning the midnight oil" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  }
  function briefText() {
    const parts = [];
    if (wx) parts.push(`It's ${Math.round(wx.temp)} degrees and ${wx.text.toLowerCase()} in ${wx.location.split(",")[0]}, with a high of ${Math.round(wx.days[0].max)}${wx.days[0].rain >= 40 ? ` and a ${wx.days[0].rain} percent chance of rain` : ""}.`);
    if (stats) {
      const hot = Math.max(stats.cpu.temp || 0, stats.gpu.nvidia.state === "active" ? stats.gpu.nvidia.temp || 0 : 0);
      parts.push(`Systems are ${hot >= HUD.cfg.warn ? "running warm at " + Math.round(hot) + " degrees" : "nominal"}, memory at ${Math.round(stats.ram.percent)} percent` +
        (stats.battery ? `, battery ${Math.round(stats.battery.percent)} percent${stats.battery.plugged ? " on mains power" : ""}` : "") + ".");
    }
    if (upd && upd.available) parts.push(upd.count ? `${upd.count} package updates are waiting.` : "All packages are up to date.");
    if (lastMedia[0] && lastMedia[0].status === "Playing") parts.push(`Now playing ${lastMedia[0].title}${lastMedia[0].artist ? " by " + lastMedia[0].artist : ""}.`);
    return parts.join(" ");
  }
  function brief() {
    $("home-greet").textContent = `${greeting()}${user ? ", " + user : ""}.`;
    $("home-brief").textContent = briefText() || "Compiling briefing…";
  }
  $("home-speak").addEventListener("click", () => API.speak(J.briefing()));
  J.briefing = () => `${greeting()}, ${HUD.str("address")}. ${briefText()}`;

  function clock() {
    const d = new Date();
    $("home-time").textContent = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
    $("home-date").textContent = d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" }).toUpperCase();
  }
  setInterval(clock, 5000); clock();

  API.onStats((d) => {
    stats = d;
    reactor.level = d.cpu.percent / 100;
    const nv = d.gpu.nvidia, b = d.battery;
    const v = (label, val, sub) => `<div class="v"><b>${val}</b><span>${label}${sub ? " · " + sub : ""}</span></div>`;
    $("home-vitals").innerHTML = v("CPU", Math.round(d.cpu.percent) + "%", HUD.fmtTemp(d.cpu.temp)) +
      v("GPU", nv.state === "active" ? Math.round(nv.util || 0) + "%" : "IDLE", nv.state === "active" ? HUD.fmtTemp(nv.temp) : "") +
      v("MEMORY", Math.round(d.ram.percent) + "%", HUD.fmtBytes(d.ram.used, 1)) +
      (b ? v("POWER", Math.round(b.percent) + "%", b.plugged ? "AC" : "BATTERY") : "") +
      v("NETWORK", "↓ " + HUD.fmtRate(d.net.down), "");
  });

  let loaded = false;
  J.home = {
    init(name) { user = name; brief(); },
    onShow() {
      if (!loaded) { loaded = true; loadWeather(); loadUpdates(); }
      loadQuick(); refreshMedia(); calendar(); brief();
    },
    refresh() { loadWeather(true); loadUpdates(); loadQuick(); },
  };
  setInterval(() => { if ($("view-home").classList.contains("active")) { refreshMedia(); brief(); } }, 5000);
  setInterval(() => loadWeather(), 15 * 60 * 1000);
  setInterval(() => loadUpdates(), 60 * 60 * 1000);
})();
