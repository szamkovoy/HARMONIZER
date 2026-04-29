import { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";

import type { DailyForecast, Planet, TodayTone } from "@/modules/daily-engine";
import type { HomeStrings } from "@/modules/home/i18n/home";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";
import { PLANET_CHAKRA, PLANET_ORDER } from "../planetChakra";

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
  return Math.max(0.08, Math.min(1, (importance[planet] ?? 0) / max));
}

function petalOpacity(tone: TodayTone, selected: boolean, normalized: number): number {
  if (!selected) return 0.36 + normalized * 0.28;
  if (tone === "dissonant") return 0.86;
  if (tone === "harmonic") return 0.96;
  return 0.9;
}

export function ChakraFlower({ forecast, strings }: ChakraFlowerProps) {
  const theme = useTheme();
  const pulse = useRef(new Animated.Value(0.82)).current;
  const center = 130;
  const petalCy = 62;
  const { importance, planetOfTheDay } = forecast;
  const todayTone = forecast.todayPlanetState.todayTone;
  const selectedMeta = PLANET_CHAKRA[planetOfTheDay];
  const selectedTone = strings.toneLabels[todayTone];

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1600,
          useNativeDriver: false,
        }),
        Animated.timing(pulse, {
          toValue: 0.82,
          duration: 1600,
          useNativeDriver: false,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

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
        <View style={[styles.pill, { borderColor: selectedMeta.color }]}>
          <AppText variant="statPillLabel">{selectedTone}</AppText>
        </View>
      </View>

      <View style={styles.flowerWrap}>
        <View style={styles.flowerCanvas} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {PLANET_ORDER.map((planet, index) => {
            const meta = PLANET_CHAKRA[planet];
            const n = normalizedImportance(importance, planet);
            const isSelected = planet === planetOfTheDay;
            const rx = 21 + n * 13;
            const ry = 50 + n * 26;
            const angle = index * (360 / PLANET_ORDER.length);
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
                  <Animated.View
                    style={[
                      styles.petal,
                      {
                        backgroundColor: meta.color,
                        height: (ry + 13) * 2,
                        left: center - (rx + 13),
                        opacity: pulse.interpolate({
                          inputRange: [0.82, 1],
                          outputRange: [selectedGlowOpacity(todayTone) * 0.72, selectedGlowOpacity(todayTone)],
                        }),
                        top: petalCy - (ry + 13),
                        width: (rx + 13) * 2,
                      },
                    ]}
                  />
                ) : null}
                <View
                  style={[
                    styles.petal,
                    {
                      backgroundColor: meta.color,
                      height: ry * 2,
                      left: center - rx,
                      opacity: petalOpacity(todayTone, isSelected, n),
                      top: petalCy - ry,
                      width: rx * 2,
                    },
                  ]}
                />
              </View>
            );
          })}
          <View
            style={[
              styles.centerOuter,
              {
                backgroundColor: theme.colors.screenBg,
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

      <View style={styles.focus}>
        <AppText variant="screenHint" style={styles.focusText}>
          {strings.chakraFlower.focus(selectedMeta.chakraName, selectedMeta.label)}
        </AppText>
        <AppText variant="technicalCaption" tone="muted" style={styles.focusText}>
          {strings.chakraFlower.planetOfDay(strings.planetLabels[planetOfTheDay])}
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
  flowerCanvas: {
    height: 260,
    position: "relative",
    width: 260,
  },
  petalLayer: {
    height: 260,
    left: 0,
    position: "absolute",
    top: 0,
    width: 260,
  },
  petal: {
    borderRadius: 999,
    position: "absolute",
  },
  centerOuter: {
    borderRadius: 37,
    height: 74,
    left: 93,
    opacity: 0.88,
    position: "absolute",
    top: 93,
    width: 74,
  },
  centerInner: {
    borderRadius: 25,
    height: 50,
    left: 105,
    opacity: 0.84,
    position: "absolute",
    top: 105,
    width: 50,
  },
  focus: {
    alignItems: "center",
    gap: 3,
  },
  focusText: {
    textAlign: "center",
  },
});
