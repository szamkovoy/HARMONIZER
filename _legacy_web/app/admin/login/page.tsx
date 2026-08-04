"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { LockKeyhole } from "lucide-react";

import {
  applyAdminServerSession,
  resetBrowserSupabase,
  type AdminServerSession,
} from "../_lib/supabaseBrowser";

const SIGN_IN_TIMEOUT_MS = 30_000;

type LoginCode =
  | "bad_credentials"
  | "no_admin"
  | "rate_limit"
  | "auth_timeout"
  | "auth_unreachable"
  | "session_apply_failed"
  | "server_error"
  | "unknown";

type LoginErrorBody = {
  error?: string;
  code?: LoginCode;
};

function classifyClientError(status: number, body: LoginErrorBody, rawFallback: string): {
  code: LoginCode;
  message: string;
} {
  if (body.code) {
    return {
      code: body.code,
      message: body.error?.trim() || messageForCode(body.code),
    };
  }
  const msg = (body.error || rawFallback || "").toLowerCase();
  if (status === 429 || msg.includes("rate limit") || msg.includes("too many")) {
    return { code: "rate_limit", message: messageForCode("rate_limit") };
  }
  if (status === 403) return { code: "no_admin", message: messageForCode("no_admin") };
  if (status === 504 || msg.includes("timeout") || msg.includes("вовремя")) {
    return { code: "auth_timeout", message: messageForCode("auth_timeout") };
  }
  if (
    msg.includes("нет связи") ||
    msg.includes("network") ||
    msg.includes("fetch") ||
    msg.includes("failed to fetch")
  ) {
    return { code: "auth_unreachable", message: messageForCode("auth_unreachable") };
  }
  if (status === 401) {
    return { code: "bad_credentials", message: messageForCode("bad_credentials") };
  }
  return {
    code: "server_error",
    message: body.error?.trim() || rawFallback || messageForCode("server_error"),
  };
}

function messageForCode(code: LoginCode): string {
  switch (code) {
    case "bad_credentials":
      return "Неверный email или пароль";
    case "no_admin":
      return "У этого аккаунта нет прав администратора";
    case "rate_limit":
      return "Слишком много попыток входа — подождите минуту и попробуйте снова";
    case "auth_timeout":
      return "Сервер авторизации не ответил вовремя (Auth «завис»). Нажмите кнопку ниже — система попробует восстановить связь.";
    case "auth_unreachable":
      return "Нет связи с сервером авторизации. Нажмите кнопку ниже, чтобы восстановить связь и войти снова.";
    case "session_apply_failed":
      return "Пароль принят, но сессию в браузере применить не удалось. Нажмите кнопку ниже для очистки и повторного входа.";
    case "server_error":
      return "Ошибка сервера при входе. Нажмите кнопку ниже или попробуйте через минуту.";
    default:
      return "Не удалось войти";
  }
}

function needsRecovery(code: LoginCode): boolean {
  return (
    code === "auth_timeout" ||
    code === "auth_unreachable" ||
    code === "session_apply_failed" ||
    code === "server_error"
  );
}

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<LoginCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [recoverHint, setRecoverHint] = useState<string | null>(null);

  async function attemptLogin(): Promise<void> {
    setError(null);
    setErrorCode(null);
    setRecoverHint(null);
    setBusy(true);
    const trimmedEmail = email.trim();
    try {
      resetBrowserSupabase({ clearStorage: true });

      const loginPromise = fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmedEmail, password }),
      }).then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as AdminServerSession & LoginErrorBody;
        if (!res.ok) {
          const classified = classifyClientError(res.status, data, res.statusText || "Не удалось войти");
          const err = new Error(classified.message) as Error & { code?: LoginCode };
          err.code = classified.code;
          throw err;
        }
        if (!data.access_token || !data.refresh_token || !data.user?.id) {
          const err = new Error("Сервер не вернул сессию") as Error & { code?: LoginCode };
          err.code = "server_error";
          throw err;
        }
        return data;
      });

      const timed = await Promise.race([
        loginPromise,
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            const err = new Error(messageForCode("auth_timeout")) as Error & { code?: LoginCode };
            err.code = "auth_timeout";
            reject(err);
          }, SIGN_IN_TIMEOUT_MS);
        }),
      ]);

      try {
        await applyAdminServerSession(timed);
      } catch (applyErr) {
        const err = new Error(
          applyErr instanceof Error ? applyErr.message : messageForCode("session_apply_failed"),
        ) as Error & { code?: LoginCode };
        err.code = "session_apply_failed";
        throw err;
      }
      router.replace("/admin");
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? ((err as { code?: LoginCode }).code ?? "unknown")
          : "unknown";
      const raw = err instanceof Error ? err.message : "Не удалось войти";
      const classified =
        code !== "unknown"
          ? { code, message: raw }
          : classifyClientError(0, { error: raw }, raw);
      setErrorCode(classified.code);
      setError(classified.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    await attemptLogin();
  }

  async function handleRecoverAndLogin() {
    setBusy(true);
    setRecoverHint("Проверяем связь с Auth…");
    try {
      resetBrowserSupabase({ clearStorage: true });
      const health = await fetch("/api/admin/login/health", { method: "GET" })
        .then(async (res) => {
          const data = (await res.json().catch(() => ({}))) as {
            ok?: boolean;
            hint?: string;
          };
          return { ok: res.ok && data.ok !== false, hint: data.hint };
        })
        .catch(() => ({ ok: false, hint: "Не удалось выполнить проверку связи" }));

      setRecoverHint(health.hint ?? (health.ok ? "Связь есть — входим…" : "Связь нестабильна — пробуем войти…"));
      // Короткий backoff после wake, затем повторный вход с теми же полями.
      await new Promise((r) => setTimeout(r, health.ok ? 400 : 1500));
    } finally {
      setBusy(false);
    }
    await attemptLogin();
  }

  const recovery = errorCode ? needsRecovery(errorCode) : false;

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

        {error ? <p className="mb-3 text-sm text-red-500">{error}</p> : null}
        {recoverHint ? <p className="mb-3 text-xs text-zinc-500">{recoverHint}</p> : null}

        {recovery ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleRecoverAndLogin()}
            className="w-full rounded-xl bg-amber-500 py-2.5 text-sm font-semibold text-white transition-opacity disabled:opacity-60"
          >
            {busy ? "Восстанавливаем…" : "Восстановить связь и войти"}
          </button>
        ) : (
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-emerald-500 py-2.5 text-sm font-semibold text-white transition-opacity disabled:opacity-60"
          >
            {busy ? "Входим…" : "Войти"}
          </button>
        )}
      </form>
    </div>
  );
}
