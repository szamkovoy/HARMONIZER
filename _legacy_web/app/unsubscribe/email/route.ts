import { createServiceSupabase } from "../../api/_utils/supabase";
import { parseUnsubscribeParam } from "../../api/_utils/emailUnsubscribe";

export const runtime = "nodejs";

function htmlPage(title: string, body: string): Response {
  const doc = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #f4f6f5; color: #1a1a1a;
      display: flex; min-height: 100vh; align-items: center; justify-content: center; margin: 0; }
    .card { background: #fff; padding: 2rem; border-radius: 12px; max-width: 420px;
      box-shadow: 0 8px 30px rgba(0,0,0,.06); text-align: center; }
    h1 { font-size: 1.25rem; margin: 0 0 .75rem; }
    p { margin: 0; color: #4b5563; line-height: 1.5; font-size: .95rem; }
  </style>
</head>
<body><div class="card"><h1>${title}</h1><p>${body}</p></div></body>
</html>`;
  return new Response(doc, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

/** Public marketing opt-out — does not affect app login or membership. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = parseUnsubscribeParam(url.searchParams.get("t"));
  if (!token) {
    return htmlPage("Ссылка недействительна", "Проверьте ссылку из письма или запросите новую.");
  }

  const db = createServiceSupabase();
  const { data: contact } = await db
    .from("email_contacts")
    .select("id, marketing_status")
    .eq("unsubscribe_token", token)
    .maybeSingle();

  if (!contact) {
    return htmlPage("Ссылка недействительна", "Контакт не найден. Возможно, вы уже отписаны.");
  }

  if (contact.marketing_status !== "unsubscribed") {
    await db
      .from("email_contacts")
      .update({
        marketing_status: "unsubscribed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", contact.id);

    // Best-effort campaign counter bump for last related campaign is skipped —
    // unsubscribe is contact-level.
  }

  return htmlPage(
    "Вы отписались",
    "Мы больше не будем присылать маркетинговые письма на этот адрес. Доступ к приложению не изменился.",
  );
}

/** List-Unsubscribe=One-Click */
export async function POST(req: Request) {
  return GET(req);
}
