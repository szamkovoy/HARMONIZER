---
id: 02_modules/onboarding/spec
title: Onboarding Wizard — spec
version: 1.10
updated: 2026-08-20
depends_on: [02_modules/onboarding/dependencies, 02_modules/profile/spec, 02_modules/i18n/spec, 02_modules/astro/spec]
code_refs:
  [
    app/sign-in.tsx,
    app/onboarding.tsx,
    app/_layout.tsx,
    modules/onboarding/index.ts,
    modules/onboarding/wizard/WizardShell.tsx,
    modules/onboarding/wizard/WizardTextInput.tsx,
    modules/onboarding/wizard/LegalDocuments.tsx,
    modules/onboarding/wizard/BirthPlaceMapModal.tsx,
    modules/onboarding/ui/BirthPlacePicker.tsx,
    modules/onboarding/geoSearchClient.ts,
    modules/onboarding/birthDateFormat.ts,
    modules/onboarding/MaskedTextInput.tsx,
    modules/auth/AuthProvider.tsx,
    modules/auth/sign-in-email.ts,
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
- **Клавиатура — два режима:**
  - **A (`footerInContent`)** — welcome шаг 1 и шаг 2: CTA (+ legal) внутри скролла под полями; iOS `KeyboardAvoidingView behavior="padding"` + один `scrollToEnd` на `keyboardWillShow`; Android — `paddingBottom` = высота IME и `scrollToEnd` в `useEffect` после layout (не смешивать с iOS — ломает «прилипание»); `scrollEnabled={false}` пока клавиатура открыта.
  - **B (без `footerInContent`)** — OTP-confirm и шаги 3–7: авто-подъём выключен (`behavior={undefined}`), контент остаётся на месте, клавиатура перекрывает низ, скролл ручной. На OTP это нужно, потому что клавиатура уже открыта с welcome и авто-подъём обрезал бы картинку. `app/sign-in.tsx` передаёт `footerInContent={sub === "welcome"}` и `key={sub}` (сброс scroll offset).
- **Поля ввода:** `WizardTextInput` сам берёт `color` / `border` / `placeholder` из светлой темы `WizardShell` (не из системного dark theme корня) — иначе на Android с тёмной схемой текст и рамка «пропадают» на белом фоне мастера.
- **`WizardImage`** — картинка шага, `resizeMode="contain"`, высота `WIZARD_IMAGE_HEIGHT = 200`; изображения — `assets/onboarding/*_600.jpg` (600×600, кроме `astrology_600.jpg` 943×600). **Прогрев:** при монтировании `app/onboarding.tsx` (шаг 2) все картинки шагов 2–7 рендерятся в скрытом off-screen контейнере (`WizardImagePrefetch`, `opacity:0`, `1×1`), чтобы RN декодировал их в image-cache. Пока пользователь заполняет данные рождения, jpg-и уже в кэше — переход на шаги 3–7 показывает картинку мгновенно, без «мигания» старой. Прогрев идёт только в мастере; на зарегистрированном запуске `app/onboarding.tsx` не монтируется.
- **`WizardTitle`** — Android `fontSize: 21` / `lineHeight: 27`; iOS `20` / `26` (глобальный `screenTitle` = 22), чтобы длинные заголовки (напр. шаг 2) оставались в одну строку на узких iPhone.
- **`contentBumpKey` (режим A):** при смене ключа с открытой клавиатурой — дополнительный `scrollToEnd` (маркер `PLACE_FOCUS_SCROLL_EXTRA` в коде; откатываемый нюдж после появления «Проверить на карте»).

## 4. Шаг 1 — sign-in (`app/sign-in.tsx`)

- Два подшага: `welcome` (имя + email) → `confirm` (6 ячеек OTP).
- `requestEmailOtpCode` (`modules/auth/sign-in-email.ts`):
  1. `POST /api/auth/otp-gate` (App Check token или debug attestation + серверные лимиты) → single-use permit;
  2. RPC `set_signin_name_hint` + `signInWithOtp`;
  3. edge `send-auth-email` потребляет permit и шлёт письмо; для `STORE_REVIEW_EMAIL` (серверный секрет) письмо **не** отправляется (gate/лимиты остаются).
- Пока идёт отправка: CTA `busy` + лейбл `auth.sending` («Отправляется…»), без dim. На mount welcome — `prefetchOtpAppCheck` (прогрев Play Integrity); на критическом пути getToken ≤ ~1.2 с, иначе gate без токена (пока enforce выключен).
- Лимиты отправки (сервер, email): ≥60 с между письмами; ≤10/час; ≤25/сутки. UI cooldown 60 с на welcome и resend (SecureStore; «Изменить email» не обходит).
- `verifyEmailOtpCode`: ≤10 неверных попыток/час на email (RPC `otp_check_verify_allowed` / `otp_record_verify_failure`). Сначала `POST /api/auth/otp-verify`: если email = `STORE_REVIEW_EMAIL` и код = `STORE_REVIEW_OTP` → сервер mint'ит сессию (`generateLink` + `verifyOtp`) и ensure'ит Master/onboarded (`users.store_review_account`; seed рождения/Москва только если `birth_date` пуст — иначе не затирает правки); иначе клиент делает обычный GoTrue `verifyOtp`. Секреты только на Vercel/edge — не в клиенте.
- **Android Restore Credentials (Zero-Tap):** после успешного OTP `AuthProvider` в фоне создаёт restore key (native `harmonizer-android-restore-credentials` + Vercel `/api/auth/restore-credential/register/*`). На новом Android при переносе данных — silent sign-in до экрана OTP (`/api/auth/restore-credential/auth/*`). «Выйти» отзывает ключ. iOS не затронут. Требует новый Android dev/prod client.
- Turnstile/капча **не** используются (RN WebView UX); защита — rate limits + Firebase App Check.
- `LegalFooter` **только** на `welcome`. `footerInContent={sub === "welcome"}`.
- Картинка подтверждения — `assets/onboarding/email_600.jpg`.

## 5. Шаг 2 — данные рождения + гео (`app/onboarding.tsx`)

- **Поля с масками** (общие хелперы в `modules/onboarding/birthDateFormat.ts`, переиспользуются также `NatalBirthDataModal`):
  - Дата: `ДД-ММ-ГГГГ`, `formatDateMask` вставляет `-` автоматически; валидация `ddmmyyyyToIso` (реальная дата). Префилл из БД `YYYY-MM-DD` → `isoToDdmmyyyy`, обратно `ddmmyyyyToIso`.
  - Время: `ЧЧ:ММ`, `formatTimeMask` вставляет `:` автоматически; валидация часов 0-23 / минут 0-59.
  - Лейблы: `onboarding.birth.dateLabel` = «Дата рождения», `onboarding.birth.timeLabel` = «Время рождения (приблизительно) - по местному времени».
  - **`MaskedTextInput`** (`modules/onboarding/MaskedTextInput.tsx`) — **сегментный ввод**: каждый сегмент маски (DD | MM | YYYY для даты, HH | MM для времени) — отдельный `TextInput` с `selectTextOnFocus` (при фокусе выделяется целиком, вводится заново; при заполнении фокус авто-переходит на следующий). Сегменты изолированы — правка одного не сдвигает цифры в другом (баг «правлю месяц → год 968Y» невозможен). Мастер пока остаётся на `format*Mask`; `NatalBirthDataModal` (Профиль) переведён на `MaskedTextInput`.
- **Место рождения** — `BirthPlacePicker` (`modules/onboarding/ui/BirthPlacePicker.tsx`): автодополнение через `searchBirthPlaces` → прокси `GET /api/geo/search` (Vercel) → Open-Meteo Geocoding. Возвращает `GeoPlace { id, name, region, country, lat, lng, timezone }` (IANA-таймзона). Текст поля синхронизируется с `value`, когда родитель передаёт выбранное место после mount (модалка Профиля). Список подсказок — оверлей **над** полем через `WizardOverlayProvider` (`modules/onboarding/wizard/wizardOverlay.tsx`, вне `ScrollView`): rect хоста из `onLayout` корня (не `measure` пустого absolute-слоя — на Android height=0), якорь поля — `measureInWindow`; низ панели к верху поля (`bottom`). **Не** RN `Modal` для списка — на Android снимает фокус / IME. Хост в `WizardShell` и `NatalBirthDataModal`. Abort не → ошибка сети; HTTP 401 → refresh+retry.
- **`BirthPlaceMapModal`** (`modules/onboarding/wizard/BirthPlaceMapModal.tsx`) — `react-native-maps`: интерактивная карта (зум, пан) с фиксированной меткой выбранного места (без изменения координаты), открывается кнопкой «Проверить на карте» после выбора места (а в Профиле — кнопкой «Карта» в блоке «Мои данные» для сверки сохранённого места). На Android нужен `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` → `app.config.ts` → `android.config.googleMaps.apiKey`, зашитый в **native** билд: локально из `.env.local`, на EAS из `eas env` (development/preview/production). Без ключа на этапе prebuild MapView падает с `API key not found`. iOS — Apple Maps без ключа.
- **Геолокация:** системный prompt на шаге 2 (`getOrRequestForegroundLocationPermission`, `userInitiated`). Отказ **не** блокирует переход. GPS не ждём на критическом пути: `acquireAndPersistUserCoordinates` (last-known / current с таймаутом) идёт **фоном** после granted. `users.lat`/`lon` при пустом GPS natal заполняет координатами места рождения; prefetch дня использует те же координаты, чтобы ключ кэша совпал с Home.
- `footerInContent` — «Далее» сразу под полями; страница поднимается с клавиатурой (см. §3). Пока `busy` — лейбл `wizard.nextLoading` («Идёт загрузка…»).
- Сохранение шага 2: `createNatalProfile` и запрос гео-permission **параллельно**. Prefetch стартует сразу после успешного натала (даже пока открыт системный диалог гео). Ошибка permission не откатывает натал. `refreshProfile` не блокирует переход.
- **Ремонтный режим:** если `profile.onboarded_at` уже есть, шаг 2 стартует с предзаполненными полями; вводные шаги 3-7 и прогрев пропускаются.

## 6. Шаги 3-7 — вводные экраны (`INTRO_STEPS`)

`INTRO_STEPS: IntroDef[]` в `app/onboarding.tsx` — массив из 5 элементов `{ image, titleKey, bodyKeys }`. Каждый шаг рендерит **несколько абзацев** через отдельные `<WizardBody>` (тот же `scrollContent.gap: 16`, что у шага 1) — переносы строк автора сохранены как отдельные ключи: `wizard.step{3..7}.{title,body1..bodyN}` в `modules/i18n/catalog/{ru,en,de,fr,it,es,pt,nl}.json` (шаг 3-6 — по 3 абзаца, шаг 7 — 4). Изображения: `psycho_2_600.jpg` (шаг 3), `breath_2_600.jpg` (шаг 5); шаги 4 и 6 — прежние `asanas_600.jpg` / `webinar_600.jpg`. CTA зафиксирован внизу экрана (`footerInContent` выключен). Расширение: добавить/удалить элемент `INTRO_STEPS` + ключи в каталоге → `i18n-sync fill --all`.

## 7. Прогрев дневного контента

- **Старт:** сразу после успешного сохранения натала на шаге 2 (не после GPS) — `fetchDailyForecast({ forceRefresh: true, timeoutMs: ONBOARDING_DAILY_FORECAST_TIMEOUT_MS, responseLocale })`. Обычный load без `forceRefresh` отдаёт только числовой каркас и тексты из кэша крона; у нового пользователя кэш пуст, поэтому нужен `forceRefresh` → сервер вызывает `ensureMorningRecommendation` (один ответ LLM: слоган + короткая + длинная рекомендация). Координаты запроса — место рождения (то, что natal пишет в `users.lat` при ещё пустом GPS). Если пользователь разрешил гео, lat/lon обновятся фоном; Home подхватит тексты через relaxed cache и при необходимости тихо пересчитает окна.
- **Кэш телефона:** `saveDayContentCache` с ключами из `services/dayContentScope.ts` (`dayContentNatalScopeKey` нормализует `birth_time` к канону `HH:MM:SS` — как Postgres при чтении; мастер `12:45` → `12:45:00`, чтобы ключ совпадал с Home).
- **Шаги 3–7:** пользователь читает интро, пока идёт прогрев.
- **После шага 7:** если слоган + короткая рекомендация уже готовы → сразу `finishOnboarding()` (экран «Готовим ваш день» не показываем). Иначе → `step === "warm"` и ждём тот же promise.
- **`finishOnboarding`:** вызывает `forceNextHomeBootstrapSplash()` — первый blocking Home после мастера идёт полной заставкой, не `day_card` поверх недогруженной главной.
- **Таймаут** (`ONBOARDING_DAILY_FORECAST_TIMEOUT_MS` = LLM budget): по истечении всё равно открываем главную (она догрузит тексты в фоне). События: `onboarding_warmup_prefetch_start/result/done/timeout/error`.

## 7.1 Геолокация на шаге 2

На шаге 2 по-прежнему запрашивается foreground-геолокация (системный диалог). Отказ **не** блокирует переход на шаги 3–7: мастер идёт дальше, prefetch дня уже запущен с координатами места рождения. `users.country_code` при отказе **не** заполняется с IP; кабинет возьмёт IP эфемерно, только если это поле пусто. График «Окон возможностей» на главной в этом случае заменяется CTA «Включить геолокацию»; слоган, рекомендация и остальные блоки главной считаются как обычно.

## 8. Legal (`modules/onboarding/wizard/LegalDocuments.tsx`)

`LegalFooter` — кликабельные ссылки «Пользовательское соглашение» / «Политика конфиденциальности» → `LegalDocumentModal`. Проп `tone`: `"consent"` (мастер шаг 1 — префикс «Продолжая…» + genitive link labels) | `"links"` (Профиль — только две ссылки в именительном через `termsTitle`/`privacyTitle`). Модалка: backdrop — абсолютный `Pressable`-ловец за листом, лист — `View` (не `Pressable`, чтобы не ломать скролл), тело в `ScrollView` `flex:1` (скроллится), `contentContainerStyle.paddingTop: 10` над первой строкой; «Закрыть» зафиксирована внизу; закрытие не размонтирует экран под модалкой (скролл Профиля сохраняется). Тексты — `wizard.legal.*` в активной локали приложения.

## 9. Геолокация на главной (не гейт)

`GeoGate` снят (App Store 5.1.1): Home открывается без разрешения. После входа на Home `promptForegroundLocationOnLaunch` (из `useDayContent`; settle ~1.2 s + `AppState=active`, один раз за JS-сессию): если доступ **granted** — GPS acquire; если ОС ещё может спросить (первый запуск / «Спросить в следующий раз» / «Разрешить один раз») — системный диалог; если уже **«Никогда»** — без запроса и без Settings. CTA «Включить геолокацию»: системный диалог (`preferFresh` — не ждёт зависший launch-request); при «Никогда» — `Linking.openSettings()` и флаг `awaitingSettingsGrant`. «Спросить в следующий раз» в Настройках **не** выдаёт доступ — при возврате `promptForegroundLocationAfterSettingsReturn` сразу показывает системный лист (без второго тапа по CTA). «При использовании» → график без листа. Если снова «Никогда» — CTA. «Выйти» сбрасывает in-process флаг авто-prompt. Если доступ есть — график; если нет — `home.opportunityWindows.needLocation` + `enableLocationButton`. Zero-Tap restore не спрашивает гео под сплэшем (раньше `PushRegistrationBridge` успевал вызвать prompt до Home и orphan'ил sheet на Android).

## 10. i18n

Все строки мастера — в `modules/i18n/catalog/*.json` (`wizard.*`, `onboarding.birth.*`, `home.opportunityWindows.needLocation` / `enableLocationButton`). Синхронизация 8 локалей — `scripts/i18n-sync.mjs` (`fill --all` переводит через `AI_MODEL_PREMIUM`, `check` валидирует `en`). Native-имя приложения и reason-строки iOS-разрешений локализуются отдельно через `app.config.ts` `expo.locales` (см. `i18n/spec.md`).

**Терминология геолокации (OS-aligned):** `home.opportunityWindows.needLocation` / `enableLocationButton` используют название функции в Настройках ОС для каждой локали (RU «геопозиция», EN «location», DE «Ortung», FR «localisation», IT «localizzazione», ES «localización», PT «localização», NL «locatie») — чтобы текст приложения совпадал с заголовком строки в Settings → [App]. Раньше использовалось «геолокация» / «geolocalisation» и т.п., что не совпадает с iOS-лейблом.

## 11. Известные ограничения

- **iOS Location settings deep link:** публичный API открывает только страницу настроек приложения (`openSettingsURLString`), не вложенный экран «Геопозиция» (Никогда / Спросить в следующий раз / При использовании). Приватные `prefs:` URL не используем (App Store + ломаются на новых iOS). «Спросить в следующий раз» не является grant: после возврата показываем системный лист.
- **iOS system notification dialog** — серый комментарий под заголовком фиксирован Apple и не редактируется из приложения; pre-permission не вводили (решено использовать стандартный системный диалог).
- `react-native-maps` требует dev-client rebuild (не Expo Go).
- Шаг 1 живёт в `/sign-in` (до авторизации), шаги 2-7 — в `/onboarding`; визуальная непрерывность обеспечивается общим `WizardShell`.
