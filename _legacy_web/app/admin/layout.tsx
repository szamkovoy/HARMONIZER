import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { AdminChrome } from "./_components/AdminChrome";

export const metadata: Metadata = {
  title: {
    default: "Админка · Harmonizer",
    template: "%s · Админка Harmonizer",
  },
  description: "Панель управления HARMONIZER",
  manifest: "/admin-manifest.json",
  robots: { index: false, follow: false },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "HRM Админ",
  },
};

export const viewport: Viewport = {
  themeColor: "#07080c",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh min-w-0 overflow-x-clip bg-[#07080c] text-zinc-100 [scrollbar-gutter:stable]">
      <AdminChrome>{children}</AdminChrome>
    </div>
  );
}
