/* APPS: launcher grid with icons, search, categories, favorites and most-used. */
(function () {
  const J = (window.JARVIS = window.JARVIS || {});
  const $ = (id) => document.getElementById(id);
  const esc = HUD.esc;
  let apps = [], cat = "All", kb = 0, shown = [];

  J.appIcon = (a) => a.icon
    ? `<img class="app-ic" src="file://${encodeURI(a.icon)}" alt="" loading="lazy" onerror="this.outerHTML='<div class=&quot;app-ic fallback&quot;>${esc(a.name[0] || "?")}</div>'">`
    : `<div class="app-ic fallback">${esc((a.name[0] || "?").toUpperCase())}</div>`;

  J.launchApp = async (id) => {
    try { const name = await API.call("app_launch", { id }); HUD.toast("LAUNCHING " + name.toUpperCase()); API.speak(`Launching ${name}.`); }
    catch (e) { HUD.toast(e.message, true); }
  };

  async function load(force = false) {
    try { apps = await API.call("apps", { force }); } catch (e) { HUD.toast(e.message, true); return; }
    const cats = ["All", "Favorites", ...[...new Set(apps.map((a) => a.category))].sort()];
    $("apps-cats").innerHTML = cats.map((c) => `<button data-cat="${esc(c)}" class="${c === cat ? "on" : ""}">${esc(c.toUpperCase())}</button>`).join("");
    render();
  }

  function score(a, q) {
    const n = a.name.toLowerCase();
    if (n === q) return 100;
    if (n.startsWith(q)) return 80;
    if (n.split(/\s+/).some((w) => w.startsWith(q))) return 70;
    if (n.includes(q)) return 60;
    if (a.id.toLowerCase().includes(q)) return 45;
    if ((a.generic + " " + a.keywords + " " + a.comment).toLowerCase().includes(q)) return 30;
    return 0;
  }

  function card(a, i) {
    return `<div class="app${i === kb ? " kb" : ""}" data-app="${esc(a.id)}" title="${esc(a.comment || a.generic || a.name)}">
      <span class="fav${a.favorite ? " on" : ""}" data-fav="${esc(a.id)}" title="Pin to HOME"><svg><use href="#i-star"/></svg></span>
      ${J.appIcon(a)}<div class="nm">${esc(a.name)}</div><div class="cm">${esc(a.generic || "")}</div></div>`;
  }

  function render() {
    const q = $("apps-search").value.trim().toLowerCase();
    let list = apps;
    if (cat === "Favorites") list = list.filter((a) => a.favorite);
    else if (cat !== "All") list = list.filter((a) => a.category === cat);
    if (q) list = list.map((a) => [a, score(a, q) + Math.min(10, a.launches)]).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]).map((x) => x[0]);
    shown = list;
    kb = Math.min(kb, Math.max(0, list.length - 1));
    $("apps-count").textContent = `${list.length} / ${apps.length} APPS`;
    let html = "";
    if (!q && cat === "All") {
      const favs = apps.filter((a) => a.favorite);
      const used = apps.filter((a) => a.launches && !a.favorite).sort((a, b) => b.launches - a.launches).slice(0, 8);
      if (favs.length) html += `<div class="apps-section"><h4>★ FAVORITES</h4><div class="app-grid">${favs.map((a) => card(a, -1)).join("")}</div></div>`;
      if (used.length) html += `<div class="apps-section"><h4>MOST USED</h4><div class="app-grid">${used.map((a) => card(a, -1)).join("")}</div></div>`;
      html += `<div class="apps-section"><h4>ALL APPLICATIONS</h4>`;
    }
    html += `<div class="app-grid">${list.map((a, i) => card(a, q ? i : -1)).join("")}</div>` + (!q && cat === "All" ? "</div>" : "");
    $("apps-scroll").innerHTML = list.length ? html : '<div class="empty">NO MATCHING APPLICATIONS</div>';
  }

  $("apps-search").addEventListener("input", () => { kb = 0; render(); });
  $("apps-search").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && shown[kb]) { J.launchApp(shown[kb].id); e.target.select(); }
    else if (e.key === "ArrowDown" || e.key === "ArrowRight") { kb = Math.min(shown.length - 1, kb + 1); render(); e.preventDefault(); }
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") { kb = Math.max(0, kb - 1); render(); e.preventDefault(); }
    else if (e.key === "Escape") { e.target.value = ""; render(); }
  });
  $("apps-cats").addEventListener("click", (e) => { const b = e.target.closest("[data-cat]"); if (b) { cat = b.dataset.cat; load(); } });
  $("apps-scroll").addEventListener("click", async (e) => {
    const f = e.target.closest("[data-fav]");
    if (f) {
      e.stopPropagation();
      const on = await API.call("app_favorite", { id: f.dataset.fav });
      apps.forEach((a) => { if (a.id === f.dataset.fav) a.favorite = on; });
      HUD.toast(on ? "PINNED TO HOME" : "UNPINNED");
      render();
      return;
    }
    const a = e.target.closest("[data-app]");
    if (a) J.launchApp(a.dataset.app);
  });
  $("apps-reload").addEventListener("click", () => load(true));

  J.apps = {
    onShow() { load(); setTimeout(() => { $("apps-search").focus(); $("apps-search").select(); }, 50); },
  };
})();
