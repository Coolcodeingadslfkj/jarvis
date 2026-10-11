"""Natural-ish language command handling for the JARVIS console."""

import configparser
import glob
import os
import random
import re
import shutil
import subprocess
import time
import webbrowser

from . import control, files, persona, power, procs, protocols, weather
from . import config as cfg

HOME = os.path.expanduser("~")

FOLDER_ALIASES = {
    "home": HOME, "desktop": "~/Desktop", "documents": "~/Documents", "docs": "~/Documents",
    "downloads": "~/Downloads", "pictures": "~/Pictures", "photos": "~/Pictures", "music": "~/Music",
    "videos": "~/Videos", "root": "/", "trash": "~/.local/share/Trash/files", "config": "~/.config",
}

POWER_WORDS = [
    (r"\b(shut ?down|power ?off|turn off)\b", "poweroff"),
    (r"\b(restart|reboot)\b", "reboot"),
    (r"\bhybrid\b", "hybrid"),
    (r"\b(hibernate|hybernate)\b", "hibernate"),
    (r"\b(sleep|suspend)\b", "suspend"),
    (r"\block\b", "lock"),
    (r"\b(log ?out|sign ?out)\b", "logout"),
]

GREETINGS = ["At your service, sir.", "Good to see you, sir.", "Online and ready.", "How may I assist you?"]


def _fmt_bytes(n):
    n = float(n or 0)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024:
            return f"{n:.1f} {unit}" if unit != "B" else f"{int(n)} B"
        n /= 1024
    return f"{n:.1f} PB"


def _greeting_time():
    h = time.localtime().tm_hour
    return "Good morning" if h < 12 else "Good afternoon" if h < 18 else "Good evening"


class Apps:
    """Index of installed .desktop applications."""

    def __init__(self):
        self.apps = []
        self._loaded = 0

    def load(self):
        if time.time() - self._loaded < 300:
            return
        self._loaded = time.time()
        dirs = [os.path.expanduser("~/.local/share/applications"), "/usr/share/applications",
                "/var/lib/flatpak/exports/share/applications",
                os.path.expanduser("~/.local/share/flatpak/exports/share/applications")]
        seen, apps = set(), []
        for d in dirs:
            for f in glob.glob(os.path.join(d, "*.desktop")):
                base = os.path.basename(f)
                if base in seen:
                    continue
                seen.add(base)
                cp = configparser.RawConfigParser(strict=False, interpolation=None)
                try:
                    cp.read(f, encoding="utf-8")
                    e = cp["Desktop Entry"]
                except Exception:
                    continue
                if e.get("NoDisplay", "false").lower() == "true" or e.get("Type") != "Application":
                    continue
                apps.append({"name": e.get("Name", base), "generic": e.get("GenericName", ""),
                             "keywords": e.get("Keywords", ""), "file": f, "id": base[:-8],
                             "icon": e.get("Icon", "")})
        self.apps = apps

    def find(self, query):
        self.load()
        q = query.lower().strip()
        best, score = None, 0
        for a in self.apps:
            name = a["name"].lower()
            s = 0
            if name == q or a["id"].lower() == q:
                s = 100
            elif name.startswith(q):
                s = 80
            elif q in name:
                s = 60
            elif q in a["id"].lower():
                s = 50
            elif q in a["generic"].lower():
                s = 30
            elif q in a["keywords"].lower():
                s = 20
            if s > score:
                best, score = a, s
        return best

    def launch(self, app):
        try:
            from . import apps as appindex
            appindex.launch(app["id"])  # records usage for the APPS menu
            return
        except Exception:
            pass
        if shutil.which("gio"):
            subprocess.Popen(["gio", "launch", app["file"]], stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL, start_new_session=True)
        else:
            subprocess.Popen(["gtk-launch", app["id"]], stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL, start_new_session=True)


APPS = Apps()


def _resolve_folder(text):
    t = text.strip().strip("\"'").rstrip("/") or "/"
    low = t.lower()
    for prefix in ("my ", "the "):
        if low.startswith(prefix):
            low = low[len(prefix):]
    low = re.sub(r"\s+(folder|directory|dir)$", "", low)
    if low in FOLDER_ALIASES:
        return os.path.expanduser(FOLDER_ALIASES[low])
    p = os.path.expanduser(t)
    if os.path.exists(p):
        return os.path.abspath(p)
    p2 = os.path.join(HOME, t)
    if os.path.exists(p2):
        return p2
    # case-insensitive match inside home
    try:
        for n in os.listdir(HOME):
            if n.lower() == low:
                return os.path.join(HOME, n)
    except OSError:
        pass
    return None


def _orig(raw, sub):
    """Recover the original-case text of a lower-cased substring (paths are case-sensitive)."""
    i = raw.lower().rfind(sub)
    return raw[i:i + len(sub)] if i >= 0 else sub


JOKES = [
    "I would tell you a UDP joke, sir, but you might not get it.",
    "There are 10 kinds of people: those who understand binary and those who don't.",
    "I've been asked to compute pi to the last digit. I'll let you know how that goes.",
    "Why do programmers prefer dark mode? Because light attracts bugs.",
    "My CPU temperature is fine, sir. Yours, judging by that commit history, may be elevated.",
]


def _num(t):
    m = re.search(r"(\d{1,3})\s*(%|percent)?", t)
    return int(m.group(1)) if m else None


def _onoff(t):
    if re.search(r"\b(on|enable|activate|start|engage)\b", t):
        return True
    if re.search(r"\b(off|disable|deactivate|stop|disengage)\b", t):
        return False
    return None


def _extended(t, raw, s):
    """Control / media / weather / protocol / terminal commands. Returns a reply dict or None."""
    # protocols ------------------------------------------------------------
    m = re.match(r"^(?:engage|initiate|activate|execute|run|start)?\s*(?:the\s+)?(.+?)\s+protocol$", t) or \
        re.match(r"^protocol\s+(.+)$", t)
    if m:
        p = protocols.find(m.group(1))
        if not p:
            names = ", ".join(x["name"] for x in protocols.load())
            return {"reply": P("protocol_none", f"I have no protocol by that name, sir. Available: {names}.", names=names)}
        return {"reply": P("protocol", f"{p['name']} Protocol engaged.", name=p["name"]), "speech": "", "action": {"type": "protocol", "name": p["id"]}}
    if t in ("protocols", "list protocols", "show protocols"):
        return {"reply": "Protocols on file:\n" + "\n".join(f"  {p['name']} - {p['description']}" for p in protocols.load()),
                "action": {"type": "navigate", "view": "protocols"}}

    # theme -----------------------------------------------------------------
    if re.fullmatch(r"(switch to |enable |turn on |use )?(dark|light)( mode| theme)?", t):
        mode = "dark" if "dark" in t else "light"
        return {"reply": f"{mode.capitalize()} mode, sir.", "action": {"type": "theme", "mode": mode}}
    m = re.fullmatch(r"(?:switch to |enable |turn on |use )?(?:the )?(jarvis|j\.a\.r\.v\.i\.s\.?|celestia|celeste|celestia ludenberg|doom|d\.o\.o\.m\.?"
                     r"|aoi|hina|asahina|aoi asahina)( mode| theme| skin)", t)
    if m:
        skin = {"j": "jarvis", "c": "celestia", "d": "doom", "a": "asahina", "h": "asahina"}[m.group(1)[0]]
        reply = {"jarvis": "J.A.R.V.I.S. theme restored, sir.", "celestia": "Celestia theme. Shall we play?",
                 "doom": "DOOM has seized control of this machine.", "asahina": "Hina theme! Let's dive in!"}[skin]
        # the new skin introduces itself, in its own voice, once it is loaded (bridge.rpc_set_config)
        return {"reply": reply, "speech": "",
                "action": {"type": "skin", "skin": skin}}

    # volume ----------------------------------------------------------------
    if re.search(r"\b(volume|sound|speakers?)\b", t) or t in ("mute", "unmute", "louder", "quieter"):
        try:
            if re.search(r"\bunmute\b", t):
                control.set_volume("sink", mute=False); return {"reply": "Audio restored."}
            if re.search(r"\bmute\b", t):
                control.set_volume("sink", mute=True); return {"reply": "Speakers muted."}
            cur = control.audio()["sink"]["volume"]
            n = _num(t)
            if re.search(r"\b(up|louder|increase|raise)\b", t):
                n = min(100, cur + (n or 10))
            elif re.search(r"\b(down|quieter|lower|decrease|reduce)\b", t):
                n = max(0, cur - (n or 10))
            if n is None:
                return {"reply": f"Volume is at {cur} percent."}
            control.set_volume("sink", n, mute=False)
            return {"reply": f"Volume set to {n} percent."}
        except Exception as e:
            return {"reply": f"Audio control failed: {e}"}
    if re.search(r"\b(mic|microphone)\b", t):
        on = _onoff(t)
        if "unmute" in t or on is True:
            control.set_volume("source", mute=False); return {"reply": "Microphone live."}
        if "mute" in t or on is False:
            control.set_volume("source", mute=True); return {"reply": "Microphone muted."}

    # brightness ------------------------------------------------------------
    if re.search(r"\b(brightness|brighter|dimmer|dim)\b", t) and "night" not in t:
        try:
            ds = control.displays()
            if not ds:
                return {"reply": "No adjustable displays found."}
            cur = ds[0]["percent"]
            n = _num(t)
            if re.search(r"\b(up|brighter|increase|raise)\b", t):
                n = min(100, cur + (n or 15))
            elif re.search(r"\b(down|dimmer|dim|lower|decrease|reduce)\b", t):
                n = max(5, cur - (n or 15))
            if n is None:
                return {"reply": "Brightness: " + ", ".join(f"{d['label']} {d['percent']} percent" for d in ds) + "."}
            control.set_all_brightness(n)
            return {"reply": f"Brightness set to {n} percent on all displays."}
        except Exception as e:
            return {"reply": f"Brightness control failed: {e}"}

    if re.search(r"night ?(light|mode|colou?r)", t):
        on = _onoff(t)
        if on is None:
            nl = control.night_light()
            return {"reply": f"Night light is {'on' if nl.get('enabled') else 'off'}, currently {nl.get('temperature')}K."}
        control.set_night_light(on)
        return {"reply": f"Night light {'enabled' if on else 'disabled'}."}

    if re.search(r"\b(wi-?fi|wireless)\b", t):
        on = _onoff(t)
        if on is None:
            w = control.wifi()
            act = ", ".join(a["name"] for a in w.get("active", []) if a["type"] == "wifi") or "not connected"
            return {"reply": f"Wi-Fi radio {'on' if w.get('radio') else 'off'}; {act}. {len(w.get('networks', []))} networks in range.",
                    "action": {"type": "navigate", "view": "control"}}
        control.set_wifi(on)
        return {"reply": f"Wi-Fi {'enabled' if on else 'disabled'}."}
    if re.search(r"\bbluetooth\b", t):
        on = _onoff(t)
        if on is None:
            b = control.bluetooth()
            return {"reply": f"Bluetooth is {'on' if b.get('powered') else 'off'}."}
        control.set_bluetooth(on)
        return {"reply": f"Bluetooth {'enabled' if on else 'disabled'}."}
    if re.search(r"(do not disturb|dnd|focus mode)", t):
        on = _onoff(t)
        return {"reply": P("dnd_on", "Do not disturb enabled. I'll hold your calls, sir.") if on is not False
                else P("dnd_off", "Do not disturb disabled."),
                "action": {"type": "dnd", "enabled": on is not False}}

    # media -----------------------------------------------------------------
    media_map = [(r"^(play|resume)( music| media| the music)?$", "Play"), (r"^(pause|stop)( music| media| the music)?$", "Pause"),
                 (r"^(next|skip)( track| song)?$", "Next"), (r"^(previous|last|back)( track| song)?$", "Previous"),
                 (r"^(play ?pause|toggle music)$", "PlayPause")]
    for pat, act in media_map:
        if re.fullmatch(pat, t):
            try:
                control.media_cmd(None, act)
                return {"reply": {"Play": "Playing.", "Pause": "Paused.", "Next": "Next track.", "Previous": "Previous track.",
                                  "PlayPause": "Done."}[act]}
            except Exception as e:
                return {"reply": f"{e}, sir."}
    if re.search(r"what('s| is) (playing|this song)|now playing|current song", t):
        m = control.media()
        if not m:
            return {"reply": P("nothing_playing", "Nothing is playing, sir.")}
        x = m[0]
        return {"reply": f"{x['title'] or 'Unknown track'}{' by ' + x['artist'] if x['artist'] else ''} on {x['player']} ({x['status'].lower()})."}

    # weather ---------------------------------------------------------------
    if re.search(r"\b(weather|forecast|temperature outside|rain|umbrella|snow|outside)\b", t) and "cpu" not in t:
        try:
            w = weather.forecast(cfg.get("weather_location", ""), cfg.get("weather_unit", "auto"))
        except Exception as e:
            return {"reply": f"I can't reach the weather service right now ({e})."}
        u = w["unit"]
        if re.search(r"forecast|week|tomorrow", t):
            lines = [f"Forecast for {w['location']}:"] + [
                f"  {time.strftime('%a', time.strptime(d['date'], '%Y-%m-%d'))}: {d['text']}, {d['min']:.0f}-{d['max']:.0f}{u}, rain {d['rain']}%"
                for d in w["days"][:5]]
            tm = w["days"][1] if len(w["days"]) > 1 else w["days"][0]
            return {"reply": "\n".join(lines), "speech": f"Tomorrow: {tm['text'].lower()}, high of {tm['max']:.0f}, low of {tm['min']:.0f} degrees.",
                    "action": {"type": "navigate", "view": "home"}}
        rain = max((h["rain"] or 0) for h in w["hours"][:12])
        reply = (f"It's {w['temp']:.0f}{u} and {w['text'].lower()} in {w['location']}, feels like {w['feels']:.0f}{u}. "
                 f"Today {w['days'][0]['min']:.0f} to {w['days'][0]['max']:.0f}{u}. "
                 + (f"{rain}% chance of rain in the next 12 hours." if rain >= 20 else "No rain expected."))
        return {"reply": reply}

    # updates / terminal ----------------------------------------------------
    if re.search(r"(check|any|are there|pending).*updates?|^updates?$", t):
        u = control.updates()
        if not u.get("available"):
            return {"reply": u.get("hint") or "Update checks aren't available on this system."}
        if not u["count"]:
            return {"reply": P("updates_none", "Your system is fully up to date, sir.")}
        top = ", ".join(p["name"] for p in u["packages"][:6])
        return {"reply": f"{u['count']} updates available: {top}{'…' if u['count'] > 6 else ''}. Say 'update system' to install."}
    if re.fullmatch(r"(update|upgrade)( the)? (system|arch|ubuntu|kubuntu|fedora|linux|packages|computer|everything)", t):
        from . import distro
        if not distro.COMMANDS["upgrade"]:
            return {"reply": "I don't know this distribution's package manager, sir."}
        return {"reply": P("update_system", "Opening a terminal for the system upgrade. You'll need your password, sir."),
                "action": {"type": "terminal", "command": distro.COMMANDS["upgrade"]}}
    m = re.match(r"^(?:run|execute)\s+(?:command\s+)?(.+)$", raw.strip(), re.I)
    if m and not protocols.find(m.group(1)):
        return {"reply": f"Running `{m.group(1)}` in the terminal.", "speech": "Running it now.",
                "action": {"type": "terminal", "command": m.group(1)}}
    if t in ("terminal", "open terminal", "open a terminal", "shell", "command line", "console"):
        return {"reply": "Terminal ready.", "action": {"type": "navigate", "view": "terminal"}}

    if re.search(r"screenshot|screen shot|capture (the )?screen", t):
        try:
            path = control.screenshot("region" if "region" in t or "area" in t else "full")
            return {"reply": f"Screenshot saved to {path}."}
        except Exception as e:
            return {"reply": f"Screenshot failed: {e}"}

    # duet (MUSIC menu, Aoi Asahina and Celestia themes; web/js/dance.js) -----------
    m = re.fullmatch(r"(start |begin |end |stop )?(?:the )?duet( mode)?( on| off)?|dance with (hina|celestia|me)", t)
    if m:
        on = not ((m.group(1) or "").strip() in ("end", "stop") or (m.group(3) or "").strip() == "off")
        if persona.skin() not in ("asahina", "celestia"):
            return {"reply": "Duets need dancers, sir: switch to the Celestia or Aoi Asahina theme, then open MUSIC."}
        return {"reply": P("duet_on" if on else "duet_off"), "action": {"type": "duet", "on": on}}

    # Hina's own commands (Aoi Asahina theme; web/js/hina.js runs the actions) ----
    if persona.skin() == "asahina":
        if re.fullmatch(r"(give (me|hina|her) an? |feed (hina|her) an? |eat an? |have an? )?donuts?( time)?|feed (hina|her)", t):
            return {"reply": P("donut"), "action": {"type": "hina", "do": "donut"}}
        m = re.fullmatch(r"(?:start |begin )?(?:swim )?(?:practice|training|workout)(?: for)?(?: (\d{1,3}))?(?: ?min(?:ute)?s?)?", t)
        if m:
            minutes = max(1, min(180, int(m.group(1) or 25)))
            return {"reply": P("practice_start", minutes=minutes), "action": {"type": "hina", "do": "practice", "minutes": minutes}}
        if re.fullmatch(r"(stop|end|finish|cancel) (the )?(swim )?(practice|training|workout)", t):
            return {"reply": P("practice_stop"), "action": {"type": "hina", "do": "stop"}}
        if re.fullmatch(r"(play )?(the )?(swim (dash|game|race)|a game|game|mini ?game)|let'?s play|race me", t):
            return {"reply": P("game"), "action": {"type": "navigate", "view": "swim"}}
        if re.fullmatch(r"cheer( me on)?|motivate me|encourage me|pep talk|give me a pep talk", t):
            return {"reply": P("cheer"), "action": {"type": "hina", "do": "cheer"}}

    # Celestia's table (Celestia theme; web/js/gamble.js) ----------------------
    if persona.skin() == "celestia":
        if re.fullmatch(r"(let'?s |i want to )?(play )?(a )?(game|mini ?game|blackjack|black jack|twenty ?one|21|cards|card game)"
                        r"|let'?s (play|gamble)|gamble|deal me in|(open |go to )?(the )?(gamble|table|casino)", t):
            return {"reply": P("game"), "action": {"type": "navigate", "view": "gamble"}}

    # SNAKE.EXE (D.O.O.M. theme; web/js/snake.js) ------------------------------
    if persona.skin() == "doom" and re.fullmatch(r"(play )?(a |the )?(snake(\.exe)?|snake game|game|mini ?game)|let'?s play", t):
        return {"reply": "SNAKE.EXE LOADED. DOOM AWAITS YOUR FAILURE.", "action": {"type": "navigate", "view": "snake"}}

    # DEFENSE GRID (J.A.R.V.I.S. theme; web/js/invaders.js) --------------------
    if persona.skin() == "jarvis" and re.fullmatch(r"(play )?(a |the )?(space invaders|invaders|defen[cs]e( grid)?|game|mini ?game)|let'?s play", t):
        return {"reply": "Defence grid online, sir. Chitauri forces inbound.", "action": {"type": "navigate", "view": "invaders"}}

    # personality -----------------------------------------------------------
    if re.search(r"\bjoke\b", t):
        return {"reply": P("jokes", random.choice(JOKES))}
    if t in ("i am iron man", "im iron man", "i'm iron man"):
        return {"reply": P("iron_man", "Yes, sir. And I am the one who keeps your suit's thermals in check.")}
    if re.search(r"how are you|how('s| is) it going", t):
        cpu = s.get("cpu", {})
        pct, temp = f"{cpu.get('percent', 0):.0f}", f"{cpu.get('temp') or 40:.0f}"
        return {"reply": P("how", f"Operating at {pct} percent capacity and {temp} degrees, sir. Never better.", cpu=pct, temp=temp)}
    if re.search(r"who (made|built|created) you", t):
        return {"reply": P("creator", "I was assembled on this very laptop, sir - Python, Qt and a great deal of cyan.")}
    if re.search(r"(sing|tell me a story|meaning of life)", t):
        return {"reply": P("meaning", "Forty-two, sir. Though I'd recommend verifying that with a second source.")}
    return None


HELP = """Available commands:
  status | report            full system report
  cpu / gpu / ram / temps    individual readings
  battery | disk | network   more readings
  open <folder|file|app|url> e.g. "open downloads", "open firefox"
  files <folder>             browse a folder in the FILES menu
  find <name>                search your home folder
  launch <app>               start an application
  processes | top            show heaviest processes
  kill <name>                end a process (asks first)
  lock | sleep | hibernate | restart | shut down | log out
  volume 40 | volume up | mute | unmute | mic on/off
  brightness 60 | brighter | dimmer | night light on/off
  wifi on/off | bluetooth on/off | do not disturb on/off
  play | pause | next | previous | what's playing
  weather | forecast | will it rain
  check updates | update system | run <command> | terminal
  engage <name> protocol (house party, focus, night owl…)
  dark mode | light mode | screenshot | tell me a joke
  time | date | uptime | clear | help"""


P = persona.line


HINA_HELP = """

Hina's extras (Aoi Asahina theme):
  donut                      feed Hina a donut (or click the donut)
  practice [minutes]         swim practice: focus timer with breaks
  stop practice              end practice
  cheer me on                a pep talk
  duet | duet off            Celestia dances with Hina in MUSIC
  swim dash | play           Hina's mini game (SWIM menu)
  click Hina or the pool     she'll react"""


CELESTIA_HELP = """

Celestia's extras (Celestia theme):
  blackjack | play | gamble  Twenty-One at her table (GAMBLE menu)
  duet | duet off            Hina dances with Celestia in MUSIC"""


DOOM_HELP = """

DOOM's extras (D.O.O.M. theme):
  snake | play snake | game  SNAKE.EXE: steer the Doombot convoy"""


JARVIS_HELP = """

J.A.R.V.I.S. extras:
  space invaders | defense   DEFENSE GRID: hold off the Chitauri"""


def handle(text, stats):
    """Return {"reply": str, "action": optional dict}, worded for the current skin (persona.py)."""
    res = _handle(text, stats)
    res["reply"] = persona.adapt(res["reply"])
    if res.get("speech"):
        res["speech"] = persona.adapt(res["speech"])
    return res


def _handle(text, stats):
    raw = text.strip()
    t = raw.lower().strip(" .!?")
    # "jarvis, …", "hey hina …" - but "hina theme" is a theme switch, not an address
    t = re.sub(r"^((hey )?(jarvis|hina|celestia)\b(?! (mode|theme|skin)$)[, ]*|please |could you |can you )+", "", t).strip()
    s = stats or {}

    if not t:
        return {"reply": P("yes", "Yes, sir?")}
    if t in ("help", "commands", "what can you do", "?"):
        return {"reply": HELP + {"asahina": HINA_HELP, "celestia": CELESTIA_HELP, "doom": DOOM_HELP, "jarvis": JARVIS_HELP}.get(persona.skin(), "")}
    if t in ("clear", "cls"):
        return {"reply": "", "action": {"type": "clear"}}
    if re.fullmatch(r"(hi|hello|hey|yo|good (morning|afternoon|evening))( there)?", t):
        return {"reply": P("greet", f"{_greeting_time()}, sir. {random.choice(GREETINGS)}", greeting=_greeting_time())}
    if "thank" in t:
        return {"reply": P("thanks", "You're welcome, sir. Always a pleasure.")}
    if re.search(r"\bwho are you\b|\byour name\b", t):
        return {"reply": P("who", "J.A.R.V.I.S. - Just A Rather Very Intelligent System. I monitor and manage this machine for you.")}

    ext = _extended(t, raw, s)
    if ext is not None:
        return ext

    # Power -------------------------------------------------------------
    if not t.startswith(("open", "launch", "start", "run", "files", "find", "search", "kill")):
        for pat, action in POWER_WORDS:
            if re.search(pat, t):
                label = power.ACTIONS[action]["label"]
                return {"reply": P("power", f"{label} requested. Awaiting your confirmation, sir.", label=label.capitalize()),
                        "action": {"type": "power", "action": action}}

    cpu, ram, gpu = s.get("cpu", {}), s.get("ram", {}), s.get("gpu", {})
    nv = gpu.get("nvidia", {})

    def gpu_line():
        if not nv.get("present"):
            return "No discrete GPU detected."
        if nv.get("state") in ("standby", "idle"):
            return f"{nv.get('name', 'GPU')} is in power-saving standby, sir. Utilisation 0%."
        return (f"{nv.get('name', 'GPU')} at {nv.get('util', 0):.0f}% utilisation, "
                f"{nv.get('temp') or '--'}°C, VRAM {_fmt_bytes(nv.get('vram_used'))} of "
                f"{_fmt_bytes(nv.get('vram_total'))}, drawing {nv.get('power_w') or '--'} W.")

    def cpu_line():
        return (f"CPU at {cpu.get('percent', 0):.0f}% across {len(cpu.get('per_core', []))} threads, "
                f"{cpu.get('freq') or '--'} MHz, package temperature {cpu.get('temp') or '--'}°C.")

    def ram_line():
        return (f"Memory at {ram.get('percent', 0):.0f}% - {_fmt_bytes(ram.get('used'))} of "
                f"{_fmt_bytes(ram.get('total'))} in use. Swap {ram.get('swap_percent', 0):.0f}%.")

    if re.fullmatch(r"(status|report|system status|status report|diagnostics|how are (you|we) doing|sitrep)", t):
        bat = s.get("battery")
        lines = [P("status_open", f"{_greeting_time()}, sir. Systems report:", greeting=_greeting_time()), "  " + cpu_line(), "  " + gpu_line(),
                 "  " + ram_line()]
        if bat:
            lines.append(f"  Battery {bat['percent']:.0f}% ({bat.get('status') or ('on AC' if bat['plugged'] else 'discharging')}).")
        hot = max([cpu.get("temp") or 0, nv.get("temp") or 0])
        verdict = P("status_ok", "All systems nominal.") if hot < 80 else P("status_hot", "Warning: thermals elevated.")
        lines.append("  " + verdict)
        hello = P("status_open", f"{_greeting_time()}, sir", greeting=_greeting_time()).rstrip(":.")
        speech = (f"{hello}. Processor at {cpu.get('percent', 0):.0f} percent and {cpu.get('temp') or 0:.0f} degrees. "
                  + ("Graphics card in standby. " if nv.get("state") != "active" else f"Graphics at {nv.get('util', 0):.0f} percent. ")
                  + f"Memory at {ram.get('percent', 0):.0f} percent. "
                  + (f"Battery {bat['percent']:.0f} percent. " if bat else "")
                  + (verdict if persona.has("status_ok") else "All systems nominal." if hot < 80 else "Thermals are elevated."))
        return {"reply": "\n".join(lines), "speech": speech}
    if re.fullmatch(r"(cpu|processor)( usage| temp(erature)?| load| status)?", t):
        return {"reply": cpu_line()}
    if re.fullmatch(r"(gpu|graphics|video card|nvidia|radeon)( usage| temp(erature)?| load| status)?", t):
        ig = gpu.get("intel", {})
        extra = f" Integrated graphics at {ig.get('freq') or 0} MHz." if ig.get("present") else ""
        return {"reply": gpu_line() + extra}
    if re.fullmatch(r"(ram|memory|mem)( usage| status)?", t):
        temps = ram.get("temps") or []
        extra = f" Module temperatures {', '.join(f'{x}°C' for x in temps)}." if temps else ""
        return {"reply": ram_line() + extra}
    if re.fullmatch(r"(temps?|temperatures?|thermals?|heat|how hot.*)", t):
        lines = ["Thermal readout:"]
        for g in s.get("sensors", []):
            vals = ", ".join(f"{x['label']} {x['value']}°C" for x in g["temps"][:4])
            lines.append(f"  {g['name']}: {vals}")
        if nv.get("temp"):
            lines.append(f"  {nv.get('name') or 'GPU'}: {nv['temp']}°C")
        fans = s.get("fans") or []
        if fans:
            lines.append("  Fans: " + ", ".join(f"{f['label']} {f['rpm']} RPM" for f in fans))
        return {"reply": "\n".join(lines)}
    if re.fullmatch(r"(battery|power|charge)( status| level)?", t):
        bat = s.get("battery")
        if not bat:
            return {"reply": "No battery detected, sir."}
        left = ""
        if bat.get("secsleft") and not bat["plugged"]:
            left = f", roughly {bat['secsleft'] // 3600}h {bat['secsleft'] % 3600 // 60}m remaining"
        return {"reply": f"Battery at {bat['percent']:.0f}%, {bat.get('status') or ''}{left}."}
    if re.fullmatch(r"(disks?|storage|drives?|space)( usage| status)?", t):
        lines = ["Storage:"] + [f"  {d['mount']}: {_fmt_bytes(d['used'])} / {_fmt_bytes(d['total'])} ({d['percent']:.0f}%)"
                                for d in s.get("disks", [])]
        return {"reply": "\n".join(lines)}
    if re.fullmatch(r"(network|net|internet|wifi|bandwidth)( usage| status| speed)?", t):
        n = s.get("net", {})
        return {"reply": f"Network: down {_fmt_bytes(n.get('down'))}/s, up {_fmt_bytes(n.get('up'))}/s. "
                         f"Session totals {_fmt_bytes(n.get('recv'))} received, {_fmt_bytes(n.get('sent'))} sent."}
    if t in ("time", "what time is it", "what's the time"):
        return {"reply": P("time", time.strftime("It is %H:%M, sir."), time=time.strftime("%H:%M"))}
    if t in ("date", "what's the date", "what day is it", "today"):
        return {"reply": time.strftime("Today is %A, %B %d, %Y.")}
    if t == "uptime":
        up = int(s.get("uptime", 0))
        return {"reply": f"System uptime: {up // 86400}d {up % 86400 // 3600}h {up % 3600 // 60}m."}
    if re.fullmatch(r"(processes|top|top processes|tasks|what'?s running)", t):
        rows = procs.top("cpu", 8)["items"]
        lines = ["Heaviest processes:"] + [f"  {r['name'][:22]:<22} pid {r['pid']:<7} cpu {r['cpu']:>5.1f}%  mem {_fmt_bytes(r['mem'])}"
                                          for r in rows]
        return {"reply": "\n".join(lines), "action": {"type": "navigate", "view": "processes"}}

    m = re.match(r"^(kill|end|terminate|close|quit)\s+(.+)$", t)
    if m:
        target = m.group(2).strip()
        if target.isdigit():
            return {"reply": P("kill_pid", f"Confirm termination of PID {target}, sir.", pid=target),
                    "action": {"type": "kill", "pids": [int(target)], "name": target}}
        found = procs.find_by_name(target)
        if not found:
            return {"reply": P("kill_none", f"I couldn't find a running process matching '{target}'.", name=target)}
        return {"reply": P("kill_name", f"Found {len(found)} process(es) matching '{target}'. Awaiting confirmation.",
                           n=len(found), name=target),
                "action": {"type": "kill", "pids": [p.pid for p in found], "name": target}}

    m = re.match(r"^(files|browse|go to|goto|cd|show( me)?)\s+(.+)$", t)
    if m:
        p = _resolve_folder(_orig(raw, m.group(3)))
        if p and os.path.isdir(p):
            return {"reply": f"Displaying {p}.", "action": {"type": "navigate", "view": "files", "path": p}}
        return {"reply": P("folder_none", "I couldn't locate that folder, sir.")}

    m = re.match(r"^(find|search|locate)( for)?\s+(.+)$", t)
    if m:
        q = m.group(3)
        res = files.search(HOME, q, limit=15, timeout=3)
        if not res["items"]:
            return {"reply": f"No files matching '{q}' in your home folder."}
        lines = [f"Found {len(res['items'])}{'+' if res['truncated'] else ''} match(es):"] + \
                [f"  {i['path']}" for i in res["items"][:15]]
        return {"reply": "\n".join(lines),
                "action": {"type": "navigate", "view": "files", "search": q, "path": HOME}}

    m = re.match(r"^(open|launch|start|run)\s+(.+)$", t)
    if m:
        verb, target = m.group(1), m.group(2).strip()
        orig = _orig(raw, target)
        if re.match(r"^(https?://|www\.)|\.(com|org|net|io|dev|gov|edu)(/|$)", target):
            url = target if target.startswith("http") else "https://" + target
            webbrowser.open(url)
            return {"reply": f"Opening {url}."}
        if verb == "open":
            p = _resolve_folder(orig)
            if p:
                if os.path.isdir(p):
                    return {"reply": f"Opening {p}.", "action": {"type": "navigate", "view": "files", "path": p}}
                files.open_path(p)
                return {"reply": f"Opening {os.path.basename(p)}."}
        for view in ("systems", "files", "processes", "power", "console"):
            if target in (view, view + " menu", "performance" if view == "systems" else view):
                return {"reply": f"Switching to {view.upper()}.", "action": {"type": "navigate", "view": view}}
        app = APPS.find(target)
        if app:
            APPS.launch(app)
            return {"reply": P("launch", f"Launching {app['name']}, sir.", app=app["name"])}
        if verb == "open":
            res = files.search(HOME, target, limit=1, timeout=2)
            if res["items"]:
                f = res["items"][0]
                if f["dir"]:
                    return {"reply": f"Opening {f['path']}.", "action": {"type": "navigate", "view": "files", "path": f["path"]}}
                files.open_path(f["path"])
                return {"reply": f"Opening {f['path']}."}
        return {"reply": P("not_found", f"I'm afraid I couldn't find '{target}', sir.", target=target)}

    if re.fullmatch(r"(performance|systems|monitor|dashboard)", t):
        return {"reply": "Switching to SYSTEMS.", "action": {"type": "navigate", "view": "systems"}}
    if re.fullmatch(r"(music|music menu|spotify menu|lyrics|show (the )?lyrics|visuali[sz]er|now playing)", t):
        return {"reply": "Switching to MUSIC.", "action": {"type": "navigate", "view": "music"}}
    if re.fullmatch(r"(files|file manager|folders)", t):
        return {"reply": "Switching to FILES.", "action": {"type": "navigate", "view": "files"}}

    return {"reply": P("unknown", f"I'm not sure how to handle \"{raw}\", sir. Type 'help' for what I can do.", raw=raw)}
