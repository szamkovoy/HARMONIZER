import { describe, expect, it } from "vitest";

import {
  choosePractice,
  publicPracticePickedPayload,
  resolvePracticeKeyToCatalogId,
  shouldStayInPracticeSuggestion,
  type PracticeCandidate,
} from "@legacy/app/api/communicator/v2/dialog/practiceSelection";
import type { MessageRecord } from "@legacy/app/api/communicator/v2/dialog/dialogHelpers";

function yoga(input: Partial<PracticeCandidate> & Pick<PracticeCandidate, "id">): PracticeCandidate {
  const { id, ...rest } = input;
  return {
    id,
    slug: input.slug ?? id,
    title: { ru: id },
    description: null,
    kind: "yoga",
    default_duration_sec: 20 * 60,
    min_duration_sec: 20 * 60,
    max_duration_sec: 20 * 60,
    rating: 3,
    params: {},
    video_external_id: null,
    practice_chakras: [{ chakra_id: 6, weight: 1 }],
    ...rest,
  };
}

function breath(input: Partial<PracticeCandidate> & Pick<PracticeCandidate, "id" | "slug">): PracticeCandidate {
  return {
    id: input.id,
    slug: input.slug,
    title: { ru: input.slug },
    description: null,
    kind: "breath",
    default_duration_sec: 10 * 60,
    min_duration_sec: 5 * 60,
    max_duration_sec: 20 * 60,
    rating: 5,
    params: {},
    video_external_id: null,
    practice_chakras: [],
    ...input,
  };
}

function createPracticeQuery(practices: PracticeCandidate[]) {
  const filters: Record<string, unknown> = {};
  const query = {
    select: () => query,
    eq: (column: string, value: unknown) => {
      filters[column] = value;
      return query;
    },
    order: () => query,
    limit: () => query,
    then: (
      resolve: (value: { data: PracticeCandidate[]; error: null }) => unknown,
      reject?: (reason: unknown) => unknown,
    ) =>
      Promise.resolve({
        data: practices.filter((practice) => !filters.kind || practice.kind === filters.kind),
        error: null,
      }).then(resolve, reject),
  };
  return query;
}

function createSessionQuery(rows: Array<{ practice_id: string | null; practice_slug: string; practices?: { kind?: string } | null }>) {
  return {
    select: () => ({
      eq: () => ({
        not: () => ({
          order: () => ({
            limit: () => Promise.resolve({ data: rows, error: null }),
          }),
        }),
      }),
    }),
  };
}

function createDb(params: {
  practices: PracticeCandidate[];
  recentSessions?: Array<{ practice_id: string | null; practice_slug: string; practices?: { kind?: string } | null }>;
}) {
  return {
    from: (table: string) => {
      if (table === "practices") return createPracticeQuery(params.practices);
      if (table === "practice_sessions") return createSessionQuery(params.recentSessions ?? []);
      throw new Error(`Unexpected table ${table}`);
    },
  };
}

describe("resolvePracticeKeyToCatalogId", () => {
  it("maps slug or id hint to the catalog row id", () => {
    const catalog: PracticeCandidate[] = [
      breath({ id: "uuid-99", slug: "square", practice_chakras: [{ chakra_id: 1, weight: 1 }] }),
    ];
    expect(resolvePracticeKeyToCatalogId("square", catalog)).toBe("uuid-99");
    expect(resolvePracticeKeyToCatalogId("uuid-99", catalog)).toBe("uuid-99");
    expect(resolvePracticeKeyToCatalogId("unknown", catalog)).toBe(null);
  });
});

describe("choosePractice", () => {
  it("maps slug-only completed sessions to catalog ids for exclusion", async () => {
    const catalog: PracticeCandidate[] = [
      breath({ id: "breath-uuid-a", slug: "br-a", practice_chakras: [{ chakra_id: 2, weight: 1 }] }),
      breath({ id: "breath-uuid-b", slug: "br-b", practice_chakras: [{ chakra_id: 2, weight: 1 }] }),
    ];
    const picked = await choosePractice(
      createDb({
        practices: catalog,
        recentSessions: [{ practice_id: null, practice_slug: "br-a", practices: { kind: "breath" } }],
      }) as never,
      "user1",
      { id: "br-a", reason: "дыхание", durationMin: 10, chakra: 2 },
      { forecast: { planet_of_the_day: "Venus" } },
      "Дыхание 10 минут",
      [],
    );
    expect(picked && "picked" in picked ? picked.picked?.id : null).toBe("breath-uuid-b");
    expect(picked && "picked" in picked ? picked.markerIdResolved : null).toBe(false);
  });

  it("uses Supabase data, recent sessions and offered history to return a launchable recommendation", async () => {
    const picked = await choosePractice(
      createDb({
        practices: [
          yoga({ id: "recent-best", rating: 5, params: { recorded_at: "2022-01-01" } }),
          yoga({ id: "offered-best", rating: 5, params: { recorded_at: "2022-01-02" } }),
          yoga({ id: "fresh-best", rating: 4, params: { recorded_at: "2022-01-03" }, video_external_id: "v123" }),
          yoga({ id: "wrong-chakra", rating: 5, practice_chakras: [{ chakra_id: 4, weight: 1 }] }),
        ],
        recentSessions: [{ practice_id: "recent-best", practice_slug: "recent-best", practices: { kind: "yoga" } }],
      }) as never,
      "user1",
      null,
      { forecast: { planet_of_the_day: "Mercury" } },
      "Хочу асаны на 20 минут",
      [
        {
          id: "m1",
          role: "assistant",
          content: "Попробуй это",
          transcript: null,
          meta: { practice_picked: { id: "offered-best" } },
          created_at: null,
        } satisfies MessageRecord,
      ],
    );

    expect(picked?.picked?.id).toBe("fresh-best");
    expect(picked?.picked?.launch).toEqual({
      route: "/asana-practice",
      params: {
        practiceId: "fresh-best",
        durationMs: String(20 * 60 * 1000),
        chakra: "6",
        launchSource: "assistant",
      },
    });
    expect(publicPracticePickedPayload(picked!.picked!, "потому что сейчас нужен фокус")).toMatchObject({
      id: "fresh-best",
      reason: "потому что сейчас нужен фокус",
      video: {
        provider: "vimeo",
      },
    });
  });

  it("preserves a stored thumbnail from practice params", async () => {
    const picked = await choosePractice(
      createDb({
        practices: [
          yoga({
            id: "with-thumb",
            video_external_id: "vimeo-1",
            params: {
              video_thumbnail: {
                url: "https://i.vimeocdn.com/video/test_295x166.jpg",
                width: 295,
                height: 166,
              },
            },
          }),
        ],
      }) as never,
      "user1",
      null,
      { forecast: { planet_of_the_day: "Mercury" } },
      "Хочу асану",
      [],
    );

    expect(publicPracticePickedPayload(picked!.picked!)).toMatchObject({
      id: "with-thumb",
      video: {
        provider: "vimeo",
        externalId: "vimeo-1",
        thumbnail: {
          url: "https://i.vimeocdn.com/video/test_295x166.jpg",
          width: 295,
          height: 166,
        },
      },
    });
  });

  it("can recommend the static meditation when it is not present in Supabase yet", async () => {
    const picked = await choosePractice(
      createDb({
        practices: [],
      }) as never,
      "user1",
      null,
      { forecast: { planet_of_the_day: "Mercury" } },
      "Хочу медитацию на 5 минут",
      [],
    );

    expect(picked?.picked).toMatchObject({
      id: "meditation:sacred-symbol-stream",
      slug: "sacred-symbol-stream",
      name: "Вспышка",
      kind: "meditation",
      durationSec: 5 * 60,
      chakraIds: [6, 7],
      launch: {
        route: "/sacred-symbol-stream",
        params: {
          durationMs: String(5 * 60 * 1000),
          chakra: "6",
          launchSource: "assistant",
        },
      },
    });
  });

  it("resolves explicit marker id against full catalog when inferred user kind matches breath", async () => {
    const picked = await choosePractice(
      createDb({
        practices: [
          breath({ id: "uuid-coh", slug: "coherent" }),
          yoga({ id: "uuid-yoga", slug: "triangle-pose" }),
          {
            id: "uuid-med",
            slug: "body-scan",
            kind: "meditation",
            title: { ru: "скан" },
            description: null,
            default_duration_sec: 10 * 60,
            min_duration_sec: null,
            max_duration_sec: null,
            rating: 4,
            params: {},
            video_external_id: null,
            practice_chakras: [{ chakra_id: 1, weight: 1 }],
          },
        ],
      }) as never,
      "user1",
      { id: "coherent", reason: "дыхание", durationMin: 15, chakra: 2 },
      { forecast: { planet_of_the_day: "Venus" } },
      "Дыхание 15 минут, вторая чакра",
      [],
    );

    expect(picked && "picked" in picked ? picked.markerIdResolved : null).toBe(true);
    expect(picked && "picked" in picked ? picked.picked?.slug : null).toBe("coherent");
    expect(picked && "picked" in picked ? picked.picked?.kind : null).toBe("breath");
  });

  it("drops explicit marker id when confident history kind contradicts marker practice kind", async () => {
    const picked = await choosePractice(
      createDb({
        practices: [
          breath({ id: "uuid-coh", slug: "coherent" }),
          {
            id: "uuid-med",
            slug: "body-scan",
            kind: "meditation",
            title: { ru: "скан" },
            description: null,
            default_duration_sec: 10 * 60,
            min_duration_sec: null,
            max_duration_sec: null,
            rating: 4,
            params: {},
            video_external_id: null,
            practice_chakras: [{ chakra_id: 1, weight: 1 }],
          },
        ],
      }) as never,
      "user1",
      { id: "coherent", reason: "дыхание", durationMin: 10, chakra: 2 },
      { forecast: { planet_of_the_day: "Venus" } },
      "Медитация 5 минут",
      [],
    );

    expect(picked && "picked" in picked ? picked.picked?.kind : null).toBe("meditation");
    expect(picked && "picked" in picked ? picked.markerIdResolved : null).toBeUndefined();
    expect(picked && "picked" in picked ? picked.historyKindConflictResolved : null).toBe(true);
  });

  it("ignores explicit marker when that breath was just offered — picks another breath from the fresh stack", async () => {
    const seven = [0, 1, 2, 3, 4, 5, 6].map((i) =>
      breath({
        id: `breath-id-${i}`,
        slug: `br-${i}`,
        practice_chakras: [{ chakra_id: 2, weight: 1 }],
      }),
    );
    const picked = await choosePractice(
      createDb({ practices: seven }) as never,
      "user1",
      { id: "br-0", reason: "дыхание", durationMin: 15, chakra: 2 },
      { forecast: { planet_of_the_day: "Venus" } },
      "Дыхание 15 минут, вторая чакра",
      [
        {
          id: "m-prev",
          role: "assistant",
          content: "Предыдущее предложение",
          transcript: null,
          meta: { practice_picked: { id: "breath-id-0" } },
          created_at: null,
        } satisfies MessageRecord,
      ],
    );

    expect(picked && "picked" in picked ? picked.picked?.id : null).toBe("breath-id-1");
    expect(picked && "picked" in picked ? picked.picked?.kind : null).toBe("breath");
    expect(picked && "picked" in picked ? picked.markerIdResolved : null).toBe(false);
  });

  it("does not let slug-only breath sessions exhaust the meditation recent stack", async () => {
    const picked = await choosePractice(
      createDb({
        practices: [],
        recentSessions: [
          { practice_id: null, practice_slug: "coherent", practices: null },
          { practice_id: null, practice_slug: "nadi-shodhana", practices: null },
        ],
      }) as never,
      "user1",
      null,
      { forecast: { planet_of_the_day: "Mercury" } },
      "Хочу медитацию на 5 минут",
      [],
    );

    expect(picked?.picked?.id).toBe("meditation:sacred-symbol-stream");
  });
});

describe("practice suggestion phase guard", () => {
  const historyWithPracticeOffer: MessageRecord[] = [
    {
      id: "m1",
      role: "assistant",
      content: "Вот практика",
      transcript: null,
      meta: { practice_picked: { id: "practice-1" } },
      created_at: null,
    },
  ];

  it("keeps daily dialog in suggest_practice when user rejects the last offer", () => {
    expect(
      shouldStayInPracticeSuggestion({
        useCase: "daily_dialog",
        history: historyWithPracticeOffer,
        userMessage: "Не подходит, давай другую практику",
      }),
    ).toBe(true);
  });

  it("does not force suggest_practice for generic replies or non-daily use cases", () => {
    expect(
      shouldStayInPracticeSuggestion({
        useCase: "daily_dialog",
        history: historyWithPracticeOffer,
        userMessage: "Расскажи подробнее, почему это важно",
      }),
    ).toBe(false);
    expect(
      shouldStayInPracticeSuggestion({
        useCase: "calibration",
        history: historyWithPracticeOffer,
        userMessage: "Хочу другую",
      }),
    ).toBe(false);
  });

  it("still treats a replace request as practice-suggestion after a short follow-up assistant turn", () => {
    expect(
      shouldStayInPracticeSuggestion({
        useCase: "daily_dialog",
        history: [
          ...historyWithPracticeOffer,
          {
            id: "m2",
            role: "assistant",
            content: "Хорошего дня.",
            transcript: null,
            meta: { turn_mode: "post_recommendation" },
            created_at: null,
          },
        ],
        userMessage: "Дай другую практику",
      }),
    ).toBe(true);
  });
});
