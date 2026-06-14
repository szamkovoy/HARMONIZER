#!/usr/bin/env bash
# Установка pre-push hook для авто-синхронизации docs.
# Запустить один раз: bash scripts/docs-sync/install.sh

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOK_PATH="$REPO_ROOT/.git/hooks/pre-push"

if [ -f "$HOOK_PATH" ]; then
  BACKUP="$HOOK_PATH.backup-$(date +%s)"
  echo "Existing pre-push hook found. Backing up to $BACKUP"
  cp "$HOOK_PATH" "$BACKUP"
fi

cat > "$HOOK_PATH" <<'HOOK_EOF'
#!/usr/bin/env bash
# pre-push hook: вызывает docs-sync.
# Push НЕ блокируется при сбое sync — только логируется.

REPO_ROOT="$(git rev-parse --show-toplevel)"

# Читаем stdin pre-push hook: <local ref> <local sha> <remote ref> <remote sha>
# Берём первую строку (если ничего не пушится — git не вызывал бы hook)
read -r LOCAL_REF LOCAL_SHA REMOTE_REF REMOTE_SHA

# Если remote sha — нули, это первый push ветки. Берём origin/main как базу.
if [ "$REMOTE_SHA" = "0000000000000000000000000000000000000000" ]; then
  BASE="$(git merge-base "$LOCAL_SHA" origin/main 2>/dev/null || echo "")"
  if [ -z "$BASE" ]; then
    BASE="$(git rev-list --max-parents=0 "$LOCAL_SHA" | head -1)"
  fi
  PUSH_RANGE="$BASE..$LOCAL_SHA"
else
  PUSH_RANGE="$REMOTE_SHA..$LOCAL_SHA"
fi

export PUSH_RANGE

# Вызываем sync. Падение sync НЕ блокирует push.
if [ -x "$REPO_ROOT/scripts/docs-sync/sync.sh" ]; then
  bash "$REPO_ROOT/scripts/docs-sync/sync.sh" || {
    echo "[pre-push] docs-sync failed, but push continues. Check docs/.sync-failures.log"
  }
else
  echo "[pre-push] docs-sync/sync.sh not found or not executable. Skipping."
fi

# i18n translation sync (keeps locale catalogs in step with the RU source).
if [ -f "$REPO_ROOT/scripts/i18n-sync.sh" ]; then
  bash "$REPO_ROOT/scripts/i18n-sync.sh" || {
    echo "[pre-push] i18n-sync failed, but push continues."
  }
fi

exit 0
HOOK_EOF

chmod +x "$HOOK_PATH"
chmod +x "$REPO_ROOT/scripts/docs-sync/sync.sh" 2>/dev/null || true
chmod +x "$REPO_ROOT/scripts/docs-sync/check-structure.sh" 2>/dev/null || true
chmod +x "$REPO_ROOT/scripts/i18n-sync.sh" 2>/dev/null || true

echo "✓ Pre-push hook installed at $HOOK_PATH"
echo ""
echo "What's next:"
echo "  1. Make sure cursor-agent is in PATH: which cursor-agent"
echo "  2. Test on a small commit: edit a file in modules/, commit, push."
echo "  3. Watch the hook output. First run will be ~30-60 seconds."
echo "  4. To bypass hook in emergency: HARMONIZER_SKIP_DOC_SYNC=1 git push"
echo "     Or: git push --no-verify"
echo ""
echo "Logs: docs/.sync-logs/  (per-run logs)"
echo "      docs/.sync-failures.log  (errors only, append-only)"