Shared server modules vendored for Vercel deploys from `_legacy_web`.

Vercel CLI uploads the current project directory when running `npx vercel --prod`
inside `_legacy_web`, so imports that point at `../modules` are not available on
the build machine. Keep these files in sync with the root `modules/astro-core`
and `modules/daily-engine` runtime sources when changing astro forecast logic.
