import { Platform, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Icon + label row height before bottom safe-area inset. */
const TAB_BAR_CONTENT_HEIGHT = 46;

export function useCompactTabBarStyle(
  colors: Pick<{ surfaceElevated: string; surfaceBorder: string }, "surfaceElevated" | "surfaceBorder">,
): ViewStyle {
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(insets.bottom, Platform.OS === "android" ? 8 : 0);

  return {
    backgroundColor: colors.surfaceElevated,
    borderTopColor: colors.surfaceBorder,
    height: TAB_BAR_CONTENT_HEIGHT + bottomInset,
    paddingTop: 2,
    paddingBottom: bottomInset,
  };
}

export const COMPACT_TAB_BAR_LABEL_STYLE = {
  fontSize: 11,
  marginTop: 0,
  marginBottom: 0,
} as const;

export const COMPACT_TAB_BAR_ITEM_STYLE = {
  paddingVertical: 0,
} as const;
