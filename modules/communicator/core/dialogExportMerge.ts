export type PlanningPersistenceExport = {
  inserted: unknown[];
  summarized: unknown[];
  skipped: unknown[];
};

export type ExportMessageMeta = Record<string, unknown> & {
  planningPersistence?: PlanningPersistenceExport;
  relatedEventIds?: string[];
  matrixCells?: unknown[];
  skippedPlannedEvents?: unknown[];
};

export type ExportMessageSnapshot = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: number;
  meta?: ExportMessageMeta;
  rawMeta?: Record<string, unknown>;
};

function exportTextsMatch(a: string, b: string): boolean {
  return a.trim() === b.trim();
}

function roleOrdinalIndex(messages: ExportMessageSnapshot[], index: number, role: "user" | "assistant"): number {
  let ordinal = 0;
  for (let i = 0; i < index; i += 1) {
    if (messages[i]?.role === role) ordinal += 1;
  }
  return ordinal;
}

function messageAtRoleOrdinal(
  messages: ExportMessageSnapshot[],
  role: "user" | "assistant",
  ordinal: number,
): ExportMessageSnapshot | undefined {
  let seen = 0;
  for (const message of messages) {
    if (message.role !== role) continue;
    if (seen === ordinal) return message;
    seen += 1;
  }
  return undefined;
}

export function mergeExportMessageMeta(
  localMeta: ExportMessageMeta | undefined,
  syncedMeta: ExportMessageMeta | undefined,
): ExportMessageMeta | undefined {
  if (!localMeta && !syncedMeta) return undefined;
  const planningPersistence =
    syncedMeta?.planningPersistence ?? localMeta?.planningPersistence;
  const relatedEventIds = syncedMeta?.relatedEventIds ?? localMeta?.relatedEventIds;
  const matrixCells = syncedMeta?.matrixCells ?? localMeta?.matrixCells;
  const skippedPlannedEvents = syncedMeta?.skippedPlannedEvents ?? localMeta?.skippedPlannedEvents;
  return {
    ...(localMeta ?? {}),
    ...(syncedMeta ?? {}),
    insightMetrics: syncedMeta?.insightMetrics ?? localMeta?.insightMetrics,
    validation: syncedMeta?.validation ?? localMeta?.validation,
    practicePicked: syncedMeta?.practicePicked ?? localMeta?.practicePicked,
    targetChakra: syncedMeta?.targetChakra ?? localMeta?.targetChakra,
    recommendationCorrected: syncedMeta?.recommendationCorrected ?? localMeta?.recommendationCorrected,
    debug: syncedMeta?.debug ?? localMeta?.debug,
    planningPersistence,
    relatedEventIds,
    matrixCells,
    skippedPlannedEvents,
  };
}

export function mergeExportMessages(params: {
  localMessages: ExportMessageSnapshot[];
  syncedMessages: ExportMessageSnapshot[];
}): ExportMessageSnapshot[] {
  const merged: ExportMessageSnapshot[] = [];
  const usedSyncedIds = new Set<string>();

  for (let index = 0; index < params.localMessages.length; index += 1) {
    const localMessage = params.localMessages[index];
    const roleOrdinal = roleOrdinalIndex(params.localMessages, index, localMessage.role);

    let syncedMessage: ExportMessageSnapshot | undefined;
    for (let syncIndex = 0; syncIndex < params.syncedMessages.length; syncIndex += 1) {
      const candidate = params.syncedMessages[syncIndex];
      if (candidate.role !== localMessage.role) continue;
      const candidateOrdinal = roleOrdinalIndex(params.syncedMessages, syncIndex, candidate.role);
      if (candidateOrdinal !== roleOrdinal) continue;
      if (exportTextsMatch(candidate.content, localMessage.content)) {
        syncedMessage = candidate;
        break;
      }
      if (!candidate.content.trim() && localMessage.content.trim()) {
        syncedMessage = candidate;
        break;
      }
      if (candidate.content.trim() && !localMessage.content.trim()) {
        syncedMessage = candidate;
        break;
      }
    }

    if (!syncedMessage) {
      syncedMessage = messageAtRoleOrdinal(params.syncedMessages, localMessage.role, roleOrdinal);
    }

    if (syncedMessage) {
      usedSyncedIds.add(syncedMessage.id);
      merged.push({
        ...localMessage,
        id: syncedMessage.id || localMessage.id,
        createdAt: syncedMessage.createdAt ?? localMessage.createdAt,
        meta: mergeExportMessageMeta(localMessage.meta, syncedMessage.meta),
        rawMeta: syncedMessage.rawMeta ?? localMessage.rawMeta,
      });
      continue;
    }

    merged.push(localMessage);
  }

  for (const syncedMessage of params.syncedMessages) {
    if (usedSyncedIds.has(syncedMessage.id)) continue;
    merged.push(syncedMessage);
  }

  return merged;
}

function planningPersistenceHasInserts(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const inserted = (value as PlanningPersistenceExport).inserted;
  return Array.isArray(inserted) && inserted.length > 0;
}

export function reconcileExportPlanningPersistence(
  messages: Array<{ role: string; meta: { planning_persistence: PlanningPersistenceExport | null } }>,
  dialogStateAfter: Record<string, unknown> | undefined,
): void {
  const created = dialogStateAfter?.planning_created_in_this_conversation;
  if (!Array.isArray(created) || created.length === 0) return;
  if (messages.some((message) => message.role === "assistant" && planningPersistenceHasInserts(message.meta.planning_persistence))) {
    return;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    message.meta.planning_persistence = {
      inserted: created,
      summarized: [],
      skipped: [],
    };
    return;
  }
}
