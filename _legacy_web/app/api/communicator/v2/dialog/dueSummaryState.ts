import type { PlannedEventRow } from "@legacy/app/api/communicator/v2/dialog/lifeMatrixPersistence";

export const DUE_SUMMARY_STATE_KEY = "due_summary_state";
const DUE_SUMMARY_MAX_EVENTS = 3;

export type DueSummaryState = {
  prompted_event_ids: string[];
  reminder_count: number;
  last_prompted_at: string | null;
};

function normalizePromptedIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

export function readDueSummaryState(
  triggerMeta: Record<string, unknown> | null | undefined,
  dueEvents: PlannedEventRow[],
): DueSummaryState | null {
  const raw = triggerMeta?.[DUE_SUMMARY_STATE_KEY];
  if (!raw || typeof raw !== "object") return null;
  const state = raw as Record<string, unknown>;
  const validIds = new Set(dueEvents.map((event) => event.id));
  const promptedIds = normalizePromptedIds(state.prompted_event_ids).filter((id) => validIds.has(id));
  if (promptedIds.length === 0) return null;

  const reminderCount = Number.isInteger(state.reminder_count) ? Number(state.reminder_count) : 0;
  const lastPromptedAt = typeof state.last_prompted_at === "string" && state.last_prompted_at.trim().length > 0
    ? state.last_prompted_at
    : null;
  return {
    prompted_event_ids: promptedIds,
    reminder_count: Math.max(0, reminderCount),
    last_prompted_at: lastPromptedAt,
  };
}

export function selectDueEventsForTurn(
  dueEvents: PlannedEventRow[],
  state: DueSummaryState | null,
  limit = DUE_SUMMARY_MAX_EVENTS,
): PlannedEventRow[] {
  if (dueEvents.length === 0) return [];
  if (state?.prompted_event_ids.length) {
    const byId = new Map(dueEvents.map((event) => [event.id, event]));
    return state.prompted_event_ids
      .map((eventId) => byId.get(eventId))
      .filter((event): event is PlannedEventRow => Boolean(event));
  }
  return dueEvents.slice(0, limit);
}

export function resolveDueSummaryTurn(params: {
  existingState: DueSummaryState | null;
  selectedDueEvents: PlannedEventRow[];
  answeredEventIds: string[];
  isInitiate: boolean;
  summarizingActive: boolean;
  nowIso: string;
}): {
  nextState: DueSummaryState | null;
  deleteEventIds: string[];
} {
  if (!params.summarizingActive || params.selectedDueEvents.length === 0) {
    return { nextState: null, deleteEventIds: [] };
  }

  const selectedIds = params.selectedDueEvents.map((event) => event.id);
  const answeredIds = [...new Set(params.answeredEventIds.filter((id) => selectedIds.includes(id)))];

  if (params.isInitiate) {
    return {
      nextState: {
        prompted_event_ids: selectedIds,
        reminder_count: 0,
        last_prompted_at: params.nowIso,
      },
      deleteEventIds: [],
    };
  }

  if (answeredIds.length > 0) {
    const unansweredIds = selectedIds.filter((eventId) => !answeredIds.includes(eventId));
    if (unansweredIds.length > 0) {
      return {
        nextState: {
          prompted_event_ids: unansweredIds,
          reminder_count: 0,
          last_prompted_at: params.nowIso,
        },
        deleteEventIds: [],
      };
    }
    return {
      nextState: null,
      deleteEventIds: [],
    };
  }

  const reminderCount = params.existingState?.reminder_count ?? 0;
  if (reminderCount >= 1) {
    return {
      nextState: null,
      deleteEventIds: selectedIds,
    };
  }

  return {
    nextState: {
      prompted_event_ids: selectedIds,
      reminder_count: 1,
      last_prompted_at: params.nowIso,
    },
    deleteEventIds: [],
  };
}
