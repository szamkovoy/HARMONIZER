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

# Проверка 2: YAML-frontmatter валиден.
# Поддерживаем два варианта записи:
#   1. Чистый YAML:    id: 02_modules/audio/spec
#   2. Внутри markdown заголовка: ## id: 02_modules/audio/spec
check_frontmatter() {
  local file="$1"
  if ! head -1 "$file" | grep -q '^---$'; then
    echo "  ERROR: $file — no YAML frontmatter"
    return 1
  fi
  for field in id title version updated; do
    # Ищем поле либо в начале строки (id: ...), либо после ## (## id: ...)
    if ! head -25 "$file" | grep -qE "^(##\s+)?$field:"; then
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

# Проверка 3: MAP.md содержит все 14 модулей
if [ -f docs/00_index/MAP.md ]; then
  for module in "${EXPECTED_MODULES[@]}"; do
    if ! grep -qE "^\| \`$module\`" docs/00_index/MAP.md; then
      echo "  ERROR: docs/00_index/MAP.md missing row for module '$module'"
      ERRORS=$((ERRORS + 1))
    fi
  done
fi

# Проверка 4: code_refs указывают на реально существующие файлы (только WARN)
while IFS= read -r f; do
  REFS="$(awk '/^code_refs:/,/^[a-z_]+:/' "$f" | grep -oE '(modules|app|services|_legacy_web|supabase)/[a-zA-Z0-9_./()*-]+' | sort -u || true)"
  while IFS= read -r ref; do
    [ -z "$ref" ] && continue
    if echo "$ref" | grep -qE '\*|\(tabs\)|<'; then
      continue
    fi
    if [ ! -e "$ref" ]; then
      echo "  WARN: $f references non-existent path: $ref"
    fi
  done <<< "$REFS"
done < <(find docs/02_modules -name '*.md' -type f 2>/dev/null)

if [ "$ERRORS" -gt 0 ]; then
  echo "[check-structure] FAILED ($ERRORS errors)"
  exit 1
fi

echo "[check-structure] OK"
exit 0