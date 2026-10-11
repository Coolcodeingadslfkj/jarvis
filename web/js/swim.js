/* SWIM DASH: Hina's endless swim, a Chrome-dino-style mini game for the Aoi Asahina theme (SWIM menu).
   Space / Up / click: leap out of the water.  Down (hold): dive.  P or Esc: pause.
   Buoys float on the surface (leap or dive), gulls skim it (dive), seaweed and jellyfish lurk below (stay
   up or leap). Diving uses breath, donuts are bonus points, and the pool keeps getting faster.
   Like MUSIC it costs nothing until used: the game runs its own frame loop only while a run is going and
   the menu is on screen. Leaving the menu or hiding the app pauses it, STOP ends it. */
(function () {
  const J = (window.JARVIS = window.JARVIS || {});
  const $ = (id) => document.getElementById(id);
  const canvas = $("swim-canvas"), ctx = canvas.getContext("2d");
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };

  // ------------------------------------------------------------ pixel art
  const COL = { K: "#000", H: "#795548", h: "#543a1c", S: "#eac086", R: "#f44336", r: "#a61515", W: "#fff", w: "#d9e6ee",
    Y: "#ffd23f", y: "#e0a800", O: "#ff8a1f", G: "#9aa7b0", g: "#5d6b75", P: "#ff8fc7", p: "#d4569a", D: "#d69652", d: "#a8692e",
    E: "#7be0ff", e: "#2fa3d6", s: "#ff5ea0" };
  // Hina swimming freestyle, side view (facing right): stroke frames A and B
  const SWIM_A = [
    ".................KKK............",
    "................KHHK............",
    ".................KHHK...........",
    "...............KKKHHKKK.........",
    "..............KHHHHHHHHK........",
    ".............KHHHhHHHHHHK.......",
    ".............KHHhHHHSSSSSK......",
    "..KK.........KHHhHHSSKSSSK......",
    ".KSSK.......KKKKHHSSSSSSSKKKKKKK",
    "KSSSSKKKKKKKRRRRRKSSSSSSKSSSSSSK",
    ".KKSSSSSSSKRRRRRRRRKSSSKKKKKKKK.",
    "...KKKKKKKKRRWWRRRRRKKK.........",
    "..........KKKKKKKKKKK...........",
  ];
  const SWIM_B = [
    ".................KKK............",
    "................KHHK............",
    "...........KKK...KHHK...........",
    "..........KSSSK.KKHHKKK.........",
    "...........KSSSKHHHHHHHK........",
    "............KSSKHhHHHHHHK.......",
    ".............KSKHhHHSSSSSK......",
    "..............KKHhHHSSKSSSK.....",
    "...........KKKKKHHSSSSSSSK......",
    ".KK.KKKKKKKRRRRRKSSSSSSSK.......",
    "KSSKSSSSSKRRRRRRRRKKKKKK........",
    ".KSSSSSKKKRRWWRRRRRK............",
    "..KKKKK..KKKKKKKKKKK............",
  ];
  const BUOY = ["..KKKK..", ".KRRWWK.", "KRRRWWWK", "KWWWRRRK", "KWWWRRRK", "KRRRWWWK", ".KRRWWK.", "..KKKK.."];
  const DUCK = ["......KKK..", ".....KYYYK.", ".....KYKYKK", ".....KYYYOOK", "KK...KYYYKK.", "KYKKKYYYYK..", "KYYYYYYYYK..", ".KyyyyyyK...", "..KKKKKK...."];
  const GULL_UP = ["K.........K.", "KwK.....KwK.", ".KwK...KwK..", "..KwKKKwK...", "...KWWWWKK..", "....KWWWWOOK", ".....KKKKK.."];
  const GULL_DN = ["............", "............", "....KKKKK...", "...KWWWWWKK.", "..KwKWWWWKOOK", ".KwK.KKKKK..", "KwK.........", "KK.........."];
  const JELLY_A = ["..KKKK..", ".KPPPPK.", "KPPsPPPK", "KPPPPPPK", "KKKKKKKK", ".P.P.P.P", "P.P.P.P.", ".P.P.P.P"];
  const JELLY_B = ["..KKKK..", ".KPPPPK.", "KPPsPPPK", "KPPPPPPK", "KKKKKKKK", "P.P.P.P.", ".P.P.P.P", "P.P.P.P."];
  const DONUT = ["..KKKK..", ".KPPPPK.", "KPWPPsPK", "KPPKKPPK", "KDPKKPDK", "KPPPPsPK", ".KDDDDK.", "..KKKK.."];
  // pre-rendered at the current pixel size; drawn with drawImage (cheap, and rotatable)
  const cache = new Map();
  function sprite(grid, px, flip = false) {
    const key = grid.join("") + px + flip;
    let c = cache.get(key);
    if (!c) {
      c = document.createElement("canvas");
      c.width = grid[0].length * px; c.height = grid.length * px;
      const g = c.getContext("2d");
      grid.forEach((row, y) => [...row].forEach((ch, x) => {
        if (ch === "." || !COL[ch]) return;
        g.fillStyle = COL[ch];
        g.fillRect((flip ? row.length - 1 - x : x) * px, y * px, px, px);
      }));
      cache.set(key, c);
    }
    return c;
  }

  // ------------------------------------------------------------ game state
  let mode = "title";   // title | play | pause | over
  let raf = 0, last = 0, W = 0, H = 0, px = 4, surf = 0, floor = 0;
  let speed, dist, score, best = store.get("hina.swimBest", 0), runs = store.get("hina.swimRuns", 0);
  let player, obstacles, donuts, splashes, bubbles, keys = { down: false }, nextAt, t = 0, newBest = false, flash = 0;
  const hinaX = () => W * 0.2;

  function reset() {
    speed = 1; dist = 0; score = 0; newBest = false; flash = 0;
    player = { y: 0, vy: 0, breath: 1, air: false, frame: 0, bonus: 0 };
    obstacles = []; donuts = []; splashes = []; bubbles = [];
    nextAt = 1.2;
  }
  function layout() {
    const r = HUD.fit(canvas);
    W = r.w; H = r.h;
    px = Math.max(2, Math.floor(H / 90));
    surf = Math.round(H * 0.42); floor = H - px * 4;
  }

  // ------------------------------------------------------------ spawning
  // kinds: where they sit and which way of passing them works
  function spawn() {
    const lvl = Math.min(1, dist / 4000);   // later on: more gulls and seaweed, tighter gaps
    const r = Math.random();
    const x = W + px * 10;
    if (r < 0.32) obstacles.push({ kind: Math.random() < 0.5 ? "buoy" : "duck", x, y: surf - px * 5 });
    else if (r < 0.32 + 0.22 + lvl * 0.1) obstacles.push({ kind: "gull", x, y: surf - px * 9, ph: Math.random() * 6 });   // head height
    else if (r < 0.8) obstacles.push({ kind: "weed", x, top: surf + px * (6 + Math.random() * 5), w: px * 7 });
    else obstacles.push({ kind: "jelly", x, y: surf + px * (14 + Math.random() * 10), ph: Math.random() * 6 });
    if (Math.random() < 0.45) {   // a donut up high (leap) or down deep (dive)
      const high = Math.random() < 0.5;
      donuts.push({ x: x + px * (30 + Math.random() * 30), y: high ? surf - px * 22 : surf + px * 18 });
    }
    const gap = (1.5 - lvl * 0.55) * (0.8 + Math.random() * 0.6) / Math.sqrt(speed);
    nextAt = Math.max(0.55, gap);
  }

  // ------------------------------------------------------------ input
  function leap() {
    if (mode === "title" || mode === "over") return start();
    if (mode === "pause") return resume();
    if (!player.air && player.y < px * 3) {   // only from the surface
      player.air = true; player.vy = -px * 100;
      splash(hinaX(), 10);
    }
  }
  document.addEventListener("keydown", (e) => {
    if (!active() || HUD.isTyping(e) || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === " " || e.key === "ArrowUp" || e.key === "w" || e.key === "W") { leap(); e.preventDefault(); }
    else if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") { keys.down = true; if (mode === "play") e.preventDefault(); }
    else if (e.key === "p" || e.key === "P" || e.key === "Escape") { mode === "play" ? pause() : mode === "pause" && resume(); e.preventDefault(); }
  });
  document.addEventListener("keyup", (e) => { if (e.key === "ArrowDown" || e.key === "s" || e.key === "S") keys.down = false; });
  canvas.addEventListener("pointerdown", (e) => { e.preventDefault(); leap(); });

  // ------------------------------------------------------------ run control (the frame loop only exists while playing)
  let shown = false;
  const active = () => shown && HUD.theme.skin === "asahina";
  function start() {
    layout(); reset(); mode = "play"; runs++; store.set("hina.swimRuns", runs);
    loop();
    controls();
  }
  function pause() { if (mode !== "play") return; mode = "pause"; stopLoop(); draw(); controls(); }
  function resume() { if (mode !== "pause") return; mode = "play"; loop(); controls(); }
  function stop() { stopLoop(); mode = "title"; draw(); controls(); }
  function loop() { stopLoop(); last = performance.now(); raf = requestAnimationFrame(frame); }
  function stopLoop() { if (raf) cancelAnimationFrame(raf); raf = 0; }
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    if (dt < 1 / 62) return;   // ~60 fps is plenty, even on a 120 Hz screen
    last = now;
    update(dt); draw();
  }

  // ------------------------------------------------------------ update
  function update(dt) {
    t += dt;
    speed = Math.min(3, 1 + dist / 2500);
    const v = px * 70 * speed;   // pool speed, canvas px/s
    dist += v * dt / px / 6;
    score = Math.floor(dist) + player.bonus;
    player.frame += dt * (4 + speed * 2);
    // vertical: leaping (gravity) or swimming at / under the surface
    const p = player;
    if (p.air) {
      p.vy += px * 300 * dt; p.y += p.vy * dt;
      if (p.y >= 0 && p.vy > 0) { p.air = false; p.y = 0; p.vy = 0; splash(hinaX(), 14); }
    } else {
      const deep = keys.down && p.breath > 0.02 ? px * 24 : 0;
      p.y += (deep - p.y) * Math.min(1, dt * 7);
      if (p.y > px * 6) { p.breath = Math.max(0, p.breath - dt * 0.38); if (Math.random() < dt * 8) bubbles.push({ x: hinaX() + px * 14, y: surf + p.y, born: t }); }
      else p.breath = Math.min(1, p.breath + dt * 0.5);
    }
    // world
    nextAt -= dt;
    if (nextAt <= 0) spawn();
    for (const o of obstacles) o.x -= v * dt * (o.kind === "gull" ? 1.15 : 1);
    for (const d of donuts) d.x -= v * dt;
    obstacles = obstacles.filter((o) => o.x > -px * 20);
    donuts = donuts.filter((d) => d.x > -px * 20 && !d.got);
    splashes = splashes.filter((s) => t - s.born < 0.7);
    bubbles = bubbles.filter((b) => t - b.born < 1.2);
    // hits
    const hb = hitbox();
    for (const o of obstacles) if (overlap(hb, box(o))) return crash();
    for (const d of donuts) {
      if (overlap(hb, { x: d.x, y: d.y, w: px * 8, h: px * 8 })) {
        d.got = true; p.bonus += 50; flash = 1; splash(d.x + px * 4, 6, "donut", d.y + px * 4);
        if (Math.random() < 0.35 && J.hina) J.hina.say(pick(["Donut!", "Yum! Sugar power!", "Mmm, swim fuel!"]), { speak: false, ms: 1200 });
      }
    }
    flash = Math.max(0, flash - dt * 3);
  }
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  // Hina's body, generously shrunk so near misses feel fair
  function hitbox() {
    const w = SWIM_A[0].length * px, h = SWIM_A.length * px, x = hinaX(), y = surf - px * 9 + player.y;
    return { x: x + w * 0.22, y: y + h * 0.3, w: w * 0.6, h: h * 0.55 };
  }
  function box(o) {
    if (o.kind === "buoy") return { x: o.x + px, y: o.y + px, w: px * 6, h: px * 6 };
    if (o.kind === "duck") return { x: o.x + px, y: o.y - px * 2, w: px * 9, h: px * 7 };
    if (o.kind === "gull") return { x: o.x + px, y: o.y + Math.sin(t * 3 + o.ph) * px * 2, w: px * 11, h: px * 6 };
    if (o.kind === "jelly") return { x: o.x + px, y: o.y + Math.sin(t * 2 + o.ph) * px * 3, w: px * 6, h: px * 8 };
    return { x: o.x + px, y: o.top, w: o.w - px * 2, h: floor - o.top };   // weed
  }
  const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  function splash(x, n, kind = "water", y = surf) {
    for (let i = 0; i < n; i++) splashes.push({ x, y, vx: (Math.random() - 0.5) * px * 40, vy: -px * (20 + Math.random() * 40), born: t, kind });
  }
  function crash() {
    stopLoop(); mode = "over";
    if (score > best) { best = score; newBest = true; store.set("hina.swimBest", best); }
    draw(); controls();
    if (J.hina) J.hina.say(newBest ? pick(["New personal best! Sakura's gonna be so proud of me!", "Woohoo, a new record! Again, again!"])
      : pick(["Bwah! I swallowed pool water!", "Ow! Okay, okay, one more try!", "Gah! I'll get it next time!", "Hey, who put that there?!"]));
  }

  // ------------------------------------------------------------ drawing
  function draw() {
    if (!W) layout();
    const pool = HUD.ALT, red = HUD.C;
    // air above, water below
    let g = ctx.createLinearGradient(0, 0, 0, surf);
    g.addColorStop(0, "#0d2a4a"); g.addColorStop(1, "#1d5b8a");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, surf);
    g = ctx.createLinearGradient(0, surf, 0, H);
    g.addColorStop(0, "#1c8fd0"); g.addColorStop(1, "#0a3d6e");
    ctx.fillStyle = g; ctx.fillRect(0, surf, W, H - surf);
    // pool floor tiles and a lane line, scrolling at half speed for depth
    const off = (dist * px * 3) % (px * 16);
    ctx.fillStyle = "rgba(255,255,255,.06)";
    for (let x = -off; x < W; x += px * 16) ctx.fillRect(x, surf + px * 4, px, H - surf);
    ctx.fillStyle = "rgba(0,20,50,.35)"; ctx.fillRect(0, floor - px * 10, W, px * 3);
    // far lane rope in the air, parallax
    const ro = (dist * px * 1.5) % (px * 12);
    for (let x = -ro, i = 0; x < W + px * 6; x += px * 6, i++) {   // the next lane over, faint and far away
      ctx.fillStyle = (i >> 1) % 2 ? "rgba(255,255,255,.16)" : `rgba(${red},.22)`;
      ctx.beginPath(); ctx.arc(x, surf - px * 26, px * 1.5, 0, Math.PI * 2); ctx.fill();
    }
    if (mode === "title") { drawTitle(); return; }
    // underwater things
    for (const o of obstacles) {
      if (o.kind === "weed") drawWeed(o);
      else if (o.kind === "jelly") ctx.drawImage(sprite(Math.floor(t * 3 + o.ph) % 2 ? JELLY_A : JELLY_B, px), o.x, o.y + Math.sin(t * 2 + o.ph) * px * 3);
    }
    for (const d of donuts) ctx.drawImage(sprite(DONUT, px), d.x, d.y + Math.sin(t * 4 + d.x) * px);
    for (const b of bubbles) {
      const a = (t - b.born) / 1.2;
      ctx.strokeStyle = `rgba(255,255,255,${0.6 * (1 - a)})`; ctx.lineWidth = Math.max(1, px / 3);
      ctx.beginPath(); ctx.arc(b.x - a * px * 20, b.y - a * px * 16, px * (0.8 + a), 0, Math.PI * 2); ctx.stroke();
    }
    // Hina: tilted with her motion (nose up as she leaps, down as she dives)
    const p = player, img = sprite(Math.floor(p.frame) % 2 ? SWIM_A : SWIM_B, px);
    const tilt = p.air ? Math.max(-0.6, Math.min(0.6, p.vy / (px * 140))) : Math.max(-0.4, Math.min(0.5, (keys.down && p.breath > 0.02 ? 0.35 : -0.2) * (p.y > px * 2 || keys.down ? 1 : 0)));
    ctx.save(); ctx.translate(hinaX() + img.width / 2, surf - px * 9 + p.y + img.height / 2); ctx.rotate(tilt);
    ctx.drawImage(img, -img.width / 2, -img.height / 2); ctx.restore();
    // the water's surface over everything in it
    ctx.fillStyle = "rgba(40,150,220,.32)"; ctx.fillRect(0, surf, W, H - surf);
    ctx.strokeStyle = "rgba(190,240,255,.85)"; ctx.lineWidth = Math.max(1, px / 2);
    ctx.beginPath();
    for (let x = 0; x <= W; x += px * 4) { const y = surf + Math.sin(x / (px * 9) + t * 4) * px * 0.8; x ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke();
    // on and above the surface
    for (const o of obstacles) {
      if (o.kind === "buoy") ctx.drawImage(sprite(BUOY, px), o.x, o.y + Math.sin(t * 3 + o.x) * px * 0.6);
      else if (o.kind === "duck") ctx.drawImage(sprite(DUCK, px, true), o.x, o.y - px * 3 + Math.sin(t * 3 + o.x) * px * 0.6);
      else if (o.kind === "gull") ctx.drawImage(sprite(Math.floor(t * 6 + o.ph) % 2 ? GULL_UP : GULL_DN, px, true), o.x, o.y + Math.sin(t * 3 + o.ph) * px * 2);
    }
    for (const s of splashes) {
      const a = t - s.born;
      ctx.fillStyle = s.kind === "donut" ? `rgba(255,143,199,${1 - a / 0.7})` : `rgba(220,245,255,${1 - a / 0.7})`;
      ctx.fillRect(s.x + s.vx * a, s.y + s.vy * a + px * 160 * a * a, px, px);
    }
    drawHud();
    if (mode === "pause") banner("PAUSED", "P / Esc / Space to keep swimming");
    if (mode === "over") drawOver();
  }
  function drawWeed(o) {
    const n = 3, sway = Math.sin(t * 2 + o.x / 40) * px * 1.5;
    for (let i = 0; i < n; i++) {
      const bx = o.x + px + (i * (o.w - px * 2)) / (n - 1);
      ctx.strokeStyle = i % 2 ? "#3fae5a" : "#2c8a44"; ctx.lineWidth = px * 1.6; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(bx, floor);
      ctx.quadraticCurveTo(bx + sway * 2, (floor + o.top) / 2, bx + sway, o.top + px * (i % 2 ? 2 : 0));
      ctx.stroke();
    }
  }
  function txt(s, x, y, size, colour = "#fff", align = "center", font = "Bungee") {
    ctx.font = `${size}px "${font}", sans-serif`; ctx.textAlign = align; ctx.textBaseline = "middle";
    ctx.lineWidth = Math.max(2, size / 7); ctx.strokeStyle = "rgba(0,20,40,.85)"; ctx.lineJoin = "round";
    ctx.strokeText(s, x, y); ctx.fillStyle = colour; ctx.fillText(s, x, y);
  }
  function drawHud() {
    const s = Math.max(14, px * 5);
    txt(`${score} m`, W - px * 6, px * 8, s, flash ? "#ff8fc7" : "#fff", "right");
    txt(`BEST ${best} m`, W - px * 6, px * 8 + s * 1.2, s * 0.6, "#bfe9ff", "right", "Fredoka");
    // breath: only worth showing once she's under
    if (player.breath < 0.999) {
      const bw = px * 40, bx = px * 6, by = px * 6;
      txt("BREATH", bx, by + px * 2, s * 0.55, "#bfe9ff", "left", "Fredoka");
      ctx.fillStyle = "rgba(0,20,40,.6)"; ctx.fillRect(bx, by + px * 5, bw, px * 2.5);
      ctx.fillStyle = player.breath < 0.25 ? "#ff5a6e" : "#7be0ff"; ctx.fillRect(bx, by + px * 5, bw * player.breath, px * 2.5);
    }
  }
  function banner(title, sub) {
    ctx.fillStyle = "rgba(0,15,35,.55)"; ctx.fillRect(0, H * 0.3, W, H * 0.36);
    txt(title, W / 2, H * 0.42, Math.max(22, px * 10), "#fff");
    txt(sub, W / 2, H * 0.54, Math.max(13, px * 4), "#bfe9ff", "center", "Fredoka");
  }
  function drawTitle() {
    const img = sprite(SWIM_A, px * 2);
    ctx.drawImage(img, W / 2 - img.width / 2, surf - px * 18);
    ctx.fillStyle = "rgba(40,150,220,.32)"; ctx.fillRect(0, surf, W, H - surf);
    txt("SWIM DASH", W / 2, H * 0.17, Math.max(26, px * 12), `rgb(${HUD.C})`);
    txt("SPACE / ↑ / CLICK  leap     ↓ (hold)  dive", W / 2, H * 0.68, Math.max(13, px * 4), "#fff", "center", "Fredoka");
    txt("Leap or dive past buoys · dive under gulls · stay up over seaweed and jellyfish · grab donuts", W / 2, H * 0.68 + Math.max(18, px * 6), Math.max(11, px * 3.2), "#bfe9ff", "center", "Fredoka");
    txt(best ? `BEST ${best} m  ·  ${runs} swim${runs === 1 ? "" : "s"}` : "Press SPACE to dive in!", W / 2, H * 0.84, Math.max(14, px * 4.5), `rgb(${HUD.ALT})`, "center", "Fredoka");
  }
  function drawOver() {
    banner(newBest ? "NEW BEST!" : "SPLASH!", `${score} m · best ${best} m · SPACE to swim again`);
    // standing Hina pops up on the deck to commiserate (or celebrate)
    const sp = Math.max(2, Math.floor(px * 1.2));
    HUD.drawSprite(ctx, W * 0.7 - sp * 11.5, H * 0.3 - sp * 34 + px * 4, sp, { blush: true });
  }

  // ------------------------------------------------------------ buttons, menu life cycle
  function controls() {
    $("swim-start").textContent = mode === "play" ? "PAUSE" : mode === "pause" ? "RESUME" : mode === "over" ? "SWIM AGAIN" : "START";
    $("swim-stop").disabled = mode === "title";
    $("swim-best").textContent = best ? `Best ${best} m` : "";
  }
  // buttons give focus back at once, or Space would both leap and press the button again
  $("swim-start").addEventListener("click", (e) => { e.currentTarget.blur(); mode === "play" ? pause() : mode === "pause" ? resume() : start(); });
  $("swim-stop").addEventListener("click", (e) => { e.currentTarget.blur(); stop(); });
  new ResizeObserver(() => { if (shown) { const keep = mode; layout(); cache.clear(); if (keep !== "play") draw(); } }).observe(canvas);
  document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });
  // the menu belongs to Hina: other themes send it home
  HUD.onTheme((th) => {
    if (th.skin !== "asahina") { if (mode !== "title") stop(); if (shown) J.show("home"); }
  });

  J.swim = {
    onShow() { shown = true; layout(); draw(); controls(); },
    onHide() { shown = false; pause(); },
    start, stop,
    state: () => ({ mode, looping: !!raf, best, runs }),
  };
})();
