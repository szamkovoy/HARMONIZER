import { Platform, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Icon + label row height before bottom safe-area inset. */
const TAB_BAR_CONTENT_HEIGHT = 46;
/** Insets tab items from screen edges so outer labels do not hug the bezels. */
const TAB_BAR_HORIZONTAL_INSET = 16;

export function useCompactTabBarStyle(
  colors: Pick<{ surfaceElevated: string; surfaceBorder: string }, "surfaceElevated" | "surfaceBorder">,
): ViewStyle {
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(insets.bottom, Platform.OS === "android" ? 8 : 0);

  return {
    backgroundColor: colors.surfaceElevated,
    borderTopColor: colors.surfaceBorder,
    height: TAB_BAR_CONTENT_HEIGHT + bottomInset,
    paddingHorizontal: TAB_BAR_HORIZONTAL_INSET,
    paddingTop: 2,
    paddingBottom: bottomInset,
  };
}

/** Matches `theme.typography.technicalCaption` (e.g. opportunity-window detail lines). */
export const COMPACT_TAB_BAR_LABEL_STYLE = {
  fontSize: 10,
  fontWeight: "400" as const,
  lineHeight: 14,
  marginTop: 0,
  marginBottom: 0,
} as const;

export const COMPACT_TAB_BAR_ITEM_STYLE = {
  paddingVertical: 0,
} as const;
