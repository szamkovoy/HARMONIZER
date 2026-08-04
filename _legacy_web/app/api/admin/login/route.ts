import { createServiceSupabase, errorResponse, json } from "../../_utils/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PasswordGrant = {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  expires_at?: number;
  token_type?: string;
  user?: { id?: string; email?: string | null };
};

function supabaseUrl(): string {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ||
    process.env.SUPABASE_URL?.trim();
  if (!url) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  return url.replace(/\/$/, "");
}

function anonKey(): string {
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    process.env.SUPABASE_ANON_KEY?.trim();
  if (!key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_ANON_KEY");
  return key;
}

/** Headers for Supabase API keys. New sb_* keys must NOT go in Authorization. */
function apiKeyHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    apikey: apiKey,
    "Content-Type": "application/json",
  };
  if (apiKey.startsWith("eyJ")) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

/**
 * Browser → Supabase Auth password grant can hang at the edge (valid apikey, 0 bytes).
 * Login goes through this Vercel route (path that already reaches GoTrue for /user).
 */
export async function POST(req: Request): Promise<Response> {
  try {
    const body = (await req.json()) as { email?: unknown; password?: unknown };
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!email || !password) {
      return json({ error: "Укажите email и пароль", code: "bad_credentials" }, { status: 400 });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    let grantRes: Response;
    try {
      grantRes = await fetch(`${supabaseUrl()}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: apiKeyHeaders(anonKey()),
        body: JSON.stringify({ email, password }),
        signal: controller.signal,
      });
    } catch (err) {
      const aborted = err instanceof Error && err.name === "AbortError";
      return json(
        {
          error: aborted
            ? "Сервер авторизации не ответил вовремя"
            : "Нет связи с сервером авторизации",
          code: aborted ? "auth_timeout" : "auth_unreachable",
        },
        { status: 504 },
      );
    } finally {
      clearTimeout(timer);
    }

    const grantText = await grantRes.text();
    type GrantPayload = PasswordGrant & {
      error_description?: string;
      msg?: string;
      error?: string;
      error_code?: string;
    };
    let grantJson: GrantPayload | null = null;
    try {
      grantJson = grantText ? (JSON.parse(grantText) as GrantPayload) : null;
    } catch {
      grantJson = null;
    }

    const accessToken = grantJson?.access_token;
    const refreshToken = grantJson?.refresh_token;
    if (!grantRes.ok || !accessToken || !refreshToken) {
      const msg = (
        grantJson?.error_description ||
        grantJson?.msg ||
        grantJson?.error ||
        grantText ||
        ""
      ).toString();
      const lower = msg.toLowerCase();
      const looksLikeBadPassword =
        /invalid (login )?credentials|invalid_grant|wrong password|неверн/.test(lower) ||
        grantJson?.error === "invalid_grant";

      if (grantRes.status === 429) {
        return json(
          { error: "Слишком много попыток входа — подождите минуту", code: "rate_limit" },
          { status: 429 },
        );
      }
      if (looksLikeBadPassword || (grantRes.status === 400 && !msg)) {
        return json(
          { error: "Неверный email или пароль", code: "bad_credentials" },
          { status: 401 },
        );
      }
      // Gateway/HTML/5xx from Auth — not a password typo.
      if (grantRes.status >= 500 || grantRes.status === 502 || grantRes.status === 503) {
        return json(
          {
            error: msg.trim() || "Сервер авторизации временно недоступен",
            code: "auth_unreachable",
          },
          { status: 504 },
        );
      }
      return json(
        {
          error: msg.trim() || "Не удалось войти через Auth",
          code: "server_error",
        },
        { status: grantRes.status >= 400 && grantRes.status < 600 ? grantRes.status : 500 },
      );
    }

    const userId =
      grantJson?.user?.id ||
      (() => {
        try {
          const payload = JSON.parse(
            Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString("utf8"),
          ) as { sub?: string };
          return payload.sub ?? "";
        } catch {
          return "";
        }
      })();
    if (!userId) {
      return json(
        { error: "Не удалось определить пользователя", code: "server_error" },
        { status: 500 },
      );
    }

    const { data: role, error: roleError } = await createServiceSupabase()
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    if (roleError) throw roleError;
    if (!role) {
      return json(
        { error: "У этого аккаунта нет прав администратора", code: "no_admin" },
        { status: 403 },
      );
    }

    return json({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: grantJson?.expires_in ?? null,
      expires_at: grantJson?.expires_at ?? null,
      token_type: grantJson?.token_type ?? "bearer",
      user: {
        id: userId,
        email: grantJson?.user?.email ?? email,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
