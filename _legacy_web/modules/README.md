Shared server modules vendored for Vercel deploys from `_legacy_web`.

Vercel Root Directory is `_legacy_web`, so repo-root `../modules` is not on the build
machine. **Do not copy by hand** — refresh from canonical sources:

```bash
node scripts/sync-vercel-server-modules.mjs
```

That script copies only what `/api/day` and practice selection need (breath, day,
life-spheres, practices i18n + **3** typed overlay modules × 6 locales). It does **not**
duplicate the full 8-language app catalog (home, mandala, communicator, …).

Also vendored here (sync separately when changing astro/chakra server logic):
- `astro-core`, `daily-engine`, `chakra`
