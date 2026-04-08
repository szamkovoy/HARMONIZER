export const BINDU_RING_SLOT_IDS = [
  "bindu",
  "ring1",
  "ring2",
  "ring3",
  "ring4",
  "ring5",
  "ring6",
] as const;

export type RingSlotId = (typeof BINDU_RING_SLOT_IDS)[number];
export type EditableColorSlotId = "cloud" | RingSlotId;
export type ChakraPresetId =
  | "chakra1"
  | "chakra2"
  | "chakra3"
  | "chakra4"
  | "chakra5"
  | "chakra6"
  | "chakra7";

export interface ChakraVisualPreset {
  id: ChakraPresetId;
  label: string;
  cloud: {
    color: string;
    opacity: number;
  };
  ringImageColor: Record<RingSlotId, string>;
}

export const EDITABLE_COLOR_SLOTS: ReadonlyArray<{
  id: EditableColorSlotId;
  label: string;
}> = [
  { id: "cloud", label: "Cloud" },
  { id: "bindu", label: "Bindu" },
  { id: "ring1", label: "Ring 1" },
  { id: "ring2", label: "Ring 2" },
  { id: "ring3", label: "Ring 3" },
  { id: "ring4", label: "Ring 4" },
  { id: "ring5", label: "Ring 5" },
  { id: "ring6", label: "Ring 6" },
];

export const BINDU_COLOR_EDITOR_SWATCHES = [
  "#ec5b1c",
  "#ff6b5f",
  "#c84a44",
  "#c67c3f",
  "#ffa852",
  "#c6a64f",
  "#f3d36f",
  "#70ffad",
  "#5d9f68",
  "#7fd1a1",
  "#85e6ff",
  "#6ca0c1",
  "#57c2ff",
  "#4f72b8",
  "#7a90ff",
  "#a87aff",
  "#ff80b8",
  "#c99cff",
  "#6e4d8f",
  "#ffffff",
  "#d8dbe8",
  "#9aa3c4",
  "#4a506d",
  "#171a28",
] as const;

export const DEFAULT_RING_IMAGE_COLORS: Record<RingSlotId, string> = {
  bindu: "#ec5b1c",
  ring1: "#ff80b8",
  ring2: "#85e6ff",
  ring3: "#a87aff",
  ring4: "#70ffad",
  ring5: "#ffa852",
  ring6: "#57c2ff",
};

function cloneRingImageColors(colors: Record<RingSlotId, string>): Record<RingSlotId, string> {
  return {
    bindu: colors.bindu,
    ring1: colors.ring1,
    ring2: colors.ring2,
    ring3: colors.ring3,
    ring4: colors.ring4,
    ring5: colors.ring5,
    ring6: colors.ring6,
  };
}

export const DEFAULT_BINDU_SUCCESSION_VISUAL_PRESETS: ChakraVisualPreset[] = [
  {
    id: "chakra1",
    label: "1",
    cloud: { color: "#b54c58", opacity: 0.34 },
    ringImageColor: cloneRingImageColors(DEFAULT_RING_IMAGE_COLORS),
  },
  {
    id: "chakra2",
    label: "2",
    cloud: { color: "#c67c3f", opacity: 0.32 },
    ringImageColor: cloneRingImageColors(DEFAULT_RING_IMAGE_COLORS),
  },
  {
    id: "chakra3",
    label: "3",
    cloud: { color: "#c6a64f", opacity: 0.3 },
    ringImageColor: cloneRingImageColors(DEFAULT_RING_IMAGE_COLORS),
  },
  {
    id: "chakra4",
    label: "4",
    cloud: { color: "#5d9f68", opacity: 0.32 },
    ringImageColor: cloneRingImageColors(DEFAULT_RING_IMAGE_COLORS),
  },
  {
    id: "chakra5",
    label: "5",
    cloud: { color: "#6ca0c1", opacity: 0.32 },
    ringImageColor: cloneRingImageColors(DEFAULT_RING_IMAGE_COLORS),
  },
  {
    id: "chakra6",
    label: "6",
    cloud: { color: "#4f72b8", opacity: 0.34 },
    ringImageColor: cloneRingImageColors(DEFAULT_RING_IMAGE_COLORS),
  },
  {
    id: "chakra7",
    label: "7",
    cloud: { color: "#6e4d8f", opacity: 0.36 },
    ringImageColor: cloneRingImageColors(DEFAULT_RING_IMAGE_COLORS),
  },
];

function clampOpacity(value: number, fallback: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, value));
}

export function normalizeHexColor(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  const compact = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  if (!/^[\da-fA-F]{3}$|^[\da-fA-F]{6}$/.test(compact)) {
    return undefined;
  }

  const expanded =
    compact.length === 3
      ? compact
          .split("")
          .map((char) => char + char)
          .join("")
      : compact;

  return `#${expanded.toLowerCase()}`;
}

export function getEditableColorSlotColor(preset: ChakraVisualPreset, slotId: EditableColorSlotId) {
  return slotId === "cloud" ? preset.cloud.color : preset.ringImageColor[slotId];
}

export function applyColorToPresetSlot(
  preset: ChakraVisualPreset,
  slotId: EditableColorSlotId,
  color: string,
): ChakraVisualPreset {
  if (slotId === "cloud") {
    return {
      ...preset,
      cloud: {
        ...preset.cloud,
        color,
      },
    };
  }

  return {
    ...preset,
    ringImageColor: {
      ...preset.ringImageColor,
      [slotId]: color,
    },
  };
}

export function sanitizeChakraVisualPresets(candidate: unknown): ChakraVisualPreset[] {
  if (!Array.isArray(candidate)) {
    return DEFAULT_BINDU_SUCCESSION_VISUAL_PRESETS;
  }

  return DEFAULT_BINDU_SUCCESSION_VISUAL_PRESETS.map((defaultPreset, index) => {
    const rawPreset = candidate[index];
    if (!rawPreset || typeof rawPreset !== "object") {
      return defaultPreset;
    }

    const presetObject = rawPreset as Partial<ChakraVisualPreset>;
    const cloudObject =
      presetObject.cloud && typeof presetObject.cloud === "object" ? presetObject.cloud : undefined;

    const ringImageColor = BINDU_RING_SLOT_IDS.reduce(
      (accumulator, slotId) => {
        const rawColor =
          presetObject.ringImageColor && typeof presetObject.ringImageColor === "object"
            ? presetObject.ringImageColor[slotId]
            : undefined;
        accumulator[slotId] = normalizeHexColor(typeof rawColor === "string" ? rawColor : undefined) ?? defaultPreset.ringImageColor[slotId];
        return accumulator;
      },
      {} as Record<RingSlotId, string>,
    );

    return {
      id: defaultPreset.id,
      label: defaultPreset.label,
      cloud: {
        color:
          normalizeHexColor(typeof cloudObject?.color === "string" ? cloudObject.color : undefined) ??
          defaultPreset.cloud.color,
        opacity: clampOpacity(
          typeof cloudObject?.opacity === "number" ? cloudObject.opacity : Number.NaN,
          defaultPreset.cloud.opacity,
        ),
      },
      ringImageColor,
    };
  });
}
