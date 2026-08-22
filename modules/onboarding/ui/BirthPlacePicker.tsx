/**
 * Строка ввода места рождения с автодополнением (Open-Meteo через
 * /api/geo/search).
 *
 * Список — оверлей НАД полем без RN Modal:
 *   • Modal на Android снимает фокус с TextInput → клавиатура пропадает;
 *   • absolute внутри ScrollView на Android клипается.
 * В мастере панель публикуется в WizardOverlayHost (вне ScrollView).
 * Host rect — из контекста (onLayout); якорь поля — measureInWindow.
 * Низ списка привязан к верху поля (`bottom`).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";

import { useAppLocale, useTranslate } from "@/modules/i18n";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";
import { logRuntimeEvent } from "@/services/runtimeDiagnostics";

import { formatGeoPlaceLabel, searchBirthPlaces, type GeoPlace } from "../geoSearchClient";
import { useWizardOverlayHost, type HostRect } from "../wizard/wizardOverlay";

const SEARCH_DEBOUNCE_MS = 350;
const INPUT_HEIGHT = 52;
const SUGGESTIONS_MAX_HEIGHT = 220;
const SUGGESTIONS_GAP = 4;

type Anchor = { x: number; y: number; width: number; height: number };

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = "name" in err ? String((err as { name?: unknown }).name) : "";
  const message = err instanceof Error ? err.message : String(err);
  return name === "AbortError" || /aborted|AbortError/i.test(message);
}

function SuggestionsPanel({
  anchor,
  host,
  places,
  onPick,
  onDismiss,
}: {
  anchor: Anchor;
  host: HostRect;
  places: GeoPlace[];
  onPick: (place: GeoPlace) => void;
  onDismiss: () => void;
}) {
  const theme = useTheme();
  const inputTopInHost = anchor.y - host.y;
  const overlayMaxHeight = Math.min(SUGGESTIONS_MAX_HEIGHT, Math.max(96, inputTopInHost - 16));
  // Низ панели к верху поля: при укорочении списка сжимается сверху.
  const bottom = host.height - inputTopInHost + SUGGESTIONS_GAP;
  const left = Math.max(0, anchor.x - host.x);

  return (
    <View style={styles.overlayRoot} pointerEvents="box-none" focusable={false}>
      {/* focusable=false: на Android новый Pressable иначе крадёт фокус у TextInput → IME. */}
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onDismiss}
        focusable={false}
        accessible={false}
      />
      <View
        focusable={false}
        style={[
          styles.suggestions,
          {
            bottom,
            left,
            width: anchor.width,
            maxHeight: overlayMaxHeight,
            backgroundColor: theme.colors.surfaceElevated,
            borderColor: theme.colors.surfaceBorder,
          },
        ]}
      >
        <ScrollView
          keyboardShouldPersistTaps="always"
          nestedScrollEnabled
          style={{ maxHeight: overlayMaxHeight }}
        >
          {places.map((place) => (
            <Pressable
              key={place.id}
              accessibilityRole="button"
              onPress={() => onPick(place)}
              focusable={false}
              style={({ pressed }) => [
                styles.suggestionRow,
                {
                  opacity: pressed ? 0.6 : 1,
                  borderBottomColor: theme.colors.surfaceBorder,
                },
              ]}
            >
              <AppText variant="screenHint">{formatGeoPlaceLabel(place)}</AppText>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

export function BirthPlacePicker({
  value,
  onSelect,
  disabled,
}: {
  value: GeoPlace | null;
  onSelect: (place: GeoPlace | null) => void;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const { t } = useTranslate();
  const { locale } = useAppLocale();
  const overlayApi = useWizardOverlayHost();
  const [query, setQuery] = useState(value ? formatGeoPlaceLabel(value) : "");
  const [suggestions, setSuggestions] = useState<GeoPlace[]>([]);
  const [searching, setSearching] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [showEmpty, setShowEmpty] = useState(false);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const inputWrapRef = useRef<View>(null);
  const inputRef = useRef<TextInput>(null);

  const scrollInputToStart = useCallback(() => {
    requestAnimationFrame(() => {
      inputRef.current?.setNativeProps({ selection: { start: 0, end: 0 } });
    });
  }, []);

  const hostRect = overlayApi?.hostRect ?? null;

  const measureAnchor = useCallback(() => {
    const node = inputWrapRef.current;
    if (!node) return;
    requestAnimationFrame(() => {
      node.measureInWindow((x, y, width, height) => {
        if (width <= 0 || height <= 0) return;
        setAnchor((prev) => {
          if (
            prev &&
            prev.x === x &&
            prev.y === y &&
            prev.width === width &&
            prev.height === height
          ) {
            return prev;
          }
          return { x, y, width, height };
        });
      });
    });
  }, []);

  useEffect(() => {
    if (!value) return;
    setQuery(formatGeoPlaceLabel(value));
    scrollInputToStart();
  }, [value, scrollInputToStart]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (suggestions.length === 0) return;
    measureAnchor();
    const subShow = Keyboard.addListener("keyboardDidShow", measureAnchor);
    const subHide = Keyboard.addListener("keyboardDidHide", measureAnchor);
    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, [suggestions.length, measureAnchor]);

  const dismissSuggestions = useCallback(() => {
    setSuggestions([]);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const onPickSuggestion = useCallback(
    (place: GeoPlace) => {
      requestSeqRef.current += 1;
      abortRef.current?.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setSuggestions([]);
      setShowEmpty(false);
      setSearching(false);
      setErrorText(null);
      setQuery(formatGeoPlaceLabel(place));
      onSelect(place);
    },
    [onSelect],
  );

  useLayoutEffect(() => {
    if (!overlayApi) return;
    if (suggestions.length === 0) {
      overlayApi.setOverlay(null);
      return;
    }
    // Ждём якорь и hostRect — не сбрасываем оверлей в null (гонка на Android).
    if (!anchor || !hostRect) return;

    overlayApi.setOverlay(
      <SuggestionsPanel
        anchor={anchor}
        host={hostRect}
        places={suggestions}
        onPick={onPickSuggestion}
        onDismiss={dismissSuggestions}
      />,
    );
    return () => overlayApi.setOverlay(null);
  }, [overlayApi, suggestions, anchor, hostRect, onPickSuggestion, dismissSuggestions]);

  const runSearch = useCallback(
    (text: string) => {
      const seq = ++requestSeqRef.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setSearching(true);
      setErrorText(null);
      measureAnchor();

      searchBirthPlaces(text, locale, controller.signal)
        .then((places) => {
          if (seq !== requestSeqRef.current) return;
          setSuggestions(places);
          setShowEmpty(places.length === 0);
          if (places.length > 0) {
            measureAnchor();
            requestAnimationFrame(() => inputRef.current?.focus());
          }
        })
        .catch((err: unknown) => {
          if (seq !== requestSeqRef.current) return;
          if (isAbortError(err)) return;
          setSuggestions([]);
          setShowEmpty(false);
          setErrorText(t("onboarding.birth.placeSearchError"));
          logRuntimeEvent(
            "geo_search:failed",
            {
              locale,
              qLen: text.trim().length,
              message: err instanceof Error ? err.message : String(err),
            },
            "warn",
          );
        })
        .finally(() => {
          if (seq === requestSeqRef.current) setSearching(false);
        });
    },
    [locale, t, measureAnchor],
  );

  const onChangeText = useCallback(
    (text: string) => {
      setQuery(text);
      onSelect(null);
      setShowEmpty(false);
      setErrorText(null);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (text.trim().length < 2) {
        requestSeqRef.current += 1;
        abortRef.current?.abort();
        setSuggestions([]);
        setSearching(false);
        return;
      }
      debounceRef.current = setTimeout(() => runSearch(text), SEARCH_DEBOUNCE_MS);
    },
    [onSelect, runSearch],
  );

  const statusBelow =
    (showEmpty && !searching) || errorText
      ? errorText
        ? errorText
        : t("onboarding.birth.placeSearchEmpty")
      : null;

  // Fallback вне мастера: список над полем в потоке (без Modal).
  const showLocalFallback = !overlayApi && suggestions.length > 0;

  return (
    <View style={styles.root}>
      {showLocalFallback ? (
        <View
          style={[
            styles.localSuggestions,
            {
              backgroundColor: theme.colors.surfaceElevated,
              borderColor: theme.colors.surfaceBorder,
            },
          ]}
        >
          <ScrollView
            keyboardShouldPersistTaps="always"
            nestedScrollEnabled
            style={{ maxHeight: SUGGESTIONS_MAX_HEIGHT }}
          >
            {suggestions.map((place) => (
              <Pressable
                key={place.id}
                accessibilityRole="button"
                onPress={() => onPickSuggestion(place)}
                style={({ pressed }) => [
                  styles.suggestionRow,
                  {
                    opacity: pressed ? 0.6 : 1,
                    borderBottomColor: theme.colors.surfaceBorder,
                  },
                ]}
              >
                <AppText variant="screenHint">{formatGeoPlaceLabel(place)}</AppText>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      <View ref={inputWrapRef} style={styles.inputWrap} collapsable={false}>
        <TextInput
          ref={inputRef}
          value={query}
          onChangeText={onChangeText}
          onFocus={() => {
            measureAnchor();
            if (query.length > 0) scrollInputToStart();
          }}
          placeholder={t("onboarding.birth.placePlaceholder")}
          placeholderTextColor={theme.colors.textFaint}
          autoCapitalize="words"
          autoCorrect={false}
          editable={!disabled}
          showSoftInputOnFocus
          style={[
            styles.input,
            {
              borderColor: value ? theme.colors.accent : theme.colors.surfaceBorder,
              color: theme.colors.textPrimary,
            },
          ]}
        />
        {searching ? (
          <View style={styles.searchingBadge} pointerEvents="none">
            <AppText variant="technicalCaption" tone="muted">
              …
            </AppText>
          </View>
        ) : null}
      </View>

      {statusBelow ? (
        <AppText
          variant="technicalCaption"
          tone={errorText ? undefined : "muted"}
          style={errorText ? { color: theme.colors.danger } : undefined}
        >
          {statusBelow}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: 6,
    zIndex: 20,
    elevation: 20,
  },
  inputWrap: {
    position: "relative",
    minHeight: INPUT_HEIGHT,
  },
  input: {
    height: INPUT_HEIGHT,
    borderWidth: 1,
    borderRadius: 16,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingRight: 28,
    textAlign: "left",
  },
  searchingBadge: {
    position: "absolute",
    right: 12,
    top: 0,
    height: INPUT_HEIGHT,
    justifyContent: "center",
  },
  overlayRoot: {
    ...StyleSheet.absoluteFillObject,
  },
  suggestions: {
    position: "absolute",
    borderWidth: 1,
    borderRadius: 16,
    overflow: "hidden",
    elevation: 24,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -2 },
  },
  localSuggestions: {
    borderWidth: 1,
    borderRadius: 16,
    overflow: "hidden",
    maxHeight: SUGGESTIONS_MAX_HEIGHT,
    elevation: 8,
  },
  suggestionRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
});
