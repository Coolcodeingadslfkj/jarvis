"""Offline voice: Piper neural TTS (the J.A.R.V.I.S., Celestia Ludenberg and Aoi Asahina voices trained in
training/, Aoi on a stock US voice until hers is installed, falling back to the stock British "Alan" voice) + Vosk
speech recognition.

Everything runs locally. Audio goes through PipeWire (pw-play / pw-record).
"""

import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
import wave

from PySide6.QtCore import QObject, Signal

APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS = os.path.join(APP_DIR, "models")
JARVIS_MODEL = os.path.join(MODELS, "en_GB-jarvis-medium.onnx")  # fine-tuned on the films (training/)
ALAN_MODEL = os.path.join(MODELS, "en_GB-alan-medium.onnx")
CELESTIA_MODEL = os.path.join(MODELS, "en_US-celestia-medium.onnx")  # trained on her English dub (training/)
PIPER_MODEL = JARVIS_MODEL if os.path.exists(JARVIS_MODEL) and os.path.exists(JARVIS_MODEL + ".json") else ALAN_MODEL
ASAHINA_MODEL = os.path.join(MODELS, "en_US-asahina-medium.onnx")  # trained on her English dub (training/)
HFC_MODEL = os.path.join(MODELS, "en_US-hfc_female-medium.onnx")  # stock Piper voice; bright and young
if not (os.path.exists(ASAHINA_MODEL) and os.path.exists(ASAHINA_MODEL + ".json")):
    ASAHINA_MODEL = HFC_MODEL
DOOM_MODEL = os.path.join(MODELS, "en_US-doom-medium.onnx")  # trained on the 1981 cartoon Doctor Doom (training/)
SKIN_MODELS = {"celestia": CELESTIA_MODEL, "asahina": ASAHINA_MODEL, "doom": DOOM_MODEL}
# the stock voice talks a little faster for Hina; her trained voice already has her own pace
SKIN_RATE = {"asahina": 1.08} if ASAHINA_MODEL == HFC_MODEL else {}


def model_for(skin):
    """The voice of a skin (web/js/skins.js): its own trained model if installed, else J.A.R.V.I.S."""
    m = SKIN_MODELS.get(skin)
    return m if m and os.path.exists(m) and os.path.exists(m + ".json") else PIPER_MODEL
VOSK_MODEL = os.path.join(MODELS, "vosk-model-small-en-us-0.15")
RATE = 16000
CHUNK = 3200  # 0.1 s of 16-bit mono
PAUSE = 0.45  # seconds of silence spoken for "..." (Piper itself runs sentences together with no gap)
SHORT_PAUSE = 0.1  # for "—" (a comma barely pauses at all): "ACCEPTABLE— CONTINUE."
# a short silence after every sentence, per skin: DOOM speaks in slow, deliberate pronouncements
SENTENCE_GAP = {"doom": 0.3}


# Words espeak (Piper's phonemizer) gets wrong, respelled into ordinary English sounds. It reads "Sakura"
# as "sack-YOOR-ruh" (a sound run the voices never practised, so it comes out garbled), "Bwah" as
# "bee-wah" and spells out "Mmm" as "em em em". Only what is spoken changes; the text on screen keeps the
# real spelling. Checked with UTMOS / Whisper against the Aoi voice (epoch 29). Don't respell "Aoi" or
# "Asahina": espeak gets them wrong too, but her voice learned them from her training lines, and a
# respelling makes them worse.
SAY_AS = [
    (r"\bSakura\b", "Sahkoora"),       # SAH-kor-uh
    (r"\bBwah+\b", "Boowah"),
    (r"\bMm+\b", "Yum"),
    (r"\bAww+\b", "Aw"),
]


def _clean_for_speech(text):
    t = re.sub(r"\s+", " ", text)
    for pat, say in SAY_AS:
        t = re.sub(pat, say, t, flags=re.I)
    t = t.replace("J.A.R.V.I.S.", "Jarvis").replace("°C", " degrees").replace("%", " percent")
    t = re.sub(r"(\d+(?:\.\d+)?) ?GB", r"\1 gigabytes", t)
    t = re.sub(r"(\d+(?:\.\d+)?) ?MB", r"\1 megabytes", t)
    t = re.sub(r"(\d+(?:\.\d+)?) ?MHz", r"\1 megahertz", t)
    t = re.sub(r"(\d+(?:\.\d+)?) ?W\b", r"\1 watts", t)
    t = re.sub(r"[/◆·•|]", ", ", t)
    return t.strip()


def _synthesize(piper, text, w, syn, gap=0.0):
    """Piper to a wav, with a PAUSE of silence wherever the text has "..." ("A NEW RECORD... DOOM WILL ..."),
    a SHORT_PAUSE for "—", and `gap` seconds between the other sentences."""
    bits = re.split(r"\s*(\.\.\.|…|—)\s*", text)
    parts, pauses = bits[0::2], [""] + bits[1::2]
    w.setframerate(piper.config.sample_rate); w.setsampwidth(2); w.setnchannels(1)
    first = True
    for part, mark in zip(parts, pauses):
        if not re.search(r"\w", part):
            continue
        if not first:  # "..." stays longer than a sentence gap; "—" is a quick beat
            w.writeframes(bytes(2 * int(piper.config.sample_rate * (SHORT_PAUSE if mark == "—" else PAUSE + gap))))
        first = False
        for j, chunk in enumerate(piper.synthesize(part, syn_config=syn)):
            if j and gap:
                w.writeframes(bytes(2 * int(piper.config.sample_rate * gap)))
            w.writeframes(chunk.audio_int16_bytes)


class Voice(QObject):
    state = Signal(str)        # idle | listening | thinking | speaking
    partial = Signal(str)      # live transcription
    heard = Signal(str)        # final transcription of a command
    level = Signal(float)      # mic level 0..1 (for the UI orb)
    wake = Signal()            # wake word detected

    def __init__(self, parent=None):
        super().__init__(parent)
        self._piper = {}           # model path -> loaded PiperVoice
        self._vosk_model = None
        self._play = None
        self._speak_lock = threading.Lock()
        self._listen_stop = threading.Event()
        self._listening = False
        self._wake_thread = None
        self._wake_stop = threading.Event()
        self._busy_until = 0

    # ---------------------------------------------------------------- capability
    @staticmethod
    def tts_available():
        return os.path.exists(PIPER_MODEL) and shutil.which("pw-play") is not None and _can_import("piper")

    @staticmethod
    def stt_available():
        return os.path.isdir(VOSK_MODEL) and shutil.which("pw-record") is not None and _can_import("vosk")

    # ---------------------------------------------------------------- speech out
    def speak(self, text, rate=1.0):
        text = _clean_for_speech(text)
        if os.environ.get("JARVIS_MUTE"):
            print("[voice] (muted) would say:", text[:120], flush=True)
            return False
        if not text or not self.tts_available():
            return False
        threading.Thread(target=self._speak, args=(text, rate), daemon=True).start()
        return True

    def _speak(self, text, rate):
        with self._speak_lock:
            try:
                from piper import PiperVoice, SynthesisConfig
                from . import config
                skin = config.get("skin", "jarvis")
                model = model_for(skin)
                rate *= SKIN_RATE.get(skin, 1.0)
                if model not in self._piper:
                    self._piper[model] = PiperVoice.load(model)
                piper = self._piper[model]
                fd, path = tempfile.mkstemp(prefix="jarvis-tts-", suffix=".wav")
                os.close(fd)
                syn = SynthesisConfig(length_scale=1.0 / max(0.5, rate))
                with wave.open(path, "wb") as w:
                    _synthesize(piper, text, w, syn, SENTENCE_GAP.get(skin, 0.0))
                self.stop_speaking()
                self.state.emit("speaking")
                with wave.open(path) as w:
                    dur = w.getnframes() / float(w.getframerate())
                self._busy_until = time.monotonic() + dur + 0.6  # keep the wake word from hearing ourselves
                self._play = subprocess.Popen(["pw-play", path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                self._play.wait()
                os.unlink(path)
            except Exception as e:
                print("[voice] tts error:", e, flush=True)
            finally:
                self._play = None
                if not self._listening:
                    self.state.emit("idle")

    def stop_speaking(self):
        p = self._play
        if p and p.poll() is None:
            p.terminate()

    # ---------------------------------------------------------------- speech in
    def _model(self):
        if self._vosk_model is None:
            import vosk
            vosk.SetLogLevel(-1)
            self._vosk_model = vosk.Model(VOSK_MODEL)
        return self._vosk_model

    def listen(self, max_seconds=8.0):
        """Push-to-talk: record until the speaker pauses, then emit heard(text)."""
        if self._listening or not self.stt_available():
            return False
        self._listening = True
        self._listen_stop.clear()
        threading.Thread(target=self._listen, args=(max_seconds,), daemon=True).start()
        return True

    def stop_listening(self):
        self._listen_stop.set()

    def _mic(self):
        return subprocess.Popen(["pw-record", "--rate", str(RATE), "--channels", "1", "--format", "s16", "-"],
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)

    def _listen(self, max_seconds):
        import vosk
        self.stop_speaking()
        self.state.emit("listening")
        text = ""
        mic = None
        try:
            rec = vosk.KaldiRecognizer(self._model(), RATE)
            mic = self._mic()
            start = time.monotonic()
            last_voice = None
            while not self._listen_stop.is_set():
                b = mic.stdout.read(CHUNK)
                if not b:
                    break
                self.level.emit(_rms(b))
                if rec.AcceptWaveform(b):
                    text = json.loads(rec.Result()).get("text", "")
                    if text:
                        break
                else:
                    p = json.loads(rec.PartialResult()).get("partial", "")
                    if p:
                        last_voice = time.monotonic()
                        self.partial.emit(p)
                now = time.monotonic()
                if last_voice and now - last_voice > 1.4:
                    break
                if now - start > max_seconds or (not last_voice and now - start > 5):
                    break
            if not text:
                text = json.loads(rec.FinalResult()).get("text", "")
        except Exception as e:
            print("[voice] stt error:", e, flush=True)
        finally:
            if mic:
                mic.terminate()
            self._listening = False
            self.level.emit(0.0)
            self.state.emit("thinking" if text else "idle")
            self.heard.emit(text.strip())

    # ---------------------------------------------------------------- wake word
    def set_wake_word(self, enabled):
        if enabled and self.stt_available() and not (self._wake_thread and self._wake_thread.is_alive()):
            self._wake_stop.clear()
            self._wake_thread = threading.Thread(target=self._wake_loop, daemon=True)
            self._wake_thread.start()
        elif not enabled:
            self._wake_stop.set()

    def _wake_loop(self):
        import vosk
        mic = None
        try:
            # A tiny grammar keeps this cheap and avoids false triggers.
            rec = vosk.KaldiRecognizer(self._model(), RATE, json.dumps(["jarvis", "hey jarvis", "okay jarvis", "[unk]"]))
            mic = self._mic()
            while not self._wake_stop.is_set():
                if self._listening:
                    # push-to-talk owns the mic for now
                    mic.terminate(); mic = None
                    while self._listening and not self._wake_stop.is_set():
                        time.sleep(0.2)
                    mic = self._mic()
                    rec.Reset()
                    continue
                b = mic.stdout.read(CHUNK)
                if not b:
                    break
                if time.monotonic() < self._busy_until:
                    continue
                if rec.AcceptWaveform(b):
                    if "jarvis" in json.loads(rec.Result()).get("text", ""):
                        rec.Reset()
                        self.wake.emit()
                        time.sleep(0.3)
        except Exception as e:
            print("[voice] wake word error:", e, flush=True)
        finally:
            if mic:
                mic.terminate()

    def shutdown(self):
        self._wake_stop.set()
        self._listen_stop.set()
        self.stop_speaking()


def _rms(b):
    import array
    a = array.array("h", b)
    if not a:
        return 0.0
    s = sum(x * x for x in a[::4]) / max(1, len(a) // 4)
    return min(1.0, (s ** 0.5) / 6000.0)


def _can_import(mod):
    import importlib.util
    return importlib.util.find_spec(mod) is not None
