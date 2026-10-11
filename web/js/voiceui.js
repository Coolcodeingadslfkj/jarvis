/* Voice interaction overlay: push-to-talk (Ctrl+Space / mic buttons) and the "Jarvis" wake word. */
(function () {
  const J = (window.JARVIS = window.JARVIS || {});
  const $ = (id) => document.getElementById(id);
  const ov = $("voice-overlay");
  const canvas = $("voice-canvas");
  const ctx = canvas.getContext("2d");
  let state = "idle", level = 0, shown = 0, hideTimer = null;

  function show(on) {
    clearTimeout(hideTimer);
    ov.classList.toggle("show", on);
  }
  function setState(s) {
    state = s;
    document.querySelectorAll(".mic-btn").forEach((b) => b.classList.toggle("on", s === "listening"));
    $("voice-status").textContent = { listening: "LISTENING", thinking: "PROCESSING", speaking: "SPEAKING", idle: "STANDBY" }[s] || s;
    if (s === "listening") { $("voice-text").textContent = ""; $("voice-reply").textContent = ""; show(true); }
  }

  J.voice = {
    available: false,
    listen() {
      if (!J.voice.available) { HUD.toast("Voice recognition unavailable - run ./install.sh", true); return; }
      if (state === "listening") { API.stopListening(); return; }
      API.stopSpeaking();
      // the user explicitly asked to talk: make sure the default mic isn't muted
      API.call("mic_ready").then((changed) => { if (changed) HUD.toast("MICROPHONE UNMUTED FOR VOICE INPUT"); }).catch(() => {}).finally(() => API.listen());
    },
  };

  API.onVoice("state", setState);
  API.onVoice("level", (v) => (level = v));
  API.onVoice("partial", (t) => { $("voice-text").textContent = t; });
  API.onVoice("wake", () => { HUD.toast("WAKE WORD DETECTED"); J.voice.listen(); });
  API.onVoice("heard", async (text) => {
    if (!text) {
      $("voice-text").textContent = "…";
      $("voice-reply").textContent = HUD.str("pardon");
      hideTimer = setTimeout(() => show(false), 1800);
      return;
    }
    $("voice-text").textContent = "“" + text + "”";
    const reply = await J.console.run(text, { spoken: true });
    $("voice-reply").textContent = (reply || "").split("\n")[0];
    setState("idle");
    hideTimer = setTimeout(() => show(false), 3500);
  });
  ov.addEventListener("click", (e) => { if (e.target === ov) { API.stopListening(); show(false); } });
  document.addEventListener("click", (e) => { if (e.target.closest(".mic-btn")) J.voice.listen(); });

  HUD.loop((dt, t) => {
    if (!ov.classList.contains("show")) return;
    const { w, h, dpr } = HUD.fit(canvas);
    const s = Math.min(w, h), cx = w / 2, cy = h / 2;
    shown += (level - shown) * Math.min(1, dt * 12);
    ctx.clearRect(0, 0, w, h);
    const rgb = HUD.C;
    // reactive spectrum ring
    const n = 72, R = s * 0.3;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + t * 0.4;
      const wob = state === "listening" ? shown * (0.5 + 0.5 * Math.sin(i * 1.7 + t * 9)) : state === "speaking" ? 0.35 * (0.5 + 0.5 * Math.sin(i * 0.9 + t * 7)) : 0.05;
      const L = s * (0.03 + 0.16 * wob);
      ctx.strokeStyle = `rgba(${rgb},${0.35 + 0.65 * wob})`;
      ctx.lineWidth = 3 * dpr;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      ctx.lineTo(cx + Math.cos(a) * (R + L), cy + Math.sin(a) * (R + L));
      ctx.stroke();
    }
    ctx.strokeStyle = `rgba(${rgb},0.5)`; ctx.lineWidth = 1.5 * dpr;
    ctx.setLineDash([6 * dpr, 6 * dpr]);
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.86, t, t + Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    HUD.drawReactor(ctx, cx, cy, R * 0.6, t * (state === "thinking" ? 4 : 1), dpr, 0.85 + shown * 0.4);
  });

  API.call("info").then((i) => {
    J.voice.available = !!i.stt;
    document.querySelectorAll(".mic-btn").forEach((b) => (b.style.display = i.stt ? "" : "none"));
  }).catch(() => {});
})();
