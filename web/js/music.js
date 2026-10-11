/* MUSIC: Spotify with a cava bar visualizer and lyrics that follow the song (current line glows).
   The backend (jarvis/music.py) only runs cava while Spotify plays and something visible draws the
   bars: this menu, or dancing Hina in the Aoi Asahina theme. J.music shares the bars and beats. */
(function () {
  const J = (window.JARVIS = window.JARVIS || {});
  const $ = (id) => document.getElementById(id);
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  let sp = null;               // last Spotify state (null = not running)
  let shown = false;           // MUSIC menu visible
  let posAt = 0, pos = 0;      // position (s) as of posAt (performance.now ms); interpolated while playing
  let trustPos = false;        // some Spotify builds report Position 0 forever; then we count ourselves
  let track = "", lyr = null, lineIdx = -2;
  const M = (J.music = { bars: new Array(48).fill(0), raw: null, bass: 0, beatAt: 0, beats: 0, interval: 500, playing: false });

  // ------------------------------------------------------------ state from the backend
  API.onSpotify((s) => {
    const now = performance.now();
    const changed = !sp || !s || s.id !== sp.id;
    if (s) {
      if (changed) { trustPos = s.position > 0; pos = s.position; posAt = now; }
      else if (s.position > 0) { trustPos = true; }
      if (trustPos) { pos = s.position; posAt = now; }
      else if (s.status !== "Playing") { pos = position(); posAt = now; }   // own clock: freeze on pause
    }
    const wasPlaying = sp && sp.status === "Playing";
    sp = s;
    M.playing = !!(s && s.status === "Playing");
    if (!trustPos && M.playing && !wasPlaying && !changed) posAt = now;   // own clock: resume from where it froze
    if (s && changed && s.title) loadLyrics(s);
    render();
    want();
  });
  function position() {
    if (!sp) return 0;
    const p = pos + (sp.status === "Playing" ? (performance.now() - posAt) / 1000 : 0);
    return sp.length ? Math.min(sp.length, p) : p;
  }
  M.position = position;

  // ------------------------------------------------------------ cava frames + beat detection
  let bassAvg = 0.1;
  // bars are flowing into the open MUSIC menu: the HUD draws at 60 fps meanwhile (app.js); dancing
  // buddy Hina elsewhere is fine at the normal rate
  M.live = () => !!M.raw && shown;
  let boosted = false;
  function boost() {   // apply at once rather than on the next stats tick
    if (M.live() === boosted) return;
    boosted = M.live();
    HUD.setFps(boosted ? 60 : J.baseFps ? J.baseFps() : 20);
  }
  API.onBars((bars) => {
    M.raw = bars;
    boost();
    if (!bars) return;
    const n = bars.length, lo = Math.max(2, Math.round(n / 8));
    let bass = 0;
    for (let i = 0; i < lo; i++) bass += bars[i];
    bass /= lo;
    M.bass = bass;
    const now = performance.now();
    if (bass > bassAvg * 1.35 && bass > 0.22 && now - M.beatAt > 260) {
      const gap = now - M.beatAt;
      if (gap < 1500) M.interval = M.interval * 0.8 + gap * 0.2;   // tempo estimate, for the dance
      M.beatAt = now; M.beats++;
    }
    bassAvg = bassAvg * 0.94 + bass * 0.06;
  });
  // smoothed bars for drawing (shared with the dancer); falls back to rest when stopped
  const peaks = new Array(48).fill(0);
  HUD.loop((dt) => {
    const src = M.raw;
    for (let i = 0; i < M.bars.length; i++) {
      const target = src ? src[Math.min(src.length - 1, i)] || 0 : 0;
      // hits land at once; bars only ease on the way down (any rise smoothing reads as lag)
      M.bars[i] = target >= M.bars[i] ? target : M.bars[i] + (target - M.bars[i]) * Math.min(1, dt * 14);
      peaks[i] = Math.max(M.bars[i], peaks[i] - dt * 0.35);
    }
  });

  // only ask for bars when something on screen uses them
  let wanted = null;
  function want() {
    const w = !!(sp && sp.status === "Playing") && !document.hidden && (shown || HUD.theme.skin === "asahina");
    if (w === wanted) return;
    wanted = w;
    API.call("music_want", { want: w }).catch(() => {});
  }
  document.addEventListener("visibilitychange", want);
  HUD.onTheme(want);

  // ------------------------------------------------------------ now playing
  function render() {
    $("mu-grid").style.display = sp ? "" : "none";
    $("mu-off").style.display = sp ? "none" : "";
    if (!sp) return;
    $("mu-title").textContent = sp.title || "Unknown track";
    $("mu-artist").textContent = sp.artist || "";
    $("mu-album").textContent = sp.album || "";
    $("mu-status").textContent = sp.status === "Playing" ? "SPOTIFY · PLAYING" : sp.status === "Paused" ? "SPOTIFY · PAUSED" : "SPOTIFY";
    const art = $("mu-art");
    if (sp.art && /^(file|https?):/.test(sp.art)) { art.style.backgroundImage = `url('${sp.art}')`; art.innerHTML = ""; }
    else { art.style.backgroundImage = ""; art.innerHTML = '<svg><use href="#i-music"/></svg>'; }
    $("mu-pp").innerHTML = `<svg><use href="#i-${sp.status === "Playing" ? "pause" : "play"}"/></svg>`;
    $("mu-len").textContent = fmt(sp.length || 0);
  }
  document.querySelectorAll("[data-mu]").forEach((b) => b.addEventListener("click", () =>
    API.call("media", { player: "org.mpris.MediaPlayer2.spotify", action: b.dataset.mu }).catch((e) => HUD.toast(e.message, true))));
  $("mu-launch").addEventListener("click", () => API.call("command", { text: "launch spotify" }).then((r) => HUD.toast(r.reply)));

  // ------------------------------------------------------------ lyrics
  async function loadLyrics(s) {
    const id = (track = s.id || s.title);
    lyr = null; lineIdx = -2;
    $("mu-lyr-src").textContent = "";
    $("mu-lyrics").innerHTML = `<div class="mu-lyr-note">Looking for lyrics…</div>`;
    let res;
    try { res = await API.call("lyrics", { artist: s.artist, title: s.title, album: s.album, duration: s.length }); }
    catch (e) { res = { synced: [], plain: "", error: e.message }; }
    if (track !== id) return;   // the song changed while we were looking
    lyr = res;
    const box = $("mu-lyrics");
    if (res.synced && res.synced.length) {
      box.innerHTML = res.synced.map(([t, l], i) => `<div class="mu-line" data-i="${i}">${HUD.esc(l) || "♪"}</div>`).join("");
      $("mu-lyr-src").textContent = res.source;
      box.querySelectorAll(".mu-line").forEach((el) => el.addEventListener("click", () => {
        // click a line: show where it is (Spotify's MPRIS seek is unreliable, so no seeking)
        el.classList.add("poke"); setTimeout(() => el.classList.remove("poke"), 400);
      }));
    } else if (res.plain) {
      box.innerHTML = `<div class="mu-lyr-note">These lyrics aren't time-synced.</div>` +
        res.plain.split("\n").map((l) => `<div class="mu-line plain">${HUD.esc(l) || "&nbsp;"}</div>`).join("");
      $("mu-lyr-src").textContent = res.source;
    } else {
      box.innerHTML = `<div class="mu-lyr-note">${res.error ? "Couldn't reach the lyrics service." : "No lyrics found for this song."}</div>`;
    }
  }
  // half a box of space above the first line and below the last, so any line can sit in the middle
  // (in px: a CSS percentage would be of the box's width and stretch it past its panel)
  const lyrBox = $("mu-lyrics");
  new ResizeObserver(() => {
    const pad = Math.round(lyrBox.clientHeight / 2 - 24) + "px";
    if (lyrBox.style.paddingTop !== pad) { lyrBox.style.paddingTop = lyrBox.style.paddingBottom = pad; lineIdx = -2; }
  }).observe(lyrBox, { box: "border-box" });   // outer size only: our own padding change mustn't re-trigger it
  function followLyrics() {
    if (!lyr || !lyr.synced || !lyr.synced.length) return;
    const t = position() + 0.25;   // a hair early feels in time
    let i = -1;
    for (let k = 0; k < lyr.synced.length && lyr.synced[k][0] <= t; k++) i = k;
    if (i === lineIdx) return;
    lineIdx = i;
    const box = $("mu-lyrics");
    box.querySelectorAll(".mu-line").forEach((el, k) => {
      el.classList.toggle("now", k === i);
      el.classList.toggle("past", k < i);
    });
    const cur = box.querySelector(".mu-line.now");
    if (cur) box.scrollTo({ top: cur.offsetTop - box.clientHeight / 2 + cur.offsetHeight / 2, behavior: "smooth" });
    else box.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ------------------------------------------------------------ visualizer
  const viz = $("mu-viz"), vctx = viz.getContext("2d");
  HUD.loop((dt, t) => {
    if (!shown) return;
    if (sp) {
      const p = position();
      $("mu-pos").textContent = fmt(p);
      $("mu-bar").style.width = sp.length ? `${(100 * p) / sp.length}%` : "0";
      followLyrics();
    }
    if (viz.offsetParent === null || viz.clientWidth < 100) return;   // hidden (Spotify off) or not laid out yet
    const { w, h, dpr } = HUD.fit(viz);
    vctx.clearRect(0, 0, w, h);
    const skin = HUD.theme.skin, n = M.bars.length, gap = Math.max(2, w / n * 0.22), bw = (w - gap * (n - 1)) / n;
    const base = h * 0.82;   // bars stand on a floor; a faint reflection hangs below it
    const grad = vctx.createLinearGradient(0, base, 0, 0);
    grad.addColorStop(0, `rgba(${HUD.ALT},0.9)`); grad.addColorStop(1, `rgba(${HUD.C},1)`);
    for (let i = 0; i < n; i++) {
      const v = M.bars[i], x = i * (bw + gap), bh = Math.max(2 * dpr, v * base * 0.96);
      if (skin === "doom") {   // text-mode blocks
        const cell = 8 * dpr, cells = Math.round(bh / cell);
        vctx.fillStyle = `rgba(${HUD.C},0.95)`;
        for (let c = 0; c < cells; c++) vctx.fillRect(x, base - (c + 1) * cell + 1, bw, cell - 2 * dpr);
        continue;
      }
      vctx.fillStyle = grad;
      const r = skin === "asahina" ? Math.min(bw / 2, 8 * dpr) : skin === "celestia" ? 1 : 2 * dpr;
      vctx.beginPath(); vctx.roundRect(x, base - bh, bw, bh, [r, r, 0, 0]); vctx.fill();
      vctx.fillStyle = `rgba(${HUD.C},0.12)`;
      vctx.fillRect(x, base + 2 * dpr, bw, bh * 0.18);
      // falling peak caps
      vctx.fillStyle = skin === "celestia" ? `rgba(${HUD.ALT},1)` : `rgba(${HUD.OK},0.9)`;
      vctx.fillRect(x, base - peaks[i] * base * 0.96 - 4 * dpr, bw, 2.5 * dpr);
    }
    if (skin === "asahina" && M.playing) {   // bubbles fizz off the tallest bars
      for (let i = 0; i < n; i += 5) {
        const v = M.bars[i], x = i * (bw + gap) + bw / 2, y = base - v * base * 0.96 - ((t * 60 + i * 13) % 50) * dpr;
        vctx.strokeStyle = `rgba(${HUD.CORE1 || "255,255,255"},${0.5 * v})`; vctx.lineWidth = dpr;
        vctx.beginPath(); vctx.arc(x, y, 3 * dpr, 0, Math.PI * 2); vctx.stroke();
      }
    }
    vctx.fillStyle = `rgba(${HUD.C},0.35)`; vctx.fillRect(0, base, w, Math.max(1, dpr));
    $("mu-viz-state").textContent = M.raw ? "CAVA · LIVE" : sp && sp.status === "Playing" ? "CAVA · STARTING" : "CAVA · IDLE";
  });

  J.music.onShow = () => { shown = true; lineIdx = -2; render(); want(); boost(); };
  J.music.onHide = () => { shown = false; want(); boost(); };
  render();
})();
