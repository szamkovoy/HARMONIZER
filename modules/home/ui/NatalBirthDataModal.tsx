/**
 * Модалка редактирования натальных данных: дата, местное время и место
 * рождения с автодополнением города (BirthPlacePicker, Open-Meteo).
 *
 * Дата/время — сегментный `MaskedTextInput` (DD | MM | YYYY и HH | MM):
 * каждый сегмент — отдельный TextInput, слоты фиксированной длины
 * (пустые = пробел), поэтому правка дня не сдвигает месяц/год.
 *
 * Layout: без KeyboardAvoidingView (он + justifyContent:center оставлял
 * большой зазор над клавиатурой и сжимал карточку). Вместо этого —
 * `Keyboard` listeners: paddingBottom = высота клавиатуры + 8px, карточка
 * прижимается к низу (`flex-end`) и почти касается клавиатуры. Без клавиатуры
 * — по центру. Карточка по контенту; кнопки вне ScrollView.
 *
 * В БД дата — «YYYY-MM-DD», время — «HH:MM» (секунды отбрасываем).
 */
import { useCallback, useEffect, useState } from "react";
import {
  Keyboard,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";

import type { BirthData } from "@/modules/astro-core";
import { useTranslate } from "@/modules/i18n";
import { BirthPlacePicker, formatGeoPlaceLabel, type GeoPlace } from "@/modules/onboarding";
import {
  ddmmyyyyToIso,
  isoToDdmmyyyy,
} from "@/modules/onboarding/birthDateFormat";
import { MaskedTextInput, maskDigitsOnly } from "@/modules/onboarding/MaskedTextInput";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { ScreenHeader } from "@/modules/ui/ScreenHeader";
import { SurfaceCardView } from "@/modules/ui/SurfaceCardView";
import { useTheme } from "@/modules/ui/theme";

/** users.birth_place (jsonb) → GeoPlace для предзаполнения пикера и карты. */
export function geoPlaceFromProfileBirthPlace(raw: unknown): GeoPlace | null {
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

const DATE_MASK = "DD-MM-YYYY";
const TIME_MASK = "HH:MM";

function ddmmyyyyToDigits(value: string): string {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value ?? "");
  return m ? `${m[1]}${m[2]}${m[3]}` : "";
}
function timeToDigits(value: string): string {
  const hhmm = (value ?? "").trim().slice(0, 5);
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  return m ? `${m[1]}${m[2]}` : "";
}
function digitsToDdmmyyyy(slots: string): string {
  const d = maskDigitsOnly(slots).slice(0, 8);
  if (d.length !== 8) return "";
  return `${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4, 8)}`;
}
function digitsToHhmm(slots: string): string {
  const d = maskDigitsOnly(slots).slice(0, 4);
  if (d.length !== 4) return "";
  return `${d.slice(0, 2)}:${d.slice(2, 4)}`;
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
  initialPlace?: unknown;
  onClose: () => void;
  onSubmit: (birthData: BirthData, placeName: string) => Promise<void>;
}) {
  const theme = useTheme();
  const { t } = useTranslate();
  // Padded-слоты (пробел = пусто); длина 8 / 4.
  const [dateSlots, setDateSlots] = useState("");
  const [timeSlots, setTimeSlots] = useState("");
  const [place, setPlace] = useState<GeoPlace | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  /** Высота клавиатуры — вручную поднимаем карточку почти вплотную к ней. */
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (!visible) return;
    setDateSlots(ddmmyyyyToDigits(isoToDdmmyyyy(initialDate)));
    setTimeSlots(timeToDigits(initialTime ?? ""));
    setPlace(geoPlaceFromProfileBirthPlace(initialPlace));
    setErrorText(null);
  }, [visible, initialDate, initialTime, initialPlace]);

  useEffect(() => {
    if (!visible) {
      setKeyboardHeight(0);
      return;
    }
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const onShow = Keyboard.addListener(showEvt, (e) => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const onHide = Keyboard.addListener(hideEvt, () => {
      setKeyboardHeight(0);
    });
    return () => {
      onShow.remove();
      onHide.remove();
    };
  }, [visible]);

  const submit = useCallback(() => {
    setErrorText(null);
    const formattedDate = digitsToDdmmyyyy(dateSlots);
    const isoDate = ddmmyyyyToIso(formattedDate);
    if (!isoDate) {
      setErrorText(t("onboarding.birth.dateInvalid"));
      return;
    }
    const formattedTime = digitsToHhmm(timeSlots);
    if (!/^\d{2}:\d{2}$/.test(formattedTime)) {
      setErrorText(t("onboarding.birth.timeInvalid"));
      return;
    }
    if (!place) {
      setErrorText(t("onboarding.birth.placeMissing"));
      return;
    }

    const initDateDigits = ddmmyyyyToDigits(isoToDdmmyyyy(initialDate));
    const initTimeDigits = timeToDigits(initialTime ?? "");
    const initPlace = geoPlaceFromProfileBirthPlace(initialPlace);
    const placeUnchanged =
      initPlace != null &&
      place.lat === initPlace.lat &&
      place.lng === initPlace.lng &&
      place.timezone === initPlace.timezone;
    if (
      maskDigitsOnly(dateSlots) === initDateDigits &&
      maskDigitsOnly(timeSlots) === initTimeDigits &&
      placeUnchanged
    ) {
      onClose();
      return;
    }

    void onSubmit(
      {
        date: isoDate,
        time: formattedTime,
        timeMode: "precise",
        location: {
          lat: place.lat,
          lng: place.lng,
          timezone: place.timezone,
        },
      },
      formatGeoPlaceLabel(place),
    );
  }, [dateSlots, initialDate, initialPlace, initialTime, onClose, onSubmit, place, t, timeSlots]);

  const keyboardOpen = keyboardHeight > 0;

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <View
        style={[
          styles.backdrop,
          {
            backgroundColor: theme.colors.modalBackdrop,
            // Почти вплотную к клавиатуре (8px), без «пустого колодца» под карточкой.
            paddingBottom: keyboardOpen ? keyboardHeight + 8 : 24,
            justifyContent: keyboardOpen ? "flex-end" : "center",
          },
        ]}
      >
        <SurfaceCardView tone="elevated" style={styles.card}>
          <ScreenHeader
            title={t("onboarding.birth.title")}
            subtitle={t("onboarding.birth.subtitle")}
          />
          <ScrollView
            style={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            bounces={false}
            contentContainerStyle={styles.fields}
          >
            <AppText variant="technicalCaption" tone="muted">
              {t("onboarding.birth.dateLabel")}
            </AppText>
            <MaskedTextInput
              mask={DATE_MASK}
              value={dateSlots}
              onDigitsChange={setDateSlots}
              placeholderTextColor={theme.colors.textFaint}
              keyboardType="number-pad"
              editable={!saving}
              style={[styles.input, { borderColor: theme.colors.surfaceBorder }]}
              segmentStyle={{ color: theme.colors.textPrimary, fontSize: 16 }}
              separatorStyle={{ color: theme.colors.textFaint }}
            />
            <AppText variant="technicalCaption" tone="muted">
              {t("onboarding.birth.timeLabel")}
            </AppText>
            <MaskedTextInput
              mask={TIME_MASK}
              value={timeSlots}
              onDigitsChange={setTimeSlots}
              placeholderTextColor={theme.colors.textFaint}
              keyboardType="number-pad"
              editable={!saving}
              style={[styles.input, { borderColor: theme.colors.surfaceBorder }]}
              segmentStyle={{ color: theme.colors.textPrimary, fontSize: 16 }}
              separatorStyle={{ color: theme.colors.textFaint }}
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
          </ScrollView>
          <View style={styles.actions}>
            <AppButton
              label={t("gate.close")}
              variant="secondary"
              onPress={onClose}
              disabled={saving}
              style={styles.actionBtn}
            />
            <AppButton
              label={saving ? t("onboarding.birth.saving") : t("onboarding.birth.save")}
              onPress={submit}
              disabled={saving}
              style={styles.actionBtn}
            />
          </View>
        </SurfaceCardView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  // По контенту; maxHeight 100% доступной области над клавиатурой (после paddingBottom).
  card: {
    width: "100%",
    maxWidth: 420,
    maxHeight: "100%",
    borderRadius: 20,
    overflow: "visible",
  },
  scroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  fields: {
    gap: 10,
    paddingBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 10,
    // Selection-handles iOS рисуются чуть снаружи текста — не клипать.
    overflow: "visible",
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    paddingTop: 8,
  },
  actionBtn: {
    flex: 1,
  },
});
