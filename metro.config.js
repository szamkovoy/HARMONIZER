// @ts-check
const fs = require("fs");
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Phase A Dev: EPUBs are NOT Metro assets (see /hz-book/ middleware below).
// Keep .epub in assetExts only so accidental requires resolve if added later.
config.resolver.assetExts = [...(config.resolver.assetExts ?? []), "epub"];

const prevEnhance = config.server?.enhanceMiddleware;
config.server = {
  ...config.server,
  enhanceMiddleware: (metroMiddleware, server) => {
    const inner = typeof prevEnhance === "function" ? prevEnhance(metroMiddleware, server) : metroMiddleware;
    return (req, res, next) => {
      const raw = req.url || "";
      const pathname = raw.split("?")[0] || "";
      const m = pathname.match(/^\/hz-book\/([a-z]{2})\.epub$/);
      if (m) {
        const locale = m[1];
        const file = path.join(__dirname, "Book", "build", locale, "book.epub");
        if (!fs.existsSync(file)) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end(`missing Book/build/${locale}/book.epub`);
          return;
        }
        const stat = fs.statSync(file);
        res.writeHead(200, {
          "Content-Type": "application/epub+zip",
          "Content-Length": stat.size,
          "Cache-Control": "no-store",
        });
        fs.createReadStream(file).pipe(res);
        return;
      }
      return inner(req, res, next);
    };
  },
};

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
