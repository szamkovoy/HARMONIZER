import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  eventLogInserts: [] as unknown[],
  practices: [
    {
      id: "practice-1",
      slug: "asana-ajna",
      title: { ru: "Практика на Аджну" },
      description: { ru: "Мягкая практика." },
      kind: "yoga",
      default_duration_sec: 20 * 60,
      min_duration_sec: 20 * 60,
      max_duration_sec: 20 * 60,
      rating: 5,
      params: { recorded_at: "2024-01-01" },
      video_external_id: "123",
      practice_chakras: [{ chakra_id: 6, weight: 1 }],
    },
  ],
}));

function practiceQuery() {
  const query = {
    select: () => query,
    eq: () => query,
    order: () => query,
    limit: () => query,
    then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve({ data: mocks.practices, error: null }).then(resolve, reject),
  };
  return query;
}

function sessionQuery() {
  return {
    select: () => ({
      eq: () => ({
        not: () => ({
          order: () => ({
            limit: () => Promise.resolve({ data: [], error: null }),
          }),
        }),
      }),
    }),
  };
}

function eventLogQuery() {
  return {
    insert: (value: unknown) => {
      mocks.eventLogInserts.push(value);
      return Promise.resolve({ error: null });
    },
  };
}

vi.mock("../../../_utils/supabase", () => ({
  createServiceSupabase: () => ({
    from: (table: string) => {
      if (table === "practices") return practiceQuery();
      if (table === "practice_sessions") return sessionQuery();
      if (table === "user_event_log") return eventLogQuery();
      throw new Error(`Unexpected table ${table}`);
    },
  }),
  requireUserId: () => Promise.resolve("user1"),
  json: (body: unknown, init?: ResponseInit) => Response.json(body, init),
  errorResponse: (error: unknown) =>
    Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 }),
}));

import { POST } from "./route";

describe("communicator v2 select-practice wrapper", () => {
  it("returns the shared practicePicked payload with launch params", async () => {
    mocks.eventLogInserts.length = 0;

    const response = await POST(
      new Request("https://example.test/api/communicator/v2/select-practice", {
        method: "POST",
        body: JSON.stringify({
          planetOfTheDay: "Mercury",
          reason: "Нужен ясный фокус.",
        }),
      }),
    );
    const body = (await response.json()) as {
      practicePicked?: {
        id: string;
        name: string;
        reason?: string;
        launch?: {
          route: string;
          params: Record<string, string>;
        };
      };
      stack?: Array<{ id: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.practicePicked).toMatchObject({
      id: "practice-1",
      name: "Практика на Аджну",
      reason: "Нужен ясный фокус.",
      launch: {
        route: "/asana-practice",
        params: {
          practiceId: "practice-1",
          durationMs: String(20 * 60 * 1000),
          chakra: "6",
          launchSource: "assistant",
        },
      },
    });
    expect(body.stack?.map((practice) => practice.id)).toContain("practice-1");
    expect(mocks.eventLogInserts).toHaveLength(1);
  });
});
