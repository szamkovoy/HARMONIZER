# Локальные бэкапы Supabase

Сюда можно складывать разовые выгрузки перед рискованными миграциями.

Пример — активные промпты перед `dialog_quality_v4` (запускать **из корня репозитория** HARMONIZER):

```bash
node --env-file=.env.local scripts/backup-active-prompts.mjs
```

Файлы `*.json` по умолчанию не коммитятся (см. корневой `.gitignore`).
