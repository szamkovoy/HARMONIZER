import Constants from "expo-constants";

/**
 * Metro origin for Dev Client (LAN). Used to fetch EPUB from `/hz-book/{locale}.epub`
 * without bundling a second ~8MB asset into Metro (that broke cold start).
 */
export function metroDevOrigin(): string | null {
  if (!__DEV__) return null;
  const expoConfigHost = Constants.expoConfig?.hostUri;
  const manifest2Host = (
    Constants as {
      manifest2?: { extra?: { expoClient?: { hostUri?: string } } };
    }
  ).manifest2?.extra?.expoClient?.hostUri;
  const legacyHost = (Constants as { manifest?: { debuggerHost?: string } }).manifest
    ?.debuggerHost;
  const hostUri = expoConfigHost || manifest2Host || legacyHost || null;
  if (!hostUri || typeof hostUri !== "string") return null;
  const host = hostUri.split("/")[0]?.split("?")[0]?.trim();
  if (!host) return null;
  if (host.startsWith("http://") || host.startsWith("https://")) return host.replace(/\/$/, "");
  return `http://${host}`;
}

/** Dev-only URL for a locale EPUB served by metro.config.js middleware. */
export function bookDevEpubUrl(bookLocale: string): string | null {
  const origin = metroDevOrigin();
  if (!origin) return null;
  return `${origin}/hz-book/${bookLocale}.epub`;
}
