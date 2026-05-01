import { Modal, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PLANETS_7, type NatalProfile, type Planet } from "@/modules/astro-core";
import type { DailyForecast } from "@/modules/daily-engine";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";
import { AstroChartSVG, type AstroChartAspect } from "./AstroChartSVG";

interface ModalAstroChartProps {
  visible: boolean;
  onClose: () => void;
  natalProfile: NatalProfile;
  forecast?: DailyForecast;
  aspects?: AstroChartAspect[];
}

const PLANET_LABELS: Record<Planet, string> = {
  Sun: "Солнце",
  Moon: "Луна",
  Mercury: "Меркурий",
  Venus: "Венера",
  Mars: "Марс",
  Jupiter: "Юпитер",
  Saturn: "Сатурн",
};

export default function ModalAstroChart({ visible, onClose, natalProfile, forecast, aspects }: ModalAstroChartProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const chartSize = Math.min(380, Math.max(280, width - 40));
  const showHouses = natalProfile.precisionMode === "precise" && Boolean(natalProfile.houseCusps?.length);

  return (
    <Modal animationType="slide" presentationStyle="fullScreen" visible={visible} onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: theme.colors.screenBg, paddingTop: insets.top + 12 }]}>
        <View style={[styles.header, { borderBottomColor: theme.colors.surfaceBorder }]}>
          <View style={styles.headerText}>
            <AppText variant="sectionTitle">{forecast ? "Натальная + транзитная карта" : "Натальная карта"}</AppText>
            <AppText variant="technicalCaption" tone="muted">
              Внутреннее кольцо — натальные планеты, внешнее — транзиты дня.
            </AppText>
          </View>
          <AppButton label="Закрыть" variant="secondary" onPress={onClose} style={styles.closeButton} />
        </View>

        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
          <View style={[styles.chartCard, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.surfaceBorder }]}>
            <AstroChartSVG
              natalProfile={natalProfile}
              transitPositions={forecast?.transitChart.planets}
              aspects={aspects}
              showHouses={showHouses}
              size={chartSize}
            />
            {!showHouses ? (
              <AppText variant="technicalCaption" tone="muted" style={styles.centerText}>
                Дома не показаны: точные кусписы доступны только при точном времени рождения.
              </AppText>
            ) : null}
          </View>

          {aspects?.length ? (
            <View style={[styles.section, { borderColor: theme.colors.surfaceBorder }]}>
              <AppText variant="sectionTitle">Главные аспекты дня</AppText>
              {aspects.slice(0, 8).map((aspect) => (
                <AppText key={`${aspect.from}-${aspect.to}-${aspect.type}`} variant="screenHint" tone="muted">
                  {PLANET_LABELS[aspect.from]} {aspect.type} к натальному {PLANET_LABELS[aspect.to]}
                  {typeof aspect.orb === "number" ? `, орб ${aspect.orb.toFixed(1)}°` : ""}
                </AppText>
              ))}
            </View>
          ) : null}

          <View style={[styles.section, { borderColor: theme.colors.surfaceBorder }]}>
            <AppText variant="sectionTitle">Силы планет</AppText>
            {PLANETS_7.map((planet) => (
              <AppText key={planet} variant="screenHint" tone="muted">
                {PLANET_LABELS[planet]}: S = {natalProfile.planets[planet].S_initial.toFixed(2)}, H ={" "}
                {natalProfile.planets[planet].H_initial.toFixed(2)}
              </AppText>
            ))}
          </View>
        </ScrollView>
      </View>
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
    alignItems: "center",
    gap: 16,
    padding: 20,
  },
  chartCard: {
    alignItems: "center",
    borderRadius: 24,
    borderWidth: 1,
    gap: 10,
    padding: 12,
    width: "100%",
  },
  centerText: {
    textAlign: "center",
  },
  section: {
    borderRadius: 20,
    borderWidth: 1,
    gap: 8,
    padding: 14,
    width: "100%",
  },
});
