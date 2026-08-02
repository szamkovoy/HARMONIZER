/**
 * Split assistant text into `\n` lines for paced bubble reveal.
 * Trailing empty segment after a final newline is dropped so we don't flash a blank line.
 */
export function splitAssistantLines(text: string): string[] {
  if (!text) return [];
  const parts = text.split("\n");
  if (parts.length > 1 && parts[parts.length - 1] === "") {
    return parts.slice(0, -1);
  }
  return parts;
}

/** Lines closed by `\n` while streaming; open tail is buffered (not shown). */
export function closedLineCountWhileTyping(text: string): number {
  if (!text) return 0;
  const lastNl = text.lastIndexOf("\n");
  if (lastNl < 0) return 0;
  return splitAssistantLines(text.slice(0, lastNl + 1)).length;
}
