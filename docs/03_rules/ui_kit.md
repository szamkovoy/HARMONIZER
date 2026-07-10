---
id: 03_rules/ui_kit
title: Ui Kit
version: 1.1
updated: 2026-06-24
depends_on: [01_foundation/tech_stack, 02_modules/infra/spec]
code_refs:
  [
    modules/ui/theme.ts,
    modules/ui/AppButton.tsx,
    modules/ui/AppText.tsx,
    modules/ui/AppDialog.tsx,
    modules/ui/TabScreenLayout.tsx,
    modules/ui/StackScreenLayout.tsx,
    modules/ui/FloatingCloseButton.tsx,
    modules/ui/FullScreenModalScaffold.tsx,
    modules/ui/AssistantModalShell.tsx,
    modules/ui/ImmersiveScreenLayout.tsx,
    modules/ui/useImmersiveOverlayAutohide.ts,
    modules/ui/PracticeStopConfirmDialog.tsx,
    modules/ui/ScreenHeader.tsx,
    modules/ui/ScreenSection.tsx,
    modules/ui/SurfaceCardView.tsx,
    modules/ui/SurfaceHelpModal.tsx,
    modules/ui/ModalHeaderCloseButton.tsx,
    modules/ui/StateCard.tsx,
    modules/ui/useTabContentBottomPadding.ts,
    modules/ui/useCompactTabBarStyle.ts,
    app/(tabs)/_layout.tsx,
  ]
---

## Назначение

Этот файл фиксирует правило владения типовым UI-слоем: дизайн-токены,
экранные шаблоны и повторяющиеся surface/header/state-паттерны должны жить в
`modules/ui/`, а не размножаться по доменным экранам.

## Источники истины

- **Токены темы:** `modules/ui/theme.ts`
- **Базовый текст:** `modules/ui/AppText.tsx`
- **Базовая кнопка:** `modules/ui/AppButton.tsx`
- **Диалог:** `modules/ui/AppDialog.tsx`
- **Tab-shell и scroll helpers:** `modules/ui/TabScreenLayout.tsx`
- **Non-tab screen shells:** `modules/ui/StackScreenLayout.tsx` (`StackScreenLayout`, `ModalScreenLayout`, `FormScreenLayout`, `HeroScreenLayout`, `StackScrollView`)
- **Fullscreen modal scaffold:** `modules/ui/FullScreenModalScaffold.tsx`
- **Assistant fullscreen shell:** `modules/ui/AssistantModalShell.tsx`
- **Floating close control:** `modules/ui/FloatingCloseButton.tsx`
- **Стандартный header:** `modules/ui/ScreenHeader.tsx`
- **Section/header primitives:** `modules/ui/ScreenSection.tsx`
- **Типовая surface-card:** `modules/ui/SurfaceCardView.tsx`
- **Help «?» + модалка подсказки:** `SurfaceCardTitleRow` / `SurfaceCardHelpButton` → `SurfaceHelpModal` (заголовок + ×, текст, «Закрыть»)
- **Типовые loading/error/empty state:** `modules/ui/StateCard.tsx`
- **Bottom padding под tab bar:** `modules/ui/useTabContentBottomPadding.ts` — только небольшой `extra`-gap; tab navigator сам inset-ит контент над bar, полная высота bar в padding не добавляется.
- **Компактная нижняя панель вкладок:** `modules/ui/useCompactTabBarStyle.ts` + `app/(tabs)/_layout.tsx` — уменьшенная высота bar (иконка+лейбл ближе к нижнему краю); safe-area inset сохраняется через `paddingBottom`.
- **Immersive chrome layer:** `modules/ui/ImmersiveScreenLayout.tsx`, `modules/ui/useImmersiveOverlayAutohide.ts`, `modules/ui/PracticeStopConfirmDialog.tsx`

## Правила

1. **Типовой экранный каркас не задаётся локально.**  
   Safe area, `StatusBar`, scroll-container для вкладок, `scrollIndicatorInsets`,
   нижний отступ под tab bar, стандартная ширина контента, базовый `paddingTop: 20`
   и vertical rhythm должны идти через общие примитивы `modules/ui/*`.

   Для non-tab экранов это означает:
   - pushed screen → `StackScreenLayout` / `StackScrollView`
   - fullscreen modal / centered card → `ModalScreenLayout` или `FormScreenLayout`
   - auth / onboarding hero-surface → `HeroScreenLayout`

2. **Типовой header не копируется вручную.**  
   Паттерн `screenTitle + screenHint` должен собираться через `ScreenHeader`,
   если экран не является осознанным исключением (например hero-header на Home).

   Для локальных секций внутри surface-блоков использовать `SectionHeader` /
   `ScreenSection`, а не повторять `View + AppText + gap`.

3. **Типовые карточки не собираются из `View + borderColor + backgroundColor` вручную.**  
   Для стандартных surface-блоков использовать `SurfaceCardView`; локальные стили
   допустимы только для domain-specific layout внутри карточки.

4. **Loading / error / empty / hint состояния не дублируются между экранами.**  
   Если состояние визуально соответствует обычной карточке состояния, оно должно
   идти через `StateCard`.

5. **Изменения типового UI вносятся в shared layer первым делом.**  
   Если правка относится к классу элементов («все tab-экраны», «все state-card»,
   «все section headers»), сначала меняется общий примитив, а не отдельный экран.

6. **Локальные магические числа допустимы только для действительно уникального UX.**  
   Отступы, радиусы, `maxWidth`, gap и типографика для повторяющихся экранных паттернов
   не должны расходиться без явной причины.

7. **Fullscreen modal chrome не дублируется между экранами.**  
   Закрывающий header, fullscreen assistant modal, centered-card modal и похожие
   fullscreen explainer screens должны опираться на shared shells
   (`AssistantModalShell`, `FullScreenModalScaffold`, `ModalScreenLayout`), а не
   повторять локальные `Modal + header + close button`.

8. **Immersive practice screens унифицируют только chrome layer.**  
   Fullscreen background root, floating close, overlay auto-hide, stop-confirm
   dialog и похожий route-level chrome для дыхания/мандалы/асан должны жить в
   `modules/ui/`. Но product engines (PPG FSM, audio sync, breath timing,
   mandala render pipeline, post-session analytics) остаются внутри доменных модулей.

## Практический порядок

- Сначала ищи решение в `modules/ui/`.
- Если подходящего примитива нет, добавь его туда.
- Только потом подключай примитив в конкретных модулях (`home`, `daily_forecast`,
  `profile`, `practices` и т.д.).

## Явные исключения

- Immersive practice screens (`breath`, `mandala`, `biofeedback`) могут иметь
  отдельный каркас и не обязаны использовать tab-shell, но их fullscreen chrome
  всё равно должен стремиться к shared ownership в `modules/ui/`.
- Hero/header-решения уровня продукта могут оставаться специальными, но должны
  по возможности опираться на те же токены темы и текста.
