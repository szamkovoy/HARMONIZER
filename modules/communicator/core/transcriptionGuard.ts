/**
 * Известные «галлюцинации» Whisper на почти пустом / очень коротком аудио
 * (модель «додумывает» текст субтитров и т.п.). Не путать с низкой confidence —
 * такие строки иногда приходят с уверенностью выше порога review.
 */
export function isSpuriousTranscription(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  if (/dimatorzok|диматорзок/.test(t)) return true;
  if (/субтитр/.test(t) && /(создавал|создал|created)/i.test(t)) return true;
  if (/подписывайтесь на канал|subscribe to (the )?channel/i.test(t)) return true;
  return false;
}
