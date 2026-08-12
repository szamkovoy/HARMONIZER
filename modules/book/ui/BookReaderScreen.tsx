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
import { flattenToc } from "../core/flattenToc";
import { bookLocaleForAppLocale, type BookLocale } from "../core/bookIds";
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
  bookLocale,
  userId,
}: {
  src: string;
  initialLocator: string | null;
  bookLocale: BookLocale;
  userId: string;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { scheme } = useThemePreference();
  const { t } = useTranslate();
  const {
    changeFontSize,
    changeFontFamily,
    changeTheme,
    goToLocation,
    goNext,
    goPrevious,
    getCurrentLocation,
    injectJavascript,
    toc,
    section,
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
  /** Remount Reader on flow change — changeFlow() hangs on scrolled-doc for this EPUB. */
  const [readerEpoch, setReaderEpoch] = useState(0);
  const [resumeLocator, setResumeLocator] = useState<string | null>(initialLocator);
  const trackWidthRef = useRef(0);
  const trackOriginXRef = useRef(0);
  const scrubTrackRef = useRef<View>(null);
  const scrubbingRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoreTokenRef = useRef(0);
  const lastChromeToggleAt = useRef(0);
  const scrubOverrideRef = useRef<number | null>(null);
  const scrubClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resumeLocatorRef = useRef<string | null>(initialLocator);
  resumeLocatorRef.current = resumeLocator;
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

  const readerTheme = useMemo(
    () => buildReaderTheme(theme.colors, prefs, scheme),
    [theme.colors, prefs, scheme],
  );

  const flatToc = useMemo(() => flattenToc(toc as never), [toc]);

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

  /** Apply appearance; restore mid-page focus after reflow (not cover / random page). */
  const applyPrefsKeepLocation = useCallback(
    (next: ReaderPrefs, opts?: { restore?: boolean }) => {
      const loc = getCurrentLocation();
      const cfi = loc?.start?.cfi ?? null;
      const percentage = visibleCenterPercentage(loc, totalLocations);
      changeFontSize(`${next.fontSizePx}px`);
      changeFontFamily(FONT_FAMILY_CSS[next.fontFamily]);
      changeTheme(buildReaderTheme(theme.colors, next, scheme));
      if (opts?.restore === false) return;
      restoreTokenRef.current += 1;
      injectJavascript(
        buildRestoreLocationScript({
          cfi,
          percentage,
          token: restoreTokenRef.current,
        }),
      );
    },
    [
      changeFontFamily,
      changeFontSize,
      changeTheme,
      getCurrentLocation,
      injectJavascript,
      scheme,
      theme.colors,
      totalLocations,
    ],
  );

  // App light/dark only — do not re-apply flow (that resets to cover).
  useEffect(() => {
    if (!prefsReady) return;
    changeTheme(buildReaderTheme(theme.colors, prefsRef.current, scheme));
  }, [prefsReady, scheme, theme.colors, changeTheme]);

  const updatePrefs = useCallback(
    (patch: Partial<ReaderPrefs>) => {
      setPrefs((prev) => {
        const next = { ...prev, ...patch };
        void saveReaderPrefs(next);
        const flowChanged = patch.scrollMode != null && patch.scrollMode !== prev.scrollMode;
        if (flowChanged) {
          // Remount instead of changeFlow — avoids endless «Opening» on scrolled-doc.
          const cfi = getCurrentLocation()?.start?.cfi ?? resumeLocatorRef.current;
          if (cfi) {
            setResumeLocator(cfi);
            resumeLocatorRef.current = cfi;
          }
          setReaderEpoch((n) => n + 1);
        } else {
          applyPrefsKeepLocation(next, { restore: true });
        }
        return next;
      });
    },
    [applyPrefsKeepLocation, getCurrentLocation],
  );

  const bookProgressRatio = useMemo(() => {
    const locIdx = currentLocation?.start?.location;
    const total = typeof totalLocations === "number" ? totalLocations : 0;
    if (typeof locIdx !== "number" || total < 1) return 0;
    if (total === 1) return 0;
    return Math.min(1, Math.max(0, locIdx / (total - 1)));
  }, [currentLocation?.start?.location, totalLocations]);

  // Prefer drag preview; freeze on override until release settles (avoids thumb jump / ghost).
  const scrubRatio = scrubOverride != null ? scrubOverride : bookProgressRatio;

  const persistLocation = useCallback(async () => {
    try {
      const loc = getCurrentLocation();
      const cfi = loc?.start?.cfi;
      if (!cfi) return;
      const locIdx = loc?.start?.location;
      const total = typeof totalLocations === "number" ? totalLocations : 0;
      const percent =
        typeof locIdx === "number" && total > 1
          ? Math.round((locIdx / (total - 1)) * 1000) / 10
          : typeof locIdx === "number" && total === 1
            ? 0
            : undefined;
      await saveReadingProgress(userId, bookLocale, {
        locator: cfi,
        percent,
        chapterLabel: section?.label,
      });
    } catch {
      /* best effort */
    }
  }, [bookLocale, getCurrentLocation, section?.label, totalLocations, userId]);

  const onLocationChange = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void persistLocation();
    }, 600);
  }, [persistLocation]);

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
    },
    [toggleChrome],
  );
  const handleTapZoneRef = useRef(handleTapZone);
  handleTapZoneRef.current = handleTapZone;

  const goToTocHref = useCallback(
    (href: string) => {
      injectJavascript(buildTocNavigateScript(href));
      setTocOpen(false);
      setChromeVisible(true);
    },
    [injectJavascript],
  );

  const sectionLabel = (section?.label ?? "").trim();
  const atFrontMatter =
    !sectionLabel ||
    /cover|titlepage|title_page/i.test(currentLocation?.start?.href ?? "");
  const chapterLabel = atFrontMatter
    ? t("book.reader.cover")
    : sectionLabel || t("book.profile.title");
  const pageIndex =
    typeof currentLocation?.start?.location === "number" ? currentLocation.start.location + 1 : null;
  const pageTotal = typeof totalLocations === "number" && totalLocations > 0 ? totalLocations : null;
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
  const pageBg = scheme === "dark" ? "#121212" : "#ffffff";
  // Same gray for top + bottom; a bit lighter than the previous bottom bar.
  const chromePanelBg = scheme === "dark" ? "#3A3A3E" : "#F3F3F7";
  const isPaginated = prefs.scrollMode === "paginated";
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
  }, []);
  const finishScrubRef = useRef(finishScrub);
  finishScrubRef.current = finishScrub;
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
          { paddingTop: insets.top, paddingBottom: insets.bottom },
        ]}
      >
        <Reader
          key={`hz-book-${readerEpoch}-${prefs.scrollMode}`}
          src={src}
          width={width}
          height={readerH}
          fileSystem={useBookFileSystem}
          defaultTheme={readerTheme}
          initialLocation={resumeLocator ?? initialLocator ?? undefined}
          flow={prefs.scrollMode === "scrolled" ? "scrolled-doc" : "paginated"}
          manager="default"
          snap={prefs.scrollMode === "paginated"}
          waitForLocationsReady={prefs.scrollMode === "paginated"}
          enableSwipe={false}
          onLocationChange={onLocationChange}
          renderOpeningBookComponent={() => (
            <View style={[styles.openingOverlay, { width, height: readerH, backgroundColor: pageBg }]}>
              <ActivityIndicator size="large" color={theme.colors.accent} />
              <AppText variant="screenHint" tone="muted" style={{ marginTop: 12 }}>
                {t("book.reader.opening")}
              </AppText>
            </View>
          )}
          onWebViewMessage={(msg) => {
            // Library passes already-parsed JSON (not { nativeEvent }).
            const data = msg as { type?: string; zone?: string };
            if (data?.type === "tapZone") {
              const zone = data.zone;
              if (zone === "left" || zone === "center" || zone === "right") {
                handleTapZone(zone);
              }
            }
          }}
          onReady={() => {
            injectJavascript(TAP_ZONE_BRIDGE_JS);
            applyPrefsKeepLocation(prefs, { restore: false });
            const loc = resumeLocatorRef.current ?? initialLocator;
            if (loc) {
              injectJavascript(
                `try { rendition.display(${JSON.stringify(loc)}); } catch (e) {} true;`,
              );
            }
          }}
        />
        {isPaginated ? (
          <View style={styles.pageGestureLayer} {...pagePan.panHandlers} />
        ) : null}
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
                onPress={() => setTocOpen(true)}
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
            <ScrollView style={styles.tocList}>
              {flatToc.map((item) => (
                <Pressable
                  key={`${item.href}-${item.label}`}
                  onPress={() => goToTocHref(item.href)}
                  style={[styles.tocRow, { borderBottomColor: theme.colors.surfaceBorder, paddingLeft: 8 + item.depth * 14 }]}
                >
                  <AppText variant="dialogBody">{item.label}</AppText>
                </Pressable>
              ))}
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
                  if (hit.cfi) goToLocation(hit.cfi);
                  clearSearchResults();
                  setSearchOpen(false);
                  setChromeVisible(false);
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
  const [error, setError] = useState<string | null>(null);
  const userId = profile?.id ?? "anon";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mod = bookAssetModule(bookLocale);
        if (mod == null) {
          setError(t("book.reader.missingLocale"));
          return;
        }
        const uri = await resolveBookSrc(mod, bookLocale);
        const progress = profile?.id ? await loadReadingProgress(profile.id, bookLocale) : null;
        if (cancelled) return;
        setInitialLocator(progress?.locator ?? null);
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
