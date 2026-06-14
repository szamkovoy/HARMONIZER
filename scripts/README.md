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

`fill` needs an OpenAI-compatible chat/completions endpoint. If `I18N_TRANSLATE_API_*`
is unset, the script falls back to **`DEEPSEEK_API_KEY`** + **`AI_MODEL_PREMIUM`**
(or `AI_MODEL_STANDARD`) — the same DeepSeek stack as the app backend:

```bash
# Optional overrides (defaults below work when DEEPSEEK_API_KEY is in the environment):
# I18N_TRANSLATE_API_URL=https://api.deepseek.com/v1/chat/completions
# I18N_TRANSLATE_API_KEY=$DEEPSEEK_API_KEY
# I18N_TRANSLATE_MODEL=$AI_MODEL_PREMIUM   # one-time UI string translation; premium is fine

node scripts/i18n-sync.mjs fill --all
```

This is a **one-time (or incremental) batch translation** of static UI strings in
`modules/i18n/catalog/*.json` and typed-module overlays — not runtime dialog text.
Runtime LLM content (recommendations, global `text_i18n`) uses the server Gemini/DeepSeek
path separately.

### Enabling DE / FR / … in the app

1. `node scripts/i18n-sync.mjs fill --all` (with DeepSeek env as above).
2. Localize dialog layer-C builders for that locale (Phase 3 — still open for de/fr).
3. Flip `enabled: true` for the locale in `APP_LOCALE_OPTIONS` (`localeStore.ts`).
4. Redeploy backend if server strings changed.

Until step 3, the Profile picker shows the language as **(soon)**.

The pre-push wrapper `scripts/i18n-sync.sh` runs automatically when a push changes
`ru.json` (installed alongside docs-sync by `scripts/docs-sync/install.sh`). It
fills the target catalogs and commits them; it never blocks the push. Bypass with
`HARMONIZER_SKIP_I18N_SYNC=1 git push`.
