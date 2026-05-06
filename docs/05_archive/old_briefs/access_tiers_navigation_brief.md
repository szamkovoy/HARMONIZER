# Brief: Access Tiers and Navigation

Используй этот документ в новом чате, когда задача касается тарифов, feature gates, dev-переключателя, нижней навигации, профиля, заглушек upgrade modal или зависимости UI от тарифа.

## Цель

Сделать единую продуктовую модель доступа, чтобы любые модули проверяли не `free/premium` напрямую, а фичи:

- доступен ли персональный прогноз;
- доступна ли калибровка;
- доступен ли ИИ-ассистент;
- доступен ли каталог практик;
- доступны ли асаны;
- доступен ли вебинарный/community блок;
- какие вкладки нижней навигации показывать.

Оплату пока не подключаем. Нужен работающий dev-переключатель тарифов для тестирования.

## Продуктовые тарифы

### Free

Общие прогнозы на день. Цель: ежедневное возвращение в приложение и формирование привычки.

Доступно:

- общий прогноз дня;
- минимальный главный экран.

Недоступно:

- персональный прогноз;
- калибровка;
- ИИ-ассистент;
- каталог практик;
- асаны;
- вебинары/community.

### Oracle

То, что сейчас условно называется "Платный", но без ИИ-ассистента.

Доступно:

- индивидуальный прогноз по натальной карте;
- калибровка;
- цветок дня;
- рекомендации на день со всеми вариациями подробности.

Недоступно:

- обсуждение с ИИ-ассистентом для выбора практики;
- каталог практик как самостоятельный модуль, если не решим иначе;
- асаны;
- вебинары/community.

При клике на "Обсудить" показывать маленькое upgrade modal с предложением перейти на тариф выше.

### Practitioner

Все из Oracle плюс практики без асан.

Доступно:

- ИИ-ассистент;
- диалог до рекомендации практики;
- дыхательные практики;
- медитации;
- каталог практик, но раздел "Асаны" disabled.

Недоступно:

- запуск асан;
- вебинары/community.

### Master

Полная версия.

Доступно:

- все из Practitioner;
- около 200 практик асан из Vimeo;
- еженедельные вебинары / групповая обратная связь;
- будущий community/chat для вопросов к вебинару.

## Trial

При старте системы пользователь может получить полный функционал на 3 дня. Технически это не отдельный продуктовый тариф, а временный override:

- если `trial_expires_at > now()`, effective tier можно считать `master_trial` или `master`;
- UI может показывать "Пробный доступ";
- после окончания trial пользователь становится `free`, если нет оплаты.

На первом витке важно не смешивать trial с реальной подпиской. Лучше сделать функцию `getEffectiveAccess(profile)`.

## Предлагаемый слой доступа

Создать модуль `modules/access`:

- `core/tiers.ts`;
- `core/features.ts`;
- `core/access.ts`;
- `ui/UpgradeDialog.tsx`;
- `ui/DevTierSwitch.tsx`;
- `readme.md`.

Пример типов:

```ts
export type ProductTier = "free" | "oracle" | "practitioner" | "master";

export type FeatureKey =
  | "global_daily_forecast"
  | "personal_daily_forecast"
  | "calibration"
  | "assistant_dialog"
  | "practice_catalog"
  | "breath_practices"
  | "meditations"
  | "asana_practices"
  | "webinar_community"
  | "profile"
  | "stats";
```

Пример правил:

```ts
const TIER_FEATURES: Record<ProductTier, FeatureKey[]> = {
  free: ["global_daily_forecast", "profile"],
  oracle: ["global_daily_forecast", "personal_daily_forecast", "calibration", "profile"],
  practitioner: [
    "global_daily_forecast",
    "personal_daily_forecast",
    "calibration",
    "assistant_dialog",
    "practice_catalog",
    "breath_practices",
    "meditations",
    "profile",
    "stats",
  ],
  master: [
    "global_daily_forecast",
    "personal_daily_forecast",
    "calibration",
    "assistant_dialog",
    "practice_catalog",
    "breath_practices",
    "meditations",
    "asana_practices",
    "webinar_community",
    "profile",
    "stats",
  ],
};
```

## БД и совместимость

Сейчас в БД есть `users.membership_tier` с check `free | premium` и `trial_expires_at`.

На первом витке есть два пути:

1. Быстрый dev-путь: хранить выбранный dev tier локально или в `users` через существующее поле только условно.
2. Правильный путь: миграция `membership_tier` на `free | oracle | practitioner | master`.

Рекомендация: если задача именно тестировать UI и gates в ближайшие 1-2 дня, начать с `modules/access` и dev override. Миграцию сделать отдельным шагом, когда gates стабилизируются.

## Нижняя навигация

Текущий файл `app/(tabs)/_layout.tsx` скрывает tab bar.

Предлагаемая логика:

- Free: можно не показывать нижнюю навигацию или показывать только Profile, если нужен путь к тарифам/настройкам.
- Oracle: Home + Profile.
- Practitioner: Home + Practices + Profile.
- Master: Home + Practices + Webinar/Community + Profile.

Практический первый виток:

- включить вкладки Home, Practices, Profile;
- Webinar/Community оставить скрытой или disabled для всех, кроме Master;
- если Free/Oracle без вкладок выглядят тупиково, оставить Profile как доступную вкладку на всех тарифах.

## Profile на первом витке

Минимально:

- текущий тариф/effective access;
- dev-переключатель Free / Oracle / Practitioner / Master;
- кнопка refresh profile;
- место под будущую палитру;
- место под будущую статистику.

На втором витке:

- изменение даты/времени/места рождения;
- перекалибровка;
- простая статистика минут практики по дням.

## Upgrade modals

Нужен единый компонент, который принимает:

- `feature`;
- `requiredTier`;
- `onClose`;
- `onDetails`.

Тексты пока можно сделать временными. Важно, чтобы все закрытые функции показывали один и тот же тип модального окна, а не разные Alert по проекту.

## Точки проверки доступа

Первый виток:

- кнопка обсуждения на главном экране: `assistant_dialog`;
- вход в каталог практик: `practice_catalog`;
- раздел "Асаны": `asana_practices`;
- вкладка Webinar/Community: `webinar_community`;
- персональный прогноз/калибровка: `personal_daily_forecast`, `calibration`.

Второй виток:

- backend endpoints должны тоже проверять доступ, иначе UI-gates можно обойти.

## Вопросы перед реализацией

- Показывать ли Profile вкладку на Free/Oracle, или держать все управление тарифом на главном экране?
- Нужно ли на первом витке менять Supabase `membership_tier`, или достаточно dev override?
- Как называем тарифы в UI: "Оракул", "Практик", "Мастер" или временно оставляем технические?
- Должен ли trial считаться визуально Master или отдельным состоянием "Пробный доступ"?

## Критерии приемки первого витка

- Есть единая функция проверки доступности фичи.
- Dev-переключатель меняет effective tier без перезапуска приложения.
- Кнопка "Обсудить" закрыта для Oracle и ниже правильным modal.
- Каталог практик доступен только Practitioner/Master.
- Асаны доступны только Master или disabled с upgrade modal.
- Нижняя навигация меняется от тарифа.

