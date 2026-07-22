/**
 * Vimeo embed helpers for the asana practice screen.
 *
 * Per `docs/remote-play/README.md` the Vimeo videos are domain-locked to
 * `zamkovoi.yoga` / `zamkovoi.ru` (Vimeo "Where can this be embedded?" =
 * specific domains). A direct WebView load of `player.vimeo.com/video/<id>`
 * has no `Referer` from an allowed domain and Vimeo returns `PrivacyError`
 * ("Because of its privacy settings, this video cannot be played here").
 *
 * Two helpers:
 * - `vimeoEmbedUrl(vimeoId, audiotrack)` — the canonical iframe `src`:
 *   `https://player.vimeo.com/video/<id>?audiotrack=ru`. No other query params
 *   (otherwise the Russian audio track breaks — see migration
 *   `20260503075500_fix_vimeo_ru_audiotrack.sql`). Used by the TV page.
 * - `vimeoEmbedHtml(vimeoId, audiotrack)` — a full HTML document that mounts
 *   that iframe, intended to be loaded via
 *   `WebView source={{ html, baseUrl: VIMEO_EMBED_BASE_URL }}` on **iOS**
 *   (WKWebView baseURL). Android Chromium often leaves this path black /
 *   PrivacyError-opaque, so the phone player on Android uses
 *   `vimeoPhoneEmbedPageUrl` → real page `https://zamkovoi.yoga/asana-embed.html`
 *   (file in `web_cabinet/asana-embed.html`, deploy like cabinet).
 * - `vimeoPhoneEmbedPageUrl(vimeoId, audiotrack)` — HTTPS URL of that page.
 *
 * Audio language: the asana videos ship exactly two Vimeo audio tracks —
 * Russian (`ru`) and English (`en`); see `scripts/import-vimeo-asanas.mjs`
 * `vimeo_embed.audiotrack_by_locale` (`ru → ru`, `en → en`). The app exposes
 * 8 content locales, so the locale→track mapping collapses to: RU → `ru`,
 * every other locale (EN/DE/FR/IT/ES/PT/NL) → `en`. Use
 * `vimeoAudiotrackForLocale(locale)` to derive the slug and pass it to both
 * helpers; the phone player and the TV launch path must agree on it so a
 * non-Russian app locale plays the English track on both surfaces.
 */
import type { AppContentLocale } from "@/modules/i18n/localeCodes";

const VIMEO_PLAYER_BASE = "https://player.vimeo.com/video";
export const VIMEO_DEFAULT_AUDIOTRACK = "ru";
export const VIMEO_RU_AUDIOTRACK = "ru";
export const VIMEO_EN_AUDIOTRACK = "en";
export const VIMEO_EMBED_BASE_URL = "https://zamkovoi.yoga/";
/** Hosted phone player page (same origin as Vimeo allowlist). See `web_cabinet/asana-embed.html`. */
export const VIMEO_PHONE_EMBED_PAGE_URL = "https://zamkovoi.yoga/asana-embed.html";

export function vimeoAudiotrackForLocale(locale: AppContentLocale): string {
  return locale === "ru" ? VIMEO_RU_AUDIOTRACK : VIMEO_EN_AUDIOTRACK;
}

export function vimeoEmbedUrl(vimeoId: string, audiotrack: string = VIMEO_DEFAULT_AUDIOTRACK): string {
  const trimmedId = vimeoId.trim();
  const track = (audiotrack ?? VIMEO_DEFAULT_AUDIOTRACK).trim() || VIMEO_DEFAULT_AUDIOTRACK;
  return `${VIMEO_PLAYER_BASE}/${encodeURIComponent(trimmedId)}?audiotrack=${encodeURIComponent(track)}`;
}

/** Real HTTPS page on zamkovoi.yoga — preferred WebView source on Android. */
export function vimeoPhoneEmbedPageUrl(
  vimeoId: string,
  audiotrack: string = VIMEO_DEFAULT_AUDIOTRACK,
): string {
  const trimmedId = vimeoId.trim();
  const track = (audiotrack ?? VIMEO_DEFAULT_AUDIOTRACK).trim() || VIMEO_DEFAULT_AUDIOTRACK;
  const qs = new URLSearchParams({ vimeoId: trimmedId, audiotrack: track });
  return `${VIMEO_PHONE_EMBED_PAGE_URL}?${qs.toString()}`;
}

export function vimeoEmbedHtml(vimeoId: string, audiotrack: string = VIMEO_DEFAULT_AUDIOTRACK): string {
  const src = vimeoEmbedUrl(vimeoId, audiotrack);
  return [
    "<!DOCTYPE html>",
    "<html>",
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">',
    "<style>",
    "html,body,iframe{margin:0;padding:0;border:0;width:100%;height:100%;background:#000;overflow:hidden;}",
    "body{display:block;}",
    "</style>",
    "</head>",
    "<body>",
    `<iframe src="${src}" width="100%" height="100%" frameborder="0" allow="autoplay; fullscreen; encrypted-media" allowfullscreen id="v"></iframe>`,
    '<script src="https://player.vimeo.com/api/player.js"></script>',
    "<script>",
    "(function(){",
    "  var iframe=document.getElementById('v');",
    "  var send=function(obj){try{window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify(obj));}catch(e){}};",
    "  send({type:'ready'});",
    "  function attach(){",
    "    if(!window.Vimeo){setTimeout(attach,120);return;}",
    "    var p=new Vimeo.Player(iframe);",
    "    p.on('play',function(){send({type:'play'});});",
    "    p.on('pause',function(){send({type:'pause'});});",
    "    p.on('ended',function(){send({type:'ended'});});",
    "    p.on('timeupdate',function(d){if(d&&typeof d.seconds==='number'){send({type:'time',seconds:Math.floor(d.seconds)});}});",
    "    try{p.ready().then(function(){",
    "      p.getQualities().then(function(qs){var best=null;for(var i=0;i<qs.length;i++){if(qs[i].id!=='auto'&&qs[i].active){best=qs[i];}}",
    "        if(!best){for(var i=0;i<qs.length;i++){if(qs[i].id!=='auto'){best=qs[i];break;}}}",
    "        if(best){p.setCurrentQuality(best.id).catch(function(){});}",
    "      }).catch(function(){});",
    "      // Android WebView often leaves the iframe black until an explicit play().",
    "      p.setVolume(1).catch(function(){});",
    "      p.setMuted(false).catch(function(){});",
    "      p.play().then(function(){send({type:'play'});}).catch(function(){",
    "        p.setMuted(true).catch(function(){});",
    "        p.play().catch(function(){});",
    "      });",
    "    }).catch(function(){});}catch(e){}",
    "  }",
    "  attach();",
    "})();",
    "</script>",
    "</body>",
    "</html>",
  ].join("");
}
