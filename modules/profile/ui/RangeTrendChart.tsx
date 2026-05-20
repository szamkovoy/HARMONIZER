import { StyleSheet, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";

import {
  buildCalendarAxisTicks,
  buildChartPoints,
  buildSmoothLinePath,
  type CalendarTrendPoint,
} from "@/modules/profile/core/rangeTrendChart";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

const CHART_WIDTH = 320;
const CHART_HEIGHT = 160;
const CHART_PADDING = 16;

export function RangeTrendChart(props: { points: CalendarTrendPoint[] }) {
  const theme = useTheme();
  const chartPoints = buildChartPoints(props.points, CHART_WIDTH, CHART_HEIGHT, CHART_PADDING);
  const axisTicks = buildCalendarAxisTicks(props.points, CHART_WIDTH, CHART_PADDING);
  const linePath = chartPoints.length >= 2 ? buildSmoothLinePath(chartPoints) : "";

  return (
    <View style={styles.wrapper}>
      <Svg width="100%" height={CHART_HEIGHT} viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}>
        <Path
          d={`M ${CHART_PADDING} ${CHART_HEIGHT - CHART_PADDING} L ${CHART_WIDTH - CHART_PADDING} ${CHART_HEIGHT - CHART_PADDING}`}
          stroke={theme.colors.surfaceBorder}
          strokeWidth={1}
        />
        {linePath ? (
          <Path d={linePath} fill="none" stroke={theme.colors.accent} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
        ) : null}
        {chartPoints.map((point) => (
          <Circle key={point.localDate} cx={point.x} cy={point.y} r={4} fill={theme.colors.accent} />
        ))}
      </Svg>
      <View style={styles.axisRow}>
        {axisTicks.map((tick) => (
          <AppText key={`${tick.localDate}-${tick.x}`} variant="technicalCaption" tone="muted" style={styles.axisLabel}>
            {tick.label}
          </AppText>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: 6,
  },
  axisRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  axisLabel: {
    flexShrink: 1,
    textAlign: "center",
  },
});
