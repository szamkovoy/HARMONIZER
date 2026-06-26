import { Modal, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { NatalProfile, Planet } from "@/modules/astro-core";
import type { AspectType, DailyForecast } from "@/modules/daily-engine";
import type { HomeStrings } from "@/modules/home/i18n/home";
import type { AccessMode } from "@/services/globalContentClient";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { FullScreenModalScaffold } from "@/modules/ui/FullScreenModalScaffold";
import { ScreenSection } from "@/modules/ui/ScreenSection";
import { SurfaceCardView } from "@/modules/ui/SurfaceCardView";
import { useTheme } from "@/modules/ui/theme";
import { MarkdownText } from "./MarkdownText";
import type { AstroChartAspect } from "./AstroChartSVG";

interface ModalMathLevelProps {
  visible: boolean;
  onClose: () => void;
  onOpenChart?: () => void;
  mathLevel?: DailyForecast["mathLevel"] | null;
  natalProfile?: NatalProfile | null;
  forecast?: DailyForecast | null;
  accessMode: AccessMode;
  strings: HomeStrings["mathModal"];
  /** `stackLayer` — content only, slide animation handled by parent stack. */
  presentation?: "modal" | "stackLayer";
}

const PLANETS: readonly Planet[] = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"];
const ASPECTS: readonly AspectType[] = ["conjunction", "opposition", "square", "trine", "sextile"];

function isPlanet(value: unknown): value is Planet {
  return typeof value === "string" && (PLANETS as readonly string[]).includes(value);
}

function isAspect(value: unknown): value is AspectType {
  return typeof value === "string" && (ASPECTS as readonly string[]).includes(value);
}

export function chartAspectsFromMathLevel(
  mathLevel: DailyForecast["mathLevel"] | null | undefined,
): AstroChartAspect[] {
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
  onOpenChart,
  mathLevel,
  natalProfile,
  forecast,
  accessMode,
  strings,
  presentation = "modal",
}: ModalMathLevelProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const isGlobalForecast = accessMode === "free" || Boolean(forecast?.isGlobal);
  const hasTransitChart = Boolean(forecast?.transitChart?.planets);
  const canShowChart = isGlobalForecast ? hasTransitChart : Boolean(natalProfile && hasTransitChart);
  const chartButtonLabel = isGlobalForecast ? strings.showTransitChartButton : strings.showChartButton;

  if (!visible) return null;

  const shellStyle: StyleProp<ViewStyle> = [{ flex: 1, backgroundColor: theme.colors.screenBg }];

  const inner = (
    <FullScreenModalScaffold
      title={strings.title}
      subtitle={strings.subtitle}
      closeLabel={strings.closeButton}
      onClose={onClose}
      style={shellStyle}
    >
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        <SurfaceCardView tone="elevated" style={styles.card}>
          {mathLevel?.markdown ? (
            <MarkdownText source={mathLevel.markdown} />
          ) : (
            <AppText variant="screenHint" tone="muted">
              {strings.emptyHint}
            </AppText>
          )}
        </SurfaceCardView>

        {canShowChart && onOpenChart ? (
          <AppButton label={chartButtonLabel} variant="secondary" onPress={onOpenChart} />
        ) : (
          <ScreenSection title={chartButtonLabel} subtitle={strings.chartUnavailableHint} centerHeader>
            <View />
          </ScreenSection>
        )}
      </ScrollView>
    </FullScreenModalScaffold>
  );

  if (presentation === "stackLayer") {
    return inner;
  }

  return (
    <Modal animationType="slide" presentationStyle="fullScreen" visible={visible} onRequestClose={onClose}>
      {inner}
    </Modal>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 16,
    padding: 20,
  },
  card: {
    padding: 18,
  },
});
