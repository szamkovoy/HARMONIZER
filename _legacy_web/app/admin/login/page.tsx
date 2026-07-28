"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { LockKeyhole } from "lucide-react";

import { getBrowserSupabase, resetBrowserSupabase } from "../_lib/supabaseBrowser";

const SIGN_IN_TIMEOUT_MS = 30_000;

type LoginSession = {
  access_token: string;
  refresh_token: string;
  error?: string;
};

function mapLoginError(status: number, message: string): string {
  const msg = message.toLowerCase();
  if (status === 429 || msg.includes("rate limit") || msg.includes("too many")) {
    return "Слишком много попыток входа — подождите минуту и попробуйте снова";
  }
  if (status === 403) return "У этого аккаунта нет прав администратора";
  if (status === 401 || msg.includes("invalid")) return "Неверный email или пароль";
  if (status === 504 || msg.includes("timeout") || msg.includes("вовремя")) {
    return "Сервер авторизации не ответил вовремя — обновите страницу и попробуйте снова";
  }
  if (msg.includes("network") || msg.includes("fetch") || msg.includes("failed to fetch")) {
    return "Нет связи с сервером — проверьте интернет и попробуйте снова";
  }
  return message.trim() || "Не удалось войти";
}

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const trimmedEmail = email.trim();
    try {
      // Drop hung supabase-js locks from a previous admin session.
      resetBrowserSupabase({ clearStorage: true });

      const loginPromise = fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmedEmail, password }),
      }).then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as LoginSession;
        if (!res.ok) {
          throw new Error(mapLoginError(res.status, data.error || res.statusText || "Не удалось войти"));
        }
        if (!data.access_token || !data.refresh_token) {
          throw new Error("Сервер не вернул сессию");
        }
        return data;
      });

      const timed = await Promise.race([
        loginPromise,
        new Promise<never>((_, reject) => {
          setTimeout(
            () =>
              reject(
                new Error(
                  "Сервер авторизации не ответил вовремя — обновите страницу и попробуйте снова",
                ),
              ),
            SIGN_IN_TIMEOUT_MS,
          );
        }),
      ]);

      const supabase = getBrowserSupabase();
      const { error: setErr } = await supabase.auth.setSession({
        access_token: timed.access_token,
        refresh_token: timed.refresh_token,
      });
      if (setErr) throw new Error(setErr.message || "Не удалось сохранить сессию");

      router.replace("/admin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось войти");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <form
        onSubmit={(ev) => void handleSubmit(ev)}
        className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-6"
      >
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
            <LockKeyhole size={22} strokeWidth={1.8} />
          </span>
          <h1 className="text-lg font-bold text-zinc-900">Админ-панель Harmonizer</h1>
          <p className="text-xs text-zinc-500">Вход только для администратора</p>
        </div>

        <label className="mb-3 block">
          <span className="mb-1 block text-xs text-zinc-400">Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-emerald-500"
          />
        </label>
        <label className="mb-4 block">
          <span className="mb-1 block text-xs text-zinc-400">Пароль</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-emerald-500"
          />
        </label>

        {error ? <p className="mb-3 text-sm text-red-400">{error}</p> : null}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-emerald-500 py-2.5 text-sm font-semibold text-white transition-opacity disabled:opacity-60"
        >
          {busy ? "Входим…" : "Войти"}
        </button>
      </form>
    </div>
  );
}
