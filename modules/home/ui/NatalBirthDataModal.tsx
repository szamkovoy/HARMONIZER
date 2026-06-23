import { useCallback, useEffect, useState } from "react";
import { Alert, Modal, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { BirthData } from "@/modules/astro-core";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { ScreenHeader } from "@/modules/ui/ScreenHeader";
import { SurfaceCardView } from "@/modules/ui/SurfaceCardView";
import { useTheme } from "@/modules/ui/theme";

export const NATAL_BRIDGE_DEFAULT_LOCATION: BirthData["location"] = {
  lat: 55.7558,
  lng: 37.6173,
  timezone: "Europe/Moscow",
};

export function NatalBirthDataModal({
  visible,
  saving,
  initialDate,
  initialTime,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  saving: boolean;
  initialDate?: string | null;
  initialTime?: string | null;
  onClose: () => void;
  onSubmit: (birthData: BirthData) => Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");

  useEffect(() => {
    if (!visible) return;
    setDate((initialDate ?? "").trim());
    setTime((initialTime ?? "").trim());
  }, [visible, initialDate, initialTime]);

  const submit = useCallback(() => {
    const normalizedDate = date.trim();
    const normalizedTime = time.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) {
      Alert.alert("Проверьте дату", "Введите дату в формате YYYY-MM-DD.");
      return;
    }
    if (!/^\d{2}:\d{2}$/.test(normalizedTime)) {
      Alert.alert("Проверьте время", "Введите время в формате HH:MM.");
      return;
    }

    void onSubmit({
      date: normalizedDate,
      time: normalizedTime,
      timeMode: "precise",
      location: NATAL_BRIDGE_DEFAULT_LOCATION,
    });
  }, [date, onSubmit, time]);

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
            title="Натальные данные"
            subtitle="Это временный технический ввод для M1. Место рождения пока фиксировано: Москва, Europe/Moscow."
          />
          <TextInput
            value={date}
            onChangeText={setDate}
            placeholder="YYYY-MM-DD"
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
          <TextInput
            value={time}
            onChangeText={setTime}
            placeholder="HH:MM"
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
          <View style={styles.modalActions}>
            <AppButton label="Отмена" variant="secondary" onPress={onClose} disabled={saving} />
            <AppButton label={saving ? "Сохраняю..." : "Сохранить"} onPress={submit} disabled={saving} />
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
    gap: 14,
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
  },
});
