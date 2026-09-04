---
id: 02_modules/i18n/history
title: i18n History
version: 1.24
updated: 2026-09-05
depends_on: [02_modules/i18n/spec, 04_workspace/i18n_architecture]
code_refs:
  [
    modules/i18n/localeStore.ts,
    modules/i18n/t.ts,
    modules/i18n/appDisplayName.ts,
    modules/home/i18n/home.ts,
    modules/day/i18n/day.ts,
    _legacy_web/app/api/_utils/dialogLocale.ts,
    scripts/i18n-sync.mjs,
  ]
---

## Decision Log

- **2026-09-05 (locale sync + hydrate order):** `syncUserLocaleToServer` больше не зовёт `auth.getSession()` (на Android cold start часто пустой/висит → `users.locale` отстаёт, midnight cron греет не тот язык). Bearer — `getSupabaseAccessSession`. `AuthProvider` гидратит locale до Home fetch.

- **2026-09-04 (dialog scaffold `summaryAlreadyComplete`):** RU source «Все неподытоженные действия уже подытожены.» + 7 locales via `i18n-sync fill --all` (`AI_MODEL_PREMIUM`). Used by summarizing terminal when `daySummaryRequested` and `dueEvents` are empty (`dialog/route.ts`).

- **2026-08-28 (Home/Day clock 24h except EN):** `getHomeStrings.formatTime` больше не передаёт `inlineBaseLocale(locale)` в `Intl` (из‑за этого DE/FR/… получали английский 12‑часовой циферблат с AM/PM на «Окнах возможностей»). Теперь — `intlLocaleTag(locale)` + `hour12: locale === "en"` (EN: 9:06 PM; RU/DE/FR/IT/ES/PT/NL: 21:06). Та же политика в `getDayStrings.formatTime`. Регрессия: `modules/home/i18n/home-format-time.test.ts`.

- **2026-08-26 (OTP post-verify guide hint):** В auth-email шаблоны добавлен ключ `postVerifyGuide` — после строки «Если вы не запрашивали код…» напоминание проверить почту через минуту после подтверждения OTP (придёт инструкция к приложению). RU source + 7 локалей через `i18n-sync fill --all` (`AI_MODEL_PREMIUM`); `templates.ts` перегенерирован; `send-auth-email/index.ts` — отдельный абзац в text/HTML между `ignore` и `closing`. Edge redeploy required; app rebuild not required.

- **2026-08-24 (runtime app-display-name mirror):** Добавлен `modules/i18n/appDisplayName.ts` — runtime-зеркало build-time `APP_NAMES` из `plugins/appLocalesData.js` (`APP_DISPLAY_NAMES` + `getAppDisplayName(locale)`, реэкспорт из `@/modules/i18n`). Причина: media-notification / lock-screen карточка практики (модуль `audio`, `MandalaSoundProvider`) показывает `artist` = имя приложения; раньше был захардкожен `"Harmonizer"` (латиница) и не следовал за profile-локалью. Теперь `artist` = `getAppDisplayName(useAppLocale().locale)` — RU «Гармонизатор», EN «Harmonizer» … — совпадает с языком профиля (а не устройства, как home-screen имя). OS home-screen имя по-прежнему следует за device-локалью (platform limitation) — это намеренное расхождение. При добавлении языка обновлять ОБА файла (см. spec §6).

- **2026-08-19 (location optional CTA):** `home.opportunityWindows.needLocation` / `enableLocationButton` ×8 (RU source; EN + EU filled). Home geo-gate copy `home.geoGate.*` unused in UI.

- **2026-08-11 (book keys):** Каталог — `book.profile.*`, `book.reader.*`, `gate.body.book` (RU → `i18n-sync fill --all`).

- **2026-08-04 (OTP slim):** Removed guideTitle/guide1–5 from auth-email templates + HTML accent block; short transactional OTP only. `Auto-Submitted: auto-generated`. SES OTP uses `SES_OTP_CONFIGURATION_SET` (not marketing set).

- **2026-08-02 (practices tempoLabel):** `tempoLabel` («Темп:» / «Tempo:» + EU overlays) for breath tempo ComboBox header on practice cards.

- **2026-07-31 (profile about / app name):** Каталог — `common.appName` (канон = `APP_NAMES` из `plugins/appLocalesData.js`) и `profile.about.copyrightHolder` (RU: `ТОО "Сергей Замковой"`, остальные: `Sergei Zamkovoi, TOO`).

- **2026-07-31 (practices breathHelpBody):** Два новых абзаца в справке дыхательных практик (наушники / скорость индикатора); RU/EN в `practices.ts`, overlays de–nl через `fill --all`.

- **2026-07-29 (profile.subtitle):** RU source → «Здесь находится информация о вас и ряд полезных отчетов»; fill на 8 локалей.

- **2026-07-29 (home birth CTA):** Хардкод «Введите дату рождения» / DevTier «из профиля» на EN UI → `enterBirthDataButton` в `getHomeStrings` + EN «from profile» в DevTierSwitch.

- **2026-07-24 (hydrate same-account):** `hydrateAppLocale(profileLocale, userId)` — при смене аккаунта по-прежнему берёт `users.locale`; на том же аккаунте не откатывает UI на отстающую БД, а пишет UI → `users.locale` (push = inbox). См. notifications/history (exact locale send).

- **2026-07-24 (device locale RU-cluster + EN default):** First-launch без SecureStore/`users.locale`: (1) первый из 8 supported в ordered `getLocales()`; (2) иначе be/uk/kk/ky/uz/tg → `ru`; (3) иначе `en`. Чистый `resolveDeviceAppLocale` + vitest. Возврат/обновление — по-прежнему stored/profile. См. CHANGELOG (266).

- **2026-07-23 (OTP transport → Resend, SES as switchable tail):** OTP again via Resend (`AUTH_EMAIL_PROVIDER=resend`, channel `auth_otp` / `RESEND_ZAMKOVOI_YOGA_API_KEY`); Amazon SES code kept under `mail/providers/ses.ts` for one-secret switchback. Templates/locale side-channel unchanged. Ops DNS inventory: `docs/04_workspace/email_providers.md`.

- **2026-07-23 (account locale over sticky SecureStore):** После логина другого пользователя устройство могло оставить язык предыдущего аккаунта (`harmonizer.locale.v1`) и затереть `users.locale` write-back’ом. `hydrateAppLocale` теперь предпочитает `profile.locale` и при смене аккаунта вызывает `setAppLocale`. Симптом QA: Pavel Master на Pixel открывал день на FR после Егора.

- **2026-07-20 (OTP email — live UI locale via side-channel):** Returning user with `users.locale=ru` and Russian wizard still got a Portuguese OTP email. Root cause: same GoTrue limitation as the name bug — `signInWithOtp({ data: { locale } })` is ignored for existing users, and `send-auth-email` keyed templates only on stale `user_metadata.locale` from first registration. Fix: `signin_name_hints.locale` + RPC `set_signin_name_hint(..., p_locale)`; client writes `getResponseLocale()` with the name; edge prefers hint.locale → metadata → ru; after verify, `updateUser({ data: { locale } })` heals metadata. Migration `20260720095058` applied; edge redeployed. Spec §4.1c.

- **2026-07-18 (notifications pre-permission — reverted):** Откатил введённый 2026-07-17 pre-permission `Alert` перед системным запросом уведомлений: по решению продукта стандартный iOS-системный диалог достаточен и надёжнее (не усложняем). Удалены ключи `reminderPrePermissionTitle/Message/Allow/Cancel` из `modules/home/i18n/home.ts` (RU+EN inline) и оверлеев `modules/i18n/typed/catalog/home/{de,fr,it,es,pt,nl}.json`; `OpportunityWindows.saveReminder` (`modules/home/ui/OpportunityWindows.tsx`) вернул прямой `requestPermissionsAsync` (функция `scheduleReminderNotification` инлайнена обратно в `saveReminder`). `i18n-sync check` зелёный.

- **2026-07-17 (wizard UI/UX polish + copy overhaul):** (1) `WizardShell` (`modules/onboarding/wizard/WizardShell.tsx`) now forces a pure-white light-theme surface (`#ffffff`, dark status-bar content) regardless of system theme, and gains a `footerInContent` prop — when true the footer (CTA + `LegalFooter`) renders inside the `ScrollView` so the software keyboard lifts it by its own height (used on steps 1 & 2); the legal footer is now shown only on step 1 (`app/sign-in.tsx`, removed from `app/onboarding.tsx`). (2) Step 2 birth data: masked `DD-MM-YYYY` date and `ЧЧ:ММ` time inputs with auto-advancing separators (helpers `formatDateMask`/`formatTimeMask`/`ddmmyyyyToIso`/`isoToDdmmyyyy` in `app/onboarding.tsx`; prefill converts `YYYY-MM-DD`↔`DD-MM-YYYY`); fields relabelled (`onboarding.birth.dateLabel` = «Дата рождения», `onboarding.birth.timeLabel` = «Время рождения (приблизительно) - по местному времени»); new `BirthPlacePicker` (`modules/onboarding/ui/BirthPlacePicker.tsx`) shows the city suggestions as an absolute overlay (`zIndex: 50`) over the «Далее» button so the list is never hidden by the button or the keyboard; a `placeSpacer` reserves room below the field. (3) `LegalDocumentModal` (`modules/onboarding/wizard/LegalDocuments.tsx`) rewritten: backdrop is an absolute `Pressable` catcher behind a plain `View` sheet (no `Pressable` wrapping the `ScrollView`), body `ScrollView` `flex:1` scrolls, «Закрыть» button fixed at the bottom — fixes the «glued» non-scrolling text. (4) Copy: new RU text for `wizard.step2.body` and steps 3-7 bodies (consolidated from `body1`/`body2` to a single `wizard.stepN.body` key per step; `INTRO_STEPS` in `app/onboarding.tsx` updated); `home.geoGate.title`/`message` updated. 7 target locales translated via `node scripts/i18n-sync.mjs fill --all` (premium model, `AI_MODEL_PREMIUM`); `i18n-sync check` green. See `CHANGELOG.md` (158).
- **2026-07-17 (OTP email — fresh name via side-channel):** The named greeting
  showed a stale DB name for returning users because `signInWithOtp` does not
  update `user_metadata` for existing users (only on creation) — the hook saw the
  old `user_metadata.full_name`, not the name just typed on wizard step 1. Added a
  side-channel: new table `public.signin_name_hints(email PK, name, updated_at)`
  + anon-callable RPC `set_signin_name_hint` (security definer, validated;
  migration `20260717130000`, applied to remote). `modules/auth/sign-in-email.ts`
  now upserts the freshly-typed name by email right before `signInWithOtp`
  (best-effort, non-blocking). `send-auth-email/index.ts` reads the hint by
  `user.email` via the Supabase REST API with `SUPABASE_SERVICE_ROLE_KEY`
  (bypasses RLS); priority hint → `user_metadata.full_name` → generic `greeting`.
  `services/supabase-types.ts` adds the `set_signin_name_hint` RPC type. Edge
  function redeployed (v25). Spec §4.1c updated.

- **2026-07-17 (OTP email — HTML redesign + named greeting):** Replaced the
  minimal `<p>`-only HTML body with a structured inline-CSS layout reproducing
  the approved mockup: max-width 600 container, system font-stack, sage-green
  (`#436558`) large letter-spaced OTP code, tight disclaimer block, a guide
  block with a left accent border (`#7da192`) and tightly packed numbered items,
  and a tight signature. **No external resources** — the mockup's Tailwind Play
  CDN `<script>` and Google Fonts `<link>` were deliberately dropped because
  email clients strip `<script>` and most strip `<link>`, which would have
  rendered the email unstyled. Added a per-locale `greetingName` template with a
  `{name}` placeholder (locale-appropriate punctuation: RU `Здравствуйте, {name}!`,
  FR `Bonjour {name} !`, ES `¡Hola, {name}!`, etc.); `renderEmail` now also
  receives `user.user_metadata.full_name` (collected on wizard step 1) and
  falls back to the generic `greeting` when no name is present. `templates.ts`
  interface + all 8 JSON sources + `.sync-meta.json` updated; `i18n-sync check`
  green. Spec §4.1c updated.

- **2026-07-17 (OTP email — placeholders removed):** Removed the `{app}`/`{cta}`
  runtime substitution from `send-auth-email`. The app name and the «Что делать?»
  button label are now baked directly into each locale's template text (the
  email is fully in one language, so there is no mismatch risk). The CTA in each
  template was verified to match exactly `recommendation.discussButton` in
  `modules/home/i18n/home.ts`. `APP_NAMES`/`CTA_LABELS` maps deleted from
  `index.ts`; `renderEmail` now only substitutes `{code}`. All 8 JSON templates +
  `templates.ts` regenerated; `.sync-meta.json` updated to the baked RU source so
  `i18n-sync check` stays green. Edge function redeployed (v24). Spec §4.1c updated.

- **2026-07-17 (OTP email overhaul — sender + body + footer):** Rewrote the
  `send-auth-email` templates for all 8 locales. (1) **Sender/From name** changed
  from the localized app name to a person: RU «Сергей Замковой», all other
  locales «Sergei Zamkovoi» (`SENDER_NAMES` map in `send-auth-email/index.ts`;
  override via `MAIL_FROM_NAME`). The same name is used for the body signature.
  (2) **Footer removed** — the «Гармонизатор · zamkovoi.yoga» line is gone.
  (3) **Body restructured:** intro now wraps the app name in quotes; a 5-step
  quick user guide (`guideTitle` + `guide1..guide5`) and a personal closing
  (`closing` + signature) were added. App name and the «Что делать?» button are
  injected via `{app}` / `{cta}` placeholders (substituted at render from
  `APP_NAMES` / `CTA_LABELS`), so they always match the email language. RU
  authored by hand; 7 targets translated via `i18n-sync fill --all` (premium
  model); `templates.ts` regenerated and verified byte-equal to the JSON
  sources. Edge function redeployed (v23). Spec §4.1c updated.

- **2026-07-17 (home geo-gate catalog):** Added `home.geoGate.*` catalog keys
  (`title`, `message`, `grantButton`, `openSettings`, `closeApp`) for the new
  hard geo-gate on the Home tab (`modules/home/ui/GeoGate.tsx`, mounted in
  `app/(tabs)/index.tsx`). When foreground-location permission is missing/revoked
  the Home tab is replaced by an explanatory card with «Allow location»,
  «Open settings» (shown only when `canAskAgain === false`), and «Close app»
  (Android `BackHandler.exitApp()`; iOS signs out as the escape hatch since Apple
  forbids programmatic exit). RU/EN authored by hand; 6 other locales filled via
  `i18n-sync fill --all` (premium model). `check` green.

- **2026-07-17 (native brand + device locale + OTP email name):** (1) `localeStore.deviceLocale()`
  now reads the OS **ordered** preferred-languages list via `expo-localization`
  `getLocales()` (first enabled match; handles unsupported primary with supported
  secondary, e.g. `zh`→`en`, `kk`→`ru`). Terminal fallback changed to **English**
  (`DEVICE_LOCALE_FALLBACK = "en"`); `ru` stays the ultimate last resort via
  `DEFAULT_APP_LOCALE`. Replaces the single-locale `Intl.DateTimeFormat` probe.
  (2) Localized **app display name** under the icon + in iOS system dialogs and
  **iOS permission reason strings** (`NSCameraUsageDescription` etc.) for all 8
  locales, via `app.config.ts` `expo.locales` (map in `plugins/appLocalesData.js`) →
  iOS `<lang>.lproj/InfoPlist.strings` + `CFBundleLocalizations` in `Info.plist`,
  Android `res/values-<lang>/strings.xml` (`app_name`). Brand: RU «Гармонизатор»,
  DE «Harmonisierer», …; base fallback `Harmonizer`. (3) OTP email subject/intro/
  footer + `From` display name now use the locale's app name (edge function
  `send-auth-email` `APP_NAMES[locale]`), matching the native name for the same
  language. `i18n-sync` auth-email meta updated; `check` green. Spec §2.1, §4.1c, new
  §4.1d; dependencies external libs updated.

- **2026-07-14 (external payments):** Новый flat-source в sync gate — шаблоны auth-писем `supabase/functions/send-auth-email/templates/*.json` (тег `auth-email`; `runFlatSourceCheck/Fill` обобщили прежние dialog-scaffold функции). В UI-каталог добавлены блоки `auth.*` (email-OTP вход), `onboarding.*` (данные рождения/гео/прогрев), `gate.*` (комплаенс-тексты точек гейтинга, trial, смена уровня); удалены `upgrade.*` и `webinars.registerPaidCta`; `tier.*` переименованы (Навигатор/Наставник/Мастер). Строки экрана входа переехали из удалённого `modules/auth/i18n/authScreens.ts` в каталог.

- **2026-07-14 (locale sync):** hydrate/setAppLocale always write-back to `users.locale` (heals SecureStore vs DB drift that broke push language).

- **2026-07-14 (exact):** `pickExactLocalized*` for Videos/Webinars; soft `pickLocalized*` kept for notifications only.

- **2026-07-14:** `pickLocalizedText` / `pickLocalizedUrl` — preferred → en → ru → first non-empty in `ALL_CONTENT_LOCALES`. Used by posts, webinars, notifications.

- **2026-07-13 (relative abbr):** `formatRelativeTime` uses short units (`мин`/`min`/`ч`/`h`/…) — one dominant unit, no plural declension.

- **2026-07-13 (relative time):** Added `formatRelativeTime` + catalog `time.relative.*` (all 8 locales). Comments and notifications no longer use Luxon `toRelative()` (Hermes lacks RelativeTimeFormat → always English).

- **2026-07-13 (active free locales):** Cron/ensure pretranslate for `global_daily_content.text_i18n` uses `listActiveTargetLocales` (distinct `users.locale`), not all seven TARGET_LOCALES by default; missing locale still backfills on-demand.

- **2026-07-13 (2):** Profile language rebuild strings (`profile.language.rebuild*`) in catalog for all 8 locales; locale switch probes day-content readiness before commit.

- **2026-07-13:** Убран `key={locale}` с `<Tabs>` в `app/(tabs)/_layout.tsx` — смена языка больше не remount-ит табы (скролл профиля у комбо-бокса языка сохраняется); подписи вкладок обновляются через `t("tabs.*")` на ререндере.

- **2026-07-12:** Typed `day` module: help strings for Day-tab psycho/yoga blocks (`actionsHelp*` / `yogaHelp*`) in RU/EN + de–nl overlays.

- **2026-07-10 (2):** Tab bar: `tabs.home` → «Навигатор» / Navigator / … во всех 8 локалях; иконки вкладок (`assets/icons/{navigator,day,practices,publications,profile}.png`) через `TabBarIcon`.

- **2026-07-10:** Home typed module: `opportunityWindows` templates (`paidIntroTemplate`, `*DetailTemplate`, `help.*`) + inline `planetLabels` for de/fr/it/es/pt/nl overlays; helpers rebound in `getHomeStrings` after merge so non-RU locales no longer fall back to EN function bodies for sunrise/culmination/aspect/help text.

- **2026-07-01:** Breath prep/results copy gained `sessionPreparationLabel` («Подготовка» / «Preparation») for the BLE activation screen while the strap reaches its first live pulse.

- **2026-06-30 (2):** Breath results copy gained two more chart labels across all 8 locales: when pulse guidance diverges from the real live sensor, the results modal can now name those series explicitly as `Pulse (measured)` and `Pulse (guidance)` instead of showing one ambiguous pulse chart.

- **2026-06-30:** Breath results copy gained two more result-state branches across all 8 locales: camera guidance-only sessions now explain that biometric interpretation requires a BLE RR sensor, and BLE results without reliable biometrics explain why the interpretation CTA is absent instead of showing a dead-end button.

- **2026-06-29:** Breath camera-signal overlays stopped talking about paused biometrics in production camera mode. The existing `ppgFingerLostMessage` / `ppgBiometryPausedMessage` keys were reworded across all 8 locales to describe pulse loss / unstable signal only, matching the new camera guidance-only product behavior.

- **2026-06-29 (2):** Camera breathing copy was simplified further: the runtime now effectively uses one soft reminder string (`ppgFingerLostMessage`) for production camera practice, and that text was rewritten across all 8 locales to prompt the user to hold a finger steadily on the camera instead of describing internal sensor states.

- **2026-06-29 (3):** The camera reminder copy was tuned once more in all 8 locales: the message now explicitly says that the breathing pattern should precisely match the user's pulse, matching the final guidance-only positioning of camera mode.

- **2026-06-29 (4):** Breath results strings were repurposed from the dead `Discuss` handoff to a local `Interpretation` flow. RU/EN typed source plus de/fr/it/es/pt/nl overlays now include the renamed button and loading/error/retry states for the inline STANDARD-model interpretation in the results modal.

- **2026-07-05:** Серверные layer-C / STT fallback'и приведены к i18n-инварианту (русский — конечный fallback). Раньше `_legacy_web/app/api/_utils/whisperPrompts.ts` и `authorVoice.ts` для неизвестной/отсутствующей локали fallback'али на English / авто-детект, что противоречило `resolveResponseLocale` (оканчивается на `ru`) и ломало 3 теста. Что изменилось: `getDomainPrompt(language?)` — неизвестная/отсутствующая → RU-промпт (поддерживаемые европейские `de/fr/it/es/pt/nl` без dedicated-промпта → мультиязычный `AUTO_DETECT_DOMAIN_PROMPT`, как раньше); `normalizeWhisperLanguage(language?)` — сигнатура `string | undefined` → `string`, неизвестная/отсутствующая → `"ru"`; `getAuthorVoice(language?)` — `ru`→RU, `en`→EN, `de/fr/it/es/pt/nl`→EN-каденс, неизвестная/отсутствующая → RU (ранее → EN). Тесты расширены кросс-локальными регрессиями (de/fr/it/es/pt/nl + zh-CN/пустая), 19/19 green.

- **2026-06-29:** Breath typed strings gained explicit camera guidance-only copy across RU/EN plus typed de/fr/it/es/pt/nl overlays. The breath runtime can now explain in every supported locale that phone camera mode gives pulse-guided breathing, while advanced HRV/coherence/RSA metrics require a compatible BLE heart-rate sensor.

- **2026-06-27:** Practices/Breath typed strings now cover BLE pulse-source selection and chest-strap activation copy in the breathing flow. The implementation intentionally relies on the existing typed EN-base fallback for locales whose dedicated overlays were not expanded yet, so the UI stays coherent across all 8 locales while device-specific wording is still being refined.

- **2026-06-26:** Free astrology localization hardening. `mathLevelI18n.ts` / `mathLevelI18nTargets.ts` now localize deterministic free-math labels all the way down to planets, zodiac signs, aspects, `orb`, `gravity`, and tone names across RU/EN/DE/FR/IT/ES/PT/NL, while `ModalAstroChart` reads zodiac sign names from `home.ts` typed strings instead of hardcoded English. `fetchGlobalContent` direct DB fallback mirrors the same locale behavior by rebuilding transit-only `math_level.markdown` from the structured payload and normalizing legacy chakra proper names to numeric labels in visible text.

- **2026-06-23:** Home typed overlays **`planetLabels`** теперь также питают подпись в центре **`ChakraFlower`** (вместо charts `strengthLabel`).

- **2026-06-23:** Day tab section titles: `actionsTitle` → «Психо-практики» / Psycho-practices (+ de/fr/it/es/pt/nl overlays); `yogaTitle` → «Йога-практики» / Yoga-practices.
- **2026-06-22:** Home typed overlays (de/fr/it/es/pt/nl): **`planetLabels`** (Sun→Saturn) for `ChakraFlower` legend; **`chakraFlower.caption`** split into **`captionFree`** / **`captionPersonal`** (title «Архетипы дня» / locale equivalents).

- **2026-06-21:** Typed-module gate: registered **`charts`** (`modules/charts/i18n/charts.ts`, overlays `typed/catalog/charts/*`) for DonutChart center label `balanceLabel` across 8 locales.

- **2026-06-18 (2):** **Test-mode locale routing inverted on purpose.** `EXPO_PUBLIC_I18N_TEST_MODE` no longer means "RU speech + selected-language reply". Instead, voice turns in test mode omit the STT language hint, Whisper auto-detects the spoken language, and `Communicator` routes that turn's reply to the detected supported locale; outside test mode the assistant reply stays fixed to the selected/profile locale, and `getTranscribeLocale()` again defaults to the active locale. Low-confidence transcript review preserves the detected locale only in test mode. Profile language note updated across all 8 UI catalogs.

- **2026-06-18:** **Global-content serve path (non-blocking i18n).** `POST /api/ai/global-content` no longer awaits `ensureGlobalTextI18nPrecomputed` on cache hit when `text_i18n[locale]` is missing — responds immediately with RU fallback (`pickGlobalTexts`) and schedules single-locale `backfillGlobalTextI18n` in the background. Client `fetchGlobalContent` SDK fallback enabled for all locales (was ru-only). Fixes persistent Home timeout card for FR/DE/etc. users on free tier.

- **2026-06-16 (6):** **Voice auto-detect + non-RU function strings.** Outside
  `EXPO_PUBLIC_I18N_TEST_MODE`, communicator voice turns no longer force STT to the
  selected app locale: `/transcribe` may omit `language`, Whisper auto-detects the
  spoken language, and `Communicator` sends that detected locale as per-turn
  `inputLocale` + `responseLocale` without changing the app/profile locale. The
  pending-transcript review path preserves that detected locale on resend. Also
  fixed function-valued communicator strings (`transcriptionReviewHint`,
  `typingStatus`) so FR/DE/… no longer fall back to Russian inline TS copy.
 
- **2026-06-16 (5):** **i18n test mode dialog fix.** Client sends `inputLocale`
  (`getTranscribeLocale()`) alongside `responseLocale`; server adds a preamble note
  when input language differs from reply language so the model does not mirror Russian
  speech in French UI. `Communicator` passes both locales explicitly from `useAppLocale()`.

- **2026-06-16 (4):** **Practices catalog i18n gaps.** Typed extractor now handles
  hyphenated keys (`nadi-shodhana`) and multiline string values — `breathDescriptions`,
  `practiceName`, etc. were missing from overlays (EN fallback on IT/DE/NL). Added
  syncable `practiceCountOne` / `practiceCountWithTotal` / `catalogFooterTemplate`;
  `chakraTagLabel` uses chakra typed overlays for non-RU/EN; practice group tabs widened.

- **2026-06-16 (3):** **Home recommendation buttons + astro chart i18n.** Typed extractor
  skipped strings after arrow-function bodies (`recommendation.discussButton` landed at
  root in overlays → EN fallback on DE/FR). Fixed `fnBodyDepth` in `extractStringTree`;
  added `astroChartModal` to `home.ts` (natal/transit chart was hardcoded RU in
  `ModalAstroChart.tsx`). Refilled catalog + home typed overlays for all targets.

- **2026-06-16 (2):** **Startup overlay + typed overlay merge.** `AppStartupProvider`
  dropped inline RU/EN `STEP_COPY`; footer strings live in the JSON catalog
  (`startup.step.*`, `startup.fallback`) and follow `useAppLocale()`. Typed overlays:
  `mergeTypedLocale` applies string leaves by flat dotted path (not nested deep-merge);
  `deepMergeTyped` deprecated. Gate: new `rebuild-typed-overlays` command; extractor
  fix in `scripts/lib/i18n-typed.mjs`.

- **2026-06-16:** **Locale plumbing fix (8-language UI).** Root cause of mixed RU/EN/IT:
  `getHomeStrings(appLocale === "en" ? "en" : "ru")` and siblings forced Russian for
  de/fr/it/es/pt/nl; `t.ts` only loaded ru/en catalogs (tabs fell back to English).
  Fixed: pass full `appLocale`, `inlineBaseLocale()` for typed bases, all 8 catalog
  imports, nested chakra overlay flatten, life-sphere titles map, localized
  `UpgradeDialog`, `mathLevelI18nTargets` for server math markdown.

- **2026-06-15 (3):** **Layer C RU-first sync gate.** Dialog scaffold
  (`_legacy_web/data/dialog_scaffold/ru.json`) joins `i18n-sync.mjs` / pre-push
  hook: edit RU → stale keys auto-translate to en + de/fr/it/es/pt/nl.
  `.sync-meta.json` tracks source snapshots; `bootstrap-dialog-scaffold-meta` for
  one-time bootstrap. `dialog-scaffold-fill.mjs` deprecated (delegates to
  `fill --all`).

- **2026-06-15 (2):** **Phase 3 layer C — dialog scaffold for all 8 locales.**
  `_legacy_web/data/dialog_scaffold/{ru,en,de,…}.json` + `getDialogScaffoldStrings()`;
  `resolveDialogScaffoldLocale` returns full content locale (no EN fallback).
  Planning/summary/post-dialog/greeting deterministic strings localized.

- **2026-06-15:** **All 8 locales enabled in Profile; home locale refresh fix.**
  Bulk `node scripts/i18n-sync.mjs fill --all` — JSON catalog + typed overlays for
  de/fr/it/es/pt/nl; `APP_LOCALE_OPTIONS[*].enabled = true`. Server:
  `outputLanguagePrompt.ts` prepends OUTPUT LANGUAGE block to
  `morning_recommendation` monologue; `scenario_cache` rows store `outputLocale`
  and invalidate pre-i18n payloads. Client: `useDayContent` subscribes to locale
  changes, scopes day-cache by locale, strips stale LLM texts, guards secondary
  monologue against race overwrites; `DailyRecommendationCard` shows loading state
  instead of EN fallback template.

- **2026-06-14 (6):** **Locale switch + global-content serve path.** `useDayContent`
  owns locale-change refresh via `subscribeAppLocale` (Home no longer duplicates the
  effect). Free-tier serve: on-demand row `text_i18n` precompute in
  `global-content/route.ts` when cache miss; client SDK fallback restricted to `ru`.
  Gate `fill`: DeepSeek env fallback (`DEEPSEEK_API_KEY`, `AI_MODEL_PREMIUM/STANDARD`).

- **2026-06-14 (5):** **Phase 2 completion — locale persistence, 8-locale layer B,
  typed sync gate, global pre-translate.** (1) `setAppLocale` mirrors to
  `users.locale` via `services/userLocaleClient.ts`. (2) Server split:
  `contentLocales.ts` — `resolveContentLocale` (8 locales, layer B) vs
  `resolveDialogScaffoldLocale` (ru/en, layer C). (3) Free-tier global content:
  migration `text_i18n` on `global_daily_content`; `pretranslateGlobalTexts` +
  cron precompute for en/de/fr/it/es/pt/nl; serve path reads `text_i18n` first.
  (4) Typed-module sync gate: `manifest.json`, overlay JSONs for de–nl,
  `mergeTypedLocale` wired into get*Strings modules; `fill --all` updates catalog +
  typed overlays. (5) `life-spheres/labels.ts` accepts all 8 locale codes (EN
  fallback for non-ru). Spec §3–§8 and dependencies updated.

- **2026-06-14 (4):** **UI sweep + layer B locale plumbing.** Typed modules extended
  (Day, Practices, chakra labels, life-spheres, home math modal, free-tier banner).
  Profile report titles normalized to sentence case; chakra legend labels unified via
  `chakraShortLabelDisplay`. Server: `responseLocale` on `ai/monologue` and
  `ai/global-content`; morning-recommendation cache keyed by locale; EN global texts
  translated on demand (`globalContentLocale.ts`); math markdown RU/EN in
  `mathLevelBuilder` / `buildGlobalMathLevel`. Client: day-content cache scope
  includes locale; Home refreshes LLM content on locale change. Spec §8 updated with
  layer inventory and new-language checklist.

- **2026-06-14 (3):** **Module documented + finite Phase-2 wiring completed.**
  Created this triad (`spec`/`dependencies`/`history`) and registered i18n in
  `MAP.md` (Engines & Services). Added a `.cursor/rules/i18n.mdc` always-on rule so
  i18n is treated as a system invariant in every task. Wiring: Home
  (`index.tsx`), Profile (chrome migrated to the JSON catalog + report cards) and
  the Day/Breath assistant entry points now follow the **shared locale store**
  instead of `profile.locale`/hardcoded `"ru"`, so the Profile language selector
  switches the whole app for RU/EN. Documented the two-tier string strategy (JSON
  catalog for new strings; keep typed `get*Strings` modules) and the precise
  not-yet-migrated tail (startup overlay; dev diagnostics).

- **2026-06-14 (2):** **Phase 2 framework + plumbing (option A).** New client layer
  `modules/i18n/`: `localeStore.ts` (single source of truth, persisted, sync getters
  for services, `APP_LOCALE_OPTIONS` with `enabled` flag, `I18N_TEST_MODE`), `t.ts`
  (`t`/`tCount` with `Intl.PluralRules`; JSON catalogs `catalog/{ru,en}.json`), hooks
  `useAppLocale`/`useTranslate`. Profile gained a language selector. `resolveResponseLocale`
  gained a `requestedLocale` arg; the dialog POST now carries `responseLocale`
  (`getResponseLocale()`), transcription uses `getTranscribeLocale()` (RU in test
  mode). Sync gate `scripts/i18n-sync.mjs` (`check`/`fill`, diff-based, `.sync-meta.json`)
  + pre-push `scripts/i18n-sync.sh`. +6 tests `modules/i18n/t.test.ts`, +2
  `dialogLocale.test.ts`. Rationale & A-vs-B decision: `docs/04_workspace/i18n_architecture.md`.

- **2026-06-14 (1):** **Phase 1 response-locale foundation.** `_utils/dialogLocale.ts`
  (`resolveResponseLocale` + `localeToLanguageName`) split input language (STT) from
  the assistant's reply language; `DIALOG_RESPONSE_LOCALE` env test override (RU in →
  EN out). Threaded through `dialog/route.ts` and `greeting/route.ts`. Zero regression
  when unset. RU/EN only; other languages deferred to Phase 3 (layer-C localization).
