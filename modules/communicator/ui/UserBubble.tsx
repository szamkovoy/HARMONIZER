"use client";

import { useEffect, useRef, useState } from "react";

const COLLAPSE_LEN = 220;

export function UserBubble({
  text,
  isStreaming,
}: {
  text: string;
  isStreaming: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > COLLAPSE_LEN;
  const showToggle = long && !isStreaming;
  const display =
    !showToggle || expanded ? text : `${text.slice(0, COLLAPSE_LEN)}…`;

  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!long) setExpanded(false);
  }, [text, long]);

  return (
    <div className="flex min-w-0 w-full justify-end px-3 pt-2">
      <div
        className="relative min-w-0 max-w-[min(100%,36rem)] rounded-[1.25rem] rounded-br-md bg-neutral-100 px-4 py-2.5 text-[15px] leading-relaxed text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100"
        style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}
      >
        <p className="whitespace-pre-wrap break-words">{display || "\u00a0"}</p>
        {showToggle && (
          <button
            ref={btnRef}
            type="button"
            className="absolute bottom-1 right-2 flex h-6 w-6 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-200/80 dark:hover:bg-neutral-700/80"
            aria-expanded={expanded}
            aria-label={expanded ? "Свернуть" : "Развернуть"}
            onClick={() => setExpanded((e) => !e)}
          >
            <span className="text-lg leading-none text-neutral-500">
              {expanded ? "⌃" : "⌄"}
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
