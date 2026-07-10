import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";

import type { NatalProfile } from "@/modules/astro-core";
import { CHAKRA_SEGMENT_COLORS } from "@/modules/charts/constants";
import type { ChakraLocale } from "@/modules/chakra/i18n";
import type { DailyForecast, Planet, TodayTone } from "@/modules/daily-engine";
import type { HomeStrings } from "@/modules/home/i18n/home";
import { getPlanetChakraMap } from "@/modules/home/planetChakra";
import { AppText } from "@/modules/ui/AppText";
import { SurfaceCardHeader } from "@/modules/ui/SurfaceCardHeader";
import { SurfaceHelpModal } from "@/modules/ui/SurfaceHelpModal";
import { useTheme } from "@/modules/ui/theme";
import type { AccessMode } from "@/services/globalContentClient";
import { PLANET_ORDER } from "../planetChakra";

/** Legend order on home — Sun through Saturn (independent of petal layout order). */
const LEGEND_PLANET_ORDER: Planet[] = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"];

const DESIGN_SIZE = 248;
/** Enlarged canvas; legend is right-aligned so short planet names leave room on the left. */
const CANVAS_SIZE = 214;
/** White ring outer diameter (design px). */
const CENTER_OUTER_SIZE = 82;
/** Colored fill — enlarged so long planet names fit without shrinking the type. */
const CENTER_INNER_SIZE = 68;
const SCALE = CANVAS_SIZE / DESIGN_SIZE;

function scaled(value: number): number {
  return value * SCALE;
}

interface ChakraFlowerProps {
  forecast: DailyForecast;
  strings: HomeStrings;
  accessMode: AccessMode;
  natalProfile?: NatalProfile | null;
}

function resolveCenterPlanetStrength(
  forecast: DailyForecast,
  natalProfile: NatalProfile | null | undefined,
): number {
  const planet = forecast.planetOfTheDay;
  const natalStrength = natalProfile?.planets[planet]?.S_initial;
  if (typeof natalStrength === "number") return natalStrength;
  return normalizedImportance(forecast.importance, planet);
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

export function ChakraFlower({ forecast, strings, accessMode, natalProfile }: ChakraFlowerProps) {
  const theme = useTheme();
  const [helpVisible, setHelpVisible] = useState(false);
  const t = strings.chakraFlower;
  const chakraLocale: ChakraLocale = strings.locale;
  const planetChakra = useMemo(() => getPlanetChakraMap(chakraLocale), [chakraLocale]);
  const center = CANVAS_SIZE / 2;
  const centerOuter = scaled(CENTER_OUTER_SIZE);
  const centerInner = scaled(CENTER_INNER_SIZE);
  const centerOuterRadius = centerOuter / 2;
  const centerInnerRadius = centerInner / 2;
  const startAngle = 360 / PLANET_ORDER.length;
  const { importance, planetOfTheDay } = forecast;
  const todayTone = forecast.todayPlanetState.todayTone;
  const selectedMeta = planetChakra[planetOfTheDay];
  const selectedColor = chakraColor(selectedMeta.chakraNumber);
  const centerTextColor = contrastOnHex(selectedColor);
  const planetStrength = resolveCenterPlanetStrength(forecast, natalProfile);
  const strengthValue = formatPlanetStrength(planetStrength, todayTone);
  const planetOfDayLabel = strings.planetLabels[planetOfTheDay];
  const caption = accessMode === "free" ? t.captionFree : t.captionPersonal;

  return (
    <>
      <View
        style={[
          styles.card,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.surfaceBorder,
          },
        ]}
      >
        <SurfaceCardHeader
          title={t.title}
          help={{
            accessibilityLabel: t.helpButtonAccessibilityLabel,
            onPress: () => setHelpVisible(true),
          }}
        >
          <AppText variant="screenHint" tone="muted">
            {caption}
          </AppText>
        </SurfaceCardHeader>

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
                  height: centerOuter,
                  left: center - centerOuterRadius,
                  top: center - centerOuterRadius,
                  width: centerOuter,
                },
              ]}
            />
            <View
              style={[
                styles.centerInner,
                {
                  backgroundColor: selectedColor,
                  height: centerInner,
                  left: center - centerInnerRadius,
                  top: center - centerInnerRadius,
                  width: centerInner,
                },
              ]}
            />
            <View
              style={[
                styles.centerOverlay,
                {
                  height: centerInner,
                  left: center - centerInnerRadius,
                  top: center - centerInnerRadius,
                  width: centerInner,
                },
              ]}
              pointerEvents="none"
            >
              <AppText variant="sectionTitle" style={[styles.strengthValue, { color: centerTextColor }]}>
                {strengthValue}
              </AppText>
              <AppText
                variant="technicalCaption"
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.88}
                style={[styles.planetCaption, { color: centerTextColor }]}
              >
                {planetOfDayLabel}
              </AppText>
            </View>
          </View>
        </View>
        <View style={styles.legendColumn}>
          {LEGEND_PLANET_ORDER.map((planet) => {
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
                  {strings.planetLabels[planet]}
                </AppText>
              </View>
            );
          })}
        </View>
      </View>
      </View>
      <SurfaceHelpModal
        visible={helpVisible}
        title={t.helpModalTitle}
        closeLabel={strings.closeButton}
        onClose={() => setHelpVisible(false)}
        body={t.helpBody}
      />
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 24,
    padding: 18,
    gap: 14,
  },
  flowerBody: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    width: "100%",
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
    marginBottom: -1,
  },
  planetCaption: {
    fontSize: scaled(11),
    lineHeight: scaled(13),
    opacity: 0.94,
    textAlign: "center",
  },
  legendColumn: {
    flex: 1,
    flexShrink: 1,
    gap: 8,
    justifyContent: "center",
    paddingRight: 14,
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
    lineHeight: 15,
  },
});
