import { Modal, Pressable, StyleSheet, View } from "react-native";
import { useState } from "react";

import type { CommunicatorStrings } from "@/modules/communicator/i18n/communicator";
import { AppText } from "@/modules/ui/AppText";
import { useTheme } from "@/modules/ui/theme";
import type { PracticePicked } from "@/services/communicator-client";

const KIND_LABEL: Record<NonNullable<PracticePicked["kind"]>, string> = {
  breath: "Дыхание",
  meditation: "Медитация",
  yoga: "Асаны",
};

function durationLabel(practice: PracticePicked): string | null {
  if (!practice.durationSec) return null;
  const minutes = Math.max(1, Math.round(practice.durationSec / 60));
  if (practice.minDurationSec && practice.maxDurationSec && practice.minDurationSec !== practice.maxDurationSec) {
    return `${minutes} мин, можно настроить`;
  }
  return `${minutes} мин`;
}

export function PracticeCard({
  practice,
  strings,
  onPress,
}: {
  practice: PracticePicked;
  strings: CommunicatorStrings;
  onPress?: (practice: PracticePicked) => void;
}) {
  const theme = useTheme();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const title = practice.name ?? strings.practiceCard.fallbackTitle;
  const meta = [practice.kind ? KIND_LABEL[practice.kind] : null, durationLabel(practice)].filter(Boolean).join(" · ");

  return (
    <View style={styles.row}>
      <View
        style={[
          styles.card,
          {
            backgroundColor: theme.colors.surfaceElevated,
            borderColor: theme.colors.accent,
          },
        ]}
      >
        <AppText variant="technicalCaption" tone="accent" style={styles.eyebrow}>
          {strings.practiceCard.eyebrow}
        </AppText>
        <AppText variant="sectionTitle">{title}</AppText>
        {meta ? (
          <AppText variant="technicalCaption" tone="muted">
            {meta}
          </AppText>
        ) : null}
        {practice.reason ? (
          <AppText variant="dialogBody" tone="muted">{practice.reason}</AppText>
        ) : null}
        {(practice.hasDescription || practice.hasInstructionVideo) ? (
          <View style={styles.metaRow}>
            {practice.hasDescription ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setDetailsOpen(true)}
                style={[styles.metaPill, { borderColor: theme.colors.surfaceBorder }]}
              >
                <AppText variant="technicalCaption" tone="muted">
                  {strings.practiceCard.detailsButton}
                </AppText>
              </Pressable>
            ) : null}
            {practice.hasInstructionVideo ? (
              <View style={[styles.metaPill, { borderColor: theme.colors.surfaceBorder }]}>
                <AppText variant="technicalCaption" tone="muted">
                  {strings.practiceCard.instructionVideoLabel}
                </AppText>
              </View>
            ) : null}
          </View>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={strings.practiceCard.startAccessibilityLabel}
          onPress={() => onPress?.(practice)}
          style={({ pressed }) => [
            styles.button,
            {
              backgroundColor: theme.colors.buttonPrimaryBg,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <AppText variant="buttonLabel" tone="accentOn">
            {strings.practiceCard.startButton}
          </AppText>
        </Pressable>
        <Modal
          visible={detailsOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setDetailsOpen(false)}
        >
          <View style={[styles.modalBackdrop, { backgroundColor: theme.colors.modalBackdrop }]}>
            <View
              style={[
                styles.modalCard,
                {
                  backgroundColor: theme.colors.surfaceElevated,
                  borderColor: theme.colors.surfaceBorder,
                },
              ]}
            >
              <AppText variant="sectionTitle">{strings.practiceCard.detailsTitle}</AppText>
              <AppText variant="dialogBody" tone="muted">
                {practice.reason ?? title}
              </AppText>
              <Pressable
                accessibilityRole="button"
                onPress={() => setDetailsOpen(false)}
                style={[styles.button, { backgroundColor: theme.colors.buttonPrimaryBg }]}
              >
                <AppText variant="buttonLabel" tone="accentOn">
                  {strings.practiceCard.closeDetailsButton}
                </AppText>
              </Pressable>
            </View>
          </View>
        </Modal>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    width: "100%",
    paddingHorizontal: 12,
    paddingTop: 8,
    alignItems: "flex-start",
  },
  card: {
    maxWidth: "92%",
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 8,
  },
  eyebrow: {
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  button: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    marginTop: 2,
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
  modalBackdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: {
    width: "100%",
    maxWidth: 420,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 20,
    padding: 18,
    gap: 12,
  },
});
