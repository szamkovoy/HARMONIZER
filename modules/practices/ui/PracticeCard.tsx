import { StyleSheet, View } from "react-native";

import type { PracticeSummary } from "@/modules/practices/core/types";
import { AppButton } from "@/modules/ui/AppButton";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";

const KIND_LABEL: Record<PracticeSummary["kind"], string> = {
  meditation: "Медитация",
  breath: "Дыхание",
  yoga: "Асаны",
};

const CHAKRA_LABEL: Record<number, string> = {
  1: "Муладхара",
  2: "Свадхистана",
  3: "Манипура",
  4: "Анахата",
  5: "Вишуддха",
  6: "Аджна",
  7: "Сахасрара",
};

function durationLabel(practice: PracticeSummary): string {
  if (!practice.defaultDurationSec) {
    return practice.durationPolicy === "user_selectable" ? "длительность выбирается" : "длительность уточняется";
  }
  const minutes = Math.max(1, Math.round(practice.defaultDurationSec / 60));
  return practice.durationPolicy === "user_selectable" ? `от ${minutes} мин` : `${minutes} мин`;
}

function chakraLabel(practice: PracticeSummary): string {
  if (practice.primaryChakra) return CHAKRA_LABEL[practice.primaryChakra] ?? `Чакра ${practice.primaryChakra}`;
  if (practice.chakraIds.length > 1) return `${practice.chakraIds.length} чакры`;
  return "чакра уточняется";
}

export function PracticeCard({
  practice,
  onLaunch,
}: {
  practice: PracticeSummary;
  onLaunch: (practice: PracticeSummary) => void;
}) {
  const theme = useTheme();
  const quality = typeof practice.quality === "number" ? `Качество ${practice.quality.toFixed(1)}` : null;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.surfaceElevated,
          borderColor: theme.colors.surfaceBorder,
        },
      ]}
    >
      <View style={styles.headerRow}>
        <View style={styles.titleBlock}>
          <AppText variant="sectionTitle">{practice.title}</AppText>
          {practice.subtitle ? (
            <AppText variant="technicalCaption" tone="muted">
              {practice.subtitle}
            </AppText>
          ) : null}
        </View>
        <View style={[styles.kindPill, { backgroundColor: theme.colors.controlButtonBg }]}>
          <AppText variant="technicalCaption" tone="muted">
            {KIND_LABEL[practice.kind]}
          </AppText>
        </View>
      </View>

      {practice.description ? (
        <AppText variant="dialogBody" tone="muted">
          {practice.description}
        </AppText>
      ) : null}

      <View style={styles.metaRow}>
        <MetaPill label={durationLabel(practice)} />
        <MetaPill label={chakraLabel(practice)} />
        {quality ? <MetaPill label={quality} /> : null}
        {practice.video?.externalId ? <MetaPill label="Vimeo metadata" /> : null}
      </View>

      <AppButton
        label={practice.kind === "yoga" ? "Открыть карточку" : "Начать практику"}
        onPress={() => onLaunch(practice)}
        style={styles.button}
      />
    </View>
  );
}

function MetaPill({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.metaPill,
        {
          backgroundColor: theme.colors.controlButtonBg,
          borderColor: theme.colors.surfaceBorder,
        },
      ]}
    >
      <AppText variant="technicalCaption" tone="muted">
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 20,
    padding: 16,
    gap: 12,
  },
  headerRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  titleBlock: {
    flex: 1,
    gap: 2,
  },
  kindPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  metaPill: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  button: {
    alignSelf: "flex-start",
    minWidth: 160,
  },
});
