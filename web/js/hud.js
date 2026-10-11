/* Shared HUD drawing primitives: gauges, sparklines, reactor core, background. */
(function () {
  // Canvas palette (rgb triplets as "r,g,b"); reassigned by HUD.applyTheme().
  let C = "0,225,255", WARN = "255,176,46", CRIT = "255,61,85", ALT = "120,170,255";
  let CORE1 = "230,255,255", CORE2 = "120,240,255", PLATE = "2,12,18", NODE = "200,255,255";
  // Canvas fonts; follow the skin (HUD.applyTheme()).
  let FD = "Orbitron", FM = "ShareTech", SKIN = "jarvis", OK = "61,255,181";
  const TAU = Math.PI * 2;

  const cfg = { warn: 75, crit: 90 };

  const HUD = {
    cfg,
    get FD() { return FD; }, get FM() { return FM; },
    get C() { return C; }, get OK() { return OK; }, get WARN() { return WARN; }, get CRIT() { return CRIT; }, get ALT() { return ALT; },
    /* series colours may be given by name so they follow theme changes */
    rgb(v) { return v === "warn" ? WARN : v === "crit" ? CRIT : v === "alt" ? ALT : v || C; },
    fmtBytes(n, d = 1) {
      n = Number(n) || 0;
      const u = ["B", "KB", "MB", "GB", "TB", "PB"];
      let i = 0;
      while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
      return (i === 0 ? n.toFixed(0) : n.toFixed(d)) + " " + u[i];
    },
    fmtRate(n) { return HUD.fmtBytes(n) + "/s"; },
    fmtDur(s) {
      s = Math.max(0, Math.floor(s || 0));
      const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
      return d ? `${d}d ${h}h ${m}m` : h ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
    },
    fmtTemp(t) { return t == null ? "--" : `${Math.round(t)}°C`; },
    tempLevel(t) { return t == null ? "" : t >= cfg.crit ? "crit" : t >= cfg.warn ? "warn" : ""; },
    pctLevel(p) { return p >= 90 ? "crit" : p >= 75 ? "warn" : ""; },
    rgbFor(level) { return level === "crit" ? CRIT : level === "warn" ? WARN : C; },
    esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); },
    isTyping(e) { const t = e.target; return !!(t && t.matches && t.matches("input, textarea, select")); },
    icon(name, cls = "") { return `<svg class="${cls}"><use href="#i-${name}"/></svg>`; },
  };

  // ------------------------------------------------------------ render loop
  // Every animated frame is costly for QtWebEngine's compositor here, so all canvases share
  // one capped loop. HUD.setFps() lowers it (e.g. on battery).
  const loops = new Set();
  let frameMs = 1000 / 20;
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    if (now - last < frameMs - 2) return;
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    if (!document.hidden) loops.forEach((fn) => { try { fn(dt, now / 1000); } catch (e) { console.error(e.stack || e); loops.delete(fn); } });
  }
  requestAnimationFrame(frame);
  HUD.setFps = (fps) => { frameMs = 1000 / Math.max(2, Math.min(60, fps || 20)); };
  HUD.getFps = () => Math.round(1000 / frameMs);
  HUD.loop = (fn) => { loops.add(fn); return () => loops.delete(fn); };

  function fit(canvas) {
    // NB: every canvas needs a CSS size; otherwise clientWidth follows the backing store and
    // the canvas grows every frame.
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    return { w, h, dpr };
  }
  HUD.fit = fit;
  const visible = (el) => el.offsetParent !== null;

  // ------------------------------------------------------------ ring gauge
  class RingGauge {
    constructor(canvas, { label = "", unit = "%", sub = "" } = {}) {
      this.c = canvas; this.ctx = canvas.getContext("2d");
      this.label = label; this.unit = unit; this.sub = sub;
      this.value = 0; this.shown = 0; this.temp = null; this.level = ""; this.text = null;
      this.rot = Math.random() * TAU;
      HUD.loop((dt) => this.draw(dt));
    }
    set(value, { temp = null, sub = null, level = null, text = null } = {}) {
      this.value = Math.max(0, Math.min(100, Number(value) || 0));
      this.temp = temp;
      if (sub !== null) this.sub = sub;
      this.level = level ?? HUD.pctLevel(this.value);
      this.text = text;
    }
    draw(dt) {
      if (!visible(this.c)) return;
      const { w, h, dpr } = fit(this.c);
      const ctx = this.ctx, s = Math.min(w, h), cx = w / 2, cy = h / 2;
      this.shown += (this.value - this.shown) * Math.min(1, dt * 4);
      this.rot += dt * 0.35;
      const rgb = HUD.rgbFor(this.level);
      ctx.clearRect(0, 0, w, h);
      if (SKIN === "doom") { this.drawBlocks(ctx, w, h, dpr, rgb); return; }
      if (SKIN === "asahina") { this.drawWater(ctx, w, h, dpr, this.level ? rgb : ALT); return; }
      ctx.save(); ctx.translate(cx, cy);
      const R = s * 0.46;

      // outer tick ring (rotating)
      ctx.save(); ctx.rotate(this.rot * 0.4);
      for (let i = 0; i < 72; i++) {
        const a = (i / 72) * TAU, long = i % 6 === 0;
        ctx.strokeStyle = `rgba(${C},${long ? 0.7 : 0.25})`;
        ctx.lineWidth = 1 * dpr;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * R, Math.sin(a) * R);
        ctx.lineTo(Math.cos(a) * (R - (long ? 9 : 4) * dpr), Math.sin(a) * (R - (long ? 9 : 4) * dpr));
        ctx.stroke();
      }
      ctx.restore();

      // counter-rotating dashed ring
      ctx.save(); ctx.rotate(-this.rot);
      ctx.strokeStyle = `rgba(${C},0.35)`; ctx.lineWidth = 2 * dpr;
      ctx.setLineDash([14 * dpr, 8 * dpr, 3 * dpr, 8 * dpr]);
      ctx.beginPath(); ctx.arc(0, 0, R * 0.9, 0, TAU); ctx.stroke();
      ctx.restore();

      // value track + segmented arc
      const r = R * 0.76, lw = R * 0.13;
      const start = -Math.PI * 0.75, span = Math.PI * 1.5;
      ctx.lineWidth = lw; ctx.lineCap = "butt";
      ctx.strokeStyle = `rgba(${C},0.08)`;
      ctx.beginPath(); ctx.arc(0, 0, r, start, start + span); ctx.stroke();
      const segs = 40, gap = 0.012;
      const filled = (this.shown / 100) * segs;
      // cheap glow: one wide translucent halo arc under the segments (shadowBlur is too slow here)
      if (filled > 0) {
        ctx.lineWidth = lw * 1.9; ctx.strokeStyle = `rgba(${rgb},0.12)`;
        ctx.beginPath(); ctx.arc(0, 0, r, start, start + span * (this.shown / 100)); ctx.stroke();
        ctx.lineWidth = lw;
      }
      for (let i = 0; i < segs; i++) {
        const a0 = start + (i / segs) * span + gap, a1 = start + ((i + 1) / segs) * span - gap;
        const f = Math.max(0, Math.min(1, filled - i));
        if (f <= 0) break;
        ctx.strokeStyle = `rgba(${rgb},${0.45 + 0.55 * (i / segs)})`;
        ctx.beginPath(); ctx.arc(0, 0, r, a0, a0 + (a1 - a0) * f); ctx.stroke();
      }

      // temperature inner arc (0..100 °C)
      if (this.temp != null) {
        const tr = R * 0.6, tl = HUD.tempLevel(this.temp), trgb = HUD.rgbFor(tl);
        ctx.lineWidth = 3 * dpr;
        ctx.strokeStyle = `rgba(${C},0.1)`;
        ctx.beginPath(); ctx.arc(0, 0, tr, start, start + span); ctx.stroke();
        ctx.strokeStyle = `rgba(${trgb},0.95)`;
        ctx.beginPath(); ctx.arc(0, 0, tr, start, start + span * Math.min(1, this.temp / 100)); ctx.stroke();
      }

      // needle marker
      const na = start + span * (this.shown / 100);
      ctx.fillStyle = `rgba(${rgb},1)`;
      ctx.beginPath(); ctx.arc(Math.cos(na) * (r + lw * 0.85), Math.sin(na) * (r + lw * 0.85), 3 * dpr, 0, TAU); ctx.fill();

      // text
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = `rgba(${rgb},1)`; ctx.shadowColor = `rgba(${rgb},.8)`; ctx.shadowBlur = 8 * dpr;
      ctx.font = `700 ${Math.round(s * 0.2)}px ${FD}`;
      const txt = this.text ?? Math.round(this.shown) + "";
      ctx.fillText(txt, 0, -s * 0.03);
      ctx.shadowBlur = 0;
      if (this.text == null && this.unit) {
        ctx.font = `600 ${Math.round(s * 0.07)}px ${FD}`;
        ctx.fillStyle = `rgba(${C},.7)`;
        ctx.fillText(this.unit, 0, s * 0.1);
      }
      ctx.font = `${Math.round(s * 0.065)}px ${FM}`;
      ctx.fillStyle = `rgba(${C},.8)`;
      ctx.fillText(this.label, 0, s * 0.3);
      if (this.c.clientWidth < 150) { /* small gauge: no room for the sub line */ }
      else if (this.temp != null) {
        ctx.fillStyle = `rgba(${HUD.rgbFor(HUD.tempLevel(this.temp))},1)`;
        ctx.fillText(Math.round(this.temp) + "°C", 0, s * 0.19);
      } else if (this.sub) {
        ctx.fillStyle = `rgba(${C},.6)`;
        ctx.fillText(this.sub, 0, s * 0.19);
      }
      ctx.restore();
    }
  }
  // DOOM: a 90s text-mode meter - big readout over a row of block cells
  RingGauge.prototype.drawBlocks = function (ctx, w, h, dpr, rgb) {
    const s = Math.min(w, h), x0 = (w - s) / 2, y0 = (h - s) / 2;
    ctx.save(); ctx.translate(x0, y0);
    ctx.strokeStyle = `rgba(${C},0.5)`; ctx.lineWidth = 1 * dpr;
    ctx.strokeRect(0.5 * dpr, 0.5 * dpr, s - dpr, s - dpr);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = `rgba(${rgb},1)`;
    ctx.font = `${Math.round(s * 0.36)}px ${FD}`;
    ctx.fillText((this.text ?? Math.round(this.shown)) + (this.text == null && this.unit === "%" ? "%" : ""), s / 2, s * 0.32);
    // 10 cells, each lit cell a solid block
    const n = 10, pad = s * 0.08, gap = s * 0.018, cw = (s - pad * 2 - gap * (n - 1)) / n, ch = s * 0.13, cy = s * 0.56;
    const lit = (this.shown / 100) * n;
    for (let i = 0; i < n; i++) {
      const f = Math.max(0, Math.min(1, lit - i));
      ctx.fillStyle = `rgba(${C},0.12)`; ctx.fillRect(pad + i * (cw + gap), cy, cw, ch);
      if (f > 0) { ctx.fillStyle = `rgba(${rgb},${0.55 + 0.45 * f})`; ctx.fillRect(pad + i * (cw + gap), cy, cw * f, ch); }
    }
    ctx.font = `${Math.round(s * 0.11)}px ${FM}`;
    ctx.fillStyle = `rgba(${C},.85)`;
    ctx.fillText(this.label, s / 2, s * 0.82);
    if (this.temp != null && this.c.clientWidth >= 150) {
      ctx.fillStyle = `rgba(${HUD.rgbFor(HUD.tempLevel(this.temp))},1)`;
      ctx.fillText(`TEMP ${Math.round(this.temp)}C`, s / 2, s * 0.93);
    }
    ctx.restore();
  };
  // Asahina: a round pool window filling with water; the surface rolls, bubbles rise
  RingGauge.prototype.drawWater = function (ctx, w, h, dpr, rgb) {
    const s = Math.min(w, h), cx = w / 2, cy = h / 2, R = s * 0.44, t = performance.now() / 1000;
    this.bubbles = this.bubbles || Array.from({ length: 7 }, () => ({ x: Math.random() * 2 - 1, y: Math.random(), v: 0.15 + Math.random() * 0.25, r: 0.015 + Math.random() * 0.03 }));
    ctx.save();
    ctx.fillStyle = `rgba(${PLATE},0.85)`;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill();
    // water, clipped to the window
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.94, 0, TAU); ctx.clip();
    const level = cy + R - (this.shown / 100) * R * 2, amp = R * 0.05;
    const wave = (back) => {
      ctx.beginPath(); ctx.moveTo(cx - R, cy + R);
      for (let x = -R; x <= R; x += R / 12) {
        const ph = back ? t * 1.7 + 1.3 : t * 2.4;
        ctx.lineTo(cx + x, level + Math.sin(x / R * 5 + ph) * amp * (back ? 0.8 : 1));
      }
      ctx.lineTo(cx + R, cy + R); ctx.closePath();
    };
    ctx.fillStyle = `rgba(${rgb},0.28)`; wave(true); ctx.fill();
    const g = ctx.createLinearGradient(0, level - amp, 0, cy + R);
    g.addColorStop(0, `rgba(${rgb},0.85)`); g.addColorStop(1, `rgba(${rgb},0.35)`);
    ctx.fillStyle = g; wave(false); ctx.fill();
    for (const b of this.bubbles) {
      b.y += b.v * 0.016; if (b.y > 1) { b.y = 0; b.x = Math.random() * 2 - 1; }
      const by = cy + R - b.y * R * 2;
      if (by < level + amp) continue;
      ctx.strokeStyle = `rgba(${CORE1},0.55)`; ctx.lineWidth = Math.max(1, dpr);
      ctx.beginPath(); ctx.arc(cx + b.x * R * 0.7 + Math.sin(t * 3 + b.x * 9) * R * 0.03, by, b.r * R * 2, 0, TAU); ctx.stroke();
    }
    ctx.restore();
    // rim: red and white like a life ring
    const lw = R * 0.09;
    ctx.lineWidth = lw;
    for (let i = 0; i < 8; i++) {
      ctx.strokeStyle = i % 2 ? `rgba(${CORE1},0.9)` : `rgba(${C},0.95)`;
      ctx.beginPath(); ctx.arc(cx, cy, R, (i / 8) * TAU + 0.05, ((i + 1) / 8) * TAU - 0.05); ctx.stroke();
    }
    // readout, outlined so it reads over water and air alike
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
    ctx.font = `${Math.round(s * 0.2)}px ${FD}`;
    const txt = (this.text ?? Math.round(this.shown)) + (this.text == null && this.unit === "%" ? "%" : "");
    ctx.lineWidth = s * 0.03; ctx.strokeStyle = `rgba(${PLATE},0.9)`; ctx.strokeText(txt, cx, cy - s * 0.04);
    ctx.fillStyle = `rgba(${CORE1},1)`; ctx.fillText(txt, cx, cy - s * 0.04);
    ctx.font = `600 ${Math.round(s * 0.075)}px ${FM}`;
    ctx.lineWidth = s * 0.022;
    ctx.strokeText(this.label, cx, cy + s * 0.13); ctx.fillText(this.label, cx, cy + s * 0.13);
    if (this.c.clientWidth >= 150 && (this.temp != null || this.sub)) {
      const sub = this.temp != null ? Math.round(this.temp) + "°C" : this.sub;
      ctx.fillStyle = this.temp != null ? `rgba(${HUD.rgbFor(HUD.tempLevel(this.temp))},1)` : `rgba(${CORE1},.8)`;
      ctx.strokeText(sub, cx, cy + s * 0.24); ctx.fillText(sub, cx, cy + s * 0.24);
    }
    ctx.restore();
  };
  HUD.RingGauge = RingGauge;

  // ------------------------------------------------------------ sparkline
  class Sparkline {
    /* series: [{key, rgb, max?, fill?}] ; data from history object */
    constructor(canvas, series, { max = 100, auto = false, label = "" } = {}) {
      this.c = canvas; this.ctx = canvas.getContext("2d");
      this.series = series; this.max = max; this.auto = auto; this.label = label; this.data = {};
      // Static between samples: redrawing once per data update keeps compositing cheap.
      this.dirty = true;
      HUD.onTheme(() => (this.dirty = true));
      HUD.loop(() => { if (this.dirty || this._w !== this.c.clientWidth) this.draw(); });
    }
    set(history) { this.data = history; this.dirty = true; }
    draw() {
      if (!visible(this.c)) return;
      this.dirty = false;
      this._w = this.c.clientWidth;
      const { w, h, dpr } = fit(this.c);
      const ctx = this.ctx;
      ctx.clearRect(0, 0, w, h);
      // grid
      ctx.strokeStyle = `rgba(${C},0.08)`; ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) { const y = (h * i) / 4; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      for (let i = 1; i < 12; i++) { const x = (w * i) / 12; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
      let max = this.max;
      if (this.auto) {
        max = 1;
        this.series.forEach((s) => (this.data[s.key] || []).forEach((v) => (max = Math.max(max, v))));
        max *= 1.15;
      }
      this.series.forEach((s, si) => {
        const arr = this.data[s.key] || [];
        if (arr.length < 2) return;
        const rgb = HUD.rgb(s.rgb);
        const pts = arr.map((v, i) => [(i / (arr.length - 1)) * w, h - 2 * dpr - (Math.min(v, max) / max) * (h - 6 * dpr)]);
        if (s.fill !== false) {
          const g = ctx.createLinearGradient(0, 0, 0, h);
          g.addColorStop(0, `rgba(${rgb},0.35)`); g.addColorStop(1, `rgba(${rgb},0)`);
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.moveTo(0, h);
          pts.forEach(([x, y]) => ctx.lineTo(x, y));
          ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
        }
        ctx.strokeStyle = `rgba(${rgb},0.95)`; ctx.lineWidth = 1.6 * dpr;
        ctx.shadowColor = `rgba(${rgb},1)`; ctx.shadowBlur = 6 * dpr;
        if (s.dash) ctx.setLineDash([4 * dpr, 4 * dpr]);
        ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
        ctx.setLineDash([]); ctx.shadowBlur = 0;
        const [lx, ly] = pts[pts.length - 1];
        ctx.fillStyle = `rgba(${rgb},1)`; ctx.beginPath(); ctx.arc(lx - 2 * dpr, ly, 2.5 * dpr, 0, TAU); ctx.fill();
      });
      if (this.label) {
        ctx.font = `${10 * dpr}px ${FM}`; ctx.fillStyle = `rgba(${C},.55)`; ctx.textAlign = "left"; ctx.textBaseline = "top";
        ctx.fillText(this.label, 4 * dpr, 3 * dpr);
      }
    }
  }
  HUD.Sparkline = Sparkline;

  // ------------------------------------------------------------ arc reactor / roulette wheel
  // The centrepiece of every skin: J.A.R.V.I.S. gets the arc reactor, Celestia a roulette wheel.
  function drawReactor(ctx, cx, cy, R, t, dpr, intensity = 1) {
    (SKIN === "celestia" ? drawRoulette : SKIN === "doom" ? drawDoomMask : SKIN === "asahina" ? drawDonut : drawArcReactor)(ctx, cx, cy, R, t, dpr, intensity);
  }

  // Asahina: a frosted donut with sprinkles. HUD.donutBites (0-3, set by js/hina.js) takes bites out of it.
  HUD.donutBites = 0;
  const SPRINKLES = Array.from({ length: 22 }, (_, i) => ({ a: (i / 22) * TAU + Math.sin(i * 7.3) * 0.2, r: 0.55 + 0.3 * ((i * 37) % 10) / 10, rot: i * 1.7, c: i % 4 }));
  function drawDonut(ctx, cx, cy, R, t, dpr, intensity = 1) {
    const k = Math.min(1, intensity);
    ctx.save(); ctx.translate(cx, cy);
    const g = ctx.createRadialGradient(0, 0, R * 0.5, 0, 0, R * 1.15);
    g.addColorStop(0, `rgba(${CORE2},${0.3 * k})`); g.addColorStop(1, `rgba(${CORE2},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, R * 1.15, 0, TAU); ctx.fill();
    ctx.rotate(t * 0.25);
    // bites come out of the rim; clipping to the rim keeps the bite circles from spilling outside
    ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.clip();
    const shape = (outer, hole) => {
      ctx.beginPath(); ctx.arc(0, 0, outer, 0, TAU); ctx.arc(0, 0, hole, 0, TAU, true);
      for (let i = 0; i < HUD.donutBites; i++) {
        const a = -0.6 + i * 0.55;
        ctx.moveTo(Math.cos(a) * R * 1.02 + R * 0.24, Math.sin(a) * R * 1.02);
        ctx.arc(Math.cos(a) * R * 1.02, Math.sin(a) * R * 1.02, R * 0.24, 0, TAU, true);
      }
    };
    ctx.fillStyle = `rgba(214,150,82,${k})`; shape(R, R * 0.34); ctx.fill("evenodd");
    // frosting: a wavy pink ring inside the dough
    ctx.save(); shape(R, R * 0.34); ctx.clip("evenodd");
    ctx.fillStyle = `rgba(${CORE2},${0.95 * k})`;
    ctx.beginPath();
    for (let i = 0; i <= 48; i++) {
      const a = (i / 48) * TAU, r = R * (0.86 + 0.05 * Math.sin(a * 7));
      ctx[i ? "lineTo" : "moveTo"](Math.cos(a) * r, Math.sin(a) * r);
    }
    for (let i = 48; i >= 0; i--) {
      const a = (i / 48) * TAU, r = R * (0.42 + 0.03 * Math.sin(a * 5 + 1));
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.fill();
    // shine and sprinkles
    ctx.strokeStyle = `rgba(${CORE1},${0.35 * k})`; ctx.lineWidth = R * 0.05; ctx.lineCap = "round";
    ctx.beginPath(); ctx.arc(0, 0, R * 0.7, -2.6, -1.7); ctx.stroke();
    const cols = [CORE1, ALT, "255,214,64", OK];
    ctx.lineWidth = Math.max(1, R * 0.045);
    for (const sp of SPRINKLES) {
      const x = Math.cos(sp.a) * R * sp.r, y = Math.sin(sp.a) * R * sp.r, d = R * 0.06;
      ctx.strokeStyle = `rgba(${cols[sp.c]},${k})`;
      ctx.beginPath(); ctx.moveTo(x - Math.cos(sp.rot) * d, y - Math.sin(sp.rot) * d); ctx.lineTo(x + Math.cos(sp.rot) * d, y + Math.sin(sp.rot) * d); ctx.stroke();
    }
    ctx.restore();
    ctx.restore();
  }

  // Hina as pixel art, sampled from reference/AoiReference.png (10 px per art pixel); the same image
  // is jarvis/shell/asahina.ans. K outline, H/h/L hair, S/s skin, R/r jacket, W/w top, B shorts, Y/G shoes.
  const HINA = [
    ".........KKK...........",
    "........KLHHKK.........",
    ".........KHHHHK........",
    "..........KLHHHK.......",
    ".........KLHHHHK.......",
    "........KHHHHHHK.......",
    "........KHHHHHK........",
    ".......KKKKKKKKK.......",
    ".....KKHhHHHHHHHKK.....",
    "....KHHHhHHHHHHHHHK....",
    "....KHHHhHhhhhhHHHK....",
    "...KHHHHhHHHHHHhHHHK...",
    "...KLHHHhHHHHHHHhHLK...",
    "...KHLLHhHHHHHHHLhHK...",
    "...KhHHWwhhHLLLLHHhK...",
    "...KhKHwhSShhhhHHHhK...",
    "...KKKhhSSSSSSShHHKK...",
    "...KSKsSKKSSSKKShHSK...",
    "...KSKsSKKSSSKKShHSK...",
    "....KKsSSSSSSSSShHK....",
    ".....KsSSSKKKSSShK.....",
    "......KsSSSSSSSsK......",
    ".....KRKKKKKKKKKRK.....",
    "......KRrKSSSKrRK......",
    ".....KRRRKSsSKRRRK.....",
    ".....KRKRKSsSKRKRK.....",
    ".....KRKWKWWWKWKRK.....",
    ".....KRKRKWWWKRKRK.....",
    ".....KSKKKBBBKKKSK.....",
    ".....KKKBBBBBBBKKK.....",
    ".......KSSKKKSSK.......",
    ".......KRrK.KSSK.......",
    ".......KYGK.KGYK.......",
    ".......KKKK.KKKK.......",
  ];
  const HINA_COLOURS = { K: "#000", H: "#795548", h: "#543a1c", L: "#a8988a", S: "#eac086", s: "#e0ac69", R: "#f44336",
    r: "#a61515", W: "#fff", w: "#d9d9d9", B: "#607d8b", Y: "#cddc39", G: "#8bc34a" };
  HUD.HINA = HINA;

  // Celestia as pixel art, sampled from reference/Celestia_Reference.jpg (10 px per art pixel; the red
  // background flood-filled away from the edges). K outline, D/M/G drill curls and hair, L headdress
  // and lace, W skin, E eyes, tie and soles.
  const CELESTIA = [
    "...........KKKKKKKKK...........",
    "..KKKKKKK.KLLLLLLLLLK.KKKKKKK..",
    ".KDGMMMMDKLLLLLLLLLLLKDMMMMGDK.",
    ".KDDDDDDKLLLLLLLLLLLLLKDDDDDDK.",
    ".KKKKKKKLLLLKKKKKKKLLLLKKKKKKK.",
    "KDGMMMDKLLKKMMMMMMMKKLLKDMMMGDK",
    "KDDDDDDKLKMMMMMMMMMMMKLKDDDDDDK",
    ".KKKKKKKKLKGMMMMMMMGKLKKKKKKKK.",
    ".KGMKLKLKLKDGDGDGDGDKLKLKLKMGK.",
    ".KDDKLKKKKMDMDMDMDMDMKKKKLKDDK.",
    ".KKKKKKLLKMDMDMDMDMDMKLLKKKKKK.",
    "KDGMMDKLLKMDMDMDMDMDMKLLKDMMGDK",
    "KDDDDDKLLKMWEEWWWEEWMKLLKDDDDDK",
    ".KKKKKLKLKMWEEWWWEEWMKLKLKKKKK.",
    ".KDGMKLKLKMWWWWWWWWWMKLKLKMGDK.",
    ".KDDDKLKLKMWWWKKKWWWMKLKLKDDDK.",
    ".KKKKKKKLKMWWWWWWWWWMKLKKKKKKK.",
    "KDGMDK.KKKKKKKKKKKKKKKKK.KDMGDK",
    "KDDDDK....KDDLLELLDDK....KDDDDK",
    ".KKKK.....KDDDLELDDDK.....KKKK.",
    "..KDKK...KDKDLDEDLDKDK...KKDK..",
    "...KDK...KDKDDLELDDKDK...KDK...",
    "..KDK...KWKLLLDEDLLLKWK...KDK..",
    "...KK...KKDDDDDDDDDDDKK...KK...",
    "....K....KLLLLLLLLLLLK....K....",
    ".........KKKKKKKKKKKKK.........",
    "...........KDDK.KDDK...........",
    "...........KDDK.KDDK...........",
    "...........KEEK.KEEK...........",
    "...........KKKK.KKKK...........",
  ];
  HUD.CELESTIA = CELESTIA;
  const SPRITES = {
    hina: { rows: HINA, colours: HINA_COLOURS },
    celestia: { rows: CELESTIA, colours: { K: "#000", D: "#323234", M: "#545456", G: "#76766c", L: "#c6d2d2", W: "#e8e6e1", E: "#b3202c" } },
  };
  /* draw a pixel sprite (hina | celestia) at (x0, y0), px canvas pixels per art pixel; legs: 0 standing, 1/2 running frames.
     Dancing (js/dance.js): lean shifts the top by that many art pixels (feet stay put), flip mirrors,
     sy squashes (<1) or stretches (>1) from the feet up; sx narrows about the middle (turning). */
  HUD.drawSprite = function (ctx, x0, y0, px, { sprite = "hina", legs = 0, blush = false, lean = 0, flip = false, sy = 1, sx = 1 } = {}) {
    const { rows: art, colours } = SPRITES[sprite], rows = art.length, cols = art[0].length, half = (cols - 1) / 2;
    const ph = px * sy, pw = px * sx, foot = y0 + rows * px, mid = x0 + (cols / 2) * px;
    for (let y = 0; y < rows; y++) {
      // running: shift the two legs (last 4 rows) apart and together
      const leg = y >= rows - 4 && legs;
      const shear = lean * (1 - y / rows);
      for (let x = 0; x < cols; x++) {
        const c = art[y][x];
        if (c === ".") continue;
        const dx = leg ? (x < half ? -1 : 1) * (legs === 1 ? 1 : 0) : 0;
        const dy = leg && legs === 2 && x < half ? -1 : 0;
        const xx = (flip ? cols - 1 - x : x) + dx + shear;
        ctx.fillStyle = blush && sprite === "hina" && c === "S" && (y === 19 || y === 20) && (x < 9 || x > 13) ? "#f48a80" : colours[c];
        ctx.fillRect(Math.round(mid + (xx - cols / 2) * pw), Math.round(foot - (rows - y - dy) * ph), Math.ceil(pw), Math.ceil(ph));
      }
    }
  };

  // European wheel order; 0 is green, then red/black alternate around the wheel.
  const POCKETS = 37;
  function drawRoulette(ctx, cx, cy, R, t, dpr, intensity = 1) {
    const k = Math.min(1, intensity);
    ctx.save(); ctx.translate(cx, cy);
    // glow behind the wheel
    const g = ctx.createRadialGradient(0, 0, R * 0.5, 0, 0, R * 1.1);
    g.addColorStop(0, `rgba(${C},${0.25 * k})`); g.addColorStop(1, `rgba(${C},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, R * 1.1, 0, TAU); ctx.fill();
    // wooden bowl + gold rim
    ctx.fillStyle = `rgba(${PLATE},${0.95 * k})`;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
    ctx.strokeStyle = `rgba(${ALT},${0.9 * k})`; ctx.lineWidth = Math.max(1, R * 0.035);
    ctx.beginPath(); ctx.arc(0, 0, R * 0.98, 0, TAU); ctx.stroke();
    ctx.lineWidth = Math.max(0.6, R * 0.012);
    ctx.beginPath(); ctx.arc(0, 0, R * 0.9, 0, TAU); ctx.stroke();

    // spinning pockets
    const spin = t * 0.35;
    ctx.save(); ctx.rotate(spin);
    const r0 = R * 0.6, r1 = R * 0.86, step = TAU / POCKETS;
    ctx.lineWidth = r1 - r0;
    for (let i = 0; i < POCKETS; i++) {
      ctx.strokeStyle = i === 0 ? `rgba(${HUD.OK},${0.9 * k})` : i % 2 ? `rgba(${C},${0.95 * k})` : `rgba(14,6,9,${0.95 * k})`;
      ctx.beginPath(); ctx.arc(0, 0, (r0 + r1) / 2, i * step, (i + 1) * step); ctx.stroke();
    }
    // gold frets between pockets
    ctx.strokeStyle = `rgba(${ALT},${0.8 * k})`; ctx.lineWidth = Math.max(0.5, R * 0.01);
    ctx.beginPath();
    for (let i = 0; i < POCKETS; i++) {
      const a = i * step;
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
    }
    ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, r0, 0, TAU); ctx.stroke();
    // cone + four-armed turret
    const cone = ctx.createRadialGradient(0, 0, 0, 0, 0, r0);
    cone.addColorStop(0, `rgba(${CORE2},${0.9 * k})`); cone.addColorStop(0.35, `rgba(${C},${0.5 * k})`); cone.addColorStop(1, `rgba(${PLATE},${0.9 * k})`);
    ctx.fillStyle = cone; ctx.beginPath(); ctx.arc(0, 0, r0 * 0.98, 0, TAU); ctx.fill();
    ctx.strokeStyle = `rgba(${ALT},${0.95 * k})`; ctx.lineWidth = Math.max(1, R * 0.045); ctx.lineCap = "round";
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU;
      ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * r0 * 0.62, Math.sin(a) * r0 * 0.62);
    }
    ctx.stroke(); ctx.lineCap = "butt";
    ctx.fillStyle = `rgba(${ALT},${k})`;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU;
      ctx.beginPath(); ctx.arc(Math.cos(a) * r0 * 0.62, Math.sin(a) * r0 * 0.62, R * 0.04, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = `rgba(${CORE1},${k})`; ctx.beginPath(); ctx.arc(0, 0, R * 0.07, 0, TAU); ctx.fill();
    ctx.restore();

    // the ball runs the other way, round the track between rim and pockets
    const ba = -t * 1.3;
    ctx.fillStyle = `rgba(${CORE1},${k})`;
    ctx.beginPath(); ctx.arc(Math.cos(ba) * R * 0.94, Math.sin(ba) * R * 0.94, Math.max(1.2, R * 0.045), 0, TAU); ctx.fill();
    ctx.restore();
  }

  // Doctor Doom's mask as 16x18 pixel art: G hood, g hood shadow, M metal, m metal shadow,
  // K black (slits, grille), E eyes. jarvis/shell/doom.ans is generated from the same grid.
  const DOOM_MASK = [
    "......GGGG......",
    "....GGGGGGGG....",
    "...GGggggggGG...",
    "..GGgMMMMMMgGG..",
    "..GgMMMMMMMMgG..",
    ".GGgMMMMMMMMgGG.",
    ".GgMmKKMMKKmMgG.",
    ".GgMKEKmmKEKMgG.",
    ".GgMmKKMMKKmMgG.",
    ".GgMMMMmmMMMMgG.",
    ".GgmMMMmmMMMmgG.",
    ".GgmMMMMMMMMmgG.",
    ".GgmMKKKKKKMmgG.",
    ".GgmMKMKMKMKmgG.",
    ".GGgmMMMMMMmgGG.",
    "..GgmmMMMMmmgG..",
    "..GGgmmmmmmgGG..",
    ".GGGGgggggGGGGG.",
  ];
  HUD.DOOM_MASK = DOOM_MASK;
  function drawDoomMask(ctx, cx, cy, R, t, dpr, intensity = 1) {
    const k = Math.min(1, intensity), rows = DOOM_MASK.length, cols = DOOM_MASK[0].length;
    const px = Math.max(1, Math.floor((R * 2) / rows)), w = px * cols, hgt = px * rows;
    const x0 = Math.round(cx - w / 2), y0 = Math.round(cy - hgt / 2);
    const eye = 0.75 + 0.25 * Math.sin(t * 3);
    const colour = { G: `rgba(${C},${0.95 * k})`, g: `rgba(${C},${0.45 * k})`, M: `rgba(${ALT},${k})`,
      m: `rgba(${ALT},${0.55 * k})`, K: `rgba(${PLATE},${k})`, E: `rgba(${CORE1},${eye * k})` };
    // a row occasionally slips sideways, like a bad signal
    const glitchRow = Math.sin(t * 0.7) > 0.97 ? Math.floor((t * 13) % rows) : -1;
    for (let y = 0; y < rows; y++) {
      const dx = y === glitchRow ? px * 2 : 0;
      for (let x = 0; x < cols; x++) {
        const c = DOOM_MASK[y][x];
        if (c === ".") continue;
        ctx.fillStyle = colour[c];
        ctx.fillRect(x0 + x * px + dx, y0 + y * px, px, px);
      }
    }
    // scan beam rolling down the mask
    const sy = y0 + ((t * 0.35) % 1) * hgt;
    ctx.fillStyle = `rgba(${CORE2},${0.18 * k})`;
    ctx.fillRect(x0 - px, sy, w + px * 2, Math.max(1, px * 0.6));
  }

  function drawArcReactor(ctx, cx, cy, R, t, dpr, intensity = 1) {
    ctx.save(); ctx.translate(cx, cy);
    // glow core
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
    g.addColorStop(0, `rgba(${CORE1},${0.95 * intensity})`);
    g.addColorStop(0.18, `rgba(${CORE2},${0.85 * intensity})`);
    g.addColorStop(0.45, `rgba(${C},${0.25 * intensity})`);
    g.addColorStop(1, `rgba(${C},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
    // coil segments
    ctx.save(); ctx.rotate(t * 0.3);
    const n = 10;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      ctx.save(); ctx.rotate(a);
      ctx.fillStyle = `rgba(${C},${0.18 * intensity})`;
      ctx.fillRect(R * 0.47, -R * 0.1, R * 0.28, R * 0.2);
      ctx.fillStyle = `rgba(${C},${0.6 * intensity})`;
      ctx.fillRect(R * 0.5, -R * 0.07, R * 0.22, R * 0.14);
      ctx.restore();
    }
    ctx.restore();
    ctx.strokeStyle = `rgba(${C},${0.15 * intensity})`; ctx.lineWidth = 7 * dpr;
    ctx.beginPath(); ctx.arc(0, 0, R * 0.78, 0, TAU); ctx.stroke();
    ctx.strokeStyle = `rgba(${C},${0.8 * intensity})`; ctx.lineWidth = 2 * dpr;
    ctx.beginPath(); ctx.arc(0, 0, R * 0.78, 0, TAU); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, R * 0.42, 0, TAU); ctx.stroke();
    // inner triangle (Mk VI style)
    ctx.save(); ctx.rotate(-Math.PI / 2 + Math.sin(t) * 0.05);
    ctx.beginPath();
    for (let i = 0; i < 3; i++) { const a = (i / 3) * TAU; ctx[i ? "lineTo" : "moveTo"](Math.cos(a) * R * 0.36, Math.sin(a) * R * 0.36); }
    ctx.closePath(); ctx.stroke();
    ctx.restore();
    ctx.restore();
  }
  HUD.drawReactor = drawReactor;

  class Reactor {
    constructor(canvas, { pulse = 1 } = {}) {
      this.c = canvas; this.ctx = canvas.getContext("2d"); this.level = 0; this.pulse = pulse;
      HUD.loop((dt, t) => this.draw(t));
    }
    draw(t) {
      if (!visible(this.c)) return;
      const { w, h, dpr } = fit(this.c);
      const ctx = this.ctx, s = Math.min(w, h);
      ctx.clearRect(0, 0, w, h);
      const k = 0.9 + 0.1 * Math.sin(t * 2.2 * this.pulse) + this.level * 0.25;
      drawReactor(ctx, w / 2, h / 2, s * 0.42, t, dpr, Math.min(1.2, k));
      // outer ring
      ctx.save(); ctx.translate(w / 2, h / 2); ctx.rotate(-t * 0.6);
      ctx.strokeStyle = `rgba(${C},0.5)`; ctx.lineWidth = 1.5 * dpr;
      ctx.setLineDash([s * 0.08, s * 0.04]);
      ctx.beginPath(); ctx.arc(0, 0, s * 0.47, 0, TAU); ctx.stroke();
      ctx.restore();
    }
  }
  HUD.Reactor = Reactor;

  // ------------------------------------------------------------ core telemetry (big centre)
  class Core {
    constructor(canvas) {
      this.c = canvas; this.ctx = canvas.getContext("2d");
      this.rings = [
        { key: "cpu", label: "CPU", v: 0, s: 0, rgb: C },
        { key: "gpu", label: "GPU", v: 0, s: 0, rgb: C },
        { key: "ram", label: "RAM", v: 0, s: 0, rgb: C },
        { key: "igpu", label: "iGPU", v: 0, s: 0, rgb: C },
      ];
      this.cores = [];
      this.particles = Array.from({ length: 70 }, () => ({ a: Math.random() * TAU, r: 0.55 + Math.random() * 0.45, sp: (Math.random() - 0.5) * 0.4, sz: Math.random() * 1.8 + 0.4 }));
      HUD.loop((dt, t) => this.draw(dt, t));
    }
    set(vals, cores, levels = {}) {
      this.rings.forEach((r) => { r.v = vals[r.key] ?? 0; r.rgb = HUD.rgbFor(levels[r.key] || HUD.pctLevel(r.v)); });
      this.cores = cores || [];
    }
    draw(dt, t) {
      if (!visible(this.c)) return;
      const { w, h, dpr } = fit(this.c);
      const ctx = this.ctx, cx = w / 2, cy = h / 2;
      const R = Math.min(w, h) * 0.47;
      ctx.clearRect(0, 0, w, h);

      // radar sweep
      ctx.save(); ctx.translate(cx, cy);
      const sweep = (t * 0.6) % TAU;
      const sg = ctx.createConicGradient ? ctx.createConicGradient(sweep, 0, 0) : null;
      if (sg) {
        sg.addColorStop(0, `rgba(${C},0.18)`); sg.addColorStop(0.12, `rgba(${C},0)`); sg.addColorStop(1, `rgba(${C},0)`);
        ctx.fillStyle = sg; ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.fill();
      }
      // crosshair + rings
      ctx.strokeStyle = `rgba(${C},0.12)`; ctx.lineWidth = 1 * dpr;
      ctx.beginPath(); ctx.moveTo(-R * 1.05, 0); ctx.lineTo(R * 1.05, 0); ctx.moveTo(0, -R * 1.05); ctx.lineTo(0, R * 1.05); ctx.stroke();
      [1, 0.995].forEach((k) => { ctx.beginPath(); ctx.arc(0, 0, R * k, 0, TAU); ctx.stroke(); });
      // degree ticks
      ctx.save(); ctx.rotate(t * 0.05);
      for (let i = 0; i < 120; i++) {
        const a = (i / 120) * TAU, L = i % 10 === 0 ? 12 : 5;
        ctx.strokeStyle = `rgba(${C},${i % 10 === 0 ? 0.6 : 0.22})`;
        ctx.beginPath(); ctx.moveTo(Math.cos(a) * R, Math.sin(a) * R); ctx.lineTo(Math.cos(a) * (R - L * dpr), Math.sin(a) * (R - L * dpr)); ctx.stroke();
      }
      ctx.restore();

      // particles
      this.particles.forEach((p) => {
        p.a += p.sp * dt;
        const x = Math.cos(p.a) * R * p.r, y = Math.sin(p.a) * R * p.r;
        ctx.fillStyle = `rgba(${C},${0.25 + 0.4 * Math.abs(Math.sin(t + p.r * 9))})`;
        ctx.beginPath(); ctx.arc(x, y, p.sz * dpr, 0, TAU); ctx.fill();
      });

      // metric rings
      const radii = [0.88, 0.74, 0.6, 0.48];
      const lw = R * 0.075;
      this.rings.forEach((r, i) => {
        r.s += (r.v - r.s) * Math.min(1, dt * 3.5);
        const rr = R * radii[i];
        const dir = i % 2 ? -1 : 1;
        const base = -Math.PI / 2;
        ctx.lineWidth = lw;
        ctx.strokeStyle = `rgba(${C},0.07)`;
        ctx.beginPath(); ctx.arc(0, 0, rr, 0, TAU); ctx.stroke();
        // segmented fill
        const segs = 60, filled = (r.s / 100) * segs;
        if (filled > 0) {
          ctx.lineWidth = lw * 1.8; ctx.strokeStyle = `rgba(${r.rgb},0.1)`;
          const end = base + dir * TAU * (r.s / 100);
          ctx.beginPath(); if (dir > 0) ctx.arc(0, 0, rr, base, end); else ctx.arc(0, 0, rr, end, base); ctx.stroke();
          ctx.lineWidth = lw;
        }
        for (let k = 0; k < segs; k++) {
          const f = Math.max(0, Math.min(1, filled - k));
          if (f <= 0) break;
          const a0 = base + dir * (k / segs) * TAU, a1 = a0 + dir * (TAU / segs - 0.02) * f;
          ctx.strokeStyle = `rgba(${r.rgb},${0.35 + 0.65 * (k / segs)})`;
          ctx.beginPath();
          if (dir > 0) ctx.arc(0, 0, rr, a0, a1); else ctx.arc(0, 0, rr, a1, a0);
          ctx.stroke();
        }
        // thin orbit with travelling node
        ctx.lineWidth = 1 * dpr; ctx.strokeStyle = `rgba(${C},0.25)`;
        ctx.beginPath(); ctx.arc(0, 0, rr + lw * 0.85, 0, TAU); ctx.stroke();
        const na = t * (0.4 + i * 0.15) * dir;
        ctx.fillStyle = `rgba(${C},0.9)`;
        ctx.beginPath(); ctx.arc(Math.cos(na) * (rr + lw * 0.85), Math.sin(na) * (rr + lw * 0.85), 2.5 * dpr, 0, TAU); ctx.fill();
      });
      // ring labels, drawn last on a dark plate so the segments don't cover them
      ctx.font = `${Math.round(R * 0.045)}px ${FM}`;
      ctx.textAlign = "right"; ctx.textBaseline = "middle";
      this.rings.forEach((r, i) => {
        const rr = R * radii[i], text = `${r.label} ${Math.round(r.s)}%`;
        const tw = ctx.measureText(text).width, th = R * 0.06;
        ctx.fillStyle = `rgba(${PLATE},0.85)`;
        ctx.fillRect(-lw * 0.9 - tw - 6 * dpr, -rr - th / 2, tw + 10 * dpr, th);
        ctx.fillStyle = `rgba(${r.rgb},0.95)`;
        ctx.fillText(text, -lw * 0.9, -rr);
      });

      // per-thread spokes around reactor
      const n = this.cores.length;
      if (n) {
        const r0 = R * 0.28, r1 = R * 0.4;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU - Math.PI / 2, v = this.cores[i] / 100;
          ctx.strokeStyle = `rgba(${C},0.12)`; ctx.lineWidth = 4 * dpr;
          ctx.beginPath(); ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); ctx.stroke();
          ctx.strokeStyle = `rgba(${HUD.rgbFor(HUD.pctLevel(v * 100))},0.95)`;
          ctx.beginPath(); ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
          ctx.lineTo(Math.cos(a) * (r0 + (r1 - r0) * Math.max(0.04, v)), Math.sin(a) * (r0 + (r1 - r0) * Math.max(0.04, v))); ctx.stroke();
        }
      }
      ctx.restore();
      const load = (this.rings[0].s || 0) / 100;
      drawReactor(ctx, cx, cy, R * 0.25, t * (1 + load * 3), dpr, 0.85 + 0.15 * Math.sin(t * 3) + load * 0.2);
    }
  }
  HUD.Core = Core;

  // ------------------------------------------------------------ background (reference #2 style)
  function background(canvas) {
    const ctx = canvas.getContext("2d");
    let nodes = [];
    let acc = 0;
    function reset() {
      const { w, h } = fit(canvas);
      const count = Math.round((w * h) / 52000);
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 8, vy: (Math.random() - 0.5) * 8,
        r: Math.random() < 0.12 ? 3 + Math.random() * 4 : 0.8 + Math.random() * 1.6,
        ph: Math.random() * TAU,
      }));
      suits = Array.from({ length: Math.round((w * h) / 70000) }, () => ({
        x: Math.random() * w, y: Math.random() * h, vy: 4 + Math.random() * 7, vx: (Math.random() - 0.5) * 3,
        rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 0.3, size: 14 + Math.random() * 30,
        suit: (Math.random() * 4) | 0, ph: Math.random() * TAU,
      }));
    }
    let suits = [];
    // Asahina: looking down into the pool - lane lines on the floor, light caustics, a lane rope,
    // rising bubbles, and ripples where you click (HUD.ripple)
    const ripples = [];
    HUD.ripple = (x, y) => { if (SKIN === "asahina") ripples.push({ x, y, age: 0 }); if (ripples.length > 12) ripples.shift(); };
    function drawPool(w, h, dpr, step, t) {
      const lanes = 6, lw = w / lanes;
      for (let i = 0; i < lanes; i++) {   // dark lane stripe with a T at each end
        const x = lw * (i + 0.5);
        ctx.fillStyle = `rgba(${PLATE},0.5)`;
        ctx.fillRect(x - 7 * dpr, h * 0.12, 14 * dpr, h * 0.76);
        ctx.fillRect(x - 30 * dpr, h * 0.12, 60 * dpr, 12 * dpr);
        ctx.fillRect(x - 30 * dpr, h * 0.88 - 12 * dpr, 60 * dpr, 12 * dpr);
      }
      ctx.strokeStyle = `rgba(${ALT},0.07)`; ctx.lineWidth = 1.5 * dpr;
      const gs = 70 * dpr;
      ctx.beginPath();
      for (let y = 0; y < h + gs; y += gs) {
        for (let x = 0; x <= w; x += gs / 3) {
          const yy = y + Math.sin(x / (gs * 0.9) + t * 0.9 + y) * gs * 0.22 + Math.sin(x / (gs * 0.37) - t * 1.3) * gs * 0.06;
          x ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy);
        }
      }
      for (let x = 0; x < w + gs; x += gs) {
        for (let y = 0; y <= h; y += gs / 3) {
          const xx = x + Math.sin(y / (gs * 0.8) - t * 0.8 + x) * gs * 0.22 + Math.sin(y / (gs * 0.41) + t * 1.1) * gs * 0.06;
          y ? ctx.lineTo(xx, y) : ctx.moveTo(xx, y);
        }
      }
      ctx.stroke();
      // lane rope: alternating red and white floats, bobbing
      const ry = h * 0.5, br = 7 * dpr;
      for (let x = 0, i = 0; x < w + br * 2; x += br * 2.3, i++) {
        ctx.fillStyle = (i >> 1) % 2 ? `rgba(${CORE1},0.13)` : `rgba(${C},0.16)`;
        ctx.beginPath(); ctx.arc(x, ry + Math.sin(t * 1.4 + i * 0.5) * 3 * dpr, br, 0, TAU); ctx.fill();
      }
      for (const n of nodes) {   // bubbles, wobbling upwards
        n.y -= (8 + n.r * 6) * step * dpr; if (n.y < -20) { n.y = h + 20; n.x = Math.random() * w; }
        ctx.strokeStyle = `rgba(${NODE},${0.12 + 0.08 * Math.sin(t + n.ph)})`; ctx.lineWidth = dpr;
        ctx.beginPath(); ctx.arc(n.x + Math.sin(t * 2 + n.ph) * 4 * dpr, n.y, (n.r + 1.5) * dpr * 1.6, 0, TAU); ctx.stroke();
      }
      for (const r of ripples) {
        r.age += step;
        for (let k = 0; k < 3; k++) {
          const a = r.age - k * 0.25;
          if (a <= 0) continue;
          ctx.strokeStyle = `rgba(${NODE},${Math.max(0, 0.45 * (1 - a / 1.8))})`; ctx.lineWidth = 2 * dpr;
          ctx.beginPath(); ctx.ellipse(r.x * dpr, r.y * dpr, a * 140 * dpr, a * 90 * dpr, 0, 0, TAU); ctx.stroke();
        }
      }
      while (ripples.length && ripples[0].age > 2.4) ripples.shift();
    }
    // DOOM: memory dump of "Latverian mainframe" rows; drawn once per size/colour, then scrolled
    let dump = null, dumpKey = "";
    function drawHexDump(w, h, dpr, t) {
      const lh = 18 * dpr, key = `${w}x${h}:${C}:${document.fonts.check(`16px VT323`)}`;
      if (dumpKey !== key) {
        dumpKey = key;
        dump = document.createElement("canvas");
        dump.width = w; dump.height = Math.ceil(h / lh) * lh;
        const d = dump.getContext("2d");
        d.font = `${16 * dpr}px VT323`; d.textBaseline = "top";
        const hx = () => ((Math.random() * 256) | 0).toString(16).toUpperCase().padStart(2, "0");
        for (let y = 0, a = 0x7f3a0000; y < dump.height; y += lh, a += 16) {
          let line = a.toString(16).toUpperCase() + ":  ";
          while (d.measureText(line).width < w) line += Array.from({ length: 8 }, hx).join(" ") + "   ";
          d.fillStyle = `rgba(${C},${Math.random() < 0.06 ? 0.16 : 0.07})`;
          d.fillText(line, 8 * dpr, y);
        }
      }
      const off = ((t * 12 * dpr) % dump.height);
      ctx.drawImage(dump, 0, -off); ctx.drawImage(dump, 0, dump.height - off);
    }
    // Celestia: a faint harlequin lattice with playing-card suits drifting down through it.
    function drawSuits(w, h, dpr, step, t) {
      const gs = 90 * dpr;
      ctx.strokeStyle = `rgba(${ALT},0.05)`; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = -h; x < w + h; x += gs) { ctx.moveTo(x, 0); ctx.lineTo(x + h, h); ctx.moveTo(x, h); ctx.lineTo(x + h, 0); }
      ctx.stroke();
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      for (const s of suits) {
        s.y += s.vy * step * dpr; s.x += s.vx * step * dpr; s.rot += s.vr * step;
        if (s.y > h + 40 * dpr) { s.y = -40 * dpr; s.x = Math.random() * w; }
        const red = s.suit === 1 || s.suit === 2;
        const a = 0.07 + 0.06 * (0.5 + 0.5 * Math.sin(t * 0.8 + s.ph));
        ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.rot);
        ctx.fillStyle = `rgba(${red ? C : ALT},${red ? a * 1.4 : a})`;
        ctx.font = `${Math.round(s.size * dpr)}px serif`;
        ctx.fillText("\u2660\u2665\u2666\u2663"[s.suit], 0, 0);
        ctx.restore();
      }
    }
    reset();
    window.addEventListener("resize", reset);
    HUD.loop((dt, t) => {
      acc += dt;
      if (acc < (SKIN === "asahina" && ripples.length ? 1 / 20 : 1 / 10)) return; // slow drifting backdrop: 10 fps is plenty (ripples get 20)
      const step = acc; acc = 0;
      const { w, h, dpr } = fit(canvas);
      ctx.clearRect(0, 0, w, h);
      if (SKIN === "celestia") { drawSuits(w, h, dpr, step, t); return; }
      if (SKIN === "doom") { drawHexDump(w, h, dpr, t); return; }
      if (SKIN === "asahina") { drawPool(w, h, dpr, step, t); return; }
      // faint grid
      ctx.strokeStyle = `rgba(${C},0.035)`; ctx.lineWidth = 1;
      const gs = 48 * dpr;
      ctx.beginPath();
      for (let x = (t * 4 * dpr) % gs; x < w; x += gs) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
      for (let y = 0; y < h; y += gs) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
      ctx.stroke();
      const link = 170 * dpr;
      for (const n of nodes) {
        n.x += n.vx * step * dpr; n.y += n.vy * step * dpr;
        if (n.x < -20) n.x = w + 20; if (n.x > w + 20) n.x = -20;
        if (n.y < -20) n.y = h + 20; if (n.y > h + 20) n.y = -20;
      }
      ctx.lineWidth = 0.7 * dpr;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j], dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
          if (d2 < link * link) {
            ctx.strokeStyle = `rgba(${C},${0.13 * (1 - Math.sqrt(d2) / link)})`;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        }
      }
      for (const n of nodes) {
        const pulse = 0.5 + 0.5 * Math.sin(t * 1.5 + n.ph);
        const r = n.r * dpr;
        if (n.r > 2.5) {
          const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, r * 4);
          g.addColorStop(0, `rgba(${NODE},${0.5 + pulse * 0.3})`);
          g.addColorStop(0.25, `rgba(${C},${0.25 + pulse * 0.15})`);
          g.addColorStop(1, `rgba(${C},0)`);
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(n.x, n.y, r * 4, 0, TAU); ctx.fill();
          ctx.strokeStyle = `rgba(${C},${0.25 + pulse * 0.2})`;
          ctx.beginPath(); ctx.arc(n.x, n.y, r * 2.2, t + n.ph, t + n.ph + 4); ctx.stroke();
        } else {
          ctx.fillStyle = `rgba(${C},${0.25 + pulse * 0.35})`;
          ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, TAU); ctx.fill();
        }
      }
    });
  }
  HUD.background = background;

  // ------------------------------------------------------------ toasts
  HUD.toast = (msg, err = false) => {
    const box = document.getElementById("toasts");
    const el = document.createElement("div");
    el.className = "toast" + (err ? " err" : "");
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 350); }, err ? 6000 : 3200);
  };

  // ------------------------------------------------------------ themes
  const ACCENTS = {
    jarvis: { name: "J.A.R.V.I.S. Cyan", rgb: [0, 225, 255] },
    mark3: { name: "Mark III Gold", rgb: [255, 190, 60] },
    crimson: { name: "Crimson Armor", rgb: [255, 70, 85] },
    gamma: { name: "Gamma Green", rgb: [60, 255, 160] },
    vision: { name: "Vision Violet", rgb: [180, 130, 255] },
  };
  HUD.ACCENTS = ACCENTS;
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const j = (a) => a.join(",");
  const hex = (a) => "#" + a.map((v) => v.toString(16).padStart(2, "0")).join("");

  HUD.theme = { mode: "dark", accent: "jarvis", skin: "jarvis" };
  HUD.applyTheme = function (mode, accent, skin = "jarvis") {
    mode = mode === "light" ? "light" : "dark";
    accent = ACCENTS[accent] ? accent : "jarvis";
    const skins = HUD.SKINS || {};
    skin = skins[skin] ? skin : "jarvis";
    HUD.theme = { mode, accent, skin };
    const a = ACCENTS[accent].rgb, light = mode === "light";
    const W = [255, 255, 255], K = [0, 0, 0];
    const fixed = skins[skin] && skins[skin].palette && skins[skin].palette[mode];   // skins with their own colours ignore Accent
    const acc = fixed ? fixed.acc : light ? mix(a, K, 0.38) : a;   // darker accent for contrast on light bg
    const t = fixed || (light ? {
      cb: mix(a, K, 0.62), warn: [200, 120, 0], crit: [205, 30, 60], ok: [0, 150, 100], shade: [20, 50, 60],
      d0: [251, 253, 254], d1: [236, 243, 246], d2: mix(a, W, 0.82),
      bg: [226, 235, 239], panel: [244, 249, 251], hi: [0, 20, 28],
      text: [14, 38, 48], muted: [88, 116, 128], critSoft: [192, 40, 63],
      scan: 0.05, vignette: 0.16, glow: `0 0 3px rgba(${j(acc)}, .35)`,
      alt: [40, 90, 200], core1: W, core2: mix(a, W, 0.3), plate: [245, 250, 252], node: mix(a, W, 0.2),
    } : {
      cb: mix(a, W, 0.56), warn: [255, 176, 46], crit: [255, 61, 85], ok: [61, 255, 181], shade: [0, 0, 0],
      d0: mix(a, K, 0.955), d1: mix(a, K, 0.9), d2: mix(a, K, 0.75),
      bg: mix(a, K, 0.975), panel: mix(a, K, 0.9), hi: W,
      text: mix(a, W, 0.8), muted: mix(mix(a, [128, 128, 128], 0.55), K, 0.15), critSoft: [255, 138, 154],
      scan: 0.22, vignette: 0.75, glow: `0 0 6px rgba(${j(acc)}, .7), 0 0 18px rgba(${j(acc)}, .35)`,
      alt: [120, 170, 255], core1: [230, 255, 255], core2: mix(a, W, 0.45), plate: mix(a, K, 0.93), node: mix(a, W, 0.75),
    });
    const st = document.documentElement.style;
    const set = (k, v) => st.setProperty(k, v);
    set("--c-rgb", j(acc).replace(/,/g, ", ")); set("--cb-rgb", j(t.cb)); set("--warn-rgb", j(t.warn));
    set("--crit-rgb", j(t.crit)); set("--ok-rgb", j(t.ok)); set("--shade-rgb", j(t.shade));
    set("--d0-rgb", j(t.d0)); set("--d1-rgb", j(t.d1)); set("--d2-rgb", j(t.d2));
    set("--bg", hex(t.bg)); set("--panel-solid", hex(t.panel)); set("--hi", hex(t.hi));
    set("--text", hex(t.text)); set("--muted", hex(t.muted)); set("--crit-soft", hex(t.critSoft));
    set("--scan-alpha", t.scan); set("--vignette-alpha", t.vignette); set("--glow", t.glow);
    document.documentElement.dataset.theme = mode;
    C = j(acc); WARN = j(t.warn); CRIT = j(t.crit); ALT = j(t.alt); OK = j(t.ok);
    CORE1 = j(t.core1); CORE2 = j(t.core2); PLATE = j(t.plate); NODE = j(t.node);
    const skinChanged = SKIN !== skin;
    SKIN = skin;
    document.documentElement.dataset.skin = skin;
    if (skins[skin]) ({ display: FD, mono: FM } = skins[skin].fonts);
    themeListeners.forEach((fn) => fn(HUD.theme));
    // canvases cached with the old fonts need one more redraw once the skin's fonts have loaded
    if (skinChanged) Promise.all([document.fonts.load(`700 16px "${FD}"`), document.fonts.load(`16px "${FM}"`)])
      .then(() => themeListeners.forEach((fn) => fn(HUD.theme)), () => {});
  };
  const themeListeners = [];
  HUD.onTheme = (fn) => themeListeners.push(fn);

  window.HUD = HUD;
})();
