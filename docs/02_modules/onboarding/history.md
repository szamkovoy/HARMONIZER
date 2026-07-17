---
id: 02_modules/onboarding/history
title: Onboarding Wizard — history
version: 1.0
updated: 2026-07-18
depends_on: [02_modules/onboarding/spec, 02_modules/onboarding/dependencies]
---

# Onboarding Wizard — History

## Decision Log

- **2026-07-18 (создание документации модуля):** Выделен модуль `onboarding` в `docs/02_modules/` (`spec.md`, `dependencies.md`, `history.md`). Ранее мастер документировался разрозненно внутри `profile`/`i18n`; теперь имеет собственное описание маршрутов, `WizardShell`, шагов, масок ввода, гео, прогрева, legal и geo-gate. Зарегистрирован в `docs/00_index/MAP.md`.

- **2026-07-17 (wizard UI/UX polish + copy overhaul):** `WizardShell` принудительно ставит светлую тему + фон `#ffffff` и получил `footerInContent` (CTA + legal внутри `ScrollView` — клавиатура поднимает их на свою высоту; шаги 1-2). Legal-футер оставлен только на шаге 1. Шаг 2: маски `ДД-ММ-ГГГГ` и `ЧЧ:ММ` с авто-вставкой разделителей (`formatDateMask`/`formatTimeMask`/`ddmmyyyyToIso`/`isoToDdmmyyyy`), лейблы обновлены, `BirthPlacePicker` показывает список городов абсолютным оверлеем поверх «Далее». `LegalDocumentModal` переписан (тело скроллится, «Закрыть» зафиксирована). Новые тексты RU для шагов 2-7 (консолидированы в `wizard.stepN.body`), `home.geoGate.*`. 7 локалей переведены через `i18n-sync fill --all` (`AI_MODEL_PREMIUM`). См. `i18n/history.md` (2026-07-17) и `CHANGELOG.md` (158).

- **2026-07-17 (изображения мастера):** Подключены новые JPG `assets/onboarding/*_600.jpg` (600×600, кроме `astrology_600.jpg` 943×600) для шагов 2-7 и экрана подтверждения email (`email_600.jpg`) в `INTRO_STEPS` (`app/onboarding.tsx`) и `EMAIL_ART` (`app/sign-in.tsx`).

- **2026-07-17 (notifications pre-permission — откат):** Был добавлен pre-permission `Alert` перед системным запросом уведомлений (`reminderPrePermission*` в `modules/home/i18n/home.ts`), но по решению продукта откатили к стандартному iOS-системному диалогу (надёжнее, не усложняем). Ключи `reminderPrePermission*` удалены из RU/EN + оверлеев de/fr/it/es/pt/nl; `OpportunityWindows.saveReminder` вернул прямой `requestPermissionsAsync`.

- **2026-07-14 (3-step onboarding):** Авторизация переведена на email-OTP (Supabase `signInWithOtp`/`verifyOtp`); онбординг расширен: данные рождения с автодополнением города (`BirthPlacePicker`, Open-Meteo через `/api/geo/search`) → геолокация → прогрев с префетчем дневного прогноза. См. `profile/history.md` (2026-07-14).
