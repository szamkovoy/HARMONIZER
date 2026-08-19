---
id: 02_modules/onboarding/history
title: Onboarding Wizard — history
version: 1.7
updated: 2026-08-20
depends_on: [02_modules/onboarding/spec, 02_modules/onboarding/dependencies]
---

# Onboarding Wizard — History

## Decision Log

- **2026-08-20 (warmup vs GPS):** Шаг 2 больше не ждёт `getCurrentPosition` перед prefetch и шагами 3–7. Натал и системный prompt гео идут параллельно; прогрев стартует сразу после успешного натала (координаты места рождения). Отказ в гео не блокирует мастер; GPS пишется фоном через `acquireAndPersistUserCoordinates`. Home подхватывает кэш даже если lat уже сменился на GPS (`peekDayContentCacheRelaxed`).

- **2026-08-20 (GPS country vs IP):** Отказ на шаге 2 больше не пишет IP в `users.country_code`. Кабинет при пустом поле берёт IP только для URL.

- **2026-08-19 (location optional):** Шаг 2 по-прежнему запрашивает геолокацию, но отказ больше не блокирует мастер (App Store 5.1.1). Prefetch дня — с fallback; страна кабинета — IP. CTA «Окон возможностей» на главной.

- **2026-08-06 (store-review birth overwrite):** `ensureStoreReviewProfile` при каждом login затирал `birth_place`/координаты Москвой — после правки на Лондон и повторного входа снова Москва. Fix: seed рождения только если `birth_date` пуст; правки модератора сохраняются.

- **2026-08-05 (store-review OTP):** Для модерации App Store / Play — серверные `STORE_REVIEW_EMAIL` + `STORE_REVIEW_OTP`: edge не шлёт письмо; `POST /api/auth/otp-verify` mint'ит сессию и ensure'ит Master/`store_review_account`. UI входа без изменений; Notes = email + имя + фиксированный OTP. См. profile / `DEPLOY.md`.

- **2026-08-01 (OTP sending pulse):** QA: «Отправляется…» ~5 с без движения выглядит как зависание. `AppButton` при `busy` держит три точки на месте и «зажигает» их цветом текста vs цветом кнопки (без прыжка центрирования).
- **2026-07-31 (LegalFooter import crash):** TestFlight Profile crash — `Cannot read property 'nativeApplicationVersion' of undefined` из-за `import Application from "expo-application"` (нет default export). Fix: `import * as Application`; `expo-application` — direct dependency.

- **2026-07-31 (LegalFooter about lines):** `tone="links"` (Профиль) — над юрссылками версия + © (см. profile history); consent на мастере без изменений.

- **2026-07-30 (OTP send UX latency):** Пауза ~8 с на «Получить код» — длинные retry App Check. Укорочен бюджет getToken (~1.2 с) + prefetch на mount; кнопка `busy` с «Отправляется…» (без dim).

- **2026-07-30 (OTP App Check rollback):** Store OTP → `otpAppCheckFailed` (клиент без валидного Play Integrity token на cold start). `OTP_REQUIRE_APP_CHECK=false` на Vercel+edge; rate limits остаются. Клиент: retry `getToken` перед gate. Enforce снова — только после проверки логов.

- **2026-07-30 (OTP abuse A+B):** Server rate limits (60s / 10/h / 25/day) + failed-verify cap (10/h); `POST /api/auth/otp-gate` + App Check permit; UI cooldown persists across «change email». Turnstile skipped (RN WebView). Enforce via `OTP_REQUIRE_APP_CHECK=true` after store rebuild.

- **2026-07-30 (geo place after onboard GPS):** После записи `lat`/`lon` в шаге 2 — `scheduleGeoPlaceSyncAfterCoords` (фон `country_code`/`city` через `/api/geo/reverse`). Раньше sync шёл только с `app_open`/`acquireAndPersist`, и часто не успевал, если первый `app_open` был до GPS.

- **2026-07-28 (geo city settlement):** `GET /api/geo/reverse` — prefer town/city; если только деревня — второй Nominatim `zoom=10` (районный/городской центр). Shared `geoCity` + `geoReverseResolve`; admin GET silent-repair.

- **2026-07-28 (geo city settlement, earlier):** `pickSettlementCity` без municipality/county «округ/район»; repair из `location_name`.

- **2026-07-24 (legal modal padding):** `LegalDocumentModal` — `paddingTop: 10` над первой строкой terms/privacy (мастер + Профиль).

- **2026-07-24 (LegalFooter на Профиле):** `LegalFooter` получил `tone="links"|"consent"`; Профиль рендерит `tone="links"` внизу таба (та же модалка / каталог `wizard.legal.*`). См. `profile/history.md`.

- **2026-07-24 (birth place Android hostRect):** Список городов снова пропал на Android: `measureInWindow` пустого overlay-слоя → height=0 → `hostRect` null → оверлей не монтировался. Fix: rect хоста из `onLayout` flex-корня в `WizardOverlayProvider`; не сбрасывать оверлей пока ждём якорь. Metro reload.

- **2026-07-24 (WizardTitle iOS 20pt):** Заголовок шага 2 на iPhone всё ещё переносился; `WizardTitle` iOS `21→20` / `lineHeight 26` (Android без изменений, 21). Metro reload.

- **2026-07-24 (birth place anchor):** Список городов якорился через `top` от `maxHeight` → при меньшем числе подсказок отрывался вверх от поля. Fix: `bottom` к верху инпута (сжимается сверху). iOS + Android.

- **2026-07-24 (birth place IME):** Transparent Modal для списка городов на Android снимал фокус с `TextInput` → IME пропадала при появлении подсказок (iOS ок). Вернули `WizardOverlayHost` вне ScrollView; координаты `anchor − host` в window; хост в `WizardShell` + `NatalBirthDataModal`. Metro reload, без rebuild.

- **2026-07-24 (birth place Modal):** Хост-оверлей в SafeArea ломал Android (window-coords vs слой). Список — transparent Modal + `top` от `measureInWindow`. Metro reload, без rebuild.

- **2026-07-24 (birth place overlay):** In-flow список толкал поле под клавиатуру. Попытка WizardOverlayHost — см. запись Modal выше.

- **2026-07-24 (birth place search Android):** Список городов / «Не удалось выполнить поиск». Корневая причина по логам — `GET /api/geo/search` → **401** (на Vercel остались старые JWT anon/service keys, клиент уже на `sb_publishable`/`sb_secret`). Синхронизированы ключи на Vercel; `requireUser` — fallback через service `getUser`; клиент при 401 делает refresh+retry.

- **2026-07-24 (Android Maps EAS env):** `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` был только в `.env.local`; EAS development build его не видел → crash MapView. Ключ добавлен в `eas env` (development/preview/production); нужен новый Android rebuild.

- **2026-07-24 (scope key HH:MM:SS):** Нормализация `birth_time` в `dayContentScope` — канон `HH:MM:SS` (не `HH:MM`): краткий формат ломал попадание в SecureStore у trial/paid Home (sezam777: ~30s timeout). Home читает кандидатов канон+`HH:MM`.

- **2026-07-24 (step 2 polish + warmup cache):** (1) `WizardTitle` 21/27pt — заголовок шага 2 в одну строку на iPhone. (2) `contentBumpKey` / `PLACE_FOCUS_SCROLL_EXTRA` — доп. `scrollToEnd` при выборе места. (3) Android Maps: `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` → `android.config.googleMaps` (нужен rebuild). (4) Шаг 2: natal∥geo, без await reverseGeocode/refreshProfile; CTA `wizard.nextLoading`. (5) Прогрев: общий `dayContentScope`; `forceNextHomeBootstrapSplash` после мастера — полная заставка, не day_card.

- **2026-07-22 (iOS keyboard regress):** Отложенный `scrollToEnd` из Android-фикса на iOS конфликтовал с `KeyboardAvoidingView` — после первой буквы форма проседала. `useEffect`-scroll только Android; iOS снова один `scrollToEnd` в `keyboardWillShow`.

- **2026-07-22 (Android keyboard first-field):** На Pixel подъём формы срабатывал только при фокусе email: `scrollToEnd` шёл до layout `paddingBottom`. Fix: scroll в `useEffect` после commit высоты (+ double rAF / retry на Android).

- **2026-07-22 (Android polish — шаг 1):** Pixel: невидимый текст/рамки полей (системный dark theme с корня → белый `textPrimary` на белом мастере); клавиатура перекрывала email/CTA (`adjustResize` + edge-to-edge не сжимает окно); чёрный сплэш в dark. Fix: `WizardTextInput` сам красит поле из светлой темы `WizardShell`; sign-in/onboarding используют `buildTheme("light")` для OTP/прочего; Android IME-height `paddingBottom` в `WizardShell`; `expo-splash-screen` + splash.dark = белый; placeholder auth-load = `#ffffff`. iOS путь KAV без изменений.

- **2026-07-20 (d):** `BirthPlacePicker` — sync текста с `value`. Баг: при первом открытии `NatalBirthDataModal` место в профиле есть (зелёная рамка), а поле пустое с плейсхолдером; со второго открытия — ок. Причина: `query` инициализировался только в `useState(value)`, а модалка сначала монтировала пикер с `place=null` и ставила место в `useEffect` после paint — внутренний `query` не обновлялся. Fix: `useEffect` пишет `formatGeoPlaceLabel(value)` когда `value` не null (при наборе текста родитель шлёт null — query не сбрасываем). `geoPlaceFromProfileBirthPlace` принимает lat/lon как number|string и `lng` alias.

- **2026-07-20 (c):** `modules/onboarding/MaskedTextInput.tsx` **переписан на сегментный ввод**: каждый сегмент маски (DD | MM | YYYY для даты, HH | MM для времени) — **отдельный `TextInput`** с `selectTextOnFocus`. Прежний diff-onChangeText-подход (слежение за выделением + diff отображаемого текста) давал баг «правлю месяц → год превращается в 968Y» (скриншот пользователя с «21-11-968Y») — при замене сегмента common-prefix/suffix ошибочно аттрибутировал слоты. В сегментной модели сегменты изолированы физически — правка одного `TextInput` не может затронуть другой. При фокусе сегмента его содержимое выделяется целиком — пользователь вводит сегмент заново (как просил: «кликнул в год — ввожу целиком»); при заполнении фокус авто-переходит на следующий (`refs.current[index+1].focus()`). `value` — строка цифр, компонент сам разбивает по сегментам. Пропы: `mask`, `value`, `onDigitsChange`, `style` (контейнер-ряд), `segmentStyle`/`separatorStyle` (`TextStyle`), `keyboardType` (по умолч. `number-pad`), `editable`, `placeholderTextColor`. `NatalBirthDataModal` переведён на новые пропы. Мастер регистрации пока остаётся на `format*Mask` (можно мигрировать позже).

- **2026-07-20 (b):** Новый компонент **`modules/onboarding/MaskedTextInput.tsx`** — `TextInput` с фиксированной маской (шаблон с буквами-плейсхолдерами `D`/`M`/`Y`/`H` и литералами-разделителями, например «DD-MM-YYYY», «HH:MM»). Источник истины — строка только из цифр длиной ≤ числа слотов; незаполненные слоты показывают плейсхолдер маски. Редактирование устойчиво: отслеживает выделение через `onSelectionChange`, по diff старого/нового отображаемого текста определяет затронутые слоты и помещает туда новые цифры — правка одной цифры не сдвигает остальные (выделили «07» и ввели «2» → «2D-MM-YYYY», месяц/год остаются на местах; удаление цифры очищает только её слот). Курсор выставляется программно после правки. Переиспользуется `NatalBirthDataModal` (Профиль) для даты и времени; мастер регистрации пока остаётся на прежнем `formatDateMask`/`formatTimeMask` (поведение пересборки) — миграция мастера на `MaskedTextInput` не делалась (можно позже). См. `profile/history.md` (2026-07-20 b).

- **2026-07-20 (a):** Хелперы маски/валидации даты-времени рождения (`formatDateMask`/`formatTimeMask`/`ddmmyyyyToIso`/`isoToDdmmyyyy`), прежде локальные в `app/onboarding.tsx`, вынесены в общий `modules/onboarding/birthDateFormat.ts` и переиспользуются `NatalBirthDataModal` (`modules/home/ui`) — формат ввода «DD-MM-YYYY» / «HH:MM» теперь идентичен в мастере и в редакторе натальных данных Профиля. `BirthPlaceMapModal` дополнительно используется в блоке «Мои данные» Профиля (кнопка «Карта») для сверки сохранённого места. См. `profile/history.md` (2026-07-20).

- **2026-07-19 (legal — правки Пользовательского соглашения):** Обновлены пункты `wizard.legal.termsBody` в RU-источнике (`modules/i18n/catalog/ru.json`): 1.1 (Приложение = бесплатный интерактивный кабинет для участников авторских курсов Сергея Замкового, технический доступ к учебным материалам, ежедневным рекомендациям, методичкам, видео и расписанию живых онлайн-консультаций), раздел 2 переименован из «ОПЛАТА И ПЛАТНЫЕ СЕРВИСЫ» в «ПОРЯДОК ДОСТУПА К МАТЕРИАЛАМ» (2.1 — бесплатное распространение; 2.2 — доступ к разделам ЛК, авторским программам и еженедельным вебинарам только зачисленным на `https://zamkovoi.yoga`, управление доступом/учётками/планами — вне приложения), 3.3 (ежедневные персональные рекомендации как часть авторской методики саморегуляции, исключительно ознакомительный/философский/информационный характер — заменил прежний текст про астрологические расчёты). 7 целевых локалей переведены `i18n-sync fill --all` (модель `AI_MODEL_PREMIUM`); `i18n-sync check` green. `wizard.legal.privacyBody` без изменений. См. `CHANGELOG.md` (173).

- **2026-07-18 (шаги 3-7 — новые тексты/картинки, абзацы):** Заменены тексты шагов 3-7 (RU) и изображения шага 3 (`psycho_2_600.jpg`) и шага 5 (`breath_2_600.jpg`). Переносы строк автора сохранены как отдельные абзацы — каждый рендерится своим `<WizardBody>` (тот же `scrollContent.gap: 16`, что у шага 1): `wizard.step{3..7}.{title,body1..bodyN}` (шаг 3-6 — по 3 абзаца, шаг 7 — 4). Старый одиночный ключ `wizard.stepN.body` удалён из 8 локалей; 16 новых ключей переведены `i18n-sync fill --all` (premium model); `i18n-sync check` green; tsc clean. См. `CHANGELOG.md` (166).

- **2026-07-18 (автоскролл клавиатуры — KeyboardAwareScrollView):** Шаги 1-2: при тапе в поле клавиатура закрывала вводимое поле и кнопку. Сначала сделал ручной автоскролл через `measureInWindow` + `scrollTo` в `WizardShell` с контекстом `useWizardAutoScroll` и `WizardTextInput` — но это конфликтовало с `KeyboardAvoidingView` (рывки «вниз-вверх» при переключении полей, нестабильная фиксация). Заменил на проверенную библиотеку `react-native-keyboard-aware-scroll-view` (`KeyboardAwareScrollView`, чистый JS — без нативной сборки): она сама плавно поднимает поле в фокусе синхронно с клавиатурой, без дёрганья. `extraScrollHeight = 150` поднимает поле выше, чтобы кнопка CTA и legal-строка под ним тоже были видны. `WizardTextInput` оставлен как тонкая обёртка над `TextInput` (call-сайты не менялись). Убрал `KeyboardAvoidingView`, контекст и всю ручную логику скролла.

- **2026-07-18 (прогрев мастера → полные тексты дня):** Корневая ошибка: prefetch после шага 2 шёл без `forceRefresh` и завершался на числовом каркасе; экран «Готовим ваш день» закрывался через секунды, кэш телефона не писался → главная без слогана/рекомендации (`model: unknown`). Исправление: `forceRefresh: true` + таймаут 90s (`ONBOARDING_DAILY_FORECAST_TIMEOUT_MS`), запись в `saveDayContentCache`, warm только если слоган+short ещё не готовы; geo-deny остаётся на шаге 2 с UI как у `GeoGate` (разрешить / настройки / закрыть приложение). Крон «спящих» 3 дня не меняли. См. `CHANGELOG.md` (165).

- **2026-07-18 (шаг 2 — список городов вверх + отступ картинки):** `BirthPlacePicker` открывает suggestions **над** полем (не под ним) — не уходит под клавиатуру; статусы поиска вне потока (кнопка «Далее» не прыгает). На `/onboarding` (шаги 2–7) добавлен `paddingTop: 12` под прогресс-баром; `/sign-in` не трогали. См. `CHANGELOG.md` (164).

- **2026-07-18 (шаг 2 — маски/список/карта):** Убран искусственный `placeSpacer` (72px) между местом рождения и «Далее» — список городов и так абсолютный оверлей. Маски даты/времени показывают разделитель сразу после 2-й цифры (`07-`, `07-11-`, `12:`), с защитой от зацикливания backspace. Кнопка карты: `wizard.placeMap.open` → «Проверить на карте» (8 локалей). См. `CHANGELOG.md` (163).

- **2026-07-18 (клавиатура — OTP без авто-подъёма):** На подшаге `confirm` выключен режим A (`footerInContent={false}`): контент не поднимается, картинка не обрезается, клавиатура перекрывает низ, скролл ручной. Welcome и шаг 2 по-прежнему в режиме A. `key={sub}` сбрасывает scroll offset при переходе. См. `CHANGELOG.md` (162).

- **2026-07-18 (клавиатура — ревизия 3):** Откат «фиксированного футера вне скролла» (ревизия 2 давала наезд кнопки на поля). Вернули `footerInContent`: CTA+legal снова в потоке страницы под полями. Стабильность: один `scrollToEnd({ animated: false })` только при открытии клавиатуры + `scrollEnabled={false}` пока она открыта (убирает iOS auto-scroll jitter при смене полей) + без `KeyboardAwareScrollView` (пакет удалён). iOS — `KeyboardAvoidingView behavior="padding"`; Android — `adjustResize`. См. `CHANGELOG.md` (161).

- **2026-07-18 (клавиатура — ревизия 2, откатана):** Попытка зафиксировать футер вне скролла + только KAV — на практике кнопка отрывалась от полей и наезжала на них при открытии клавиатуры. Заменена ревизией 3.

- **2026-07-18 (создание документации модуля):** Выделен модуль `onboarding` в `docs/02_modules/` (`spec.md`, `dependencies.md`, `history.md`). Ранее мастер документировался разрозненно внутри `profile`/`i18n`; теперь имеет собственное описание маршрутов, `WizardShell`, шагов, масок ввода, гео, прогрева, legal и geo-gate. Зарегистрирован в `docs/00_index/MAP.md`.

- **2026-07-17 (wizard UI/UX polish + copy overhaul):** `WizardShell` принудительно ставит светлую тему + фон `#ffffff` и получил `footerInContent` (CTA + legal внутри `ScrollView` — клавиатура поднимает их на свою высоту; шаги 1-2). Legal-футер оставлен только на шаге 1. Шаг 2: маски `ДД-ММ-ГГГГ` и `ЧЧ:ММ` с авто-вставкой разделителей (`formatDateMask`/`formatTimeMask`/`ddmmyyyyToIso`/`isoToDdmmyyyy`), лейблы обновлены, `BirthPlacePicker` показывает список городов абсолютным оверлеем поверх «Далее». `LegalDocumentModal` переписан (тело скроллится, «Закрыть» зафиксирована). Новые тексты RU для шагов 2-7 (консолидированы в `wizard.stepN.body`), `home.geoGate.*`. 7 локалей переведены через `i18n-sync fill --all` (`AI_MODEL_PREMIUM`). См. `i18n/history.md` (2026-07-17) и `CHANGELOG.md` (158).

- **2026-07-17 (изображения мастера):** Подключены новые JPG `assets/onboarding/*_600.jpg` (600×600, кроме `astrology_600.jpg` 943×600) для шагов 2-7 и экрана подтверждения email (`email_600.jpg`) в `INTRO_STEPS` (`app/onboarding.tsx`) и `EMAIL_ART` (`app/sign-in.tsx`).

- **2026-07-17 (notifications pre-permission — откат):** Был добавлен pre-permission `Alert` перед системным запросом уведомлений (`reminderPrePermission*` в `modules/home/i18n/home.ts`), но по решению продукта откатили к стандартному iOS-системному диалогу (надёжнее, не усложняем). Ключи `reminderPrePermission*` удалены из RU/EN + оверлеев de/fr/it/es/pt/nl; `OpportunityWindows.saveReminder` вернул прямой `requestPermissionsAsync`.

- **2026-07-14 (3-step onboarding):** Авторизация переведена на email-OTP (Supabase `signInWithOtp`/`verifyOtp`); онбординг расширен: данные рождения с автодополнением города (`BirthPlacePicker`, Open-Meteo через `/api/geo/search`) → геолокация → прогрев с префетчем дневного прогноза. См. `profile/history.md` (2026-07-14).
