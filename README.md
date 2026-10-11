# J.A.R.V.I.S.

*Just A Rather Very Intelligent System*: an Iron Man-style holographic HUD for Linux. It shows live stats
for your computer (CPU, GPU, memory, temperatures, fans, disks, network, battery), talks to you in a trained
J.A.R.V.I.S. voice, takes voice or typed commands, and controls the machine: files, a terminal, apps, volume,
brightness, Wi-Fi, Bluetooth, media and power. Pick the **J.A.R.V.I.S.**, **Celestia Ludenberg**, **Aoi Asahina**
or **D.O.O.M.** theme from the top bar; each one has its own voice, lines and mini game.

Works best on **KDE Plasma** (Kubuntu, Fedora KDE, Arch + Plasma, openSUSE). Other desktops run it too, without the
KDE-only extras (global shortcuts, brightness and night light).

## Install

1. Download `jarvis-<version>.zip` from the **Releases** page and unzip it wherever you want the app to live
   (e.g. your home folder). Keep the folder: the app runs from it.
2. Open a terminal in the unzipped folder and run:

   ```bash
   bash install.sh
   ```

   The installer:
   - offers to install the few system packages it needs (on Kubuntu: `python3-venv`, `pipewire-bin`,
     `libxcb-cursor0`), asking before it uses `sudo`;
   - downloads the Python libraries (~400 MB, the first time only) and the offline speech recognition model
     (~40 MB) into the app folder;
   - adds **J.A.R.V.I.S.** to your app menu;
   - asks whether to start it when you log in (default: no).
3. Start **J.A.R.V.I.S.** from the app menu, or with `./run.sh`.

To update, unzip the new version over the old folder and run `bash install.sh` again.
To uninstall, run `bash install.sh --uninstall`, then delete the folder.

## Screens

J.A.R.V.I.S. opens full screen on your **laptop's own screen**, or your **main monitor** on a desktop. It never
moves to a second monitor by itself. To use another screen, open **Settings (⚙) → Display** and pick it from
the list of connected screens. You can also start it once on a screen with `./run.sh --screen HDMI-A-1`.
F11 toggles full screen; `./run.sh --windowed` starts in a window.

## Talking to it

- **Meta+J** (KDE), **Ctrl+Space** or the 🎤 button: speak a command, then pause.
- **Wake word**: turn on *Wake word "Jarvis"* in Settings, then say "Jarvis…" any time (off by default).
- Speech recognition and the voices run **offline** on your computer.

Things to say or type:

```
status · temps · gpu · battery · weather · forecast · will it rain
volume 40 · mute · brightness 60 · night light on · wifi off · bluetooth on
play · pause · next · what's playing · open downloads · launch firefox · find report.pdf
check updates · update system · run htop · screenshot · lock · sleep · restart
celestia theme · hina theme · doom theme · jarvis theme · play a game · tell me a joke
```

## Privacy

Everything stays on your computer except:

- **Weather:** your approximate location comes from your own internet connection (`ipinfo.io`), and the
  forecast from Open-Meteo. To skip the location lookup, type a city in **Settings → Weather location**.
- **Lyrics** (MUSIC menu): the song's title and artist are looked up on LRCLIB.

Settings are saved in `~/.config/jarvis/`; game scores and other app data in `~/.local/share/jarvis/`.

## If something doesn't work

- **The window is blank or black:** start it with *Start in safe graphics mode* (right-click the app-menu entry),
  or `./run.sh --software`, then turn on **Settings → Safe graphics** to keep it that way.
- **No voice:** check that `pw-play` exists (`sudo apt install pipewire-bin`) and that voice is on in Settings.
- **Voice commands don't work:** re-run `bash install.sh` to fetch the speech model, and check that your
  microphone works in System Settings.
- **Some sensors are missing:** `sudo apt install lm-sensors && sudo sensors-detect` can unlock more of them.
- Optional extras: `cava` (music visualizer), `spectacle` (screenshots), Spotify (MUSIC menu).
- Run `./run.sh` from a terminal to see error messages.

## Shortcuts

| Key | |
|---|---|
| Ctrl+1 … Ctrl+0 | HOME, SYSTEMS, FILES, TERMINAL, APPS, TASKS, CONTROL, PROTOCOLS, POWER, console |
| Meta+J / Meta+Shift+J | talk / show or hide (KDE; rebind in System Settings → Shortcuts) |
| Ctrl+T | light / dark mode |
| F11 | full screen |
| Ctrl+Q | quit (closing the window only hides it to the tray) |
