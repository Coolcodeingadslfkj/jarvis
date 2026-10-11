/* PROTOCOLS: macro cards, engage with live step feedback, and a step editor. */
(function () {
  const J = (window.JARVIS = window.JARVIS || {});
  const $ = (id) => document.getElementById(id);
  const esc = HUD.esc;
  let list = [], types = {}, appsCache = null;
  const running = new Set();
  const TAU = Math.PI * 2;

  // emblem per protocol icon, drawn on canvas
  function emblem(ctx, kind, w, h, t, active) {
    const C = HUD.C, s = Math.min(w, h), cx = w / 2, cy = h / 2;
    ctx.clearRect(0, 0, w, h);
    ctx.save(); ctx.translate(cx, cy);
    const spin = active ? t * 3 : t * 0.4;
    ctx.strokeStyle = `rgba(${C},0.5)`; ctx.lineWidth = s * 0.03;
    ctx.setLineDash([s * 0.12, s * 0.06]); ctx.rotate(spin);
    ctx.beginPath(); ctx.arc(0, 0, s * 0.44, 0, TAU); ctx.stroke(); ctx.setLineDash([]); ctx.rotate(-spin);
    ctx.strokeStyle = `rgba(${C},0.95)`; ctx.fillStyle = `rgba(${C},0.95)`; ctx.lineWidth = s * 0.045; ctx.lineCap = "round";
    const r = s * 0.22;
    switch (kind) {
      case "party":
        for (let i = 0; i < 5; i++) { const hh = r * (0.5 + 0.9 * Math.abs(Math.sin(t * 4 + i))); ctx.fillRect(-r + i * r * 0.45, r * 0.6 - hh, r * 0.28, hh); }
        break;
      case "focus":
        ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke(); ctx.beginPath(); ctx.arc(0, 0, r * 0.45, 0, TAU); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, 0, r * 0.12, 0, TAU); ctx.fill(); break;
      case "night":
        ctx.beginPath(); ctx.arc(0, 0, r, 0.7, TAU - 0.7); ctx.arc(r * 0.5, -r * 0.2, r * 0.8, TAU - 1.0, 1.0, true); ctx.stroke(); break;
      case "day":
        ctx.beginPath(); ctx.arc(0, 0, r * 0.55, 0, TAU); ctx.stroke();
        for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + t * 0.5; ctx.beginPath(); ctx.moveTo(Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8); ctx.lineTo(Math.cos(a) * r * 1.15, Math.sin(a) * r * 1.15); ctx.stroke(); }
        break;
      case "diag":
        ctx.beginPath(); ctx.moveTo(-r * 1.1, 0);
        for (let i = 0; i <= 20; i++) { const x = -r * 1.1 + (i / 20) * r * 2.2; ctx.lineTo(x, (i % 5 === 2 ? -r * 0.9 : i % 5 === 3 ? r * 0.6 : 0) * Math.sin(t * 2 + i)); }
        ctx.stroke(); break;
      case "clean":
        ctx.beginPath(); ctx.moveTo(-r * 0.7, -r * 0.6); ctx.lineTo(r * 0.7, -r * 0.6); ctx.lineTo(r * 0.5, r * 0.9); ctx.lineTo(-r * 0.5, r * 0.9); ctx.closePath(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-r * 0.9, -r * 0.6); ctx.lineTo(r * 0.9, -r * 0.6); ctx.stroke(); break;
      case "lock":
        ctx.strokeRect(-r * 0.7, -r * 0.1, r * 1.4, r * 1.0); ctx.beginPath(); ctx.arc(0, -r * 0.1, r * 0.45, Math.PI, 0); ctx.stroke(); break;
      default:
        HUD.drawReactor(ctx, 0, 0, r * 1.2, t, 1, active ? 1.2 : 0.9);
    }
    ctx.restore();
  }

  HUD.loop((dt, t) => {
    if (!$("view-protocols").classList.contains("active") && !document.querySelector("#home-protos canvas")) return;
    document.querySelectorAll(".proto canvas[data-icon]").forEach((c) => {
      const { w, h } = HUD.fit(c);
      emblem(c.getContext("2d"), c.dataset.icon, w, h, t, running.has(c.dataset.id));
    });
  });

  function summary(step) {
    const ty = types[step.type] || { label: step.type };
    let v = step.value;
    if (typeof v === "boolean") v = v ? "on" : "off";
    if (step.type === "launch" && appsCache) { const a = appsCache.find((x) => x.id === v); if (a) v = a.name; }
    return `${ty.label}${v !== undefined && v !== "" ? ": " + String(v).slice(0, 70) : ""}`;
  }

  function render() {
    $("proto-grid").innerHTML = list.map((p) => `<div class="panel proto${running.has(p.id) ? " running" : ""}" data-id="${esc(p.id)}">
      <div class="ph"><canvas data-icon="${esc(p.icon || "custom")}" data-id="${esc(p.id)}"></canvas>
        <div><h3>${esc(p.name.toUpperCase())}</h3><small>${p.builtin ? "BUILT-IN" : "CUSTOM"} · ${p.steps.length} STEPS</small></div></div>
      <p>${esc(p.description || "")}</p>
      <ol>${p.steps.map((s, i) => `<li data-step="${i}">${esc(summary(s))}</li>`).join("")}</ol>
      <div class="pa"><button class="hud-btn primary" data-engage="${esc(p.id)}"><svg><use href="#i-shield"/></svg>ENGAGE</button>
        <button class="hud-btn" data-edit="${esc(p.id)}" title="Edit"><svg><use href="#i-rename"/></svg></button>
        <button class="hud-btn danger" data-del="${esc(p.id)}" title="Delete"><svg><use href="#i-trash"/></svg></button></div></div>`).join("");
  }

  async function load() {
    try { const r = await API.call("protocols"); list = r.protocols; types = r.steps; render(); } catch (e) { HUD.toast(e.message, true); }
  }

  async function engage(id) {
    const p = list.find((x) => x.id === id);
    running.add(id);
    render();
    HUD.toast(`${(p ? p.name : id).toUpperCase()} PROTOCOL ENGAGED`);
    try {
      const res = await API.call("protocol_run", { id });
      const bad = res.filter((r) => !r.ok);
      const card = document.querySelector(`.proto[data-id="${CSS.escape(id)}"]`);
      if (card) res.forEach((r, i) => { const li = card.querySelector(`[data-step="${i}"]`); if (li) li.className = r.ok ? "ok" : "bad"; });
      if (bad.length) HUD.toast(`${bad.length} step(s) failed: ${bad.map((b) => b.msg).join("; ")}`, true);
    } catch (e) { HUD.toast(e.message, true); }
    running.delete(id);
    setTimeout(() => document.querySelector(`.proto[data-id="${CSS.escape(id)}"]`)?.classList.remove("running"), 300);
  }

  // UI steps forwarded from Python while a protocol runs
  API.onEvent((ev) => {
    if (ev.type !== "protocol-ui") return;
    const v = ev.value;
    if (ev.step === "say") HUD.toast("J.A.R.V.I.S.: " + v);
    else if (ev.step === "command") J.terminal.run(v, { newTab: true });
    else if (ev.step === "theme") J.setTheme(v);
    else if (ev.step === "view") J.show(v);
    else if (ev.step === "power") J.power.ask(v);
  });

  // ------------------------------------------------------------ editor
  const ed = $("editor"), box = $("editor-box");
  let draft = null;
  async function edit(p) {
    if (!appsCache) { try { appsCache = await API.call("apps"); } catch (e) { appsCache = []; } }
    draft = JSON.parse(JSON.stringify(p || { name: "", description: "", icon: "custom", steps: [{ type: "say", value: "Protocol engaged, sir." }] }));
    drawEditor();
    ed.classList.add("show");
    setTimeout(() => box.querySelector("#pe-name").focus(), 50);
  }
  function valueInput(s, i) {
    const ty = types[s.type] || {};
    if (ty.arg === "bool") return `<select class="hud-input" data-v="${i}"><option value="true"${s.value === true ? " selected" : ""}>On</option><option value="false"${s.value === false ? " selected" : ""}>Off</option></select>`;
    if (ty.arg === "choice") return `<select class="hud-input" data-v="${i}">${ty.choices.map((c) => `<option${c === s.value ? " selected" : ""}>${c}</option>`).join("")}</select>`;
    if (ty.arg === "app") return `<select class="hud-input" data-v="${i}">${appsCache.map((a) => `<option value="${esc(a.id)}"${a.id === s.value ? " selected" : ""}>${esc(a.name)}</option>`).join("")}</select>`;
    if (ty.arg === "number") return `<input class="hud-input" type="number" data-v="${i}" value="${esc(s.value ?? "")}">`;
    return `<input class="hud-input" data-v="${i}" value="${esc(s.value ?? "")}" spellcheck="false">`;
  }
  function drawEditor() {
    const icons = ["custom", "party", "focus", "night", "day", "diag", "clean", "lock"];
    box.innerHTML = `<h2>${draft.id ? "EDIT" : "NEW"} PROTOCOL</h2>
      <label class="f">NAME (say "engage &lt;name&gt; protocol")</label><input class="hud-input" id="pe-name" value="${esc(draft.name)}">
      <label class="f">DESCRIPTION</label><input class="hud-input" id="pe-desc" value="${esc(draft.description || "")}">
      <label class="f">EMBLEM</label><select class="hud-input" id="pe-icon">${icons.map((i) => `<option${i === draft.icon ? " selected" : ""}>${i}</option>`).join("")}</select>
      <label class="f">STEPS</label>
      <div id="pe-steps">${draft.steps.map((s, i) => `<div class="step"><span class="n">${i + 1}</span>
        <select class="hud-input" data-t="${i}">${Object.entries(types).map(([k, v]) => `<option value="${k}"${k === s.type ? " selected" : ""}>${esc(v.label)}</option>`).join("")}</select>
        ${valueInput(s, i)}
        <div class="ops"><button data-up="${i}" title="Move up">↑</button><button data-down="${i}" title="Move down">↓</button><button data-rm="${i}" title="Remove">×</button></div></div>`).join("")}</div>
      <button class="hud-btn" id="pe-add" style="margin-top:8px"><svg><use href="#i-plus"/></svg>ADD STEP</button>
      <div class="modal-actions" style="margin-top:20px;justify-content:flex-end"><button class="hud-btn" id="pe-cancel">CANCEL</button>
        <button class="hud-btn" id="pe-test">SAVE &amp; ENGAGE</button><button class="hud-btn primary" id="pe-save">SAVE</button></div>`;
  }
  function collect() {
    draft.name = box.querySelector("#pe-name").value.trim();
    draft.description = box.querySelector("#pe-desc").value.trim();
    draft.icon = box.querySelector("#pe-icon").value;
    box.querySelectorAll("[data-v]").forEach((el) => {
      const s = draft.steps[+el.dataset.v], ty = types[s.type] || {};
      s.value = ty.arg === "bool" ? el.value === "true" : ty.arg === "number" ? +el.value : el.value;
    });
  }
  box.addEventListener("change", (e) => {
    const t = e.target.closest("[data-t]");
    if (t) { collect(); const s = draft.steps[+t.dataset.t]; s.type = t.value; const ty = types[s.type]; s.value = ty.arg === "bool" ? true : ty.arg === "choice" ? ty.choices[0] : ty.arg === "app" ? (appsCache[0] || {}).id : ty.arg === "number" ? 50 : ""; drawEditor(); }
  });
  box.addEventListener("click", async (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.id === "pe-cancel") { ed.classList.remove("show"); return; }
    collect();
    if (b.id === "pe-add") { draft.steps.push({ type: "say", value: "" }); drawEditor(); return; }
    if (b.dataset.rm !== undefined) { draft.steps.splice(+b.dataset.rm, 1); drawEditor(); return; }
    if (b.dataset.up !== undefined) { const i = +b.dataset.up; if (i > 0) [draft.steps[i - 1], draft.steps[i]] = [draft.steps[i], draft.steps[i - 1]]; drawEditor(); return; }
    if (b.dataset.down !== undefined) { const i = +b.dataset.down; if (i < draft.steps.length - 1) [draft.steps[i + 1], draft.steps[i]] = [draft.steps[i], draft.steps[i + 1]]; drawEditor(); return; }
    if (b.id === "pe-save" || b.id === "pe-test") {
      if (!draft.name) { HUD.toast("Give the protocol a name", true); return; }
      try {
        const saved = await API.call("protocol_save", { proto: draft });
        ed.classList.remove("show");
        await load();
        HUD.toast("PROTOCOL SAVED");
        if (b.id === "pe-test") engage(saved.id);
      } catch (err) { HUD.toast(err.message, true); }
    }
  });
  ed.addEventListener("mousedown", (e) => { if (e.target === ed) ed.classList.remove("show"); });

  $("proto-grid").addEventListener("click", async (e) => {
    const g = e.target.closest("[data-engage]"), ed2 = e.target.closest("[data-edit]"), d = e.target.closest("[data-del]");
    if (g) engage(g.dataset.engage);
    else if (ed2) edit(list.find((p) => p.id === ed2.dataset.edit));
    else if (d) {
      const p = list.find((x) => x.id === d.dataset.del);
      if (await J.modal({ title: "DELETE PROTOCOL", text: `Delete "${p.name}"?`, confirm: "DELETE", danger: true })) {
        await API.call("protocol_delete", { id: p.id }); load();
      }
    }
  });
  $("proto-new").addEventListener("click", () => edit(null));
  $("proto-restore").addEventListener("click", async () => { await API.call("protocol_restore"); load(); HUD.toast("DEFAULT PROTOCOLS RESTORED"); });

  J.protocols = {
    onShow: load,
    engage: async (id) => { if (!list.length) await load(); const p = list.find((x) => x.id === id) || list.find((x) => x.name.toLowerCase() === String(id).toLowerCase()); engage(p ? p.id : id); },
    editorOpen: () => ed.classList.contains("show"),
  };
})();
