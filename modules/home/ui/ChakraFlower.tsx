import { StyleSheet, View } from "react-native";
import Svg, { Circle, Ellipse, G } from "react-native-svg";

import type { Planet, TodayTone } from "@/modules/daily-engine";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";
import { PLANET_CHAKRA, PLANET_LABELS, PLANET_ORDER, toneLabel } from "../planetChakra";

interface ChakraFlowerProps {
  importance: Record<Planet, number>;
  planetOfTheDay: Planet;
  todayTone: TodayTone;
}

function glowOpacity(tone: TodayTone): number {
  if (tone === "harmonic") return 0.42;
  if (tone === "dissonant") return 0.58;
  return 0.32;
}

function normalizedImportance(importance: Record<Planet, number>, planet: Planet): number {
  const max = Math.max(...PLANET_ORDER.map((p) => importance[p] ?? 0), 0.01);
  return Math.max(0.08, Math.min(1, (importance[planet] ?? 0) / max));
}

export function ChakraFlower({ importance, planetOfTheDay, todayTone }: ChakraFlowerProps) {
  const theme = useTheme();
  const center = 130;
  const petalCy = 62;
  const selectedMeta = PLANET_CHAKRA[planetOfTheDay];

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.surfaceBorder,
        },
      ]}
    >
      <View style={styles.titleRow}>
        <View>
          <AppText variant="sectionTitle">Цветок состояния</AppText>
          <AppText variant="technicalCaption" tone="muted" style={styles.caption}>
            Размер лепестков отражает важность чакр на сегодня.
          </AppText>
        </View>
        <View style={[styles.pill, { borderColor: selectedMeta.color }]}>
          <AppText variant="statPillLabel">{toneLabel(todayTone)}</AppText>
        </View>
      </View>

      <View style={styles.flowerWrap}>
        <Svg width={260} height={260} viewBox="0 0 260 260">
          {PLANET_ORDER.map((planet, index) => {
            const meta = PLANET_CHAKRA[planet];
            const n = normalizedImportance(importance, planet);
            const isSelected = planet === planetOfTheDay;
            const rx = 21 + n * 13;
            const ry = 50 + n * 26;
            const angle = index * (360 / PLANET_ORDER.length);
            return (
              <G key={planet} transform={`rotate(${angle} ${center} ${center})`}>
                {isSelected ? (
                  <Ellipse
                    cx={center}
                    cy={petalCy}
                    rx={rx + 13}
                    ry={ry + 13}
                    fill={meta.color}
                    opacity={glowOpacity(todayTone)}
                  />
                ) : null}
                <Ellipse
                  cx={center}
                  cy={petalCy}
                  rx={rx}
                  ry={ry}
                  fill={meta.color}
                  opacity={isSelected ? 0.92 : 0.46 + n * 0.28}
                />
              </G>
            );
          })}
          <Circle cx={center} cy={center} r={37} fill="rgba(7,8,12,0.86)" />
          <Circle cx={center} cy={center} r={25} fill={selectedMeta.color} opacity={0.84} />
        </Svg>
      </View>

      <View style={styles.focus}>
        <AppText variant="screenHint" style={styles.focusText}>
          Сегодня в фокусе {selectedMeta.chakraName}: {selectedMeta.label}
        </AppText>
        <AppText variant="technicalCaption" tone="muted" style={styles.focusText}>
          Планета дня: {PLANET_LABELS[planetOfTheDay]}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 24,
    padding: 18,
    gap: 12,
  },
  titleRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  caption: {
    marginTop: 4,
  },
  pill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  flowerWrap: {
    alignItems: "center",
    justifyContent: "center",
  },
  focus: {
    alignItems: "center",
    gap: 3,
  },
  focusText: {
    textAlign: "center",
  },
});
