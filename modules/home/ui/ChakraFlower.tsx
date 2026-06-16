import { useMemo } from "react";
import { StyleSheet, View } from "react-native";

import { chakraShortLabelDisplay, type ChakraLocale } from "@/modules/chakra/i18n";
import type { DailyForecast, Planet, TodayTone } from "@/modules/daily-engine";
import type { HomeStrings } from "@/modules/home/i18n/home";
import { getPlanetChakraMap } from "@/modules/home/planetChakra";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";
import { PLANET_ORDER } from "../planetChakra";

interface ChakraFlowerProps {
  forecast: DailyForecast;
  strings: HomeStrings;
}

function selectedGlowOpacity(tone: TodayTone): number {
  if (tone === "harmonic") return 0.34;
  if (tone === "dissonant") return 0.62;
  return 0.32;
}

function normalizedImportance(importance: Record<Planet, number>, planet: Planet): number {
  const max = Math.max(...PLANET_ORDER.map((p) => importance[p] ?? 0), 0.01);
  return Math.max(0.18, Math.min(1, (importance[planet] ?? 0) / max));
}

function petalOpacity(tone: TodayTone, selected: boolean, normalized: number): number {
  if (!selected) return 0.42 + normalized * 0.26;
  if (tone === "dissonant") return 0.86;
  if (tone === "harmonic") return 0.96;
  return 0.9;
}

function hexToRgba(hex: string, opacity: number): string {
  const clean = hex.replace("#", "");
  const value = Number.parseInt(clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

export function ChakraFlower({ forecast, strings }: ChakraFlowerProps) {
  const theme = useTheme();
  const chakraLocale: ChakraLocale = strings.locale;
  const planetChakra = useMemo(() => getPlanetChakraMap(chakraLocale), [chakraLocale]);
  const center = 124;
  const startAngle = 360 / PLANET_ORDER.length;
  const { importance, planetOfTheDay } = forecast;
  const todayTone = forecast.todayPlanetState.todayTone;
  const selectedMeta = planetChakra[planetOfTheDay];

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
          <AppText variant="sectionTitle">{strings.chakraFlower.title}</AppText>
          <AppText variant="technicalCaption" tone="muted" style={styles.caption}>
            {strings.chakraFlower.caption}
          </AppText>
        </View>
      </View>

      <View style={styles.flowerBody}>
        <View style={styles.flowerWrap}>
          <View style={styles.flowerCanvas} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {PLANET_ORDER.map((planet, index) => {
              const meta = planetChakra[planet];
              const n = normalizedImportance(importance, planet);
              const isSelected = planet === planetOfTheDay;
              const width = 42 + n * 22;
              const length = 76 + n * 48;
              const angle = startAngle * (index + 1);
              const opacity = petalOpacity(todayTone, isSelected, n);
              const borderColor = isSelected && todayTone === "dissonant" ? "rgba(17, 24, 39, 0.75)" : hexToRgba(meta.color, 0.95);
              return (
                <View
                  key={planet}
                  pointerEvents="none"
                  style={[
                    styles.petalLayer,
                    {
                      transform: [{ rotate: `${angle}deg` }],
                    },
                  ]}
                >
                  {isSelected ? (
                    <View
                      style={[
                        styles.petalGlow,
                        {
                          backgroundColor: meta.color,
                          height: length + 30,
                          left: center - (width + 20) / 2,
                          opacity: selectedGlowOpacity(todayTone),
                          top: center - length - 8,
                          width: width + 20,
                        },
                      ]}
                    />
                  ) : null}
                  <View
                    style={[
                      styles.petal,
                      {
                        backgroundColor: hexToRgba(meta.color, opacity),
                        borderColor,
                        borderWidth: isSelected ? 2 : 1,
                        height: length,
                        left: center - width / 2,
                        top: center - length + 24,
                        width,
                      },
                    ]}
                  />
                  <View
                    style={[
                      styles.petalNumberWrap,
                      {
                        left: center - 12,
                        top: center - length + 38,
                      },
                    ]}
                  >
                    <AppText
                      variant="technicalCaption"
                      style={[
                        styles.petalNumber,
                        {
                          color: isSelected ? theme.colors.textPrimary : "rgba(255,255,255,0.82)",
                          transform: [{ rotate: `-${angle}deg` }],
                        },
                      ]}
                    >
                      {meta.chakraNumber}
                    </AppText>
                  </View>
                </View>
              );
            })}
            <View
              style={[
                styles.centerOuter,
                {
                  backgroundColor: theme.colors.screenBg,
                  borderColor: hexToRgba(selectedMeta.color, 0.24),
                },
              ]}
            />
            <View
              style={[
                styles.centerInner,
                {
                  backgroundColor: selectedMeta.color,
                },
              ]}
            />
          </View>
        </View>
        <View style={styles.legend}>
          {PLANET_ORDER.map((planet) => {
            const meta = planetChakra[planet];
            const active = planet === planetOfTheDay;
            return (
              <View key={planet} style={styles.legendRow}>
                <View style={[styles.legendDot, { backgroundColor: meta.color, opacity: active ? 1 : 0.65 }]} />
                <AppText variant="technicalCaption" tone={active ? "primary" : "muted"} style={styles.legendText}>
                  {meta.chakraNumber} - {chakraShortLabelDisplay(chakraLocale, meta.chakraNumber)}
                </AppText>
              </View>
            );
          })}
        </View>
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 24,
    padding: 18,
    gap: 14,
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
  flowerBody: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
    justifyContent: "center",
  },
  flowerWrap: {
    alignItems: "center",
    justifyContent: "center",
  },
  flowerCanvas: {
    height: 248,
    position: "relative",
    width: 248,
  },
  petalLayer: {
    height: 248,
    left: 0,
    position: "absolute",
    top: 0,
    width: 248,
  },
  petal: {
    borderRadius: 999,
    position: "absolute",
  },
  petalGlow: {
    borderRadius: 999,
    position: "absolute",
  },
  petalNumberWrap: {
    alignItems: "center",
    height: 24,
    justifyContent: "center",
    position: "absolute",
    width: 24,
  },
  petalNumber: {
    fontWeight: "700",
    textAlign: "center",
  },
  centerOuter: {
    borderRadius: 41,
    borderWidth: 1,
    height: 82,
    left: 83,
    opacity: 0.92,
    position: "absolute",
    top: 83,
    width: 82,
  },
  centerInner: {
    borderRadius: 27,
    height: 54,
    left: 97,
    opacity: 0.84,
    position: "absolute",
    top: 97,
    width: 54,
  },
  legend: {
    gap: 7,
    minWidth: 132,
  },
  legendRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7,
  },
  legendDot: {
    borderRadius: 999,
    height: 9,
    width: 9,
  },
  legendText: {
    lineHeight: 15,
  },
});
