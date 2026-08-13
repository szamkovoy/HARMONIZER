// @ts-check
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Phase A: bundle local EPUB for the book reader (Dev Client / EAS).
config.resolver.assetExts = [...(config.resolver.assetExts ?? []), "epub"];

/**
 * Heavy trees Metro must not resolve/crawl. Without Watchman, Metro’s Node
 * crawler walks the project root — `_legacy_web/.next` (~1.3G), `ios` (~1G),
 * `dist` (~0.5G), ambient `raw`, `Book/` make Dev Client “Downloading …” crawl
 * for minutes at a few percent.
 *
 * Do NOT block all of `_legacy_web/` — the app imports `@shared` and
 * `@/_legacy_web/app/api/_utils/*`. Only build/deps noise.
 * Does not change store/production JS; restart Metro after edits.
 * Also see `.watchmanconfig`.
 */
function absDirRe(relDir) {
  const abs = path.resolve(__dirname, relDir).replace(/[/\\]/g, "[/\\\\]");
  return new RegExp(`^${abs}[/\\\\]`);
}

const heavyBlocks = [
  absDirRe("Book"),
  absDirRe("dist"),
  absDirRe("ios"),
  absDirRe("android"),
  absDirRe("docs"),
  absDirRe("supabase"),
  absDirRe("PHOTOS"),
  absDirRe("import"),
  absDirRe("web_cabinet"),
  absDirRe("assets/audio/ambient/raw"),
  absDirRe("_legacy_web/node_modules"),
  absDirRe("_legacy_web/.next"),
  absDirRe("_legacy_web/out"),
];

const prev = config.resolver.blockList;
const prevList = Array.isArray(prev) ? prev : prev ? [prev] : [];
config.resolver.blockList = [...prevList, ...heavyBlocks];

module.exports = config;
