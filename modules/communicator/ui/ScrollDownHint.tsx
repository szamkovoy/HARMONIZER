"use client";

export function ScrollDownHint({
  visible,
  onClick,
}: {
  visible: boolean;
  onClick: () => void;
}) {
  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      className="pointer-events-auto absolute bottom-24 left-1/2 z-10 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full border border-neutral-200/90 bg-white/95 text-neutral-700 shadow-md backdrop-blur-sm dark:border-neutral-600 dark:bg-neutral-900/95 dark:text-neutral-200"
      aria-label="Прокрутить вниз"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M12 5v14M5 12l7 7 7-7" />
      </svg>
    </button>
  );
}
