Shared server modules vendored for Vercel deploys from `_legacy_web`.

Vercel Root Directory is `_legacy_web`, so repo-root `../modules` is not on the build
machine. Keep these files in sync with the matching root `modules/*` sources when
changing server i18n or astro/chakra logic.

Vendored trees:
- `astro-core`, `daily-engine`, `chakra` — astro forecast + chakra labels
- `i18n`, `breath`, `day`, `life-spheres`, `practices` — `/api/day` and practice selection i18n
