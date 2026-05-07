#!/usr/bin/env bash
# Pre-push hook кладёт задачу синхронизации docs/ в очередь.
# Сам cursor-agent НЕ вызывается здесь — это делает process-queue.sh
# (запускается вручную или из обычного терминала).
#
# Контракт:
# - На вход: переменная окружения PUSH_RANGE = "<base>..HEAD"
# - На выход: exit 0 — задача поставлена в очередь, либо нечего делать,
#             либо kill-switch.

set -uo pipefail

# ============================================================
# 0. Kill switch
# ============================================================
if [ "${HARMONIZER_SKIP_DOC_SYNC:-0}" = "1" ]; then
  echo "[docs-sync] Skipped (HARMONIZER_SKIP_DOC_SYNC=1)"
  exit 0
fi

# ============================================================
# 1. Подготовка
# ============================================================
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT" || exit 1

LOG_DIR="$REPO_ROOT/docs/.sync-logs"
QUEUE_DIR="$REPO_ROOT/docs/.sync-queue"
mkdir -p "$LOG_DIR" "$QUEUE_DIR"
TIMESTAMP="$(date +%Y-%m-%d_%H-%M-%S)"
LOG_FILE="$LOG_DIR/$TIMESTAMP.log"
FAILURES_LOG="$REPO_ROOT/docs/.sync-failures.log"

exec > >(tee -a "$LOG_FILE") 2>&1

echo "[docs-sync] Starting at $(date)"
echo "[docs-sync] Range: ${PUSH_RANGE:-<not set>}"

if [ -z "${PUSH_RANGE:-}" ]; then
  echo "[docs-sync] ERROR: PUSH_RANGE not set. Skipping."
  exit 0
fi

# ============================================================
# 2. Условие срабатывания: есть ли в push реальные изменения в коде
# ============================================================
CODE_PATHS_REGEX='^(modules/|app/|services/|_legacy_web/app/api/|supabase/migrations/)'
CODE_FILES="$(git diff --name-only "$PUSH_RANGE" -- . | grep -E "$CODE_PATHS_REGEX" || true)"

if [ -z "$CODE_FILES" ]; then
  echo "[docs-sync] No code changes in push. Skipping queue."
  exit 0
fi

echo "[docs-sync] Code files changed:"
echo "$CODE_FILES" | sed 's/^/  /'

# ============================================================
# 3. Подготовка diff и stats — кладём в очередь
# ============================================================
TASK_DIR="$QUEUE_DIR/$TIMESTAMP"
mkdir -p "$TASK_DIR"

DIFF_FILE="$TASK_DIR/diff.txt"
STAT_FILE="$TASK_DIR/stat.txt"
META_FILE="$TASK_DIR/meta.txt"

git diff "$PUSH_RANGE" -- . ':(exclude)docs/**' ':(exclude)scripts/docs-sync/**' > "$DIFF_FILE"
git diff --stat "$PUSH_RANGE" -- . ':(exclude)docs/**' ':(exclude)scripts/docs-sync/**' > "$STAT_FILE"

DIFF_SIZE=$(wc -l < "$DIFF_FILE" | tr -d ' ')
echo "[docs-sync] Diff prepared: $DIFF_SIZE lines"

MAX_DIFF_LINES=5000
if [ "$DIFF_SIZE" -gt "$MAX_DIFF_LINES" ]; then
  echo "[docs-sync] WARN: diff too large ($DIFF_SIZE > $MAX_DIFF_LINES lines). Skipping queue."
  echo "$TIMESTAMP - diff too large ($DIFF_SIZE lines), range $PUSH_RANGE" >> "$FAILURES_LOG"
  rm -rf "$TASK_DIR"
  exit 0
fi

# Метаданные задачи
cat > "$META_FILE" <<EOF
TIMESTAMP=$TIMESTAMP
PUSH_RANGE=$PUSH_RANGE
DIFF_SIZE=$DIFF_SIZE
CODE_FILES<<CODE_FILES_EOF
$CODE_FILES
CODE_FILES_EOF
EOF

echo "[docs-sync] Task queued at: $TASK_DIR"
echo "[docs-sync] Run scripts/docs-sync/process-queue.sh to process the queue."
exit 0