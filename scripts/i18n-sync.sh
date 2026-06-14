#!/usr/bin/env bash
# i18n translation sync — pre-push wrapper around scripts/i18n-sync.mjs.
# Same philosophy as docs-sync: never blocks the push, auto-fixes when it can.
#
# Trigger: the push range touches the i18n catalog source (ru.json).
# Action:  fill missing/stale keys for every target locale, then commit the
#          updated catalogs. If no translate API is configured, it only logs the
#          plan (push still proceeds).
#
# Contract: env PUSH_RANGE = "<base>..HEAD". Always exits 0.

set -uo pipefail

if [ "${HARMONIZER_SKIP_I18N_SYNC:-0}" = "1" ]; then
  echo "[i18n-sync] Skipped (HARMONIZER_SKIP_I18N_SYNC=1)"
  exit 0
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT" || exit 0

if [ -z "${PUSH_RANGE:-}" ]; then
  echo "[i18n-sync] PUSH_RANGE not set. Skipping."
  exit 0
fi

SOURCE="modules/i18n/catalog/ru.json"
TYPED_MANIFEST="modules/i18n/typed/manifest.json"
TYPED_SOURCE="modules/chakra/i18n/chakraTypedSource.json"
CHANGED="$(git diff --name-only "$PUSH_RANGE" -- "$SOURCE" "$TYPED_MANIFEST" "$TYPED_SOURCE" modules/profile/i18n/ modules/home/i18n/ modules/day/i18n/ modules/practices/i18n/ modules/communicator/i18n/ modules/breath/i18n/ modules/mandala/i18n/ modules/ui/i18n/ || true)"
if [ -z "$CHANGED" ]; then
  echo "[i18n-sync] No i18n source changes in push. Skipping."
  exit 0
fi

echo "[i18n-sync] i18n sources changed — syncing target locales..."
node "$REPO_ROOT/scripts/i18n-sync.mjs" fill --all || {
  echo "[i18n-sync] fill reported an error, push continues."
}

CATALOG_CHANGED="$(git diff --name-only -- modules/i18n/catalog/ modules/i18n/typed/ || true)"
if [ -z "$CATALOG_CHANGED" ]; then
  echo "[i18n-sync] No catalog files changed. Done."
  exit 0
fi

git add modules/i18n/catalog/ modules/i18n/typed/ modules/i18n/typed/generated-overlays.ts
HEAD_SHORT="$(git rev-parse --short HEAD)"
git commit -m "i18n: auto-sync locale catalogs after $HEAD_SHORT

Files: $(echo "$CATALOG_CHANGED" | tr '\n' ' ')

[skip-doc-sync]" || echo "[i18n-sync] Nothing to commit."

echo "[i18n-sync] Done."
exit 0
