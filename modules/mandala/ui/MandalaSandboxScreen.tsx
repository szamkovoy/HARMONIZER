import { useEffect, useMemo, useRef, useState } from "react";
import {
  AppState,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useIsFocused } from "@react-navigation/native";

import {
  DEFAULT_SCENARIO,
} from "@/modules/mandala/core/defaults";
import { getRecipeById } from "@/modules/mandala/core/recipes";
import { sanitizeKeyframe } from "@/modules/mandala/core/preset";
import type {
  BioSignalFrame,
  EvolutionProfile,
  MeditationPresetKeyframe,
  MotionLogic,
  PetalProfile,
} from "@/modules/mandala/core/types";
import { useMandalaSession } from "@/modules/mandala/store/useMandalaSession";

import { MandalaCanvas, type RenderMode } from "./MandalaCanvas";

const LOTUS_RECIPE_ID = "lotusBloom" as const;

function toDisplay(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "";
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

interface SectionProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

function Section({ title, subtitle, children }: SectionProps) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
      {children}
    </View>
  );
}

interface NumberFieldProps {
  fieldId: string;
  label: string;
  value: number;
  helper: string;
  onChange: (nextValue: number) => void;
  onFocusField: (fieldId: string) => void;
  registerInput: (fieldId: string, input: TextInput | null) => void;
}

function NumberField({
  fieldId,
  label,
  value,
  helper,
  onChange,
  onFocusField,
  registerInput,
}: NumberFieldProps) {
  const [text, setText] = useState(() => toDisplay(value));
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setText(toDisplay(value));
    }
  }, [isFocused, value]);

  const commitText = () => {
    const parsed = Number(text.replace(",", "."));
    if (Number.isFinite(parsed)) {
      onChange(parsed);
      setText(toDisplay(parsed));
      return;
    }

    setText(toDisplay(value));
  };

  return (
    <View style={styles.fieldBlock}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        ref={(input) => registerInput(fieldId, input)}
        inputMode="decimal"
        keyboardType={Platform.OS === "ios" ? "numbers-and-punctuation" : "numeric"}
        value={text}
        onFocus={() => {
          setIsFocused(true);
          onFocusField(fieldId);
        }}
        onBlur={() => {
          setIsFocused(false);
          commitText();
        }}
        onChangeText={(nextText) => {
          setText(nextText);
          const normalized = nextText.replace(",", ".");
          if (/^-?\d+(\.\d+)?$/.test(normalized)) {
            onChange(Number(normalized));
          }
        }}
        returnKeyType="done"
        onSubmitEditing={commitText}
        blurOnSubmit
        style={styles.input}
      />
      <Text style={styles.fieldHint}>{helper}</Text>
    </View>
  );
}

interface EnumOption<T extends string | number> {
  label: string;
  value: T;
}

interface EnumFieldProps<T extends string | number> {
  label: string;
  value: T;
  options: EnumOption<T>[];
  onChange: (nextValue: T) => void;
}

function EnumField<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: EnumFieldProps<T>) {
  return (
    <View style={styles.fieldBlock}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.chipRow}>
        {options.map((option) => {
          const isActive = option.value === value;
          return (
            <Pressable
              key={String(option.value)}
              onPress={() => onChange(option.value)}
              style={[styles.chip, isActive && styles.chipActive]}
            >
              <Text style={[styles.chipText, isActive && styles.chipTextActive]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

interface LoadEstimate {
  index: number;
  label: "Низкая" | "Средняя" | "Высокая" | "Пиковая";
}

function estimateVisualLoad(
  sessionState: ReturnType<typeof useMandalaSession>["sessionState"],
  viewport: { width: number; height: number },
): LoadEstimate {
  const megapixels = Math.max(0.4, (viewport.width * viewport.height) / 1_000_000);
  const baseIndex =
    28 +
    sessionState.artDirection.layerCount * 18 +
    sessionState.artDirection.ornamentDensity * 42 +
    sessionState.artDirection.depthStrength * 34 +
    sessionState.artDirection.glowStrength * 28 +
    sessionState.geometry.beamCount * 1.9 +
    sessionState.geometry.ringDensity * 1.1 +
    sessionState.primitives.complexity * 36 +
    sessionState.primitives.strokeWidth * 180 +
    sessionState.complexity.recursionDepth * 24 +
    (sessionState.complexity.fractalDimension - 1) * 70;
  const index = Math.round(baseIndex * (0.82 + megapixels * 0.55));

  if (index >= 300) {
    return { index, label: "Пиковая" };
  }
  if (index >= 220) {
    return { index, label: "Высокая" };
  }
  if (index >= 130) {
    return { index, label: "Средняя" };
  }
  return { index, label: "Низкая" };
}

const motionLogicOptions: EnumOption<MotionLogic>[] = [
  { label: "Full Mandala", value: 0 },
  { label: "Cloud Bloom", value: 1 },
];

const renderModeOptions: EnumOption<RenderMode>[] = [
  { label: "Static", value: "static" },
  { label: "Evolving", value: "evolving" },
];

const petalProfileOptions: EnumOption<PetalProfile>[] = [
  { label: "Teardrop", value: "teardrop" },
  { label: "Almond", value: "almond" },
  { label: "Lotus Spear", value: "lotusSpear" },
  { label: "Rounded Spoon", value: "roundedSpoon" },
  { label: "Flame", value: "flame" },
  { label: "Heart Petal", value: "heartPetal" },
  { label: "Split Petal", value: "splitPetal" },
  { label: "Oval", value: "oval" },
];

const evolutionProfileOptions: EnumOption<EvolutionProfile>[] = [
  { label: "Rebirth", value: "rebirth" },
  { label: "Spiral Drift", value: "spiralDrift" },
  { label: "Tidal Breath", value: "tidalBreath" },
  { label: "Halo Cascade", value: "haloCascade" },
];

export function MandalaSandboxScreen() {
  const isDark = useColorScheme() === "dark";
  const isFocused = useIsFocused();
  const { width, height } = useWindowDimensions();
  const lotusDraft = useMemo(() => getRecipeById(LOTUS_RECIPE_ID).build(), []);
  const normalizedLotusDraft = useMemo<MeditationPresetKeyframe>(
    () => ({
      ...lotusDraft,
      kinetics: {
        ...lotusDraft.kinetics,
        motionLogic: lotusDraft.kinetics.motionLogic === 1 ? 1 : 0,
      },
      artDirection: {
        ...lotusDraft.artDirection,
        revealMode: "pulseGate",
      },
    }),
    [lotusDraft],
  );
  const lotusScenario = useMemo(
    () => ({
      ...DEFAULT_SCENARIO,
      id: "sandbox-lotus-bloom",
      title: "Lotus Bloom Sandbox",
      description: "Сфокусированная отладка одного образа без удаления общего runtime-контракта.",
      keyframes: [normalizedLotusDraft],
    }),
    [normalizedLotusDraft],
  );
  const { sessionState, applyKeyframe } = useMandalaSession(lotusScenario);
  const [draft, setDraft] = useState<MeditationPresetKeyframe>(normalizedLotusDraft);
  const [renderMode, setRenderMode] = useState<RenderMode>("evolving");
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [appState, setAppState] = useState(AppState.currentState);
  const inputRefs = useRef<Record<string, TextInput | null>>({});
  const lastFocusedFieldRef = useRef<string | null>(null);
  const reopenFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isRenderActive = isFocused && appState === "active" && !isModalVisible;
  const bioFrame = useMemo<BioSignalFrame>(
    () => ({
      breathPhase: 0,
      pulsePhase: 0,
      breathRate: 0,
      pulseRate: 0,
      rmssd: 0,
      stressIndex: 0,
      signalQuality: 0,
      // Bio influence is temporarily disabled while we tune the pure visual language of Lotus Bloom.
      source: "offline",
    }),
    [],
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      setAppState(nextState);
    });

    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!isModalVisible) {
      return;
    }

    const fieldId = lastFocusedFieldRef.current;
    if (!fieldId) {
      return;
    }

    reopenFocusTimerRef.current = setTimeout(() => {
      inputRefs.current[fieldId]?.focus();
    }, 280);

    return () => {
      if (reopenFocusTimerRef.current) {
        clearTimeout(reopenFocusTimerRef.current);
      }
    };
  }, [isModalVisible]);

  const visualLoad = useMemo(
    () => estimateVisualLoad(sessionState, { width, height }),
    [height, sessionState, width],
  );

  const registerInput = (fieldId: string, input: TextInput | null) => {
    inputRefs.current[fieldId] = input;
  };

  const rememberFocusedField = (fieldId: string) => {
    lastFocusedFieldRef.current = fieldId;
  };

  const applyDraft = () => {
    const safeDraft = sanitizeKeyframe({
      ...draft,
      artDirection: {
        ...draft.artDirection,
        visualRecipe: LOTUS_RECIPE_ID,
        revealMode: "pulseGate",
      },
      kinetics: {
        ...draft.kinetics,
        motionLogic: draft.kinetics.motionLogic === 1 ? 1 : 0,
      },
    });
    applyKeyframe(safeDraft);
    setDraft(safeDraft);
    Keyboard.dismiss();
    setIsModalVisible(false);
  };

  const loadOptimalLotusProperties = () => {
    const recipeDraft = getRecipeById(LOTUS_RECIPE_ID).build();
    const optimalDraft: MeditationPresetKeyframe = {
      ...recipeDraft,
      kinetics: {
        ...recipeDraft.kinetics,
        motionLogic: recipeDraft.kinetics.motionLogic === 1 ? 1 : 0,
      },
      artDirection: {
        ...recipeDraft.artDirection,
        revealMode: "pulseGate",
      },
    };
    setDraft(optimalDraft);
  };

  return (
    <SafeAreaView style={[styles.safeArea, !isDark && styles.safeAreaLight]}>
      <View style={styles.screen}>
        <View style={styles.previewPane}>
          <MandalaCanvas
            sessionState={sessionState}
            bioFrame={bioFrame}
            isActive={isRenderActive}
            renderMode={renderMode}
          />
          <View style={styles.loadBadge}>
            <Text style={styles.loadBadgeLabel}>Нагрузка</Text>
            <Text style={styles.loadBadgeValue}>
              {visualLoad.label} · индекс {visualLoad.index}
            </Text>
          </View>
          <View style={styles.bottomBar}>
            <Pressable onPress={() => setIsModalVisible(true)} style={styles.primaryButton}>
              <Text style={styles.primaryButtonText}>Изменить</Text>
            </Pressable>
          </View>
        </View>
      </View>

      <Modal
        animationType="slide"
        transparent
        visible={isModalVisible}
        onRequestClose={() => setIsModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <Pressable style={styles.modalBackdrop} onPress={() => setIsModalVisible(false)} />
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={styles.modalKeyboard}
          >
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <View style={styles.modalHeaderCopy}>
                  <Text style={styles.modalTitle}>Lotus Bloom</Text>
                  <Text style={styles.modalSubtitle}>
                    Только релевантные поля для цветущей розетки. Остальные параметры сохранены в полном контракте и пока скрыты.
                  </Text>
                </View>
                <Pressable onPress={() => setIsModalVisible(false)} style={styles.closeButton}>
                  <Text style={styles.closeButtonText}>Закрыть</Text>
                </Pressable>
              </View>

              <ScrollView
                contentContainerStyle={styles.modalScrollContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
              >
                <Section
                  title="Development"
                  subtitle="`Static` нужен для точечной настройки формы. `Evolving` возвращает мягкое рождение новых мандал с фиксированным центром. Здесь же можно быстро сравнивать архетипы лепестков и сценарии роста."
                >
                  <EnumField
                    label="Render mode"
                    value={renderMode}
                    options={renderModeOptions}
                    onChange={setRenderMode}
                  />
                  <EnumField
                    label="Growth profile"
                    value={draft.artDirection.evolutionProfile}
                    options={evolutionProfileOptions}
                    onChange={(value) =>
                      setDraft((current) => ({
                        ...current,
                        artDirection: { ...current.artDirection, evolutionProfile: value },
                      }))
                    }
                  />
                </Section>

                <Section
                  title="Art direction"
                  subtitle="Верхний художественный слой из ТЗ: он лучше всего задает характер Lotus Bloom."
                >
                  <NumberField
                    fieldId="artDirection.ornamentDensity"
                    label="Ornament density"
                    value={draft.artDirection.ornamentDensity}
                    helper="0.0–1.0. Плотность мелкой филлиграни между лепестками."
                    onFocusField={rememberFocusedField}
                    registerInput={registerInput}
                    onChange={(value) =>
                      setDraft((current) => ({
                        ...current,
                        artDirection: { ...current.artDirection, ornamentDensity: value },
                      }))
                    }
                  />
                  <NumberField
                    fieldId="artDirection.depthStrength"
                    label="Depth strength"
                    value={draft.artDirection.depthStrength}
                    helper="0.0–1.0. Насколько цветок уходит в глубину и возвращается к зрителю."
                    onFocusField={rememberFocusedField}
                    registerInput={registerInput}
                    onChange={(value) =>
                      setDraft((current) => ({
                        ...current,
                        artDirection: { ...current.artDirection, depthStrength: value },
                      }))
                    }
                  />
                  <NumberField
                    fieldId="artDirection.glowStrength"
                    label="Glow strength"
                    value={draft.artDirection.glowStrength}
                    helper="0.0–1.0. Сила ауры и мягкого свечения лепестков."
                    onFocusField={rememberFocusedField}
                    registerInput={registerInput}
                    onChange={(value) =>
                      setDraft((current) => ({
                        ...current,
                        artDirection: { ...current.artDirection, glowStrength: value },
                      }))
                    }
                  />
                </Section>

                <Section
                  title="Petal geometry"
                  subtitle="Параметры, которые прямо формируют вид цветка и работу рядов лепестков."
                >
                  <NumberField
                    fieldId="artDirection.layerCount"
                    label="Layer count"
                    value={draft.artDirection.layerCount}
                    helper="1–6. Добавляет дополнительные ряды лепестков. При непрозрачности верхний ряд может закрывать контуры нижних."
                    onFocusField={rememberFocusedField}
                    registerInput={registerInput}
                    onChange={(value) =>
                      setDraft((current) => ({
                        ...current,
                        artDirection: { ...current.artDirection, layerCount: value },
                      }))
                    }
                  />
                  <NumberField
                    fieldId="artDirection.petalOpacity"
                    label="Petal opacity"
                    value={draft.artDirection.petalOpacity}
                    helper="0.0–1.0. Насколько передние лепестки скрывают контуры лепестков нижних рядов."
                    onFocusField={rememberFocusedField}
                    registerInput={registerInput}
                    onChange={(value) =>
                      setDraft((current) => ({
                        ...current,
                        artDirection: { ...current.artDirection, petalOpacity: value },
                      }))
                    }
                  />
                  <EnumField
                    label="Petal profile"
                    value={draft.artDirection.petalProfile}
                    options={petalProfileOptions}
                    onChange={(value) =>
                      setDraft((current) => ({
                        ...current,
                        artDirection: { ...current.artDirection, petalProfile: value },
                      }))
                    }
                  />
                  <NumberField
                    fieldId="geometry.beamCount"
                    label="Beam count"
                    value={draft.geometry.beamCount}
                    helper="3–64. Количество лепестков в одном ряду. При `layerCount > 1` дополнительные ряды смещаются между существующими."
                    onFocusField={rememberFocusedField}
                    registerInput={registerInput}
                    onChange={(value) =>
                      setDraft((current) => ({
                        ...current,
                        geometry: { ...current.geometry, beamCount: value },
                      }))
                    }
                  />
                  <NumberField
                    fieldId="geometry.binduSize"
                    label="Bindu size"
                    value={draft.geometry.binduSize}
                    helper="0.005–0.08. Диаметр центральной зоны биджи, от которой зависит характер сердцевины цветка."
                    onFocusField={rememberFocusedField}
                    registerInput={registerInput}
                    onChange={(value) =>
                      setDraft((current) => ({
                        ...current,
                        geometry: { ...current.geometry, binduSize: value },
                      }))
                    }
                  />
                  <NumberField
                    fieldId="geometry.aperture"
                    label="Aperture"
                    value={draft.geometry.aperture}
                    helper="0.1–1.0. Насколько широко раскрывается лепестковая форма."
                    onFocusField={rememberFocusedField}
                    registerInput={registerInput}
                    onChange={(value) =>
                      setDraft((current) => ({
                        ...current,
                        geometry: { ...current.geometry, aperture: value },
                      }))
                    }
                  />
                  <NumberField
                    fieldId="geometry.overlapFactor"
                    label="Overlap factor"
                    value={draft.geometry.overlapFactor}
                    helper="Коэффициент пересечения цветка жизни внутри Lotus Bloom."
                    onFocusField={rememberFocusedField}
                    registerInput={registerInput}
                    onChange={(value) =>
                      setDraft((current) => ({
                        ...current,
                        geometry: { ...current.geometry, overlapFactor: value },
                      }))
                    }
                  />
                  <NumberField
                    fieldId="primitives.curvature"
                    label="Curvature"
                    value={draft.primitives.curvature}
                    helper="0.0–1.0. Делает лепестки более мягкими и текучими."
                    onFocusField={rememberFocusedField}
                    registerInput={registerInput}
                    onChange={(value) =>
                      setDraft((current) => ({
                        ...current,
                        primitives: { ...current.primitives, curvature: value },
                      }))
                    }
                  />
                  <NumberField
                    fieldId="primitives.strokeWidth"
                    label="Stroke width"
                    value={draft.primitives.strokeWidth}
                    helper="0.001–0.5. Толщина линий, влияющая на легкость или плотность цветка."
                    onFocusField={rememberFocusedField}
                    registerInput={registerInput}
                    onChange={(value) =>
                      setDraft((current) => ({
                        ...current,
                        primitives: { ...current.primitives, strokeWidth: value },
                      }))
                    }
                  />
                </Section>

                <Section
                  title="Pattern detail"
                  subtitle="Контролирует насыщенность орнамента и глубину вложенности без показа скрытых цветовых блоков."
                >
                  <NumberField
                    fieldId="primitives.complexity"
                    label="Pattern complexity"
                    value={draft.primitives.complexity}
                    helper="0.0–1.0. Насколько насыщен внутренний рисунок."
                    onFocusField={rememberFocusedField}
                    registerInput={registerInput}
                    onChange={(value) =>
                      setDraft((current) => ({
                        ...current,
                        primitives: { ...current.primitives, complexity: value },
                      }))
                    }
                  />
                  <NumberField
                    fieldId="complexity.fractalDimension"
                    label="Fractal dimension"
                    value={draft.complexity.fractalDimension}
                    helper="1.05–1.6. Добавляет фрактальную глубину и тонкость цветения."
                    onFocusField={rememberFocusedField}
                    registerInput={registerInput}
                    onChange={(value) =>
                      setDraft((current) => ({
                        ...current,
                        complexity: { ...current.complexity, fractalDimension: value },
                      }))
                    }
                  />
                  <NumberField
                    fieldId="complexity.recursionDepth"
                    label="Recursion depth"
                    value={draft.complexity.recursionDepth}
                    helper="0–5. Глубина повторяющихся вложенных структур."
                    onFocusField={rememberFocusedField}
                    registerInput={registerInput}
                    onChange={(value) =>
                      setDraft((current) => ({
                        ...current,
                        complexity: { ...current.complexity, recursionDepth: value },
                      }))
                    }
                  />
                </Section>

                <Section
                  title="Movement"
                  subtitle="Два режима: крупная мандала во весь экран или мандала внутри мягкого облачка."
                >
                  <NumberField
                    fieldId="kinetics.zoomVelocity"
                    label="Zoom velocity"
                    value={draft.kinetics.zoomVelocity}
                    helper="-2.0–2.0. Сила дыхания масштаба в выбранном режиме."
                    onFocusField={rememberFocusedField}
                    registerInput={registerInput}
                    onChange={(value) =>
                      setDraft((current) => ({
                        ...current,
                        kinetics: { ...current.kinetics, zoomVelocity: value },
                      }))
                    }
                  />
                  <NumberField
                    fieldId="kinetics.rotationVelocity"
                    label="Rotation velocity"
                    value={draft.kinetics.rotationVelocity}
                    helper="-5.0–5.0. Плавная скорость вращения самой мандалы."
                    onFocusField={rememberFocusedField}
                    registerInput={registerInput}
                    onChange={(value) =>
                      setDraft((current) => ({
                        ...current,
                        kinetics: { ...current.kinetics, rotationVelocity: value },
                      }))
                    }
                  />
                  <EnumField
                    label="Motion logic"
                    value={draft.kinetics.motionLogic}
                    options={motionLogicOptions}
                    onChange={(value) =>
                      setDraft((current) => ({
                        ...current,
                        kinetics: { ...current.kinetics, motionLogic: value },
                      }))
                    }
                  />
                </Section>

              </ScrollView>

              <View style={styles.modalActionRow}>
                <Pressable
                  onPress={loadOptimalLotusProperties}
                  style={[styles.secondaryButton, styles.modalActionButton]}
                >
                  <Text style={styles.secondaryButtonText}>Загрузить оптимальные свойства</Text>
                </Pressable>
                <Pressable onPress={applyDraft} style={[styles.primaryButton, styles.modalActionButton]}>
                  <Text style={styles.primaryButtonText}>Применить текущие значения</Text>
                </Pressable>
              </View>
            </View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#04060e",
  },
  safeAreaLight: {
    backgroundColor: "#eff3ff",
  },
  screen: {
    flex: 1,
  },
  previewPane: {
    flex: 1,
    backgroundColor: "#060816",
  },
  loadBadge: {
    position: "absolute",
    top: 16,
    right: 16,
    borderRadius: 14,
    backgroundColor: "rgba(6, 10, 22, 0.78)",
    borderWidth: 1,
    borderColor: "rgba(122, 140, 255, 0.26)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 2,
  },
  loadBadgeLabel: {
    color: "#aab6d3",
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  loadBadgeValue: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "700",
  },
  bottomBar: {
    position: "absolute",
    right: 16,
    bottom: 20,
    left: 16,
  },
  section: {
    borderRadius: 18,
    backgroundColor: "#101522",
    padding: 16,
    gap: 12,
  },
  sectionTitle: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "700",
  },
  sectionSubtitle: {
    color: "#aab6d3",
    fontSize: 13,
    lineHeight: 18,
  },
  fieldBlock: {
    gap: 6,
  },
  fieldLabel: {
    color: "#f6f8ff",
    fontSize: 15,
    fontWeight: "600",
  },
  fieldHint: {
    color: "#8ea0c9",
    fontSize: 12,
    lineHeight: 16,
  },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#283553",
    backgroundColor: "#0b1020",
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: "#ffffff",
    fontSize: 15,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#182236",
  },
  chipActive: {
    backgroundColor: "#7a8cff",
  },
  chipText: {
    color: "#d5ddf8",
    fontSize: 13,
    fontWeight: "600",
  },
  chipTextActive: {
    color: "#081022",
  },
  primaryButton: {
    borderRadius: 14,
    backgroundColor: "#7a8cff",
    paddingHorizontal: 14,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    color: "#081022",
    fontWeight: "700",
  },
  secondaryButton: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#31415f",
    paddingHorizontal: 14,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: {
    color: "#dfe6ff",
    fontWeight: "600",
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.58)",
  },
  modalKeyboard: {
    justifyContent: "flex-end",
  },
  modalCard: {
    maxHeight: "90%",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: "#081022",
    paddingTop: 20,
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 16,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  modalHeaderCopy: {
    flex: 1,
    gap: 6,
  },
  modalTitle: {
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "700",
  },
  modalSubtitle: {
    color: "#aab6d3",
    fontSize: 13,
    lineHeight: 18,
  },
  closeButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#31415f",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  closeButtonText: {
    color: "#dfe6ff",
    fontWeight: "600",
  },
  modalScrollContent: {
    paddingBottom: 4,
    gap: 16,
  },
  modalActionRow: {
    flexDirection: "row",
    gap: 10,
  },
  modalActionButton: {
    flex: 1,
  },
});
