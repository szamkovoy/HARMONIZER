/**
 * Durable + in-memory circuit breaker for Groq Whisper → OpenAI Whisper fallback.
 * Memory covers same Vercel isolate; Supabase row covers multi-instance / cold starts.
 */
import { createServiceSupabase } from "./supabase";
import {
  extractWaitTimeMs,
  isGroqFailoverStatus,
  ladderDelayMs,
} from "./whisperWaitTime";

export const CIRCUIT_KEY = "groq_whisper";

export type CircuitBreakerState = {
  groqBlockedUntil: number;
  consecutiveFallbackCount: number;
};

type MemoryState = CircuitBreakerState & { loadedAt: number };

let memory: MemoryState = {
  groqBlockedUntil: 0,
  consecutiveFallbackCount: 0,
  loadedAt: 0,
};

const MEMORY_REFRESH_MS = 5_000;

function nowMs(): number {
  return Date.now();
}

/** Test helper — reset in-memory state. */
export function resetWhisperCircuitMemoryForTests(state?: Partial<CircuitBreakerState>): void {
  memory = {
    groqBlockedUntil: state?.groqBlockedUntil ?? 0,
    consecutiveFallbackCount: state?.consecutiveFallbackCount ?? 0,
    loadedAt: nowMs(),
  };
}

async function loadFromDb(): Promise<CircuitBreakerState | null> {
  try {
    const db = createServiceSupabase();
    const { data, error } = await db
      .from("stt_circuit_breaker")
      .select("blocked_until, consecutive_fallback_count")
      .eq("key", CIRCUIT_KEY)
      .maybeSingle();
    if (error || !data) return null;
    const blockedUntil = Date.parse(String(data.blocked_until ?? ""));
    return {
      groqBlockedUntil: Number.isFinite(blockedUntil) ? blockedUntil : 0,
      consecutiveFallbackCount: Math.max(0, Number(data.consecutive_fallback_count ?? 0) || 0),
    };
  } catch {
    return null;
  }
}

async function persistToDb(
  state: CircuitBreakerState,
  lastError: string | null,
): Promise<void> {
  try {
    const db = createServiceSupabase();
    await db.from("stt_circuit_breaker").upsert(
      {
        key: CIRCUIT_KEY,
        blocked_until: new Date(state.groqBlockedUntil).toISOString(),
        consecutive_fallback_count: state.consecutiveFallbackCount,
        last_error: lastError,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
  } catch (error) {
    console.warn(
      "[STT Circuit] persist failed:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function getWhisperCircuitState(): Promise<CircuitBreakerState> {
  const stale = nowMs() - memory.loadedAt > MEMORY_REFRESH_MS;
  if (!stale && memory.groqBlockedUntil > nowMs()) {
    return {
      groqBlockedUntil: memory.groqBlockedUntil,
      consecutiveFallbackCount: memory.consecutiveFallbackCount,
    };
  }
  if (stale || memory.loadedAt === 0) {
    const fromDb = await loadFromDb();
    if (fromDb) {
      memory = { ...fromDb, loadedAt: nowMs() };
    } else {
      memory = { ...memory, loadedAt: nowMs() };
    }
  }
  return {
    groqBlockedUntil: memory.groqBlockedUntil,
    consecutiveFallbackCount: memory.consecutiveFallbackCount,
  };
}

export function isGroqBlocked(state: CircuitBreakerState, at = nowMs()): boolean {
  return state.groqBlockedUntil > at;
}

export async function markGroqSuccess(): Promise<void> {
  memory = {
    groqBlockedUntil: 0,
    consecutiveFallbackCount: 0,
    loadedAt: nowMs(),
  };
  await persistToDb(
    { groqBlockedUntil: 0, consecutiveFallbackCount: 0 },
    null,
  );
}

export async function markGroqFailover(input: {
  status: number;
  headers?: Headers | null;
  bodyText?: string | null;
}): Promise<{ waitMs: number; usedLadder: boolean }> {
  if (!isGroqFailoverStatus(input.status)) {
    return { waitMs: 0, usedLadder: false };
  }

  const parsed = extractWaitTimeMs({
    headers: input.headers,
    bodyText: input.bodyText,
  });

  let waitMs: number;
  let usedLadder = false;
  let nextCount = memory.consecutiveFallbackCount;

  if (parsed != null) {
    waitMs = parsed;
    // Valid vendor hint — do not escalate ladder; keep count for unresolved bursts.
  } else {
    nextCount = Math.min(memory.consecutiveFallbackCount + 1, 3);
    waitMs = ladderDelayMs(nextCount);
    usedLadder = true;
  }

  const next: CircuitBreakerState = {
    groqBlockedUntil: nowMs() + waitMs,
    consecutiveFallbackCount: nextCount,
  };
  memory = { ...next, loadedAt: nowMs() };

  const snippet = (input.bodyText ?? "").slice(0, 240);
  console.warn(
    `[STT Circuit] Groq paused ${Math.round(waitMs / 1000)}s` +
      ` (status=${input.status}, ladder=${usedLadder}, count=${nextCount}).` +
      (snippet ? ` body=${snippet}` : ""),
  );
  await persistToDb(next, `HTTP ${input.status}${snippet ? `: ${snippet}` : ""}`);
  return { waitMs, usedLadder };
}
