/* Aoi Asahina theme extras: pixel Hina living above the status bar (reacts to the machine and to
   clicks, dances to Spotify via js/dance.js), feeding her donuts, swim practice (a focus timer with
   breaks), and ripples in the pool.
   Everything is inert in the other themes. Commands arrive as {type: "hina"} actions (console.js). */
(function () {
  const J = (window.JARVIS = window.JARVIS || {});
  const $ = (id) => document.getElementById(id);
  const on = () => HUD.theme.skin === "asahina";
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };

  const LINES = {
    poke: ["Hey! That tickles!", "Wanna race? Last one to the pool buys donuts!", "Ten more laps? Sure, why not!",
      "Did you drink enough water today? Hydration is important!", "Sakura's training in the gym. I'm keeping you company!",
      "Hup! Hehe, I can jump way higher than that!", "Don't forget to stretch! Your back will thank you!"],
    busy: ["Whoa, the computer's really working hard! Go, go, go!", "We're sprinting now! Keep it up!"],
    hot: ["Phew, it's getting hot in here! Time for a cool down!", "So hot... I need to jump in the pool!"],
    battery: ["Battery's getting low! I need a snack break. And so does the laptop!"],
    eat: ["Nom nom nom! Mmm!", "Sugar power, activate!", "Donuts are the best fuel for swimmers!", "One more? Just one more!"],
    full: ["That's {n} donuts today! Okay, okay, maybe I'll do some extra laps.", "{n} donuts! A new personal record?!"],
    swimEnd: ["Lap {n} done! Rest time! Grab some water. Or a donut!", "Great lap! That's {n}! Take a breather, you earned it!"],
    restEnd: ["Break's over! Back in the water!", "Okay, rest time's up! Let's go, lap {n}!"],
    half: ["Halfway there! Keep that pace!", "You're doing great! Don't slow down now!"],
  };
  const fill = (s, n) => s.replace("{n}", n);

  // ------------------------------------------------------------ buddy (pixel Hina)
  const buddy = $("hina-buddy"), bctx = buddy.getContext("2d"), bubble = $("hina-bubble");
  let mood = "idle", jumpT = 0, bubbleTimer = null, lastMoodLine = 0;
  function say(text, { speak = true, ms = 4200 } = {}) {
    if (!on()) return;
    bubble.textContent = text;
    bubble.classList.add("show");
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => bubble.classList.remove("show"), ms);
    if (speak) API.speak(text);
  }
  function jump() { jumpT = 0.7; }
  HUD.loop((dt, t) => {
    if (!on() || buddy.offsetParent === null) return;
    const { w, h, dpr } = HUD.fit(buddy);
    bctx.clearRect(0, 0, w, h);
    const px = Math.floor(Math.min(w / 25, h / 38));
    if (J.dance.dancing() && jumpT <= 0) { J.dance.draw(bctx, w, h, t, px, "hina", null); return; }   // js/dance.js
    const busy = mood === "busy" || practice.phase === "swim";
    jumpT = Math.max(0, jumpT - dt);
    const hop = jumpT > 0 ? Math.sin((jumpT / 0.7) * Math.PI) * px * 8 : Math.abs(Math.sin(t * (busy ? 9 : 2.2))) * px * (busy ? 1.5 : 0.6);
    const legs = busy || jumpT > 0 ? 1 + (Math.floor(t * (busy ? 10 : 6)) % 2) : 0;
    const x0 = (w - px * 23) / 2, y0 = h - px * 35 - hop;
    // shadow on the "floor"
    bctx.fillStyle = "rgba(0,0,0,.25)";
    bctx.beginPath(); bctx.ellipse(w / 2, h - px * 0.8, px * (7 - hop / px / 3), px * 1.2, 0, 0, Math.PI * 2); bctx.fill();
    HUD.drawSprite(bctx, x0, y0, px, { legs, blush: mood === "hot" || jumpT > 0 });
    if (mood === "hot") {   // sweat drop by her forehead
      const d = (t * 1.5) % 1;
      bctx.fillStyle = `rgba(${HUD.ALT},${1 - d})`;
      bctx.beginPath(); bctx.arc(x0 + px * 21, y0 + px * (14 + d * 5), px * 0.9, 0, Math.PI * 2); bctx.fill();
    }
  });
  buddy.addEventListener("click", () => {
    jump();
    const n = donutsToday();
    say(Math.random() < 0.25 && n ? fill(pick(LINES.full), n) : pick(LINES.poke));
  });
  API.onStats((d) => {
    if (!on()) return;
    const temp = Math.max(d.cpu.temp || 0, d.gpu.nvidia.state === "active" ? d.gpu.nvidia.temp || 0 : 0);
    const bat = d.battery;
    const next = temp >= HUD.cfg.warn ? "hot" : d.cpu.percent >= 60 ? "busy" : bat && !bat.plugged && bat.percent <= 15 ? "low" : "idle";
    // a remark when the mood changes, at most every 2 minutes and never during practice (she's coaching)
    if (next !== mood && next !== "idle" && performance.now() - lastMoodLine > 120000 && !practice.phase) {
      lastMoodLine = performance.now();
      say(pick(next === "hot" ? LINES.hot : next === "busy" ? LINES.busy : LINES.battery), { speak: false });
    }
    mood = next;
  });

  // ------------------------------------------------------------ donuts
  function donutsToday() {
    const d = store.get("hina.donuts", {});
    return d.day === new Date().toDateString() ? d.n : 0;
  }
  function donut({ quiet = false } = {}) {
    if (!on()) return;
    HUD.donutBites++;
    jump();
    if (HUD.donutBites >= 3) {   // three bites and it's gone; a fresh one appears
      setTimeout(() => { HUD.donutBites = 0; }, 900);
      const n = donutsToday() + 1;
      store.set("hina.donuts", { day: new Date().toDateString(), n });
      if (!quiet) say(n > 1 && n % 3 === 0 ? fill(pick(LINES.full), n) : pick(LINES.eat), { speak: n % 3 === 0 });
    } else if (!quiet) say(pick(LINES.eat), { speak: false, ms: 1800 });
  }
  ["logo-reactor", "home-reactor", "core"].forEach((id) => {
    const c = $(id);
    if (!c) return;
    c.addEventListener("click", (e) => {
      if (!on()) return;
      // on the SYSTEMS core only the donut in the middle counts
      if (id === "core") {
        const r = c.getBoundingClientRect(), dx = e.clientX - r.left - r.width / 2, dy = e.clientY - r.top - r.height / 2;
        if (Math.hypot(dx, dy) > Math.min(r.width, r.height) * 0.14) return;
      }
      donut();
    });
  });

  // ------------------------------------------------------------ ripples
  document.addEventListener("pointerdown", (e) => {
    if (!on() || e.target.closest("button, input, select, textarea, a, .xterm, #hina-buddy")) return;
    HUD.ripple(e.clientX, e.clientY);
  });

  // ------------------------------------------------------------ swim practice
  // Swim N minutes, rest N/5 (at least 1), repeat. Survives a restart of the app (localStorage).
  const box = $("hina-practice");
  const practice = store.get("hina.practice", {});
  const save = () => store.set("hina.practice", practice);
  function startPractice(minutes = 25) {
    Object.assign(practice, { minutes, phase: "swim", lap: 1, ends: Date.now() + minutes * 60000, half: false, paused: null });
    save(); render();
  }
  function stopPractice({ quiet = true } = {}) {
    const laps = practice.phase ? practice.lap - (practice.phase === "swim" ? 1 : 0) : 0;
    for (const k of Object.keys(practice)) delete practice[k];
    save(); render();
    if (!quiet) say(laps ? `Practice over! ${laps} lap${laps > 1 ? "s" : ""} done. Great work today!` : "Practice over! We'll go again next time!");
  }
  function pause() {
    if (!practice.phase) return;
    if (practice.paused) { practice.ends = Date.now() + practice.paused; practice.paused = null; }
    else practice.paused = practice.ends - Date.now();
    save(); render();
  }
  function tick() {
    if (!practice.phase || practice.paused) return;
    const left = practice.ends - Date.now();
    const rest = Math.max(1, Math.round(practice.minutes / 5));
    if (practice.phase === "swim" && !practice.half && left < (practice.minutes * 60000) / 2) {
      practice.half = true; save();
      if (practice.minutes >= 10) say(pick(LINES.half), { speak: false });
    }
    if (left > 0) return;
    if (practice.phase === "swim") {
      Object.assign(practice, { phase: "rest", ends: Date.now() + rest * 60000 });
      say(fill(pick(LINES.swimEnd), practice.lap), { ms: 8000 });
      HUD.toast(`LAP ${practice.lap} DONE · REST ${rest} MIN`);
    } else {
      practice.lap++;
      Object.assign(practice, { phase: "swim", ends: Date.now() + practice.minutes * 60000, half: false });
      say(fill(pick(LINES.restEnd), practice.lap), { ms: 8000 });
      HUD.toast(`LAP ${practice.lap} · ${practice.minutes} MIN`);
    }
    jump(); save();
  }
  function render() {
    box.classList.toggle("show", !!practice.phase);
    if (!practice.phase) return;
    const left = Math.max(0, practice.paused ?? practice.ends - Date.now());
    const total = (practice.phase === "swim" ? practice.minutes : Math.max(1, Math.round(practice.minutes / 5))) * 60000;
    const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
    box.dataset.phase = practice.phase;
    $("hp-phase").textContent = practice.paused ? "PAUSED" : practice.phase === "swim" ? "IN THE WATER" : "REST";
    $("hp-time").textContent = `${m}:${String(s).padStart(2, "0")}`;
    $("hp-lap").textContent = `LAP ${practice.lap}`;
    $("hp-bar").style.width = `${100 - (100 * left) / total}%`;
    $("hp-pause").textContent = practice.paused ? "GO" : "PAUSE";
  }
  setInterval(() => { tick(); render(); }, 1000);
  $("hp-pause").addEventListener("click", pause);
  $("hp-stop").addEventListener("click", () => stopPractice({ quiet: false }));
  render();
  // practice belongs to Hina: leaving her theme ends it
  HUD.onTheme((th) => { if (th.skin !== "asahina" && practice.phase) stopPractice(); });

  // ------------------------------------------------------------ console actions
  J.hina = {
    action(a) {
      if (!on()) return;
      if (a.do === "donut") donut({ quiet: true });
      else if (a.do === "practice") { startPractice(a.minutes || 25); jump(); }
      else if (a.do === "stop") stopPractice();
      else if (a.do === "cheer") jump();
    },
    say, jump,
  };
})();
