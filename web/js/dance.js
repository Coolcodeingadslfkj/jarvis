/* Dancing pixel characters for the MUSIC menu: Hina in the Aoi Asahina theme, Celestia in hers. They move
   to the cava bars and beats from js/music.js; a new move every few beats, each shaped by the bass and by
   how far we are into the beat. Hina is all energy; Celestia waltzes, curtsies and twirls, and scatters
   playing-card suits where Hina scatters notes. js/hina.js uses the same engine for the buddy. */
(function () {
  const J = (window.JARVIS = window.JARVIS || {});
  const pick = (a) => a[Math.floor(Math.random() * a.length)];

  // ------------------------------------------------------------ Hina: bounce, sway, spin, jump, squat, shuffle
  function hinaPose(p, d, m, into, t) {
    const kick = 1 - into, side = m.beats % 2 ? 1 : -1, bass = m.bass;
    p.hop = bass * 2;
    switch (d.move) {
      case "bounce": p.hop = bass * 5 + kick * 3; p.legs = kick > 0.5 ? 1 : 0; break;
      case "sway": p.lean = side * Math.sin(into * Math.PI) * 3.5; p.hop = bass * 2; break;
      case "spin": {
        // a real turn, once every two beats: she narrows as if rotating, faces the other way at the
        // halfway point and widens again (a bare mirror swap looks like flicker)
        const facing = Math.floor(m.beats / 2) % 2 === 1, turning = m.beats % 2 === 0, u = Math.min(1, into / 0.6);
        if (turning && u < 1) { p.sx = Math.max(0.12, Math.abs(Math.cos(Math.PI * u))); p.flip = u < 0.5 ? !facing : facing; }
        else p.flip = facing;
        p.hop = bass * 3 + (turning ? Math.sin(Math.PI * u) * 2 : 0);
        break;
      }
      case "jump": p.hop = Math.sin(Math.PI * Math.min(1, into * 1.4)) * (6 + bass * 6); p.legs = p.hop > 2 ? 2 : 0; break;
      case "squat": p.sy = 1 - 0.22 * kick; p.hop = 0; break;
      case "shuffle": p.dx = Math.sin(into * Math.PI) * side * 3; p.legs = 1 + (Math.floor(t * 8) % 2); p.flip = side > 0; break;
    }
  }

  // ------------------------------------------------------------ Celestia: waltz, curtsy, twirl, regal
  // Slower and smaller than Hina: phrases span two or four beats, and her feet never leave the floor.
  function celestiaPose(p, d, m, into, t) {
    const bass = m.bass;
    switch (d.move) {
      case "waltz": {   // a lilting side-to-side sway over two beats
        const ph = ((m.beats % 2) + into) / 2;
        p.lean = Math.sin(ph * Math.PI * 2) * 2;
        p.dx = Math.sin(ph * Math.PI * 2) * 1.5;
        p.hop = bass * 0.6;
        break;
      }
      case "curtsy": {   // a dip on the first beat of every four, then she rises and holds
        if (m.beats % 4 === 0) { const s = Math.sin(Math.PI * into); p.sy = 1 - 0.12 * s; p.lean = -0.8 * s; }
        p.hop = bass * 0.4;
        break;
      }
      case "twirl": {   // one slow turn over two beats, every four beats, facing the other way after
        const facing = Math.floor(m.beats / 4) % 2 === 1, k = m.beats % 4;
        if (k < 2) {
          const u = (k + into) / 2;
          p.sx = Math.max(0.12, Math.abs(Math.cos(Math.PI * u)));
          p.flip = u < 0.5 ? !facing : facing;
          p.hop = Math.sin(Math.PI * u) * 1.2;
        } else p.flip = facing;
        break;
      }
      case "regal": p.hop = bass * 1.2; p.lean = Math.sin(t * 1.5) * 0.6; break;   // composed, a gentle bob
    }
  }

  const DANCERS = {
    hina: { sprite: "hina", art: () => HUD.HINA, moves: ["bounce", "sway", "spin", "jump", "squat", "shuffle"], every: [4, 8], pose: hinaPose,
      sparks: { glyphs: ["♪", "♫"], colour: () => (Math.random() < 0.5 ? HUD.C : HUD.ALT), beats: 1, size: 6, life: 1.6 } },
    celestia: { sprite: "celestia", art: () => HUD.CELESTIA, moves: ["waltz", "curtsy", "twirl", "regal"], every: [8, 8], pose: celestiaPose,
      // red suits in her crimson, black suits in gold
      sparks: { glyphs: ["♠", "♥", "♦", "♣"], colour: (g) => (g === "♥" || g === "♦" ? HUD.C : HUD.ALT), beats: 2, size: 5, life: 2.4 } },
  };
  const state = {};
  for (const k in DANCERS) state[k] = { move: DANCERS[k].moves[0], beats: 0, until: DANCERS[k].every[0] };

  const dancing = () => !!(J.music && J.music.playing && J.music.raw);
  // in a duet both change moves on the same beats (every 8), and every third change they turn together
  const TOGETHER = { hina: "spin", celestia: "twirl" };
  function pose(who, t) {
    const D = DANCERS[who], d = state[who], m = J.music, now = performance.now();
    if (m.beats !== d.beats) {
      d.beats = m.beats;
      if (duetOn()) {
        if (m.beats % 8 === 0) {
          let next; do next = pick(D.moves); while (next === d.move);
          d.move = (m.beats / 8) % 3 === 0 ? TOGETHER[who] : next;
        }
      } else if (--d.until <= 0) {
        let next; do next = pick(D.moves); while (next === d.move);
        Object.assign(d, { move: next, until: D.every[0] + Math.floor(Math.random() * (D.every[1] - D.every[0] + 1)) });
      }
    }
    const into = Math.min(1, (now - m.beatAt) / Math.max(250, m.interval));   // 0 on the beat .. 1 at the next
    const p = { hop: 0, lean: 0, flip: false, sy: 1, sx: 1, legs: 0, dx: 0 };
    D.pose(p, d, m, into, t);
    return p;
  }

  /* draw `who` dancing, feet on the bottom of a w x h canvas, centred on cx; sparks = {seen, list} to scatter
     notes/suits; walk = -1/+1 while walking on or off stage (left/right) */
  function draw(ctx, w, h, t, px, who, sparks, { cx = w / 2, walk = 0 } = {}) {
    const D = DANCERS[who], art = D.art(), cols = art[0].length, rows = art.length;
    const p = walk ? { hop: Math.abs(Math.sin(t * 10)) * 1.2, lean: walk * 0.8, flip: walk < 0, sy: 1, sx: 1, legs: 1 + (Math.floor(t * 8) % 2), dx: 0 }
      : dancing() ? pose(who, t) : { hop: Math.abs(Math.sin(t * 2.2)) * 0.6, lean: 0, flip: false, sy: 1, sx: 1, legs: 0, dx: 0 };
    const m = J.music, S = D.sparks;
    if (sparks && !walk && dancing() && m.beats !== sparks.seen && m.beats % S.beats === 0) {
      sparks.seen = m.beats;
      const g = pick(S.glyphs);
      sparks.list.push({ x: (Math.random() - 0.5) * cols * 0.6, born: t, s: g, c: S.colour(g), spin: (Math.random() - 0.5) * 2 });
      if (sparks.list.length > 8) sparks.list.shift();
    }
    const x0 = cx - (px * cols) / 2 + p.dx * px, y0 = h - px * (rows + 1.5) - p.hop * px;
    ctx.fillStyle = "rgba(0,0,0,.25)";
    ctx.beginPath(); ctx.ellipse(cx + p.dx * px, h - px * 0.9, px * Math.max(3, cols * 0.3 - p.hop / 3), px * 1.2, 0, 0, Math.PI * 2); ctx.fill();
    HUD.drawSprite(ctx, x0, y0, px, { sprite: D.sprite, legs: p.legs, lean: p.lean, flip: p.flip, sy: p.sy, sx: p.sx, blush: dancing() && m.bass > 0.6 });
    if (sparks) {
      ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = `${px * S.size}px "DejaVu Sans", sans-serif`;
      for (const n of sparks.list) {
        const age = t - n.born;   // seconds, whatever the frame rate
        ctx.save();
        ctx.translate(cx + n.x * px + Math.sin(age * 4) * px * 2, y0 + px * 4 - age * px * (who === "celestia" ? 12 : 18));
        ctx.rotate(n.spin * age);
        ctx.fillStyle = `rgba(${n.c},${Math.max(0, 1 - age / S.life)})`;
        ctx.fillText(n.s, 0, 0);
        ctx.restore();
      }
      sparks.list = sparks.list.filter((n) => t - n.born < S.life);
    }
  }

  // ------------------------------------------------------------ the stage (MUSIC menu, under the track)
  // A small cast: the theme's own character leads; in a duet the other one dances beside her. When the
  // theme changes mid-song the old lead walks off and the new one walks on. Shown by css/asahina.css
  // and css/celestia.css; J.A.R.V.I.S. and DOOM have no dancer, so their stage stays hidden.
  const LEAD = { asahina: "hina", celestia: "celestia" }, PARTNER = { hina: "celestia", celestia: "hina" };
  const stage = document.getElementById("mu-dancer"), sctx = stage.getContext("2d");
  let duet = false;
  try { duet = localStorage.getItem("jarvis.duet") === "1"; } catch (e) {}
  const duetOn = () => duet && !!LEAD[HUD.theme.skin];
  const cast = [];   // {who, pos, target, sparks}: pos/target are fractions of the stage width
  let stagePx = 0, stepT = 0;
  const OFF_L = -0.35, OFF_R = 1.35, SPEED = 0.6;   // walk-on speed in stage widths per second
  function recast(animate) {
    const lead = LEAD[HUD.theme.skin];
    const want = !lead ? {} : duetOn() ? { [lead]: 0.3, [PARTNER[lead]]: 0.7 } : { [lead]: 0.5 };
    for (const p of cast) {
      if (p.who in want) p.target = want[p.who];
      else if (!p.leaving) { p.leaving = true; p.target = p.pos < 0.5 ? OFF_L : OFF_R; }   // off the near side (centre: right)
    }
    const exitRight = cast.some((p) => p.leaving && p.target === OFF_R);
    for (const who in want) {
      if (cast.some((p) => p.who === who)) continue;
      // newcomers walk on from the side they'll stand nearest; to the centre, from the side nobody is leaving by
      const from = want[who] < 0.5 ? OFF_L : want[who] > 0.5 ? OFF_R : exitRight ? OFF_L : OFF_R;
      cast.push({ who, pos: from, target: want[who], sparks: { seen: 0, list: [] } });
    }
    for (const p of cast) if (p.who in want) p.leaving = false;
    if (!animate) {
      for (const p of cast) p.pos = p.target;
      cast.splice(0, cast.length, ...cast.filter((p) => !p.leaving));
    }
  }
  // walk on/off only when someone's watching it happen to music; otherwise just place everyone
  const live = () => dancing() && stage.offsetParent !== null;
  let lastSkin = HUD.theme.skin;
  HUD.onTheme((th) => {
    if (th.skin === lastSkin) return;
    // to a theme without a dancer the stage disappears at once, so there's no walk-off to see
    const animate = live() && !!LEAD[th.skin] && !!LEAD[lastSkin];
    lastSkin = th.skin;
    recast(animate);
    updateDuetButton();
  });
  recast(false);

  HUD.loop((dt, t) => {
    if (!LEAD[HUD.theme.skin] || stage.offsetParent === null) return;
    const { w, h } = HUD.fit(stage);
    sctx.clearRect(0, 0, w, h);
    // everyone shares one pixel size, small enough for whoever is on (or coming on) stage
    const arts = cast.map((p) => DANCERS[p.who].art());
    const span = arts.reduce((n, a) => n + a[0].length, 0) + 7 * Math.max(1, arts.length);
    const tall = Math.max(...arts.map((a) => a.length), 30);
    const want = Math.max(2, Math.floor(Math.min(w / span, h / (tall + 16))));
    // grow or shrink a pixel step at a time (pixel art needs whole pixels), so a partner leaving or
    // arriving reads as a zoom rather than a jump
    stepT += dt;
    if (!stagePx || stagePx > want) stagePx = want;   // never too big for the stage, not even for a frame
    else if (stagePx < want && stepT > 0.07) { stagePx++; stepT = 0; }
    const px = stagePx;
    for (const p of cast) {
      const d = p.target - p.pos;
      p.pos = Math.abs(d) <= SPEED * dt ? p.target : p.pos + Math.sign(d) * SPEED * dt;   // land exactly on the mark
      const walking = Math.abs(p.target - p.pos) > 0.002 ? Math.sign(d) : 0;
      draw(sctx, w, h, t, px, p.who, p.sparks, { cx: p.pos * w, walk: walking });
    }
    for (let i = cast.length - 1; i >= 0; i--) if (cast[i].leaving && cast[i].pos === cast[i].target) cast.splice(i, 1);
  });

  // ------------------------------------------------------------ duet toggle (button in Now Playing; "duet" command)
  const btn = document.getElementById("mu-duet");
  function updateDuetButton() {
    const lead = LEAD[HUD.theme.skin];
    if (!lead) return;
    btn.classList.toggle("on", duet);
    btn.textContent = duet ? "END DUET" : `DUET WITH ${lead === "hina" ? "CELESTIA" : "HINA"}`;
  }
  function setDuet(on) {
    duet = on == null ? !duet : !!on;
    try { localStorage.setItem("jarvis.duet", duet ? "1" : "0"); } catch (e) {}
    recast(live());
    updateDuetButton();
    return duet;
  }
  btn.addEventListener("click", () => setDuet());
  updateDuetButton();

  J.dance = { draw, dancing, state, duet: setDuet, duetOn };   // state.<who>.move: set it to try a move out
})();
