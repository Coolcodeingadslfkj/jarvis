#!/usr/bin/env bash
# J.A.R.V.I.S. installer. Works on Kubuntu / Ubuntu / Debian, Arch, Fedora and openSUSE (KDE Plasma recommended).
#   ./install.sh                   install / update (asks about starting at login)
#   ./install.sh --autostart       ... and start J.A.R.V.I.S. at login
#   ./install.sh --no-autostart    ... and don't
#   ./install.sh --uninstall       remove the app-menu entries, autostart and the Python environment
# Everything installs into this folder and your home directory; sudo is only used (after asking) to add
# missing system packages.
set -euo pipefail

DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
ICONS="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor/scalable/apps"
AUTOSTART="${XDG_CONFIG_HOME:-$HOME/.config}/autostart/jarvis.desktop"
VOSK=vosk-model-small-en-us-0.15
say() { printf '\033[1;36m[J.A.R.V.I.S.]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[J.A.R.V.I.S.]\033[0m %s\n' "$*"; }
ask() {  # ask "question" default(y|n)
  local a
  [[ -t 0 ]] || return 1  # no one to answer: don't use sudo, don't enable autostart
  read -r -p "$(printf '\033[1;36m[J.A.R.V.I.S.]\033[0m %s ' "$1")" a || true
  a="${a:-$2}"
  [[ "${a,,}" == y* ]]
}

if [[ "${1:-}" == "--uninstall" ]]; then
  rm -f "$APPS/jarvis.desktop" "$APPS/jarvis-listen.desktop" "$ICONS/jarvis.svg" "$AUTOSTART"
  rm -rf "$DIR/.venv" "$DIR/.vulkan" "$DIR/models/$VOSK"
  say "Removed the app-menu entries, autostart and Python environment."
  say "Delete this folder to remove the app itself. Settings and scores are in ~/.config/jarvis and ~/.local/share/jarvis."
  exit 0
fi

# ---------------------------------------------------------------- system packages
# What the app needs from the system: Python 3.10+ with venv, PipeWire's pw-play/pw-record (speech),
# libxcb-cursor (Qt on X11) and curl/unzip for the downloads below.
PM=""
for p in apt-get pacman dnf zypper; do command -v "$p" >/dev/null && { PM=$p; break; }; done
missing=()
need() { missing+=("$1"); }
has_xcb_cursor() { ldconfig -p 2>/dev/null | grep 'libxcb-cursor\.so\.0' >/dev/null || ls /usr/lib*/libxcb-cursor.so.0 /usr/lib/*/libxcb-cursor.so.0 >/dev/null 2>&1; }  # not grep -q: pipefail + SIGPIPE
py_ok() { command -v python3 >/dev/null && python3 -c 'import sys; sys.exit(sys.version_info < (3, 10))' 2>/dev/null; }
case "$PM" in
  apt-get)
    py_ok || need python3
    python3 -c 'import ensurepip, venv' 2>/dev/null || need python3-venv
    command -v pw-play >/dev/null || need pipewire-bin
    has_xcb_cursor || need libxcb-cursor0
    command -v curl >/dev/null || need curl
    command -v unzip >/dev/null || need unzip
    install_cmd=(sudo apt-get install -y) ;;
  pacman)
    py_ok || need python
    command -v pw-play >/dev/null || need pipewire
    has_xcb_cursor || need xcb-util-cursor
    command -v curl >/dev/null || need curl
    command -v unzip >/dev/null || need unzip
    install_cmd=(sudo pacman -S --needed --noconfirm) ;;
  dnf)
    py_ok || need python3
    command -v pw-play >/dev/null || need pipewire-utils
    has_xcb_cursor || need xcb-util-cursor
    command -v curl >/dev/null || need curl
    command -v unzip >/dev/null || need unzip
    install_cmd=(sudo dnf install -y) ;;
  zypper)
    py_ok || need python3
    command -v pw-play >/dev/null || need pipewire-tools
    has_xcb_cursor || need libxcb-cursor0
    command -v curl >/dev/null || need curl
    command -v unzip >/dev/null || need unzip
    install_cmd=(sudo zypper install -y) ;;
esac
if (( ${#missing[@]} )); then
  warn "Missing system packages: ${missing[*]}"
  if ask "Install them now with sudo (${install_cmd[*]} ${missing[*]})? [Y/n]" y; then
    [[ "$PM" == apt-get ]] && sudo apt-get update
    "${install_cmd[@]}" "${missing[@]}" || warn "Package install failed; continuing anyway."
  else
    warn "Continuing without them; some features may not work."
  fi
fi
py_ok || { warn "Python 3.10 or newer is required."; exit 1; }
command -v pw-play >/dev/null || warn "pw-play not found (PipeWire): J.A.R.V.I.S. will stay silent."

# ---------------------------------------------------------------- python env
if [[ ! -x "$DIR/.venv/bin/python" ]]; then
  say "Creating the Python environment in $DIR/.venv ..."
  python3 -m venv "$DIR/.venv"
fi
say "Installing Python packages (PySide6 / Qt WebEngine, Piper voices, Vosk). The first time this downloads ~400 MB..."
"$DIR/.venv/bin/python" -m pip install --quiet --upgrade pip
"$DIR/.venv/bin/python" -m pip install --progress-bar on -r "$DIR/requirements.txt"

# ---------------------------------------------------------------- fonts + terminal (bundled; fetched only if missing)
fetch() {  # url dest
  [[ -s "$2" ]] || curl -fsSL "$1" -o "$2" || warn "Could not download $(basename "$2")"
}
mkdir -p "$DIR/web/fonts" "$DIR/web/vendor/xterm"
G=https://github.com/google/fonts/raw/main/ofl
fetch "$G/orbitron/Orbitron%5Bwght%5D.ttf" "$DIR/web/fonts/Orbitron.ttf"
fetch "$G/rajdhani/Rajdhani-Medium.ttf" "$DIR/web/fonts/Rajdhani-Medium.ttf"
fetch "$G/rajdhani/Rajdhani-SemiBold.ttf" "$DIR/web/fonts/Rajdhani-SemiBold.ttf"
fetch "$G/sharetechmono/ShareTechMono-Regular.ttf" "$DIR/web/fonts/ShareTechMono.ttf"
fetch "$G/jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf" "$DIR/web/fonts/JetBrainsMono.ttf"
for u in "@xterm/xterm@5.5.0/lib/xterm.js" "@xterm/xterm@5.5.0/css/xterm.css" "@xterm/addon-fit@0.10.0/lib/addon-fit.js" \
         "@xterm/addon-web-links@0.11.0/lib/addon-web-links.js" "@xterm/addon-search@0.15.0/lib/addon-search.js"; do
  fetch "https://cdn.jsdelivr.net/npm/$u" "$DIR/web/vendor/xterm/$(basename "$u")"
done

# ---------------------------------------------------------------- speech recognition model (offline)
M="$DIR/models"
mkdir -p "$M"
ls "$M"/en_*-jarvis-medium.onnx >/dev/null 2>&1 || warn "The voice models are missing from models/ - J.A.R.V.I.S. will be silent."
if [[ ! -d "$M/$VOSK" ]]; then
  say "Downloading the speech recognition model (Vosk small English, ~40 MB)..."
  if curl -fL --progress-bar "https://alphacephei.com/vosk/models/$VOSK.zip" -o "$M/vosk.zip"; then
    "$DIR/.venv/bin/python" -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" "$M/vosk.zip" "$M"
    rm -f "$M/vosk.zip"
  else
    rm -f "$M/vosk.zip"
    warn "Speech model download failed - voice commands are disabled (typed commands still work). Re-run ./install.sh to retry."
  fi
fi

# ---------------------------------------------------------------- Arch only: Intel Vulkan driver for hybrid NVIDIA laptops
# QtWebEngine composites through Vulkan. On an Intel + NVIDIA laptop with only NVIDIA's Vulkan driver installed the page
# goes blank, so the app pins Vulkan to Intel's driver. Ubuntu/Fedora ship it by default (mesa-vulkan-drivers); on Arch,
# without root, we fetch the signed vulkan-intel package matching the installed mesa into .vulkan/.
setup_vulkan() {
  ls /usr/share/vulkan/icd.d/intel_icd*.json >/dev/null 2>&1 && { rm -rf "$DIR/.vulkan"; return; }
  command -v pacman >/dev/null || return 0
  lspci 2>/dev/null | grep -qi 'VGA.*Intel' || return 0
  lspci 2>/dev/null | grep -qi 'NVIDIA' || return 0
  local ver mirror tmp
  ver=$(pacman -Q mesa 2>/dev/null | awk '{print $2}') || return 0
  [[ -f "$DIR/.vulkan/version" && "$(cat "$DIR/.vulkan/version")" == "$ver" ]] && return 0
  mirror=$(grep -m1 '^Server' /etc/pacman.d/mirrorlist | sed 's/^Server *= *//; s/\$repo/extra/; s/\$arch/x86_64/')
  [[ -n "$mirror" ]] || return 0
  say "Fetching the Intel Vulkan driver for mesa $ver (GPU-accelerated rendering)..."
  tmp=$(mktemp -d)
  local pkg="vulkan-intel-${ver/:/%3A}-x86_64.pkg.tar.zst"
  if curl -fsSL "$mirror/$pkg" -o "$tmp/pkg.tar.zst" && curl -fsSL "$mirror/$pkg.sig" -o "$tmp/pkg.sig" \
     && pacman-key --verify "$tmp/pkg.sig" "$tmp/pkg.tar.zst" >/dev/null 2>&1; then
    mkdir -p "$tmp/x" "$DIR/.vulkan"
    tar -C "$tmp/x" -xf "$tmp/pkg.tar.zst" usr/lib/libvulkan_intel.so
    install -m 755 "$tmp/x/usr/lib/libvulkan_intel.so" "$DIR/.vulkan/libvulkan_intel.so"
    cat > "$DIR/.vulkan/intel_icd.json" <<EOF
{
    "ICD": {
        "api_version": "1.4.0",
        "library_path": "$DIR/.vulkan/libvulkan_intel.so"
    },
    "file_format_version": "1.0.1"
}
EOF
    echo "$ver" > "$DIR/.vulkan/version"
  else
    warn "Could not fetch vulkan-intel; using CPU compositing. For best performance: sudo pacman -S vulkan-intel"
  fi
  rm -rf "$tmp"
}
setup_vulkan

# ---------------------------------------------------------------- launcher + icon
chmod +x "$DIR/run.sh" "$DIR/install.sh"
mkdir -p "$APPS" "$ICONS"
install -m 644 "$DIR/assets/jarvis.svg" "$ICONS/jarvis.svg"
cat > "$APPS/jarvis.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=J.A.R.V.I.S.
GenericName=System HUD
Comment=Just A Rather Very Intelligent System - performance monitor, files and power control
Exec="$DIR/run.sh"
Icon=jarvis
Terminal=false
Categories=System;Monitor;
Keywords=jarvis;monitor;hud;system;temperature;gpu;cpu;
StartupWMClass=jarvis
Actions=windowed;safe;

[Desktop Action windowed]
Name=Start in a window
Exec="$DIR/run.sh" --windowed

[Desktop Action safe]
Name=Start in safe graphics mode (if the screen stays blank)
Exec="$DIR/run.sh" --software
EOF
cat > "$APPS/jarvis-listen.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Talk to J.A.R.V.I.S.
Comment=Start a voice command
Exec="$DIR/run.sh" --listen
Icon=jarvis
Terminal=false
NoDisplay=true
Categories=System;
EOF
command -v update-desktop-database >/dev/null && update-desktop-database "$APPS" >/dev/null 2>&1 || true
for k in kbuildsycoca6 kbuildsycoca5; do command -v $k >/dev/null && { $k >/dev/null 2>&1 || true; break; }; done
say "App-menu launcher installed (search for \"J.A.R.V.I.S.\")."

# ---------------------------------------------------------------- autostart
case "${1:-}" in
  --autostart) start=y ;;
  --no-autostart) start=n ;;
  *) if [[ -f "$AUTOSTART" ]] || ask "Start J.A.R.V.I.S. automatically when you log in? [y/N]" n; then start=y; else start=n; fi ;;
esac
if [[ "$start" == y ]]; then
  (cd "$DIR" && "$DIR/.venv/bin/python" -m jarvis.config autostart-on)
  say "Autostart enabled (turn it off any time in SETTINGS)."
else
  (cd "$DIR" && "$DIR/.venv/bin/python" -m jarvis.config autostart-off)
fi

say "Done. Launch it from the app menu or with: $DIR/run.sh"
say "It opens on your laptop's own screen (or your main monitor). Pick another screen in SETTINGS > Display."
