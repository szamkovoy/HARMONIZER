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
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/icons/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/icons/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/android-icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/android-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "HRM Админ",
  },
};

export const viewport: Viewport = {
  themeColor: "#f4f4f5",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh min-w-0 overflow-x-clip bg-zinc-50 text-zinc-900 [scrollbar-gutter:stable]">
      <AdminChrome>{children}</AdminChrome>
    </div>
  );
}
