#!/usr/bin/env bash
# Glosse: build and (re)install the extension in Chrome on macOS.
#
# Usage, from a clone:        ./scripts/install-macos.sh
# Or without a clone yet:     curl -fsSL https://raw.githubusercontent.com/maparham/glosse/phase-1-gloss-overlay/scripts/install-macos.sh | bash
#
# What it does: installs Node via Homebrew if missing, clones or updates the
# repo, builds the extension, opens chrome://extensions and reveals the dist
# folder. Chrome has no supported way to load an unpacked extension from a
# script, so the last step (Load unpacked, or the reload button on later
# runs) stays a click.
set -euo pipefail

REPO_URL="https://github.com/maparham/glosse"
BRANCH="${GLOSSE_BRANCH:-phase-1-gloss-overlay}"
CLONE_DIR="${GLOSSE_DIR:-$HOME/glosse}"

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

[[ "$(uname -s)" == "Darwin" ]] || die "This script is for macOS."

# 1. Node
if ! command -v node >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    say "Node not found, installing with Homebrew"
    brew install node
  else
    die "Node.js is not installed. Install Homebrew (https://brew.sh) or Node (https://nodejs.org), then rerun."
  fi
fi
NODE_MAJOR="$(node -v | sed 's/^v//' | cut -d. -f1)"
[[ "$NODE_MAJOR" -ge 20 ]] || die "Node 20 or newer is required, found $(node -v)."

# 2. Source: use the repo this script lives in, otherwise clone or update.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
if [[ -n "$SCRIPT_DIR" && -f "$SCRIPT_DIR/../package.json" ]]; then
  PROJECT="$(cd "$SCRIPT_DIR/.." && pwd)"
  say "Using repo at $PROJECT"
elif [[ -d "$CLONE_DIR/.git" ]]; then
  PROJECT="$CLONE_DIR"
  say "Updating $PROJECT"
  git -C "$PROJECT" fetch -q origin "$BRANCH"
  git -C "$PROJECT" checkout -q "$BRANCH"
  git -C "$PROJECT" pull -q --ff-only origin "$BRANCH"
else
  say "Cloning into $CLONE_DIR"
  git clone -q --branch "$BRANCH" "$REPO_URL" "$CLONE_DIR"
  PROJECT="$CLONE_DIR"
fi
cd "$PROJECT"

# 3. Build
say "Installing dependencies"
npm install --no-fund --no-audit --silent
say "Building"
npm run build --silent
DIST="$PROJECT/dist"
[[ -f "$DIST/manifest.json" ]] || die "Build did not produce dist/manifest.json."

# 4. Hand over to Chrome
printf '%s' "$DIST" | pbcopy
if [[ -d "/Applications/Google Chrome.app" ]]; then
  open -a "Google Chrome" "chrome://extensions/"
fi
open -R "$DIST"

cat <<MSG

Built: $DIST   (path copied to the clipboard)

First install:
  1. In the chrome://extensions tab, turn on "Developer mode" (top right).
  2. Click "Load unpacked" and choose the dist folder (press Cmd+Shift+G in the dialog and paste).
  3. The options page opens: paste your Claude API key and save.

Already installed:
  Click the reload icon on the Glosse card in chrome://extensions. Settings are kept.

Then open a YouTube video with a German subtitle track turned on.
MSG
