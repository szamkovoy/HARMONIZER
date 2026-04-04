/**
 * Инкрементальный разбор ответа модели: сначала [T]транскрипция[/T], затем ответ ассистента.
 */

export interface ParsedStreamParts {
  /** Текст транскрипции (может наращиваться, пока не закрыт [/T]) */
  transcript: string;
  /** true после полного парсинга закрывающего тега */
  transcriptComplete: boolean;
  /** Текст ответа ассистента (после [/T]) */
  answer: string;
}

const OPEN = "[T]";
const CLOSE = "[/T]";

/** Убирает типичные «протечки» служебных фраз модели в блок транскрипции. */
export function sanitizeTranscriptText(raw: string): string {
  let s = raw.trim();
  s = s.replace(
    /\s*Выполни инструкции:\s*сначала[^.!?]*[.!?]?/gi,
    "",
  );
  s = s.replace(/\s*сначала транскрипция,\s*затем ответ\.?/gi, "");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/**
 * Разбор по полному накопленному буферу стрима.
 */
export function parseTranscriptStream(buffer: string): ParsedStreamParts {
  const parts: ParsedStreamParts = {
    transcript: "",
    transcriptComplete: false,
    answer: "",
  };

  const openIdx = buffer.indexOf(OPEN);
  if (openIdx === -1) {
    return parts;
  }

  const afterOpen = openIdx + OPEN.length;
  const closeIdx = buffer.indexOf(CLOSE, afterOpen);

  if (closeIdx === -1) {
    parts.transcript = buffer.slice(afterOpen);
    return parts;
  }

  parts.transcript = sanitizeTranscriptText(buffer.slice(afterOpen, closeIdx));
  parts.transcriptComplete = true;
  parts.answer = buffer.slice(closeIdx + CLOSE.length).trimStart();
  return parts;
}
