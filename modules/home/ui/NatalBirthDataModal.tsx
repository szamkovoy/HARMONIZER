/**
 * Модалка редактирования натальных данных: дата, местное время и место
 * рождения с автодополнением города (BirthPlacePicker, Open-Meteo).
 * Захардкоженная Москва из M1 удалена: место обязательно выбирается из списка
 * (для существующего профиля предзаполняется из users.birth_place).
 */
import { useCallback, useEffect, useState } from "react";
import { Modal, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { BirthData } from "@/modules/astro-core";
import { useTranslate } from "@/modules/i18n";
import { BirthPlacePicker, formatGeoPlaceLabel, type GeoPlace } from "@/modules/onboarding";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { ScreenHeader } from "@/modules/ui/ScreenHeader";
import { SurfaceCardView } from "@/modules/ui/SurfaceCardView";
import { useTheme } from "@/modules/ui/theme";

/** users.birth_place (jsonb) → GeoPlace для предзаполнения пикера. */
function geoPlaceFromProfileBirthPlace(raw: unknown): GeoPlace | null {
  if (!raw || typeof raw !== "object") return null;
  const place = raw as { name?: unknown; lat?: unknown; lon?: unknown; timezone?: unknown };
  if (typeof place.lat !== "number" || typeof place.lon !== "number") return null;
  return {
    id: `profile-${place.lat}-${place.lon}`,
    name: typeof place.name === "string" && place.name.trim() ? place.name : `${place.lat}, ${place.lon}`,
    region: null,
    country: null,
    lat: place.lat,
    lng: place.lon,
    timezone: typeof place.timezone === "string" && place.timezone.trim() ? place.timezone : "UTC",
  };
}

export function NatalBirthDataModal({
  visible,
  saving,
  initialDate,
  initialTime,
  initialPlace,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  saving: boolean;
  initialDate?: string | null;
  initialTime?: string | null;
  /** users.birth_place (jsonb) — предзаполнение места. */
  initialPlace?: unknown;
  onClose: () => void;
  onSubmit: (birthData: BirthData, placeName: string) => Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const { t } = useTranslate();
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [place, setPlace] = useState<GeoPlace | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setDate((initialDate ?? "").trim());
    setTime((initialTime ?? "").trim());
    setPlace(geoPlaceFromProfileBirthPlace(initialPlace));
    setErrorText(null);
  }, [visible, initialDate, initialTime, initialPlace]);

  const submit = useCallback(() => {
    const normalizedDate = date.trim();
    const normalizedTime = time.trim();
    setErrorText(null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) {
      setErrorText(t("onboarding.birth.dateInvalid"));
      return;
    }
    if (!/^\d{2}:\d{2}$/.test(normalizedTime)) {
      setErrorText(t("onboarding.birth.timeInvalid"));
      return;
    }
    if (!place) {
      setErrorText(t("onboarding.birth.placeMissing"));
      return;
    }

    void onSubmit(
      {
        date: normalizedDate,
        time: normalizedTime,
        timeMode: "precise",
        location: {
          lat: place.lat,
          lng: place.lng,
          timezone: place.timezone,
        },
      },
      formatGeoPlaceLabel(place),
    );
  }, [date, onSubmit, place, t, time]);

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={onClose}>
      <View style={[styles.modalBackdrop, { backgroundColor: theme.colors.modalBackdrop }]}>
        <SurfaceCardView
          tone="elevated"
          style={[
            styles.modalCard,
            {
              paddingBottom: insets.bottom + 18,
            },
          ]}
        >
          <ScreenHeader
            title={t("onboarding.birth.title")}
            subtitle={t("onboarding.birth.subtitle")}
          />
          <AppText variant="technicalCaption" tone="muted">
            {t("onboarding.birth.dateLabel")}
          </AppText>
          <TextInput
            value={date}
            onChangeText={setDate}
            placeholder="1985-04-23"
            placeholderTextColor={theme.colors.textFaint}
            autoCapitalize="none"
            keyboardType="numbers-and-punctuation"
            editable={!saving}
            style={[
              styles.input,
              {
                borderColor: theme.colors.surfaceBorder,
                color: theme.colors.textPrimary,
              },
            ]}
          />
          <AppText variant="technicalCaption" tone="muted">
            {t("onboarding.birth.timeLabel")}
          </AppText>
          <TextInput
            value={time}
            onChangeText={setTime}
            placeholder="06:45"
            placeholderTextColor={theme.colors.textFaint}
            autoCapitalize="none"
            keyboardType="numbers-and-punctuation"
            editable={!saving}
            style={[
              styles.input,
              {
                borderColor: theme.colors.surfaceBorder,
                color: theme.colors.textPrimary,
              },
            ]}
          />
          <AppText variant="technicalCaption" tone="muted">
            {t("onboarding.birth.placeLabel")}
          </AppText>
          <BirthPlacePicker value={place} onSelect={setPlace} disabled={saving} />
          {errorText ? (
            <AppText variant="technicalCaption" style={{ color: theme.colors.danger }}>
              {errorText}
            </AppText>
          ) : null}
          <View style={styles.modalActions}>
            <AppButton label={t("gate.close")} variant="secondary" onPress={onClose} disabled={saving} />
            <AppButton
              label={saving ? t("onboarding.birth.saving") : t("onboarding.birth.save")}
              onPress={submit}
              disabled={saving}
            />
          </View>
        </SurfaceCardView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
  },
  modalCard: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    gap: 10,
  },
  input: {
    borderWidth: 1,
    borderRadius: 16,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  modalActions: {
    flexDirection: "row",
    gap: 10,
    justifyContent: "flex-end",
    paddingTop: 6,
  },
});
