import { documentDirectory, getInfoAsync, readAsStringAsync, writeAsStringAsync } from "expo-file-system/legacy";
import { useEffect, useMemo, useState } from "react";
import {
  AppState,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useIsFocused } from "@react-navigation/native";

import { BinduSuccessionLabCanvas } from "@/modules/mandala-visual-core/experiments/BinduSuccessionLabCanvas";
import {
  applyColorToPresetSlot,
  BINDU_COLOR_EDITOR_SWATCHES,
  DEFAULT_BINDU_SUCCESSION_VISUAL_PRESETS,
  EDITABLE_COLOR_SLOTS,
  getEditableColorSlotColor,
  normalizeHexColor,
  sanitizeChakraVisualPresets,
  type ChakraVisualPreset,
  type EditableColorSlotId,
} from "@/modules/mandala-visual-core/experiments/binduSuccessionVisualPresets";

const TUBE_FLOW_SPEED = 1;
const VISUAL_PRESETS_FILE_URI = documentDirectory
  ? `${documentDirectory}bindu-succession-lab-visual-presets.json`
  : null;

export function BinduSuccessionLabScreen() {
  const isFocused = useIsFocused();
  const [appState, setAppState] = useState(AppState.currentState);
  const [chakraIndex, setChakraIndex] = useState(6);
  const [chakraPresets, setChakraPresets] = useState<ChakraVisualPreset[]>(DEFAULT_BINDU_SUCCESSION_VISUAL_PRESETS);
  const [showMandala, setShowMandala] = useState(true);
  const [isEditorVisible, setIsEditorVisible] = useState(false);
  const [selectedSlotId, setSelectedSlotId] = useState<EditableColorSlotId>("cloud");
  const [hexInput, setHexInput] = useState(DEFAULT_BINDU_SUCCESSION_VISUAL_PRESETS[6].cloud.color);
  const [isHexEditing, setIsHexEditing] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle");
  const isRenderActive = isFocused && appState === "active";
  const activePreset = useMemo(
    () =>
      chakraPresets[chakraIndex] ??
      DEFAULT_BINDU_SUCCESSION_VISUAL_PRESETS[chakraIndex] ??
      DEFAULT_BINDU_SUCCESSION_VISUAL_PRESETS[6],
    [chakraIndex, chakraPresets],
  );
  const activeSlotColor = getEditableColorSlotColor(activePreset, selectedSlotId);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      setAppState(nextState);
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadPersistedPresets = async () => {
      if (!VISUAL_PRESETS_FILE_URI) {
        return;
      }

      try {
        const info = await getInfoAsync(VISUAL_PRESETS_FILE_URI);
        if (!info.exists) {
          return;
        }

        const raw = await readAsStringAsync(VISUAL_PRESETS_FILE_URI);
        const parsed = JSON.parse(raw);
        if (isMounted) {
          setChakraPresets(sanitizeChakraVisualPresets(parsed));
          setSaveStatus("saved");
        }
      } catch {
        if (isMounted) {
          setSaveStatus("error");
        }
      }
    };

    void loadPersistedPresets();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isHexEditing) {
      setHexInput(activeSlotColor);
    }
  }, [activeSlotColor, isHexEditing]);

  const persistPresets = async (nextPresets: ChakraVisualPreset[]) => {
    if (!VISUAL_PRESETS_FILE_URI) {
      return;
    }

    try {
      await writeAsStringAsync(VISUAL_PRESETS_FILE_URI, JSON.stringify(nextPresets, null, 2));
      setSaveStatus("saved");
    } catch {
      setSaveStatus("error");
    }
  };

  const applySlotColor = (slotId: EditableColorSlotId, nextColor: string) => {
    const normalized = normalizeHexColor(nextColor);
    if (!normalized) {
      return false;
    }

    setSaveStatus("idle");
    setChakraPresets((current) => {
      const next = current.map((preset, index) =>
        index === chakraIndex ? applyColorToPresetSlot(preset, slotId, normalized) : preset,
      );
      void persistPresets(next);
      return next;
    });
    return true;
  };

  const commitHexInput = () => {
    const applied = applySlotColor(selectedSlotId, hexInput);
    if (applied) {
      setHexInput(normalizeHexColor(hexInput) ?? hexInput);
    }
    return applied;
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.screen}>
        <View style={styles.topOverlay}>
          <Pressable onPress={() => setIsEditorVisible(true)} style={styles.editButton}>
            <Text style={styles.editButtonText}>Редактор цветов</Text>
          </Pressable>
        </View>

        <BinduSuccessionLabCanvas
          isActive={isRenderActive}
          sceneOffset={0}
          densityBias={0.84}
          sessionSeed={1}
          flowSpeed={TUBE_FLOW_SPEED}
          debugGeometry={false}
          visualPreset={activePreset}
          showMandala={showMandala}
        />

        <Modal visible={isEditorVisible} animationType="fade" transparent onRequestClose={() => setIsEditorVisible(false)}>
          <View style={styles.modalRoot}>
            <Pressable style={styles.modalBackdrop} onPress={() => setIsEditorVisible(false)} />
            <KeyboardAvoidingView
              behavior={Platform.OS === "ios" ? "padding" : undefined}
              keyboardVerticalOffset={Platform.OS === "ios" ? 24 : 0}
              style={styles.modalKeyboardAvoider}
            >
              <View style={styles.modalCard}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalEyebrow}>Chakra {activePreset.label}</Text>
                  <Text style={styles.modalTitle}>Цвета мандалы</Text>
                  <Text style={styles.modalSubtitle}>
                    Редактируются `cloudColor` и `imageColor` для bindu и всех 6 колец. Изменения применяются сразу.
                  </Text>
                </View>

                <ScrollView
                  contentContainerStyle={styles.modalContent}
                  keyboardShouldPersistTaps="always"
                  keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
                  automaticallyAdjustKeyboardInsets
                >
                  <View style={styles.slotGrid}>
                    {EDITABLE_COLOR_SLOTS.map((slot) => {
                      const isSelected = selectedSlotId === slot.id;
                      const slotColor = getEditableColorSlotColor(activePreset, slot.id);
                      return (
                        <Pressable
                          key={slot.id}
                          onPress={() => setSelectedSlotId(slot.id)}
                          style={[styles.slotButton, isSelected && styles.slotButtonActive]}
                        >
                          <View style={[styles.slotSwatch, { backgroundColor: slotColor }]} />
                          <Text style={[styles.slotLabel, isSelected && styles.slotLabelActive]}>{slot.label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <View style={styles.editorSection}>
                    <Text style={styles.sectionLabel}>Swatches</Text>
                    <View style={styles.swatchGrid}>
                      {BINDU_COLOR_EDITOR_SWATCHES.map((color) => {
                        const isCurrent = normalizeHexColor(color) === normalizeHexColor(activeSlotColor);
                        return (
                          <Pressable
                            key={color}
                            onPress={() => {
                              setHexInput(color);
                              applySlotColor(selectedSlotId, color);
                            }}
                            style={[styles.swatchButton, isCurrent && styles.swatchButtonActive]}
                          >
                            <View style={[styles.swatchFill, { backgroundColor: color }]} />
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>

                  <View style={styles.editorSection}>
                    <Text style={styles.sectionLabel}>Hex</Text>
                    <TextInput
                      autoCapitalize="none"
                      autoCorrect={false}
                      value={hexInput}
                      onFocus={() => setIsHexEditing(true)}
                      onBlur={() => {
                        setIsHexEditing(false);
                      }}
                      onChangeText={(nextText) => {
                        setHexInput(nextText);
                      }}
                      placeholder="#rrggbb"
                      placeholderTextColor="rgba(221, 228, 255, 0.34)"
                      returnKeyType="done"
                      onSubmitEditing={commitHexInput}
                      style={styles.hexInput}
                    />
                    <View style={styles.hexActionRow}>
                      <Pressable
                        onPress={() => {
                          setHexInput(activeSlotColor);
                          setIsHexEditing(false);
                        }}
                        style={[styles.hexActionButton, styles.hexActionButtonSecondary]}
                      >
                        <Text style={styles.hexActionButtonSecondaryText}>Сбросить</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => {
                          setIsHexEditing(false);
                          commitHexInput();
                        }}
                        style={[styles.hexActionButton, styles.hexActionButtonPrimary]}
                      >
                        <Text style={styles.hexActionButtonPrimaryText}>Применить</Text>
                      </Pressable>
                    </View>
                    <Text style={styles.fieldHint}>
                      Можно спокойно редактировать `#RRGGBB`, а затем нажать `Применить`. Текущий цвет слота: {activeSlotColor}
                    </Text>
                    <Text style={styles.fieldHint}>
                      {saveStatus === "error"
                        ? "Локальное сохранение не удалось."
                        : saveStatus === "saved"
                          ? "Сохранено локально на этом устройстве."
                          : "Изменения применяются и сохраняются автоматически."}
                    </Text>
                  </View>

                  <Pressable onPress={() => setIsEditorVisible(false)} style={styles.closeButton}>
                    <Text style={styles.closeButtonText}>Готово</Text>
                  </Pressable>
                </ScrollView>
              </View>
            </KeyboardAvoidingView>
          </View>
        </Modal>

        <View style={styles.bottomOverlay}>
          <Pressable
            onPress={() => setShowMandala((current) => !current)}
            style={[styles.modeButton, showMandala ? styles.modeButtonActive : styles.modeButtonInactive]}
          >
            <Text style={[styles.modeButtonText, showMandala && styles.modeButtonTextActive]}>
              {showMandala ? "Скрыть мандалу" : "Показать мандалу"}
            </Text>
          </Pressable>
          <Text style={styles.overlayTitle}>Облачко</Text>
          <View style={styles.chipRow}>
            {chakraPresets.map((preset, index) => {
              const isSelected = chakraIndex === index;
              return (
                <Pressable
                  key={preset.id}
                  onPress={() => setChakraIndex(index)}
                  style={[styles.chip, isSelected && styles.chipActive]}
                >
                  <Text style={[styles.chipText, isSelected && styles.chipTextActive]}>{preset.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#000000",
  },
  screen: {
    flex: 1,
    backgroundColor: "#000000",
  },
  topOverlay: {
    position: "absolute",
    top: 12,
    right: 16,
    left: 16,
    zIndex: 2,
    alignItems: "flex-end",
  },
  editButton: {
    minHeight: 42,
    paddingHorizontal: 16,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(18, 24, 40, 0.86)",
    borderWidth: 1,
    borderColor: "rgba(125, 143, 255, 0.24)",
  },
  editButtonText: {
    color: "#ebf0ff",
    fontSize: 13,
    fontWeight: "700",
  },
  modalRoot: {
    flex: 1,
    justifyContent: "center",
    padding: 16,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(6, 8, 16, 0.76)",
  },
  modalKeyboardAvoider: {
    flex: 1,
    justifyContent: "center",
  },
  modalCard: {
    maxHeight: "88%",
    borderRadius: 24,
    overflow: "hidden",
    backgroundColor: "#111626",
    borderWidth: 1,
    borderColor: "rgba(160, 176, 255, 0.18)",
  },
  modalHeader: {
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(160, 176, 255, 0.1)",
  },
  modalEyebrow: {
    color: "rgba(226, 232, 255, 0.68)",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  modalTitle: {
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "700",
  },
  modalSubtitle: {
    color: "rgba(228, 232, 255, 0.78)",
    fontSize: 13,
    lineHeight: 18,
  },
  modalContent: {
    padding: 18,
    gap: 18,
  },
  slotGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  slotButton: {
    width: "22%",
    minWidth: 72,
    paddingHorizontal: 10,
    paddingVertical: 12,
    borderRadius: 16,
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(20, 26, 44, 0.86)",
    borderWidth: 1,
    borderColor: "rgba(125, 143, 255, 0.16)",
  },
  slotButtonActive: {
    borderColor: "#c99cff",
    backgroundColor: "rgba(64, 42, 84, 0.94)",
  },
  slotSwatch: {
    width: 26,
    height: 26,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.18)",
  },
  slotLabel: {
    color: "#ebf0ff",
    fontSize: 12,
    fontWeight: "600",
  },
  slotLabelActive: {
    color: "#f5dcff",
  },
  editorSection: {
    gap: 10,
  },
  sectionLabel: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700",
  },
  swatchGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  swatchButton: {
    width: 34,
    height: 34,
    borderRadius: 999,
    padding: 3,
    borderWidth: 1,
    borderColor: "rgba(160, 176, 255, 0.14)",
    backgroundColor: "rgba(22, 28, 48, 0.9)",
  },
  swatchButtonActive: {
    borderColor: "#ffffff",
    backgroundColor: "#ffffff",
  },
  swatchFill: {
    flex: 1,
    borderRadius: 999,
  },
  hexInput: {
    minHeight: 52,
    borderRadius: 14,
    paddingHorizontal: 14,
    color: "#f6f7ff",
    fontSize: 16,
    fontWeight: "600",
    backgroundColor: "rgba(20, 26, 44, 0.92)",
    borderWidth: 1,
    borderColor: "rgba(125, 143, 255, 0.22)",
  },
  hexActionRow: {
    flexDirection: "row",
    gap: 10,
  },
  hexActionButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    borderWidth: 1,
  },
  hexActionButtonPrimary: {
    backgroundColor: "#7a8cff",
    borderColor: "#7a8cff",
  },
  hexActionButtonSecondary: {
    backgroundColor: "rgba(20, 26, 44, 0.92)",
    borderColor: "rgba(125, 143, 255, 0.22)",
  },
  hexActionButtonPrimaryText: {
    color: "#081022",
    fontSize: 14,
    fontWeight: "800",
  },
  hexActionButtonSecondaryText: {
    color: "#ebf0ff",
    fontSize: 14,
    fontWeight: "700",
  },
  fieldHint: {
    color: "rgba(218, 225, 255, 0.62)",
    fontSize: 12,
    lineHeight: 17,
  },
  closeButton: {
    minHeight: 50,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#7a8cff",
  },
  closeButtonText: {
    color: "#081022",
    fontSize: 15,
    fontWeight: "800",
  },
  bottomOverlay: {
    position: "absolute",
    right: 16,
    bottom: 20,
    left: 16,
    gap: 10,
  },
  modeButton: {
    minHeight: 46,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    borderWidth: 1,
  },
  modeButtonInactive: {
    backgroundColor: "rgba(18, 24, 40, 0.86)",
    borderColor: "rgba(125, 143, 255, 0.24)",
  },
  modeButtonActive: {
    backgroundColor: "#7a8cff",
    borderColor: "#7a8cff",
  },
  modeButtonText: {
    color: "#ebf0ff",
    fontSize: 14,
    fontWeight: "700",
  },
  modeButtonTextActive: {
    color: "#081022",
  },
  overlayTitle: {
    color: "rgba(226, 232, 255, 0.74)",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    minWidth: 42,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(18, 24, 40, 0.86)",
    borderWidth: 1,
    borderColor: "rgba(125, 143, 255, 0.24)",
  },
  chipActive: {
    backgroundColor: "#c99cff",
    borderColor: "#c99cff",
  },
  chipText: {
    color: "#ebf0ff",
    fontSize: 13,
    fontWeight: "600",
  },
  chipTextActive: {
    color: "#120f1f",
  },
});
