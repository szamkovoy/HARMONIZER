# PATCH 15 [P1]: Math Level UI + опциональная отрисовка карты

> **Версия:** 1
> **Зависимости:** PATCH 13 (мат-уровень уже формируется в `mathLevelBuilder.ts`), PATCH 14 (математика для бесплатного тарифа)
> **Цель:** UI-слой для просмотра математических расчётов и опциональная визуализация натальной/транзитной карты SVG.

## Что решает

PATCH 13 ввёл `buildMathLevel()` который формирует структурированный мат-блок. PATCH 14 — для бесплатного тарифа. Этот патч даёт **UI**, через который пользователь может это всё увидеть, плюс опциональную визуализацию натальной карты.

## Архитектурный принцип

**Вложенные модальные окна** (по вашему выбору):

```
Главная страница
  │
  └─ Кнопка "Подробнее" под рекомендацией
      │
      └─ Модальное окно: РАЗВЁРНУТЫЕ РЕКОМЕНДАЦИИ (long_explanation)
          │
          └─ Кнопка "Расчёты и формулы"
              │
              └─ Модальное окно: МАТЕМАТИКА
                  │
                  └─ (опц.) Кнопка "Показать натальную карту"
                      │
                      └─ Модальное окно: SVG-КАРТА
```

Каждое окно закрывается одним нажатием — стандартный iOS/Android-паттерн. Углубление по желанию.

---

## 1. UI-структура модальных окон

### 1.1. ModalLongExplanation

```tsx
// modules/home-screen/modals/ModalLongExplanation.tsx

interface ModalLongExplanationProps {
  visible: boolean;
  onClose: () => void;
  longExplanation: string;
  onOpenMath: () => void;  // открыть следующий уровень
}

export function ModalLongExplanation({ visible, onClose, longExplanation, onOpenMath }: ModalLongExplanationProps) {
  return (
    <Modal visible={visible} onRequestClose={onClose} animationType="slide">
      <SafeAreaView style={styles.container}>
        <Header title="Подробнее" onClose={onClose} />
        <ScrollView style={styles.scroll}>
          <MarkdownRenderer source={longExplanation} />
          
          <Pressable onPress={onOpenMath} style={styles.deepLink}>
            <Text style={styles.deepLinkText}>
              Расчёты и формулы →
            </Text>
            <Text style={styles.deepLinkSubtext}>
              Точная математика силы и гармоничности планет, веса аспектов
            </Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
```

### 1.2. ModalMathLevel

```tsx
// modules/home-screen/modals/ModalMathLevel.tsx

interface ModalMathLevelProps {
  visible: boolean;
  onClose: () => void;
  mathLevel: { markdown: string; structured: any };
  natalProfile?: NatalProfile;        // опционально, для отрисовки карты
  forecast?: DailyForecast;           // опционально, для транзитной карты
  userTier: "free" | "trial" | "paid";
}

export function ModalMathLevel({ 
  visible, onClose, mathLevel, natalProfile, forecast, userTier 
}: ModalMathLevelProps) {
  const [showChart, setShowChart] = useState(false);
  
  // Для бесплатных карта недоступна (нет натальной карты)
  const canShowChart = userTier !== "free" && natalProfile;
  
  return (
    <Modal visible={visible} onRequestClose={onClose} animationType="slide">
      <SafeAreaView style={styles.container}>
        <Header title="Математика дня" onClose={onClose} />
        <ScrollView style={styles.scroll}>
          <MarkdownRenderer source={mathLevel.markdown} />
          
          {canShowChart && (
            <Pressable onPress={() => setShowChart(true)} style={styles.chartLink}>
              <Text style={styles.chartLinkText}>
                Показать натальную и транзитную карту →
              </Text>
            </Pressable>
          )}
        </ScrollView>
      </SafeAreaView>
      
      {canShowChart && (
        <ModalAstroChart
          visible={showChart}
          onClose={() => setShowChart(false)}
          natalProfile={natalProfile!}
          forecast={forecast}
        />
      )}
    </Modal>
  );
}
```

### 1.3. ModalAstroChart (опциональная SVG-карта)

```tsx
// modules/home-screen/modals/ModalAstroChart.tsx

interface ModalAstroChartProps {
  visible: boolean;
  onClose: () => void;
  natalProfile: NatalProfile;
  forecast?: DailyForecast;  // если есть — рисуем двойную карту
}

export function ModalAstroChart({ visible, onClose, natalProfile, forecast }: ModalAstroChartProps) {
  const showHouses = natalProfile.precision_mode === "precise";
  
  return (
    <Modal visible={visible} onRequestClose={onClose} animationType="slide">
      <SafeAreaView style={styles.container}>
        <Header 
          title={forecast ? "Натальная + транзитная карта" : "Натальная карта"} 
          onClose={onClose} 
        />
        <ScrollView style={styles.scroll}>
          <AstroChartSVG
            natalProfile={natalProfile}
            transitPositions={forecast?.transit_chart}
            showHouses={showHouses}
            size={Dimensions.get("window").width - 40}
          />
          
          {!showHouses && (
            <Text style={styles.note}>
              Дома не показаны: время рождения известно с точностью больше 33 минут.
            </Text>
          )}
          
          {forecast && (
            <View style={styles.aspectsList}>
              <Text style={styles.sectionTitle}>Главные аспекты дня</Text>
              {forecast.main_transits && Object.entries(forecast.main_transits).map(([planet, info]: [string, any]) => 
                info?.transit_planet && (
                  <Text key={planet} style={styles.aspectLine}>
                    {info.transit_planet} {info.aspect_type} к натальному {planet} (орб {info.orb?.toFixed(1)}°)
                  </Text>
                )
              )}
            </View>
          )}
          
          <View style={styles.legendList}>
            <Text style={styles.sectionTitle}>Силы планет</Text>
            {Object.entries(natalProfile.planets).map(([planet, data]: [string, any]) => (
              <Text key={planet} style={styles.legendLine}>
                {planet}: S = {data.S_initial.toFixed(2)}, H = {data.H_initial.toFixed(2)}
              </Text>
            ))}
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}
```

---

## 2. Компонент AstroChartSVG

Базовая отрисовка зодиакального круга с планетами и аспектами. Дома — только при `showHouses = true`.

```tsx
// modules/home-screen/components/AstroChartSVG.tsx

import Svg, { Circle, Line, G, Text as SvgText, Path } from "react-native-svg";

interface AstroChartSVGProps {
  natalProfile: NatalProfile;
  transitPositions?: Record<string, { lon: number }>;  // для двойной карты
  showHouses: boolean;
  size: number;
}

const ZODIAC_SIGNS = [
  { name: "Aries", symbol: "♈", color: "#E74C3C" },
  { name: "Taurus", symbol: "♉", color: "#27AE60" },
  // ... всего 12
  { name: "Pisces", symbol: "♓", color: "#3498DB" },
];

const PLANET_SYMBOLS: Record<string, string> = {
  Sun: "☉", Moon: "☽", Mercury: "☿", Venus: "♀", Mars: "♂", 
  Jupiter: "♃", Saturn: "♄"
};

export function AstroChartSVG({ natalProfile, transitPositions, showHouses, size }: AstroChartSVGProps) {
  const cx = size / 2;
  const cy = size / 2;
  const outerRadius = size / 2 - 10;
  const innerRadius = transitPositions ? outerRadius - 60 : outerRadius - 30;
  const housesRadius = innerRadius - 20;
  
  // Помощник: longitude → угол на круге (0° Овна = направление "9 часов" на циферблате, против часовой)
  const lonToAngle = (lon: number) => {
    return ((180 - lon) % 360) * (Math.PI / 180);
  };
  
  const lonToXY = (lon: number, radius: number) => {
    const angle = lonToAngle(lon);
    return {
      x: cx + radius * Math.cos(angle),
      y: cy - radius * Math.sin(angle),
    };
  };
  
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {/* Внешнее кольцо — знаки зодиака */}
      <Circle cx={cx} cy={cy} r={outerRadius} fill="none" stroke="#888" strokeWidth={1} />
      <Circle cx={cx} cy={cy} r={outerRadius - 25} fill="none" stroke="#888" strokeWidth={1} />
      
      {/* Деления знаков (12 штук, каждые 30°) */}
      {ZODIAC_SIGNS.map((sign, i) => {
        const startAngle = i * 30;
        const labelLon = startAngle + 15;
        const labelXY = lonToXY(labelLon, outerRadius - 12);
        const endXY = lonToXY(startAngle, outerRadius);
        const startXY = lonToXY(startAngle, outerRadius - 25);
        return (
          <G key={sign.name}>
            <Line x1={startXY.x} y1={startXY.y} x2={endXY.x} y2={endXY.y} stroke="#888" />
            <SvgText 
              x={labelXY.x} y={labelXY.y} 
              fontSize="14" 
              textAnchor="middle" 
              fill={sign.color}
              alignmentBaseline="middle"
            >
              {sign.symbol}
            </SvgText>
          </G>
        );
      })}
      
      {/* Дома — только если showHouses */}
      {showHouses && natalProfile.house_cusps && natalProfile.house_cusps.map((cusp, i) => {
        const cuspXY = lonToXY(cusp, housesRadius);
        const innerXY = lonToXY(cusp, 20);
        const labelXY = lonToXY(cusp + 15, housesRadius - 15);
        return (
          <G key={`house-${i}`}>
            <Line 
              x1={innerXY.x} y1={innerXY.y} 
              x2={cuspXY.x} y2={cuspXY.y} 
              stroke="#aaa" 
              strokeWidth={i === 0 || i === 6 ? 2 : 1}  // ASC/DSC жирнее
            />
            <SvgText 
              x={labelXY.x} y={labelXY.y} 
              fontSize="10" 
              fill="#aaa" 
              textAnchor="middle"
            >
              {i + 1}
            </SvgText>
          </G>
        );
      })}
      
      {/* Натальные планеты (внутреннее кольцо) */}
      {Object.entries(natalProfile.planets).map(([planet, data]: [string, any]) => {
        const xy = lonToXY(data.longitude, innerRadius);
        return (
          <SvgText 
            key={`natal-${planet}`}
            x={xy.x} y={xy.y} 
            fontSize="20" 
            textAnchor="middle" 
            alignmentBaseline="middle"
            fill="#333"
          >
            {PLANET_SYMBOLS[planet]}
          </SvgText>
        );
      })}
      
      {/* Транзитные планеты (внешнее кольцо, если переданы) */}
      {transitPositions && Object.entries(transitPositions).map(([planet, data]: [string, any]) => {
        const xy = lonToXY(data.lon, outerRadius - 35);
        return (
          <SvgText 
            key={`transit-${planet}`}
            x={xy.x} y={xy.y} 
            fontSize="18" 
            textAnchor="middle" 
            alignmentBaseline="middle"
            fill="#C0392B"
          >
            {PLANET_SYMBOLS[planet]}
          </SvgText>
        );
      })}
      
      {/* Главные аспекты — линии в центре */}
      {/* (опц.: пропустить, если отрисовка слишком сложная — можно оставить только список) */}
    </Svg>
  );
}
```

**Зависимости:** `react-native-svg` (уже скорее всего стоит, проверить).

---

## 3. Поле house_cusps в natal profile

Для отрисовки домов нужны их кусписы. Если их нет в текущей схеме `user_natal_charts`, добавить:

```sql
-- Уже могут быть в planets jsonb. Если нет — добавить отдельное поле.
-- Проверьте текущую структуру перед миграцией.

-- Если нужно добавить:
-- (этот ALTER нужен только если house_cusps ещё не хранится)
-- ALTER TABLE public.user_natal_charts 
-- ADD COLUMN IF NOT EXISTS house_cusps jsonb;
-- 
-- COMMENT ON COLUMN public.user_natal_charts.house_cusps IS 
-- 'Array of 12 house cusps in degrees (0-360). Stored only if precision_mode=precise.';
```

В `M1 computeNatalProfile.ts` добавить расчёт `house_cusps` (Whole Sign по ASC если `precision_mode = precise`).

⚠️ **ИНСТРУКЦИЯ ДЛЯ CURSOR:** Сначала проверить существующую структуру `user_natal_charts.planets` — возможно, кусписы уже хранятся внутри jsonb. Если да — использовать существующее, не дублировать.

---

## 4. Интеграция с главной страницей

```tsx
// modules/home-screen/HomeScreen.tsx

export function HomeScreen() {
  const { content } = useDayContent();
  const user = useUser();
  const natalProfile = useNatalProfile();  // null если бесплатный
  const forecast = useDailyForecast();      // null если бесплатный
  
  const [modalLevel, setModalLevel] = useState<"none" | "long" | "math" | "chart">("none");
  
  if (!content) return <LoadingScreen />;
  
  return (
    <ScrollView>
      {/* Слоган сверху */}
      <DateAndSlogan slogan={content.slogan} />
      
      {/* Цветок дня */}
      <DayFlower data={content.top_petals} />
      
      {/* Короткая рекомендация */}
      <View style={styles.recommendation}>
        <Text style={styles.shortText}>{content.short_text}</Text>
        <Pressable onPress={() => setModalLevel("long")} style={styles.moreButton}>
          <Text style={styles.moreButtonText}>Подробнее →</Text>
        </Pressable>
      </View>
      
      {/* Окна возможностей */}
      <WindowsOfOpportunityChart {...windowsProps} />
      
      {/* Кнопка "Что делать?" — открывает Communicator (диалог) */}
      <Pressable onPress={openCommunicator} style={styles.actionButton}>
        <Text>Что делать?</Text>
      </Pressable>
      
      {/* Модальные окна */}
      <ModalLongExplanation
        visible={modalLevel === "long"}
        onClose={() => setModalLevel("none")}
        longExplanation={content.long_explanation}
        onOpenMath={() => setModalLevel("math")}
      />
      
      <ModalMathLevel
        visible={modalLevel === "math"}
        onClose={() => setModalLevel("long")}  // возврат на предыдущее окно
        mathLevel={content.math_level}
        natalProfile={natalProfile ?? undefined}
        forecast={forecast ?? undefined}
        userTier={user.tier}
      />
    </ScrollView>
  );
}
```

**Логика закрытия:** `ModalMathLevel.onClose` возвращает на `long`, не закрывает оба сразу. Пользователь:
- Нажимает «Подробнее» — открывается long.
- Из long нажимает «Расчёты и формулы» — открывается math (long остаётся под ним).
- Закрывает math — видит снова long.
- Закрывает long — возвращается на главную.

Это интуитивно — стандартный паттерн iOS-навигации.

---

## 5. Frontend client для math level

Math level уже приходит вместе с морнинг-контентом (PATCH 13). Никаких дополнительных запросов:

```typescript
// services/aiClient.ts
// уже возвращает { slogan, short_text, long_explanation, math_level } — ничего не меняем
```

Для бесплатного пользователя `math_level` приходит из endpoint `/api/ai/global-content` (PATCH 14).

---

## 6. Оптимизация: lazy loading отрисовки карты

Карта SVG — относительно тяжёлый компонент. Загружать его **только** когда пользователь нажмёт кнопку:

```tsx
import { lazy, Suspense } from "react";

const ModalAstroChart = lazy(() => import("./modals/ModalAstroChart"));

// в ModalMathLevel:
{showChart && (
  <Suspense fallback={<LoadingScreen />}>
    <ModalAstroChart {...props} />
  </Suspense>
)}
```

---

## 7. Тестирование

### 7.1. Unit-тесты для AstroChartSVG

```tsx
import { render } from "@testing-library/react-native";
import { AstroChartSVG } from "./AstroChartSVG";

describe("AstroChartSVG", () => {
  it("renders without houses if precision_mode is approximate", () => {
    const profile = { 
      precision_mode: "approximate", 
      house_cusps: null, 
      planets: { Sun: { longitude: 100 }, /*...*/ } 
    } as any;
    
    const { queryByText } = render(<AstroChartSVG natalProfile={profile} showHouses={false} size={300} />);
    // Дом 1 не должен присутствовать
    expect(queryByText("1")).toBeNull();
  });
  
  it("renders all 7 planets", () => {
    const profile = { 
      planets: { Sun: { longitude: 100 }, Moon: { longitude: 50 }, /*...*/ }, 
      house_cusps: null 
    } as any;
    
    const { getByText } = render(<AstroChartSVG natalProfile={profile} showHouses={false} size={300} />);
    expect(getByText("☉")).toBeTruthy();
    expect(getByText("☽")).toBeTruthy();
    // ...
  });
});
```

### 7.2. UX-тесты

1. На главной нажать «Подробнее» → открывается ModalLongExplanation.
2. В ModalLongExplanation нажать «Расчёты и формулы» → открывается ModalMathLevel.
3. В ModalMathLevel у платного пользователя есть кнопка «Показать карту».
4. У бесплатного пользователя кнопки карты нет.
5. Закрытие math возвращает на long, не на главную.

---

## 8. Доступность математики для бесплатных

Бесплатные пользователи получают `math_level` из `global_daily_content` — это **общая** математика (положение планет на день, аспекты между транзитными планетами), без расчётов сил по натальной карте пользователя.

Структура `global_daily_content.math_level`:

```json
{
  "markdown": "## Математика дня\n\nПоложение планет на 12:00 UTC...\n\n### Главные аспекты:\n- Юпитер ⚹ Сатурн (трин, орб 1.2°)\n...",
  "structured": {
    "planet_positions": { "Sun": { "lon": 180.5, "sign": "Libra" }, ... },
    "aspects": [...],
    "primary_planet": "Saturn",
    "primary_tone": "harmonic"
  }
}
```

Для платного — структура из `buildMathLevel()` (PATCH 13) включает дополнительно силы натальных планет, дельты калибровки и т.д.

UI компонент `ModalMathLevel` использует `mathLevel.markdown` напрямую — рендерит как markdown. Это работает в обоих случаях.

---

## 9. Опциональное улучшение: отрисовка аспектов в карте

Если хочется более красивый чарт — добавить в SVG отрисовку линий аспектов в центре круга:

```tsx
// Внутри AstroChartSVG, добавить после секции с планетами:

{forecast?.main_transits && Object.entries(forecast.main_transits).map(([natalPlanet, info]: [string, any]) => {
  if (!info?.transit_planet) return null;
  
  const fromXY = lonToXY(natalProfile.planets[natalPlanet].longitude, innerRadius);
  const transitLon = transitPositions?.[info.transit_planet]?.lon;
  if (transitLon === undefined) return null;
  const toXY = lonToXY(transitLon, outerRadius - 35);
  
  const aspectColor = {
    trine: "#27AE60", sextile: "#3498DB",  // гармоничные
    square: "#E74C3C", opposition: "#C0392B",  // напряжённые
    conjunction: "#888"  // нейтральный
  }[info.aspect_type] ?? "#888";
  
  return (
    <Line
      key={`aspect-${natalPlanet}-${info.transit_planet}`}
      x1={fromXY.x} y1={fromXY.y}
      x2={toXY.x} y2={toXY.y}
      stroke={aspectColor}
      strokeWidth={1.5}
      strokeOpacity={0.6}
      strokeDasharray={info.aspect_type === "square" || info.aspect_type === "opposition" ? "4 2" : undefined}
    />
  );
})}
```

Это добавляет визуальную глубину карты — пользователь видит, какие планеты «дружат» (гармоничные линии) и какие «спорят» (напряжённые).

---

## 10. Инструкции для Cursor

### Что НЕ менять

- ❌ Не упрощать структуру модальных окон до одного экрана.
- ❌ Не убирать ограничение на показ домов (только при precise).
- ❌ Не показывать карту бесплатным пользователям (у них нет натальной карты).

### Право на адаптацию

- Если в проекте нет `react-native-svg` — установить (`npx expo install react-native-svg`).
- Если уже есть свой компонент чарта — использовать его, не переписывать.
- Цвета знаков зодиака можно адаптировать под общую палитру приложения.

### Порядок применения

1. Проверить, что `house_cusps` доступен в `user_natal_charts.planets` (или добавить отдельное поле).
2. Создать `AstroChartSVG.tsx`.
3. Создать три модальных окна: Long, Math, Chart.
4. Интегрировать в `HomeScreen` — кнопка «Подробнее», логика стека модалов.
5. Smoke-тест: пройти весь путь Home → Long → Math → Chart → закрыть.

---

## 11. Критерий приёмки

- ✅ ModalLongExplanation, ModalMathLevel, ModalAstroChart реализованы.
- ✅ Кнопка «Подробнее» на главной открывает long.
- ✅ Кнопка «Расчёты и формулы» в long открывает math.
- ✅ Закрытие math возвращает на long, не на главную.
- ✅ AstroChartSVG отрисовывает 12 знаков, 7 планет.
- ✅ Дома показываются только при `precision_mode = precise`.
- ✅ Транзитные планеты (если переданы) отрисовываются на внешнем кольце.
- ✅ Бесплатным пользователям не показывается кнопка «Показать карту».
- ✅ Все unit-тесты проходят.
