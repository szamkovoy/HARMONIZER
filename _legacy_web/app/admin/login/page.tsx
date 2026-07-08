"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { LockKeyhole } from "lucide-react";

import { adminFetch } from "../_lib/adminApi";
import { getBrowserSupabase } from "../_lib/supabaseBrowser";

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
    try {
      const supabase = getBrowserSupabase();
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) throw new Error("Неверный email или пароль");
      // Логин успешен, но в админку пускаем только роль admin.
      try {
        await adminFetch("/api/admin/me");
      } catch {
        await supabase.auth.signOut();
        throw new Error("У этого аккаунта нет прав администратора");
      }
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
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-2xl border border-white/10 bg-[rgba(30,32,38,0.92)] p-6"
      >
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-400/10 text-emerald-300">
            <LockKeyhole size={22} strokeWidth={1.8} />
          </span>
          <h1 className="text-lg font-bold text-zinc-100">Админ-панель Harmonizer</h1>
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
            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-400/50"
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
            className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-400/50"
          />
        </label>

        {error ? <p className="mb-3 text-sm text-red-400">{error}</p> : null}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-xl bg-emerald-500 py-2.5 text-sm font-semibold text-emerald-950 transition-opacity disabled:opacity-60"
        >
          {busy ? "Входим…" : "Войти"}
        </button>
      </form>
    </div>
  );
}
