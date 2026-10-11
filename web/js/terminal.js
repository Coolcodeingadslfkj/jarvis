/* TERMINAL menu: real shell sessions (Python pty) rendered with xterm.js, themed like the HUD. */
(function () {
  const J = (window.JARVIS = window.JARVIS || {});
  const $ = (id) => document.getElementById(id);
  const esc = HUD.esc;
  const tabs = new Map();          // id -> {term, fit, search, el, title, cwd, pid, exited}
  let active = null;
  let fontSize = 15;
  try { fontSize = +localStorage.getItem("jarvis.term.font") || 15; } catch (e) {}

  // Package commands come from the backend (jarvis/distro.py), so they match this distribution.
  const PKG = { upgrade: "", pending: "", orphans: "", largest: "" };
  let distroName = "system";
  const QUICK = () => [
    ["System report", "uname -a && uptime && free -h && df -h / /home 2>/dev/null"],
    ["Update " + distroName, PKG.upgrade],
    ["Pending updates", PKG.pending],
    ["Disk usage here", "du -sh -- * .[!.]* 2>/dev/null | sort -h | tail -25"],
    ["Network", "ip -br addr && echo && nmcli -f IN-USE,SSID,SIGNAL,SECURITY dev wifi list 2>/dev/null | head -15"],
    ["Errors this boot", "journalctl -p 3 -b --no-pager | tail -40"],
    ["Failed services", "systemctl --failed; systemctl --user --failed"],
    ["Top processes", "top"],
    ["GPU status", "nvidia-smi 2>/dev/null || (lspci | grep -iE 'vga|3d|display'; glxinfo -B 2>/dev/null | grep -E 'renderer|Video memory')"],
    ["Sensors", "sensors"],
    ["Orphan packages", PKG.orphans],
    ["Largest packages", PKG.largest],
  ].filter(([, c]) => c);

  // The pixel-art banners (Celestia, DOOM) are drawn with half blocks, which only meet with no extra line spacing.
  const lineHeight = () => (HUD.theme.skin === "jarvis" ? 1.15 : 1);
  function xtermTheme() {
    const cs = getComputedStyle(document.documentElement);
    const v = (k) => cs.getPropertyValue(k).trim();
    const rgb = (k, a = 1) => `rgba(${v(k)}, ${a})`;
    const light = HUD.theme.mode === "light";
    return light ? {
      background: "#f4f9fb", foreground: v("--text"), cursor: rgb("--c-rgb"), cursorAccent: "#ffffff",
      selectionBackground: rgb("--c-rgb", 0.25), black: "#1d3640", red: "#c4283f", green: "#14855a", yellow: "#a86a00",
      blue: rgb("--c-rgb"), magenta: "#8a3fb8", cyan: "#00809a", white: "#5b7883",
      brightBlack: "#5b7883", brightRed: "#e0384f", brightGreen: "#1ca36f", brightYellow: "#c78400",
      brightBlue: rgb("--cb-rgb"), brightMagenta: "#a252d6", brightCyan: "#0097b5", brightWhite: "#0e2630",
    } : {
      background: "rgba(0,0,0,0)", foreground: v("--text"), cursor: rgb("--c-rgb"), cursorAccent: "#000000",
      selectionBackground: rgb("--c-rgb", 0.3), black: "#0b1820", red: "#ff4d63", green: "#3dffb5", yellow: "#ffc24a",
      blue: rgb("--c-rgb"), magenta: "#c38bff", cyan: "#4ff0ff", white: "#b9dbe4",
      brightBlack: "#4f7480", brightRed: "#ff7a8c", brightGreen: "#7dffcf", brightYellow: "#ffd77a",
      brightBlue: rgb("--cb-rgb"), brightMagenta: "#dab5ff", brightCyan: "#9ff8ff", brightWhite: "#ffffff",
    };
  }

  function renderTabs() {
    $("term-tabs").innerHTML = [...tabs.entries()].map(([id, t]) =>
      `<div class="term-tab${id === active ? " on" : ""}${t.exited ? " dead" : ""}" data-id="${id}">
        <span class="dot"></span><span class="nm">${esc(t.title)}</span><i data-close="${id}" title="Close (Ctrl+Shift+W)">×</i></div>`).join("") +
      `<button class="term-tab add" data-act-term="new" title="New tab (Ctrl+Shift+T)">+</button>`;
    const t = tabs.get(active);
    $("term-info").innerHTML = t
      ? `<dl class="kv"><dt>Session</dt><dd>${esc(active.toUpperCase())}</dd><dt>Shell</dt><dd>${esc(t.shell)}</dd>
         <dt>PID</dt><dd>${t.pid}</dd><dt>Size</dt><dd>${t.term.cols}×${t.term.rows}</dd><dt>Status</dt><dd class="${t.exited ? "warn" : ""}">${t.exited ? "TERMINATED" : "LIVE"}</dd></dl>
         <div class="mono muted" style="font-size:11px;margin-top:8px;word-break:break-all">${esc(t.cwd || "")}</div>`
      : "No session.";
  }

  async function open({ cwd = null, command = null, title = null } = {}) {
    const host = document.createElement("div");
    host.className = "term-host";
    $("term-stack").appendChild(host);
    const term = new Terminal({
      fontFamily: '"JetBrains Mono", Hack, "Liberation Mono", monospace', fontSize, lineHeight: lineHeight(),
      cursorBlink: false, cursorStyle: "bar", allowTransparency: true, scrollback: 10000,
      theme: xtermTheme(), allowProposedApi: true, macOptionIsMeta: true,
    });
    const fit = new FitAddon.FitAddon();
    const search = new SearchAddon.SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(new WebLinksAddon.WebLinksAddon((e, uri) => API.call("open", { path: uri }).catch(() => {})));
    term.open(host);
    try { fit.fit(); } catch (e) {}
    let res;
    try { res = await API.call("term_open", { cols: term.cols, rows: term.rows, cwd, command, accent: HUD.C.replace(/,/g, ";"), skin: HUD.theme.skin }); }
    catch (e) { term.write("\x1b[31mFailed to start shell: " + e.message + "\x1b[0m"); return; }
    const t = { term, fit, search, el: host, title: title || res.shell, shell: res.shell, pid: res.pid, cwd: res.cwd, exited: false };
    tabs.set(res.id, t);
    term.onData((d) => API.ptyWrite(res.id, d));
    term.onResize(({ cols, rows }) => { API.ptyResize(res.id, cols, rows); renderTabs(); });
    term.onTitleChange((s) => { t.title = s.length > 28 ? "…" + s.slice(-27) : s; renderTabs(); });
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      const k = e.key.toLowerCase();
      if (e.ctrlKey && e.shiftKey && k === "c") { copySel(); return false; }
      if (e.ctrlKey && e.shiftKey && k === "v") { paste(); return false; }
      if (e.ctrlKey && e.shiftKey && k === "t") { open({ cwd: t.cwd }); return false; }
      if (e.ctrlKey && e.shiftKey && k === "w") { close(res.id); return false; }
      if (e.ctrlKey && e.shiftKey && k === "f") { $("term-find").focus(); return false; }
      if (e.ctrlKey && (k === "=" || k === "+")) { zoom(1); return false; }
      if (e.ctrlKey && k === "-") { zoom(-1); return false; }
      if (e.ctrlKey && e.key === "PageDown") { cycle(1); return false; }
      if (e.ctrlKey && e.key === "PageUp") { cycle(-1); return false; }
      if (e.ctrlKey && /^[0-9]$/.test(e.key)) return false;   // menu shortcuts
      if (e.ctrlKey && e.code === "Space") return false;      // push-to-talk
      return true;
    });
    select(res.id);
    return res.id;
  }

  function select(id) {
    if (!tabs.has(id)) return;
    active = id;
    tabs.forEach((t, k) => t.el.classList.toggle("on", k === id));
    const t = tabs.get(id);
    requestAnimationFrame(() => { try { t.fit.fit(); } catch (e) {} t.term.focus(); });
    renderTabs();
  }

  async function close(id) {
    const t = tabs.get(id);
    if (!t) return;
    if (!t.exited) await API.call("term_close", { id }).catch(() => {});
    t.term.dispose();
    t.el.remove();
    tabs.delete(id);
    if (active === id) {
      const next = [...tabs.keys()].pop();
      if (next) select(next); else { active = null; renderTabs(); }
    } else renderTabs();
  }

  function cycle(d) {
    const ids = [...tabs.keys()];
    if (!ids.length) return;
    select(ids[(ids.indexOf(active) + d + ids.length) % ids.length]);
  }

  function zoom(d) {
    fontSize = Math.max(9, Math.min(28, fontSize + d));
    try { localStorage.setItem("jarvis.term.font", fontSize); } catch (e) {}
    tabs.forEach((t) => { t.term.options.fontSize = fontSize; try { t.fit.fit(); } catch (e) {} });
    $("term-font").textContent = fontSize + "px";
  }

  async function copySel() {
    const t = tabs.get(active);
    const s = t && t.term.getSelection();
    if (!s) return;
    try { await navigator.clipboard.writeText(s); } catch (e) {
      const ta = document.createElement("textarea"); ta.value = s; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
    }
    HUD.toast("COPIED " + s.length + " CHARACTERS");
  }
  async function paste() {
    const t = tabs.get(active);
    if (!t) return;
    try { const s = await navigator.clipboard.readText(); if (s) t.term.paste(s); } catch (e) { HUD.toast("Clipboard read blocked - use Shift+Insert", true); }
  }

  /* run a command line in the active session (or a fresh one) */
  async function run(cmd, { newTab = false, cwd = null } = {}) {
    J.show("terminal");
    let id = active;
    if (newTab || !id || tabs.get(id).exited) id = await open({ cwd });
    if (!id) return;
    setTimeout(() => API.ptyWrite(id, cmd + "\r"), newTab ? 350 : 0);
    tabs.get(id).term.focus();
  }

  API.onPty((id, data) => { const t = tabs.get(id); if (t) t.term.write(data); });
  API.onPtyExit((id, code) => {
    const t = tabs.get(id);
    if (!t) return;
    t.exited = true;
    t.term.write(`\r\n\x1b[38;2;${HUD.C.replace(/,/g, ";")}m[ ${HUD.str("who")} ] session terminated (exit ${code}). Press Enter to restart, Ctrl+Shift+W to close.\x1b[0m\r\n`);
    const sub = t.term.onData((d) => {
      if (d === "\r") { sub.dispose(); const cwd = t.cwd; close(id).then(() => open({ cwd })); }
    });
    renderTabs();
  });
  // open shells follow the theme too (jarvisrc.bash re-reads it; idle ones redraw at once)
  let sentStyle = "";
  HUD.onTheme(() => {
    const skin = HUD.theme.skin, accent = HUD.C.replace(/,/g, ";");
    if (sentStyle === skin + accent) return;
    sentStyle = skin + accent;
    API.call("term_style", { skin, accent }).catch(() => {});
  });
  HUD.onTheme(() => tabs.forEach((t) => {
    t.term.options.theme = xtermTheme();
    if (t.term.options.lineHeight !== lineHeight()) { t.term.options.lineHeight = lineHeight(); try { t.fit.fit(); } catch (e) {} }
  }));
  new ResizeObserver(() => { const t = tabs.get(active); if (t && t.el.offsetParent) { try { t.fit.fit(); } catch (e) {} } }).observe($("term-stack"));
  // refresh the cwd shown in the side panel
  setInterval(async () => {
    const t = tabs.get(active);
    if (!t || t.exited || !t.el.offsetParent) return;
    try { const c = await API.call("term_cwd", { id: active }); if (c && c !== t.cwd) { t.cwd = c; renderTabs(); } } catch (e) {}
  }, 2000);

  $("term-tabs").addEventListener("click", (e) => {
    const c = e.target.closest("[data-close]");
    if (c) { close(c.dataset.close); return; }
    if (e.target.closest("[data-act-term=new]")) { open({ cwd: tabs.get(active)?.cwd }); return; }
    const tab = e.target.closest(".term-tab[data-id]");
    if (tab) select(tab.dataset.id);
  });
  $("term-tabs").addEventListener("auxclick", (e) => { const tab = e.target.closest(".term-tab[data-id]"); if (tab && e.button === 1) close(tab.dataset.id); });
  let quick = QUICK();
  const drawQuick = () => {
    quick = QUICK();
    $("term-quick").innerHTML = quick.map(([l, c], i) => `<button data-q="${i}" title="${esc(c)}">› ${esc(l)}</button>`).join("");
  };
  drawQuick();
  API.call("distro").then((d) => { Object.assign(PKG, d.commands); distroName = (d.name || "system").split(" ")[0]; drawQuick(); }).catch(() => {});
  $("term-quick").addEventListener("click", (e) => { const b = e.target.closest("[data-q]"); if (b) run(quick[+b.dataset.q][1]); });
  document.getElementById("view-terminal").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tb]");
    if (!b) return;
    const a = b.dataset.tb, t = tabs.get(active);
    if (a === "zoom-in") zoom(1);
    else if (a === "zoom-out") zoom(-1);
    else if (a === "copy") copySel();
    else if (a === "paste") paste();
    else if (a === "clear" && t) { t.term.clear(); t.term.focus(); }
    else if (a === "files" && t) { J.show("files"); J.files.go(t.cwd); }
    else if (a === "konsole" && t) API.call("terminal", { path: t.cwd });
  });
  const find = $("term-find");
  find.addEventListener("keydown", (e) => {
    const t = tabs.get(active);
    if (!t) return;
    if (e.key === "Enter") { t.search[e.shiftKey ? "findPrevious" : "findNext"](find.value, { caseSensitive: false, decorations: { matchBackground: "#ffb02e66", activeMatchBackground: "#ffb02e", matchOverviewRuler: "#ffb02e", activeMatchColorOverviewRuler: "#ffb02e" } }); }
    if (e.key === "Escape") { find.value = ""; t.search.clearDecorations(); t.term.focus(); }
  });

  J.terminal = {
    open, run, close,
    onShow() {
      $("term-font").textContent = fontSize + "px";
      if (!tabs.size) open();
      else select(active || [...tabs.keys()][0]);
    },
    get sessions() { return tabs.size; },
  };
})();
