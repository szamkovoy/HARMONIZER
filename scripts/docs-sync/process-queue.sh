#!/usr/bin/env bash
# Обработчик очереди задач docs-sync.
# Запускается вручную: ./scripts/docs-sync/process-queue.sh
#
# Читает все задачи из docs/.sync-queue/ (старые первыми),
# для каждой вызывает cursor-agent с тем же промптом, что был в старом sync.sh.
# Успешные задачи удаляет из очереди. Неуспешные оставляет.

set -uo pipefail

# ============================================================
# 0. Kill switch
# ============================================================
if [ "${HARMONIZER_SKIP_DOC_SYNC:-0}" = "1" ]; then
  echo "[process-queue] Skipped (HARMONIZER_SKIP_DOC_SYNC=1)"
  exit 0
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT" || exit 1

QUEUE_DIR="$REPO_ROOT/docs/.sync-queue"
LOG_DIR="$REPO_ROOT/docs/.sync-logs"
FAILURES_LOG="$REPO_ROOT/docs/.sync-failures.log"
mkdir -p "$LOG_DIR"

if [ ! -d "$QUEUE_DIR" ]; then
  echo "[process-queue] Queue directory does not exist. Nothing to do."
  exit 0
fi

# Список задач (папки с timestamp в имени), отсортированных по возрастанию
TASKS=()
while IFS= read -r -d '' task; do
  TASKS+=("$task")
done < <(find "$QUEUE_DIR" -mindepth 1 -maxdepth 1 -type d -print0 | sort -z)

if [ "${#TASKS[@]}" -eq 0 ]; then
  echo "[process-queue] Queue is empty."
  exit 0
fi

echo "[process-queue] Found ${#TASKS[@]} task(s) in queue."

# ============================================================
# Проверка наличия cursor-agent
# ============================================================
if ! command -v cursor-agent >/dev/null 2>&1; then
  echo "[process-queue] ERROR: cursor-agent not found in PATH."
  exit 1
fi

PROCESSED=0
FAILED=0

for TASK_DIR in "${TASKS[@]}"; do
  TASK_NAME="$(basename "$TASK_DIR")"
  RUN_TIMESTAMP="$(date +%Y-%m-%d_%H-%M-%S)"
  LOG_FILE="$LOG_DIR/process_${RUN_TIMESTAMP}_${TASK_NAME}.log"

  echo ""
  echo "================================================================"
  echo "[process-queue] Processing task: $TASK_NAME"
  echo "[process-queue] Log: $LOG_FILE"
  echo "================================================================"

  # Подгружаем метаданные
  META_FILE="$TASK_DIR/meta.txt"
  DIFF_FILE="$TASK_DIR/diff.txt"
  STAT_FILE="$TASK_DIR/stat.txt"

  if [ ! -f "$META_FILE" ] || [ ! -f "$DIFF_FILE" ] || [ ! -f "$STAT_FILE" ]; then
    echo "[process-queue] WARN: task incomplete, skipping: $TASK_NAME"
    echo "$RUN_TIMESTAMP - task incomplete, $TASK_NAME" >> "$FAILURES_LOG"
    FAILED=$((FAILED + 1))
    continue
  fi

  # Извлекаем PUSH_RANGE из метаданных (для логов и сообщений об ошибках)
  PUSH_RANGE="$(grep '^PUSH_RANGE=' "$META_FILE" | head -1 | cut -d'=' -f2-)"

  # Готовим файлы там, где их ждёт промпт (.git/CURSOR_PUSH_DIFF.txt и STAT)
  cp "$DIFF_FILE" "$REPO_ROOT/.git/CURSOR_PUSH_DIFF.txt"
  cp "$STAT_FILE" "$REPO_ROOT/.git/CURSOR_PUSH_STAT.txt"

  # Промпт для агента (тот же, что был в старом sync.sh)
  PROMPT_FILE="$REPO_ROOT/.git/CURSOR_DOC_SYNC_PROMPT.txt"
  cat > "$PROMPT_FILE" <<'PROMPT_EOF'
Ты выполняешь автоматическую синхронизацию документации проекта HARMONIZER
с изменениями в коде. Это автоматизированный процесс — человек НЕ ждёт
интерактивного ответа, ты работаешь самостоятельно и точно.

## Твоя задача

1. Прочитай файл .git/CURSOR_PUSH_DIFF.txt — это git diff изменений кода,
   которые ушли в push.
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

  # Дублируем вывод обработки в персональный лог задачи
  {
    echo "[process-queue] Task: $TASK_NAME"
    echo "[process-queue] PUSH_RANGE: $PUSH_RANGE"
    echo "[process-queue] Calling cursor-agent (model=auto, mode=write)..."

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
        my $kid = waitpid($pid, 1);
        if ($kid == $pid) { exit($? >> 8); }
        sleep 1; $waited++;
      }
      kill 9, $pid;
      warn "[process-queue] timeout after ${timeout}s, agent killed\n";
      exit 124;
    ' "$TIMEOUT_SEC" \
      cursor-agent -p --force --trust --model auto --output-format text "$PROMPT_TEXT"
    AGENT_EXIT=$?
    set -e

    echo "[process-queue] Agent exit code: $AGENT_EXIT"

    # Структурные проверки
    if [ -x "$REPO_ROOT/scripts/docs-sync/check-structure.sh" ]; then
      echo "[process-queue] Running structural checks..."
      if ! "$REPO_ROOT/scripts/docs-sync/check-structure.sh"; then
        echo "[process-queue] FAIL: structural checks failed. Reverting docs/ changes."
        git checkout HEAD -- docs/
        echo "$RUN_TIMESTAMP - structural checks failed, task $TASK_NAME, agent exit $AGENT_EXIT" >> "$FAILURES_LOG"
        exit 70
      fi
      echo "[process-queue] Structural checks passed."
    else
      echo "[process-queue] WARN: check-structure.sh not found or not executable. Skipping checks."
    fi

    if [ "$AGENT_EXIT" -ne 0 ]; then
      echo "[process-queue] FAIL: agent failed (exit $AGENT_EXIT). Reverting docs/ changes."
      git checkout HEAD -- docs/
      echo "$RUN_TIMESTAMP - agent failed (exit $AGENT_EXIT), task $TASK_NAME" >> "$FAILURES_LOG"
      exit 71
    fi

    DOCS_CHANGED="$(git diff --name-only -- docs/ | grep -v '^docs/\.sync-' || true)"
    if [ -z "$DOCS_CHANGED" ]; then
      echo "[process-queue] Agent made no changes in docs/. Done."
      exit 0
    fi

    echo "[process-queue] Docs changed by agent:"
    echo "$DOCS_CHANGED" | sed 's/^/  /'

    git add docs/
    HEAD_SHORT="$(git rev-parse --short HEAD)"
    git commit -m "docs: auto-sync (queued task $TASK_NAME)

Triggered by push range: $PUSH_RANGE
Files: $(echo "$DOCS_CHANGED" | tr '\n' ' ')

[skip-doc-sync]"

    echo "[process-queue] Auto-commit created. Done."
    exit 0
  } > "$LOG_FILE" 2>&1

  TASK_EXIT=$?

  if [ "$TASK_EXIT" -eq 0 ]; then
    echo "[process-queue] Task $TASK_NAME — OK"
    rm -rf "$TASK_DIR"
    PROCESSED=$((PROCESSED + 1))
  else
    echo "[process-queue] Task $TASK_NAME — FAILED (exit $TASK_EXIT). Kept in queue."
    echo "[process-queue] See log: $LOG_FILE"
    FAILED=$((FAILED + 1))
  fi
done

# ============================================================
# Сводка
# ============================================================
REMAINING=$(find "$QUEUE_DIR" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')

echo ""
echo "================================================================"
echo "[process-queue] Summary"
echo "[process-queue]   Processed successfully: $PROCESSED"
echo "[process-queue]   Failed:                 $FAILED"
echo "[process-queue]   Remaining in queue:     $REMAINING"
echo "================================================================"

if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
exit 0 