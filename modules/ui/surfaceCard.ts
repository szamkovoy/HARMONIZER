export const SURFACE_CARD = {
  padding: 18,
  gap: 14,
  borderRadius: 24,
  borderWidth: 1,
  /** Title row → subtitle or first body line inside `SurfaceCardHeader`. */
  titleToContentGap: 9,
} as const;

/** Help «?» on the title row of `SurfaceCardView` (via `SurfaceCardTitleRow`). */
export const SURFACE_CARD_HELP = {
  iconSize: 20,
  /** Matches `theme.typography.sectionTitle.lineHeight`. */
  titleLineHeight: 24,
} as const;

/** Help modal opened from `SurfaceCardHelpButton` (`SurfaceHelpModal`). */
export const SURFACE_HELP_MODAL = {
  backdropPadding: 20,
  cardBorderRadius: 22,
  cardGap: 12,
  cardMaxWidth: 360,
  /** Cap card height so long help copy / large Dynamic Type stay on-screen and scroll. */
  cardMaxHeightFraction: 0.9,
  /** Minimum scroll viewport for the body when chrome measurement is still settling. */
  bodyMinHeight: 96,
  cardPadding: 18,
  closeIconSize: 22,
  /** Title + close icon sit below the card's top padding edge. */
  titleOffsetTop: 11,
  titleLineHeight: SURFACE_CARD_HELP.titleLineHeight,
  /** Gap between body text and the footer «Закрыть» button. */
  actionsMarginTop: 8,
  /** Space under title row before the first body paragraph. */
  titleToBodyGap: 16,
  /** Uniform gap between body paragraphs (slightly tighter than a blank `\n\n` line). */
  bodyParagraphGap: 10,
} as const;
