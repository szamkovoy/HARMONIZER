---
id: 02_modules/infra/history
title: Infra History
version: 1.16
updated: 2026-08-04
depends_on: [01_foundation/repository_structure, 01_foundation/tech_stack]
code_refs: [_legacy_web/app/layout.tsx, _legacy_web/next.config.ts, _legacy_web/instrumentation.ts, _legacy_web/sentry.server.config.ts, _legacy_web/app/api/_utils/monitoring.ts, _legacy_web/public/manifest.json, _legacy_web/package.json, .vercelignore, package.json, sentry.client.config.ts, supabase/README.md, supabase/migrations/20260721010000_ensure_harmonizer_cron_watchdog.sql, supabase/migrations/20260724190000_cleanup_stale_notification_deliveries.sql]
---

## Decision Log

- **2026-08-07 (OTP ghost 1h + welcome onboarded):** `cleanup_unconfirmed_auth_users` TTL 24h→**1h**; `sync_email_contacts_from_users` только confirmed; welcome-цепочка enroll по `onboarded_at` (`email_automation_onboarded_users`). Миграция `20260807180000`.

- **2026-08-05 (store-review OTP):** Vercel `POST /api/auth/otp-verify` + secrets `STORE_REVIEW_EMAIL`/`STORE_REVIEW_OTP`; edge `send-auth-email` skip-send для allowlist; миграция `store_review_account`. См. `DEPLOY.md` / onboarding history.

- **2026-08-04 (store versioning process):** Причина коллизий Play «код уже использован»: ручные бампы `versionCode` поверх `eas.json` `autoIncrement`, повторная заливка того же AAB, и рассинхрон git (`versionCode` отставал от уже принятых артефактов). Fix процесса: канон в `DEPLOY.md` «App version»; агент-правило `.cursor/rules/store-build-version.mdc`; post-step `scripts/after-store-build.mjs` на `build:android:prod` / `build:ios:prod` (закоммитить `app.json`, заливать один раз). Обычный релиз — без ручного инкремента Android/iOS build integers.

- **2026-08-04 (Android versionCode 30):** `app.json` `android.versionCode` → **30** — Play уже занял 27–29 (в т.ч. артефакты в библиотеке релиза без выката на тест); следующий store AAB должен идти с ≥30.

- **2026-08-04 (app version 1.2.1):** Маркетинговая версия **1.2.1** (`app.json` / `package.json`).

- **2026-08-03 (Expo Dev iOS splash):** TestFlight OK; Dev cold start — black blink + stuck splash after Metro «Downloading». Causes: EarlyCover dismiss over dark `screenBg`; `useDayContent` effect on `refresh` identity → abort loop. Fix: splash-white underlay while EarlyCover/auth gate; `__DEV__` rAF defer dismiss; overlay paint safety + pointerEvents/force-unmount; day refresh keyed on `profileId`/`profileLoading`; force-complete 25s Dev / 60s prod.

- **2026-08-03 (app version 1.2.0):** Маркетинговая версия **1.2.0** (`app.json` / `package.json`).
- **2026-07-31 (app versioning):** Маркетинговая версия в `app.json` / native; `eas.json` `appVersionSource: "local"`, `autoIncrement` на **production** и **preview** (build number монотонный, не сбрасывается при major). В Профиле видна строка `v{version} ({build})`.

- **2026-07-31 (SurfaceHelpModal scroll):** «?» help modals (`SurfaceHelpModal`) vertically centered the whole card without a body `ScrollView`, so long copy / large system font pushed the opening lines off-screen and made the tip unreadable. Fix in shared UI: card `maxHeight` ≈ 90% viewport, sticky title/× + «Закрыть», scrollable body from the first line (`nestedScrollEnabled`, reset scroll on open).

- **2026-07-30 (splash full-bleed):** Холодный старт: крошечный centered logo (Android 12 Splash API / iOS без legacy full-screen), пока `useFonts` держал `return null`. Fix: `EarlySplashCover` (cover) до шрифтов + сразу `hideAsync`; plugin `enableFullScreenImage_legacy: true` (iOS) + `imageWidth: 288` (макс. Android icon canvas). Полный full-bleed на Android 12+ системно недоступен — минимизируем время мелкого кадра.

- **2026-07-31 (Android splash no small icon):** QA: на Android мелькал маленький centered splash, затем большой кадр (iOS уже full-bleed). Android 12+ не даёт full-bleed image. Fix: `with-android-splash-hide-icon` → прозрачный `windowSplashScreenAnimatedIcon`; `EarlySplashCover` ждёт `onLoadEnd` перед `hideAsync`.
- **2026-07-31 (Android splash plugin order):** Первый проход плагина не патчил `styles.xml` (`withAndroidStyles` / `withDangerousMod` шли до записи темы `expo-splash-screen`). Переведено на `withFinalizedMod` — патч после всех модов.
- **2026-07-31 (splash white flicker):** После скрытия мелкой иконки QA: большая заставка «дышала» в белый. Причина — `logoBreath` opacity 0.58–0.74 на `#fff` + размонтирование `EarlySplashCover` до paint `AppStartupSplashOverlay`. Fix: картинка всегда opacity 1; early cover до `onSplashReady`.
- **2026-07-31 (Android white hang):** После splash-фикса cold start залипал на белом. Гонка: пустые `segments` → `!isHomeRoute` → splash off, под ним белый `waitingForProfile`. Fix: hold splash while profile gate; не снимать blocking на cold-start.
- **2026-07-31 (Android white hang v2):** QA: снова белый экран после AAB. Прозрачный `windowSplashScreenAnimatedIcon` + ранний `hideAsync` = blank native без fallback. Откат hide-icon плагина; hide native только после `Image.onLoad`; splash bg `#f7f7f7`; truecolor PNG; auth поднимает `profileLoading` до `initializing=false`.
- **2026-07-31 (Android splash reset):** QA: mini → огромная растянутая. Reset: iOS снова EarlySplashCover + `useWindowDimensions`; Android без EarlySplashCover (native → AppStartup с явными winW/winH); overlay bg `#ffffff`; без absoluteFill Image.
- **2026-08-01 (Android splash mini icon again):** QA: снова мелкая системная иконка перед большим кадром (dev APK). Restore `with-android-splash-hide-icon` + EarlySplashCover на обеих платформах с handoff через `onSplashReady`; hide native только после `Image.onLoadEnd` (прозрачный icon без cover = белый hang).
- **2026-08-02 (Android splash full-bleed v4):** QA Pixel: hang/flash ушли, но снова mini→large splash. Android 12 не даёт full-bleed (в отличие от iOS legacy). Fix: re-enable hide-icon **с** full-bleed `windowBackground` (`splash.png` nodpi) на Splash+AppTheme + `SplashScreenManager.hide()` сразу в `MainActivity.onCreate` — большая заставка без ожидания JS, без mini-icon.
- **2026-08-02 (Android splash hang v3 + empty underlay flash):** QA Pixel после v2: снова белый hang; dark: splash→тёмный пустой→белый пустой→Home. Causes: (1) transparent Android 12 icon всё ещё в AAB; (2) пустые `segments` → `isHomeRoute=false` → splash off на белый root. Fix: **отключить** `with-android-splash-hide-icon` (native icon обратно); unsettled route = Home; root/Stack `contentStyle` = `screenBg`; eager `hydrateThemePreference`.
- **2026-08-02 (Android splash white hang + theme flash):** QA Pixel: ~2/5 cold start залипал на белом до заставки; после splash — мелькание; dark: splash→чёрный→белый→тёмный Home. Causes: (1) EarlySplashCover `hideAsync` на 400 ms до paint при transparent Android 12 icon; (2) Stack/theme default light до SecureStore hydrate. Fix: hide native только после `onLoad` (+ safety 3 с); EarlyCover/Stack ждут `theme.ready`; underlay после hydrate = `screenBg`. Stories cold placeholder без spinner.
- **2026-08-01 (iOS splash brightness flash):** QA: первое мгновение заставки ярче, чем AppStartup. Cause: EarlySplashCover без veil → handoff. Fix: лёгкий `iosMatchVeil` на EarlySplashCover only.

- **2026-07-31 (iOS Firebase autolink gate):** After config-plugin skip, `pod install` still failed: CocoaPods resolved `RNFBAppCheck` → missing `AppCheckCore (~> 11.3)`. Added `react-native.config.js` to disable iOS autolink for `@react-native-firebase/*` when plist/`GOOGLE_SERVICES_PLIST` is absent (matches plugin gate).
- **2026-07-31 (iOS EAS AppCheckCore specs):** With plist present, local EAS still hit Install pods exit 31: stale CocoaPods trunk could not resolve `AppCheckCore (~> 11.3)` for Firebase 12.15. Fix: `package.json` `eas-build-post-install` → `pod repo update` before Install pods.
- **2026-07-31 (iOS AppCheckCore CDN etag):** Root cause: local `all_pods_versions_3_b_6.txt` stopped at AppCheckCore 11.2.0 while remote CDN had 11.3.1; stale etag made `pod repo update` a no-op. Local EAS also skipped `eas-build-post-install`. Fix: `scripts/refresh-cocoapods-appcheck-cdn.mjs` (build scripts + post-install) + `plugins/with-ios-appcheckcore-cdn-refresh.js` Podfile preamble.

- **2026-07-31 (iOS GoogleService-Info.plist):** `app.config.ts` wires `ios.googleServicesFile` from `GOOGLE_SERVICES_PLIST` / local plist; RNFirebase plugins + `forceStaticLinking` only when the platform file exists (`EAS_BUILD_PLATFORM`). `.easignore` keeps Firebase client configs in EAS archives while gitignore excludes them. Unblocks iOS local production prebuild without hard-fail.

- **2026-07-30 (APP_VARIANT side-by-side):** `APP_VARIANT` in `eas.json` + `app.config.ts` → distinct names/ids: Expo (`*.dev`), Test (`*.preview`), Store (production). Localized display names get « Expo» / « Test» via `buildLocales`. TestFlight still shares production id (Apple). See `DEPLOY.md`.

- **2026-07-30 (store env bake-in):** Production/preview EAS envs were missing `EXPO_PUBLIC_SUPABASE_*` (only development had them) → store AAB/IPA crashed «Supabase is not configured». Synced URL+anon to production/preview + `EXPO_PUBLIC_APP_ENV`; `eas.json` binds profiles to environments + `autoIncrement` + iOS `ascAppId`; `scripts/check-eas-client-env.mjs` / `npm run check:eas-env`; restored direct `babel-preset-expo` for Metro/QR; documented three lanes in `DEPLOY.md`.

- **2026-07-29 (expo-doctor hygiene):** Removed project `eas-cli` dep (use `npx eas-cli`); aligned Expo SDK 54 package versions; kept `@sentry/react-native` 8.x via `expo.install.exclude`; registered `expo-font` / `expo-web-browser` plugins; bumped `eas.json` `cli.version` to `>= 16.26.1`. `npx expo-doctor` → 18/18.

- **2026-07-29 (Play AAB location permissions):** Upload rejected — `ACCESS_COARSE/FINE_LOCATION` declared with conflicting `maxSdkVersion` (BLE plugin `uses-permission-sdk-23` + `maxSdkVersion=30` vs unrestricted `expo-location`). Fix: `plugins/with-android-location-permission-merge.js` after BLE — remove sdk-23 location, `tools:node=replace` unrestricted location; also cap legacy Bluetooth @30 and external storage @32; force `BLUETOOTH_SCAN` `neverForLocation` (Expo permissions list otherwise skips the BLE flag). Synced `android/app/src/main/AndroidManifest.xml`.

- **2026-07-28 (geo reverse city):** Shared `geoCity.ts` + Nominatim reverse prefer settlement names; reject district labels. Used by onboarding geo persist and admin city repair.

- **2026-07-27 (email suppressions sync cron):** `sync_email_suppressions_daily` (`20 5 * * *` → `invoke_sync_email_suppressions` → Vercel `/api/cron/email-suppressions-sync`). Миграция `20260727180000`.

- **2026-07-25 (email automations cron):** В реестр `ensure_harmonizer_cron_jobs` добавлен `run_email_automations_hourly` (`40 * * * *` → `invoke_run_email_automations` → Vercel). Миграция `20260725020000`.

- **2026-07-24 (webinar start notify cron):** `notify_webinar_start_minutely` → Edge `notify-webinar-start` (Vault secret fallback chain). Миграция `20260724193000`.

- **2026-07-24 (notification deliveries retention):** Weekly SQL cron `cleanup_stale_notification_deliveries_weekly` (`37 4 * * 0`) в `ensure_harmonizer_cron_jobs` — батчевый prune `notification_deliveries` старше 30 дней (`SKIP LOCKED`, lock/statement timeout). Без Edge/Vault. Миграции `20260724190000`, `20260724190500`.

- **2026-07-23 (auth email providers):** Edge `send-auth-email` — pluggable `resend`/`ses` via `AUTH_EMAIL_PROVIDER`; dual Resend keys (`RESEND_ZAMKOVOI_YOGA_API_KEY` OTP vs `RESEND_ZAMKOVOI_RU_API_KEY` future marketing). SES secrets/DNS documented as tails in `docs/04_workspace/email_providers.md`.

- **2026-07-21 (OTP ghost cleanup):** `cleanup_unconfirmed_auth_users()` + cron hourly в `ensure_harmonizer_cron_jobs` — удаляет только never-confirmed / never-signed-in аккаунты старше 24ч (без payments/admin/onboarded).

- **2026-07-21 (dialog metrics):** `monitoring.ts` — `logDialogTurn` / `logLlmPromptSize`; communicator `v2/dialog` пишет их после успешного insert хода (оценка `total_tokens` ≈ chars/3.5). Сырьё для админ RPC `admin_llm_metrics` / пульса.

- **2026-07-21 (8):** Root cause paid midnight cold: Edge `precompute-daily-forecasts` был задеплоен, но `pg_cron` job жил только в runbook (`DEPLOY.md`/`README`), без миграции — в prod schedule отсутствовал месяцами. Параллельно пропал invoker/job `reconcile_expired_memberships_hourly`. Fix: (1) `20260721003000` — schedule paid hourly; (2) `20260721010000` — `ensure_harmonizer_cron_jobs()` как единый реестр + watchdog каждые 15 мин + re-assert из free/paid invokers; (3) `20260721011000` — restore `invoke_reconcile_expired_memberships` и re-schedule через ensure.

- **2026-07-10 (7):** Добавлен hourly membership reconcile: Edge `reconcile-expired-memberships`, SQL RPC `recompute_user_membership` / `reconcile_expired_memberships`, миграция `20260710023000_reconcile_expired_memberships.sql` (`pg_cron` `20 * * * *`, Vault `reconcile_expired_memberships_cron_secret`). Назначение — синхронизировать `users.membership_*` с леджером `payments` после истечения срока без автооплаты store. Документы: `supabase/README.md`, `DEPLOY.md`, `config.toml`.

- **2026-07-10 (6):** Stories cleanup переведён из “операционного обещания” в более жёсткий infra-контракт. Added migration `20260709215553_schedule_cleanup_expired_stories.sql`: `pg_cron + pg_net + vault` invoke edge-функции `cleanup-expired-stories` каждый час в `15 * * * *`, по паттерну уже существующих precompute jobs. Параллельно `_legacy_web/app/api/admin/stories/route.ts` получил safety-net cleanup перед возвратом списка, чтобы отсутствие/сбой внешнего scheduler не оставлял истёкшие rows в админке бесконечно.

- **2026-07-09 (5):** Укреплён stories media runtime в `_legacy_web`. Выяснилось, что `ffprobe-static`/`ffmpeg-static` как npm-зависимости были установлены корректно, но bundled Node route мог передавать в spawn несуществующий путь к бинарнику (`/ROOT/node_modules/...`, `ENOENT`). Решение: stories media pipeline теперь вычисляет абсолютные binary paths от `package.json` пакетов через `createRequire(import.meta.url)` и проверяет `existsSync + X_OK` перед запуском. Заодно обновлён video preset под mobile stories (`1080x1920`, `30 fps`, `H.264 High`, `AAC 128k`, `+faststart`).

## Decision Log

- **2026-07-09 (5):** Supabase Free tier жёстко держит global Storage limit 50 MiB (`config push` с 150 MiB → HTTP 402). Chunked stories upload на Vercel обходит потолок для raw-файлов до ffmpeg; `config.toml` оставлен на 50 MiB для успешного sync с remote.

- **2026-07-08 (4):** Stories media infra expanded in two directions. First, `_legacy_web/package.json` gained `sharp`, `ffmpeg-static` and `ffprobe-static`, because Stories uploads are now normalized server-side (crop/resize for images; mp4 transcode, poster frame and tiny thumbnail for videos) before any DB row is created. Second, Supabase cron surface gained `cleanup-expired-stories` (`supabase/functions/cleanup-expired-stories`, `supabase/config.toml`, `supabase/README.md`, `DEPLOY.md`) so expired stories are deleted not only from feed SQL but also from Storage.

- **2026-06-27 (3):** Expo prebuild contract expanded for BLE chest straps. `package.json` now includes `@sfourdrinier/react-native-ble-plx`, and `app.config.ts` wires the BLE config plugin plus iOS `NSBluetoothAlwaysUsageDescription` and Android `BLUETOOTH(_SCAN/_CONNECT)` permissions. Result: Polar/generic BLE HRM support is available in dev-client / prebuild builds, while Expo Go remains unsupported for that path.

- **2026-06-27 (2):** `precompute-daily-forecasts` bundling fix: cron function no longer imports `modules/daily-engine` or `_legacy_web/*` across the repo root (Supabase remote bundler cannot resolve those paths). Morning precompute now uses `_shared/dailyForecast.ts` for `computeActivation` / aspect weights, plus Edge copies of `contentLengths`, `mathLevelI18n` (+ targets) and `contentLocales`. Deploy unblocked for paid `scenario_cache` pre-warm.

- **2026-06-27:** Supabase Edge bundler fix for shared ephemeris: `supabase/functions/_shared/dailyForecast.ts` switched `astronomia` imports from bare package paths to `https://esm.sh/astronomia@4.2.0/...`, unblocking deploy of `precompute-global-recommendations` (and any function importing the shared module). `supabase/functions/deno.json` now includes `astronomia/base`; Vitest parity aliases cover the new `base` URL.

- **2026-06-26:** LLM infra fallback contract was tightened. `_legacy_web/app/api/_utils/gemini.ts` no longer silently demotes `premium -> standard` before `AI_MODEL_FALLBACK` on interactive routes; it now tries the exact requested tier once and then falls back directly on retryable overload/timeout. In parallel, Supabase cron functions `precompute-daily-forecasts` and `precompute-global-recommendations` gained their own background retry policy: up to 3 primary-model attempts with 60-second pauses, then one fallback attempt for that generation.

- **2026-06-16:** Groq Whisper pipeline: `whisperPrompts.ts` — `LANGUAGE_ALIASES` для 8 локалей, optional `language` (omit → `AUTO_DETECT_DOMAIN_PROMPT`), `normalizeWhisperLanguage` → `string | undefined`; `whisperTranscription.ts` и `/transcribe` клиент пропускают `language` в form, когда hint не задан. Контракт STT — `communicator/spec.md`, `i18n/spec.md` §8.

- **2026-06-09 (4):** Sentry-шум от штатной перегрузки LLM и обрыва SSE снижен: `reportRouteError` логирует «Сервис временно недоступен…» как `warning` (не `error`), `sentry.server.config.ts` фильтрует `failed to pipe response`, dialog SSE при ошибке responder закрывается событием `error` + `controller.close()` вместо `controller.error()`. Аналитика перегрузок остаётся в `user_event_log`.
- **2026-06-08 (3):** Добавлена follow-up миграция `20260608170000_activate_dialog_system_v3_v6.sql`: она деактивирует старые версии `dialog_system_v3` и явно поднимает `version = 6` в `is_active = true`, чтобы новые окружения не оставались без активного daily-dialog prompt после `db push`.
- **2026-06-08 (2):** В Supabase добавлена follow-up миграция `20260608153000_allow_day_entry_source.sql`: она расширяет CHECK `public.conversations.entry_source`, добавляя значение `day`. Это синхронизирует БД с уже существующим клиентским/серверным контрактом Day tab modal и убирает `23514 conversations_entry_source_check` при создании новой беседы.
- **2026-06-08:** Native health prebuild-конфиг добавлен в Expo: зависимости `@kingstinct/react-native-healthkit`, `react-native-nitro-modules`, `react-native-health-connect`, `expo-build-properties`; `app.config.ts` включает HealthKit entitlement, Android Health Connect permissions и SDK 35/minSdk 26, а `plugins/with-native-health.js` добавляет iOS usage descriptions и Android `HealthConnectPermissionDelegate`.

- **2026-05-21:** `instrumentation.ts` при старте Node вызывает `logTestModeStartupWarning` из `testMode.ts` до загрузки Sentry — диагностика активного `TEST_MODE_FAST_INTERVALS` без влияния на клиент Expo.

- **2026-05-15:** В **`dependencies.md`** §1 (Supabase) уточнено, что строка **`dialog_system_v3`** в **`public.prompts`** поддерживается цепочкой миграций (не только `20260511161000_dialog_system_v3.sql`), со ссылкой на модуль **`assistant`** для актуальной версии. **`MAP.md`** — в точках входа **`assistant`** добавлена миграция **`20260515030000_dialog_system_v3_pack_b.sql`**.

- **2026-05-12:** Для cold-start Supabase сознательно не добавлялся high-frequency keep-warm/ping job. Текущий приоритет зафиксирован как `cache-first + precompute + timeouts`: локальный кэш натала, частичный кэш дня, hourly global precompute, timebox на `global-content` и `fetchProfile`. Если после этого холодные задержки останутся заметными, keep-warm рассматривается как операционная мера поверх уже ускоренного контура, а не как базовая архитектура.

- **2026-05-12:** Контур free precompute для `global_daily_content` доведён до самостоятельного infra-path: `precompute-global-recommendations` теперь поддерживает rolling window `yesterday/today/tomorrow`, а новая SQL-миграция переводит invoke `public.invoke_precompute_global_recommendations()` на ежечасный cron вместо разового полуночного запуска. Параллельно `supabase/config.toml`, `supabase/README.md` и `DEPLOY.md` синхронизированы с этим сценарием как с поддерживаемым серверным контуром.

- **2026-05-11:** Infra-контракт для dialog v3 обновлён: Gemini env сведены к `AI_MODEL_STANDARD`, `AI_MODEL_PREMIUM`, единому `AI_MODEL_FALLBACK` и `MAX_DIALOG_LENGTH`; soft-cap env удалены. В `supabase/migrations` добавлен `20260511161000_dialog_system_v3.sql`, а в `_legacy_web/app/api/_utils/gemini.ts` появился explicit context caching с in-memory TTL map как временным storage cache names между вызовами одного инстанса.
- **2026-05-09:** В **`docs/02_modules/infra/spec.md`** задокументированы серверные переменные **`AI_MODEL_*`** и **`AI_MODEL_*_FALLBACK`** для Gemini на Vercel (реализация в **`_legacy_web/app/api/_utils/gemini.ts`**).

- **2026-05:** Зафиксирована миграция документации модуля `infra` по коду и плану `_proposal.md`. Исторические патчи PATCH_5 (RLS) и PATCH_11 (Whisper) перенесены в `docs/05_archive/migrated/infra/`; содержательные решения ниже сверены с репозиторием, а не с текстом патчей «как ТЗ».

- **Не датировано (реализовано в коде):** Сужение RLS для кешей натала/прогноза и защита содержимого `ai_state_proposals` воплощены миграцией `supabase/migrations/20260429180000_rls_tighten_natal_forecasts_proposals.sql`, что соответствует намерению `PATCH_5_RLS_tightening.md`. Канон — SQL-файл и фактические политики в БД.

- **Не датировано (частичное расхождение с PATCH_11):** Патч требовал отдельный UI confidence & кастомный 16 kHz preset на клиенте. В коде на сервере уже есть `getDomainPrompt`, `normalizeWhisperLanguage`, `temperature: "0"`, `response_format: "verbose_json"` и расчёт `confidence` в `_legacy_web/app/api/_utils/whisperTranscription.ts` с тестами `whisperPrompts.test.ts`. Потребительский UX «редактирование при низкой уверенности» и отдельный `WHISPER_OPTIMIZED_PRESET` в патче как единый эталон **не подтверждены** полнотой по всему `modules/communicator` — детали относятся к будущей миграции `communicator`, не к инфраструктурному минимуму.

- **Не датировано:** В корне есть `sentry.client.config.ts` (`@sentry/react-native`) и зависимость в `package.json`, но поиск по `app/*.tsx` не показывает импорта этого файла в entry. Документ `error_tracking.md` описывает оба контура; до явного подключения в корневом layout инициализация RN-Sentry считается **подготовленной, а не гарантированно активной** в рантайме.

- **Не датировано (док ↔ продукт):** `docs/tech_stack.md` заявляет, что PWA/manifest не являются целевой платформой, при этом `_legacy_web/app/layout.tsx` продолжает отдавать `manifest`, иконки и `appleWebApp`. Это осознанный остаточный web-shell для API и опциональной установки страницы, а не противоречие в коде — приоритет продукта на стороне Expo.

- **Не датировано:** `.vercelignore` исключает `/supabase` из upload при деплое из корня; операции с миграциями выполняются через Supabase CLI локально/в CI, а не через артефакт Vercel — это снижает размер билда и отделяет жизненный цикл БД от Next bundle.
