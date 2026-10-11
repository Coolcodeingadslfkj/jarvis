/* DEFENSE GRID: Space Invaders for the J.A.R.V.I.S. theme. A Chitauri formation marches down on the
   suit; repulsors take them out one shot at a time, arc barriers soak up return fire, and a Leviathan
   crosses overhead now and then for bonus points. Kills charge the unibeam (X), which clears a column.
   ←/→ or A/D move, Space fires, X unibeam, P or Esc pauses.
   Costs nothing until used: sprites are built the first time the menu opens, the frame loop exists only
   while a run is going and the menu is on screen, and leaving the menu or hiding the app pauses it. */
(function () {
  const J = (window.JARVIS = window.JARVIS || {});
  const $ = (id) => document.getElementById(id);
  const canvas = $("inv-canvas"), ctx = canvas.getContext("2d");
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  const pick = (a) => a[Math.floor(Math.random() * a.length)];

  // the playfield is LW x LH logical units, scaled to fit the canvas
  const LW = 240, LH = 200, GROUND = 186, PLAYER_Y = 172, COLS = 11, ROWS = 5;

  // ------------------------------------------------------------ pixel art ('#' accent, '+' core glow)
  const ART = {
    a: [["...##...", "..####..", ".##++##.", "########", "#.####.#", "..#..#..", ".#.##.#.", "#.#..#.#"],
        ["...##...", "..####..", ".##++##.", "########", "#.####.#", "..#..#..", ".#....#.", "..#..#.."]],
    b: [["..#.....#..", "...#...#...", "..#######..", ".##+###+##.", "###########", "#.#######.#", "#.#.....#.#", "...##.##..."],
        ["..#.....#..", "#..#...#..#", "#.#######.#", "###+###+###", "###########", ".#########.", "..#.....#..", ".#.......#."]],
    c: [["....####....", ".##########.", "############", "###++##++###", "############", "...##..##...", "..##.##.##..", "##........##"],
        ["....####....", ".##########.", "############", "###++##++###", "############", "..###..###..", ".##..##..##.", "..##....##.."]],
    // the suit's helmet, seen from behind the HUD
    suit: [["....#####....", "..#########..", ".###########.", ".##+++#+++##.", ".###########.", "..##.###.##..", "..##.....##..", "...#######...", "....#####...."]],
    leviathan: [["....########....", "..############..", ".##+##+##+##+##.", "################", "..###......###..", "...#........#..."]],
  };
  const POINTS = { a: 30, b: 20, c: 10 };
  const ROW_KIND = ["a", "b", "b", "c", "c"];
  let cache = null;   // built on first open (and again when the accent colour changes)
  function sprites() {
    if (cache) return cache;
    cache = {};
    const main = `rgb(${HUD.C})`, core = "rgb(235,255,255)";
    for (const [name, frames] of Object.entries(ART)) {
      cache[name] = frames.map((rows) => {
        const c = document.createElement("canvas");
        c.width = rows[0].length; c.height = rows.length;
        const g = c.getContext("2d");
        rows.forEach((row, y) => [...row].forEach((ch, x) => {
          if (ch === ".") return;
          g.fillStyle = ch === "+" ? core : name === "leviathan" ? `rgb(${HUD.CRIT})` : main;
          g.fillRect(x, y, 1, 1);
        }));
        return c;
      });
    }
    return cache;
  }

  const LINES = {
    start: ["Chitauri forces inbound, sir. Repulsors are charged.", "Hostile formation detected. Defence grid online.",
      "They're coming in from above, sir. I suggest shooting them."],
    wave: ["Formation cleared, sir. Another one is approaching.", "Wave neutralised. I'm detecting more of them.",
      "Well done, sir. Though I'm afraid there are more."],
    hit: ["We've taken a hit, sir. Rerouting power.", "Armour integrity compromised. Do try to dodge.", "That one got through, sir."],
    unibeam: ["Unibeam fully charged, sir. Press X.", "The unibeam is ready whenever you are, sir."],
    leviathan: ["Leviathan overhead, sir.", "Something large is passing above us."],
    over: ["The suit has sustained critical damage, sir. Perhaps we should try that again.",
      "Systems failing. I'd recommend a rematch, sir."],
    landed: ["They've reached the ground, sir. I did suggest shooting them sooner."],
    best: ["A new record, sir. I've taken the liberty of saving it.", "Highest score to date, sir. Shall I alert the press?"],
  };

  // ------------------------------------------------------------ state
  let mode = "title";   // title | play | pause | over
  let raf = 0, last = 0, shown = false, t = 0;
  let W = 0, H = 0, s = 1, ox = 0, oy = 0;
  let best = store.get("jarvis.invadersBest", 0), runs = store.get("jarvis.invadersRuns", 0);
  let score, lives, wave, player, shot, foes, fx, fy, fdir, ftick, fframe, bolts, barriers, ufo, ufoAt, beam, charge, chargedSaid,
    fireAt, sparks, newBest, keys = {};
  const active = () => shown && HUD.theme.skin === "jarvis";

  function say(key, speak = false) {
    const text = pick(LINES[key]);
    $("inv-say").textContent = "J.A.R.V.I.S.: " + text;
    if (speak) API.speak(text);
  }

  function newWave() {
    foes = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) foes.push({ r, c, kind: ROW_KIND[r], alive: true });
    fx = 22; fy = 26 + Math.min(5, wave - 1) * 6; fdir = 1; ftick = 0; fframe = 0;
    bolts = []; shot = null; beam = null; fireAt = 1.2;
  }
  function newBarriers() {
    // four arches, each 22 x 14 units of destructible blocks
    barriers = [];
    const shape = (x, y) => !(y > 8 && x > 6 && x < 15) && !(y < 3 && (x < 3 - y || x > 18 + y));
    for (let i = 0; i < 4; i++) {
      const cells = new Uint8Array(22 * 14);
      for (let y = 0; y < 14; y++) for (let x = 0; x < 22; x++) cells[y * 22 + x] = shape(x, y) ? 1 : 0;
      barriers.push({ x: 24 + i * 54, y: 146, cells });
    }
  }
  function reset() {
    score = 0; lives = 3; wave = 1; charge = 0; chargedSaid = false; newBest = false; sparks = [];
    player = { x: LW / 2, hit: 0 };
    ufo = null; ufoAt = 18 + Math.random() * 10;
    newWave(); newBarriers();
  }

  // ------------------------------------------------------------ run control (the frame loop only exists while playing)
  function start() { layout(); reset(); mode = "play"; runs++; store.set("jarvis.invadersRuns", runs); say("start", true); loop(); controls(); }
  function pause() { if (mode !== "play") return; mode = "pause"; stopLoop(); keys = {}; draw(); controls(); }
  function resume() { if (mode !== "pause") return; mode = "play"; loop(); controls(); }
  function stop() { stopLoop(); mode = "title"; draw(); controls(); }
  function loop() { stopLoop(); last = performance.now(); raf = requestAnimationFrame(frame); }
  function stopLoop() { if (raf) cancelAnimationFrame(raf); raf = 0; }
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    if (dt < 1 / 62) return;   // ~60 fps is plenty, even on a 120 Hz screen
    last = now;
    update(dt); if (mode === "play" || mode === "over") draw();
  }

  // ------------------------------------------------------------ update
  const alive = () => foes.filter((f) => f.alive);
  const foeBox = (f) => ({ x: fx + f.c * 18 + (f.kind === "a" ? 2 : f.kind === "b" ? 0.5 : 0), y: fy + f.r * 14, w: ART[f.kind][0][0].length, h: 8 });
  const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  function update(dt) {
    t += dt;
    const p = player;
    // the suit
    const move = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    p.x = Math.max(9, Math.min(LW - 9, p.x + move * 95 * dt));
    if (p.hit > 0) p.hit -= dt;
    if (keys.fire && !shot && p.hit <= 0.8) shot = { x: p.x, y: PLAYER_Y - 4 };
    // the formation marches faster as it thins out
    const live = alive();
    if (!live.length) { wave++; score += 100; say("wave"); newWave(); return; }
    const speed = (8 + (COLS * ROWS - live.length) * 0.75) * (1 + (wave - 1) * 0.12);
    fx += fdir * speed * dt;
    ftick += speed * dt;
    if (ftick > 6) { ftick = 0; fframe ^= 1; }
    let minX = Infinity, maxX = -Infinity, maxY = 0;
    for (const f of live) { const b = foeBox(f); minX = Math.min(minX, b.x); maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h); }
    if ((fdir > 0 && maxX >= LW - 4) || (fdir < 0 && minX <= 4)) { fdir = -fdir; fy += 6; }
    if (maxY >= PLAYER_Y - 4) return gameOver("landed");
    // marching through a barrier wears it away
    for (const f of live) { const b = foeBox(f); if (b.y + b.h > 146) erase(b.x + b.w / 2, b.y + b.h, b.w / 2 + 1); }
    // enemy fire: from the lowest Chitauri in a random column
    fireAt -= dt;
    if (fireAt <= 0) {
      const cols = [...new Set(live.map((f) => f.c))], c = pick(cols);
      const low = live.filter((f) => f.c === c).sort((a, b) => b.r - a.r)[0], b = foeBox(low);
      if (bolts.length < 3 + wave) bolts.push({ x: b.x + b.w / 2, y: b.y + b.h, vy: 55 + wave * 6 });
      fireAt = Math.max(0.25, (1.1 - wave * 0.08) * (0.4 + Math.random()));
    }
    // repulsor shot
    if (shot) {
      shot.y -= 230 * dt;
      if (shot.y < 8) shot = null;
      else if (hitBarrier(shot.x, shot.y)) shot = null;
      else {
        for (const f of live) if (overlap({ x: shot.x - 0.5, y: shot.y, w: 1, h: 4 }, foeBox(f))) { kill(f); shot = null; break; }
        if (shot && ufo && overlap({ x: shot.x - 0.5, y: shot.y, w: 1, h: 4 }, { x: ufo.x, y: 12, w: 16, h: 6 })) {
          const pts = pick([50, 100, 150, 300]); score += pts; spark(ufo.x + 8, 15, 18, `rgb(${HUD.CRIT})`, `+${pts}`); ufo = null; shot = null;
        }
        if (shot) for (let i = 0; i < bolts.length; i++) if (Math.abs(bolts[i].x - shot.x) < 2 && Math.abs(bolts[i].y - shot.y) < 4) { bolts.splice(i, 1); shot = null; break; }
      }
    }
    // the unibeam: a column of light from the chest, for half a second
    if (beam) {
      beam.left -= dt;
      for (const f of alive()) { const b = foeBox(f); if (b.x < beam.x + 6 && b.x + b.w > beam.x - 6) kill(f, true); }
      bolts = bolts.filter((b) => Math.abs(b.x - beam.x) > 6);
      if (beam.left <= 0) beam = null;
    }
    // enemy bolts
    for (const b of bolts) b.y += b.vy * dt;
    bolts = bolts.filter((b) => {
      if (b.y > GROUND) return false;
      if (hitBarrier(b.x, b.y + 3)) return false;
      if (p.hit <= 0 && overlap({ x: b.x - 0.5, y: b.y, w: 1, h: 4 }, { x: p.x - 6, y: PLAYER_Y, w: 13, h: 9 })) { hurt(); return false; }
      return true;
    });
    if (mode !== "play") return;
    // the Leviathan
    ufoAt -= dt;
    if (!ufo && ufoAt <= 0) { const dir = Math.random() < 0.5 ? 1 : -1; ufo = { x: dir > 0 ? -16 : LW, dir }; ufoAt = 20 + Math.random() * 15; if (Math.random() < 0.5) say("leviathan"); }
    if (ufo) { ufo.x += ufo.dir * 32 * dt; if (ufo.x < -20 || ufo.x > LW + 4) ufo = null; }
    for (const sp of sparks) sp.age += dt;
    sparks = sparks.filter((sp) => sp.age < (sp.text ? 1 : 0.5));
  }
  function kill(f, byBeam = false) {
    f.alive = false;
    score += POINTS[f.kind];
    const b = foeBox(f);
    spark(b.x + b.w / 2, b.y + 4, 8, `rgb(${HUD.C})`);
    if (!byBeam && charge < 1) {
      charge = Math.min(1, charge + 0.07);
      if (charge >= 1 && !chargedSaid) { chargedSaid = true; say("unibeam", true); }
    }
  }
  function spark(x, y, n, colour, text = "") {
    const parts = [];
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, v = 20 + Math.random() * 40; parts.push([Math.cos(a) * v, Math.sin(a) * v]); }
    sparks.push({ x, y, parts, colour, text, age: 0 });
  }
  function hurt() {
    lives--; player.hit = 1.6; spark(player.x, PLAYER_Y + 4, 16, `rgb(${HUD.WARN})`);
    if (lives <= 0) return gameOver("over");
    say("hit");
  }
  function gameOver(why) {
    stopLoop(); mode = "over";
    if (score > best) { best = score; newBest = true; store.set("jarvis.invadersBest", best); }
    say(newBest ? "best" : why, true);
    draw(); controls();
  }
  // barrier blocks: a hit knocks out a small crater
  function hitBarrier(x, y) {
    for (const br of barriers) {
      const cx = Math.floor(x - br.x), cy = Math.floor(y - br.y);
      if (cx >= 0 && cx < 22 && cy >= 0 && cy < 14 && br.cells[cy * 22 + cx]) { erase(x, y, 2); return true; }
    }
    return false;
  }
  function erase(x, y, r) {
    for (const br of barriers) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r + (Math.random() < 0.5 ? 1 : 0)) continue;
        const cx = Math.floor(x - br.x + dx), cy = Math.floor(y - br.y + dy);
        if (cx >= 0 && cx < 22 && cy >= 0 && cy < 14) br.cells[cy * 22 + cx] = 0;
      }
    }
  }

  // ------------------------------------------------------------ drawing
  function layout() {
    const r = HUD.fit(canvas);
    W = r.w; H = r.h;
    s = Math.min(W / LW, H / LH);
    ox = (W - LW * s) / 2; oy = (H - LH * s) / 2;
  }
  const X = (x) => ox + x * s, Y = (y) => oy + y * s;
  function img(sprite, x, y) { ctx.drawImage(sprite, X(x), Y(y), sprite.width * s, sprite.height * s); }
  function txt(str, x, y, size, colour, align = "center") {
    ctx.font = `${Math.round(size * s)}px "Orbitron", sans-serif`; ctx.textAlign = align; ctx.textBaseline = "middle";
    ctx.fillStyle = colour; ctx.fillText(str, X(x), Y(y));
  }
  function draw() {
    if (!W) layout();
    const sp = sprites(), C = HUD.C;
    ctx.imageSmoothingEnabled = false;
    // deep space, with a faint holographic grid
    ctx.fillStyle = "#01070c"; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = `rgba(${C},.07)`; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= LW; x += 20) { ctx.moveTo(X(x), Y(0)); ctx.lineTo(X(x), Y(LH)); }
    for (let y = 0; y <= LH; y += 20) { ctx.moveTo(X(0), Y(y)); ctx.lineTo(X(LW), Y(y)); }
    ctx.stroke();
    ctx.strokeStyle = `rgba(${C},.5)`; ctx.strokeRect(X(0), Y(0), LW * s, LH * s);
    if (mode === "title") return drawTitle(sp, C);

    ctx.shadowColor = `rgba(${C},.8)`; ctx.shadowBlur = 6;
    for (const f of foes) if (f.alive) { const b = foeBox(f); img(sp[f.kind][fframe], b.x, b.y); }
    if (ufo) { ctx.shadowColor = `rgba(${HUD.CRIT},.8)`; img(sp.leviathan[0], ufo.x, 12); ctx.shadowColor = `rgba(${C},.8)`; }
    // barriers: arc-light blocks
    ctx.fillStyle = `rgba(${C},.75)`;
    for (const br of barriers) for (let y = 0; y < 14; y++) for (let x = 0; x < 22; x++) if (br.cells[y * 22 + x]) ctx.fillRect(X(br.x + x), Y(br.y + y), Math.ceil(s), Math.ceil(s));
    // the suit (flickering while it recovers from a hit)
    if (player.hit <= 0 || Math.floor(t * 12) % 2) img(sp.suit[0], player.x - 6.5, PLAYER_Y);
    // shots
    ctx.fillStyle = "rgb(235,255,255)";
    if (shot) ctx.fillRect(X(shot.x - 0.5), Y(shot.y), Math.max(2, s), 4 * s);
    ctx.shadowColor = `rgba(${HUD.CRIT},.9)`; ctx.fillStyle = `rgb(${HUD.CRIT})`;
    for (const b of bolts) { const z = Math.floor(t * 10 + b.x) % 2; ctx.fillRect(X(b.x - 0.5 + (z ? 0.5 : -0.5)), Y(b.y), Math.max(2, s), 4 * s); }
    if (beam) {
      const a = Math.min(1, beam.left * 3);
      const g = ctx.createLinearGradient(X(beam.x - 6), 0, X(beam.x + 6), 0);
      g.addColorStop(0, `rgba(${C},0)`); g.addColorStop(0.5, `rgba(235,255,255,${a})`); g.addColorStop(1, `rgba(${C},0)`);
      ctx.shadowColor = `rgba(${C},1)`; ctx.shadowBlur = 20; ctx.fillStyle = g;
      ctx.fillRect(X(beam.x - 6), Y(0), 12 * s, (PLAYER_Y - 1) * s);
    }
    ctx.shadowBlur = 0;
    for (const e of sparks) {
      const k = 1 - e.age / (e.text ? 1 : 0.5);
      if (e.text) { txt(e.text, e.x, e.y - e.age * 10, 6, `rgba(${HUD.CRIT},${k})`); continue; }
      ctx.fillStyle = e.colour; ctx.globalAlpha = k;
      for (const [vx, vy] of e.parts) ctx.fillRect(X(e.x + vx * e.age), Y(e.y + vy * e.age), Math.max(1, s * 0.8), Math.max(1, s * 0.8));
      ctx.globalAlpha = 1;
    }
    // ground line and readouts
    ctx.fillStyle = `rgba(${C},.8)`; ctx.fillRect(X(4), Y(GROUND), (LW - 8) * s, Math.max(1, s * 0.6));
    txt(`SCORE ${String(score).padStart(5, "0")}`, 6, 6, 6, `rgb(${C})`, "left");
    txt(`HI ${String(best).padStart(5, "0")}`, LW / 2, 6, 6, `rgb(${C})`);
    txt(`WAVE ${wave}`, LW - 6, 6, 6, `rgb(${C})`, "right");
    for (let i = 0; i < lives; i++) ctx.drawImage(sp.suit[0], X(6 + i * 15), Y(189), 13 * s * 0.7, 9 * s * 0.7);
    // unibeam charge
    const bw = 60, bx = LW - 6 - bw;
    txt("UNIBEAM", bx - 3, 193, 4.5, charge >= 1 ? "rgb(235,255,255)" : `rgba(${C},.8)`, "right");
    ctx.strokeStyle = `rgba(${C},.8)`; ctx.strokeRect(X(bx), Y(190.5), bw * s, 5 * s);
    ctx.fillStyle = charge >= 1 && Math.floor(t * 4) % 2 ? "rgb(235,255,255)" : `rgb(${C})`;
    ctx.fillRect(X(bx + 0.8), Y(191.3), (bw - 1.6) * charge * s, 3.4 * s);
    if (mode === "pause") banner("PAUSED", "P / ESC / SPACE TO RESUME");
    if (mode === "over") banner(newBest ? "NEW RECORD" : "SUIT OFFLINE", `SCORE ${score}  ·  HI ${best}  ·  SPACE TO RETRY`);
  }
  function banner(title, sub) {
    ctx.fillStyle = "rgba(1,10,18,.85)"; ctx.fillRect(X(30), Y(72), 180 * s, 50 * s);
    ctx.strokeStyle = `rgba(${HUD.C},.9)`; ctx.strokeRect(X(30), Y(72), 180 * s, 50 * s);
    ctx.shadowColor = `rgba(${HUD.C},.9)`; ctx.shadowBlur = 10;
    txt(title, LW / 2, 89, 13, "rgb(235,255,255)");
    ctx.shadowBlur = 0;
    txt(sub, LW / 2, 109, 5.5, `rgb(${HUD.C})`);
  }
  function drawTitle(sp, C) {
    ctx.shadowColor = `rgba(${C},.9)`; ctx.shadowBlur = 12;
    txt("DEFENSE GRID", LW / 2, 34, 18, "rgb(235,255,255)");
    ctx.shadowBlur = 0;
    txt("STARK INDUSTRIES · CHITAURI COUNTERMEASURES", LW / 2, 50, 5, `rgb(${C})`);
    ctx.shadowBlur = 6;
    const rows = [["a", 30], ["b", 20], ["c", 10]];
    rows.forEach(([k, pts], i) => {
      img(sp[k][Math.floor(t * 2) % 2], 88 - ART[k][0][0].length / 2, 64 + i * 15);
      txt(`= ${pts} PTS`, 104, 68 + i * 15, 6, `rgb(${C})`, "left");
    });
    ctx.shadowColor = `rgba(${HUD.CRIT},.8)`; img(sp.leviathan[0], 80, 109);
    txt("= ???", 104, 112, 6, `rgb(${HUD.CRIT})`, "left");
    ctx.shadowBlur = 0;
    txt("←/→ MOVE  ·  SPACE FIRE  ·  X UNIBEAM  ·  P PAUSE", LW / 2, 140, 5.5, `rgb(${C})`);
    txt(best ? `HI ${best}  ·  ${runs} SORTIE${runs === 1 ? "" : "S"}  ·  SPACE TO LAUNCH` : "PRESS SPACE TO LAUNCH", LW / 2, 162, 7, "rgb(235,255,255)");
  }

  // ------------------------------------------------------------ input
  const MAP = { ArrowLeft: "left", a: "left", A: "left", ArrowRight: "right", d: "right", D: "right", " ": "fire" };
  document.addEventListener("keydown", (e) => {
    if (!active() || HUD.isTyping(e) || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === " " && mode !== "play") { mode === "pause" ? resume() : start(); e.preventDefault(); return; }
    if (MAP[e.key]) { keys[MAP[e.key]] = true; if (mode === "play") e.preventDefault(); return; }
    if ((e.key === "x" || e.key === "X") && mode === "play" && charge >= 1 && !beam) {
      beam = { x: player.x, left: 0.5 }; charge = 0; chargedSaid = false; e.preventDefault();
    } else if (e.key === "p" || e.key === "P" || e.key === "Escape") { mode === "play" ? pause() : resume(); e.preventDefault(); }
  });
  document.addEventListener("keyup", (e) => { if (MAP[e.key]) keys[MAP[e.key]] = false; });
  canvas.addEventListener("pointerdown", (e) => { e.preventDefault(); if (mode !== "play") mode === "pause" ? resume() : start(); });

  // ------------------------------------------------------------ buttons, menu life cycle
  function controls() {
    $("inv-start").textContent = mode === "play" ? "PAUSE" : mode === "pause" ? "RESUME" : mode === "over" ? "RETRY" : "LAUNCH";
    $("inv-stop").disabled = mode === "title";
    $("inv-best").textContent = best ? `Best ${best}` : "";
  }
  // buttons give focus back at once, or Space would both fire and press the button again
  $("inv-start").addEventListener("click", (e) => { e.currentTarget.blur(); mode === "play" ? pause() : mode === "pause" ? resume() : start(); });
  $("inv-stop").addEventListener("click", (e) => { e.currentTarget.blur(); stop(); });
  new ResizeObserver(() => { if (shown) { layout(); if (mode !== "play") draw(); } }).observe(canvas);
  document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });
  window.addEventListener("blur", () => { keys = {}; });   // no stuck keys after alt-tab
  HUD.onTheme((th) => {
    cache = null;   // the sprites are drawn in the accent colour
    if (th.skin !== "jarvis") { if (mode !== "title") stop(); if (shown) J.show("home"); }
    else if (shown && mode !== "play") draw();
  });

  J.invaders = {
    onShow() {
      shown = true; layout(); draw(); controls();
      if (mode === "title") $("inv-say").textContent = "J.A.R.V.I.S.: " + (best ? `Your record stands at ${best}, sir.` : "Defence grid standing by, sir.");
    },
    onHide() { shown = false; pause(); },
    start, stop,
    state: () => ({ mode, score, best, runs, wave, lives, looping: !!raf, alive: foes ? alive().length : 0, built: !!cache }),
  };
})();
