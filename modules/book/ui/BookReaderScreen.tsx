import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Reader, ReaderProvider, useReader } from "@epubjs-react-native/core";
import { router } from "expo-router";

import { useAuth } from "@/modules/auth";
import { useAppLocale, useTranslate } from "@/modules/i18n";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";
import { useThemePreference } from "@/modules/ui/themePreference";

import { bookAssetModule } from "../core/bookAssets";
import { buildEnsureCoverStageScript } from "../core/coverStage";
import { chapterTocItems, flattenToc, isChapterFooterLabel } from "../core/flattenToc";
import { bookLocaleForAppLocale, type BookLocale } from "../core/bookIds";
import {
  CAPTURE_LIVE_ANCHOR_JS,
  isUsableAnchor,
  isZeroishProgress,
  normalizeSeedPercent,
  pageIndexFromAnchor,
  parseLiveAnchorMessage,
  pickRicherAnchor,
  progressRatioFromAnchor,
  shouldAcceptAnchor,
  stabilizeTocHref,
  tocLabelForHref,
  type LiveAnchor,
} from "../core/liveAnchor";
import { loadReadingProgress, saveReadingProgress } from "../core/readingProgress";
import {
  DEFAULT_READER_PREFS,
  FONT_FAMILY_CSS,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  FONT_SIZE_STEP,
  LINE_HEIGHT_MAX,
  LINE_HEIGHT_MIN,
  LINE_HEIGHT_STEP,
  MARGIN_MAX,
  MARGIN_MIN,
  MARGIN_STEP,
  loadReaderPrefs,
  saveReaderPrefs,
  type ReaderFontFamily,
  type ReaderPrefs,
} from "../core/readerPrefs";
import { buildReaderTheme } from "../core/readerTheme";
import { resolveBookSrc } from "../core/resolveBookSrc";
import {
  buildRestoreLocationScript,
  visibleCenterPercentage,
  visibleStartPercentage,
} from "../core/restoreLocation";
import { buildTocNavigateScript, TAP_ZONE_BRIDGE_JS } from "../core/tocNavigate";
import { useBookFileSystem } from "../core/useBookFileSystem";

const TOP_CHROME_BODY = 44;
const BOTTOM_CHROME_BODY = 72;

function StepperRow({
  label,
  valueLabel,
  onMinus,
  onPlus,
  minusDisabled,
  plusDisabled,
}: {
  label: string;
  valueLabel: string;
  onMinus: () => void;
  onPlus: () => void;
  minusDisabled?: boolean;
  plusDisabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={styles.stepperRow}>
      <AppText variant="dialogBody" style={styles.stepperLabel}>
        {label}
      </AppText>
      <View style={styles.stepperControls}>
        <Pressable
          onPress={onMinus}
          disabled={minusDisabled}
          style={[
            styles.stepBtn,
            {
              borderColor: theme.colors.surfaceBorder,
              opacity: minusDisabled ? 0.35 : 1,
            },
          ]}
        >
          <AppText variant="dialogBody">−</AppText>
        </Pressable>
        <AppText variant="dialogBody" style={styles.stepValue}>
          {valueLabel}
        </AppText>
        <Pressable
          onPress={onPlus}
          disabled={plusDisabled}
          style={[
            styles.stepBtn,
            {
              borderColor: theme.colors.surfaceBorder,
              opacity: plusDisabled ? 0.35 : 1,
            },
          ]}
        >
          <AppText variant="dialogBody">+</AppText>
        </Pressable>
      </View>
    </View>
  );
}

function ReaderChrome({
  src,
  initialLocator,
  initialPercent,
  initialChapterLabel,
  initialSnippet,
  initialHref,
  bookLocale,
  userId,
}: {
  src: string;
  initialLocator: string | null;
  initialPercent: number | null;
  initialChapterLabel: string | null;
  initialSnippet: string | null;
  initialHref: string | null;
  bookLocale: BookLocale;
  userId: string;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { scheme } = useThemePreference();
  const { t } = useTranslate();
  const {
    changeTheme,
    changeFontSize,
    changeFontFamily,
    goToLocation,
    goNext,
    goPrevious,
    getCurrentLocation,
    injectJavascript,
    toc,
    totalLocations,
    currentLocation,
    search,
    searchResults,
    clearSearchResults,
    isSearching,
    locations,
  } = useReader();

  const [prefs, setPrefs] = useState<ReaderPrefs>(DEFAULT_READER_PREFS);
  const [prefsReady, setPrefsReady] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [tocOpen, setTocOpen] = useState(false);
  const [aaOpen, setAaOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [scrubOverride, setScrubOverride] = useState<number | null>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  /** Remount only when scroll flow changes — font/size stay in-place + snippet restore. */
  const [readerEpoch, setReaderEpoch] = useState(0);
  const [resumeLocator, setResumeLocator] = useState<string | null>(initialLocator);
  /** Live CFI/href from WebView — library `section`/`currentLocation` can lag after TOC/taps. */
  const [liveAnchor, setLiveAnchor] = useState<LiveAnchor | null>(null);
  /** Chrome progress seed (0–100); state so footer re-renders (refs alone do not). */
  const [chromeSeedPercent, setChromeSeedPercent] = useState<number | null>(() =>
    normalizeSeedPercent(initialPercent),
  );
  const chromeSeedPercentRef = useRef(chromeSeedPercent);
  chromeSeedPercentRef.current = chromeSeedPercent;
  const trackWidthRef = useRef(0);
  const trackOriginXRef = useRef(0);
  const scrubTrackRef = useRef<View>(null);
  const scrubbingRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoreTokenRef = useRef(0);
  const remountTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncAnchorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastChromeToggleAt = useRef(0);
  const scrubOverrideRef = useRef<number | null>(null);
  const scrubClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resumeLocatorRef = useRef<string | null>(initialLocator);
  resumeLocatorRef.current = resumeLocator;
  const resumePercentageRef = useRef<number | null>(
    (() => {
      const seed = normalizeSeedPercent(initialPercent);
      return seed != null ? seed / 100 : null;
    })(),
  );
  const resumeSnippetRef = useRef<string | null>(initialSnippet);
  const resumeHrefRef = useRef<string | null>(initialHref);
  /** After paginated↔scrolled remount: restore by start-% / snippet (not CFI initial). */
  const preferPercentageRestoreRef = useRef(false);
  /** Skip CFI as Reader initialLocation on flow remount (CFI lands wrong across managers). */
  const [skipInitialCfi, setSkipInitialCfi] = useState(false);
  /** Spine file only (no #) as initialLocation on flow remount — then snap by start-%. */
  const [flowResumeHref, setFlowResumeHref] = useState<string | null>(null);
  const tocListRef = useRef<ScrollView>(null);
  const tocListHeightRef = useRef(360);
  const tocScrollPendingRef = useRef(false);
  const restoringRef = useRef(!!initialLocator);
  const liveAnchorRef = useRef<LiveAnchor | null>(null);
  const pendingAnchorResolverRef = useRef<((a: LiveAnchor | null) => void) | null>(null);
  const [stickyChapterLabel, setStickyChapterLabel] = useState<string | null>(() =>
    isChapterFooterLabel(initialChapterLabel) ? initialChapterLabel!.trim() : null,
  );
  const totalLocationsRef = useRef(totalLocations);
  totalLocationsRef.current = totalLocations;
  const chapterTocRef = useRef<ReturnType<typeof chapterTocItems>>([]);
  const flatTocRef = useRef<ReturnType<typeof flattenToc>>([]);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const scrollModeRef = useRef(prefs.scrollMode);
  scrollModeRef.current = prefs.scrollMode;
  const sheetOpenRef = useRef(false);
  sheetOpenRef.current = tocOpen || aaOpen || searchOpen;
  const widthRef = useRef(width);
  widthRef.current = width;
  const goNextRef = useRef(goNext);
  goNextRef.current = goNext;
  const goPreviousRef = useRef(goPrevious);
  goPreviousRef.current = goPrevious;
  const injectJavascriptRef = useRef(injectJavascript);
  injectJavascriptRef.current = injectJavascript;

  const readerTheme = useMemo(
    () => buildReaderTheme(theme.colors, prefs, scheme),
    [theme.colors, prefs, scheme],
  );

  const flatToc = useMemo(() => flattenToc(toc as never), [toc]);
  const chapterToc = useMemo(() => chapterTocItems(flatToc), [flatToc]);
  chapterTocRef.current = chapterToc;
  flatTocRef.current = flatToc;

  useEffect(() => {
    void loadReaderPrefs().then((loaded) => {
      setPrefs(loaded);
      setPrefsReady(true);
    });
  }, []);

  useEffect(() => {
    if (!initialLocator) return;
    setResumeLocator((prev) => prev ?? initialLocator);
    if (!resumeLocatorRef.current) resumeLocatorRef.current = initialLocator;
  }, [initialLocator]);

  // App light/dark only — do not touch font/flow (that resets position).
  useEffect(() => {
    if (!prefsReady) return;
    changeTheme(buildReaderTheme(theme.colors, prefsRef.current, scheme));
  }, [prefsReady, scheme, theme.colors, changeTheme]);

  const forceAcceptNavRef = useRef(false);

  const applyLiveAnchor = useCallback((anchor: LiveAnchor | null) => {
    if (!anchor) return;
    const forceAccept = forceAcceptNavRef.current;
    if (
      !shouldAcceptAnchor(liveAnchorRef.current, anchor, {
        restoring: restoringRef.current,
        resumePercentage: resumePercentageRef.current,
        seedPercent: chromeSeedPercentRef.current,
        forceAccept,
      })
    ) {
      return;
    }
    const prev = liveAnchorRef.current;
    const prevFile = (prev?.href ?? "").split("#")[0]?.replace(/^.*\//, "").toLowerCase() ?? "";
    const nextFile = (anchor.href ?? "").split("#")[0]?.replace(/^.*\//, "").toLowerCase() ?? "";
    const crossedSpine = !!(prevFile && nextFile && prevFile !== nextFile);

    // After search/TOC across files, do not keep the old chapter fragment.
    const incomingToc =
      crossedSpine && !anchor.tocHref?.includes("#") ? null : anchor.tocHref;
    const stableToc = stabilizeTocHref(
      crossedSpine ? null : prev?.tocHref,
      incomingToc,
      chapterTocRef.current,
      crossedSpine ? null : prev?.percentage,
      anchor.percentage,
      { tocSource: anchor.tocSource },
    );
    const next: LiveAnchor = { ...anchor, tocHref: stableToc };
    liveAnchorRef.current = next;
    setLiveAnchor(next);
    if (forceAccept) forceAcceptNavRef.current = false;
    if (next.cfi) {
      resumeLocatorRef.current = next.cfi;
      setResumeLocator(next.cfi);
    }
    if (
      typeof next.percentage === "number" &&
      Number.isFinite(next.percentage) &&
      !isZeroishProgress(next.percentage, next.location)
    ) {
      resumePercentageRef.current = next.percentage;
      setChromeSeedPercent(Math.round(next.percentage * 1000) / 10);
    } else if (forceAccept || crossedSpine) {
      // Drop stale seed so page chrome can follow the new place.
      resumePercentageRef.current = null;
      setChromeSeedPercent(null);
    }
    if (next.snippet) resumeSnippetRef.current = next.snippet;
    if (next.tocHref) resumeHrefRef.current = next.tocHref;
    else if (next.href) resumeHrefRef.current = next.href;
    // flatToc includes «Часть…» parents — chapterToc alone left footer as «Учебное пособие».
    const label = tocLabelForHref(next.tocHref ?? next.href, flatTocRef.current);
    if (label && isChapterFooterLabel(label)) setStickyChapterLabel(label);
    else if (crossedSpine || forceAccept) setStickyChapterLabel(null);
    if (restoringRef.current && isUsableAnchor(next)) {
      const resumePct = resumePercentageRef.current;
      const okPct =
        typeof next.percentage !== "number" ||
        resumePct == null ||
        Math.abs(next.percentage - resumePct) < 0.12 ||
        !!next.snippet;
      if (okPct || next.atEnd || forceAccept || crossedSpine) {
        restoringRef.current = false;
      }
    }
  }, []);

  const captureLiveAnchor = useCallback((): Promise<LiveAnchor | null> => {
    return new Promise((resolve) => {
      if (pendingAnchorResolverRef.current) {
        pendingAnchorResolverRef.current(liveAnchorRef.current);
        pendingAnchorResolverRef.current = null;
      }
      let settled = false;
      const finish = (value: LiveAnchor | null) => {
        if (settled) return;
        settled = true;
        if (pendingAnchorResolverRef.current === resolve || pendingAnchorResolverRef.current == null) {
          pendingAnchorResolverRef.current = null;
        }
        resolve(value);
      };
      pendingAnchorResolverRef.current = (a) => finish(a);
      injectJavascriptRef.current(CAPTURE_LIVE_ANCHOR_JS);
      setTimeout(() => {
        finish(liveAnchorRef.current);
      }, 450);
    });
  }, []);

  const captureLiveAnchorRich = useCallback(async (): Promise<LiveAnchor | null> => {
    const a = await captureLiveAnchor();
    await new Promise((r) => setTimeout(r, 90));
    const b = await captureLiveAnchor();
    return pickRicherAnchor(a, b);
  }, [captureLiveAnchor]);

  const scheduleSyncAnchor = useCallback(
    (delayMs = 180) => {
      if (syncAnchorTimer.current) clearTimeout(syncAnchorTimer.current);
      syncAnchorTimer.current = setTimeout(() => {
        void captureLiveAnchor().then(applyLiveAnchor);
      }, delayMs);
    },
    [applyLiveAnchor, captureLiveAnchor],
  );

  const runFocusRestore = useCallback(() => {
    const preferPercentage = preferPercentageRestoreRef.current;
    // Flow switch keeps CFI; font reflow may fall back to initialLocator.
    const cfi = resumeLocatorRef.current ?? (preferPercentage ? null : initialLocator);
    const percentage = resumePercentageRef.current;
    const snippet = resumeSnippetRef.current;
    // Flow switch: spine file only (strip fragment so restore won't byHref to heading).
    const href = preferPercentage
      ? (resumeHrefRef.current ?? "").split("#")[0] || null
      : resumeHrefRef.current;
    restoringRef.current = !!(cfi || percentage != null || snippet);
    if (!(cfi || percentage != null || snippet || href)) {
      restoringRef.current = false;
      preferPercentageRestoreRef.current = false;
      setSkipInitialCfi(false);
      setFlowResumeHref(null);
      return;
    }
    restoreTokenRef.current += 1;
    injectJavascriptRef.current(
      buildRestoreLocationScript({
        cfi,
        percentage,
        snippet,
        href,
        token: restoreTokenRef.current,
        preferPercentage,
      }),
    );
    setTimeout(() => {
      if (!restoringRef.current) return;
      restoringRef.current = false;
      preferPercentageRestoreRef.current = false;
      setSkipInitialCfi(false);
      setFlowResumeHref(null);
      scheduleSyncAnchor(80);
    }, 3600);
  }, [initialLocator, scheduleSyncAnchor]);

  const updatePrefs = useCallback(
    (patch: Partial<ReaderPrefs>) => {
      const prev = prefsRef.current;
      const next = { ...prev, ...patch };
      prefsRef.current = next;
      setPrefs(next);
      void saveReaderPrefs(next);

      const fontishChanged =
        (patch.fontFamily != null && patch.fontFamily !== prev.fontFamily) ||
        (patch.fontSizePx != null && patch.fontSizePx !== prev.fontSizePx) ||
        (patch.lineHeight != null && patch.lineHeight !== prev.lineHeight);
      const marginChanged = patch.marginPx != null && patch.marginPx !== prev.marginPx;
      const scrollChanged = patch.scrollMode != null && patch.scrollMode !== prev.scrollMode;

      // Margins are RN insets around the WebView — resize after width change.
      if (marginChanged && !fontishChanged && !scrollChanged) {
        setTimeout(() => {
          const side =
            next.scrollMode === "scrolled" ? next.marginPx + 6 : next.marginPx;
          const w = Math.max(160, widthRef.current - side * 2);
          const h = Math.max(220, height - insets.bottom - insets.top);
          injectJavascriptRef.current(`
            (function () {
              try {
                if (typeof rendition !== "undefined" && rendition && typeof rendition.resize === "function") {
                  rendition.resize(${w}, ${h});
                }
              } catch (e) {}
              return true;
            })();
            true;
          `);
        }, 50);
        return;
      }

      if (!fontishChanged && !scrollChanged) return;

      if (remountTimer.current) clearTimeout(remountTimer.current);
      remountTimer.current = setTimeout(() => {
        void (async () => {
          const anchor = await captureLiveAnchorRich();
          const loc = getCurrentLocation();
          const cfi =
            anchor?.cfi ?? loc?.start?.cfi ?? loc?.end?.cfi ?? resumeLocatorRef.current;

          if (scrollChanged) {
            // Remount continuous↔paginated — keep the same on-screen line.
            // Critical: use TOP-OF-VIEW % (not anchor center %). applyLiveAnchor
            // would overwrite with mid-page % and jump many screens.
            const spineFile =
              (anchor?.href ?? loc?.start?.href ?? resumeHrefRef.current ?? "")
                .split("#")[0]
                ?.trim() || null;
            const startPct =
              visibleStartPercentage(loc, totalLocationsRef.current) ??
              (typeof loc?.start?.percentage === "number" && loc.start.percentage > 0.002
                ? loc.start.percentage
                : null) ??
              (typeof anchor?.percentage === "number" &&
              !isZeroishProgress(anchor.percentage, anchor.location)
                ? anchor.percentage
                : null) ??
              resumePercentageRef.current;
            const snippet = anchor?.snippet ?? resumeSnippetRef.current;

            if (anchor && isUsableAnchor(anchor)) applyLiveAnchor(anchor);

            preferPercentageRestoreRef.current = true;
            // Do not open on CFI — between managers it lands elsewhere; restore by %.
            setSkipInitialCfi(true);
            setFlowResumeHref(spineFile);
            if (spineFile) resumeHrefRef.current = spineFile;
            if (typeof startPct === "number" && startPct > 0.002) {
              resumePercentageRef.current = startPct;
              setChromeSeedPercent(Math.round(startPct * 1000) / 10);
            }
            if (snippet) resumeSnippetRef.current = snippet;
            if (cfi) {
              setResumeLocator(cfi);
              resumeLocatorRef.current = cfi;
            }
            restoringRef.current = true;
            setReaderEpoch((n) => n + 1);
            return;
          }

          let percentage =
            typeof anchor?.percentage === "number" &&
            !isZeroishProgress(anchor.percentage, anchor.location)
              ? anchor.percentage
              : visibleCenterPercentage(loc, totalLocationsRef.current) ??
                resumePercentageRef.current;
          if (typeof percentage === "number" && percentage > 0.002) {
            resumePercentageRef.current = percentage;
            setChromeSeedPercent(Math.round(percentage * 1000) / 10);
          }
          if (anchor?.snippet) resumeSnippetRef.current = anchor.snippet;
          if (anchor?.href) resumeHrefRef.current = anchor.href;
          if (anchor?.tocHref) resumeHrefRef.current = anchor.tocHref;
          if (anchor && isUsableAnchor(anchor)) applyLiveAnchor(anchor);

          if (cfi) {
            setResumeLocator(cfi);
            resumeLocatorRef.current = cfi;
          }

          // Font/size/line: keep WebView alive — remount was losing focus by many pages.
          const built = buildReaderTheme(theme.colors, next, scheme);
          changeTheme(built);
          try {
            changeFontSize(`${next.fontSizePx}px`);
          } catch {
            /* optional API */
          }
          try {
            changeFontFamily(FONT_FAMILY_CSS[next.fontFamily]);
          } catch {
            /* optional API */
          }
          runFocusRestore();
        })();
      }, 200);
    },
    [
      applyLiveAnchor,
      captureLiveAnchorRich,
      changeFontFamily,
      changeFontSize,
      changeTheme,
      getCurrentLocation,
      height,
      insets.bottom,
      insets.top,
      runFocusRestore,
      scheme,
      theme.colors,
    ],
  );

  const bookProgressRatio = useMemo(() => {
    const locFallback =
      typeof currentLocation?.start?.location === "number" &&
      currentLocation.start.location > 0
        ? currentLocation.start.location
        : null;
    return progressRatioFromAnchor(
      liveAnchor,
      typeof totalLocations === "number" ? totalLocations : null,
      locFallback,
      chromeSeedPercent,
    );
  }, [chromeSeedPercent, currentLocation?.start?.location, liveAnchor, totalLocations]);

  // Prefer drag preview; freeze on override until release settles (avoids thumb jump / ghost).
  const scrubRatio = scrubOverride != null ? scrubOverride : bookProgressRatio;

  const persistLocation = useCallback(async () => {
    try {
      const anchor = liveAnchorRef.current;
      const loc = getCurrentLocation();
      let cfi = anchor?.cfi ?? loc?.start?.cfi ?? resumeLocatorRef.current;
      if (!cfi) return;
      const total = typeof totalLocations === "number" ? totalLocations : 0;
      let ratio = progressRatioFromAnchor(
        anchor,
        total > 0 ? total : null,
        typeof loc?.start?.location === "number" && loc.start.location > 0
          ? loc.start.location
          : null,
        chromeSeedPercent,
      );
      // Never persist a flash-of-start over a known mid-book position.
      const resume = resumePercentageRef.current;
      if (ratio < 0.01 && typeof resume === "number" && resume > 0.05 && !anchor?.atEnd) {
        ratio = resume;
        cfi = resumeLocatorRef.current ?? cfi;
      }
      const percent = total > 0 ? Math.round(ratio * 1000) / 10 : undefined;
      if (typeof percent === "number" && percent <= 1 && typeof resume === "number" && resume > 0.05) {
        return;
      }
      const href =
        anchor?.tocHref ?? anchor?.href ?? resumeHrefRef.current ?? loc?.start?.href ?? null;
      const chapterLabel = tocLabelForHref(href, chapterToc) ?? undefined;
      await saveReadingProgress(userId, bookLocale, {
        locator: cfi,
        percent,
        chapterLabel,
        snippet: anchor?.snippet ?? resumeSnippetRef.current ?? undefined,
        href: href ?? undefined,
      });
    } catch {
      /* best effort */
    }
  }, [bookLocale, chapterToc, chromeSeedPercent, getCurrentLocation, totalLocations, userId]);

  const onLocationChange = useCallback(
    (
      _total: number,
      loc: {
        atEnd?: boolean;
        start?: { cfi?: string; href?: string; location?: number; percentage?: number };
        end?: { percentage?: number };
      },
      progress: number,
      _currentSection: { label?: string; href?: string } | null,
    ) => {
      const sp = loc?.start?.percentage;
      const ep = loc?.end?.percentage;
      let percentage: number | null = null;
      if (typeof sp === "number" && typeof ep === "number") percentage = (sp + ep) / 2;
      else if (typeof sp === "number") percentage = sp;
      else if (typeof progress === "number" && Number.isFinite(progress)) {
        // Library sends 0–100 floored percent in the WebView bridge.
        percentage = progress > 1 ? progress / 100 : progress;
      }
      const atEnd = !!loc?.atEnd || (typeof percentage === "number" && percentage >= 0.995);
      const nextHref = loc?.start?.href ?? null;
      const prevHref = liveAnchorRef.current?.href ?? null;
      const prevFile = (prevHref ?? "").split("#")[0]?.replace(/^.*\//, "").toLowerCase() ?? "";
      const nextFile = (nextHref ?? "").split("#")[0]?.replace(/^.*\//, "").toLowerCase() ?? "";
      const sameSpine = !!(prevFile && nextFile && prevFile === nextFile);
      applyLiveAnchor({
        cfi: loc?.start?.cfi ?? null,
        href: nextHref,
        // Keep chapter fragment only inside the same xhtml; clear across spine jumps (search/TOC).
        tocHref: sameSpine ? liveAnchorRef.current?.tocHref ?? null : null,
        tocSource: sameSpine ? liveAnchorRef.current?.tocSource ?? null : null,
        location: typeof loc?.start?.location === "number" ? loc.start.location : null,
        percentage,
        atEnd,
        snippet: sameSpine ? liveAnchorRef.current?.snippet ?? null : null,
      });
      // Always refresh chapter after relocate (incl. search). Do not gate on restoringRef —
      // a stuck restoring flag was freezing the footer after jumps.
      scheduleSyncAnchor(
        atEnd || scrollModeRef.current === "scrolled" || !sameSpine ? 80 : 260,
      );
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void persistLocation();
      }, 600);
    },
    [applyLiveAnchor, persistLocation, scheduleSyncAnchor],
  );

  const toggleChrome = useCallback(() => {
    if (sheetOpenRef.current) return;
    const now = Date.now();
    if (now - lastChromeToggleAt.current < 280) return;
    lastChromeToggleAt.current = now;
    setChromeVisible((v) => !v);
  }, []);

  const handleTapZone = useCallback(
    (zone: "left" | "center" | "right") => {
      if (sheetOpenRef.current) return;
      if (scrollModeRef.current === "scrolled") {
        toggleChrome();
        return;
      }
      if (zone === "center") {
        toggleChrome();
        return;
      }
      setChromeVisible(false);
      if (zone === "left") goPreviousRef.current();
      else goNextRef.current();
      scheduleSyncAnchor(220);
    },
    [scheduleSyncAnchor, toggleChrome],
  );
  const handleTapZoneRef = useRef(handleTapZone);
  handleTapZoneRef.current = handleTapZone;

  const goToTocHref = useCallback(
    (href: string, label?: string) => {
      forceAcceptNavRef.current = true;
      restoringRef.current = false;
      // Seed footer immediately (parts are not leaf TOC — capture used to miss them).
      if (label && isChapterFooterLabel(label)) {
        setStickyChapterLabel(label.trim());
      } else {
        setStickyChapterLabel(null);
      }
      resumeHrefRef.current = href;
      // WebView sits under absolute chrome — park heading below top bar + ~3 lines.
      const anchorOffsetPx = insets.top + TOP_CHROME_BODY + 56;
      injectJavascript(buildTocNavigateScript(href, { anchorOffsetPx }));
      setTocOpen(false);
      setChromeVisible(true);
      // After display settles, capture heading fragment for shared xhtml chapters.
      scheduleSyncAnchor(350);
      scheduleSyncAnchor(800);
    },
    [injectJavascript, insets.top, scheduleSyncAnchor],
  );

  const hrefForChrome =
    liveAnchor?.tocHref ??
    liveAnchor?.href ??
    resumeHrefRef.current ??
    currentLocation?.start?.href ??
    null;
  // Footer: chapters + parts (flat TOC). Fallback book title only when unknown.
  const sectionLabel = (
    tocLabelForHref(hrefForChrome, flatToc) ??
    stickyChapterLabel ??
    ""
  ).trim();
  const atFrontMatter =
    !!hrefForChrome && /cover|titlepage|title_page/i.test(hrefForChrome);
  const chapterLabel = atFrontMatter
    ? t("book.reader.cover")
    : sectionLabel || t("book.profile.title");
  const pageTotal = typeof totalLocations === "number" && totalLocations > 0 ? totalLocations : null;
  const locFallback =
    typeof currentLocation?.start?.location === "number" &&
    currentLocation.start.location > 0
      ? currentLocation.start.location
      : null;
  const pageIndex = pageIndexFromAnchor(
    liveAnchor,
    pageTotal,
    locFallback,
    chromeSeedPercent,
  );
  // Live counter while scrubbing: 10 → 11 → 12 as the thumb moves.
  const displayPageIndex =
    pageTotal != null && scrubOverride != null
      ? Math.min(pageTotal, Math.max(1, Math.round(scrubOverride * (pageTotal - 1)) + 1))
      : pageIndex;

  const pageLabel =
    displayPageIndex != null && pageTotal != null
      ? t("book.reader.pageOf")
          .replace("{current}", String(displayPageIndex))
          .replace("{total}", String(pageTotal))
      : `${Math.round(scrubRatio * 100)}%`;

  // Fixed size — chrome overlays; never resize WebView when panels toggle.
  const readerH = Math.max(220, height - insets.top - insets.bottom);
  const isPaginated = prefs.scrollMode === "paginated";
  // Same RN inset mechanism; scrolled gets a touch more air (continuous feels tighter).
  const rnSideInset =
    prefs.scrollMode === "scrolled" ? prefs.marginPx + 6 : prefs.marginPx;
  const readerW = Math.max(160, width - rnSideInset * 2);
  const pageBg = scheme === "dark" ? "#121212" : "#ffffff";
  // Same gray for top + bottom; a bit lighter than the previous bottom bar.
  const chromePanelBg = scheme === "dark" ? "#3A3A3E" : "#F3F3F7";
  const fillWidth = trackWidth > 0 ? Math.max(0, trackWidth * scrubRatio - 8) : 0;
  const thumbLeft = trackWidth > 0 ? trackWidth * scrubRatio : 0;

  const ratioFromPageX = useCallback((pageX: number) => {
    const w = Math.max(1, trackWidthRef.current);
    return Math.min(1, Math.max(0, (pageX - trackOriginXRef.current) / w));
  }, []);

  const scrubToRatio = useCallback(
    (ratio: number) => {
      const clamped = Math.min(1, Math.max(0, ratio));
      // Prefer WebView locations (RN `locations` state is often empty/stale).
      injectJavascript(`
        (function () {
          var pct = ${clamped};
          try {
            if (!book || !rendition) return;
            var cfi = null;
            if (book.locations && typeof book.locations.cfiFromPercentage === "function") {
              cfi = book.locations.cfiFromPercentage(pct);
            }
            if (!cfi && book.locations && book.locations.length) {
              var i = Math.round(pct * Math.max(0, book.locations.length - 1));
              cfi = book.locations[i];
            }
            if (cfi) {
              rendition.display(cfi);
              return;
            }
          } catch (e) {}
        })();
        true;
      `);
      // Secondary path if inject is a no-op on some builds.
      const list = locations as string[] | undefined;
      if (list?.length) {
        const idx = Math.min(list.length - 1, Math.max(0, Math.round(clamped * (list.length - 1))));
        const cfi = list[idx];
        if (cfi) goToLocation(cfi);
      }
    },
    [goToLocation, injectJavascript, locations],
  );
  const scrubToRatioRef = useRef(scrubToRatio);
  scrubToRatioRef.current = scrubToRatio;

  const finishScrub = useCallback(() => {
    const r = scrubOverrideRef.current;
    scrubbingRef.current = false;
    if (r != null) scrubToRatioRef.current(r);
    if (scrubClearTimer.current) clearTimeout(scrubClearTimer.current);
    // Keep preview until location catches up — avoids snap-back + double thumb.
    scrubClearTimer.current = setTimeout(() => {
      scrubOverrideRef.current = null;
      setScrubOverride(null);
    }, 450);
    scheduleSyncAnchor(280);
  }, [scheduleSyncAnchor]);
  const finishScrubRef = useRef(finishScrub);
  finishScrubRef.current = finishScrub;
  const scheduleSyncAnchorRef = useRef(scheduleSyncAnchor);
  scheduleSyncAnchorRef.current = scheduleSyncAnchor;
  const ratioFromPageXRef = useRef(ratioFromPageX);
  ratioFromPageXRef.current = ratioFromPageX;

  const scrubPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (evt) => {
        scrubbingRef.current = true;
        if (scrubClearTimer.current) clearTimeout(scrubClearTimer.current);
        const pageX = evt.nativeEvent.pageX;
        scrubTrackRef.current?.measureInWindow((x, _y, w) => {
          trackOriginXRef.current = x;
          if (w > 0) {
            trackWidthRef.current = w;
            setTrackWidth(w);
          }
          const r = ratioFromPageXRef.current(pageX);
          scrubOverrideRef.current = r;
          setScrubOverride(r);
        });
        const r = ratioFromPageXRef.current(pageX);
        scrubOverrideRef.current = r;
        setScrubOverride(r);
      },
      onPanResponderMove: (evt) => {
        const r = ratioFromPageXRef.current(evt.nativeEvent.pageX);
        scrubOverrideRef.current = r;
        setScrubOverride(r);
      },
      onPanResponderRelease: () => {
        finishScrubRef.current();
      },
      onPanResponderTerminate: () => {
        finishScrubRef.current();
      },
    }),
  ).current;

  // Paginated: own taps + horizontal swipes (library Exclusive gestures steal WebView clicks).
  const pagePan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !sheetOpenRef.current,
      onMoveShouldSetPanResponder: (_, g) =>
        !sheetOpenRef.current && (Math.abs(g.dx) > 8 || Math.abs(g.dy) > 8),
      onPanResponderTerminationRequest: () => false,
      onPanResponderRelease: (evt, g) => {
        if (sheetOpenRef.current) return;
        const adx = Math.abs(g.dx);
        const ady = Math.abs(g.dy);
        if (adx > 48 && adx > ady) {
          setChromeVisible(false);
          if (g.dx < 0) goNextRef.current();
          else goPreviousRef.current();
          scheduleSyncAnchorRef.current(220);
          return;
        }
        if (adx < 14 && ady < 14) {
          const x = evt.nativeEvent.locationX;
          const w = Math.max(1, widthRef.current);
          const ratio = x / w;
          if (ratio < 0.28) handleTapZoneRef.current("left");
          else if (ratio > 0.72) handleTapZoneRef.current("right");
          else handleTapZoneRef.current("center");
        }
      },
    }),
  ).current;

  const closeReader = useCallback(() => {
    void persistLocation();
    router.back();
  }, [persistLocation]);

  return (
    <View style={[styles.root, { backgroundColor: pageBg }]}>
      <View
        style={[
          styles.readerWrap,
          {
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
            paddingHorizontal: rnSideInset,
            alignItems: "center",
          },
        ]}
      >
        <View style={{ width: readerW, height: readerH, overflow: "hidden" }}>
        <Reader
          key={`hz-book-${readerEpoch}-${prefs.scrollMode}`}
          src={src}
          width={readerW}
          height={readerH}
          fileSystem={useBookFileSystem}
          defaultTheme={readerTheme}
          initialLocation={
            skipInitialCfi
              ? flowResumeHref ?? undefined
              : resumeLocator ?? initialLocator ?? undefined
          }
          flow={prefs.scrollMode === "scrolled" ? "scrolled-continuous" : "paginated"}
          manager={prefs.scrollMode === "scrolled" ? "continuous" : "default"}
          snap={prefs.scrollMode === "paginated"}
          waitForLocationsReady
          keepScrollOffsetOnLocationChange={prefs.scrollMode === "scrolled"}
          enableSwipe={false}
          onLocationChange={onLocationChange}
          onLocationsReady={() => {
            // Lock continuous stage to the inset WebView size (avoids edge-to-edge text).
            injectJavascript(`
              (function () {
                try {
                  if (!rendition) return true;
                  var w = ${readerW};
                  var h = ${readerH};
                  try {
                    var viewer = document.getElementById("viewer");
                    if (viewer) {
                      viewer.style.width = "100%";
                      viewer.style.maxWidth = "100%";
                      viewer.style.overflow = "hidden";
                    }
                    document.documentElement.style.width = "100%";
                    document.body.style.width = "100%";
                    document.body.style.margin = "0";
                    document.body.style.paddingLeft = "0";
                    document.body.style.paddingRight = "0";
                  } catch (e0) {}
                  if (typeof rendition.resize === "function") rendition.resize(w, h);
                  var rules = {
                    body: {
                      "padding-left": "0 !important",
                      "padding-right": "0 !important",
                      "margin-left": "0 !important",
                      "margin-right": "0 !important",
                      width: "100%",
                      "max-width": "100%",
                      "box-sizing": "border-box"
                    },
                    html: { width: "100%", "max-width": "100%" }
                  };
                  if (rendition.themes && typeof rendition.themes.default === "function") {
                    rendition.themes.default(rules);
                  }
                  var list = rendition.getContents && rendition.getContents();
                  if (list && list.length) {
                    for (var i = 0; i < list.length; i++) {
                      try {
                        if (list[i] && typeof list[i].addStylesheetRules === "function") {
                          list[i].addStylesheetRules(rules);
                        }
                        if (list[i] && list[i].document && list[i].document.documentElement) {
                          list[i].document.documentElement.style.width = "100%";
                          list[i].document.documentElement.style.maxWidth = "100%";
                        }
                      } catch (e1) {}
                    }
                  }
                } catch (e) {}
                return true;
              })();
              true;
            `);
            // Scrolled-continuous: cover iframe collapses without an explicit px stage.
            if (prefs.scrollMode === "scrolled") {
              injectJavascript(buildEnsureCoverStageScript(readerH, readerW));
            }
            scheduleSyncAnchor(200);
          }}
          renderOpeningBookComponent={() => (
            <View style={[styles.openingOverlay, { width: readerW, height: readerH, backgroundColor: pageBg }]}>
              <ActivityIndicator size="large" color={theme.colors.accent} />
              <AppText variant="screenHint" tone="muted" style={{ marginTop: 12 }}>
                {t("book.reader.opening")}
              </AppText>
            </View>
          )}
          onWebViewMessage={(msg) => {
            // Library passes already-parsed JSON (not { nativeEvent }).
            const data = msg as { type?: string; zone?: string };
            if (data?.type === "hzRestoreDone") {
              restoringRef.current = false;
              preferPercentageRestoreRef.current = false;
              setSkipInitialCfi(false);
              setFlowResumeHref(null);
              scheduleSyncAnchor(120);
              return;
            }
            const anchor = parseLiveAnchorMessage(msg);
            if (anchor) {
              applyLiveAnchor(anchor);
              if (pendingAnchorResolverRef.current) {
                const resolve = pendingAnchorResolverRef.current;
                pendingAnchorResolverRef.current = null;
                resolve(anchor);
              }
              return;
            }
            if (data?.type === "tapZone") {
              const zone = data.zone;
              if (zone === "left" || zone === "center" || zone === "right") {
                handleTapZone(zone);
              }
            }
          }}
          onReady={() => {
            injectJavascript(TAP_ZONE_BRIDGE_JS);
            // defaultTheme already matches prefs — do not re-apply (resets position).
            try {
              changeFontSize(`${prefsRef.current.fontSizePx}px`);
            } catch {
              /* optional */
            }
            if (prefsRef.current.scrollMode === "scrolled") {
              injectJavascript(buildEnsureCoverStageScript(readerH, readerW));
            }
            if (
              resumeLocatorRef.current ||
              resumePercentageRef.current != null ||
              resumeSnippetRef.current ||
              resumeHrefRef.current
            ) {
              runFocusRestore();
            } else {
              restoringRef.current = false;
              scheduleSyncAnchor(400);
            }
          }}
        />
        {isPaginated ? (
          <View style={styles.pageGestureLayer} {...pagePan.panHandlers} />
        ) : null}
        </View>
      </View>

      {chromeVisible ? (
        <>
          <View
            style={[
              styles.topChrome,
              {
                paddingTop: insets.top + 6,
                height: insets.top + 6 + TOP_CHROME_BODY,
                backgroundColor: chromePanelBg,
              },
            ]}
          >
            <Pressable
              onPress={closeReader}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={t("book.reader.close")}
              style={styles.topIconBtn}
            >
              <Ionicons name="close" size={22} color={theme.colors.textPrimary} />
            </Pressable>
            <View style={styles.topActions}>
              <Pressable
                onPress={() => {
                  setSearchOpen(true);
                  setChromeVisible(false);
                }}
                style={styles.topIconBtn}
                accessibilityLabel={t("book.reader.search")}
              >
                <Ionicons name="search" size={20} color={theme.colors.textPrimary} />
              </Pressable>
              <Pressable
                onPress={() => setAaOpen(true)}
                style={styles.topIconBtn}
                accessibilityLabel={t("book.reader.appearance")}
              >
                <Ionicons name="settings-outline" size={20} color={theme.colors.textPrimary} />
              </Pressable>
              <Pressable
                onPress={() => {
                  tocScrollPendingRef.current = true;
                  setTocOpen(true);
                }}
                style={styles.topIconBtn}
                accessibilityLabel={t("book.reader.toc")}
              >
                <Ionicons name="list" size={22} color={theme.colors.textPrimary} />
              </Pressable>
            </View>
          </View>

          <View
            style={[
              styles.bottomChrome,
              {
                paddingBottom: insets.bottom + 8,
                minHeight: insets.bottom + 8 + BOTTOM_CHROME_BODY,
                backgroundColor: chromePanelBg,
              },
            ]}
          >
            <View style={styles.bottomMeta}>
              <AppText variant="dialogBody" numberOfLines={1} style={styles.chapterLine}>
                {chapterLabel}
              </AppText>
              <AppText variant="technicalCaption" tone="muted">
                {pageLabel}
              </AppText>
            </View>
            <View
              ref={scrubTrackRef}
              style={styles.scrubHit}
              onLayout={() => {
                scrubTrackRef.current?.measureInWindow((x, _y, w) => {
                  trackOriginXRef.current = x;
                  if (w > 0) {
                    trackWidthRef.current = w;
                    setTrackWidth(w);
                  }
                });
              }}
              {...scrubPan.panHandlers}
            >
              <View style={[styles.scrubTrack, { backgroundColor: scheme === "dark" ? "#555" : "#C8C8D0" }]}>
                <View
                  style={[
                    styles.scrubFill,
                    {
                      width: Math.max(0, fillWidth),
                      backgroundColor: theme.colors.accent,
                    },
                  ]}
                />
              </View>
              <View
                pointerEvents="none"
                style={[
                  styles.scrubThumb,
                  {
                    left: thumbLeft,
                    backgroundColor: theme.colors.accent,
                    borderColor: chromePanelBg,
                  },
                ]}
              />
            </View>
          </View>
        </>
      ) : null}

      <Modal visible={tocOpen} animationType="slide" transparent onRequestClose={() => setTocOpen(false)}>
        <View style={[styles.sheetBackdrop, { backgroundColor: theme.colors.modalBackdrop }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setTocOpen(false)} />
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: theme.colors.surfaceElevated,
                borderColor: theme.colors.surfaceBorder,
                paddingBottom: insets.bottom + 16,
              },
            ]}
          >
            <View style={styles.sheetHeader}>
              <AppText variant="sectionTitle">{t("book.reader.toc")}</AppText>
              <Pressable onPress={() => setTocOpen(false)} hitSlop={10} style={styles.iconBtn}>
                <Ionicons name="close" size={22} color={theme.colors.textPrimary} />
              </Pressable>
            </View>
            <ScrollView
              ref={tocListRef}
              style={styles.tocList}
              onLayout={(e) => {
                const h = e.nativeEvent.layout.height;
                if (h > 0) tocListHeightRef.current = h;
              }}
            >
              {flatToc.map((item) => {
                const activeLabel = (sectionLabel || stickyChapterLabel || "").trim();
                const activeHref = (liveAnchor?.tocHref ?? hrefForChrome ?? "").trim();
                const sameLabel =
                  !!activeLabel &&
                  item.label.trim() === activeLabel &&
                  isChapterFooterLabel(item.label);
                const sameHref =
                  !!activeHref &&
                  (item.href === activeHref ||
                    (activeHref.includes("#") &&
                      item.href.includes("#") &&
                      item.href.split("#")[1] === activeHref.split("#")[1] &&
                      (item.href.split("#")[0] ?? "")
                        .replace(/^.*\//, "")
                        .toLowerCase() ===
                        (activeHref.split("#")[0] ?? "")
                          .replace(/^.*\//, "")
                          .toLowerCase()));
                const isActive = sameLabel || sameHref;
                return (
                  <Pressable
                    key={`${item.href}-${item.label}`}
                    onPress={() => goToTocHref(item.href, item.label)}
                    onLayout={(e) => {
                      if (!isActive || !tocScrollPendingRef.current) return;
                      tocScrollPendingRef.current = false;
                      const rowY = e.nativeEvent.layout.y;
                      const rowH = e.nativeEvent.layout.height || 48;
                      const listH = tocListHeightRef.current || 360;
                      const target = Math.max(0, rowY - listH / 2 + rowH / 2);
                      requestAnimationFrame(() => {
                        tocListRef.current?.scrollTo({ y: target, animated: false });
                      });
                    }}
                    style={[
                      styles.tocRow,
                      {
                        borderBottomColor: theme.colors.surfaceBorder,
                        paddingLeft: 8 + item.depth * 14,
                        backgroundColor: isActive
                          ? scheme === "dark"
                            ? "rgba(255, 255, 255, 0.10)"
                            : "rgba(15, 23, 42, 0.08)"
                          : "transparent",
                      },
                    ]}
                  >
                    <AppText variant="dialogBody">{item.label}</AppText>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={aaOpen} animationType="slide" transparent onRequestClose={() => setAaOpen(false)}>
        <View style={[styles.sheetBackdrop, { backgroundColor: theme.colors.modalBackdrop }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setAaOpen(false)} />
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: theme.colors.surfaceElevated,
                borderColor: theme.colors.surfaceBorder,
                paddingBottom: insets.bottom + 16,
              },
            ]}
          >
            <View style={styles.sheetHeader}>
              <AppText variant="sectionTitle">{t("book.reader.appearance")}</AppText>
              <Pressable onPress={() => setAaOpen(false)} hitSlop={10} style={styles.iconBtn}>
                <Ionicons name="close" size={22} color={theme.colors.textPrimary} />
              </Pressable>
            </View>

            <AppText variant="screenHint" tone="muted">
              {t("book.reader.fontFamily")}
            </AppText>
            <View style={styles.row}>
              {(
                [
                  ["serif", t("book.reader.fontSerif")],
                  ["sans", t("book.reader.fontSans")],
                ] as [ReaderFontFamily, string][]
              ).map(([key, label]) => (
                <Pressable
                  key={key}
                  onPress={() => updatePrefs({ fontFamily: key })}
                  style={[
                    styles.chip,
                    {
                      borderColor:
                        prefs.fontFamily === key ? theme.colors.accent : theme.colors.surfaceBorder,
                      backgroundColor:
                        prefs.fontFamily === key ? theme.colors.surface : "transparent",
                    },
                  ]}
                >
                  <AppText variant="dialogBody">{label}</AppText>
                </Pressable>
              ))}
            </View>

            <StepperRow
              label={t("book.reader.fontSize")}
              valueLabel={String(prefs.fontSizePx)}
              onMinus={() =>
                updatePrefs({ fontSizePx: Math.max(FONT_SIZE_MIN, prefs.fontSizePx - FONT_SIZE_STEP) })
              }
              onPlus={() =>
                updatePrefs({ fontSizePx: Math.min(FONT_SIZE_MAX, prefs.fontSizePx + FONT_SIZE_STEP) })
              }
              minusDisabled={prefs.fontSizePx <= FONT_SIZE_MIN}
              plusDisabled={prefs.fontSizePx >= FONT_SIZE_MAX}
            />
            <StepperRow
              label={t("book.reader.lineHeight")}
              valueLabel={prefs.lineHeight.toFixed(1)}
              onMinus={() =>
                updatePrefs({
                  lineHeight: Math.max(LINE_HEIGHT_MIN, Number((prefs.lineHeight - LINE_HEIGHT_STEP).toFixed(1))),
                })
              }
              onPlus={() =>
                updatePrefs({
                  lineHeight: Math.min(LINE_HEIGHT_MAX, Number((prefs.lineHeight + LINE_HEIGHT_STEP).toFixed(1))),
                })
              }
              minusDisabled={prefs.lineHeight <= LINE_HEIGHT_MIN}
              plusDisabled={prefs.lineHeight >= LINE_HEIGHT_MAX}
            />
            <StepperRow
              label={t("book.reader.margins")}
              valueLabel={String(prefs.marginPx)}
              onMinus={() => updatePrefs({ marginPx: Math.max(MARGIN_MIN, prefs.marginPx - MARGIN_STEP) })}
              onPlus={() => updatePrefs({ marginPx: Math.min(MARGIN_MAX, prefs.marginPx + MARGIN_STEP) })}
              minusDisabled={prefs.marginPx <= MARGIN_MIN}
              plusDisabled={prefs.marginPx >= MARGIN_MAX}
            />

            <View style={styles.switchRow}>
              <AppText variant="dialogBody">{t("book.reader.verticalScroll")}</AppText>
              <Switch
                value={prefs.scrollMode === "scrolled"}
                onValueChange={(on) => updatePrefs({ scrollMode: on ? "scrolled" : "paginated" })}
                trackColor={{ true: theme.colors.accent }}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* In-tree overlay (not RN Modal) — avoids iOS “◀ Камера” nav artifact. */}
      {searchOpen ? (
        <KeyboardAvoidingView
          style={[styles.searchScreen, { backgroundColor: pageBg, paddingTop: insets.top }]}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={0}
        >
          <View style={styles.searchTopRow}>
            <View
              style={[
                styles.searchFieldWrap,
                {
                  borderColor: theme.colors.surfaceBorder,
                  backgroundColor: scheme === "dark" ? "#1E1E22" : "#F2F2F7",
                },
              ]}
            >
              <Ionicons name="search" size={18} color={theme.colors.textFaint} />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder={t("book.reader.searchPlaceholder")}
                placeholderTextColor={theme.colors.textFaint}
                style={[styles.searchFieldInput, { color: theme.colors.textPrimary }]}
                autoFocus
                returnKeyType="search"
                clearButtonMode="while-editing"
                onSubmitEditing={() => {
                  const q = searchQuery.trim();
                  if (q) search(q);
                }}
              />
            </View>
            <Pressable
              onPress={() => {
                clearSearchResults();
                setSearchOpen(false);
              }}
              hitSlop={8}
              style={styles.searchCancelBtn}
            >
              <AppText variant="dialogBody" style={{ color: theme.colors.accent }}>
                {t("common.cancel")}
              </AppText>
            </Pressable>
          </View>
          <ScrollView
            style={styles.searchResults}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          >
            {isSearching ? (
              <ActivityIndicator color={theme.colors.accent} style={{ marginVertical: 16 }} />
            ) : null}
            {(searchResults?.results ?? []).map((hit) => (
              <Pressable
                key={`${hit.cfi}-${hit.excerpt}`}
                onPress={() => {
                  if (hit.cfi) {
                    forceAcceptNavRef.current = true;
                    restoringRef.current = false;
                    setStickyChapterLabel(null);
                    setChromeSeedPercent(null);
                    resumePercentageRef.current = null;
                    liveAnchorRef.current = liveAnchorRef.current
                      ? { ...liveAnchorRef.current, tocHref: null, tocSource: null }
                      : null;
                    goToLocation(hit.cfi);
                    scheduleSyncAnchor(350);
                    scheduleSyncAnchor(900);
                  }
                  clearSearchResults();
                  setSearchOpen(false);
                  setChromeVisible(true);
                }}
                style={[styles.tocRow, { borderBottomColor: theme.colors.surfaceBorder }]}
              >
                <AppText variant="dialogBody" numberOfLines={3}>
                  {hit.excerpt}
                </AppText>
              </Pressable>
            ))}
          </ScrollView>
        </KeyboardAvoidingView>
      ) : null}
    </View>
  );
}

export function BookReaderScreen() {
  const { profile } = useAuth();
  const { locale } = useAppLocale();
  const { t } = useTranslate();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const bookLocale = bookLocaleForAppLocale(locale);
  const [src, setSrc] = useState<string | null>(null);
  const [initialLocator, setInitialLocator] = useState<string | null>(null);
  const [initialPercent, setInitialPercent] = useState<number | null>(null);
  const [initialChapterLabel, setInitialChapterLabel] = useState<string | null>(null);
  const [initialSnippet, setInitialSnippet] = useState<string | null>(null);
  const [initialHref, setInitialHref] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const userId = profile?.id ?? "anon";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // bookAssets is only pulled via lazy BookReaderScreen chunk (not Profile).
        const mod = bookAssetModule(bookLocale);
        if (mod == null) {
          setError(t("book.reader.missingLocale"));
          return;
        }
        const uri = await resolveBookSrc(mod, bookLocale);
        const progress = profile?.id ? await loadReadingProgress(profile.id, bookLocale) : null;
        if (cancelled) return;
        setInitialLocator(progress?.locator ?? null);
        setInitialPercent(normalizeSeedPercent(progress?.percent));
        setInitialChapterLabel(progress?.chapterLabel?.trim() || null);
        setInitialSnippet(progress?.snippet?.trim() || null);
        setInitialHref(progress?.href?.trim() || null);
        setSrc(uri);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : t("book.reader.openError"));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookLocale, profile?.id, t]);

  if (error) {
    return (
      <View
        style={[
          styles.centered,
          { backgroundColor: "#ffffff", paddingTop: insets.top, paddingBottom: insets.bottom },
        ]}
      >
        <AppText variant="dialogBody" style={{ textAlign: "center" }}>
          {error}
        </AppText>
        <AppButton
          label={t("book.reader.close")}
          variant="secondary"
          onPress={() => router.back()}
          style={{ marginTop: 16, maxWidth: 240 }}
        />
      </View>
    );
  }

  if (!src) {
    return (
      <View
        style={[
          styles.centered,
          { backgroundColor: "#ffffff", paddingTop: insets.top, paddingBottom: insets.bottom },
        ]}
      >
        <ActivityIndicator color={theme.colors.accent} />
        <AppText variant="screenHint" tone="muted" style={{ marginTop: 12 }}>
          {t("book.reader.loading")}
        </AppText>
      </View>
    );
  }

  return (
    <ReaderProvider>
      <ReaderChrome
        src={src}
        initialLocator={initialLocator}
        initialPercent={initialPercent}
        initialChapterLabel={initialChapterLabel}
        initialSnippet={initialSnippet}
        initialHref={initialHref}
        bookLocale={bookLocale}
        userId={userId}
      />
    </ReaderProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  readerWrap: { flex: 1 },
  pageGestureLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
  },
  topChrome: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 5,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingBottom: 6,
  },
  bottomChrome: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 5,
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 10,
    justifyContent: "flex-start",
  },
  topActions: { flexDirection: "row", alignItems: "center", gap: 4 },
  topIconBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  searchScreen: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
  },
  iconBtn: { padding: 8 },
  bottomMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  chapterLine: { flex: 1, minWidth: 0 },
  scrubHit: {
    height: 36,
    justifyContent: "center",
  },
  scrubTrack: {
    height: 3,
    borderRadius: 1.5,
    justifyContent: "center",
  },
  scrubFill: { height: "100%", borderRadius: 1.5 },
  scrubThumb: {
    position: "absolute",
    top: 10,
    width: 16,
    height: 16,
    borderRadius: 8,
    marginLeft: -8,
    borderWidth: 2,
    zIndex: 2,
  },
  searchTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 8,
  },
  searchFieldWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    minHeight: 44,
  },
  searchFieldInput: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 10,
  },
  searchCancelBtn: { paddingVertical: 8, paddingHorizontal: 4 },
  searchResults: { flex: 1, paddingHorizontal: 14 },
  openingOverlay: {
    alignItems: "center",
    justifyContent: "center",
  },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  sheetBackdrop: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    maxHeight: "78%",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 18,
    gap: 12,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  tocList: { maxHeight: 420 },
  tocRow: { paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  stepperRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 4,
  },
  stepperLabel: { flex: 1 },
  stepperControls: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  stepValue: { minWidth: 36, textAlign: "center" },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
  },
});
