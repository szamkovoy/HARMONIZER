"use client";

/** Пиктограммы-заглушки; позже заменить на ассеты из public/icons (см. README). */
export function ModeToggle({
  targetMode,
  onToggle,
  disabled,
}: {
  /** Режим, в который переключим по клику */
  targetMode: "VOICE" | "TXT";
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onToggle}
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-700 shadow-sm active:scale-95 disabled:opacity-40 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200"
      aria-label={targetMode === "VOICE" ? "Режим голоса" : "Режим текста"}
    >
      {targetMode === "VOICE" ? (
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden
        >
          <path d="M12 14a3 3 0 003-3V5a3 3 0 10-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 0014 0h-2z" />
        </svg>
      ) : (
        <span className="text-[11px] font-bold tracking-tight">TXT</span>
      )}
    </button>
  );
}
