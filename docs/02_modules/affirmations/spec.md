---
id: 02_modules/affirmations/spec
title: Affirmations Spec
version: 1.1
updated: 2026-08-15
depends_on:
  [
    01_foundation/product_model,
    02_modules/subscription/spec,
    02_modules/practices/spec,
    02_modules/i18n/spec,
    02_modules/communicator/spec,
    02_modules/infra/spec,
  ]
code_refs:
  [
    modules/affirmations/index.ts,
    modules/affirmations/core/affirmationsClient.ts,
    modules/affirmations/ui/AffirmationWidget.tsx,
    modules/affirmations/ui/AffirmationCreateScreen.tsx,
    modules/affirmations/ui/AffirmationManageScreen.tsx,
    modules/affirmations/ui/AffirmationBreathOverlay.tsx,
    app/affirmation/create.tsx,
    app/affirmation/manage.tsx,
    modules/practices/ui/PracticeCatalogScreen.tsx,
    modules/breath/ui/CoherenceBreathScreen.tsx,
    modules/access/core/features.ts,
    _legacy_web/app/api/affirmations/route.ts,
    _legacy_web/app/api/affirmations/generate/route.ts,
    _legacy_web/app/api/affirmations/affirmationShared.ts,
    supabase/migrations/20260814040000_user_affirmations.sql,
  ]
---

## 1. Назначение

Персональная аффирмация (Sankalpa): голосовой подбор → LLM-варианты → 30-дневный цикл с оверлеем в дыхательной практике (текст на выдохе, опционально свой голос).

## 2. Публичный контракт

### Доступ

- `FeatureKey` **`affirmations`** → tier **master** (trial как master).
- Гейт: `AccountGateDialog` + `gate.body.affirmation` (мягкая формулировка про дыхательные практики / кабинет).

### Клиент (`modules/affirmations`)

- **`AffirmationWidget`** — на экране Практик **только** в группе «Дыхание»; add / «День X из 30»; без disabled/dim на время fetch.
- **Create wizard** — STT через communicator v2; таймаут Whisper масштабируется по размеру файла (60–120s ×2); hard-cap записи intake/refine **3 мин** с обратным отсчётом последние 20 с, затем auto-stop → STT; generate/refine; после обновления списка — scroll to top; Mic: фаза `arming` + защита от double-start; статус «Распознаём…» / «Подготовка аффирмаций…» вместо mic-hint под кнопкой. Finalize + optional voice (без лимита 3 мин). Закрытие: `FloatingCloseButton`.
- **Manage** — текст в карточке, «Прослушать» без наложений, MicRecordButton без подписи под микрофоном, график 4 равных зон A–D (буквы слева снаружи, как дни снизу), одна строка «Фазы освоения: A. …; … D. ….»; закрытие — текстовая «Закрыть».
- **`AffirmationBreathOverlay`** — intro/финал: hint как в конце; голос и панель одновременно за ~1с до выдоха по плану (`msInhaleToExhale`); fade-in ~280 ms / fade-out ~1 с + adaptive edge-trim; audio **warm** (disk cache + preloaded `Sound`) при загрузке / входе в finale, чтобы cue не ждал сеть; панель растворяется с `dimOpacity` практики; окно финала ≈4.2 цикла / 3 play.
- **Manage «Прослушать»** — тот же warm/cache; не качает signed URL на каждый tap.

### API (`_legacy_web/app/api/affirmations`)

| Method | Path | Назначение |
|---|---|---|
| GET/POST | `/api/affirmations` | active row / create (archives previous active) |
| POST | `/api/affirmations/generate` | Active `prompts.affirmation_generate` (+ `affirmation_refinement` при refine) → `getModelByHint` → ~10 строк |
| PATCH | `/api/affirmations/[id]` | text / audio / status / resetCycle |
| POST | `/api/affirmations/uploads` | signed upload → bucket `affirmation-audio` |
| POST | `/api/affirmations/practice-complete` | +1 day ≤1× localDate (idempotent) |

Сериализация: `affirmationShared.ts` (не экспортировать хелперы из `route.ts`).

### Данные

- Таблица `user_affirmations` (RLS own; partial unique one `active` per user).
- Bucket `affirmation-audio` private; `audio_url` = storage path.

## 3. i18n

Ключи `affirmation.*` + `gate.body.affirmation` в `modules/i18n/catalog` (8 локалей).

## 4. Ограничения

- Overlay не меняет ядро дыхательного таймера — только UI/audio поверх.
- «Последние 3 цикла» оцениваются по remaining time / avg cycleMs (практика time-based).
- Промпты generate/refine — в админке `/admin/prompts` (`affirmation_generate`, `affirmation_refinement`); код падает на константы в `api/affirmations/prompts.ts`, если строки нет в БД.
- LitRes page-curl книги — отдельный стек; не часть affirmations.
