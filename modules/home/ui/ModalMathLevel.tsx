import { Suspense, lazy, useMemo, useState } from "react";
import { ActivityIndicator, Modal, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { NatalProfile, Planet } from "@/modules/astro-core";
import type { AspectType, DailyForecast } from "@/modules/daily-engine";
import type { HomeStrings } from "@/modules/home/i18n/home";
import type { AccessMode } from "@/services/globalContentClient";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";
import { MarkdownText } from "./MarkdownText";
import type { AstroChartAspect } from "./AstroChartSVG";

const ModalAstroChart = lazy(() => import("./ModalAstroChart"));

interface ModalMathLevelProps {
  visible: boolean;
  onClose: () => void;
  mathLevel?: DailyForecast["mathLevel"] | null;
  natalProfile?: NatalProfile | null;
  forecast?: DailyForecast | null;
  accessMode: AccessMode;
  strings: HomeStrings["mathModal"];
}

const PLANETS: readonly Planet[] = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"];
const ASPECTS: readonly AspectType[] = ["conjunction", "opposition", "square", "trine", "sextile"];

function isPlanet(value: unknown): value is Planet {
  return typeof value === "string" && (PLANETS as readonly string[]).includes(value);
}

function isAspect(value: unknown): value is AspectType {
  return typeof value === "string" && (ASPECTS as readonly string[]).includes(value);
}

function chartAspects(mathLevel: DailyForecast["mathLevel"] | null | undefined): AstroChartAspect[] {
  const structured = mathLevel?.structured;
  if (!structured || typeof structured !== "object") return [];
  const raw = (structured as { main_aspects?: unknown }).main_aspects;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): AstroChartAspect[] => {
    const aspect = item as { from?: unknown; to?: unknown; type?: unknown; orb?: unknown };
    if (!isPlanet(aspect.from) || !isPlanet(aspect.to) || typeof aspect.type !== "string") return [];
    return [
      {
        from: aspect.from,
        to: aspect.to,
        type: isAspect(aspect.type) ? aspect.type : aspect.type,
        orb: typeof aspect.orb === "number" ? aspect.orb : undefined,
      },
    ];
  });
}

export function ModalMathLevel({
  visible,
  onClose,
  mathLevel,
  natalProfile,
  forecast,
  accessMode,
  strings,
}: ModalMathLevelProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [showChart, setShowChart] = useState(false);
  const aspects = useMemo(() => chartAspects(mathLevel), [mathLevel]);
  const canShowChart = accessMode !== "free" && Boolean(natalProfile);

  return (
    <Modal animationType="slide" presentationStyle="fullScreen" visible={visible} onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: theme.colors.screenBg, paddingTop: insets.top + 12 }]}>
        <View style={[styles.header, { borderBottomColor: theme.colors.surfaceBorder }]}>
          <View style={styles.headerText}>
            <AppText variant="sectionTitle">{strings.title}</AppText>
            <AppText variant="technicalCaption" tone="muted">
              {strings.subtitle}
            </AppText>
          </View>
          <AppButton label={strings.closeButton} variant="secondary" onPress={onClose} style={styles.closeButton} />
        </View>

        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
          <View style={[styles.card, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.surfaceBorder }]}>
            {mathLevel?.markdown ? (
              <MarkdownText source={mathLevel.markdown} />
            ) : (
              <AppText variant="screenHint" tone="muted">
                {strings.emptyHint}
              </AppText>
            )}
          </View>

          {canShowChart ? (
            <AppButton label={strings.showChartButton} variant="secondary" onPress={() => setShowChart(true)} />
          ) : (
            <AppText variant="technicalCaption" tone="muted" style={styles.centerText}>
              {strings.chartUnavailableHint}
            </AppText>
          )}
        </ScrollView>
      </View>

      {showChart && canShowChart && natalProfile ? (
        <Suspense fallback={<ActivityIndicator color={theme.colors.accent} style={styles.loader} />}>
          <ModalAstroChart
            visible={showChart}
            onClose={() => setShowChart(false)}
            natalProfile={natalProfile}
            forecast={forecast ?? undefined}
            aspects={aspects}
            presentation="nestedOverlay"
          />
        </Suspense>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  header: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
    paddingBottom: 12,
    paddingHorizontal: 18,
  },
  headerText: {
    flex: 1,
    gap: 4,
  },
  closeButton: {
    alignSelf: "center",
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  content: {
    gap: 16,
    padding: 20,
  },
  card: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 18,
  },
  centerText: {
    textAlign: "center",
  },
  loader: {
    bottom: 24,
    position: "absolute",
    right: 24,
  },
});
