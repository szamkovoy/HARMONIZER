#!/usr/bin/env bash
# Структурные проверки документации.
# Возвращает 0 если всё ок, 1 если что-то сломано.

set -uo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT" || exit 1

ERRORS=0

# Список ожидаемых модулей (синхронизирован с MAP.md)
EXPECTED_MODULES=(
  audio bindu infra calibration astro subscription biofeedback
  profile daily_forecast practices assistant communicator
  webinars author_presence
)

# Проверка 1: триада существует для каждого модуля
for module in "${EXPECTED_MODULES[@]}"; do
  for f in spec.md dependencies.md history.md; do
    if [ ! -f "docs/02_modules/$module/$f" ]; then
      echo "  ERROR: missing docs/02_modules/$module/$f"
      ERRORS=$((ERRORS + 1))
    fi
  done
done

# Проверка 2: в папке модуля нет лишних .md файлов сверх триады
for module in "${EXPECTED_MODULES[@]}"; do
  if [ -d "docs/02_modules/$module" ]; then
    EXTRA="$(find "docs/02_modules/$module" -maxdepth 1 -type f -name '*.md' \
      ! -name 'spec.md' ! -name 'dependencies.md' ! -name 'history.md' 2>/dev/null || true)"
    if [ -n "$EXTRA" ]; then
      echo "  WARN: extra .md files in docs/02_modules/$module/:"
      echo "$EXTRA" | sed 's/^/    /'
      # Не считаем это ошибкой — некоторые модули имеют доп. файлы (caching_strategy.md и т.п.)
    fi
  fi
done

# Проверка 3: YAML-frontmatter валиден (есть id, title, version, updated)
check_frontmatter() {
  local file="$1"
  if ! head -1 "$file" | grep -q '^---$'; then
    echo "  ERROR: $file — no YAML frontmatter"
    return 1
  fi
  for field in id title version updated; do
    if ! head -20 "$file" | grep -qE "^$field:"; then
      echo "  ERROR: $file — missing field '$field' in frontmatter"
      return 1
    fi
  done
  return 0
}

while IFS= read -r f; do
  check_frontmatter "$f" || ERRORS=$((ERRORS + 1))
done < <(find docs/02_modules -name '*.md' -type f 2>/dev/null)

check_frontmatter "docs/00_index/MAP.md" || ERRORS=$((ERRORS + 1))
check_frontmatter "docs/00_index/CHANGELOG.md" || ERRORS=$((ERRORS + 1))
check_frontmatter "docs/04_workspace/open_questions.md" || ERRORS=$((ERRORS + 1))

# Проверка 4: MAP.md содержит все 14 модулей
if [ -f docs/00_index/MAP.md ]; then
  for module in "${EXPECTED_MODULES[@]}"; do
    if ! grep -qE "^\| \`$module\`" docs/00_index/MAP.md; then
      echo "  ERROR: docs/00_index/MAP.md missing row for module '$module'"
      ERRORS=$((ERRORS + 1))
    fi
  done
fi

# Проверка 5: code_refs указывают на реально существующие файлы
# (только базовая проверка для путей, начинающихся с modules/, app/, services/, _legacy_web/, supabase/)
while IFS= read -r f; do
  # Извлекаем code_refs из YAML (грубо, через grep)
  REFS="$(awk '/^code_refs:/,/^[a-z_]+:/' "$f" | grep -oE '(modules|app|services|_legacy_web|supabase)/[a-zA-Z0-9_./()*-]+' | sort -u || true)"
  while IFS= read -r ref; do
    [ -z "$ref" ] && continue
    # Игнорируем wildcards и (tabs)
    if echo "$ref" | grep -qE '\*|\(tabs\)|<'; then
      continue
    fi
    if [ ! -e "$ref" ]; then
      echo "  WARN: $f references non-existent path: $ref"
      # Не считаем ошибкой — пути могли быть удалены, это нормально для легаси
    fi
  done <<< "$REFS"
done < <(find docs/02_modules -name '*.md' -type f 2>/dev/null)

if [ "$ERRORS" -gt 0 ]; then
  echo "[check-structure] FAILED ($ERRORS errors)"
  exit 1
fi

echo "[check-structure] OK"
exit 0