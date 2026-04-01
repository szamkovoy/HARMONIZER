"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUpFromLine, PlusSquare, X } from "lucide-react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function detectIOS(): boolean {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent;
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function detectAndroid(): boolean {
  if (typeof window === "undefined") return false;
  return /Android/i.test(navigator.userAgent);
}

export function InstallLanding({ titleFont }: { titleFont: string }) {
  const [mounted, setMounted] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);
  const [iosModalOpen, setIosModalOpen] = useState(false);
  const [installHint, setInstallHint] = useState<string | null>(null);

  const bipRef = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    setMounted(true);
    const mq = window.matchMedia("(display-mode: standalone)");
    const sync = () => {
      const legacy =
        "standalone" in navigator &&
        (navigator as Navigator & { standalone?: boolean }).standalone === true;
      setStandalone(mq.matches || legacy);
    };
    sync();
    mq.addEventListener("change", sync);
    setIsIOS(detectIOS());
    setIsAndroid(detectAndroid());

    const onBip = (e: Event) => {
      e.preventDefault();
      bipRef.current = e as BeforeInstallPromptEvent;
    };
    window.addEventListener("beforeinstallprompt", onBip);

    return () => {
      mq.removeEventListener("change", sync);
      window.removeEventListener("beforeinstallprompt", onBip);
    };
  }, []);

  useEffect(() => {
    if (!iosModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIosModalOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [iosModalOpen]);

  const handleInstallClick = useCallback(async () => {
    setInstallHint(null);

    if (isIOS) {
      setIosModalOpen(true);
      return;
    }

    const ev = bipRef.current;

    if (isAndroid && ev) {
      try {
        await ev.prompt();
        await ev.userChoice;
      } catch {
        setInstallHint(
          "Не удалось открыть установку. Меню Chrome (⋮) → «Установить приложение».",
        );
      }
      bipRef.current = null;
      return;
    }

    if (ev) {
      try {
        await ev.prompt();
        await ev.userChoice;
      } catch {
        setInstallHint(
          "Меню браузера → «Установить приложение» или «Установить Harmonizer».",
        );
      }
      return;
    }

    if (isAndroid) {
      setInstallHint(
        "Если окно не появилось: меню Chrome (⋮) → «Установить приложение».",
      );
      return;
    }

    setInstallHint(
      "Откройте меню браузера и выберите установку приложения на устройство.",
    );
  }, [isAndroid, isIOS]);

  if (!mounted) {
    return (
      <div className="min-h-dvh bg-[#f5f2ec]" aria-hidden>
        <div className="mx-auto max-w-lg px-5 pt-16 pb-24">
          <div className="h-40 animate-pulse rounded-2xl bg-stone-200/80" />
        </div>
      </div>
    );
  }

  if (standalone) {
    return (
      <div className="min-h-dvh bg-gradient-to-b from-[#faf8f4] via-[#eef6f4] to-[#e2ece9] px-5 pb-16 pt-[max(3rem,env(safe-area-inset-top))]">
        <div className="mx-auto flex max-w-lg flex-col items-center text-center">
          <div className="mb-8 rounded-3xl bg-white/80 p-4 shadow-[0_8px_40px_-12px_rgba(15,118,110,0.35)] ring-1 ring-teal-900/10">
            <Image
              src="/icons/android-icon-192.png"
              alt=""
              width={112}
              height={112}
              className="rounded-2xl"
              priority
            />
          </div>
          <p className="text-lg leading-relaxed text-stone-700 sm:text-xl">
            Приложение уже установлено на ваш телефон. Добро пожаловать!
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      lang="ru"
      className="relative min-h-dvh overflow-x-hidden bg-gradient-to-b from-[#faf8f4] via-[#eef6f4] to-[#dce8e4] px-5 pb-[max(6rem,env(safe-area-inset-bottom))] pt-[max(2.5rem,env(safe-area-inset-top))]"
    >
      <div className="mx-auto flex max-w-lg flex-col items-center text-center">
        <div className="mb-8 rounded-3xl bg-white/85 p-5 shadow-[0_12px_48px_-16px_rgba(13,148,136,0.4)] ring-1 ring-teal-800/10 backdrop-blur-sm">
          <Image
            src="/icons/android-icon-192.png"
            alt=""
            width={120}
            height={120}
            className="rounded-[1.35rem]"
            priority
          />
        </div>

        <h1
          className={`${titleFont} mb-3 text-[2rem] leading-tight tracking-tight text-[#134e4a] sm:text-[2.35rem]`}
        >
          Гармонизатор
        </h1>
        <p className="mb-10 max-w-sm text-[0.95rem] leading-relaxed text-stone-600 sm:text-base">
          Мини-практики на любую ситуацию. Установите приложение — быстрый доступ с экрана «Домой».
        </p>

        <button
          type="button"
          onClick={handleInstallClick}
          className="w-full max-w-xs rounded-2xl bg-gradient-to-r from-[#0d9488] via-[#14b8a6] to-[#2dd4bf] px-8 py-4 text-base font-semibold tracking-[0.14em] text-white shadow-[0_10px_36px_-8px_rgba(13,148,136,0.65)] transition hover:brightness-105 active:scale-[0.98]"
        >
          УСТАНОВИТЬ
        </button>

        {installHint && (
          <p className="mt-6 max-w-md text-sm text-stone-600">{installHint}</p>
        )}
      </div>

      {iosModalOpen && (
        <div
          className="fixed inset-0 z-50 flex flex-col justify-end bg-black/45 p-4 pb-0 backdrop-blur-[2px] sm:items-center sm:justify-center sm:p-6 sm:pb-6"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ios-install-title"
          onClick={() => setIosModalOpen(false)}
        >
          <div
            className="relative mb-2 w-full max-w-md rounded-t-3xl rounded-b-none bg-[#faf8f4] p-6 shadow-2xl ring-1 ring-stone-200/80 sm:mb-0 sm:rounded-3xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setIosModalOpen(false)}
              className="absolute right-4 top-4 rounded-full p-2 text-stone-500 transition hover:bg-stone-200/80 hover:text-stone-800"
              aria-label="Закрыть"
            >
              <X className="h-5 w-5" strokeWidth={2} />
            </button>

            <h2
              id="ios-install-title"
              className={`${titleFont} pr-10 text-left text-xl text-[#134e4a]`}
            >
              Установка на iPhone
            </h2>
            <p className="mt-2 text-left text-sm text-stone-600">
              В Safari установка делается через меню «Поделиться».
            </p>

            <ol className="mt-6 space-y-5 text-left">
              <li className="flex gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-100 text-teal-800">
                  <ArrowUpFromLine className="h-5 w-5" strokeWidth={2} aria-hidden />
                </span>
                <span className="pt-1.5 text-sm leading-relaxed text-stone-700">
                  Нажмите кнопку{' '}
                  <strong className="text-stone-900">«Поделиться»</strong> (квадрат
                  со стрелкой вверх) в нижней панели Safari.
                </span>
              </li>
              <li className="flex gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-800">
                  <PlusSquare className="h-5 w-5" strokeWidth={2} aria-hidden />
                </span>
                <span className="pt-1.5 text-sm leading-relaxed text-stone-700">
                  Затем выберите{' '}
                  <strong className="text-stone-900">«На экран «Домой»»</strong>.
                </span>
              </li>
            </ol>

            <div className="pointer-events-none mt-8 flex flex-col items-center border-t border-stone-200/90 pt-6">
              <span className="mb-2 text-xs font-medium uppercase tracking-wide text-stone-500">
                Кнопка внизу экрана
              </span>
              <ArrowDown
                className="h-9 w-9 animate-bounce text-teal-600"
                strokeWidth={2.5}
                aria-hidden
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
