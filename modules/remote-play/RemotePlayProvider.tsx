import { createContext, useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { useAuth } from "@/modules/auth";
import { getSupabase } from "@/services/supabase";
import {
  getActiveRemotePlaySession,
  linkDevice as linkRemoteDevice,
  playVimeoOnRemote,
  setRemotePlaybackStatus,
  stopRemotePlayback,
} from "./core/remotePlayService";
import { isTvSessionActive, RemotePlayError, type TvSessionRow } from "./core/types";

interface RemotePlayContextValue {
  session: TvSessionRow | null;
  connected: boolean;
  loading: boolean;
  busy: boolean;
  error: string | null;
  refreshSession: () => Promise<void>;
  linkDevice: (pairingCode: string) => Promise<TvSessionRow>;
  playVimeo: (vimeoId: string, audiotrack?: string) => Promise<TvSessionRow>;
  pause: () => Promise<TvSessionRow>;
  resume: () => Promise<TvSessionRow>;
  stop: () => Promise<TvSessionRow>;
  disconnect: () => Promise<void>;
  clearError: () => void;
}

export const RemotePlayContext = createContext<RemotePlayContextValue | null>(null);

function notConnected(): RemotePlayError {
  return new RemotePlayError("not_connected", "Сначала подключите ТВ.");
}

export function RemotePlayProvider({ children }: { children: ReactNode }) {
  const { authUser } = useAuth();
  const [session, setSession] = useState<TvSessionRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const userId = authUser?.id ?? null;

  const applySession = useCallback((next: TvSessionRow | null) => {
    setSession(isTvSessionActive(next) ? next : null);
  }, []);

  const capture = useCallback((unknownError: unknown) => {
    const message = unknownError instanceof Error ? unknownError.message : "Remote Play временно недоступен.";
    setError(message);
    throw unknownError;
  }, []);

  const refreshSession = useCallback(async () => {
    if (!userId) {
      setSession(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      applySession(await getActiveRemotePlaySession(userId));
    } catch (unknownError) {
      capture(unknownError);
    } finally {
      setLoading(false);
    }
  }, [applySession, capture, userId]);

  useEffect(() => {
    void refreshSession().catch(() => {});
  }, [refreshSession]);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase || !session?.id) return;

    const channel = supabase
      .channel(`remote-play:${session.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tv_sessions",
          filter: `id=eq.${session.id}`,
        },
        (payload) => {
          if (payload.eventType === "DELETE") {
            setSession(null);
            return;
          }
          applySession(payload.new as TvSessionRow);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [applySession, session?.id]);

  const linkDevice = useCallback(
    async (pairingCode: string) => {
      if (!userId) throw new RemotePlayError("not_connected", "Войдите в аккаунт, чтобы подключить ТВ.");
      setBusy(true);
      setError(null);
      try {
        const linked = await linkRemoteDevice(pairingCode, userId);
        applySession(linked);
        return linked;
      } catch (unknownError) {
        return capture(unknownError) as never;
      } finally {
        setBusy(false);
      }
    },
    [applySession, capture, userId],
  );

  const playVimeo = useCallback(
    async (vimeoId: string, audiotrack?: string) => {
      if (!session?.id) throw notConnected();
      setBusy(true);
      setError(null);
      try {
        const updated = await playVimeoOnRemote(session.id, vimeoId, audiotrack);
        applySession(updated);
        return updated;
      } catch (unknownError) {
        return capture(unknownError) as never;
      } finally {
        setBusy(false);
      }
    },
    [applySession, capture, session?.id],
  );

  const pause = useCallback(async () => {
    if (!session?.id) throw notConnected();
    setBusy(true);
    setError(null);
    try {
      const updated = await setRemotePlaybackStatus(session.id, "paused");
      applySession(updated);
      return updated;
    } catch (unknownError) {
      return capture(unknownError) as never;
    } finally {
      setBusy(false);
    }
  }, [applySession, capture, session?.id]);

  const resume = useCallback(async () => {
    if (!session?.id) throw notConnected();
    setBusy(true);
    setError(null);
    try {
      const updated = await setRemotePlaybackStatus(session.id, "playing");
      applySession(updated);
      return updated;
    } catch (unknownError) {
      return capture(unknownError) as never;
    } finally {
      setBusy(false);
    }
  }, [applySession, capture, session?.id]);

  const stop = useCallback(async () => {
    if (!session?.id) throw notConnected();
    setBusy(true);
    setError(null);
    try {
      const updated = await stopRemotePlayback(session.id);
      applySession(updated);
      return updated;
    } catch (unknownError) {
      return capture(unknownError) as never;
    } finally {
      setBusy(false);
    }
  }, [applySession, capture, session?.id]);

  // Drop the TV link on the phone side: stop playback (best-effort) and clear
  // the local session so the UI returns to the pairing flow. The session row
  // on the TV stays stopped; the phone simply forgets the pairing.
  const disconnect = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      if (session?.id) {
        await stopRemotePlayback(session.id).catch(() => null);
      }
    } finally {
      applySession(null);
      setBusy(false);
    }
  }, [applySession, session?.id]);

  const value = useMemo<RemotePlayContextValue>(
    () => ({
      session,
      connected: Boolean(session),
      loading,
      busy,
      error,
      refreshSession,
      linkDevice,
      playVimeo,
      pause,
      resume,
      stop,
      disconnect,
      clearError: () => setError(null),
    }),
    [busy, error, linkDevice, loading, pause, playVimeo, refreshSession, resume, session, stop, disconnect],
  );

  return <RemotePlayContext.Provider value={value}>{children}</RemotePlayContext.Provider>;
}
