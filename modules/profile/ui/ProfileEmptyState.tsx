import { StyleSheet, View } from "react-native";

import {
  REPORT_PREVIEW_DISPLAY_SIZE,
  ReportPreviewChart,
  type ReportPreviewKind,
} from "@/modules/profile/ui/reportPreviewCharts";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

export type { ReportPreviewKind };

export function ProfileEmptyState(props: {
  message: string;
  /** Ghost chart under the message — shows what the report will look like. */
  preview?: ReportPreviewKind;
}) {
  const theme = useTheme();

  if (!props.preview) {
    return (
      <View
        style={[
          styles.frame,
          {
            borderColor: theme.colors.surfaceBorder,
            backgroundColor: theme.colors.surfaceElevated,
          },
        ]}
      >
        <AppText variant="dialogBody" tone="muted" style={styles.message}>
          {props.message}
        </AppText>
      </View>
    );
  }

  // Fixed box = chart size. Chart and copy share the same center.
  return (
    <View style={styles.previewRoot}>
      <View style={styles.previewGhost} pointerEvents="none">
        <ReportPreviewChart kind={props.preview} />
      </View>
      <View
        pointerEvents="box-none"
        style={[
          styles.frameOverlay,
          {
            borderColor: theme.colors.surfaceBorder,
            backgroundColor:
              theme.scheme === "dark" ? "rgba(40, 44, 52, 0.78)" : "rgba(255, 255, 255, 0.78)",
          },
        ]}
      >
        <AppText variant="dialogBody" tone="muted" style={styles.message}>
          {props.message}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  previewRoot: {
    alignItems: "center",
    alignSelf: "center",
    height: REPORT_PREVIEW_DISPLAY_SIZE,
    justifyContent: "center",
    // Nudge preview + empty-copy toward the card subtitle / hint above.
    marginTop: -35,
    width: "100%",
  },
  previewGhost: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    opacity: 0.42,
  },
  frame: {
    alignItems: "center",
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
    minHeight: 120,
    paddingHorizontal: 16,
    paddingVertical: 20,
  },
  frameOverlay: {
    alignItems: "center",
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: "center",
    marginHorizontal: 20,
    maxWidth: 300,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  message: {
    textAlign: "center",
  },
});
