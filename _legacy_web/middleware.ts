import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * CORS для временного Prompt Studio. Стенд защищён Bearer-токеном (PROMPT_STUDIO_TOKEN),
 * поэтому для префлайта отражаем любой Origin — страница может быть размещена на любом домене
 * (zamkovoi.yoga, zamkovoy.yoga, localhost и т.д.). Для не-OPTIONS запросов CORS-заголовки
 * ставит сам route-хендлер (чтобы избежать дублирования).
 */
export function middleware(request: NextRequest) {
  if (request.method === "OPTIONS") {
    const origin = request.headers.get("origin") ?? "*";
    return new NextResponse(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Max-Age": "86400",
        Vary: "Origin",
      },
    });
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/api/ai/prompt-studio",
};
