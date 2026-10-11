/* TWENTY-ONE: blackjack against Celestia Ludenberg, a mini game for the Celestia theme (GAMBLE menu).
   Six-deck shoe, Celestia stands on all 17s, blackjack pays 3 to 2, double down on any first two
   cards (no splits or insurance). Chips persist between sessions; go broke and she lends you more,
   and she remembers every loan. Win too often and her composure slips.
   Keys: 1-4 add a chip · C clear the bet · Space / Enter deal · H hit · S stand · D double.
   Nothing runs in the background: the table only reacts to input and a few timers during a hand. */
(function () {
  const J = (window.JARVIS = window.JARVIS || {});
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const fmt = (n) => n.toLocaleString("en-GB");

  const START = 1000, MIN_BET = 10, CHIPS = [10, 50, 100, 500], DECKS = 6;
  const SUITS = ["♠", "♥", "♦", "♣"], RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

  // ------------------------------------------------------------ what she says
  // `speak` lines go through her voice; the rest only appear in her speech bubble
  const LINES = {
    welcome: ["Welcome to my table. Choose your wager, and we shall begin.", "Ah, a challenger. Place your bet, if you please.",
      "Sit, sit. The cards have been waiting for you."],
    deal: ["Cards on the table.", "Let us see what fate has dealt you.", "Your move, my dear.", "Hit, or stand? Choose wisely."],
    double: ["Doubling down? How bold. I do admire a gambler with nerve.", "Twice the wager. Now this is getting interesting."],
    playerBJ: ["Blackjack. How fortunate. Do enjoy it while it lasts.", "Twenty-one on the deal? Hmph. Beginner's luck, surely."],
    dealerBJ: ["Blackjack. Did you truly expect anything else?", "Twenty-one. The house always wins, my dear."],
    bothBJ: ["Both of us with blackjack? How tiresome. Take your chips back."],
    playerBust: ["Over twenty-one. Greed is such an unbecoming trait.", "A bust. I did warn you not to push your luck.",
      "Too many cards, my dear. A true gambler knows when to stop."],
    dealerBust: ["I have gone over. A rare lapse. Do not grow accustomed to it.", "Bust? How very irritating. Take your winnings."],
    win: ["You win this hand. Consider it a loan.", "Well played. I shall be watching you more closely now.",
      "Hm. The cards favour you, for now."],
    lose: ["The house wins. As it always does.", "Better luck next time. Though luck has very little to do with it.",
      "Thank you for the chips. They suit me far better."],
    push: ["A tie. How dreadfully dull.", "Neither of us wins. The chips go home with their owners."],
    newBest: ["A new personal record. You may yet become a worthy opponent."],
    loan: ["You have nothing left to wager. I shall lend you a thousand chips. The interest, we may discuss later.",
      "Broke already? Here, a thousand chips, on credit. I never forget a debt."],
    // canon Celestia: the mask slips, then goes straight back on
    outburst: ["What?! How dare you, you insolent swine! Bring me another deck this instant! ... Ahem. Do forgive me. Please, continue.",
      "Again?! Are you counting cards, you filthy little cheat?! ... Pardon me. That was most unladylike.",
      "Enough! Do you have any idea who I am?! I am the Queen of Liars! ... Oh my. Where were we? Your bet, please."],
  };

  // ------------------------------------------------------------ state
  let bank = store.get("celestia.bank", START), best = store.get("celestia.best", START);
  let hands = store.get("celestia.hands", 0), won = store.get("celestia.won", 0), loans = store.get("celestia.loans", 0);
  let bet = Math.min(store.get("celestia.bet", 50), bank), stake = 0, streak = 0;
  let shoe = [], player = [], dealer = [], hole = true;
  let phase = "bet";   // bet | play | dealer | done
  let timers = [], shown = false, sayTimer = 0;
  const active = () => shown && HUD.theme.skin === "celestia";

  function save() {
    store.set("celestia.bank", bank); store.set("celestia.best", best); store.set("celestia.hands", hands);
    store.set("celestia.won", won); store.set("celestia.loans", loans); store.set("celestia.bet", bet);
  }
  function shuffle() {
    shoe = [];
    for (let d = 0; d < DECKS; d++) for (const s of SUITS) for (const r of RANKS) shoe.push({ r, s });
    for (let i = shoe.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [shoe[i], shoe[j]] = [shoe[j], shoe[i]]; }
  }
  const draw = () => shoe.pop();
  // best total, and whether an ace is still counted as 11 (soft)
  function total(cards) {
    let t = 0, aces = 0;
    for (const c of cards) { t += c.r === "A" ? 11 : /[JQK]|10/.test(c.r) ? 10 : +c.r; if (c.r === "A") aces++; }
    while (t > 21 && aces) { t -= 10; aces--; }
    return { t, soft: aces > 0 };
  }
  const isBJ = (cards) => cards.length === 2 && total(cards).t === 21;
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  function clearTimers() { timers.forEach(clearTimeout); timers = []; }

  // ------------------------------------------------------------ talking
  function say(key, { speak = false } = {}) {
    const text = Array.isArray(key) ? pick(key) : pick(LINES[key]);
    const box = $("gc-say");
    box.textContent = text;
    box.classList.remove("show", "rage"); void box.offsetWidth;
    box.classList.add("show");
    if (key === "outburst") { box.classList.add("rage"); $("gc-portrait-wrap").classList.add("rage"); }
    else $("gc-portrait-wrap").classList.remove("rage");
    $("gc-portrait-wrap").classList.remove("talk"); void $("gc-portrait-wrap").offsetWidth;
    $("gc-portrait-wrap").classList.add("talk");
    clearTimeout(sayTimer);
    sayTimer = setTimeout(() => $("gc-portrait-wrap").classList.remove("rage"), 4000);
    if (speak) API.speak(text);
  }

  // ------------------------------------------------------------ the hand
  function deal() {
    if (phase === "play" || phase === "dealer" || phase === "deal") return;
    if (bank < MIN_BET) return lend();
    bet = Math.max(MIN_BET, Math.min(bet, bank));
    if (shoe.length < 52) shuffle();
    clearTimers();
    stake = bet; bank -= stake; hands++;
    player = []; dealer = []; hole = true; phase = "deal";
    $("gc-result").textContent = ""; $("gc-result").className = "gc-result";
    render(true);
    // the classic order: you, her, you, her (face down)
    [[player], [dealer], [player], [dealer]].forEach(([hand], i) => later(() => { hand.push(draw()); render(); }, 180 + i * 380));
    later(() => {
      const dBJ = isBJ(dealer), pBJ = isBJ(player);
      if (pBJ || dBJ) {   // she peeks at once: a blackjack on either side ends the hand
        hole = false;
        return settle(pBJ && dBJ ? "push" : pBJ ? "bj" : "lose", pBJ && dBJ ? "bothBJ" : pBJ ? "playerBJ" : "dealerBJ");
      }
      phase = "play"; render();
      if (Math.random() < 0.35) say("deal");
    }, 180 + 4 * 380);
  }
  function hit() {
    if (phase !== "play") return;
    player.push(draw()); render();
    const t = total(player).t;
    if (t > 21) { hole = false; later(() => settle("lose", "playerBust"), 450); }
    else if (t === 21) later(stand, 400);
  }
  function stand() {
    if (phase !== "play") return;
    phase = "dealer"; hole = false; render();
    const step = () => {
      const { t } = total(dealer);
      if (t < 17) { dealer.push(draw()); render(); later(step, 650); return; }   // stands on all 17s, soft too
      const p = total(player).t;
      if (t > 21) settle("win", "dealerBust");
      else if (p > t) settle("win", "win");
      else if (p < t) settle("lose", "lose");
      else settle("push", "push");
    };
    later(step, 650);
  }
  function double() {
    if (phase !== "play" || player.length !== 2 || bank < stake) return;
    bank -= stake; stake *= 2;
    say("double");
    player.push(draw()); render();
    if (total(player).t > 21) { hole = false; later(() => settle("lose", "playerBust"), 450); }
    else later(stand, 500);
  }
  function settle(outcome, line) {
    phase = "done";
    const pay = outcome === "bj" ? Math.floor(stake * 2.5) : outcome === "win" ? stake * 2 : outcome === "push" ? stake : 0;
    bank += pay;
    const net = pay - stake;
    if (net > 0) { won++; streak++; } else if (net < 0) streak = 0;
    const res = $("gc-result");
    res.textContent = outcome === "bj" ? `BLACKJACK  +${fmt(net)}` : net > 0 ? `YOU WIN  +${fmt(net)}` : net < 0 ? `THE HOUSE WINS  −${fmt(-net)}` : "PUSH";
    res.className = "gc-result show " + (net > 0 ? "win" : net < 0 ? "lose" : "push");
    // a new best only gets remarked on when it passes another thousand (2,000, 3,000...)
    const record = bank >= START * 2 && Math.floor(bank / START) > Math.floor(best / START);
    best = Math.max(best, bank);
    // four wins in a row and the Queen of Liars loses her temper (then it starts again)
    if (streak >= 4) { streak = 0; say("outburst", { speak: true }); }
    else if (record) say("newBest", { speak: true });
    else say(line, { speak: line === "playerBJ" || line === "dealerBJ" || (net > 0 && stake >= 500) });
    if (bet > bank) bet = Math.max(MIN_BET, Math.min(bet, bank));
    save(); render();
  }
  function lend() {
    loans++; bank += START; bet = Math.min(Math.max(bet, 50), bank);
    say("loan", { speak: true });
    save(); render();
  }

  // ------------------------------------------------------------ betting
  function addChip(v) {
    if (phase === "play" || phase === "dealer" || phase === "deal") return;
    if (bank < MIN_BET) return lend();
    if (phase === "done") { phase = "bet"; bet = 0; }   // the first chip after a hand starts a fresh wager
    bet = Math.min(bank, bet + v); save(); render();
  }
  function clearBet() {
    if (phase !== "bet" && phase !== "done") return;
    phase = "bet"; bet = 0; render();
  }

  // ------------------------------------------------------------ drawing
  function cardHTML(c, i, back, anim) {
    const cls = `gc-card${back ? " back" : ""}${!back && (c.s === "♥" || c.s === "♦") ? " red" : ""}${anim ? " " + anim : ""}`;
    if (back) return `<div class="${cls}" style="--i:${i}"></div>`;
    return `<div class="${cls}" style="--i:${i}"><span class="gc-r">${c.r}<br>${c.s}</span><span class="gc-s">${c.s}</span><span class="gc-r gc-b">${c.r}<br>${c.s}</span></div>`;
  }
  const seen = { p: 0, d: 0, hole: true };
  function render(reset = false) {
    if (reset) { seen.p = 0; seen.d = 0; seen.hole = true; }
    $("gc-player").innerHTML = player.map((c, i) => cardHTML(c, i, false, i >= seen.p && "new")).join("");
    // the hole card turns over in place when it's revealed
    $("gc-dealer").innerHTML = dealer.map((c, i) => cardHTML(c, i, i === 1 && hole, i === 1 && seen.hole && !hole && i < seen.d ? "flip" : i >= seen.d && "new")).join("");
    seen.p = player.length; seen.d = dealer.length; seen.hole = hole;
    const pt = total(player), dt = hole ? total(dealer.slice(0, 1)) : total(dealer);
    $("gc-ptotal").textContent = player.length ? (pt.soft && pt.t < 21 ? `${pt.t - 10} / ${pt.t}` : pt.t) : "";
    $("gc-dtotal").textContent = dealer.length ? (hole ? `${dt.t}${dealer.length > 1 ? " + ?" : ""}` : dt.t) : "";
    $("gc-bank").textContent = fmt(bank);
    $("gc-bet").textContent = fmt(phase === "bet" || phase === "done" ? bet : stake);
    $("gc-stats").textContent = `Best ${fmt(best)} · ${won}/${hands} hands won${loans ? ` · ${loans} loan${loans > 1 ? "s" : ""} from Celestia` : ""}`;
    const betting = phase === "bet" || phase === "done";
    $("gc-deal").disabled = !betting || (bet < MIN_BET && bank >= MIN_BET);
    $("gc-deal").textContent = bank < MIN_BET && betting ? "BORROW" : phase === "done" ? "DEAL AGAIN" : "DEAL";
    $("gc-hit").disabled = $("gc-stand").disabled = phase !== "play";
    $("gc-double").disabled = phase !== "play" || player.length !== 2 || bank < stake;
    document.querySelectorAll("#gc-chips button").forEach((b) => (b.disabled = !betting || +b.dataset.v > bank));
    $("gc-clear").disabled = !betting || !bet;
  }
  function portrait() {
    const c = $("gc-portrait"), r = HUD.fit(c), ctx = c.getContext("2d");
    ctx.clearRect(0, 0, r.w, r.h);
    const art = HUD.CELESTIA, px = Math.max(2, Math.floor(Math.min(r.w / (art[0].length + 2), r.h / (art.length + 1))));
    HUD.drawSprite(ctx, (r.w - art[0].length * px) / 2, r.h - art.length * px - px / 2, px, { sprite: "celestia" });
  }

  // ------------------------------------------------------------ input
  $("gc-chips").innerHTML = CHIPS.map((v, i) => `<button class="gc-chip c${i}" data-v="${v}" title="Key ${i + 1}">${v}</button>`).join("");
  $("gc-chips").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { b.blur(); addChip(+b.dataset.v); } });
  const btn = (id, fn) => $(id).addEventListener("click", (e) => { e.currentTarget.blur(); fn(); });
  btn("gc-deal", deal); btn("gc-hit", hit); btn("gc-stand", stand); btn("gc-double", double); btn("gc-clear", clearBet);
  $("gc-portrait").addEventListener("click", () => say(phase === "play" ? "deal" : "welcome"));
  document.addEventListener("keydown", (e) => {
    if (!active() || HUD.isTyping(e) || e.ctrlKey || e.altKey || e.metaKey) return;
    const k = e.key.toLowerCase();
    if (k === " " || k === "enter") { if (phase === "play") stand(); else deal(); }
    else if (k === "h") hit();
    else if (k === "s") stand();
    else if (k === "d") double();
    else if (k === "c" || k === "backspace") clearBet();
    else if (/^[1-4]$/.test(k)) addChip(CHIPS[+k - 1]);
    else return;
    e.preventDefault();
  });
  new ResizeObserver(() => { if (shown) portrait(); }).observe($("gc-portrait"));
  // the table belongs to Celestia: other themes send it home (a hand in progress is abandoned, chips returned)
  HUD.onTheme((th) => {
    if (th.skin === "celestia") return;
    abandon();
    if (shown) J.show("home");
  });
  function abandon() {
    if (phase === "play" || phase === "dealer" || phase === "deal") { clearTimers(); bank += stake; hands--; stake = 0; phase = "bet"; player = []; dealer = []; save(); }
  }

  J.gamble = {
    onShow() {
      shown = true; portrait(); render();
      if (phase === "bet" && !player.length) say("welcome");
    },
    onHide() { shown = false; },
    state: () => ({ phase, bank, bet, stake, best, hands, won, loans, player: player.map((c) => c.r + c.s), dealer: dealer.map((c) => c.r + c.s) }),
  };
  render();
})();
