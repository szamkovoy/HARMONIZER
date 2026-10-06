/**
 * How far a bottom-anchored composer must pad so its content clears the IME.
 *
 * `viewBottom` is the window Y of the composer's border box (padding does not
 * move that edge). `keyboardTop` is `KeyboardEvent.endCoordinates.screenY`.
 *
 * When `adjustResize` already lifted the window, the border sits on the
 * keyboard and the result is 0 — a second pad would open a blank gap.
 * A few px of slack absorbs nav-bar rounding.
 */
export const KEYBOARD_OVERLAP_SLACK_PX = 12;

export function composerKeyboardPad(viewBottom: number, keyboardTop: number): number {
  if (!Number.isFinite(viewBottom) || !Number.isFinite(keyboardTop)) return 0;
  if (viewBottom <= 0 || keyboardTop <= 0) return 0;
  const overlap = viewBottom - keyboardTop;
  if (overlap <= KEYBOARD_OVERLAP_SLACK_PX) return 0;
  return Math.round(overlap);
}

/**
 * `screenY` is the keyboard top when Android reports it. Edge-to-edge sometimes
 * sends `screenY === 0` and only a height. Use that height only when the
 * composer still reaches the bottom of the window — otherwise `adjustResize`
 * already ran and a height-sized pad would open a second gap.
 */
export function resolveKeyboardTop(
  screenY: number,
  keyboardHeight: number,
  viewBottom: number,
  windowHeight: number,
): number {
  if (Number.isFinite(screenY) && screenY > 0) return screenY;
  if (!Number.isFinite(keyboardHeight) || keyboardHeight <= 0) return 0;
  if (!Number.isFinite(viewBottom) || viewBottom <= 0) return 0;
  if (!Number.isFinite(windowHeight) || windowHeight <= 0) return 0;
  if (viewBottom < windowHeight - KEYBOARD_OVERLAP_SLACK_PX) return 0;
  return Math.max(0, viewBottom - keyboardHeight);
}

/**
 * Viewport for the transcript-review card once the composer is padded above
 * the IME. 0 means "keyboard closed" — the card keeps its natural height.
 */
export function transcriptReviewViewport(
  composerHeight: number,
  keyboardPad: number,
  footerChrome: number,
): number {
  if (!(keyboardPad > 0) || !(composerHeight > 0)) return 0;
  const chrome = Number.isFinite(footerChrome) ? Math.max(0, footerChrome) : 0;
  return Math.max(0, Math.round(composerHeight - keyboardPad - chrome));
}

/**
 * Input box height while the review card is competing with the IME.
 * Resting max (keyboard closed, or plenty of room) stays `restingMax`.
 * On a short viewport the box shrinks so one line of text and the buttons
 * still fit; it never grows past `restingMax`.
 */
export function transcriptInputMaxHeight(
  reviewViewport: number,
  fontScale: number,
  restingMax = 140,
): number {
  if (!(reviewViewport > 0)) return restingMax;
  const scale = Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1;
  const oneLine = Math.round(22 * scale + 16);
  const belowInput = Math.round(28 + 48 * scale);
  const fitted = reviewViewport - belowInput;
  return Math.min(restingMax, Math.max(oneLine, fitted));
}
