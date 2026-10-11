/* Start-up sequence: arc reactor ignition + system check lines. */
(function () {
  const J = (window.JARVIS = window.JARVIS || {});
  const TAU = Math.PI * 2;

  J.boot = function (enabled, user) {
    const el = document.getElementById("boot");
    const app = document.getElementById("app");
    if (!enabled) {
      el.remove();
      app.classList.add("ready");
      return Promise.resolve();
    }
    const canvas = document.getElementById("boot-canvas");
    const ctx = canvas.getContext("2d");
    const lines = document.getElementById("boot-lines");
    const title = document.getElementById("boot-title");
    let start = performance.now();
    let done = false;
    let resolveFn;
    const finished = new Promise((r) => (resolveFn = r));

    const stop = HUD.loop((dt, t) => {
      const el2 = (performance.now() - start) / 1000;
      const { w, h, dpr } = HUD.fit(canvas);
      const s = Math.min(w, h), cx = w / 2, cy = h / 2;
      ctx.clearRect(0, 0, w, h);
      const ign = Math.min(1, el2 / 1.6);
      if (HUD.theme.skin === "doom") {   // BIOS screen: just the mask, no rings
        HUD.drawReactor(ctx, cx, cy, s * 0.42 * Math.min(1, el2 * 1.5), t, dpr, ign);
        return;
      }
      if (HUD.theme.skin === "asahina") {   // Hina pops out of the pool, ripples spreading around her
        for (let i = 0; i < 5; i++) {
          const a = (el2 * 0.55 + i / 5) % 1;
          ctx.strokeStyle = `rgba(${HUD.ALT},${0.5 * (1 - a)})`; ctx.lineWidth = 3 * dpr;
          ctx.beginPath(); ctx.ellipse(cx, cy + s * 0.2, s * 0.48 * a, s * 0.16 * a, 0, 0, TAU); ctx.stroke();
        }
        const px = (s * 0.5) / HUD.HINA.length, rise = Math.max(0, 1 - el2 * 1.4);
        const hop = Math.abs(Math.sin(el2 * 4)) * px * 3 * (el2 > 0.7 ? 1 : 0);
        HUD.drawSprite(ctx, cx - (px * HUD.HINA[0].length) / 2, cy - s * 0.25 + rise * s * 0.3 - hop, px, { legs: el2 > 0.7 ? 1 + (Math.floor(el2 * 6) % 2) : 0 });
        return;
      }
      // expanding rings
      for (let i = 0; i < 6; i++) {
        const p = Math.min(1, Math.max(0, el2 * 0.8 - i * 0.12));
        const r = s * (0.18 + i * 0.055) * (0.6 + 0.4 * p);
        ctx.save(); ctx.translate(cx, cy); ctx.rotate((i % 2 ? -1 : 1) * t * (0.3 + i * 0.1));
        ctx.strokeStyle = `rgba(${HUD.C},${0.15 + 0.5 * p * (1 - i * 0.1)})`;
        ctx.lineWidth = (i === 5 ? 3 : 1.4) * dpr;
        ctx.setLineDash(i % 2 ? [s * 0.02, s * 0.012] : [s * 0.15 * p, s * 0.03]);
        ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU * p); ctx.stroke();
        ctx.restore();
      }
      // tick ring
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(t * 0.15);
      for (let i = 0; i < 180; i++) {
        if (i / 180 > ign) break;
        const a = (i / 180) * TAU, L = i % 15 === 0 ? 16 : 6;
        ctx.strokeStyle = `rgba(${HUD.C},${i % 15 === 0 ? 0.8 : 0.3})`; ctx.lineWidth = 1 * dpr;
        ctx.beginPath(); ctx.moveTo(Math.cos(a) * s * 0.49, Math.sin(a) * s * 0.49);
        ctx.lineTo(Math.cos(a) * (s * 0.49 - L * dpr), Math.sin(a) * (s * 0.49 - L * dpr)); ctx.stroke();
      }
      ctx.restore();
      HUD.drawReactor(ctx, cx, cy, s * 0.17 * (0.4 + 0.6 * ign), t * 2, dpr, ign * (0.9 + 0.1 * Math.sin(t * 6)));
    });

    const checks = HUD.str("boot");
    let i = 0;
    const iv = setInterval(() => {
      if (i < checks.length) {
        const d = document.createElement("div");
        d.textContent = "> " + checks[i++];
        lines.appendChild(d);
        while (lines.children.length > 4) lines.firstChild.remove();
      } else {
        clearInterval(iv);
        title.classList.add("on");
        const d = document.createElement("div");
        const h = new Date().getHours();
        const greet = h < 12 ? "GOOD MORNING" : h < 18 ? "GOOD AFTERNOON" : "GOOD EVENING";
        d.textContent = `${greet}${user ? ", " + user.toUpperCase() : ""}. ${HUD.str("bootReady")}`;
        d.style.color = "var(--c-bright)";
        lines.innerHTML = ""; lines.appendChild(d);
        setTimeout(finish, 1300);
      }
    }, 330);

    function finish() {
      if (done) return;
      done = true;
      clearInterval(iv);
      el.classList.add("done");
      app.classList.add("ready");
      setTimeout(() => { stop(); el.remove(); }, 1000);
      resolveFn();
    }
    el.addEventListener("click", finish);
    document.addEventListener("keydown", finish, { once: true });
    return finished;
  };
})();
