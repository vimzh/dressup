#!/bin/bash

set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This installer currently supports macOS only."
  exit 1
fi

if [[ ! -d "/Applications/Google Chrome.app" ]]; then
  echo "Google Chrome was not found in /Applications. Install Chrome first, then rerun this installer."
  exit 1
fi

install_root="$HOME/Library/Application Support/Zdress"
install_dir="$install_root/extension"
archive_url="https://raw.githubusercontent.com/vimzh/dressup/main/apps/web/public/downloads/zdress-chrome.zip"
temp_dir="$(mktemp -d)"
trap 'rm -rf -- "$temp_dir"' EXIT

echo "Downloading Zdress…"
curl -fL "$archive_url" -o "$temp_dir/zdress-chrome.zip"

mkdir -p "$install_dir"
unzip -oq "$temp_dir/zdress-chrome.zip" -d "$install_dir"

if [[ ! -f "$install_dir/manifest.json" ]]; then
  echo "The downloaded extension is incomplete. Please try again."
  exit 1
fi

printf '%s' "$install_dir" | pbcopy
open -R "$install_dir/manifest.json"
open -a "Google Chrome" "chrome://extensions/"

echo
echo "Zdress is downloaded and unpacked. The folder path is on your clipboard."
echo "Chrome requires one final approval:"
echo "  1. Turn on Developer mode."
echo "  2. Click Load unpacked."
echo "  3. Press Command-Shift-G, paste the copied path, and choose Select."
echo
read -r -p "Press Return to close this window."
