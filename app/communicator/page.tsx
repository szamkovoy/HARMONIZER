"use client";

import { Communicator } from "@/modules/communicator";

export default function CommunicatorDemoPage() {
  return (
    <div className="flex h-dvh flex-col">
      <header className="shrink-0 border-b border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-950">
        <h1 className="text-center text-base font-semibold text-neutral-900 dark:text-neutral-100">
          Communicator
        </h1>
      </header>
      <Communicator
        className="flex-1"
        systemPrompt="Ты эмпатичный психолог-наставник приложения Harmonizer. Отвечай кратко и по делу, на русском языке, если пользователь пишет по-русски."
        initialMode="VOICE"
        onEmotionSegment={() => {
          /* задел под Hume — пока no-op */
        }}
        onError={(e) => console.error(e)}
      />
    </div>
  );
}
