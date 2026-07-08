export type BodySegment = { type: "text" | "link"; value: string };

const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;

/**
 * Разбивает plain-text тела публикации на текст и URL-сегменты.
 * Хвостовая пунктуация (`.,!?;:`) не входит в ссылку — частый случай
 * «ссылка в конце предложения».
 */
export function splitBodyIntoSegments(body: string): BodySegment[] {
  const segments: BodySegment[] = [];
  let lastIndex = 0;
  for (const match of body.matchAll(URL_RE)) {
    let url = match[0];
    let trailing = "";
    while (/[.,!?;:]$/.test(url)) {
      trailing = url.slice(-1) + trailing;
      url = url.slice(0, -1);
    }
    const start = match.index ?? 0;
    if (start > lastIndex) segments.push({ type: "text", value: body.slice(lastIndex, start) });
    segments.push({ type: "link", value: url });
    lastIndex = start + match[0].length - trailing.length;
  }
  if (lastIndex < body.length) segments.push({ type: "text", value: body.slice(lastIndex) });
  return segments;
}
