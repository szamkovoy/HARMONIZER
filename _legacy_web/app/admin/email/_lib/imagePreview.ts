/** Admin previews use the current origin; persisted/send HTML keeps public URLs. */
export function emailImagePreviewSrc(src: string): string {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return src;
  }
  if (url.protocol !== "https:") return src;

  const suffix = `${url.pathname}${url.search}${url.hash}`;
  if (/^[a-z0-9]+\.public\.blob\.vercel-storage\.com$/i.test(url.hostname)) {
    return `/email-cdn${suffix}`;
  }
  if (
    (url.hostname === "harmonizer.zamkovoi.yoga" ||
      url.hostname === "harmonizer-ten.vercel.app") &&
    url.pathname.startsWith("/email-cdn/")
  ) {
    return suffix;
  }
  return src;
}

/** Only image src attributes change, including images in legacy rich-text HTML. */
export function emailImagePreviewHtml(html: string): string {
  return html.replace(/<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi, (tag) =>
    tag.replace(/(\s+)([^\s=/>]+)(\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g,
      (attribute, space, name, equals, doubleQuoted, singleQuoted, unquoted) => {
        if (name.toLowerCase() !== "src") return attribute;
        const quote = doubleQuoted !== undefined ? '"' : singleQuoted !== undefined ? "'" : "";
        const src = doubleQuoted ?? singleQuoted ?? unquoted;
        return `${space}${name}${equals}${quote}${emailImagePreviewSrc(src)}${quote}`;
      },
    ),
  );
}
