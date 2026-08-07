---

## id: 04_workspace/open_questions

title: Open Questions
version: 1.38
updated: 2026-07-29
depends_on: [00_index/CHANGELOG]
code_refs: []

## `onboarding` / OTP App Check enforce (2026-07-30)

- **Enforce временно снят (2026-07-30 вечер):** store OTP падал с `auth.otpAppCheckFailed` — клиент не успевал получить Play Integrity token (или token не доходил). `OTP_REQUIRE_APP_CHECK=false` на Vercel + edge; rate limits остаются. Клиент: retry `getToken` после cold start. Перед повторным enforce: убедиться в логах `otp-gate`, что store шлёт валидный `appCheckToken`; (a) положить `GoogleService-Info.plist` + EAS file-env `GOOGLE_SERVICES_PLIST` и пересобрать IPA с RNFirebase; (b) Expo/Test — debug secret EAS↔Vercel. Без plist iOS-сборка пропускает Firebase plugins (App Check на iPhone off).

## `infra` / store submission checklist (2026-07-29)

- **Google Play / App Store — внекодовые декларации перед релизом.** Код: конфликт LOCATION `maxSdkVersion` закрыт (`with-android-location-permission-merge`); Privacy Manifest на iOS есть; `ITSAppUsesNonExemptEncryption=false`. Остаётся в консолях: (a) Play **Data safety** + declaration для location / Health Connect / mic / camera / Bluetooth; (b) Play **Health Connect** form (уже в open_questions communicator); (c) Play точное alarm / `SCHEDULE_EXACT_ALARM` use-case если спрашивает; (d) App Store privacy labels + HealthKit purpose strings review (локали — см. i18n open question); (e) залить **новый** AAB/IPA после prebuild, не старый артефакт. `SYSTEM_ALERT_WINDOW` может попасть из RN debug/dev-client tooling — при вопросе Play сверить, нужен ли overlay в production build.
- **Store-review login (код 2026-08-05, UI 2026-08-06):** `STORE_REVIEW_EMAIL` + `STORE_REVIEW_OTP` на Vercel; email также в secrets edge `send-auth-email`. В Review Notes: email / Name Alex / OTP. Письмо не приходит — ожидаемо. Профиль: «Выйти» работает; «Удалить» показывает blocked-диалог (wipe 403); кабинет скрыт. После смены OTP — только secrets. Нужен store-билд с клиентским otp-verify + этим UI.

## `notifications` / Android remote push (FCM, 2026-07-22)

- **~~Админский push на Android не доходит~~** — закрыто 2026-07-23 (FCM V1 в EAS); уточнение 2026-07-24: gitignore `google-services.json` не попадал в EAS build → 0 android tokens. Залит EAS file-env `GOOGLE_SERVICES_JSON`; нужен rebuild + проверка `push_tokens.platform=android`. См. `notifications/history`.

## `daily_forecast` / стартовая пауза главного экрана (наблюдение пользователя, 2026-07-20)

- **~~Долгая пауза при наступлении нового дня (free)~~** — закрыто 2026-07-21: крон/`global_daily_content` были готовы; зависание splash из-за abort при `profileLoading` flicker + `holdWarmForTexts`/locale strip на free. См. `daily_forecast/history`, `profile/history`.
- **~~Paid midnight pre-warm не был в pg_cron~~** — закрыто 2026-07-21: Edge был, schedule не было; `20260721003000` + self-heal `ensure_harmonizer_cron_jobs` (`20260721010000`, watchdog каждые 15 мин). Force-warm Master на 2026-07-21.

## `account_web` / внешние платежи (отложено по решению продукта, 2026-07-14)

- **Safari progress bar на `/cabinet/` (2026-07-20):** закрыто переходом на standalone HTML вне WP (см. `account_web/history` 2026-07-20). Если после выкладки на ISPManager полоска снова «залипает» — проверить, что URL не отдаётся темой WordPress.
- **~~Ветка завершения диалога ИИ для уровня «Наставник»~~** — закрыто 2026-07-20: Oracle/Free без ветки `practice`; soft-close в planning finalize (чакра дня + мягкая отсылка к каталогу Мастера в Личном кабинете). См. `assistant/history`.
- **Контент интро-экранов онбординга:** интро 3–7 и прогрев дня зафиксированы (2026-07-18); отдельный вопрос снят.
- **Платёжная система (Lava.top подключена 2026-07-15, мультиязычность 2026-07-18, разовый вебинар 2026-07-18, разовая книга 2026-07-18):** подписки «Наставник»/«Мастер», разовая оплата вебинара (ONE_TIME → регистрация `webinar_registrations`) и разовая покупка книги (ONE_TIME → `payment_contracts` + модалка благодарности через `purchases/last`) работают. Маппинг локализованных продуктов — в `payment_offers` (fallback `en`); цены тянутся из Lava. Кабинет переделан под макет автора (блоки «Гармонизатор» / «Другие тарифы» / «Дополнительно» с вебинаром, книгой, интенсивами m1..m7); правки UI 2026-07-18 — email без дефиса, EN «Advisor», EN название книги «Yoga - the Way of Wisdom», футер-копирайт `© <год> <имя>`, кнопки «Купить/Записаться — <цена>», блок вебинара скрыт без ближайшего вебинара. Открыто: (a) читалка книги в приложении (покупка уже фиксируется в БД); (b) курсы/интенсивы через Lava (`tier=course:<id>`; сейчас — внешние ссылки m1..m7); (c) годовая периодичность; (d) ответ поддержки Lava о параллельных контрактах; (e) ~~переключатель Lava ↔ RU-эквайринг~~ — закрыто 2026-07-31: профили `PAYMENT_*_ENABLED`/`_REGION` (RU→ЮKassa, INT→Lava, fail-closed); recurring (save method + cron + revoke на cancel/wipe). Осталось ops: `YOOKASSA_SECRET_KEY` на Vercel + smoke + выкладка `cabinet/` с `country`; чеки 54-ФЗ; (f) Lava-вебхук пишет в `payment_contracts`/`users.membership_*` напрямую, минуя админ-леджер `payments` — решить, нужна ли дублирующая запись (net уже в `payment_settlements`); (g) ~~Lava-блокер~~ — решён 2026-07-18: продукты вебинара/книги опубликованы с фиксированными ценами и «Доступ только по ссылке»; настоящие offerId получены через `GET /api/v2/products?feedVisibility=ALL` и записаны в `payment_offers` (миграция `20260718230000`); оплата через `POST /api/v2/invoice` ONE_TIME, цены из карточек Lava; нужен ближайший вебинар в `webinars` (future `starts_at`, `is_published`), иначе блок вебинара скрыт; (h) ~~резервный коммерческий банк~~ — закрыто 2026-07-22: Альфа/Газпром/Сравни.ру не дали стабильный JSON; цепочка Т-Банк→ЦБ + circuit на сбой Т-Банка; (i) **backfill net** для уже оплаченных `payment_contracts` без строк в `payment_settlements` — по желанию одноразовый скрипт; (j) **Lava `Incorrect email to purchase`** (2026-07-22): при checkout с email продавца Lava / тестовым аккаунтом автора API отвечает 400 — в коде теперь `lava_buyer_email_rejected` + текст в кабинете; продуктово: тестировать оплату с другого email (не email ЛК Lava продавца) либо включить ЮKassa для RUB.
- **Карта под выбором города рождения** в `BirthPlacePicker` — по желанию, позже.
- **Legacy-аккаунты Apple/Google:** существующие пользователи входят по email своей учётки через OTP (Supabase свяжет с той же auth-строкой); аккаунты с приватным relay-email Apple получают код через пересылку Apple — проверить на реальном аккаунте до релиза.

## `i18n` (multilingual)

- Дизайн и фазовый план — в `docs/04_workspace/i18n_architecture.md`. **Phase 1–3 (каркас + 8-locale layer B + layer C dialog scaffold) внедрены.** Закрыто в Phase 2: запись `users.locale` при смене языка; pre-translate free-tier global content в `text_i18n`; typed sync gate. Закрыто в Phase 3: детерминированные visible-text builders слоя C для всех 8 локалей (`dialog_scaffold` + `getDialogScaffoldStrings`). Открытые вопросы: (a) **миграция контента** оставшихся хардкод-RU экранов (инкрементально); (b) `practiceCardSummary` detailed breath-slug blurbs — пока RU/EN (generic card/reason уже 8-locale inline, не scaffold JSON); (c) math markdown strings для de–nl (сейчас EN fallback).
- **Нативная локализация бренда (2026-07-17):** локализованное имя приложения (под иконкой / в системных диалогах / в OTP-письме) и reason-строки разрешений iOS для 8 локалей настроены через `app.config.ts` `expo.locales` (`plugins/appLocalesData.js`). Переводы имени («Гармонизатор»/«Harmonisierer»/…) и reason-строк для 6 не-RU/EN локалей сделаны машиной — нужен ревью нативного носителя (и, для reason-строк, — юриста по Apple App Store Review Guideline 5.1.1) перед релизом в сторы. **Контекст:** `plugins/appLocalesData.js` + `supabase/functions/send-auth-email/templates/*.json`. **Проявление:** риск отказа/жалобы на некорректный текст разрешения в локали. **Действие:** пройти нативный ревью 6 локалей (de/fr/it/es/pt/nl) до публикации.
- **Home geo-gate: выход из приложения на iOS (2026-07-17):** «Закрыть приложение» в `modules/home/ui/GeoGate.tsx` на Android вызывает `BackHandler.exitApp()` (реально закрывает процесс), а на iOS — `signOut()`, потому что Apple запрещает программный выход из приложения (нет публичного API). **Контекст:** `app/(tabs)/index.tsx` `onCloseAppFromGeoGate`. **Проявление:** на iOS кнопка не закрывает приложение, а выходит из аккаунта и уводит на `/sign-in` (откуда пользователь закрывает приложение вручную) — это даёт естественный выход из гейт-цикла, но не буквально «закрыть приложение». **Действие:** решить с продуктом, достаточно ли выхода из аккаунта на iOS, или нужен иной UX (например, отдельный поясняющий текст для iOS вместо кнопки).

## `webinars`

- Dual model Анонс/Запись реализован (2026-07-13). Разовая оплата вебинара для free/Наставник реализована (2026-07-18, ONE_TIME через Lava → `webinar_registrations`; модалка «Вы записаны на вебинар» в приложении). Открыто: (a) пуши «скоро» / «запись доступна» на сегмент `webinar_registrations`; (b) схлопывание тарифов Free/Oracle/Master vs Практик.

## `author_presence`

- Модуль **не реализован**; продуктовое решение (тарифы, UI сторис/баннеров поверх существующих таблиц) и реализация ожидаются.

## `communicator`

- **Google Play Health Connect declaration**
**Контекст:** Android summary health-context использует `react-native-health-connect` и permissions `READ_STEPS`, `READ_ACTIVE_CALORIES_BURNED`, `READ_EXERCISE`, `READ_SLEEP` через Google Health / Android Health Connect.
**Проявление:** dev-client может читать данные на устройстве после permissions, но для production-релиза в Google Play может потребоваться Health Connect declaration / review и время на propagation whitelist.
**Действие:** перед Android production rollout заполнить Google Play declaration для Health Connect data types и проверить, не изменились ли требования Google Health/Health Connect к маю-июню 2026.
- **Хрупкость разбора SSE на клиенте**  
**Контекст:** `parseSseBlock` / `handleSseEvent` в `services/communicator-client.ts` завязаны на фиксированные имена событий и JSON-форму полей.  
**Проявление:** несовпадение с сервером (имя события, вложенность `data`) даст тихую потерю чанков или пустой ответ.  
**Действие:** при изменении контракта SSE на стороне `assistant` — синхронно обновлять клиент и дымовой тест end-to-end.

## `assistant`

- **Matrix-filtered day_target_chakra отключён (2026-07-12)**  
**Контекст:** `chooseTargetChakra` раньше мог брать 2–3-ю планету top-3, если 1-я «переразвита» в `daily_matrices` (`matrix_filtered_by_strength`). Home «Рекомендации на день» всегда говорили про сильнейшую планету (напр. Moon → 1-я чакра), а диалог писал «вторая чакра».  
**Проявление:** расхождение Home vs planning FINAL.  
**Сейчас:** day target = astro primary (top-1); stale `day_target_chakra` в `user_daily_forecasts` перезаписывается при расхождении.  
**Действие (продукт):** решить, нужен ли снова matrix-filter как отдельный режим, или primary навсегда.

- **Layer A baselines: не переводить «до 8 локалей» без продуктового решения**  
**Контекст:** `life_spheres_baseline` есть только как `{ru,en}` (не-en → ru); `chakra_states_baseline.json`, `planet_chakra_map.json`, tonal registers — единый RU; `author_voice.json` — ru+en (EU locales → EN cadence). Это **layer A** по `i18n/spec` §1.3: RU (и опционально EN) как вход в LLM, видимый ответ — layer B на `languageName`. Layer C (`dialog_scaffold` ×8) уже полный.  
**Проявление:** кажется «недопереводом», но диалоги DE/FR/… работают: модель читает RU/EN семантику и пишет на языке UI.  
**Действие:** не плодить per-locale копии layer A без явного продукта; если когда-то понадобится EN-only для всех EU — расширить loader, не дублировать 8× JSON.
- **Два URL одного диалога и условный выбор на клиенте**  
**Контекст:** `sendDialogMessage` (`services/communicator-client.ts`) использует `getAiDialogUrl()` только если передан `**scenario_id`**; иначе запрос идёт на `**/api/communicator/v2/dialog**` (помечен deprecated в логах сервера). Реализация совпадает через реэкспорт, но продолжается техдолг по единому каноническому пути и по обязательной передаче `scenario_id` для всех новых клиентов.  
**Действие:** при рефакторинге communicator — всегда бить в `/api/ai/dialog` или явно документировать исключения.
- **Тема дня для практики vs топ-3 для утреннего монолога**  
**Контекст:** `morning_recommendation` собирает три лепестка по `**ranked_planets` / importance** (`topPetals`), а `**choosePractice`** в `practiceSelection.ts` берёт чакру из `**planet_of_the_day**`. Это сознательное расхождение или временная асимметрия продукта — в коде не сведено.  
**Действие:** решение заказчика: выровнять выбор чакры для стека практик с топ-1 лепестком, либо зафиксировать продуктовую модель «утро про три темы, практика про планету дня».
- **Explicit dialog cache остаётся process-local**  
**Контекст:** в dialog v3 `ensureDialogCache(...)` в `_legacy_web/app/api/_utils/gemini.ts` хранит `cache.name` в in-memory TTL map; внешнего Redis/KV в проекте не найдено.  
**Проявление:** на одном инстансе Vercel возможны cache hit по одному `conversationId + historyHash`, но между cold start / разными инстансами reuse не гарантирован; реальная экономия токенов может плавать.  
**Действие:** при следующем заходе в infra/assistant решить, нужен ли shared cache store (Redis/KV) или текущий best-effort режим достаточно хорош для v3.
- **Для `planned_events` нет отдельного cleanup job вне интерактивного dialog path**  
**Контекст:** HARMONIZER v2 протухшие запланированные события сейчас закрывает через `expireStalePlannedEvents()` во время загрузки day-context для очередного диалога. Отдельного cron/worker, который чистит хвосты без входа пользователя в чат, нет.  
**Проявление:** пользователь, который перестал открывать ассистента, может оставить stale `planned_events` до следующего dialog request; отчёты и вспомогательные выборки должны учитывать это best-effort поведение.  
**Действие:** при следующем инфраструктурном проходе решить, нужен ли scheduled cleanup / background rebuild для `planned_events` и `daily_matrices`.
- **`outcome_cells` для summarized events могут уезжать в слишком общие сферы**  
**Контекст:** FSM-маршрут получает `outcome_cells` напрямую из маркера `[SUMMARIZE_EVENT]` (`buildSummarizingPrompt` + `persistSummarizedEvent`); прежний delayed classifier в `planningReconciliation.ts` (удалён 2026-06-09) больше не участвует. Rule-based post-validation по sphere hints по-прежнему отсутствует.  
**Проявление:** события вроде обсуждения контракта могут неожиданно получать сферу 7 («смысл и вклад»), а культурный/релаксационный эпизод — сферу 1 («тело и здоровье»), если модель цепляется за косвенные слова вроде `спалось`, `ценности`, `голос`, а не за основной домен события. Пользователю это выглядит как «фонящий» выбор столбцов при в целом разумной архитектуре матрицы.  
**Действие:** при следующем заходе в assistant/life-matrix решить, достаточно ли двухшаговой low-cost цепочки, или нужно усилить classifier prompt, поднять модель для classification, добавить rule-based post-validation по sphere hints или завести golden-fixtures для спорных доменов (`контракты`, `искусство`, `сон после события`).

## `bindu`

- После переноса источников в `docs/05_archive/migrated/bindu/` в репозитории остаются **устаревшие пути** в инвентарных файлах (например `docs/_audit.md`), где ещё перечислены `docs/meditation_video_generator_spec.md`, `docs/modules/bindu_succession_lab.md`, `docs/modules/visual_module_map.md`. Нужна отдельная правка аудита или ссылка на новый канон `docs/02_modules/bindu/`*, вне scope одной миграции модуля.

## `biofeedback` / `practices`

- **Peak-detector не восстанавливается после сильного сигнала на маргинальном PPG**
**Контекст:** Field test `1783084493476` (algoVer 1.2.12) — палец на объективе всю сессию, но амплитуда PPG была маргинальной (0.007–0.013). При этом в окне t≈16–25 с сигнал кратко усилился до 0.06–0.085, пик-детектор залочился, а когда амплитуда вернулась к ~0.010, он уже не находил пики до конца практики (4+ мин), хотя в самом начале при той же амплитуде 0.010 трекинг был. Похоже на адаптивный prominence-threshold, поднявшийся под сильный сигнал и не сбрасывающийся обратно. Подтверждено export-ами `1783088279299` (algoVer 1.2.14: старт ~9 с трекинг, затем ~22 с потеря на амплитуде 0.005–0.014) и `1783091581263` (algoVer 1.2.16: пик-детектор потерял захват ~11 с ДО старта `running` (warmup tail) и восстановился только на t≈13 с — стартовая серая полоса ~24 с). С 2026-07-03 (5–8) короткая часть таких потерь (≤ 8 с) прикрывается empty-window bridge-rescue + pipeline safety net на plausible baseline, а с 2026-07-03 (8) `detectBeats.relaxThresholds` (re-acquire sweep при ≥ 2.5 с без ударов) ослабляет пороги height/prominence, пере-открывая детектор для маргинального пульса. Стартовая полоса >8 с от последнего trusted beat дополнительно прикрывается start-grace emulated fallback (practices 2026-07-03 (9), 4 с вместо 20 с). Глубинный root — если пульс-осцилляции находятся ниже bandpassed noise floor (холодный палец / слабая перфузия), никакая настройка порогов их не восстановит; эти случаи честно уходят в synthetic pacing.
**Проявление:** На «холоднопалых»/слабоперфузийных сессиях пик-детектор теряет захват и держит `holding` минутами; практика корректно уходит в emulated (фикс 2026-07-03 (3)), но реальный пульс не восстанавливается, хотя сырой сигнал формально присутствует.
**Действие:** исследовать `modules/biofeedback/signal/optical-pipeline.ts` (адаптивный prominence/порог детектора пиков) — должен ли порог пересчитываться вниз при длительном отсутствии детектированных пиков, или нужен отдельный re-acquire sweep по сниженному порогу. Сначала убедиться по raw-оптике, что сигнал действительно содержит пульс, а не только шум. **Частично выполнено 2026-07-03 (8):** `detectBeats.relaxThresholds` — re-acquire sweep при ≥ `OPTICAL_REACQUIRE_RELAX_MS` (2.5 с) без ударов ослабляет пороги. Оставшееся — случаи, где пульс ниже bandpassed noise floor (нужен raw-optical replay для верификации).

- **Порог trusted accuracy для generic BLE HRM пока продуктово не закреплён**  
**Контекст:** `modules/biofeedback/wearables/trustedProfiles.ts` даёт `fullMetrics` только для явно доверенных Polar-профилей, а все прочие BLE chest straps идут через generic probe (`RR -> fullMetrics`, HR-only -> `guidedOnly`). UI и pipeline уже умеют работать по capability tiers, но сами пороги доверия и список «точно validated» устройств пока intentionally conservative.  
**Проявление:** Magene / Coospo и другие совместимые ремни могут фактически давать пригодный RR для дыхания и даже для HRV, но сейчас приложение не обещает им тот же уровень доверия, что Polar H10/H9, пока не появятся собственные сравнительные замеры с Kubios / внешними приложениями.  
**Действие:** после серии реальных тестов (Polar H10 как baseline, затем Magene / Coospo / прочие) решить, какие модели переводим в trusted profiles, нужны ли отдельные thresholds для `fullMetrics`, и документировать это решение синхронно в `biofeedback/spec.md` и `practices/spec.md`.

- **Android системный диалог «Подключить Polar… / доступ к контактам» поверх GATT**  
**Контекст:** Только BLE GATT (без `createBond`). На Pixel часто **два** OS-шага на первый link: connect + enable notify (CCCD) — оба рисует система, не приложение. Поток: всё в `WearablePickerDialog` до статуса «Подключен · пульс идёт» (≥3 HR-пакета); Start не должен звать новый `connectToDevice`, если GATT уже жив.  
**Проявление:** Два баннера/диалога при первом Connect после Forget — ожидаемо для Android; повтор на Start / mid-practice — регрессия.  
**Действие:** QA: Forget → Connect в модалке (подтвердить оба OS-окна, дождаться «пульс идёт») → Close → Start без баннеров. Если баннеры на Start остаются — Companion Device / `TRANSPORT_LE`.

## `audio` / `bindu` (пакетные границы)

- **Встречные импорты `mandala-sound` ↔ `modules/mandala`**  
**Контекст:** `mandala-sound/core/sync.ts` импортирует `buildAudioContract` и типы из `modules/mandala/core/`; часть файлов в `modules/mandala/experiments/` импортирует `MandalaSoundProvider` / типы из `mandala-sound`. Такт и снижение частот (таймлайн) при этом сосредоточены в `MandalaSoundProvider`, а не в канвасе мандалы.  
**Проявление:** жёсткая сцепка релизов двух пакетов; риск неявного цикла при реорганизации barrel-экспортов или выносе кода в общий пакет.  
**Действие:** при следующей крупной рефакторизации — либо вынести общий контракт в нейтральный слой (отдельный пакет/файл без UI), либо зафиксировать ADR с правилом «истина в `mandala/core/bio.ts`», допустимым направлением импортов и исключениями для `experiments/`.

## `audio` (частотная модель)

- **Binaural: мультиполосный кроссфейд вместо непрерывного осциллятора**  
**Контекст:** 2026-07-05 binaural-слой переведён с 4 дискретных полос на мультиполосный кроссфейд из 12 loop'ов (шаг ~1 Гц, несущая 150 Гц) — `binauralCrossfadeGains(targetHz, beats)` интерполирует громкости двух соседних loop'ов, бит следует за `targetHz` почти непрерывно. Полноценный непрерывный per-ear осциллятор с медленной модуляцией несущей 140–180 Гц (PDF) не реализован.  
**Проявление:** на переходах между loop'ами (каждые ~1 Гц) микро-скачок частоты биения теоретически остаётся (степень 1 Гц вместо 4 Гц), но на слух и по сравнению с мерцанием мандалы — пренебрежимо; медленная модуляция несущей отсутствует (несущая строго 150 Гц).  
**Действие:** полный непрерывный осциллятор требует нативного синтеза (`react-native-audio-api`, Web Audio API на RN), который на Expo SDK 54 конфликтует с `react-native-worklets` 0.5.1 (Issue #739, именно наши версии). Путь: дождаться обновления Expo SDK / починки конфликта и тогда поставить `react-native-audio-api` с двумя `OscillatorNode` и `StereoPannerNode`; до этого момента мультиполосный кроссфейд — намеренный компромисс v1.

- **Мерцание мандалы не использует фазовую интеграцию**  
**Контекст:** шейдер облачка `BinduSuccessionLabCanvas` считает `sin(syncTime·2π·externalFlickerHz)`; при смене `externalFlickerHz` (раз в 250 мс тик) фаза формально терпит разрыв. PDF рекомендует интегрировать фазу `φ(t) = ∫2π·f(t)dt` и передавать в шейдер `sin(φ)`.  
**Проявление:** при текущих скоростях сброса (пик ~2.3 Гц/мин = ~0.01 Гц на тик) скачок фазы пренебрежимо мал (<0.02 рад), визуально незаметен.  
**Действие:** оставить как есть до перехода на более быстрые траектории; при таком переходе — накапливать `flickerPhase` в `MandalaSoundProvider` (`phase += 2π·f·dt`) и передавать cumulative phase в шейдер вместо `(syncTime, flickerHz)`, расширив `MandalaSoundVisualSync` (точка риска задокументирована в `bindu/dependencies.md`).

## `infra`

- Файлы `docs/tmp_docs/29042026/PATCH_5_RLS_tightening.md` и `PATCH_11_whisper_quality.md` перенесены в `docs/05_archive/migrated/infra/`. В `docs/_audit.md` и в `docs/tmp_docs/29042026/00_OPTIMIZATION_PLAN.md` остаются ссылки на старые пути — обновить при следующем проходе аудита или архивации всей серии `29042026`.
- **Локальный запуск Supabase CLI не подтверждён в этом workspace**  
**Контекст:** при попытке применить миграцию `20260511161000_dialog_system_v3.sql` локально команды `npx supabase status` / `npx supabase db push --local` повторно завершались ошибкой ещё на стадии `npx`-подтягивания CLI.  
**Проявление:** код и SQL уже в репозитории, но локальная проверка prompt-миграции в dockerized Supabase не завершена.  
**Действие:** при следующем инфраструктурном проходе решить проблему с локальным `supabase` CLI или перейти на заранее установленный бинарь/CI-путь для проверки миграций.

## `astro` / `daily_forecast` (cache parity)

- **Edge-функция daily-forecast использует устаревший fallback cacheValidUntil = now + 24h**  
**Контекст:** основной путь (`modules/daily-engine/computeDailyForecast.ts`) задаёт `cacheValidUntil` через `endOfForecastDateUtc` — конец календарного дня прогноза в timezone пользователя. В `supabase/functions/daily-forecast/index.ts` для fallback-ответа используется `new Date(Date.now() + 24 * 60 * 60 * 1000)`, без привязки к локальному дню; это тот же класс расхождений с timezone-aware срезом кэша, который PATCH_3 адресовал для `/api/calibration/extract` и локальной даты (исторический текст: `docs/05_archive/migrated/daily_forecast/PATCH_3_forecast_cache_timezone.md`).  
**Проявление:** краевые случаи около полуночи UTC, неконсистентный TTL кэша в зависимости от того, прошёл ли расчёт через Next.js API или Edge.  
**Предложение:** parity-fix в Edge (та же формула, что в основном пути) или вынести расчёт `cacheValidUntil` в общий модуль, импортируемый Node и Deno (по духу PATCH_4 для M2). См. также `docs/02_modules/astro/caching_strategy.md`.
- **Parity-тест Node↔Deno покрывает не весь прогноз**  
**Контекст:** `supabase/functions/_shared/daily-engine-parity.test.ts` сравнивает `effectiveNatalParams`, `computeActivation`, `computeImportance` между `modules/daily-engine` и `_shared/dailyForecast.ts`.  
**Пробел:** нет автоматической проверки полной цепочки в духе «одинаковый `DailyForecast`» включая `rankPlanets` / `chooseFinalPlanet`, синтетические окна и различия провайдеров транзитов между Next и Edge.  
**Действие:** при существенных правках M2 расширить golden-fixtures / интеграционный тест или явно принять ручной регрессионный чеклист.

## `daily_forecast`

- **recentPlanetsOfDay не записывается клиентом — серверная логика повторов планеты дня неактивна**  
**Контекст:** ТЗ MODULE_2 (см. архив `docs/05_archive/migrated/astrology/`) описывает стек двух последних планет дня для предотвращения повторов 3+ дня подряд. Сервер (`_legacy_web/app/api/astro/daily-forecast/route.ts`) читает `user_settings.preferences.recentPlanetsOfDay`, и `chooseFinalPlanet` использует его для альтернативного выбора. Однако клиент (`useDayContent` → `fetchDailyForecast`) не передаёт `recentPlanetsOfDay` в теле запроса и не записывает в `preferences` после показа дня. Стек на практике всегда пуст; альтернативная ветка `chooseFinalPlanet` по «недавности» не активируется.  
**Проявление:** пользователь может три дня подряд получать одну и ту же планету дня (например Сатурн при сильно активном Сатурне в натале), и «альтернативный выбор» с пояснительным текстом не сработает.  
**Действие:** при следующей работе с `daily_forecast` — либо реализовать запись стека (после показа forecast записывать в `user_settings`), либо удалить серверную логику стека как мёртвую (если продуктово решено, что повторы — норма). Зафиксировать решение явно.

## `admin_panel`

- **Пороги алертов пульса (2026-07-21)**  
**Контекст:** `/api/admin/dashboard` хардкодит `TOKEN_ALERT_THRESHOLD_24H=80000` и `LLM_ERROR_ALERT_THRESHOLD_24H=15`.  
**Проявление:** смена порогов требует деплоя кода; UI/настройки в «Промпты» нет.  
**Действие:** при необходимости вынести в `app_config` или админ-UI; kill-switch по токенам в продукте не делать.
- **Daily activity rollup (отложено)**  
**Контекст:** серия DAU на пульсе сканирует `user_event_log` с индексом `(occurred_at)` / `(kind, occurred_at)`.  
**Проявление:** при росте лога до больших объёмов RPC может замедлиться.  
**Действие:** при необходимости — таблица `user_daily_activity` или materialized aggregates; на текущем объёме (единицы–сотни пользователей) не требуется.

## `subscription`

- **users.membership_tier: 4 тира в БД (решено 2026-07-08)**  
**Контекст:** constraint допускал только `free`/`premium`, клиент был готов к `oracle`/`practitioner`/`master`.  
**Решение:** миграция `20260708010000_admin_panel_tier_foundation.sql` (этап 0 admin_panel) расширила constraint до четырёх тиров, нормализовала `premium`→`oracle` и добавила `membership_expires_at` для ручных грантов. См. `02_modules/subscription/history.md`.
- **Условие «premium ИЛИ trial» централизовано (решено 2026-07-08)**  
**Контекст:** правило эффективного премиум-доступа дублировалось в 5 местах (клиент + сервер).  
**Решение:** единый `modules/access/core/paidAccess.ts` (`hasEffectivePremium`, `accessModeFromRow`, `baseTierFromRow`), vendored-копия для Vercel через `scripts/sync-vercel-server-modules.mjs`. **Оставшееся намеренное зеркало:** Edge `precompute-daily-forecasts` (`hasPersonalForecastAccess`) — Deno bundler не резолвит `modules/`; при изменении правила синхронизировать вручную.
- **Автооплата / store renewal при истечении срока**  
**Контекст:** hourly `reconcile-expired-memberships` только пересчитывает `users.membership_*` из уже существующих строк `payments` (highest active tier → иначе free). Интеграции со сторами и автопродления нет.  
**Проявление:** после истечения ручного/будущего store-платежа пользователь уходит на free (или на другой ещё действующий платёж), но следующий месяц сам не списывается.  
**Действие:** при подключении платёжной системы — писать в тот же леджер `source=store` и решить, где живёт renewal (store webhook vs отдельный billing job), не смешивая с reconcile-downgrade.
- **Итоговые названия/число тарифов (временная схема free/oracle/practitioner/master)**  
**Контекст:** владелец рассматривает схему «Навигатор / Советник / Учитель» (или иное); текущие четыре тира — временные.  
**Проявление:** смена id/названий потребует миграции CHECK, SQL `recompute_user_membership`, матрицы `TIER_FEATURES` и i18n `tier.*`.  
**Действие:** править только канон `modules/access/core/{tiers,features}.ts` + одна миграция; не размазывать списки по админке.
- **`announcements` — кандидат на депрекацию**  
**Контекст:** таблица `announcements` (+`user_announcement_views`, RPC `get_user_announcement`) спроектирована под баннерную модель, клиент её никогда не вызывал. По плану админ-панели публикации получают новую таблицу `posts` (этап 2), баннер вебинара читается из `webinars` (этап 3).  
**Проявление:** мёртвая схема + RLS-политики; риск путаницы «публикации vs announcements».  
**Действие:** после этапов 2–3 решить — удалить `announcements` миграцией или оставить под произвольные баннеры.

## `profile`

- **`practice_sessions` — запись при завершении (решено 2026-05-21)**  
**Контекст:** `recordPracticeSession` вызывается при **завершении** сессии (асана — «Завершить практику», дыхание — выбор настроения после таймера, медитация — `completePractice`). Запись **не** создаётся при рекомендации ассистентом или при открытии карточки без завершения.  
**Решение владельца:** модель «только завершённые практики попадают в отчёт» **устраивает**, менять на insert при «Начать практику» **не нужно**.  
**Инвариант:** отчёт `practice-by-chakra` и `user_daily_stats` отражают только сессии с `ended_at IS NOT NULL`.
- **Перегрев iPhone на экране профиля в dev-client**  
**Контекст:** владелец (iPhone 14, `expo start --dev-client -c`, тариф «Мастер») сообщил сильный нагрев при открытии профиля и переключении селекторов периода (2026-05-21). Статический аудит `ProfileReports.tsx` / `profile.tsx`: бесконечных `useEffect`, polling, `setInterval`, SVG-анимаций не найдено; каждый селектор вызывает один fetch на смену периода.  
**Проявление:** возможный baseline dev-режима (Metro, LogBox, React dev overhead) без воспроизведения на Release-сборке.  
**Действие:** владельцу сравнить тот же сценарий на `expo run:ios --configuration Release`; при сохранении перегрева в prod — профилировать React DevTools / Instruments.

## `practices`

- **Воспроизведение видео асан (Vimeo) в мобильном клиенте**  
**Контекст:** `app/asana-practice.tsx` явно сообщал, что локальный Vimeo-плеер отключён из‑за отсутствия native WebView в текущем dev-client; показывались метаданные и кнопка завершения с записью сессии.  
**Решено 2026-07-05:** реализованы два режима воспроизведения через сегмент «Телефон / ТВ». **Телефон** — встроенный Vimeo-плеер на `react-native-webview` (пакет уже был в зависимостях). **ТВ** — Remote Play через `modules/remote-play` (`useRemotePlay`, роуты `connect-tv` / `tv-remote`). Embed URL жёстко `?audiotrack=ru` (`modules/practices/core/vimeo.ts`). См. `docs/02_modules/practices/spec.md` §2/§5 и `history.md` 2026-07-05 (20).
- **Биометрия для медитации «Вспышка»**  
**Контекст:** дыхательная практика пишет итоговые `**metrics`** из PPG; `**SacredSymbolStreamScreen`** сохраняет `**metrics: {}**` и не подключает biofeedback.  
**Вопрос:** нужен ли в следующих версиях тот же класс метрик, что и для дыхания, или медитация намеренно остаётся «лёгкой» без пульса.  
**Действие:** решение заказчика; при «да» — проектирование UX (палец на камере во время медитации) и единый контракт `practice_sessions.metrics`.
- `**user_practice_preferences` и round-robin дыхания (breath)**  
**Контекст:** триггер `practice_sessions_update_prefs` в `supabase/migrations/20260429051600_calibration_dialogue_orchestrator.sql` обновляет `user_practice_preferences` только при **непустом `practice_id`**. Клиент `recordPracticeSession` (`services/practiceSessions.ts`) передаёт UUID `**practice_id` только для асан**; для **breath** и **meditation** в сессию уходит в основном `**practice_slug`**, без UUID.**  
**Проявление: для дыхательных сессий строки в `user_practice_preferences` не накапливаются через этот триггер; при рекомендации breath ассистенту не хватает опоры на «недавно выполненные» UUID для round-robin — одна и та же дыхательная практика может предлагаться несколько дней подряд, хотя продуктово ожидается цикл по каталогу.**  
**Продуктовое намерение: асаны — round-robin по полному каталогу (~~200) с окном 15 дней (асана не чаще раза в 15 дней). Дыхание — та же идея round-robin: сейчас 7 типов → естественное окно **~~7 дней** (каждая практика примерно раз в неделю); при росте числа дыхательных практик окно увеличится автоматически с размером каталога — смысл: не предлагать повтор, пока не прошли остальные в круге. Медитация — сейчас одна практика «Вспышка», повтор каждый раз намеренно, персонализация не нужна; когда медитаций станет больше — тогда цикл по кругу. Медитацию в рамках этой задачи не меняем.**  
**Действие при следующей работе с `practices` / `assistant`: явно выбрать и задокументировать в коде один из путей: (а) передавать UUID `practice_id` для breath (строки в `practices` с `kind = 'breath'` — при отсутствии строк добавить миграцию/сид), либо (б) расширить триггер/схему так, чтобы для breath надёжно велась история по `**practice_slug`**. После выбора — проверить согласованность с `practiceSelection.ts` и `@shared/selector`.
- **Round-robin асан: 15-дневное окно как продуктовое правило**  
**Контекст:** в `docs/02_modules/practices/spec.md` и `history.md` **не зафиксировано** продуктовое правило «асана не чаще чем раз в 15 дней, полный круг по каталогу». В коде серверного выбора константа `**recentStackLimitForKind('yoga') === 15`** в `_legacy_web/shared_core/selector.ts` задаёт размер окна недавних ID для йоги и **соответствует** заявленному намерению (не произвольное число).  
**Проявление:** при рефакторинге селектора или миграции каталога легко сломать или «упростить» окно, не понимая продуктовой цели.  
**Действие:** при следующем изменении `selector.ts` / `practiceSelection.ts` сверять поведение с этим пунктом; при желании дублировать краткую отсылку в `practices/spec.md` §5 (без расширения scope текущей задачи — сейчас источник истины для намерения здесь).

## `biofeedback`

- **updateHrvMetrics не вызывается из PPG-пайплайна**  
**Контекст:** функция `updateHrvMetrics` в `modules/biofeedback/core/metrics.ts` существует и документирована как единая точка RMSSD/Баевского для скользящего окна, но основной путь `BiofeedbackPipeline` / камера её не вызывает (см. `docs/02_modules/biofeedback/history.md`).  
**Возможные причины:** (а) мёртвый код после итерации архитектуры; (б) запланированная интеграция, не доведённая до конца; (в) использование на другом пути, не отслеженном при миграции документации.  
**Действие:** при следующей работе с модулем biofeedback проверить фактические вызовы (`grep`/runtime), затем удалить, подключить к пайплайну или явно задокументировать как намеренный legacy.

## Общее

- **Supabase Auth POST `/token` 504 (2026-07-27):** при валидном apikey password/refresh давали gateway **504** (запросы не доходили до GoTrue), GET `/user` и REST работали — похоже на [silent freeze GoTrue](https://github.com/supabase/supabase/issues/46429). Админка: логин через `POST /api/admin/login`, `sb_*` не слать в `Authorization`. Если снова 504 — Restart project в Supabase Dashboard (`pause` через MCP может упасть на backup check).
- **Техдолг тестов (не блокер):** `npx tsc --noEmit` в `_legacy_web` даёт 3 ошибки в `app/api/communicator/v2/dialog/practiceSelection.test.ts` (TS2783 ×2 строки 33–34, TS2339 строка 308). Ошибки ПРЕДсуществующие (не регресс HARMONIZER v2 / патча C.4), только в тест-файле, `next build` их фильтрует (runTypeCheck игнорирует `*.test.ts`), в прод-бандл не попадают. Безопасно для продакшена. Чистый фикс — ~3 строки в тесте (деструктуризация input в `breath()`; сужение типа на строке 308). Сделать при ближайшей уборке тестов.
- На момент создания скелета дополнительных записей не требовалось; новые вопросы добавлять сюда по мере миграции остальных модулей.

## onboarding

- ~~**Android Google Maps API key for «Проверить на карте» (2026-07-24):**~~ Закрыто 2026-07-24: ключ в `.env.local` + `eas env` (`EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` → development/preview/production). Нужен **новый** `eas build --profile development --platform android` — предыдущий билд собрался без переменной, поэтому MapView падал с `API key not found`. iOS = Apple Maps, ключ не нужен.
- **iOS system notification dialog text is not editable.** The grey body comment line under the title in iOS's notification-permission system dialog (`UNUserNotificationCenter` request) is fixed by Apple and cannot be localized or reworded from the app. Decision (2026-07-18): use the standard system dialog as-is (a custom pre-permission `Alert` was briefly added then reverted — `reminderPrePermission*` removed; simpler and more reliable). Revisit only if product later wants higher opt-in conversion via a pre-permission explainer.
- **Historical timezone accuracy for natal chart** — audited 2026-07-18, no action needed: `localChartDateTime` (`modules/astro-core/ephemeris.ts`) converts local→UTC via Luxon + IANA zone, which resolves the historical offset. Edge cases (region changed IANA zone; DST fall-back ambiguity; platform tz-data completeness) documented in `astro/spec.md` §5.