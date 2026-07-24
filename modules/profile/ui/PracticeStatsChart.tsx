import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PanResponder,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type GestureResponderEvent,
} from "react-native";

import type { AppContentLocale } from "@/modules/i18n/localeCodes";
import {
  defaultPracticeStatsSelectionIndex,
  formatPracticeStatsCalloutMinutes,
  formatPracticeStatsScrubDate,
  nearestPracticeStatsBarIndex,
  practiceStatsBarCenterX,
  practiceStatsCalloutLeft,
  type PracticeStatsChartModel,
} from "@/modules/profile/core/practiceStatsChart";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

const BAR_TRACK_HEIGHT = 112;
const Y_AXIS_WIDTH = 34;
const DATE_AXIS_HEIGHT = 28;
const DATE_LABEL_WIDTH = 40;
const SCRUB_CALLOUT_HEIGHT = 58;
const CALLOUT_GAP = 4;
const Y_LABEL_LINE_HEIGHT = 12;
const SELECTION_LINE_WIDTH = 1.5;
const DEFAULT_CALLOUT_WIDTH = 120;

export function PracticeStatsChart(props: {
  model: PracticeStatsChartModel;
  unitHint: string;
  weeklyHint?: string;
  scrubTotalLabel: string;
  minutesUnit: string;
  locale?: AppContentLocale;
}) {
  const theme = useTheme();
  const locale = props.locale ?? "ru";
  const [plotWidth, setPlotWidth] = useState(0);
  const [calloutWidth, setCalloutWidth] = useState(DEFAULT_CALLOUT_WIDTH);
  const plotWidthRef = useRef(0);
  const barCount = props.model.bars.length;
  const compact = barCount > 14;
  const barWidth = compact ? 5 : barCount > 10 ? 9 : 14;
  const gap = compact ? 2 : barCount > 10 ? 3 : 6;
  const gapRef = useRef(gap);
  const barCountRef = useRef(barCount);
  gapRef.current = gap;
  barCountRef.current = barCount;
  const scaleMax = Math.max(1, props.model.scaleMaxMinutes);

  const [selectedIndex, setSelectedIndex] = useState(() =>
    defaultPracticeStatsSelectionIndex(props.model.bars),
  );

  useEffect(() => {
    setSelectedIndex(defaultPracticeStatsSelectionIndex(props.model.bars));
  }, [
    barCount,
    props.model.bars,
    props.model.fromLocalDate,
    props.model.maxMinutes,
    props.model.mode,
    props.model.throughLocalDate,
  ]);

  const onPlotLayout = useCallback((event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    plotWidthRef.current = next;
    setPlotWidth((current) => (current === next ? current : next));
  }, []);

  const onCalloutLayout = useCallback((event: LayoutChangeEvent) => {
    const next = Math.ceil(event.nativeEvent.layout.width);
    if (next > 0) {
      setCalloutWidth((current) => (current === next ? current : next));
    }
  }, []);

  const selectFromPageX = useCallback((locationX: number) => {
    const width = plotWidthRef.current;
    const count = barCountRef.current;
    if (width <= 0 || count <= 0) return;
    const next = nearestPracticeStatsBarIndex(locationX, count, width, gapRef.current);
    setSelectedIndex((current) => (current === next ? current : next));
  }, []);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (event: GestureResponderEvent) => {
          selectFromPageX(event.nativeEvent.locationX);
        },
        onPanResponderMove: (event: GestureResponderEvent) => {
          selectFromPageX(event.nativeEvent.locationX);
        },
      }),
    [selectFromPageX],
  );

  const dateTicks = useMemo(() => {
    if (plotWidth <= 0 || barCount <= 0) return [];
    return props.model.bars.flatMap((bar, index) => {
      if (!bar.showDateLabel) return [];
      const centerX = practiceStatsBarCenterX(index, barCount, plotWidth, gap);
      return [{ key: bar.key, label: bar.dateLabel, centerX }];
    });
  }, [barCount, gap, plotWidth, props.model.bars]);

  const selectedBar = props.model.bars[selectedIndex] ?? null;
  const selectionX =
    plotWidth > 0 && selectedBar
      ? practiceStatsBarCenterX(selectedIndex, barCount, plotWidth, gap)
      : null;

  const calloutLeft =
    selectionX != null ? practiceStatsCalloutLeft(selectionX, calloutWidth, plotWidth) : 0;

  const scrubDate = selectedBar
    ? formatPracticeStatsScrubDate(selectedBar.startLocalDate, selectedBar.endLocalDate, locale)
    : "";

  return (
    <View style={styles.wrapper}>
      <AppText variant="technicalCaption" tone="muted" style={styles.unitHint}>
        {props.model.mode === "week" && props.weeklyHint ? props.weeklyHint : props.unitHint}
      </AppText>

      <View style={styles.plotRow}>
        <View style={styles.yAxisColumn}>
          <View style={{ height: SCRUB_CALLOUT_HEIGHT + CALLOUT_GAP }} />
          <View style={[styles.yAxis, { height: BAR_TRACK_HEIGHT }]}>
            {props.model.yTicks.map((tick) => {
              const ratio = tick / scaleMax;
              return (
                <AppText
                  key={`y-${tick}`}
                  variant="technicalCaption"
                  tone="faint"
                  style={[
                    styles.yTickLabel,
                    {
                      bottom: ratio * BAR_TRACK_HEIGHT - Y_LABEL_LINE_HEIGHT / 2,
                    },
                  ]}
                >
                  {tick}
                </AppText>
              );
            })}
          </View>
        </View>

        <View style={styles.plotMain}>
          <View
            style={styles.plotFrame}
            onLayout={onPlotLayout}
            {...panResponder.panHandlers}
          >
            <View style={styles.calloutSlot}>
              {selectedBar && selectionX != null ? (
                <View
                  pointerEvents="none"
                  onLayout={onCalloutLayout}
                  style={[
                    styles.callout,
                    {
                      left: calloutLeft,
                      backgroundColor: theme.colors.surfaceBorder,
                      borderColor: theme.colors.surfaceBorder,
                    },
                  ]}
                >
                  <AppText variant="technicalCaption" tone="faint" style={styles.calloutEyebrow}>
                    {props.scrubTotalLabel}
                  </AppText>
                  <View style={styles.calloutValueRow}>
                    <AppText variant="sectionTitle" style={styles.calloutValue}>
                      {formatPracticeStatsCalloutMinutes(selectedBar.minutes)}
                    </AppText>
                    <AppText variant="technicalCaption" tone="muted">
                      {props.minutesUnit}
                    </AppText>
                  </View>
                  <AppText variant="technicalCaption" tone="faint" numberOfLines={1}>
                    {scrubDate}
                  </AppText>
                </View>
              ) : null}
            </View>

            <View style={styles.barsArea}>
              {props.model.yTicks.map((tick) => {
                if (tick <= 0) return null;
                const ratio = tick / scaleMax;
                return (
                  <View
                    key={`grid-${tick}`}
                    pointerEvents="none"
                    style={[
                      styles.gridLine,
                      {
                        bottom: ratio * BAR_TRACK_HEIGHT,
                        borderBottomColor: theme.colors.surfaceBorder,
                      },
                    ]}
                  />
                );
              })}
              <View style={[styles.baseline, { backgroundColor: theme.colors.surfaceBorder }]} />
              <View style={[styles.barsRow, { gap }]}>
                {props.model.bars.map((bar) => {
                  const height =
                    bar.minutes <= 0
                      ? 3
                      : Math.max(4, Math.round((bar.minutes / scaleMax) * BAR_TRACK_HEIGHT));
                  return (
                    <View key={bar.key} style={styles.column}>
                      <View style={styles.barTrack}>
                        <View
                          style={[
                            styles.bar,
                            {
                              width: barWidth,
                              height,
                              backgroundColor:
                                bar.minutes > 0 ? theme.colors.accent : theme.colors.surfaceBorder,
                              opacity: bar.minutes > 0 ? 1 : 0.5,
                            },
                          ]}
                        />
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>

            {selectionX != null ? (
              <View
                pointerEvents="none"
                style={[
                  styles.selectionLine,
                  {
                    left: selectionX - SELECTION_LINE_WIDTH / 2,
                    top: SCRUB_CALLOUT_HEIGHT - 2,
                    // Светлее textMuted — линия-указатель не конкурирует с барами.
                    backgroundColor: theme.colors.textFaint,
                    opacity: 0.55,
                  },
                ]}
              />
            ) : null}
          </View>

          <View style={styles.dateAxis}>
            {dateTicks.map((tick) => (
              <View
                key={`date-${tick.key}`}
                pointerEvents="none"
                style={[styles.dateTick, { left: tick.centerX - DATE_LABEL_WIDTH / 2 }]}
              >
                <View style={[styles.dateMarker, { borderBottomColor: theme.colors.textFaint }]} />
                <AppText
                  variant="technicalCaption"
                  tone="faint"
                  numberOfLines={1}
                  style={styles.dateLabel}
                >
                  {tick.label}
                </AppText>
              </View>
            ))}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: 14,
  },
  unitHint: {
    marginBottom: 2,
  },
  plotRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 6,
  },
  yAxisColumn: {
    width: Y_AXIS_WIDTH,
  },
  yAxis: {
    overflow: "visible",
    position: "relative",
    width: Y_AXIS_WIDTH,
  },
  yTickLabel: {
    fontSize: 10,
    lineHeight: Y_LABEL_LINE_HEIGHT,
    position: "absolute",
    right: 0,
    textAlign: "right",
    width: Y_AXIS_WIDTH,
  },
  plotMain: {
    flex: 1,
    minWidth: 0,
  },
  plotFrame: {
    position: "relative",
  },
  calloutSlot: {
    height: SCRUB_CALLOUT_HEIGHT,
    marginBottom: CALLOUT_GAP,
    position: "relative",
  },
  callout: {
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 2,
    minWidth: 112,
    paddingHorizontal: 10,
    paddingVertical: 6,
    position: "absolute",
    top: 0,
    zIndex: 3,
  },
  calloutEyebrow: {
    fontSize: 10,
    letterSpacing: 0.6,
    lineHeight: 12,
    textTransform: "uppercase",
  },
  calloutValueRow: {
    alignItems: "baseline",
    flexDirection: "row",
    gap: 4,
  },
  calloutValue: {
    fontSize: 20,
    lineHeight: 24,
  },
  barsArea: {
    height: BAR_TRACK_HEIGHT,
    justifyContent: "flex-end",
    position: "relative",
  },
  gridLine: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    left: 0,
    position: "absolute",
    right: 0,
  },
  baseline: {
    bottom: 0,
    height: StyleSheet.hairlineWidth,
    left: 0,
    position: "absolute",
    right: 0,
  },
  barsRow: {
    alignItems: "flex-end",
    flexDirection: "row",
    height: BAR_TRACK_HEIGHT,
  },
  column: {
    alignItems: "center",
    flex: 1,
    justifyContent: "flex-end",
    minWidth: 0,
  },
  barTrack: {
    height: BAR_TRACK_HEIGHT,
    justifyContent: "flex-end",
  },
  bar: {
    borderRadius: 999,
  },
  selectionLine: {
    bottom: 0,
    position: "absolute",
    width: SELECTION_LINE_WIDTH,
    zIndex: 2,
  },
  dateAxis: {
    height: DATE_AXIS_HEIGHT,
    marginTop: 4,
    position: "relative",
  },
  dateTick: {
    alignItems: "center",
    position: "absolute",
    top: 0,
    width: DATE_LABEL_WIDTH,
  },
  dateMarker: {
    borderBottomWidth: 5,
    borderLeftColor: "transparent",
    borderLeftWidth: 4,
    borderRightColor: "transparent",
    borderRightWidth: 4,
    borderStyle: "solid",
    height: 0,
    marginBottom: 2,
    width: 0,
  },
  dateLabel: {
    fontSize: 10,
    lineHeight: 12,
    textAlign: "center",
    width: DATE_LABEL_WIDTH,
  },
});
