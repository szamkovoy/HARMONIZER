import type { CommunicatorHistoryMessage } from "./types";

const FORMAT_SUFFIX = `
Ответ строго в таком формате (без пояснений до или после блоков):
1) Сначала одна строка или блок: открой тег [T], выведи дословную транскрипцию реплики пользователя (для текста — тот же текст), закрой тег [/T].
2) Сразу после этого выведи ответ пользователю обычным текстом (без тегов).
Если вход — аудио, сначала транскрибируй речь внутри [T][/T], затем ответ.`;

export function buildSystemInstruction(systemPrompt: string): string {
  return `${systemPrompt.trim()}\n\n${FORMAT_SUFFIX}`;
}

export function sliceHistoryForWindow(
  history: CommunicatorHistoryMessage[] | undefined,
  memoryWindow: number | undefined,
): CommunicatorHistoryMessage[] {
  if (!history?.length) return [];
  if (memoryWindow == null || memoryWindow <= 0) return [...history];
  return history.slice(-memoryWindow);
}
