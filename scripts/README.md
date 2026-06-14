# scripts/

Operational scripts for the HARMONIZER repo.

| Script | Purpose |
|--------|---------|
| `docs-sync/` | Pre-push hook that auto-updates `docs/` from code changes via cursor-agent. Install once: `bash scripts/docs-sync/install.sh`. |
| `i18n-sync.mjs` / `i18n-sync.sh` | Translation sync gate — keeps locale catalogs in step with the Russian source. See below. |
| `backup-active-prompts.mjs` | Dump active `public.prompts` rows to JSON before a prompt migration. |
| `backfill-practice-thumbnails.mjs` | One-off: backfill practice thumbnails. |
| `import-vimeo-asanas.mjs` | One-off: import asana videos from Vimeo. |
| `doctor-ios-biofeedback.sh` | iOS biofeedback build doctor. |

## i18n translation sync gate

Keeps the per-language UI catalogs in sync with the **Russian source of truth**
(`modules/i18n/catalog/ru.json`). Diff-based: it only ever touches keys whose RU
source is missing or has changed (tracked in `catalog/.sync-meta.json`), never the
whole catalog. Design rationale: `docs/04_workspace/i18n_architecture.md`.

```bash
# Check (CI / manual): fail if required locales (en) drifted from the source.
node scripts/i18n-sync.mjs check

# Fill: LLM-translate missing/stale keys for one locale or all targets.
node scripts/i18n-sync.mjs fill --locale en
node scripts/i18n-sync.mjs fill --all
```

`fill` needs an OpenAI-compatible endpoint via env, else it only prints the plan:

```
I18N_TRANSLATE_API_URL=...   # chat/completions URL
I18N_TRANSLATE_API_KEY=...
I18N_TRANSLATE_MODEL=...      # e.g. the standard DeepSeek model
```

Targets: `en` is **required** (gate fails on drift); `de fr it es pt nl` are
best-effort (gate warns). To bring up a new language, run `fill --all` once.

The pre-push wrapper `scripts/i18n-sync.sh` runs automatically when a push changes
`ru.json` (installed alongside docs-sync by `scripts/docs-sync/install.sh`). It
fills the target catalogs and commits them; it never blocks the push. Bypass with
`HARMONIZER_SKIP_I18N_SYNC=1 git push`.
