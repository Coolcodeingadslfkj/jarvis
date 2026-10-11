/* JARVIS console: talk to the assistant. */
(function () {
  const J = (window.JARVIS = window.JARVIS || {});
  const $ = (id) => document.getElementById(id);
  const orb = new HUD.Reactor($("voice-orb"));
  const log = $("log");
  const input = $("console-in");
  const hist = [];
  let hi = 0;
  let typing = Promise.resolve();

  const SUGGEST = ["status", "temps", "gpu", "battery", "processes", "open downloads", "find .pdf",
    "launch firefox", "open dolphin", "disk", "network", "uptime", "lock", "sleep", "help"];
  $("suggest").innerHTML = SUGGEST.map((s) => `<button data-cmd="${HUD.esc(s)}">› ${HUD.esc(s)}</button>`).join("");
  $("suggest").addEventListener("click", (e) => { const b = e.target.closest("[data-cmd]"); if (b) run(b.dataset.cmd); });

  function add(who, text, cls = "") {
    const d = document.createElement("div");
    d.className = `msg ${who} ${cls}`;
    d.innerHTML = `<div class="who">${who === "user" ? "YOU" : HUD.esc(HUD.str("who"))}</div><div class="txt"></div>`;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    return d.lastElementChild;
  }

  function typeOut(el, text) {
    typing = typing.then(() => new Promise((res) => {
      el.classList.add("cursor");
      let i = 0;
      const speed = Math.max(1, Math.ceil(text.length / 160));
      orb.level = 1;
      const iv = setInterval(() => {
        i += speed;
        el.textContent = text.slice(0, i);
        log.scrollTop = log.scrollHeight;
        if (i >= text.length) { clearInterval(iv); el.classList.remove("cursor"); orb.level = 0; res(); }
      }, 12);
    }));
    return typing;
  }

  function say(text, cls, speech) {
    if (!text) return Promise.resolve();
    const el = add("jarvis", "", cls);
    // multi-line replies (tables, lists) are summarised by their first line unless a speech text is given;
    // an empty speech text means the reply is voiced elsewhere (protocol steps, a new skin's intro)
    API.speak(speech ?? (text.includes("\n") ? text.split("\n")[0] : text));
    return typeOut(el, text);
  }

  async function run(text, opts = {}) {
    text = (text || "").trim();
    if (!text) return;
    hist.push(text); hi = hist.length;
    add("user", "").textContent = text;
    input.value = "";
    let res;
    try { res = await API.call("command", { text }); } catch (e) { say("Error: " + e.message, "err"); return; }
    const a = res.action;
    if (a && a.type === "clear") { log.innerHTML = ""; return; }
    const typed = say(res.reply, "", res.speech);
    if (!opts.spoken) await typed;
    handleAction(a);
    return res.reply;
  }

  async function handleAction(a) {
    if (!a) return;
    if (a.type === "navigate") {
      setTimeout(() => {
        J.show(a.view);
        if (a.view === "files" && a.search) J.files.search(a.search, a.path);
        else if (a.view === "files" && a.path) J.files.go(a.path);
      }, 500);
    } else if (a.type === "power") {
      J.power.ask(a.action);
    } else if (a.type === "kill") {
      const ok = await J.processes.kill(a.pids, a.name, false);
      say(ok ? `Termination signal sent to ${a.name}.` : "Termination aborted.");
    } else if (a.type === "terminal") {
      J.terminal.run(a.command, { newTab: true, cwd: a.cwd || null });
    } else if (a.type === "protocol") {
      J.protocols.engage(a.name);
    } else if (a.type === "dnd") {
      API.call("dnd", { enabled: a.enabled });
    } else if (a.type === "theme") {
      J.setTheme(a.mode);
    } else if (a.type === "skin") {
      J.setSkin(a.skin);
    } else if (a.type === "duet") {
      J.dance.duet(a.on);
    } else if (a.type === "hina") {
      J.hina.action(a);
    } else if (a.type === "refresh") {
      if (J[a.view] && J[a.view].refresh) J[a.view].refresh();
    }
  }

  $("console-form").addEventListener("submit", (e) => { e.preventDefault(); run(input.value); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp" && hi > 0) { input.value = hist[--hi]; e.preventDefault(); }
    else if (e.key === "ArrowDown") { hi = Math.min(hist.length, hi + 1); input.value = hist[hi] || ""; e.preventDefault(); }
  });

  // The opening greeting speaks for the current theme; when the theme changes it's rewritten in the
  // new character's words (unless the log was cleared). Printed only: the spoken briefing is app.js's.
  let greeted = null, greetedSkin = null;
  function writeGreeting() {
    const h = new Date().getHours();
    const g = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
    $("console-greet").textContent = `${g}${greeted.user ? ", " + greeted.user : ""}. ${HUD.str("assist")}`;
    greetedSkin = HUD.theme.skin;
    if (!greeted.el.isConnected) return;
    greeted.el.previousElementSibling.textContent = HUD.str("who");
    greeted.el.textContent = "";
    typeOut(greeted.el, `${g}, ${HUD.str("address")}. ${HUD.str("online")} Type or say "help" to see what I can do - press Ctrl+Space to talk.`);
  }
  HUD.onTheme((th) => { if (greeted && th.skin !== greetedSkin) writeGreeting(); });

  J.console = {
    run, say,
    greet(user) {
      greeted = { user, el: add("jarvis", "") };
      writeGreeting();
    },
    onShow() { setTimeout(() => input.focus(), 50); },
    setHelp(t) { $("help-text").textContent = t; },
  };
  $("help-text").textContent = [
    "status        full systems report",
    "cpu / gpu / ram / temps",
    "battery · disk · network",
    "open <folder|file|app|url>",
    "files <folder>",
    "find <name>",
    "launch <app>",
    "processes · kill <name>",
    "lock · sleep · hibernate",
    "restart · shut down · log out",
    "time · date · uptime · clear",
    "",
    "↑ / ↓ recalls previous commands.",
    "Ctrl+1…5 switches menus, F11 fullscreen.",
  ].join("\n");
})();
