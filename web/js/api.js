/* Transport adapter: talks to the Python backend over QWebChannel. */
(function () {
  const pending = new Map();
  const statsListeners = [];
  const eventListeners = [];
  const ptyListeners = [], ptyExitListeners = [];
  const voiceListeners = { state: [], partial: [], heard: [], level: [], wake: [] };
  const spotifyListeners = [], barsListeners = [];
  let seq = 0;
  let bridge = null;
  let readyResolve;
  const ready = new Promise((r) => (readyResolve = r));

  function init() {
    if (typeof QWebChannel === "undefined" || typeof qt === "undefined") {
      console.warn("QWebChannel unavailable - running without backend");
      readyResolve(false);
      return;
    }
    new QWebChannel(qt.webChannelTransport, (channel) => {
      bridge = channel.objects.bridge;
      bridge.reply.connect((id, json) => {
        const p = pending.get(id);
        if (!p) return;
        pending.delete(id);
        let msg;
        try { msg = JSON.parse(json); } catch (e) { p.reject(e); return; }
        if (msg.ok) p.resolve(msg.result); else p.reject(new Error(msg.error));
      });
      bridge.stats.connect((json) => {
        let d;
        try { d = JSON.parse(json); } catch (e) { return; }
        statsListeners.forEach((fn) => { try { fn(d); } catch (e) { console.error(e.stack || e); } });
      });
      bridge.ptyData.connect((id, data) => ptyListeners.forEach((fn) => fn(id, data)));
      bridge.ptyExit.connect((id, code) => ptyExitListeners.forEach((fn) => fn(id, code)));
      bridge.voiceState.connect((v) => voiceListeners.state.forEach((fn) => fn(v)));
      bridge.voicePartial.connect((v) => voiceListeners.partial.forEach((fn) => fn(v)));
      bridge.voiceHeard.connect((v) => voiceListeners.heard.forEach((fn) => fn(v)));
      bridge.voiceLevel.connect((v) => voiceListeners.level.forEach((fn) => fn(v)));
      bridge.voiceWake.connect(() => voiceListeners.wake.forEach((fn) => fn()));
      bridge.spotify.connect((json) => { const s = JSON.parse(json); spotifyListeners.forEach((fn) => fn(s)); });
      bridge.vizBars.connect((line) => {
        const bars = line ? line.split(";").map((v) => v / 1000) : null;
        barsListeners.forEach((fn) => fn(bars));
      });
      bridge.event.connect((json) => {
        const d = JSON.parse(json);
        eventListeners.forEach((fn) => fn(d));
      });
      readyResolve(true);
    });
  }

  window.API = {
    ready,
    call(method, args = {}) {
      return ready.then((ok) => {
        if (!ok) return Promise.reject(new Error("backend offline"));
        const id = "r" + ++seq;
        return new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject });
          bridge.call(id, method, JSON.stringify(args));
        });
      });
    },
    onStats(fn) { statsListeners.push(fn); },
    onSpotify(fn) { spotifyListeners.push(fn); },   // Spotify state, or null when it isn't running
    onBars(fn) { barsListeners.push(fn); },         // visualizer frame: array of 0..1, or null when stopped
    onEvent(fn) { eventListeners.push(fn); },
    speak(text) { if (bridge) bridge.speak(text); },
    onPty(fn) { ptyListeners.push(fn); },
    onPtyExit(fn) { ptyExitListeners.push(fn); },
    ptyWrite(id, data) { if (bridge) bridge.ptyWrite(id, data); },
    ptyResize(id, cols, rows) { if (bridge) bridge.ptyResize(id, cols, rows); },
    log(text) { if (bridge) bridge.log(text); },
    onVoice(kind, fn) { voiceListeners[kind].push(fn); },
    listen() { if (bridge) bridge.listen(); },
    stopListening() { if (bridge) bridge.stopListening(); },
    stopSpeaking() { if (bridge) bridge.stopSpeaking(); },
  };

  init();
})();
