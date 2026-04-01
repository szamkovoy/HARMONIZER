"use client";

/**
 * Пиктограммы: `/public/icons/mode_voice.png`, `mode_txt.png`.
 * @see правило в `.cursor/rules/main.mdc` — ассеты UI в `public/icons/`.
 */
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
  const src =
    targetMode === "VOICE"
      ? "/icons/mode_voice.png"
      : "/icons/mode_txt.png";

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onToggle}
      className="flex h-10 w-10 shrink-0 items-center justify-center bg-transparent p-0 active:scale-95 disabled:opacity-40 disabled:active:scale-100 dark:[&_img]:brightness-0 dark:[&_img]:invert"
      aria-label={targetMode === "VOICE" ? "Переключить на текст" : "Переключить на голос"}
    >
      <img
        src={src}
        alt=""
        width={targetMode === "VOICE" ? 22 : 40}
        height={22}
        draggable={false}
        className="pointer-events-none object-contain select-none"
      />
    </button>
  );
}
