/**
 * Известные «галлюцинации» Whisper на почти пустом / очень коротком аудио
 * (модель «додумывает» текст субтитров и т.п.). Не путать с низкой confidence —
 * такие строки иногда приходят с уверенностью выше порога review.
 *
 * Важно для summarizing: ложный короткий ответ («Нет», «Thank you.») может
 * закрыть planned_event с пустым outcome — тишина не должна уходить на сервер.
 */
export function isSpuriousTranscription(text: string): boolean {
  const raw = text.trim();
  if (!raw) return true;

  const t = raw.toLowerCase();
  const letters = t.replace(/[^\p{L}\p{N}]+/gu, "");
  if (letters.length < 3) return true;

  if (/dimatorzok|диматорзок/.test(t)) return true;
  if (/субтитр/.test(t) && /(создавал|создал|created)/i.test(t)) return true;
  if (/подписывайтесь на канал|subscribe to (the )?channel/i.test(t)) return true;
  if (/thanks for watching|thank you for watching|продолжение следует/i.test(t)) return true;
  if (/^(?:thanks?(?:\s+you)?|thank you|bye|ok|okay|umm+|uh+|а+|хм+|мм+|ага)[.!…]*$/i.test(t)) {
    return true;
  }
  return false;
}
