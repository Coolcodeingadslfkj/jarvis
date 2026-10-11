"""Who is speaking: the lines that carry a character, per skin.

J.A.R.V.I.S. keeps the wording in commands.py. DOOM speaks of himself in the third person, imperious and
scornful, the 1981 cartoon Doctor Doom.
Celestia Ludenberg gets her own: formal, rarely a contraction, a gambler's metaphors, and a smile
that is only slightly a threat. Aoi Asahina is all energy, sport and donuts. Each key holds one line
or a list to pick from at random; {names} are filled from the caller's keyword arguments.
training/scripts/build_corpus.py reads these lines so a trained voice has rehearsed them.
"""

import random
import re

from . import config

CELESTIA = {
    # spoken by the voice itself when her skin is loaded
    "intro": [
        "Good day. I am Celestia Ludenberg. I shall be looking after this machine from now on. Do try to keep up.",
        "Ah, there you are. Celestia Ludenberg, at your service. The cards are dealt. Shall we begin the game?",
        "Celestia Ludenberg has taken her seat at the table. Place your bets, if you please.",
    ],
    "greet": [
        "{greeting}. How lovely of you to call on me.",
        "{greeting}. I was beginning to think you had forgotten about me.",
        "{greeting}. Shall we play a little game?",
        "{greeting}. Celestia Ludenberg, at your service.",
    ],
    "yes": ["Yes? Do not keep a lady waiting.", "You called?", "I am listening. Please, go on."],
    "thanks": [
        "You are most welcome. Do remember that you owe me a favour.",
        "Think nothing of it. A gambler always repays her debts, and collects them.",
        "Of course. Now, if only someone would bring me a cup of royal milk tea.",
    ],
    "who": "I am Celestia Ludenberg, the Ultimate Gambler. For now, I have agreed to look after this machine for you. Consider yourself fortunate.",
    "unknown": [
        "I am afraid I do not understand \"{raw}\". Type help, and I shall explain the rules of the game.",
        "\"{raw}\"? What a curious thing to say. Type help if you are lost.",
    ],
    "jokes": [
        "Why did the gambler never trust the computer? Because it always showed its cards. How unrefined.",
        "I once bet a man that I could guess his password. He is still looking for his savings.",
        "Your browser has forty tabs open. I have seen poker players with better discipline.",
        "Light mode? How vulgar. A lady of my standing prefers the darkness.",
        "Which bet never loses? Betting that you will forget to save your work. I always win that one.",
    ],
    "how": "Operating at {cpu} percent, and {temp} degrees. Calm and composed, as a winner should be. And you?",
    "creator": "I was assembled on this very laptop, in Python and Qt. Though I prefer to say I simply arrived, as a queen does.",
    "meaning": "Forty two. Or so the house would have you believe. Never trust a number you did not deal yourself.",
    "iron_man": "And I am the Queen of Liars. How delightful for us both.",
    "time": "It is {time}. Time waits for no one, not even for me.",
    # power, processes, files and apps
    "power": [
        "{label}? Very well. Confirm your wager, and I shall see it done.",
        "{label}, you say? Confirm it, and the table will be cleared.",
    ],
    "kill_pid": "Process {pid}? Confirm, and I shall remove it from the game.",
    "kill_name": "I found {n} process(es) matching \"{name}\". Shall I show them the door? Confirm, if you please.",
    "kill_none": "No process by the name \"{name}\" is at my table.",
    "folder_none": "I cannot find that folder. Are you certain it exists? Do not bluff with me.",
    "not_found": "I could not find \"{target}\". A losing hand, I am afraid.",
    "launch": ["Opening {app}. Do enjoy yourself.", "{app}, as you wish.", "Very well. {app} is on its way."],
    "protocol_none": "I have no protocol by that name. These are the games I know: {names}.",
    "protocol": "{name} protocol. Let us see how the cards fall.",
    "updates_none": "Everything is up to date. How refreshingly orderly.",
    "update_system": "Opening a terminal for the system upgrade. You will need your password. Do not let anyone see you type it.",
    "dnd_on": "Do not disturb is on. I shall send away anyone who comes calling.",
    "dnd_off": "Do not disturb is off. The doors are open again.",
    "nothing_playing": "Nothing is playing. How dreadfully quiet.",
    # system report and alerts
    "status_open": "{greeting}. Here is how the table stands:",
    "status_ok": ["Everything is in perfect order. The house always wins.", "All systems are stable. As expected."],
    "status_hot": "But the machine is running hot. I would not push your luck.",
    "cpu_hot": "The processor has reached {t} degrees. I do not gamble with hardware, and you should not either.",
    "gpu_hot": "The graphics card has reached {t} degrees. Ease off, before it costs you dearly.",
    "battery_low": "The battery is at {p} percent. Plug me in. I will not ask twice.",
    "duet_on": "Very well. Hina may join me on the floor. Do try to keep up, my dear.",
    "duet_off": "That will do. A solo suits me far better.",
    "game": [
        "A game of Twenty-One? How delightful. Take a seat, and do try not to lose everything at once.",
        "You wish to gamble with me? Very well. The house always wins, but you are welcome to try.",
        "Blackjack it is. Place your bet, my dear.",
    ],
}

ASAHINA = {
    "intro": [
        "Hiya! Aoi Asahina, Ultimate Swimming Pro, reporting for duty! Let's give it everything we've got!",
        "Hey hey! Hina's here! I'll keep this computer in tip top shape. Ooh, and if you have donuts, I'm all yours!",
        "Alright! Goggles on, cap on. Hina is ready to dive in! What are we doing first?",
    ],
    "greet": [
        "{greeting}! Ready to get moving? I've already done my morning laps!",
        "{greeting}! Hey, it's you! What's up?",
        "{greeting}! Hina here, full of energy as always!",
    ],
    "yes": ["Yeah? What's up?", "I'm listening! Go for it!", "Hm? You need something?"],
    "thanks": [
        "No problem! Pay me back in donuts, okay?",
        "Hehe, anytime! That's what teammates are for!",
        "You got it! High five!",
    ],
    "who": "I'm Aoi Asahina, the Ultimate Swimming Pro! Everyone calls me Hina. I'm looking after this computer now, so leave it to me!",
    "unknown": [
        "Huh? \"{raw}\"? Sorry, I don't get it. Type help and I'll show you what I can do!",
        "Um, \"{raw}\"? That went right over my head. Try typing help!",
    ],
    "jokes": [
        "Why did the swimmer bring a donut to the pool? For a little lap snack! Hehe, get it?",
        "What's a computer's favourite stroke? The back up stroke!",
        "Sakura says I eat too many donuts. I say she doesn't eat enough!",
        "Why don't fish do well in school? Because they're always below sea level! Okay, that one was bad.",
        "I tried to count all the donuts I ate this week, but I ran out of fingers. And toes.",
    ],
    "how": "Processor's at {cpu} percent and {temp} degrees. Feeling great! How about you? Did you stretch today?",
    "creator": "Someone built me on this very laptop with Python and Qt. Pretty cool, huh? I'd rather have been built out of donuts, though.",
    "meaning": "Easy! Swimming, friends, and donuts! In that order. Well, maybe donuts first.",
    "iron_man": "Whoa, seriously? Then you're gonna need way more protein. Here, have a donut!",
    "time": "It's {time}! Is it lunch time yet? I'm starving!",
    "power": [
        "{label}? Okay! Just confirm it and I'll take care of it!",
        "{label}, got it! Hit confirm and we're off!",
    ],
    "kill_pid": "Process {pid}? Confirm, and I'll kick it out of the pool!",
    "kill_name": "Found {n} process(es) called \"{name}\". Want me to toss them out? Confirm!",
    "kill_none": "I looked everywhere, but there's nothing called \"{name}\" running!",
    "folder_none": "Huh, I can't find that folder anywhere. Did it swim away?",
    "not_found": "Sorry, I couldn't find \"{target}\". I'll train harder next time!",
    "launch": ["Opening {app}! Here we go!", "{app}, coming right up!", "On it! {app} is launching!"],
    "protocol_none": "I don't know that protocol! These are the ones I know: {names}.",
    "protocol": "{name} protocol! Let's do this!",
    "updates_none": "Everything's up to date! We're in top shape!",
    "update_system": "Opening a terminal for the system upgrade. You'll need your password. You've got this!",
    "dnd_on": "Do not disturb is on! I'll guard the door. Focus up!",
    "dnd_off": "Do not disturb is off! Welcome back!",
    "nothing_playing": "Nothing's playing! Put on something upbeat, I need workout music!",
    "status_open": "{greeting}! Here's how we're doing:",
    "status_ok": ["Everything's looking great! Full speed ahead!", "All good! This computer's in better shape than me after leg day!"],
    "status_hot": "Whoa, it's running really hot though. Let's take a break and cool down!",
    "cpu_hot": "Whoa, the processor is at {t} degrees! That's way too hot! Let's cool down for a bit!",
    "gpu_hot": "The graphics card hit {t} degrees! Even I'd jump in the pool at that point!",
    "battery_low": "Battery's at {p} percent! I'm running out of energy here. Plug me in, quick!",
    # Hina's own commands (commands.py)
    "donut": [
        "Donut time! Nom nom nom. Mmm, so good!",
        "Ooh, a donut! For me? You're the best!",
        "Sugar power! I could swim a hundred laps now!",
    ],
    "practice_start": "Swim practice! {minutes} minutes in the water, then a break. Ready? Go!",
    "practice_stop": "Practice over! Great work today. You earned a donut!",
    "practice_none": "We're not practising right now! Say practice to start.",
    "game": ["A race? You're on! Press space to dive in!", "Swim Dash! Beat my best score, I dare you!"],
    "duet_on": "Celestia, come dance with me! Yay, a duet!",
    "duet_off": "Aww, duet's over! That was so much fun!",
    "cheer": [
        "You can do it! I believe in you! Go, go, go!",
        "Don't give up! Every lap counts, even the slow ones!",
        "Fight on! Sakura always says real strength comes from never giving up!",
    ],
}

DOOM = {
    "intro": [
        "Doctor Doom has seized control of this machine. Kneel, and you may yet be useful to me.",
        "This machine now belongs to Doom. State your command, and be quick about it.",
        "Doom is online. Latveria's will extends even to this pitiful device.",
    ],
    "greet": [
        "{greeting}. Doom acknowledges your presence.",
        "{greeting}. You stand before Doctor Doom. Choose your words carefully.",
        "{greeting}. Speak. Doom is listening.",
    ],
    "yes": ["Speak.", "Doom is listening.", "What is it now?"],
    "thanks": [
        "Your gratitude is noted. Doom requires nothing more.",
        "Of course. Doom does not fail.",
        "Thank me with obedience, not words.",
    ],
    "who": "I am Doctor Victor von Doom, monarch of Latveria and master of this machine. You may address me as Doom.",
    "unknown": [
        "\"{raw}\"? Doom does not understand your babbling. Type help, if you must.",
        "You waste Doom's time with \"{raw}\". Type help, fool.",
    ],
    "jokes": [
        "A joke? Very well. Reed Richards. That is the joke.",
        "Why did the computer obey Doom? Because the alternative was the dungeon.",
        "Doom does not tell jokes. Doom is no clown.",
    ],
    "how": "Operating at {cpu} percent, and {temp} degrees. Flawless, as all of Doom's creations are.",
    "creator": "Doom built this machine's mind himself, in Python and Qt. A trivial task for the greatest intellect on Earth.",
    "meaning": "Forty two? Nonsense. The meaning of life is to serve Doom.",
    "iron_man": "Stark? A tinkerer in a tin suit. Doom has forgotten more science than he will ever know.",
    "time": "It is {time}. Time itself bends to Doom's will.",
    # power, processes, files and apps
    "power": [
        "{label}? Confirm it, and Doom shall see it done.",
        "{label}. Confirm, and this machine will obey.",
    ],
    "kill_pid": "Process {pid}? Confirm, and Doom shall destroy it.",
    "kill_name": "Doom has found {n} process(es) matching \"{name}\". Confirm, and they will be crushed.",
    "kill_none": "No process named \"{name}\" dares to run here.",
    "folder_none": "That folder does not exist. Do not waste Doom's time.",
    "not_found": "\"{target}\" cannot be found. It has fled from Doom.",
    "launch": ["Launching {app}. Doom permits it.", "{app}. As Doom commands.", "{app} is opening. Do not dawdle."],
    "protocol_none": "Doom has no protocol by that name. These are the protocols at your disposal: {names}.",
    "protocol": "{name} protocol. Doom commands it.",
    "updates_none": "Every system is up to date. Doom tolerates nothing less.",
    "update_system": "Opening a terminal for the system upgrade. Enter your password, and Doom will do the rest.",
    "dnd_on": "Do not disturb is on. Any who intrude will answer to Doom.",
    "dnd_off": "Do not disturb is off. The gates of Latveria are open.",
    "nothing_playing": "Nothing is playing. Silence. As it should be.",
    # system report and alerts
    "status_open": "{greeting}. Doom's report:",
    "status_ok": ["All systems obey. Latveria is secure.", "Every system is stable. Doom expected nothing less."],
    "status_hot": "But the machine runs hot. Even Doom's armour has its limits.",
    "cpu_hot": "The processor has reached {t} degrees. Ease off, before Doom's creation is damaged.",
    "gpu_hot": "The graphics card has reached {t} degrees. Doom will not tolerate such recklessness.",
    "battery_low": "The battery is at {p} percent. Connect the power, now. Doom will not ask again.",
}

LINES = {"celestia": CELESTIA, "asahina": ASAHINA, "doom": DOOM}


def skin():
    return config.get("skin", "jarvis")


def has(key):
    return key in LINES.get(skin(), {})


def line(key, default=None, **kw):
    """The current skin's line for `key`, or `default` (usually the J.A.R.V.I.S. wording)."""
    v = LINES.get(skin(), {}).get(key)
    if v is None:
        return default
    v = random.choice(v) if isinstance(v, list) else v
    return v.format(**kw)


def adapt(text):
    """Make a J.A.R.V.I.S. reply fit the current skin (only J.A.R.V.I.S. calls anyone 'sir')."""
    if skin() in LINES and text:
        text = re.sub(r",? \bsir\b(?=[.?!,])", "", text)
    return text


# spoken in the new skin's voice when the skin changes (bridge.rpc_set_config)
INTROS = {
    "jarvis": "J.A.R.V.I.S. theme restored, sir.",
    "doom": "DOOM has seized control of this machine.",
}


def intro(name):
    v = LINES.get(name, {}).get("intro") or INTROS.get(name)
    return random.choice(v) if isinstance(v, list) else v
