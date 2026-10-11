/* POWER menu: lock / log out / sleep / hibernate / restart / shut down with confirmation + countdown. */
(function () {
  const J = (window.JARVIS = window.JARVIS || {});
  const $ = (id) => document.getElementById(id);
  const META = {
    lock: { icon: "lock", verb: "Lock the session", count: 0 },
    logout: { icon: "logout", verb: "Log out of KDE Plasma", count: 5, danger: true },
    suspend: { icon: "sleep", verb: "Put the computer to sleep", count: 3 },
    hibernate: { icon: "hibernate", verb: "Hibernate (save RAM to disk and power off)", count: 5 },
    hybrid: { icon: "hybrid", verb: "Hybrid sleep (sleep + hibernation image)", count: 5 },
    reboot: { icon: "reboot", verb: "Restart the computer", count: 5, danger: true },
    poweroff: { icon: "power", verb: "Shut down the computer", count: 5, danger: true },
  };
  let caps = {};

  async function loadCaps() {
    try {
      caps = await API.call("power_caps");
      document.querySelectorAll("[data-power]").forEach((b) => {
        const c = caps[b.dataset.power];
        b.classList.toggle("na", !!c && !c.available);
        b.querySelector(".warnmark")?.remove();
        if (c && c.notes && c.notes.length) b.insertAdjacentHTML("beforeend", '<span class="warnmark">!</span>');
      });
      const notes = (caps.hibernate && caps.hibernate.notes) || [];
      $("power-notes").innerHTML = notes.length ? "<b>HIBERNATION ADVISORY:</b> " + notes.map(HUD.esc).join("<br>") : "";
    } catch (e) { HUD.toast(e.message, true); }
  }

  async function ask(action) {
    const m = META[action];
    if (!m) return;
    const label = (caps[action] && caps[action].label) || action;
    const notes = (caps[action] && caps[action].notes) || [];
    const ok = await J.modal({
      title: label.toUpperCase(), danger: !!m.danger, icon: m.icon,
      text: `${m.verb}?` + (notes.length ? "\n\n⚠ " + notes.join("\n⚠ ") : "") +
        (action === "reboot" || action === "poweroff" || action === "logout" ? "\nOpen applications will be asked to close." : ""),
      confirm: "ENGAGE", countdown: m.count,
    });
    if (!ok) { HUD.toast(`${label.toUpperCase()} ABORTED`); return; }
    try {
      const msg = await API.call("power", { action });
      HUD.toast(msg.toUpperCase());
    } catch (e) {
      HUD.toast(`${label} failed: ${e.message}`, true);
    }
  }

  document.querySelectorAll("[data-power]").forEach((b) => b.addEventListener("click", () => ask(b.dataset.power)));

  J.power = { ask, onShow: loadCaps };
})();
