/* App shell: navigation, top bar, modal dialogs, settings, keyboard shortcuts. */
(function () {
  const J = (window.JARVIS = window.JARVIS || {});
  const $ = (id) => document.getElementById(id);
  // order = nav order = Ctrl+1 … Ctrl+9, Ctrl+0
  const VIEWS = ["home", "systems", "files", "terminal", "apps", "processes", "control", "protocols", "power", "console", "music", "swim", "gamble", "snake", "invaders"];
  let current = "systems";
  let config = {};

  // Apply the last theme immediately so there's no dark->light flash on start.
  try { const t = JSON.parse(localStorage.getItem("jarvis.theme") || "null"); if (t) HUD.applyTheme(t.mode, t.accent, t.skin); } catch (e) {}
  applySkinText();
  HUD.background($("bg"));
  new HUD.Reactor($("logo-reactor"));

  // ------------------------------------------------------------ navigation
  J.show = function (view) {
    if (!VIEWS.includes(view)) return;
    if (view === "swim" && HUD.theme.skin !== "asahina") view = "home";   // Hina's game lives in her theme only
    if (view === "gamble" && HUD.theme.skin !== "celestia") view = "home";   // and Celestia's table in hers
    if (view === "snake" && HUD.theme.skin !== "doom") view = "home";   // and SNAKE.EXE in Doom's
    if (view === "invaders" && HUD.theme.skin !== "jarvis") view = "home";   // and DEFENSE GRID in J.A.R.V.I.S.'s
    if (current !== view) {
      const prev = J[current];
      if (prev && prev.onHide) prev.onHide();
    }
    current = view;
    document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + view));
    document.querySelectorAll(".nav-btn, #fkeys button").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
    const mod = J[view];
    if (mod && mod.onShow) mod.onShow();
    try { localStorage.setItem("jarvis.view", view); } catch (e) {}
  };
  document.querySelectorAll(".nav-btn").forEach((b) => b.addEventListener("click", () => J.show(b.dataset.view)));

  // ------------------------------------------------------------ DOOM command line
  // The D.O.O.M. theme has no side menu: you type where to go (or any J.A.R.V.I.S. command) at
  // DOOM:\> or click the F-key bar. Typing anywhere lands in the command line.
  const FKEYS = ["HOME", "SYS", "FILES", "TERM", "APPS", "TASKS", "CTRL", "PROTO", "POWER", "LOG", "MUSIC", "SNAKE"];
  const FKEY_VIEWS = VIEWS.filter((v) => !["swim", "gamble", "invaders"].includes(v));   // what the F-key bar shows, in FKEYS order
  const DOOM_GO = { home: "home", sys: "systems", systems: "systems", files: "files", ls: "files", term: "terminal", terminal: "terminal",
    shell: "terminal", apps: "apps", tasks: "processes", ps: "processes", procs: "processes", ctrl: "control", control: "control",
    proto: "protocols", protocols: "protocols", power: "power", log: "console", console: "console", doom: "console",
    music: "music", spotify: "music", lyrics: "music", snake: "snake", "snake.exe": "snake", game: "snake" };
  const DOOM_HELP = [
    "NAVIGATE  " + FKEYS.map((k, i) => (i < 10 ? `${(i + 1) % 10}=${k}` : k)).join("  ") + "   (or Ctrl+number, or type the name)",
    "COMMAND   anything DOOM understands: status · temps · open downloads · launch firefox · volume 40 · lock",
    "LINE      Up/Down = history · Esc = leave the line · cls = clear this panel",
  ];
  $("fkeys").innerHTML = FKEY_VIEWS.map((v, i) => `<button data-view="${v}"><b>${i < 10 ? (i + 1) % 10 : ["\u266a", "S"][i - 10]}</b>${FKEYS[i]}</button>`).join("");
  $("fkeys").addEventListener("click", (e) => { const b = e.target.closest("[data-view]"); if (b) J.show(b.dataset.view); });
  const doomIn = $("doom-in"), doomHist = [];
  let doomHi = 0;
  const doomPrint = (lines, cls = "") => { $("doom-out").innerHTML = lines.map((l) => `<div class="${cls}">${HUD.esc(l)}</div>`).join(""); };
  $("doom-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const raw = doomIn.value.trim();
    doomIn.value = "";
    if (!raw) return;
    doomHist.push(raw); doomHi = doomHist.length;
    const w = raw.toLowerCase().replace(/^(cd|go|goto|show)\s+/, "");
    const view = /^[0-9]$/.test(w) ? VIEWS[(+w + 9) % 10] : DOOM_GO[w];
    if (view) { J.show(view); doomPrint([`> ${raw}`, `ACCESSING ${FKEYS[FKEY_VIEWS.indexOf(view)]} ... OK`]); return; }
    if (w === "help" || w === "?") { doomPrint(DOOM_HELP); return; }
    if (w === "cls") { doomPrint([]); return; }
    doomPrint([`> ${raw}`, "PROCESSING ..."]);
    try {
      const reply = await J.console.run(raw);
      doomPrint([`> ${raw}`, ...String(reply || "DONE.").split("\n").slice(0, 3)]);
    } catch (err) { doomPrint([`> ${raw}`, "ERROR: " + err.message], "err"); }
  });
  doomIn.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp" && doomHi > 0) { doomIn.value = doomHist[--doomHi]; e.preventDefault(); }
    else if (e.key === "ArrowDown") { doomHi = Math.min(doomHist.length, doomHi + 1); doomIn.value = doomHist[doomHi] || ""; e.preventDefault(); }
    else if (e.key === "Escape") doomIn.blur();
  });

  // ------------------------------------------------------------ modal
  const modal = $("modal"), box = $("modal-box");
  let modalResolve = null;
  J.modal = function ({ title, text = "", input = null, confirm = "CONFIRM", cancel = "ABORT", danger = false, countdown = 0, icon = null, password = false }) {
    if (modalResolve) modalResolve(null);
    return new Promise((resolve) => {
      let timer = null, stopRing = null;
      const close = (val) => {
        clearInterval(timer); if (stopRing) stopRing();
        modal.classList.remove("show");
        modalResolve = null;
        resolve(val);
      };
      modalResolve = close;
      box.className = "panel modal-box" + (danger ? " danger" : "");
      box.innerHTML = `${icon ? `<canvas id="m-ring" width="360" height="360"></canvas>` : ""}
        <h2>${HUD.esc(title)}</h2><p>${HUD.esc(text)}</p>
        ${input !== null ? `<input class="hud-input" id="m-input" spellcheck="false" type="${password ? "password" : "text"}">` : ""}
        <div class="modal-actions"><button class="hud-btn" id="m-cancel">${cancel}</button>
        <button class="hud-btn ${danger ? "danger" : "primary"}" id="m-ok">${confirm}</button></div>`;
      modal.classList.add("show");
      const inp = $("m-input");
      if (inp) {
        inp.value = input;
        setTimeout(() => {
          inp.focus();
          const dot = input.lastIndexOf(".");
          inp.setSelectionRange(0, dot > 0 ? dot : input.length);
        }, 30);
      } else setTimeout(() => $("m-ok").focus(), 30);

      // countdown ring
      let remaining = null, total = countdown;
      if (icon) {
        const c = $("m-ring"), ctx = c.getContext("2d");
        stopRing = HUD.loop((dt, t) => {
          const { w, h, dpr } = HUD.fit(c), s = Math.min(w, h);
          ctx.clearRect(0, 0, w, h);
          const rgb = danger ? HUD.CRIT : HUD.C;
          ctx.save(); ctx.translate(w / 2, h / 2);
          ctx.lineWidth = 6 * dpr; ctx.strokeStyle = `rgba(${rgb},.15)`;
          ctx.beginPath(); ctx.arc(0, 0, s * 0.42, 0, Math.PI * 2); ctx.stroke();
          const frac = remaining == null ? 1 : remaining / total;
          ctx.strokeStyle = `rgba(${rgb},1)`; ctx.shadowColor = `rgba(${rgb},1)`; ctx.shadowBlur = 14 * dpr;
          ctx.beginPath(); ctx.arc(0, 0, s * 0.42, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac); ctx.stroke();
          ctx.shadowBlur = 0; ctx.rotate(t * 0.8);
          ctx.setLineDash([8 * dpr, 6 * dpr]); ctx.lineWidth = 1.5 * dpr; ctx.strokeStyle = `rgba(${rgb},.5)`;
          ctx.beginPath(); ctx.arc(0, 0, s * 0.34, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
          ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = `rgba(${rgb},1)`;
          ctx.shadowColor = `rgba(${rgb},1)`; ctx.shadowBlur = 12 * dpr;
          if (remaining == null) {
            ctx.font = `${s * 0.075}px ${HUD.FM}`;
            ctx.fillText("AWAITING", w / 2, h / 2 - s * 0.05);
            ctx.fillText("AUTHORIZATION", w / 2, h / 2 + s * 0.05);
          } else {
            ctx.font = `700 ${s * 0.26}px ${HUD.FD}`;
            ctx.fillText(Math.ceil(remaining), w / 2, h / 2);
          }
          ctx.shadowBlur = 0;
          if (remaining != null) remaining = Math.max(0, remaining - dt);
        });
      }

      $("m-cancel").onclick = () => close(input !== null ? null : false);
      $("m-ok").onclick = () => {
        if (inp) { const v = inp.value.trim(); if (v) close(v); return; }
        if (countdown > 0) {
          // second stage: countdown with abort
          $("m-ok").disabled = true;
          $("m-ok").textContent = "ENGAGED";
          $("m-cancel").textContent = "ABORT NOW";
          $("m-cancel").focus();
          remaining = countdown;
          const t0 = performance.now();
          timer = setInterval(() => { if ((performance.now() - t0) / 1000 >= countdown) close(true); }, 100);
        } else close(true);
      };
      if (inp) inp.addEventListener("keydown", (e) => { if (e.key === "Enter") $("m-ok").click(); });
    });
  };
  J.modalOpen = () => !!modalResolve;
  modal.addEventListener("mousedown", (e) => { if (e.target === modal && modalResolve) modalResolve(null); });

  // ------------------------------------------------------------ top bar & settings
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const a = b.dataset.act;
    if (a === "settings") { $("settings").classList.toggle("show"); return; }
    if (a === "theme") { J.toggleTheme(); return; }
    API.call("window", { action: a });
  });

  // ------------------------------------------------------------ theme
  // Skin wording: elements marked data-str="key" take HUD.str(key).
  function applySkinText() {
    document.querySelectorAll("[data-str]").forEach((el) => { el.textContent = HUD.str(el.dataset.str); });
    document.querySelectorAll("[data-str-ph]").forEach((el) => { el.placeholder = HUD.str(el.dataset.strPh); });
    document.title = HUD.str("title");
  }
  let systemMode = "dark";
  function resolveMode(pref) {
    if (pref === "light" || pref === "dark") return pref;
    if (pref === "time") { const h = new Date().getHours(); return h >= 7 && h < 19 ? "light" : "dark"; }
    return systemMode;
  }
  function refreshTheme() {
    const mode = resolveMode(config.theme || "dark");
    const accent = config.accent || "jarvis", skin = config.skin || "jarvis";
    if (mode !== HUD.theme.mode || accent !== HUD.theme.accent || skin !== HUD.theme.skin) {
      const skinChanged = skin !== HUD.theme.skin;
      HUD.applyTheme(mode, accent, skin);
      if (skinChanged) applySkinText();
      try { localStorage.setItem("jarvis.theme", JSON.stringify(HUD.theme)); } catch (e) {}
    }
    // Accent only colours skins without their own palette
    $("set-accent").disabled = !!HUD.SKINS[HUD.theme.skin].palette;
    $("theme-btn").querySelector("use").setAttribute("href", HUD.theme.mode === "light" ? "#i-moon" : "#i-sun");
  }
  async function pollSystemTheme() {
    if (config.theme === "system") { try { systemMode = await API.call("system_theme"); } catch (e) {} }
    refreshTheme();
  }
  setInterval(pollSystemTheme, 30000);
  J.toggleTheme = () => setCfg("theme", HUD.theme.mode === "light" ? "dark" : "light");
  $("set-accent").innerHTML = Object.entries(HUD.ACCENTS).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join("");
  const skinOptions = Object.entries(HUD.SKINS).map(([k, v]) => `<option value="${k}">${HUD.esc(v.name)}</option>`).join("");
  $("skin-select").innerHTML = $("set-skin").innerHTML = skinOptions;

  function applyConfig(c) {
    config = c;
    J.config = c;
    $("set-theme").value = c.theme || "dark";
    $("set-accent").value = c.accent || "jarvis";
    $("skin-select").value = $("set-skin").value = HUD.SKINS[c.skin] ? c.skin : "jarvis";
    $("set-rate").value = String(c.voice_rate || 1);
    if (document.activeElement !== $("set-wx")) $("set-wx").value = c.weather_location || "";
    pollSystemTheme();
    HUD.cfg.warn = +c.temp_warn || 75;
    HUD.cfg.crit = +c.temp_crit || 90;
    document.querySelectorAll(".toggle[data-set]").forEach((t) => t.classList.toggle("on", !!c[t.dataset.set]));
    fillScreens(c.screen || "auto");
    $("set-interval").value = String(c.interval_ms || 1000);
    $("set-fps").value = String(fpsMode());
    $("set-warn").value = HUD.cfg.warn;
    $("set-crit").value = HUD.cfg.crit;
  }
  // Display setting: "auto" plus the screens connected right now (and the saved one, if it's unplugged).
  async function fillScreens(want) {
    let list = [];
    try { list = await API.call("screens"); } catch (e) {}
    const sel = $("set-screen");
    const opts = [["auto", "Automatic (built-in / main screen)"], ...list.map((x) => [x.name, x.label])];
    if (want !== "auto" && !opts.some(([v]) => v === want)) opts.push([want, want + " (not connected)"]);
    sel.innerHTML = opts.map(([v, l]) => `<option value="${HUD.esc(v)}">${HUD.esc(l)}</option>`).join("");
    sel.value = want;
  }
  async function setCfg(key, value) {
    try { applyConfig(await API.call("set_config", { key, value })); } catch (e) { HUD.toast(e.message, true); }
  }
  J.setConfig = setCfg;
  document.querySelectorAll(".toggle[data-set]").forEach((t) => t.addEventListener("click", async () => {
    const key = t.dataset.set, val = !t.classList.contains("on");
    if (key === "fullscreen") { await API.call("window", { action: "fullscreen" }); setTimeout(() => API.call("info").then((i) => applyConfig(i.config)), 300); return; }
    await setCfg(key, val);
    if (key === "autostart") HUD.toast(val ? "J.A.R.V.I.S. WILL START AT LOGIN" : "AUTOSTART DISABLED");
    if (key === "voice" && val && !J.ttsAvailable) HUD.toast("Voice model missing - run ./install.sh", true);
    if (key === "wake_word") HUD.toast(val ? 'LISTENING FOR "JARVIS"' : "WAKE WORD OFF");
  }));
  $("set-screen").addEventListener("change", async (e) => { await setCfg("screen", e.target.value); API.call("window", { action: "replace" }); });
  $("set-interval").addEventListener("change", (e) => setCfg("interval_ms", +e.target.value));
  $("set-theme").addEventListener("change", (e) => setCfg("theme", e.target.value));
  $("set-rate").addEventListener("change", (e) => setCfg("voice_rate", +e.target.value));
  $("set-wx").addEventListener("change", async (e) => { await setCfg("weather_location", e.target.value.trim()); J.home.refresh(); });
  J.setTheme = (mode) => setCfg("theme", mode);
  J.setSkin = (skin) => setCfg("skin", HUD.SKINS[skin] ? skin : "jarvis");
  ["skin-select", "set-skin"].forEach((id) => $(id).addEventListener("change", (e) => { J.setSkin(e.target.value); e.target.blur(); }));
  $("set-accent").addEventListener("change", (e) => setCfg("accent", e.target.value));
  $("set-fps").addEventListener("change", async (e) => {
    await setCfg("fps", +e.target.value);
    if (!(J.music && J.music.live())) HUD.setFps(fpsMode());   // now, not at the next stats tick
  });
  $("set-warn").addEventListener("change", (e) => setCfg("temp_warn", +e.target.value));
  $("set-crit").addEventListener("change", (e) => setCfg("temp_crit", +e.target.value));

  function clock() {
    const d = new Date();
    $("clock-t").textContent = d.toLocaleTimeString(undefined, { hour12: false });
    $("clock-d").textContent = d.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" }).toUpperCase();
  }
  setInterval(clock, 1000); clock();

  // ------------------------------------------------------------ keyboard
  document.addEventListener("keydown", (e) => {
    if (J.modalOpen()) {
      if (e.key === "Escape") { $("m-cancel").click(); e.preventDefault(); }
      return;
    }
    if (J.protocols && J.protocols.editorOpen()) {
      if (e.key === "Escape") $("editor").classList.remove("show");
      return;
    }
    if (document.getElementById("voice-overlay").classList.contains("show") && e.key === "Escape") {
      API.stopListening(); document.getElementById("voice-overlay").classList.remove("show"); return;
    }
    if (e.ctrlKey && e.code === "Space") { J.voice.listen(); e.preventDefault(); return; }
    if (e.ctrlKey && /^[0-9]$/.test(e.key)) { J.show(VIEWS[(+e.key + 9) % 10]); e.preventDefault(); return; }
    if (["terminal", "swim", "gamble", "snake", "invaders"].includes(current)) return;   // every other key belongs to the shell / the game
    if (e.ctrlKey && e.key.toLowerCase() === "t") { J.toggleTheme(); e.preventDefault(); return; }
    if (e.key === "Escape" && $("settings").classList.contains("show")) { $("settings").classList.remove("show"); return; }
    if (HUD.theme.skin === "doom" && !e.ctrlKey && !e.altKey && !e.metaKey && e.key.length === 1 && !HUD.isTyping(e)
        && !["apps", "files", "processes"].includes(current)) {
      doomIn.focus();   // the key press lands in the command line
      return;
    }
    if (current === "files") J.files.keys(e);
    else if (current === "processes") J.processes.keys(e);
    else if (!["console", "apps", "protocols"].includes(current) && !e.ctrlKey && !e.altKey && e.key.length === 1 && /[a-z]/i.test(e.key) && !HUD.isTyping(e)) {
      // start typing anywhere (outside FILES/TASKS) to talk to JARVIS
      J.show("console");
      const inp = $("console-in"); inp.value = ""; inp.focus();
    }
  });

  // ------------------------------------------------------------ alerts from the backend
  API.onEvent((ev) => {
    if (ev.type !== "alert") return;
    const box = document.getElementById("toasts");
    const el = document.createElement("div");
    el.className = "toast alert" + (ev.level === "crit" ? " err" : "");
    el.innerHTML = `<b>⚠ ${HUD.esc(ev.title.toUpperCase())}</b>${HUD.esc(ev.text)}`;
    box.appendChild(el);
    setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 350); }, 12000);
  });

  // ------------------------------------------------------------ telemetry
  let lastInput = performance.now();
  ["mousemove", "keydown", "mousedown", "wheel"].forEach((ev) => document.addEventListener(ev, () => {
    const was = performance.now() - lastInput > 120000;
    lastInput = performance.now();
    if (was && !(J.music && J.music.live())) HUD.setFps(fpsMode());
  }, { passive: true, capture: true }));
  // FPS mode (Settings): 60, 30 or 20. Older configs may hold 12 or 5; those count as 20.
  function fpsMode() { const f = +config.fps || 20; return f >= 60 ? 60 : f >= 30 ? 30 : 20; }
  J.baseFps = fpsMode;   // the next stats tick applies battery/idle limits again
  const tick = [];
  let tickIdx = 0, lastWarn = 0;
  setInterval(() => {
    if (!tick.length) return;
    const el = $("ticker-text");
    el.classList.add("fade");
    setTimeout(() => {
      tickIdx = (tickIdx + 1) % tick.length;
      el.textContent = tick.slice(tickIdx, tickIdx + 3).join("   ◆   ");
      el.classList.remove("fade");
    }, 400);
  }, 5000);
  API.onStats((d) => {
    J.systems.update(d);
    J.processes.update(d);
    const nv = d.gpu.nvidia;
    $("top-cpu").innerHTML = `<svg><use href="#i-systems"/></svg>CPU <b>${Math.round(d.cpu.percent)}%</b> · RAM <b>${Math.round(d.ram.percent)}%</b> · GPU <b>${Math.round(nv.util || 0)}%</b>`;
    $("top-net").innerHTML = `<svg><use href="#i-net"/></svg><b>↓ ${HUD.fmtRate(d.net.down)}</b> <b>↑ ${HUD.fmtRate(d.net.up)}</b>`;
    const b = d.battery;
    $("top-bat").innerHTML = b
      ? `<svg><use href="#i-${b.plugged ? "bolt" : "battery"}"/></svg><b class="${b.percent < 15 && !b.plugged ? "crit" : ""}">${Math.round(b.percent)}%</b>`
      : `<svg><use href="#i-bolt"/></svg><b>AC</b>`;
    $("top-up").innerHTML = `UPTIME <b>${HUD.fmtDur(d.uptime)}</b>`;
    $("nav-mini").innerHTML = `CPU <b class="${HUD.tempLevel(d.cpu.temp)}">${d.cpu.temp != null ? Math.round(d.cpu.temp) : "--"}</b>°<br>GPU <b class="${HUD.tempLevel(nv.temp)}">${nv.state === "active" && nv.temp != null ? Math.round(nv.temp) : "--"}</b>°`;
    $("bot-host").textContent = `${d.hostname.toUpperCase()} · ${d.cpu.per_core.length} THREADS · ${HUD.fmtBytes(d.ram.total, 0)} RAM`;

    const hot = Math.max(d.cpu.temp || 0, nv.state === "active" ? nv.temp || 0 : 0);
    const st = $("bot-status");
    if (hot >= HUD.cfg.crit) { st.textContent = "THERMAL CRITICAL"; st.style.color = "var(--crit)"; }
    else if (hot >= HUD.cfg.warn) { st.textContent = "THERMALS ELEVATED"; st.style.color = "var(--warn)"; }
    else { st.textContent = HUD.str("nominal"); st.style.color = ""; }
    if (hot >= HUD.cfg.crit && Date.now() - lastWarn > 120000) { lastWarn = Date.now(); HUD.toast(`WARNING: temperature at ${Math.round(hot)}°C`, true); }

    // ticker: rotate one fact every few seconds (a scrolling marquee is too costly to composite)
    tick.length = 0;
    tick.push(`CPU ${d.cpu.model}`, `CORE TEMP ${HUD.fmtTemp(d.cpu.temp)}`, `GPU ${nv.name || "--"} · ${(nv.state || "").toUpperCase()}`,
      `VRAM ${HUD.fmtBytes(nv.vram_total || 0, 0)}`, `MEMORY ${HUD.fmtBytes(d.ram.used)} / ${HUD.fmtBytes(d.ram.total)}`,
      `LOAD AVERAGE ${d.cpu.load.map((x) => x.toFixed(2)).join(" ")}`, `NETWORK RX ${HUD.fmtBytes(d.net.recv)} · TX ${HUD.fmtBytes(d.net.sent)}`,
      ...d.fans.map((f) => `${f.label.toUpperCase()} ${f.rpm} RPM`), `KERNEL ${d.kernel}`, `UPTIME ${HUD.fmtDur(d.uptime)}`);

    // frame rate: lower on battery to save power
    const onBattery = b && !b.plugged;
    let fps = onBattery && config.eco_on_battery !== false ? Math.min(fpsMode(), 10) : fpsMode();
    if (performance.now() - lastInput > 120000) fps = Math.min(fps, 8);   // nobody's looking closely: idle saver
    if (J.music && J.music.live()) fps = 60;   // MUSIC open while Spotify plays: always 60, whatever the FPS mode
    if (fps !== HUD.getFps()) HUD.setFps(fps);
  });

  // ------------------------------------------------------------ start
  (async function start() {
    let info = { user: "", home: "/", config: { boot_animation: true } };
    try { info = await API.call("info"); } catch (e) { console.warn("backend unavailable", e); }
    applyConfig(info.config);
    J.ttsAvailable = info.tts;
    if (!info.tts) document.getElementById("voice-note").textContent = "Voice model missing - run ./install.sh";
    const name = info.user ? info.user.charAt(0).toUpperCase() + info.user.slice(1) : "";
    J.files.init(info.home);
    J.home.init(name);
    let startView = "home";
    try { startView = localStorage.getItem("jarvis.view") || "systems"; } catch (e) {}
    if (location.hash.length > 1) startView = location.hash.slice(1);
    J.show(VIEWS.includes(startView) ? startView : "home");
    await J.boot(info.config.boot_animation !== false, name);
    J.console.greet(name);
    // spoken start-up briefing (weather/updates load in the background, so give them a moment)
    if (info.config.voice !== false && info.config.speak_briefing !== false) setTimeout(() => API.speak(J.briefing()), 3500);
  })();
})();
