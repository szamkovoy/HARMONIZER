/**
 * Модалка-подтверждение места рождения на карте.
 *
 * Открывается кнопкой «Проверить на карте» после того, как пользователь выбрал
 * населённый пункт в `BirthPlacePicker`. Карта интерактивная (зум, пан), метка фиксирована —
 * координату менять нельзя; цель — лишь убедиться, что выбрано нужное место.
 *
 * Нативные Apple Maps (iOS) / Google Maps (Android) через `react-native-maps`.
 */
import { Modal, Pressable, StyleSheet, View } from "react-native";
import MapView, { Marker } from "react-native-maps";

import { formatGeoPlaceLabel, type GeoPlace } from "../geoSearchClient";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";
import { useTranslate } from "@/modules/i18n";

export function BirthPlaceMapModal({
  place,
  onClose,
}: {
  place: GeoPlace | null;
  onClose: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslate();
  if (!place) return null;

  const region = {
    latitude: place.lat,
    longitude: place.lng,
    latitudeDelta: 0.15,
    longitudeDelta: 0.15,
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={[styles.backdrop, { backgroundColor: theme.colors.modalBackdrop }]}>
        <Pressable style={styles.backdropClose} onPress={onClose} accessibilityLabel={t("common.close")} />
        <View style={[styles.sheet, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.surfaceBorder }]}>
          <View style={styles.header}>
            <AppText variant="sectionTitle" style={styles.title} numberOfLines={2}>
              {formatGeoPlaceLabel(place)}
            </AppText>
          </View>
          <View style={styles.mapWrap}>
            <MapView
              style={styles.map}
              initialRegion={region}
              zoomEnabled
              scrollEnabled
              rotateEnabled={false}
              showsUserLocation={false}
              toolbarEnabled={false}
            >
              <Marker coordinate={{ latitude: place.lat, longitude: place.lng }} draggable={false} />
            </MapView>
          </View>
          <AppButton label={t("wizard.placeMap.close")} onPress={onClose} style={styles.closeBtn} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  backdropClose: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  sheet: {
    width: "100%",
    maxWidth: 460,
    height: "78%",
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    gap: 12,
    overflow: "hidden",
  },
  header: {
    alignItems: "center",
    paddingHorizontal: 4,
  },
  title: {
    textAlign: "center",
  },
  mapWrap: {
    flex: 1,
    borderRadius: 16,
    overflow: "hidden",
  },
  map: {
    width: "100%",
    height: "100%",
  },
  closeBtn: {
    marginTop: 4,
  },
});
