#!/bin/sh

set -eu

echo "BIOFEEDBACK iOS doctor"
echo "======================"

check_ok() {
  echo "[ok] $1"
}

check_warn() {
  echo "[warn] $1"
}

if [ -d "/Applications/Xcode.app" ]; then
  check_ok "Xcode.app found"
else
  check_warn "Xcode.app missing in /Applications"
fi

developer_path="$(xcode-select -p 2>/dev/null || true)"
if [ -n "$developer_path" ]; then
  echo "[info] xcode-select -> $developer_path"
else
  check_warn "xcode-select path missing"
fi

if xcodebuild -version >/dev/null 2>&1; then
  echo "[info] $(xcodebuild -version | tr '\n' ' ' | sed 's/  */ /g')"
else
  check_warn "xcodebuild unavailable. Usually this means full Xcode is not selected yet."
fi

if command -v brew >/dev/null 2>&1; then
  echo "[info] Homebrew $(brew --version | awk 'NR==1 { print $2 }')"
else
  check_warn "Homebrew missing"
fi

if command -v pod >/dev/null 2>&1; then
  echo "[info] CocoaPods $(pod --version)"
else
  check_warn "CocoaPods missing"
fi

if [ -x "./node_modules/.bin/eas" ]; then
  echo "[info] EAS CLI $(./node_modules/.bin/eas --version)"
else
  check_warn "Local EAS CLI missing. Run npm install."
fi

if [ -f "./eas.json" ]; then
  check_ok "eas.json found"
else
  check_warn "eas.json missing"
fi

if [ -f "./app.json" ]; then
  check_ok "app.json found"
else
  check_warn "app.json missing"
fi
