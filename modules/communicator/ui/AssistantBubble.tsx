"use client";

export function AssistantBubble({
  text,
  isStreaming,
}: {
  text: string;
  isStreaming: boolean;
}) {
  const display = text.trimStart();
  return (
    <div className="flex justify-start px-3 pt-2">
      <div
        className="max-w-[min(100%,36rem)] rounded-[1.25rem] rounded-bl-md bg-white px-4 py-2.5 text-[15px] leading-relaxed text-neutral-900 shadow-sm ring-1 ring-neutral-200/80 dark:bg-neutral-900 dark:text-neutral-100 dark:ring-neutral-700"
        style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}
      >
        <p className="whitespace-pre-wrap break-words">
          {display}
          {isStreaming && (
            <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-neutral-400 align-middle" />
          )}
        </p>
      </div>
    </div>
  );
}
