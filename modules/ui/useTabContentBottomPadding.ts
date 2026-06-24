/**
 * Bottom padding for scrollable content inside tab screens.
 * Tab navigator already insets screen content above the tab bar, so we only
 * add a small breathing gap — not the full tab-bar height (that double-counts
 * and leaves a visible gray strip above the bar).
 */
export function useTabContentBottomPadding(extra = 24): number {
  return extra;
}
