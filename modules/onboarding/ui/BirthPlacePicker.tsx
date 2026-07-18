/**
 * Строка ввода места рождения с автодополнением (Open-Meteo через
 * /api/geo/search).
 *
 * Выпадающий список — абсолютный оверлей НАД полем ввода (не под ним):
 * при открытой клавиатуре над полем обычно есть место (дата/время/заголовок),
 * а вниз список упирался бы в клавиатуру/край экрана. Оверлей не сдвигает
 * кнопку «Далее» в потоке. Список внутри себя скроллится (`nestedScrollEnabled`).
 * Статусы («…», пусто, ошибка) тоже вне потока — чтобы CTA не «уезжала» вниз
 * при начале поиска.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";

import { useAppLocale, useTranslate } from "@/modules/i18n";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

import { formatGeoPlaceLabel, searchBirthPlaces, type GeoPlace } from "../geoSearchClient";

const SEARCH_DEBOUNCE_MS = 350;
const INPUT_HEIGHT = 52;
/** Высота списка над полем — умещается над клавиатурой на типичных экранах. */
const SUGGESTIONS_MAX_HEIGHT = 220;

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
  const [query, setQuery] = useState(value ? formatGeoPlaceLabel(value) : "");
  const [suggestions, setSuggestions] = useState<GeoPlace[]>([]);
  const [searching, setSearching] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [showEmpty, setShowEmpty] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const runSearch = useCallback(
    (text: string) => {
      const seq = ++requestSeqRef.current;
      setSearching(true);
      setErrorText(null);
      searchBirthPlaces(text, locale)
        .then((places) => {
          if (seq !== requestSeqRef.current) return;
          setSuggestions(places);
          setShowEmpty(places.length === 0);
        })
        .catch(() => {
          if (seq !== requestSeqRef.current) return;
          setSuggestions([]);
          setShowEmpty(false);
          setErrorText(t("onboarding.birth.placeSearchError"));
        })
        .finally(() => {
          if (seq === requestSeqRef.current) setSearching(false);
        });
    },
    [locale, t],
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
        setSuggestions([]);
        setSearching(false);
        return;
      }
      debounceRef.current = setTimeout(() => runSearch(text), SEARCH_DEBOUNCE_MS);
    },
    [onSelect, runSearch],
  );

  const onPickSuggestion = useCallback(
    (place: GeoPlace) => {
      requestSeqRef.current += 1;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setSuggestions([]);
      setShowEmpty(false);
      setSearching(false);
      setQuery(formatGeoPlaceLabel(place));
      onSelect(place);
    },
    [onSelect],
  );

  const statusBelow =
    (showEmpty && !searching) || errorText
      ? errorText
        ? errorText
        : t("onboarding.birth.placeSearchEmpty")
      : null;

  return (
    <View style={styles.root}>
      {suggestions.length > 0 ? (
        <View
          style={[
            styles.suggestions,
            {
              backgroundColor: theme.colors.surfaceElevated,
              borderColor: theme.colors.surfaceBorder,
            },
          ]}
        >
          <ScrollView
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            style={styles.suggestionsScroll}
          >
            {suggestions.map((place) => (
              <Pressable
                key={place.id}
                accessibilityRole="button"
                onPress={() => onPickSuggestion(place)}
                style={({ pressed }) => [
                  styles.suggestionRow,
                  { opacity: pressed ? 0.6 : 1, borderBottomColor: theme.colors.surfaceBorder },
                ]}
              >
                <AppText variant="screenHint">{formatGeoPlaceLabel(place)}</AppText>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      <TextInput
        value={query}
        onChangeText={onChangeText}
        placeholder={t("onboarding.birth.placePlaceholder")}
        placeholderTextColor={theme.colors.textFaint}
        autoCapitalize="words"
        autoCorrect={false}
        editable={!disabled}
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

      {statusBelow ? (
        <View style={styles.statusBelow} pointerEvents="none">
          <AppText
            variant="technicalCaption"
            tone={errorText ? undefined : "muted"}
            style={errorText ? { color: theme.colors.danger } : undefined}
          >
            {statusBelow}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: "relative",
    zIndex: 20,
    // Высота = только поле: оверлеи не участвуют в потоке → «Далее» не прыгает.
  },
  input: {
    height: INPUT_HEIGHT,
    borderWidth: 1,
    borderRadius: 16,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingRight: 28,
  },
  searchingBadge: {
    position: "absolute",
    right: 12,
    top: 0,
    height: INPUT_HEIGHT,
    justifyContent: "center",
  },
  statusBelow: {
    position: "absolute",
    top: INPUT_HEIGHT + 6,
    left: 0,
    right: 0,
  },
  suggestions: {
    position: "absolute",
    left: 0,
    right: 0,
    // Над полем — не уходит под клавиатуру / край экрана.
    bottom: INPUT_HEIGHT + 4,
    zIndex: 50,
    borderWidth: 1,
    borderRadius: 16,
    overflow: "hidden",
    maxHeight: SUGGESTIONS_MAX_HEIGHT,
    elevation: 8,
    shadowColor: "#000",
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: -2 },
  },
  suggestionsScroll: {
    maxHeight: SUGGESTIONS_MAX_HEIGHT,
  },
  suggestionRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
});
