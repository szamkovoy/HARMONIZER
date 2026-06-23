import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";

/**
 * Bottom padding for scrollable content inside tab screens.
 * Keeps the last card and scroll indicators above the visual tab bar.
 */
export function useTabContentBottomPadding(extra = 24): number {
  const tabBarHeight = useBottomTabBarHeight();
  return tabBarHeight + extra;
}
