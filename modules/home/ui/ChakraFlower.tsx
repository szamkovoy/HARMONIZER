import { useMemo } from "react";
import { StyleSheet, View } from "react-native";

import type { NatalProfile } from "@/modules/astro-core";
import { CHAKRA_SEGMENT_COLORS } from "@/modules/charts/constants";
import { getChartStrings } from "@/modules/charts/i18n/charts";
import { chakraShortLabelDisplay, type ChakraLocale } from "@/modules/chakra/i18n";
import type { DailyForecast, Planet, TodayTone } from "@/modules/daily-engine";
import type { HomeStrings } from "@/modules/home/i18n/home";
import { getPlanetChakraMap } from "@/modules/home/planetChakra";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";
import { PLANET_ORDER } from "../planetChakra";

const DESIGN_SIZE = 248;
/** ~17% above donut size (164): uses spare width right of legend without re-wrapping long labels. */
const CANVAS_SIZE = 192;
const SCALE = CANVAS_SIZE / DESIGN_SIZE;

function scaled(value: number): number {
  return value * SCALE;
}

interface ChakraFlowerProps {
  forecast: DailyForecast;
  strings: HomeStrings;
  natalProfile?: NatalProfile | null;
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

function chakraColor(chakraNumber: number): string {
  return CHAKRA_SEGMENT_COLORS[chakraNumber - 1] ?? CHAKRA_SEGMENT_COLORS[0];
}

function contrastOnHex(hex: string): string {
  const clean = hex.replace("#", "");
  const value = Number.parseInt(clean.length === 3 ? clean.split("").map((c) => c + c).join("") : clean, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.58 ? "#111827" : "#FFFFFF";
}

function formatPlanetStrength(strength: number, tone: TodayTone): string {
  const percent = Math.round(Math.max(0, Math.min(1, strength)) * 100);
  if (tone === "dissonant") return `-${percent}%`;
  return `${percent}%`;
}

export function ChakraFlower({ forecast, strings, natalProfile }: ChakraFlowerProps) {
  const theme = useTheme();
  const chartStrings = getChartStrings(strings.locale);
  const chakraLocale: ChakraLocale = strings.locale;
  const planetChakra = useMemo(() => getPlanetChakraMap(chakraLocale), [chakraLocale]);
  const center = CANVAS_SIZE / 2;
  const startAngle = 360 / PLANET_ORDER.length;
  const { importance, planetOfTheDay } = forecast;
  const todayTone = forecast.todayPlanetState.todayTone;
  const selectedMeta = planetChakra[planetOfTheDay];
  const selectedColor = chakraColor(selectedMeta.chakraNumber);
  const centerTextColor = contrastOnHex(selectedColor);
  const planetStrength = natalProfile?.planets[planetOfTheDay]?.S_initial;
  const strengthLabel =
    typeof planetStrength === "number" ? formatPlanetStrength(planetStrength, todayTone) : null;

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
          <AppText variant="screenHint" tone="muted" style={styles.caption}>
            {strings.chakraFlower.caption}
          </AppText>
        </View>
      </View>

      <View style={styles.flowerBody}>
        <View style={styles.flowerWrap}>
          <View style={styles.flowerCanvas} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {PLANET_ORDER.map((planet, index) => {
              const meta = planetChakra[planet];
              const color = chakraColor(meta.chakraNumber);
              const n = normalizedImportance(importance, planet);
              const isSelected = planet === planetOfTheDay;
              const width = scaled(42 + n * 22);
              const length = scaled(76 + n * 48);
              const angle = startAngle * (index + 1);
              const opacity = petalOpacity(todayTone, isSelected, n);
              const borderColor =
                isSelected && todayTone === "dissonant" ? "rgba(17, 24, 39, 0.75)" : hexToRgba(color, 0.95);
              const glowPad = scaled(20);
              const glowExtra = scaled(30);
              const petalTopInset = scaled(24);
              const glowTopInset = scaled(8);
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
                          backgroundColor: color,
                          height: length + glowExtra,
                          left: center - (width + glowPad) / 2,
                          opacity: selectedGlowOpacity(todayTone),
                          top: center - length - glowTopInset,
                          width: width + glowPad,
                        },
                      ]}
                    />
                  ) : null}
                  <View
                    style={[
                      styles.petal,
                      {
                        backgroundColor: hexToRgba(color, opacity),
                        borderColor,
                        borderWidth: isSelected ? 2 : 1,
                        height: length,
                        left: center - width / 2,
                        top: center - length + petalTopInset,
                        width,
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
                  borderColor: hexToRgba(selectedColor, 0.24),
                  height: scaled(82),
                  left: center - scaled(41),
                  top: center - scaled(41),
                  width: scaled(82),
                },
              ]}
            />
            <View
              style={[
                styles.centerInner,
                {
                  backgroundColor: selectedColor,
                  height: scaled(54),
                  left: center - scaled(27),
                  top: center - scaled(27),
                  width: scaled(54),
                },
              ]}
            />
            {strengthLabel ? (
              <View
                style={[
                  styles.centerOverlay,
                  {
                    height: scaled(54),
                    left: center - scaled(27),
                    top: center - scaled(27),
                    width: scaled(54),
                  },
                ]}
                pointerEvents="none"
              >
                <AppText
                  variant="sectionTitle"
                  style={[styles.strengthValue, { color: centerTextColor }]}
                >
                  {strengthLabel}
                </AppText>
                <AppText variant="technicalCaption" style={[styles.strengthCaption, { color: centerTextColor }]}>
                  {chartStrings.strengthLabel}
                </AppText>
              </View>
            ) : null}
          </View>
        </View>
        <View style={styles.legendColumn}>
          {PLANET_ORDER.map((planet) => {
            const meta = planetChakra[planet];
            const color = chakraColor(meta.chakraNumber);
            const active = planet === planetOfTheDay;
            return (
              <View key={planet} style={styles.legendRow}>
                <View
                  style={[
                    styles.legendDot,
                    {
                      backgroundColor: color,
                    },
                  ]}
                />
                <AppText variant="technicalCaption" tone={active ? "primary" : "muted"} style={styles.legendText}>
                  {chakraShortLabelDisplay(chakraLocale, meta.chakraNumber)}
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
    gap: 10,
  },
  flowerWrap: {
    alignItems: "center",
    flexShrink: 0,
    justifyContent: "center",
    width: CANVAS_SIZE,
  },
  flowerCanvas: {
    height: CANVAS_SIZE,
    position: "relative",
    width: CANVAS_SIZE,
  },
  petalLayer: {
    height: CANVAS_SIZE,
    left: 0,
    position: "absolute",
    top: 0,
    width: CANVAS_SIZE,
  },
  petal: {
    borderRadius: 999,
    position: "absolute",
  },
  petalGlow: {
    borderRadius: 999,
    position: "absolute",
  },
  centerOuter: {
    borderRadius: 999,
    borderWidth: 1,
    opacity: 0.92,
    position: "absolute",
  },
  centerInner: {
    borderRadius: 999,
    opacity: 0.84,
    position: "absolute",
  },
  centerOverlay: {
    alignItems: "center",
    justifyContent: "center",
    position: "absolute",
  },
  strengthValue: {
    fontSize: scaled(16),
    lineHeight: scaled(18),
    marginBottom: -2,
  },
  strengthCaption: {
    fontSize: scaled(11),
    lineHeight: scaled(13),
    opacity: 0.92,
  },
  legendColumn: {
    flex: 1,
    gap: 8,
    justifyContent: "center",
  },
  legendRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
  },
  legendDot: {
    borderRadius: 999,
    height: 10,
    width: 10,
  },
  legendText: {
    flex: 1,
    lineHeight: 15,
  },
});
