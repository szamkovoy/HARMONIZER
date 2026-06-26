/** Edge copy — keep in sync with `_legacy_web/config/contentLengths.ts`. */
/**
 * Target lengths for generated content.
 * Tune these values when the home screen needs a different visual balance.
 */
export const CONTENT_LENGTHS = {
  /** Daily slogan in the top home banner. */
  SLOGAN_TARGET_CHARS: 50,
  SLOGAN_MAX_CHARS: 80,

  /** Main recommendation block on the home screen. */
  SHORT_TEXT_TARGET_CHARS: 500,
  SHORT_TEXT_MIN_CHARS: 400,
  SHORT_TEXT_MAX_CHARS: 600,

  /** Long explanation in the details modal. */
  LONG_EXPLANATION_TARGET_CHARS: 1500,
  LONG_EXPLANATION_MIN_CHARS: 1000,
  LONG_EXPLANATION_MAX_CHARS: 2500,

  /** Psychological portrait after natal chart generation. */
  PORTRAIT_TARGET_CHARS: 1000,
  PORTRAIT_MAX_CHARS: 1400,
} as const;
