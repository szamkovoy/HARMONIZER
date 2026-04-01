import type { Metadata } from "next";
import { Montserrat } from "next/font/google";

import { InstallLanding } from "./install-landing";

const fontDisplay = Montserrat({
  subsets: ["latin", "cyrillic"],
  weight: ["600", "700"],
});

const fontSans = Montserrat({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Установить",
  description:
    "Установите приложение «Гармонизатор» на телефон — быстрый доступ с экрана «Домой».",
  appleWebApp: {
    capable: true,
    title: "Harmonizer",
  },
};

export default function InstallPage() {
  return (
    <div className={`${fontSans.className} min-h-dvh`}>
      <InstallLanding titleFont={fontDisplay.className} />
    </div>
  );
}
