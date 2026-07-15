/**
 * Строка ввода места рождения с автодополнением (Open-Meteo через
 * /api/geo/search). Выпадающий список показывает «Город, область, страна»
 * на локали приложения. Используется в онбординге и в NatalBirthDataModal
 * (вместо ранее захардкоженной Москвы).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";

import { useAppLocale, useTranslate } from "@/modules/i18n";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

import { formatGeoPlaceLabel, searchBirthPlaces, type GeoPlace } from "../geoSearchClient";

const SEARCH_DEBOUNCE_MS = 350;

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

  return (
    <View style={styles.root}>
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
        <AppText variant="technicalCaption" tone="muted">
          …
        </AppText>
      ) : null}
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
        </View>
      ) : null}
      {showEmpty && !searching ? (
        <AppText variant="technicalCaption" tone="muted">
          {t("onboarding.birth.placeSearchEmpty")}
        </AppText>
      ) : null}
      {errorText ? (
        <AppText variant="technicalCaption" style={{ color: theme.colors.danger }}>
          {errorText}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 16,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  suggestions: {
    borderWidth: 1,
    borderRadius: 16,
    overflow: "hidden",
  },
  suggestionRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
});
