/* FILES menu: holographic file browser. */
(function () {
  const J = (window.JARVIS = window.JARVIS || {});
  const $ = (id) => document.getElementById(id);
  const esc = HUD.esc;

  const st = {
    path: null, items: [], sel: new Set(), anchor: null, hidden: false, mode: "grid",
    back: [], fwd: [], clip: null, search: null, sort: "name", asc: true, home: "/",
  };
  try { st.mode = localStorage.getItem("jarvis.files.mode") || "grid"; } catch (e) {}

  const ICON = { folder: "folder", image: "image", video: "video", audio: "audio", archive: "archive", pdf: "pdf",
    code: "code", text: "text", document: "document", file: "file" };
  const iconFor = (it) => ICON[it.kind] || "file";
  const fmtDate = (t) => {
    if (!t) return "";
    const d = new Date(t * 1000);
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" }) + " " +
      d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  };

  async function places() {
    try {
      const list = await API.call("places");
      $("places").innerHTML = list.map((p) =>
        `<div class="place" data-path="${esc(p.path)}">${HUD.icon(p.icon === "document" ? "text" : p.icon)}<span>${esc(p.name)}</span></div>`).join("");
      markPlace();
    } catch (e) { HUD.toast(e.message, true); }
  }
  function markPlace() {
    document.querySelectorAll(".place").forEach((el) => el.classList.toggle("active", el.dataset.path === st.path));
  }

  async function go(path, { push = true, keepSel = false } = {}) {
    try {
      const res = await API.call("list", { path, hidden: st.hidden });
      if (push && st.path && st.path !== res.path) { st.back.push(st.path); st.fwd = []; }
      st.path = res.path; st.items = res.items; st.writable = res.writable; st.search = null;
      if (!keepSel) st.sel.clear();
      $("f-search").value = "";
      render();
      markPlace();
    } catch (e) { HUD.toast(e.message, true); }
  }

  async function doSearch(q) {
    if (!q) { go(st.path, { push: false }); return; }
    $("f-status").textContent = "SCANNING…";
    try {
      const res = await API.call("search", { root: st.path, query: q, hidden: st.hidden });
      st.items = res.items; st.search = q; st.sel.clear();
      render();
      $("f-status").textContent = `${res.items.length}${res.truncated ? "+" : ""} MATCHES FOR "${q.toUpperCase()}" IN ${st.path}`;
    } catch (e) { HUD.toast(e.message, true); }
  }

  function sorted() {
    const k = st.sort, dir = st.asc ? 1 : -1;
    return [...st.items].sort((a, b) => {
      if (a.dir !== b.dir) return a.dir ? -1 : 1;
      let r = 0;
      if (k === "size") r = a.size - b.size;
      else if (k === "mtime") r = a.mtime - b.mtime;
      else if (k === "kind") r = a.kind.localeCompare(b.kind);
      else r = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
      return r * dir;
    });
  }

  function crumbs() {
    const parts = st.path.split("/").filter(Boolean);
    let acc = "";
    let html = `<a data-path="/">/</a>`;
    parts.forEach((p, i) => {
      acc += "/" + p;
      html += (i ? `<i>›</i>` : "") + `<a data-path="${esc(acc)}">${esc(p)}</a>`;
    });
    $("crumbs").innerHTML = html;
    $("crumbs").scrollLeft = 99999;
  }

  function render() {
    crumbs();
    const list = $("file-list");
    const items = sorted();
    st.view = items;
    if (!items.length) {
      list.innerHTML = `<div class="empty">${st.search ? "NO MATCHES" : "FOLDER IS EMPTY"}</div>`;
    } else if (st.mode === "grid") {
      list.innerHTML = `<div class="file-grid">` + items.map((it, i) =>
        `<div class="fitem${it.hidden ? " hidden" : ""}${st.sel.has(it.path) ? " sel" : ""}${isCut(it) ? " cut" : ""}" data-i="${i}" title="${esc(it.path)}">
          <div class="ic">${HUD.icon(iconFor(it))}</div><div class="nm">${esc(it.name)}</div>
          <div class="meta">${it.dir ? "FOLDER" : HUD.fmtBytes(it.size)}</div></div>`).join("") + `</div>`;
    } else {
      const th = (k, l) => `<th data-sort="${k}">${l}${st.sort === k ? (st.asc ? " ▲" : " ▼") : ""}</th>`;
      list.innerHTML = `<table class="file-table"><thead><tr>${th("name", "NAME")}${th("size", "SIZE")}${th("kind", "TYPE")}${th("mtime", "MODIFIED")}</tr></thead><tbody>` +
        items.map((it, i) => `<tr data-i="${i}" class="${st.sel.has(it.path) ? "sel" : ""}${isCut(it) ? " cut" : ""}" title="${esc(it.path)}">
          <td class="n">${HUD.icon(iconFor(it))}<span>${esc(st.search ? it.path.replace(st.path + "/", "") : it.name)}</span></td>
          <td class="m">${it.dir ? "--" : HUD.fmtBytes(it.size)}</td><td class="m">${it.kind.toUpperCase()}</td><td class="m">${fmtDate(it.mtime)}</td></tr>`).join("") +
        `</tbody></table>`;
    }
    updateStatus();
    updateInfo();
  }

  function isCut(it) { return st.clip && st.clip.op === "cut" && st.clip.paths.includes(it.path); }

  function selected() { return st.items.filter((it) => st.sel.has(it.path)); }

  function updateStatus() {
    const n = st.items.length, s = selected();
    const dirs = st.items.filter((i) => i.dir).length;
    if (!st.search) {
      $("f-status").textContent = `${dirs} FOLDERS · ${n - dirs} FILES` +
        (s.length ? ` · ${s.length} SELECTED (${HUD.fmtBytes(s.reduce((a, b) => a + (b.dir ? 0 : b.size), 0))})` : "") +
        (st.writable === false ? " · READ-ONLY" : "");
    }
    document.querySelectorAll("[data-need]").forEach((b) => (b.disabled = s.length === 0));
    $("btn-paste").disabled = !st.clip;
    $("clip").innerHTML = st.clip
      ? `${st.clip.op.toUpperCase()} · ${st.clip.paths.length} ITEM(S)<br>` + st.clip.paths.slice(0, 4).map((p) => esc(p.split("/").pop())).join("<br>")
      : "Empty";
    document.querySelector('[data-f="hidden"]').classList.toggle("on", st.hidden);
    document.querySelector('[data-f="viewmode"] use').setAttribute("href", st.mode === "grid" ? "#i-list" : "#i-grid");
  }

  let infoToken = 0;
  async function updateInfo() {
    const box = $("f-info");
    const s = selected();
    const tok = ++infoToken;
    if (s.length !== 1) {
      box.innerHTML = s.length
        ? `<div class="info-ic">${HUD.icon("copy")}</div><div class="info-name">${s.length} ITEMS SELECTED</div>`
        : `<div class="info-ic">${HUD.icon("folder")}</div><div class="info-name">${esc(st.path)}</div>
           <dl class="kv"><dt>Items</dt><dd>${st.items.length}</dd><dt>Access</dt><dd>${st.writable ? "READ / WRITE" : "READ ONLY"}</dd></dl>`;
      return;
    }
    const it = s[0];
    box.innerHTML = `<div class="info-ic">${HUD.icon(iconFor(it))}</div><div class="info-name">${esc(it.name)}</div><div class="muted mono" style="text-align:center">ANALYZING…</div>`;
    try {
      const p = await API.call("properties", { path: it.path });
      if (tok !== infoToken) return;
      let html = `<div class="info-ic">${HUD.icon(iconFor(it))}</div><div class="info-name">${esc(p.name)}</div>
        <dl class="kv">
          <dt>Type</dt><dd>${esc(p.mime)}</dd>
          <dt>Size</dt><dd>${HUD.fmtBytes(p.size)}${p.partial ? "+" : ""}</dd>
          ${p.dir ? `<dt>Files</dt><dd>${p.files}${p.partial ? "+" : ""}</dd>` : ""}
          <dt>Modified</dt><dd>${fmtDate(p.mtime)}</dd>
          <dt>Accessed</dt><dd>${fmtDate(p.accessed)}</dd>
          <dt>Owner</dt><dd>${esc(p.owner)}</dd>
          <dt>Perms</dt><dd>${esc(p.mode)}</dd>
          ${p.target ? `<dt>Link to</dt><dd>${esc(p.target)}</dd>` : ""}
        </dl>`;
      if (it.kind === "image" && it.size < 40 * 1024 * 1024) {
        html += `<img class="preview-img" src="file://${encodeURI(it.path).replace(/#/g, "%23").replace(/\?/g, "%3F")}" alt="">`;
      } else if (!it.dir && (it.kind === "text" || it.kind === "code" || it.size < 64 * 1024)) {
        try {
          const txt = await API.call("preview", { path: it.path });
          if (tok !== infoToken) return;
          if (txt != null) html += `<div class="preview">${esc(txt)}</div>`;
        } catch (e) {}
      }
      html += `<div class="info-actions">
        <button class="hud-btn" data-f="open">${HUD.icon("open")}OPEN</button>
        <button class="hud-btn" data-f="dolphin">${HUD.icon("files")}REVEAL</button>
        <button class="hud-btn" data-f="rename">${HUD.icon("rename")}RENAME</button></div>`;
      box.innerHTML = html;
    } catch (e) {
      if (tok === infoToken) box.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
    }
  }

  // ------------------------------------------------------------ actions
  async function openItem(it) {
    if (it.dir) return go(it.path);
    try { await API.call("open", { path: it.path }); HUD.toast("OPENING " + it.name); } catch (e) { HUD.toast(e.message, true); }
  }

  async function act(name) {
    const s = selected();
    try {
      switch (name) {
        case "back": if (st.back.length) { st.fwd.push(st.path); go(st.back.pop(), { push: false }); } break;
        case "fwd": if (st.fwd.length) { st.back.push(st.path); go(st.fwd.pop(), { push: false }); } break;
        case "up": if (st.path !== "/") go(st.path.replace(/\/[^/]+\/?$/, "") || "/"); break;
        case "refresh": go(st.path, { push: false, keepSel: true }); places(); break;
        case "hidden": st.hidden = !st.hidden; go(st.path, { push: false }); break;
        case "viewmode": st.mode = st.mode === "grid" ? "list" : "grid"; try { localStorage.setItem("jarvis.files.mode", st.mode); } catch (e) {} render(); break;
        case "open": if (s.length) s.slice(0, 8).forEach(openItem); break;
        case "mkdir": {
          const n = await J.modal({ title: "NEW FOLDER", text: `Create a folder in ${st.path}`, input: "New Folder", confirm: "CREATE" });
          if (n) { const p = await API.call("mkdir", { parent: st.path, name: n }); st.sel = new Set([p]); go(st.path, { push: false, keepSel: true }); }
          break;
        }
        case "mkfile": {
          const n = await J.modal({ title: "NEW FILE", text: `Create an empty file in ${st.path}`, input: "untitled.txt", confirm: "CREATE" });
          if (n) { const p = await API.call("mkfile", { parent: st.path, name: n }); st.sel = new Set([p]); go(st.path, { push: false, keepSel: true }); }
          break;
        }
        case "rename": {
          if (s.length !== 1) break;
          const n = await J.modal({ title: "RENAME", text: s[0].path, input: s[0].name, confirm: "RENAME" });
          if (n && n !== s[0].name) { const p = await API.call("rename", { path: s[0].path, name: n }); st.sel = new Set([p]); go(st.path, { push: false, keepSel: true }); }
          break;
        }
        case "copy": case "cut":
          if (s.length) { st.clip = { op: name, paths: s.map((x) => x.path) }; HUD.toast(`${s.length} ITEM(S) ${name === "copy" ? "COPIED" : "CUT"}`); render(); }
          break;
        case "paste": {
          if (!st.clip) break;
          $("f-status").textContent = "TRANSFERRING…";
          const out = await API.call(st.clip.op === "cut" ? "move" : "copy", { paths: st.clip.paths, dest: st.path });
          HUD.toast(`${out.length} ITEM(S) ${st.clip.op === "cut" ? "MOVED" : "COPIED"}`);
          if (st.clip.op === "cut") st.clip = null;
          st.sel = new Set(out);
          go(st.path, { push: false, keepSel: true });
          break;
        }
        case "trash": {
          if (!s.length) break;
          const ok = await J.modal({ title: "MOVE TO TRASH", danger: true,
            text: s.length === 1 ? `Move "${s[0].name}" to the Trash?` : `Move ${s.length} items to the Trash?`, confirm: "TRASH" });
          if (ok) { await API.call("trash", { paths: s.map((x) => x.path) }); HUD.toast(`${s.length} ITEM(S) MOVED TO TRASH`); go(st.path, { push: false }); }
          break;
        }
        case "delete": {
          if (!s.length) break;
          const ok = await J.modal({ title: "DELETE PERMANENTLY", danger: true,
            text: `Permanently delete ${s.length === 1 ? `"${s[0].name}"` : s.length + " items"}?\nThis cannot be undone.`, confirm: "DELETE" });
          if (ok) { await API.call("delete", { paths: s.map((x) => x.path) }); HUD.toast(`${s.length} ITEM(S) DELETED`); go(st.path, { push: false }); }
          break;
        }
        case "terminal": J.terminal.open({ cwd: s.length === 1 && s[0].dir ? s[0].path : st.path }); J.show("terminal"); break;
        case "konsole": await API.call("terminal", { path: s.length === 1 && s[0].dir ? s[0].path : st.path }); break;
        case "dolphin": await API.call("reveal", { path: s.length === 1 ? s[0].path : st.path }); break;
        case "copypath": {
          const txt = (s.length ? s.map((x) => x.path) : [st.path]).join("\n");
          try { await navigator.clipboard.writeText(txt); } catch (e) {
            const ta = document.createElement("textarea"); ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
          }
          HUD.toast("PATH COPIED");
          break;
        }
        case "selectall": st.items.forEach((it) => st.sel.add(it.path)); render(); break;
      }
    } catch (e) { HUD.toast(e.message, true); }
  }

  // ------------------------------------------------------------ context menu
  const ctx = $("ctx");
  function showCtx(x, y, onItem) {
    const s = selected();
    const one = s.length === 1;
    const row = (a, ic, label, { dis = false, danger = false, key = "" } = {}) =>
      `<div data-a="${a}" class="${dis ? "dis" : ""} ${danger ? "danger" : ""}">${HUD.icon(ic)}${label}${key ? `<kbd>${key}</kbd>` : ""}</div>`;
    ctx.innerHTML = onItem
      ? row("open", "open", "Open", { key: "Enter" }) + row("dolphin", "files", "Show in Dolphin") +
        (one && s[0].dir ? row("terminal", "terminal", "Open in J.A.R.V.I.S. terminal") + row("konsole", "terminal", "Open in Konsole") : "") + "<hr>" +
        row("copy", "copy", "Copy", { key: "Ctrl+C" }) + row("cut", "cut", "Cut", { key: "Ctrl+X" }) +
        row("rename", "rename", "Rename", { dis: !one, key: "F2" }) + row("copypath", "text", "Copy path") + "<hr>" +
        row("trash", "trash", "Move to Trash", { danger: true, key: "Del" }) + row("delete", "kill", "Delete permanently", { danger: true, key: "Shift+Del" })
      : row("mkdir", "newfolder", "New folder") + row("mkfile", "newfile", "New file") + "<hr>" +
        row("paste", "paste", "Paste", { dis: !st.clip, key: "Ctrl+V" }) + row("selectall", "grid", "Select all", { key: "Ctrl+A" }) + "<hr>" +
        row("terminal", "terminal", "Open J.A.R.V.I.S. terminal here") + row("konsole", "terminal", "Open Konsole here") + row("dolphin", "files", "Open in Dolphin") +
        row("hidden", "eye", st.hidden ? "Hide hidden files" : "Show hidden files", { key: "Ctrl+H" }) + row("refresh", "refresh", "Refresh", { key: "F5" });
    ctx.classList.add("show");
    const r = ctx.getBoundingClientRect();
    ctx.style.left = Math.min(x, innerWidth - r.width - 8) + "px";
    ctx.style.top = Math.min(y, innerHeight - r.height - 8) + "px";
  }
  document.addEventListener("click", (e) => {
    const a = e.target.closest("#ctx [data-a]");
    ctx.classList.remove("show");
    if (a) act(a.dataset.a);
  });

  // ------------------------------------------------------------ events
  function itemFromEvent(e) {
    const el = e.target.closest("[data-i]");
    return el ? st.view[+el.dataset.i] : null;
  }
  function clickSelect(it, e) {
    if (e.ctrlKey) { st.sel.has(it.path) ? st.sel.delete(it.path) : st.sel.add(it.path); st.anchor = it.path; }
    else if (e.shiftKey && st.anchor) {
      const a = st.view.findIndex((x) => x.path === st.anchor), b = st.view.indexOf(it);
      st.sel.clear();
      st.view.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((x) => st.sel.add(x.path));
    } else { st.sel = new Set([it.path]); st.anchor = it.path; }
    render();
  }
  const list = $("file-list");
  list.addEventListener("click", (e) => {
    const th = e.target.closest("th[data-sort]");
    if (th) { const k = th.dataset.sort; st.asc = st.sort === k ? !st.asc : true; st.sort = k; render(); return; }
    const it = itemFromEvent(e);
    if (it) clickSelect(it, e); else if (st.sel.size) { st.sel.clear(); render(); }
  });
  list.addEventListener("dblclick", (e) => { const it = itemFromEvent(e); if (it) openItem(it); });
  list.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const it = itemFromEvent(e);
    if (it && !st.sel.has(it.path)) { st.sel = new Set([it.path]); st.anchor = it.path; render(); }
    showCtx(e.clientX, e.clientY, !!it);
  });
  $("places").addEventListener("click", (e) => { const p = e.target.closest(".place"); if (p) go(p.dataset.path); });
  $("crumbs").addEventListener("click", (e) => { const a = e.target.closest("a"); if (a) go(a.dataset.path); });
  document.getElementById("view-files").addEventListener("click", (e) => {
    const b = e.target.closest("[data-f]");
    if (b && !b.disabled) act(b.dataset.f);
  });
  let searchTimer;
  $("f-search").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    const q = e.target.value.trim();
    searchTimer = setTimeout(() => doSearch(q), 400);
  });
  $("f-search").addEventListener("keydown", (e) => { if (e.key === "Escape") { e.target.value = ""; doSearch(""); e.target.blur(); } });

  function keys(e) {
    if (HUD.isTyping(e)) return;
    const k = e.key, s = selected();
    if (k === "Backspace" || (e.altKey && k === "ArrowUp")) { act("up"); }
    else if (e.altKey && k === "ArrowLeft") act("back");
    else if (e.altKey && k === "ArrowRight") act("fwd");
    else if (k === "Enter" && s.length) act("open");
    else if (k === "F2") act("rename");
    else if (k === "F5") act("refresh");
    else if (k === "Delete") act(e.shiftKey ? "delete" : "trash");
    else if (e.ctrlKey && k.toLowerCase() === "c") act("copy");
    else if (e.ctrlKey && k.toLowerCase() === "x") act("cut");
    else if (e.ctrlKey && k.toLowerCase() === "v") act("paste");
    else if (e.ctrlKey && k.toLowerCase() === "a") act("selectall");
    else if (e.ctrlKey && k.toLowerCase() === "h") act("hidden");
    else if (e.ctrlKey && k.toLowerCase() === "f") $("f-search").focus();
    else if (k === "Escape") { st.sel.clear(); render(); }
    else if (k.startsWith("Arrow") && st.view && st.view.length) {
      let i = st.view.findIndex((x) => x.path === st.anchor);
      const cols = st.mode === "grid" ? Math.max(1, Math.floor(list.clientWidth / 126)) : 1;
      const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[k];
      i = Math.max(0, Math.min(st.view.length - 1, (i < 0 ? 0 : i + delta)));
      st.sel = new Set([st.view[i].path]); st.anchor = st.view[i].path; render();
      const el = list.querySelector(`[data-i="${i}"]`); if (el) el.scrollIntoView({ block: "nearest" });
    } else return;
    e.preventDefault();
  }

  J.files = {
    init(home) { st.home = home; places(); go(home, { push: false }); },
    keys,
    go: (p) => go(p),
    search(q, root) { const run = () => { $("f-search").value = q; doSearch(q); }; if (root && root !== st.path) go(root).then(run); else run(); },
    onShow() { if (!st.path) go(st.home, { push: false }); },
  };
})();
