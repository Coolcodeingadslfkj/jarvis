/* SNAKE.EXE: Snake for the D.O.O.M. theme. You steer a convoy of Doombots round the castle grounds,
   collecting stolen Fantastic Four tech ("4", +10) and the odd sorcerous relic ("Ω", +30, gone in a few
   seconds). Every 50 points S.H.I.E.L.D. drops another mine ("X"). The convoy speeds up as it grows.
   Arrows / WASD steer, Space or Enter starts, P or Esc pauses. Doom has opinions about your driving.
   Like SWIM DASH, the game's timer only exists during a run; leaving the screen or hiding the app pauses it. */
(function () {
  const J = (window.JARVIS = window.JARVIS || {});
  const $ = (id) => document.getElementById(id);
  const canvas = $("snake-canvas"), ctx = canvas.getContext("2d");
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const COLS = 32, ROWS = 20;
  const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

  const LINES = {
    start: ["DOOM GRANTS YOU COMMAND OF HIS CONVOY. DO NOT DISAPPOINT HIM.", "COLLECT THE STOLEN TECHNOLOGY. RICHARDS WILL NEVER KNOW.",
      "THE DOOMBOTS AWAIT YOUR ORDERS. TRY TO KEEP THEM IN ONE PIECE."],
    relic: ["A RELIC OF SORCERY. DOOM APPROVES.", "THE ARCANE ARTS FAVOUR YOU. FOR NOW."],
    mine: ["S.H.I.E.L.D. HAS MINED THE GROUNDS. STEER WITH CARE.", "MORE MINES. FURY GROWS DESPERATE."],
    milestone: ["ACCEPTABLE— CONTINUE.", "THE CONVOY GROWS. LATVERIA GROWS STRONGER.", "DOOM IS... ALMOST IMPRESSED."],
    wall: ["THE CONVOY HAS STRUCK THE CASTLE WALL... DOOM IS NOT AMUSED.", "YOU DROVE INTO A WALL... THE WALL WAS NOT MOVING."],
    self: ["YOU HAVE COLLIDED WITH YOUR OWN DOOMBOTS. INCOMPETENCE.", "THE CONVOY HAS EATEN ITSELF... EVEN RICHARDS IS NOT THIS FOOLISH."],
    hitMine: ["A S.H.I.E.L.D. MINE. THEY WILL PAY FOR THIS.", "DESTROYED BY A MINE. DOOM WILL REMEMBER THIS INSULT."],
    best: ["A NEW RECORD... DOOM WILL ALLOW YOU TO LIVE.", "THE HIGHEST SCORE YET... YOU MAY KNEEL BEFORE DOOM."],
  };

  // ------------------------------------------------------------ state
  let mode = "title";   // title | play | pause | over
  let snake, dir, queue, food, relic, mines, score, eaten, grow, newBest, cause, timer = 0, shown = false, blink = 0;
  let best = store.get("doom.snakeBest", 0), runs = store.get("doom.snakeRuns", 0);
  let W = 0, H = 0, cell = 16, ox = 0, oy = 0;
  const active = () => shown && HUD.theme.skin === "doom";

  function say(key, speak = false) {
    const text = pick(LINES[key]);
    $("snake-say").textContent = "DOOM: " + text;
    // sentence case, so the voice sees where each sentence starts (and pauses between them); a period after a
    // single letter is an initialism (S.H.I.E.L.D.), not a sentence end
    if (speak) API.speak(text.toLowerCase().replace(/(^|[a-z]{2}[.!?]+\s+)([a-z])/g, (m, p, c) => p + c.toUpperCase()));
  }
  function occupied(x, y) {
    return snake.some((s) => s[0] === x && s[1] === y) || mines.some((m) => m[0] === x && m[1] === y)
      || (food && food[0] === x && food[1] === y) || (relic && relic.x === x && relic.y === y);
  }
  // a free cell, not right in front of the convoy
  function freeCell() {
    const [hx, hy] = snake[0];
    for (let n = 0; n < 500; n++) {
      const x = Math.floor(Math.random() * COLS), y = Math.floor(Math.random() * ROWS);
      if (!occupied(x, y) && Math.abs(x - hx) + Math.abs(y - hy) > 3) return [x, y];
    }
    return null;
  }

  function reset() {
    const y = Math.floor(ROWS / 2);
    snake = [[8, y], [7, y], [6, y], [5, y]];
    dir = "right"; queue = []; mines = []; relic = null; score = 0; eaten = 0; grow = 0; newBest = false; cause = "";
    food = freeCell();
  }
  const interval = () => Math.max(55, 125 - snake.length * 2);   // ms per step

  // ------------------------------------------------------------ run control
  function start() {
    layout(); reset(); mode = "play"; runs++; store.set("doom.snakeRuns", runs);
    say("start"); schedule(); controls();
  }
  function pause() { if (mode !== "play") return; mode = "pause"; clearTimeout(timer); timer = 0; draw(); controls(); }
  function resume() { if (mode !== "pause") return; mode = "play"; schedule(); controls(); }
  function stop() { clearTimeout(timer); timer = 0; mode = "title"; draw(); controls(); }
  function schedule() { clearTimeout(timer); timer = setTimeout(tick, interval()); }

  function tick() {
    timer = 0;
    if (mode !== "play") return;
    blink++;
    if (queue.length) dir = queue.shift();
    const [dx, dy] = DIRS[dir], [hx, hy] = snake[0], nx = hx + dx, ny = hy + dy;
    if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) return die("wall");
    // moving into the tail's cell is fine unless the convoy is about to grow
    const body = grow > 0 ? snake : snake.slice(0, -1);
    if (body.some((s) => s[0] === nx && s[1] === ny)) return die("self");
    if (mines.some((m) => m[0] === nx && m[1] === ny)) return die("hitMine");
    snake.unshift([nx, ny]);
    if (grow > 0) grow--; else snake.pop();

    if (food && nx === food[0] && ny === food[1]) {
      score += 10; eaten++; grow += 2;
      food = freeCell();
      if (score % 50 === 0) { const m = freeCell(); if (m && mines.length < 14) { mines.push(m); if (mines.length === 1 || Math.random() < 0.3) say("mine"); } }
      if (eaten % 15 === 0) say("milestone", true);
      if (!relic && Math.random() < 0.2) { const r = freeCell(); if (r) relic = { x: r[0], y: r[1], left: 45 }; }   // ~45 steps to reach it
    }
    if (relic && nx === relic.x && ny === relic.y) { score += 30; grow += 3; relic = null; say("relic"); }
    if (relic && --relic.left <= 0) relic = null;
    draw();
    schedule();
  }
  function die(why) {
    mode = "over"; cause = why;
    if (score > best) { best = score; newBest = true; store.set("doom.snakeBest", best); }
    say(newBest && score > 0 ? "best" : why, true);
    draw(); controls();
  }

  // ------------------------------------------------------------ drawing
  function layout() {
    const r = HUD.fit(canvas);
    W = r.w; H = r.h;
    cell = Math.max(6, Math.floor(Math.min(W / (COLS + 2), H / (ROWS + 2))));
    ox = Math.floor((W - cell * COLS) / 2); oy = Math.floor((H - cell * ROWS) / 2);
  }
  function colours() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    return { c: v("--c-rgb"), hi: v("--cb-rgb"), crit: v("--crit-rgb"), bg: v("--d0-rgb"), warn: v("--warn-rgb") };
  }
  function txt(s, x, y, size, colour, align = "center") {
    ctx.font = `${size}px "VT323", monospace`; ctx.textAlign = align; ctx.textBaseline = "middle";
    ctx.fillStyle = colour; ctx.fillText(s, x, y);
  }
  function block(x, y, colour, inset = 1) {
    const g = Math.max(1, Math.round(cell / 8)) * inset;
    ctx.fillStyle = colour; ctx.fillRect(ox + x * cell + g, oy + y * cell + g, cell - g * 2, cell - g * 2);
  }
  function glyph(ch, x, y, colour) { txt(ch, ox + x * cell + cell / 2, oy + y * cell + cell / 2 + cell * 0.04, cell * 1.15, colour); }

  function draw() {
    if (!W) layout();
    const C = colours(), G = `rgb(${C.c})`;
    ctx.clearRect(0, 0, W, H);
    ctx.shadowColor = `rgba(${C.c},.7)`; ctx.shadowBlur = Math.max(2, cell / 3);
    // the castle wall: a double rule round the grounds
    ctx.strokeStyle = G; ctx.lineWidth = Math.max(1, cell / 10);
    ctx.strokeRect(ox - cell * 0.35, oy - cell * 0.35, cell * (COLS + 0.7), cell * (ROWS + 0.7));
    ctx.strokeStyle = `rgba(${C.c},.45)`;
    ctx.strokeRect(ox - cell * 0.6, oy - cell * 0.6, cell * (COLS + 1.2), cell * (ROWS + 1.2));
    // faint dot grid
    ctx.shadowBlur = 0; ctx.fillStyle = `rgba(${C.c},.12)`;
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) ctx.fillRect(ox + x * cell + cell / 2 - 1, oy + y * cell + cell / 2 - 1, 2, 2);
    ctx.shadowBlur = Math.max(2, cell / 3);

    if (mode === "title") { drawTitle(C); return; }
    for (const m of mines) glyph("X", m[0], m[1], `rgb(${C.crit})`);
    if (food) glyph("4", food[0], food[1], `rgb(${C.hi})`);
    if (relic && (relic.left > 12 || blink % 2)) glyph("Ω", relic.x, relic.y, `rgb(${C.warn})`);
    // the convoy: hollow-cored blocks for the Doombots, a solid one with eye slits for the lead
    snake.forEach(([x, y], i) => {
      if (i === 0) return;
      block(x, y, `rgba(${C.c},${Math.max(0.45, 1 - i / (snake.length + 6))})`);
      ctx.save(); ctx.shadowBlur = 0; block(x, y, `rgba(${C.bg},.85)`, 2.6); ctx.restore();
    });
    const [hx, hy] = snake[0];
    block(hx, hy, `rgb(${C.hi})`);
    ctx.save(); ctx.shadowBlur = 0; ctx.fillStyle = `rgb(${C.bg})`;
    const [dx, dy] = DIRS[dir], s = cell / 7, cx = ox + hx * cell + cell / 2, cy = oy + hy * cell + cell / 2;
    for (const side of [-1, 1]) {   // two eye slits, facing the way it's going
      const ex = cx + dx * s * 1.2 + (dy ? side * s * 1.4 : 0), ey = cy + dy * s * 1.2 + (dx ? side * s * 1.4 : 0);
      ctx.fillRect(ex - (dx ? s * 0.5 : s * 0.8), ey - (dy ? s * 0.5 : s * 0.8), dx ? s : s * 1.6, dy ? s : s * 1.6);
    }
    ctx.restore();
    // score line inside the top rule
    ctx.shadowBlur = 0;
    const label = ` SCORE ${String(score).padStart(4, "0")}  HI ${String(best).padStart(4, "0")} `;
    ctx.font = `${cell * 0.9}px "VT323", monospace`;
    ctx.fillStyle = `rgb(${C.bg})`; ctx.fillRect(ox + cell, oy - cell * 0.95, ctx.measureText(label).width, cell * 1.2);
    txt(label, ox + cell, oy - cell * 0.35, cell * 0.9, G, "left");
    if (mode === "pause") banner(C, "** PAUSED **", "P / ESC / SPACE TO RESUME");
    if (mode === "over") banner(C, newBest && score > 0 ? "** NEW RECORD **" : "** CONVOY DESTROYED **",
      `SCORE ${score} · HI ${best} · SPACE TO TRY AGAIN`);
  }
  function banner(C, title, sub) {
    const bw = cell * 27, bh = cell * 6, bx = (W - bw) / 2, by = (H - bh) / 2;
    ctx.shadowBlur = 0; ctx.fillStyle = `rgba(${C.bg},.92)`; ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = `rgb(${C.c})`; ctx.lineWidth = Math.max(1, cell / 10); ctx.strokeRect(bx, by, bw, bh);
    ctx.shadowBlur = Math.max(2, cell / 3);
    txt(title, W / 2, by + bh * 0.36, cell * 1.7, `rgb(${C.hi})`);
    txt(sub, W / 2, by + bh * 0.72, cell * 1.05, `rgb(${C.c})`);
  }
  function drawTitle(C) {
    const G = `rgb(${C.c})`, HI = `rgb(${C.hi})`;
    txt("SNAKE.EXE", W / 2, oy + cell * 4, cell * 4.2, HI);
    txt("DOOMBOT CONVOY CONTROL  v1.0  (C) 1993 VON DOOM INDUSTRIES", W / 2, oy + cell * 7, cell * 1.05, G);
    // a little demo convoy marching across
    const n = 9, y = 10, x0 = Math.floor((COLS - n) / 2);
    for (let i = 0; i < n; i++) {
      block(x0 + i, y, i === n - 1 ? HI : `rgba(${C.c},${0.5 + i / (n * 2)})`);
      if (i < n - 1) { ctx.save(); ctx.shadowBlur = 0; block(x0 + i, y, `rgba(${C.bg},.85)`, 2.6); ctx.restore(); }
    }
    glyph("4", x0 + n + 2, y, HI);
    const lines = [
      ["ARROWS / WASD", "STEER THE CONVOY"],
      ["4", "STOLEN F.F. TECH    +10"],
      ["Ω", "FLEETING RELIC      +30"],
      ["X", "S.H.I.E.L.D. MINE   AVOID"],
    ];
    lines.forEach(([k, v], i) => {
      txt(k, W / 2 - cell * 4, oy + cell * (13 + i * 1.3), cell * 1.05, i === 3 ? `rgb(${C.crit})` : HI, "right");
      txt(v, W / 2 - cell * 2.5, oy + cell * (13 + i * 1.3), cell * 1.05, G, "left");
    });
    txt(best ? `HI ${best}  ·  ${runs} RUN${runs === 1 ? "" : "S"}  ·  PRESS SPACE` : "PRESS SPACE TO BEGIN", W / 2, oy + cell * 19, cell * 1.3,
      blink % 2 ? G : HI);
  }

  // ------------------------------------------------------------ input
  const OPPOSITE = { up: "down", down: "up", left: "right", right: "left" };
  function turn(d) {
    if (mode !== "play") return;
    const lastDir = queue.length ? queue[queue.length - 1] : dir;
    if (d !== lastDir && d !== OPPOSITE[lastDir] && queue.length < 3) queue.push(d);
  }
  const KEYS = { ArrowUp: "up", w: "up", W: "up", ArrowDown: "down", s: "down", S: "down",
    ArrowLeft: "left", a: "left", A: "left", ArrowRight: "right", d: "right", D: "right" };
  document.addEventListener("keydown", (e) => {
    if (!active() || HUD.isTyping(e) || e.ctrlKey || e.altKey || e.metaKey) return;
    if (KEYS[e.key]) { if (mode === "play") turn(KEYS[e.key]); else if (mode !== "pause") return; e.preventDefault(); return; }
    if (e.key === " " || e.key === "Enter") { mode === "play" ? pause() : mode === "pause" ? resume() : start(); e.preventDefault(); }
    else if (e.key === "p" || e.key === "P" || e.key === "Escape") { mode === "play" ? pause() : resume(); e.preventDefault(); }
  });
  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    if (mode !== "play") return mode === "pause" ? resume() : start();
    // click/tap steering: turn towards the side of the head that was clicked
    const r = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const px = (e.clientX - r.left) * dpr, py = (e.clientY - r.top) * dpr;
    const [hx, hy] = snake[0], dx = px - (ox + hx * cell + cell / 2), dy = py - (oy + hy * cell + cell / 2);
    turn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up"));
  });

  // ------------------------------------------------------------ buttons, life cycle
  function controls() {
    $("snake-start").textContent = mode === "play" ? "PAUSE" : mode === "pause" ? "RESUME" : mode === "over" ? "RETRY" : "START";
    $("snake-stop").disabled = mode === "title";
    $("snake-best").textContent = best ? `HI ${best}` : "";
  }
  $("snake-start").addEventListener("click", (e) => { e.currentTarget.blur(); mode === "play" ? pause() : mode === "pause" ? resume() : start(); });
  $("snake-stop").addEventListener("click", (e) => { e.currentTarget.blur(); stop(); });
  new ResizeObserver(() => { if (shown) { layout(); draw(); } }).observe(canvas);
  document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });
  // the title screen's "PRESS SPACE" blinks; that timer only exists while the menu is open
  let blinkTimer = 0;
  // the game belongs to Doom: other themes send it home
  HUD.onTheme((th) => { if (th.skin !== "doom") { if (mode !== "title") stop(); if (shown) J.show("home"); } });

  J.snake = {
    onShow() {
      shown = true;
      // arriving from the DOOM:\> line leaves focus there, and the arrow keys would scroll its history
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      layout(); draw(); controls();
      clearInterval(blinkTimer);
      blinkTimer = setInterval(() => { if (mode === "title") { blink++; draw(); } }, 600);
      if (mode === "title") $("snake-say").textContent = "DOOM: " + (best ? `YOUR RECORD STANDS AT ${best}. BEAT IT, OR BE FORGOTTEN.` : "PRESS SPACE. DOOM IS WAITING.");
    },
    onHide() { shown = false; clearInterval(blinkTimer); blinkTimer = 0; pause(); },
    start, stop,
    state: () => ({ mode, score, best, runs, length: snake ? snake.length : 0, mines: mines ? mines.length : 0, looping: !!timer, blinking: !!blinkTimer }),
  };
})();
