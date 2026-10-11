/* HUD skins: whole-app themes picked from the top-bar dropdown. Each skin sets its palette,
   fonts and on-screen wording; hud.js draws the matching canvas art (arc reactor / roulette).
   A skin without a palette is coloured from the Accent setting (the J.A.R.V.I.S. look). */
(function () {
  HUD.SKINS = {
    jarvis: {
      name: "J.A.R.V.I.S.",
      fonts: { display: "Orbitron", mono: "ShareTech" },
      text: {
        title: "J.A.R.V.I.S.",
        subtitle: "JUST A RATHER VERY INTELLIGENT SYSTEM",
        bootTitle: "J.A.R.V.I.S.",
        consoleTitle: "J.A.R.V.I.S.",
        navConsole: "JARVIS",
        who: "J.A.R.V.I.S.",
        talk: "TALK TO J.A.R.V.I.S.",
        ask: 'Ask JARVIS… e.g. "status", "open downloads", "launch firefox"',
        termFoot: "SECURE SHELL · STARK INDUSTRIES",
        nominal: "ALL SYSTEMS NOMINAL",
        bootReady: "ALL SYSTEMS NOMINAL.",
        boot: [
          "INITIALIZING NEURAL INTERFACE",
          "LOADING HARDWARE TELEMETRY MODULES",
          "THERMAL SENSOR ARRAY .......... ONLINE",
          "GPU TELEMETRY LINK ............ ONLINE",
          "FILE SYSTEM ACCESS ............ GRANTED",
          "POWER MANAGEMENT .............. READY",
        ],
        address: "sir",
        pardon: "I didn't catch that, sir.",
        online: "J.A.R.V.I.S. online.",
        assist: "How may I assist you?",
      },
    },
    celestia: {
      name: "Celestia Ludenberg",
      fonts: { display: "Cinzel", mono: "EB Garamond" },
      // rgb triplets; same keys as the derived palette in HUD.applyTheme()
      palette: {
        dark: {
          acc: [222, 36, 70], cb: [232, 196, 124], warn: [240, 176, 64], crit: [255, 96, 44], ok: [64, 196, 128], shade: [0, 0, 0],
          d0: [8, 3, 5], d1: [15, 5, 8], d2: [40, 8, 16],
          bg: [6, 2, 4], panel: [18, 5, 9], hi: [255, 244, 228],
          text: [236, 224, 208], muted: [164, 124, 126], critSoft: [255, 156, 120],
          scan: 0, vignette: 0.85, glow: "0 0 6px rgba(222, 36, 70, .55), 0 0 18px rgba(222, 36, 70, .25)",
          alt: [222, 182, 100], core1: [255, 240, 220], core2: [232, 196, 124], plate: [16, 4, 8], node: [232, 196, 124],
        },
        light: {
          acc: [150, 16, 44], cb: [112, 14, 36], warn: [176, 112, 0], crit: [214, 72, 0], ok: [20, 130, 80], shade: [70, 20, 30],
          d0: [252, 248, 240], d1: [243, 235, 222], d2: [234, 212, 200],
          bg: [236, 226, 210], panel: [248, 242, 232], hi: [30, 6, 12],
          text: [44, 16, 22], muted: [122, 92, 90], critSoft: [190, 60, 20],
          scan: 0, vignette: 0.2, glow: "0 0 2px rgba(150, 16, 44, .3)",
          alt: [150, 108, 26], core1: [255, 255, 255], core2: [226, 186, 112], plate: [250, 244, 234], node: [176, 128, 50],
        },
      },
      text: {
        title: "Celestia Ludenberg",
        subtitle: "THE ULTIMATE GAMBLER",
        bootTitle: "Celestia Ludenberg",
        consoleTitle: "Celestia Ludenberg",
        navConsole: "CELESTIA",
        who: "CELESTIA",
        talk: "SPEAK WITH CELESTIA",
        ask: 'Ask Celestia… e.g. "status", "open downloads", "launch firefox"',
        termFoot: "SECURE SHELL · HOPE'S PEAK ACADEMY",
        nominal: "THE HOUSE ALWAYS WINS",
        bootReady: "THE TABLE IS SET. SHALL WE PLAY?",
        boot: [
          "SHUFFLING THE DECK",
          "STACKING THE CHIPS",
          "READING THE TABLE ............. DONE",
          "CHECKING FOR MARKED CARDS ..... NONE",
          "COUNTING THE HOUSE'S WINNINGS . DONE",
          "ALL BETS PLACED ............... READY",
        ],
        address: "my dear",
        pardon: "Pardon? Do speak clearly, if you please.",
        online: "Celestia Ludenberg, at your service. Let us begin the game.",
        assist: "What shall we wager on today?",
      },
    },
    // Aoi "Hina" Asahina, the Ultimate Swimming Pro: her red track jacket on pool water. The pool,
    // donut and pixel Hina are drawn in hud.js; css/asahina.css and js/hina.js do the rest
    // (mascot, swim-practice timer, donuts, ripples).
    asahina: {
      name: "Aoi Asahina",
      fonts: { display: "Bungee", mono: "Fredoka" },
      palette: {
        dark: {   // the pool at night
          acc: [255, 92, 64], cb: [255, 190, 170], warn: [255, 196, 46], crit: [255, 64, 96], ok: [196, 228, 64], shade: [0, 8, 22],
          d0: [3, 16, 34], d1: [6, 28, 56], d2: [10, 58, 100],
          bg: [2, 14, 30], panel: [8, 30, 58], hi: [255, 255, 255],
          text: [226, 242, 255], muted: [124, 164, 196], critSoft: [255, 150, 160],
          scan: 0, vignette: 0.55, glow: "0 0 6px rgba(255, 92, 64, .5), 0 0 16px rgba(255, 92, 64, .2)",
          alt: [64, 200, 255], core1: [255, 240, 246], core2: [255, 128, 184], plate: [6, 24, 48], node: [150, 224, 255],
        },
        light: {  // poolside in the sun
          acc: [214, 52, 36], cb: [150, 30, 20], warn: [190, 120, 0], crit: [210, 30, 60], ok: [86, 150, 16], shade: [10, 60, 90],
          d0: [246, 252, 255], d1: [226, 244, 252], d2: [186, 226, 246],
          bg: [206, 236, 248], panel: [244, 251, 255], hi: [6, 30, 50],
          text: [12, 44, 70], muted: [80, 120, 145], critSoft: [190, 40, 60],
          scan: 0, vignette: 0.12, glow: "0 0 2px rgba(214, 52, 36, .3)",
          alt: [0, 140, 210], core1: [255, 255, 255], core2: [255, 110, 165], plate: [250, 253, 255], node: [0, 150, 220],
        },
      },
      text: {
        title: "Aoi Asahina",
        subtitle: "THE ULTIMATE SWIMMING PRO",
        bootTitle: "HINA",
        consoleTitle: "Aoi Asahina",
        navConsole: "HINA",
        who: "HINA",
        talk: "TALK TO HINA",
        ask: 'Ask Hina… e.g. "status", "donut", "practice 25", "launch firefox"',
        termFoot: "POOL DECK · HOPE'S PEAK ACADEMY",
        nominal: "FEELING GREAT! LET'S GO!",
        bootReady: "ON YOUR MARKS… GET SET… GO!",
        boot: [
          "STRETCHING ..................... DONE",
          "GOGGLES ........................ ON",
          "SWIM CAP ....................... ON",
          "DONUTS EATEN ................... 3",
          "POOL TEMPERATURE ............... PERFECT",
          "LANE 4 ......................... READY",
        ],
        address: "buddy",
        pardon: "Huh? Sorry, I didn't catch that! One more time?",
        online: "Hiya! Aoi Asahina, Ultimate Swimming Pro, reporting for duty!",
        assist: "What are we doing today? Something active, I hope!",
      },
    },
    // 90s green-screen terminal: no side menu; driven from the command line and the F-key bar
    // (css/doom.css, app.js "DOOM command line")
    doom: {
      name: "D.O.O.M.",
      fonts: { display: "VT323", mono: "VT323" },
      palette: {
        dark: {
          acc: [64, 255, 120], cb: [170, 255, 190], warn: [255, 196, 0], crit: [255, 64, 64], ok: [120, 255, 170], shade: [0, 0, 0],
          d0: [0, 8, 3], d1: [2, 14, 6], d2: [6, 34, 14],
          bg: [1, 6, 2], panel: [3, 14, 6], hi: [225, 255, 230],
          text: [150, 255, 175], muted: [64, 156, 96], critSoft: [255, 124, 112],
          scan: 0.5, vignette: 0.9, glow: "0 0 4px rgba(64, 255, 120, .55)",
          alt: [196, 212, 200], core1: [235, 255, 240], core2: [140, 255, 170], plate: [2, 12, 5], node: [140, 255, 170],
        },
        light: {   // greenbar printer paper
          acc: [0, 120, 50], cb: [0, 80, 30], warn: [170, 100, 0], crit: [200, 30, 30], ok: [0, 130, 60], shade: [30, 60, 40],
          d0: [246, 250, 242], d1: [232, 242, 228], d2: [204, 228, 206],
          bg: [226, 236, 222], panel: [240, 247, 236], hi: [0, 30, 10],
          text: [10, 50, 25], muted: [80, 110, 90], critSoft: [180, 40, 40],
          scan: 0.08, vignette: 0.2, glow: "none",
          alt: [90, 100, 95], core1: [255, 255, 255], core2: [120, 200, 140], plate: [240, 247, 236], node: [0, 120, 50],
        },
      },
      text: {
        title: "D.O.O.M.",
        subtitle: "DIGITAL OVERLORD OPERATIONS MAINFRAME",
        bootTitle: "D.O.O.M.",
        consoleTitle: "D.O.O.M.",
        navConsole: "DOOM",
        who: "DOOM",
        talk: "ADDRESS DOOM",
        ask: 'Command DOOM… e.g. "status", "open downloads", "launch firefox"',
        termFoot: "SECURE LINK · LATVERIAN EMBASSY NET",
        nominal: "LATVERIA IS SECURE",
        bootReady: "DOOM IS ONLINE. KNEEL.",
        boot: [
          "LATVERIAN BIOS v4.04  (C) 1993 VON DOOM INDUSTRIES",
          "MEMORY TEST ................... 640K OK",
          "MOUNTING DOOMBOT CONTROL GRID . OK",
          "BREACHING S.H.I.E.L.D. FIREWALL  DONE",
          "LOADING SORCERY SUBROUTINES ... OK",
          "SCANNING FOR RICHARDS ......... NONE FOUND",
        ],
        address: "subject",
        pardon: "DOOM did not hear you. Speak up.",
        online: "DOOM is online. Doom does not ask; Doom commands.",
        assist: "State your command.",
      },
    },
  };

  /* on-screen wording for the current skin (falls back to J.A.R.V.I.S.) */
  HUD.str = (key) => {
    const s = HUD.SKINS[HUD.theme.skin] || HUD.SKINS.jarvis;
    return s.text[key] ?? HUD.SKINS.jarvis.text[key];
  };
})();
