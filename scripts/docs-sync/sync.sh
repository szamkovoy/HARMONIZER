#!/usr/bin/env bash
# Синхронизация docs/ с изменениями кода через Cursor CLI.
# Вызывается из pre-push hook. Может вызываться и вручную.
#
# Контракт:
# - На вход: переменная окружения PUSH_RANGE = "<base>..HEAD"
# - На выход: exit 0 — ок (либо обновили docs, либо нечего обновлять, либо kill-switch)
#             exit 1 — критическая ошибка (но push всё равно идёт — см. pre-push hook)

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
mkdir -p "$LOG_DIR"
TIMESTAMP="$(date +%Y-%m-%d_%H-%M-%S)"
LOG_FILE="$LOG_DIR/$TIMESTAMP.log"
FAILURES_LOG="$REPO_ROOT/docs/.sync-failures.log"

# Перенаправляем всё в лог + дублируем на stderr (видно в терминале)
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
  echo "[docs-sync] No code changes in push. Skipping doc sync."
  exit 0
fi

echo "[docs-sync] Code files changed:"
echo "$CODE_FILES" | sed 's/^/  /'

# ============================================================
# 3. Проверка наличия cursor-agent
# ============================================================
if ! command -v cursor-agent >/dev/null 2>&1; then
  echo "[docs-sync] WARN: cursor-agent not found in PATH. Skipping."
  echo "$TIMESTAMP - cursor-agent not found" >> "$FAILURES_LOG"
  exit 0
fi

# ============================================================
# 4. Подготовка diff и stats для агента
# ============================================================
DIFF_FILE="$REPO_ROOT/.git/CURSOR_PUSH_DIFF.txt"
STAT_FILE="$REPO_ROOT/.git/CURSOR_PUSH_STAT.txt"

# Diff только по файлам кода (исключаем docs, чтобы не путать агента собственными правками)
git diff "$PUSH_RANGE" -- . ':(exclude)docs/**' ':(exclude)scripts/docs-sync/**' > "$DIFF_FILE"
git diff --stat "$PUSH_RANGE" -- . ':(exclude)docs/**' ':(exclude)scripts/docs-sync/**' > "$STAT_FILE"

DIFF_SIZE=$(wc -l < "$DIFF_FILE" | tr -d ' ')
echo "[docs-sync] Diff prepared: $DIFF_SIZE lines"

# Защита от слишком большого diff (агент может зависнуть или нагенерить мусор)
MAX_DIFF_LINES=5000
if [ "$DIFF_SIZE" -gt "$MAX_DIFF_LINES" ]; then
  echo "[docs-sync] WARN: diff too large ($DIFF_SIZE > $MAX_DIFF_LINES lines). Skipping."
  echo "$TIMESTAMP - diff too large ($DIFF_SIZE lines), range $PUSH_RANGE" >> "$FAILURES_LOG"
  exit 0
fi

# ============================================================
# 5. Снапшот текущего состояния docs/ (для отката при сбое)
# ============================================================
SNAPSHOT_BRANCH="docs-sync-snapshot-$TIMESTAMP"
git stash push --keep-index --include-untracked -m "$SNAPSHOT_BRANCH" -- docs/ >/dev/null 2>&1 || true
HAS_STASH=0
git stash list | grep -q "$SNAPSHOT_BRANCH" && HAS_STASH=1
if [ "$HAS_STASH" = "1" ]; then
  # Восстанавливаем сразу — нам нужен снапшот в виде reflog, не реальный stash
  git stash pop --quiet 2>/dev/null || true
fi
DOCS_BEFORE_HASH="$(git ls-files -s docs/ | git hash-object --stdin -w 2>/dev/null || echo "no-snapshot")"

# ============================================================
# 6. Промпт для агента
# ============================================================
PROMPT_FILE="$REPO_ROOT/.git/CURSOR_DOC_SYNC_PROMPT.txt"
cat > "$PROMPT_FILE" <<'PROMPT_EOF'
Ты выполняешь автоматическую синхронизацию документации проекта HARMONIZER
с изменениями в коде. Это автоматизированный процесс в pre-push git hook —
человек НЕ ждёт интерактивного ответа, ты работаешь самостоятельно и точно.

## Твоя задача

1. Прочитай файл .git/CURSOR_PUSH_DIFF.txt — это git diff изменений кода,
   которые сейчас уходят на push.
2. Прочитай файл .git/CURSOR_PUSH_STAT.txt — это сводка по изменённым файлам.
3. Следуй алгоритму из docs/03_rules/documentation_update_rules.md СТРОГО.
4. Обнови затронутые файлы в docs/ ТОЧЕЧНО и МИНИМАЛЬНО.

## Жёсткие ограничения

- Изменяй файлы ТОЛЬКО внутри папки docs/. Никаких других файлов трогать НЕЛЬЗЯ.
- НЕ создавай новые файлы в docs/02_modules/<module>/ сверх триады
  (spec.md / dependencies.md / history.md).
- НЕ переписывай файлы целиком — только точечные правки в затронутые разделы.
- НЕ выдумывай содержимое: если в diff недостаточно информации для уверенной
  правки конкретного раздела spec.md — НЕ трогай этот раздел. Лучше пропустить,
  чем написать неверно.
- Сохраняй YAML-frontmatter в начале каждого .md-файла. Поле `updated` обнови
  на текущую дату, поле `version` инкрементируй (например 1.5 → 1.6) ТОЛЬКО
  если в файл реально внесена правка.
- В docs/00_index/CHANGELOG.md ВСЕГДА добавляй одну запись ВВЕРХУ списка
  с датой (today) и кратким описанием. Если правок в других файлах не было —
  CHANGELOG тоже не трогай.

## Триггеры (что считается изменением, требующим обновления docs)

См. полный список в docs/03_rules/documentation_update_rules.md, раздел
"Что обновлять при каком триггере". Кратко:
- API change: новые/изменённые экспорты, сигнатуры функций, контракты endpoint
- Dependency change: новый/удалённый импорт между modules/*, новый вызов API,
  новая запись/чтение чужой таблицы Supabase
- DB change: новые/изменённые миграции, таблицы, constraints, RLS политики
- Module add/remove: новая или удалённая папка в modules/ или _legacy_web/app/api/
- Intentional deviation: в коде сделано иначе, чем описано в текущем spec.md
- New tech debt: TODO/FIXME с продуктовым смыслом

## Если ничего не подпадает под триггеры

Это нормальный случай (рефакторинг без API-изменений, баг-фикс без новых связей,
правка стилей). НЕ трогай docs/ вообще, заверши работу с пометкой
"Triggers not matched".

## Формат отчёта в конце работы

В самом конце выведи блок ровно такого формата (без вариаций):

=== DOC-SYNC REPORT ===
TRIGGERS: <список сработавших триггеров через запятую, или "none">
FILES_MODIFIED: <список изменённых файлов в docs/ через запятую, или "none">
NOTES: <одна-две строки о том, что сделано или почему пропущено>
=== END REPORT ===
PROMPT_EOF

# ============================================================
# 7. Запуск Cursor agent
# ============================================================
echo "[docs-sync] Calling cursor-agent (model=auto, mode=write)..."

# Таймаут через perl (timeout не везде есть на macOS)
TIMEOUT_SEC=300

PROMPT_TEXT="$(cat "$PROMPT_FILE")"

set +e
perl -e '
  use strict; use warnings;
  my $timeout = shift @ARGV;
  my $pid = fork();
  die "fork failed: $!" unless defined $pid;
  if ($pid == 0) {
    exec @ARGV;
    exit 127;
  }
  my $waited = 0;
  while ($waited < $timeout) {
    my $kid = waitpid($pid, 1); # WNOHANG
    if ($kid == $pid) { exit($? >> 8); }
    sleep 1; $waited++;
  }
  kill 9, $pid;
  warn "[docs-sync] timeout after ${timeout}s, agent killed\n";
  exit 124;
' "$TIMEOUT_SEC" \
  cursor-agent -p --force --trust --model auto --output-format text "$PROMPT_TEXT"
AGENT_EXIT=$?
set -e

echo "[docs-sync] Agent exit code: $AGENT_EXIT"

# ============================================================
# 8. Структурные проверки
# ============================================================
if [ -x "$REPO_ROOT/scripts/docs-sync/check-structure.sh" ]; then
  echo "[docs-sync] Running structural checks..."
  if ! "$REPO_ROOT/scripts/docs-sync/check-structure.sh"; then
    echo "[docs-sync] FAIL: structural checks failed. Reverting docs/ changes."
    git checkout HEAD -- docs/
    echo "$TIMESTAMP - structural checks failed, range $PUSH_RANGE, agent exit $AGENT_EXIT" >> "$FAILURES_LOG"
    exit 0
  fi
  echo "[docs-sync] Structural checks passed."
else
  echo "[docs-sync] WARN: check-structure.sh not found or not executable. Skipping checks."
fi

# ============================================================
# 9. Если агент упал по таймауту или ошибке — откатываем docs/
# ============================================================
if [ "$AGENT_EXIT" -ne 0 ]; then
  echo "[docs-sync] FAIL: agent failed (exit $AGENT_EXIT). Reverting docs/ changes."
  git checkout HEAD -- docs/
  echo "$TIMESTAMP - agent failed (exit $AGENT_EXIT), range $PUSH_RANGE" >> "$FAILURES_LOG"
  exit 0
fi

# ============================================================
# 10. Если есть изменения в docs/ — коммитим
# ============================================================
DOCS_CHANGED="$(git diff --name-only -- docs/ | grep -v '^docs/\.sync-' || true)"
if [ -z "$DOCS_CHANGED" ]; then
  echo "[docs-sync] Agent made no changes in docs/. Done."
  exit 0
fi

echo "[docs-sync] Docs changed by agent:"
echo "$DOCS_CHANGED" | sed 's/^/  /'

git add docs/
HEAD_SHORT="$(git rev-parse --short HEAD)"
git commit -m "docs: auto-sync after $HEAD_SHORT

Triggered by push range: $PUSH_RANGE
Files: $(echo "$DOCS_CHANGED" | tr '\n' ' ')

[skip-doc-sync]"

echo "[docs-sync] Auto-commit created. Done."
exit 0