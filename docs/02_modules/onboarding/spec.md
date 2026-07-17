---
id: 02_modules/onboarding/spec
title: Onboarding Wizard — spec
version: 1.0
updated: 2026-07-18
depends_on: [02_modules/onboarding/dependencies, 02_modules/profile/spec, 02_modules/i18n/spec, 02_modules/astro/spec]
code_refs:
  [
    app/sign-in.tsx,
    app/onboarding.tsx,
    app/_layout.tsx,
    modules/onboarding/index.ts,
    modules/onboarding/wizard/WizardShell.tsx,
    modules/onboarding/wizard/LegalDocuments.tsx,
    modules/onboarding/wizard/BirthPlaceMapModal.tsx,
    modules/onboarding/ui/BirthPlacePicker.tsx,
    modules/onboarding/geoSearchClient.ts,
    modules/auth/AuthProvider.tsx,
    modules/auth/sign-in-email.ts,
    modules/home/ui/GeoGate.tsx,
    services/natalProfileClient.ts,
  ]
---

# Onboarding Wizard

## 1. Назначение

Первый запуск / ремонт: собрать у нового пользователя имя + email (OTP-вход), данные рождения (дата, время, место) и геолокацию, показать вводные экраны методики, и подгрузить («прогреть») дневной прогноз до показа главной. Мастер — единый визуальный шаблон (`WizardShell`) на 7 шагов, легко расширяется добавлением/удалением шагов.

## 2. Маршруты и врата

- **`app/sign-in.tsx`** — шаг 1 (имя + email → OTP-код). Отдельный маршрут `/sign-in`, т.к. до успешного OTP пользователь ещё не авторизован и не может попасть в `(tabs)`.
- **`app/onboarding.tsx`** — шаги 2-7 + экран прогрева (`step === "warm"`).
- **`app/_layout.tsx`** — route guard: если нет сессии → `/sign-in`; если сессия есть, но `profile.birth_date` пустой/неполный → `/onboarding` (ремонтный режим, старт со шага 2); иначе → `(tabs)`.
- **`TOTAL_WIZARD_STEPS = 7`** (`app/onboarding.tsx`): шаг 1 — sign-in, шаг 2 — данные рождения + гео, шаги 3-7 — вводные экраны (`INTRO_STEPS`).

## 3. `WizardShell` — единый шаблон (`modules/onboarding/wizard/WizardShell.tsx`)

- **Принудительная светлая тема:** оборачивает содержимое в `ThemeProvider value={lightTheme}` и ставит фон `#ffffff` (тёмный статус-бар). Все экраны мастера — белые, независимо от системной тёмной темы (новые изображения сохранены на белом фоне).
- **`StepProgress`** — индикатор `currentStep / totalSteps` сверху.
- **`KeyboardAvoidingView`** (`behavior="padding"` на iOS; на Android — `windowSoftInputMode="adjustResize"` в `app.config.ts`) поднимает контент на высоту клавиатуры.
- **`footerInContent?: boolean`** — если `true`, футер (CTA + legal) рендерится **внутри** `ScrollView` и поднимается клавиатурой вместе с контентом (шаги 1 и 2 — поля ввода). Если `false` — футер зафиксирован внизу экрана (шаги 3-7 — вводные экраны без ввода).
- **`WizardImage`** — картинка шага, `resizeMode="contain"`, высота `WIZARD_IMAGE_HEIGHT = 200`; изображения — `assets/onboarding/*_600.jpg` (600×600, кроме `astrology_600.jpg` 943×600).

## 4. Шаг 1 — sign-in (`app/sign-in.tsx`)

- Два подшага: `welcome` (имя + email) → `confirm` (6 ячеек OTP).
- `requestEmailOtpCode(email, displayName?)` (`modules/auth/sign-in-email.ts`): перед `signInWithOtp` вызывает RPC `set_signin_name_hint(p_email, p_name)` — side-channel, чтобы edge-функция `send-auth-email` увидела свежее имя для приветствия (для существующих пользователей `signInWithOtp` не обновляет `user_metadata`; см. `i18n/spec.md` §4.1c).
- `LegalFooter` показывается **только** на подшаге `welcome`. `footerInContent` включён — кнопка «Получить код» и legal-футер поднимаются клавиатурой.
- Картинка подтверждения — `assets/onboarding/email_600.jpg`.

## 5. Шаг 2 — данные рождения + гео (`app/onboarding.tsx`)

- **Поля с масками** (хелперы в `app/onboarding.tsx`):
  - Дата: `ДД-ММ-ГГГГ`, `formatDateMask` вставляет `-` автоматически; валидация `ddmmyyyyToIso` (реальная дата). Префилл из БД `YYYY-MM-DD` → `isoToDdmmyyyy`, обратно `ddmmyyyyToIso`.
  - Время: `ЧЧ:ММ`, `formatTimeMask` вставляет `:` автоматически; валидация часов 0-23 / минут 0-59.
  - Лейблы: `onboarding.birth.dateLabel` = «Дата рождения», `onboarding.birth.timeLabel` = «Время рождения (приблизительно) - по местному времени».
- **Место рождения** — `BirthPlacePicker` (`modules/onboarding/ui/BirthPlacePicker.tsx`): автодополнение через `searchBirthPlaces` → прокси `GET /api/geo/search` (Vercel) → Open-Meteo Geocoding. Возвращает `GeoPlace { id, name, region, country, lat, lng, timezone }` (IANA-таймзона). Выпадающий список — **абсолютный оверлей** (`zIndex: 50`) поверх кнопки «Далее», `placeSpacer` резервирует место.
- **`BirthPlaceMapModal`** (`modules/onboarding/wizard/BirthPlaceMapModal.tsx`) — `react-native-maps`: интерактивная карта (зум, пан) с фиксированной меткой выбранного места (без изменения координаты), открывается кнопкой «Карта» после выбора места.
- **Геолокация:** `expo-location` `requestForegroundPermissionsAsync` + `getCurrentPositionAsync`; пишет `users.{tz,lat,lon,location_name}`. Можно пропустить (`geoDenied`), тогда CTA = «Запросить доступ».
- `footerInContent` включён — «Далее» поднимается клавиатурой.
- Сохранение: `createNatalProfile(birthData, undefined, { placeName })` (`services/natalProfileClient.ts`) → `POST /api/astro/natal`. `birthData.location.timezone` = IANA из `GeoPlace` (критично для исторического UTC, см. `astro/spec.md` §3).
- **Ремонтный режим:** если `profile.birth_date` уже заполнен, шаг 2 стартует с предзаполненными полями; вводные шаги 3-7 и прогрев пропускаются.

## 6. Шаги 3-7 — вводные экраны (`INTRO_STEPS`)

`INTRO_STEPS: IntroDef[]` в `app/onboarding.tsx` — массив из 5 элементов `{ image, titleKey, bodyKeys }`. Тексты — один абзац на шаг: `wizard.step{3..7}.{title,body}` в `modules/i18n/catalog/{ru,en,de,fr,it,es,pt,nl}.json`. CTA зафиксирован внизу (`footerInContent = false`). Расширение: добавить/удалить элемент `INTRO_STEPS` + ключи в каталоге → `i18n-sync fill --all`.

## 7. Прогрев (`step === "warm"`)

После шага 7 стартует `fetchDailyForecast` (префетч дневного прогноза) параллельно с экраном «Готовим ваш день». `WARMUP_TIMEOUT_MS = 90_000`: по таймауту или завершении prefetch → `finishOnboarding()` → переход в `(tabs)`. События `logRuntimeEvent`: `onboarding_warmup_prefetch_start/done/timeout`.

## 8. Legal (`modules/onboarding/wizard/LegalDocuments.tsx`)

`LegalFooter` — кликабельные ссылки «Пользовательское соглашение» / «Политика конфиденциальности» → `LegalDocumentModal`. Модалка: backdrop — абсолютный `Pressable`-ловец за листом, лист — `View` (не `Pressable`, чтобы не ломать скролл), тело в `ScrollView` `flex:1` (скроллится), «Закрыть» зафиксирована внизу. Тексты — `wizard.legal.{termsBody,privacyBody,close,prefix,...}`.

## 9. Geo-gate на главной (`modules/home/ui/GeoGate.tsx`)

Не часть мастера, но связан с шагом 2: если foreground-location permission отсутствует/отозван, Home-вкладка (`app/(tabs)/index.tsx`) показывает `GeoGate` — карточку «Разрешите геолокацию» с кнопками «Разрешить» / «Открыть настройки» (когда `canAskAgain === false`) / «Закрыть приложение» (Android `BackHandler.exitApp()`; iOS — `signOut()` как выход, т.к. iOS не позволяет закрыть приложение программно). Ключи `home.geoGate.*` в каталоге.

## 10. i18n

Все строки мастера — в `modules/i18n/catalog/*.json` (`wizard.*`, `onboarding.birth.*`, `home.geoGate.*`). Синхронизация 8 локалей — `scripts/i18n-sync.mjs` (`fill --all` переводит через `AI_MODEL_PREMIUM`, `check` валидирует `en`). Native-имя приложения и reason-строки iOS-разрешений локализуются отдельно через `app.config.ts` `expo.locales` (см. `i18n/spec.md`).

## 11. Известные ограничения

- **iOS system notification dialog** — серый комментарий под заголовком фиксирован Apple и не редактируется из приложения; pre-permission не вводили (решено использовать стандартный системный диалог).
- `react-native-maps` требует dev-client rebuild (не Expo Go).
- Шаг 1 живёт в `/sign-in` (до авторизации), шаги 2-7 — в `/onboarding`; визуальная непрерывность обеспечивается общим `WizardShell`.
