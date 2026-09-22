/**
 * MSW handlers for mocking external API calls in integration tests
 *
 * This module provides handlers for:
 * - Scryfall API (card search, card lookup)
 * - Custom server endpoints
 * - AI proxy endpoints (issue #2070)
 */

import { http, HttpResponse, delay } from "msw";
import { setupWorker } from "msw/browser";

/**
 * Scryfall API base URL
 */
const SCRYFALL_BASE = "https://api.scryfall.com";

/**
 * AI Proxy endpoint URL
 */
const AI_PROXY_URL = "/api/ai-proxy";

/**
 * Chat API endpoint URL
 */
const CHAT_API_URL = "/api/chat";

/**
 * Mock deck review response for AI proxy
 */
function createMockDeckReviewResponse() {
  return {
    reviewSummary:
      "This is a mock AI deck review. Your deck has good mana curve and synergy.",
    deckOptions: [
      {
        title: "Consider adding more removal",
        description:
          "Your deck lacks interaction. Adding 2-3 more removal spells would improve your matchup against aggressive decks.",
        cardsToAdd: [{ name: "Lightning Bolt", quantity: 2 }],
        cardsToRemove: [{ name: "Hill Giant", quantity: 1 }],
      },
    ],
    archetype: {
      primary: "Aggro-Control",
      confidence: 0.75,
      description:
        "A balanced mid-range strategy with aggressive early plays and late-game control.",
    },
    synergies: {
      present: [
        {
          name: "Mana Acceleration",
          score: 0.85,
          cards: ["Sol Ring", "Arcane Signet"],
          description: "Strong mana base with efficient rocks.",
          category: "mana",
        },
      ],
      missing: [],
    },
  };
}

/**
 * Mock synergy explanation for chat
 */
function createMockSynergyExplanation() {
  return "This card synergizes well with your deck because it provides mana acceleration and fits your color identity. The artifact synergies with your commander's abilities.";
}

/**
 * Handlers for AI Proxy API (issue #2070)
 */
const aiProxyHandlers = [
  // GET /api/ai-proxy - status check
  http.get(AI_PROXY_URL, async () => {
    await delay(50);
    return HttpResponse.json({
      success: true,
      serverProxyEnabled: true,
      configuredProviders: ["openai", "anthropic"],
      availableProviders: ["openai", "anthropic", "google", "zaic"],
    });
  }),

  // POST /api/ai-proxy - non-streaming deck review
  http.post(AI_PROXY_URL, async ({ request }) => {
    await delay(200);

    const body = (await request.json()) as {
      provider?: string;
      endpoint?: string;
      model?: string;
      body?: {
        messages?: Array<{ role: string; content: string }>;
        stream?: boolean;
      };
    };

    // Check if streaming is requested
    const isStreaming = body?.body?.stream === true;

    if (isStreaming) {
      // Return streaming response (text stream format)
      const chunks = [
        '0:"This card synergizes well with your deck\'s mana strategy. "',
        '0:"Consider adding more artifact-based ramp to improve consistency."',
      ];
      const stream = new ReadableStream({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(new TextEncoder().encode(chunk + "\n"));
          }
          controller.close();
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
        },
      });
    }

    // Return non-streaming JSON response
    const reviewData = createMockDeckReviewResponse();
    return HttpResponse.json(
      {
        success: true,
        data: {
          choices: [
            {
              message: {
                role: "assistant",
                content: JSON.stringify(reviewData),
              },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 150,
            completion_tokens: 80,
            total_tokens: 230,
          },
        },
        usage: {
          inputTokens: 150,
          outputTokens: 80,
          totalTokens: 230,
        },
        rateLimit: {
          remaining: 29,
          resetAt: Date.now() + 60000,
        },
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  }),
];

/**
 * Handlers for Chat API (issue #2070)
 * Returns SSE stream in CoachStreamEvent format
 */
const chatApiHandlers = [
  // POST /api/chat - streaming coach response
  http.post(CHAT_API_URL, async () => {
    await delay(100);

    const explanation = createMockSynergyExplanation();
    const events = [
      { type: "provider", value: "openai" },
      { type: "text", value: explanation },
      { type: "done" },
    ];

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        for (const event of events) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
        }
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }),
];

/**
 * Combined AI handlers
 */
export const aiHandlers = [...aiProxyHandlers, ...chatApiHandlers];

/**
 * Create mock Scryfall card data
 */
export function createMockScryfallCard(
  overrides: Partial<{
    id: string;
    oracle_id: string;
    name: string;
    set: string;
    collector_number: string;
    cmc: number;
    type_line: string;
    oracle_text: string;
    colors: string[];
    color_identity: string[];
    rarity: string;
    power: string;
    toughness: string;
  }> = {},
) {
  return {
    id: overrides.id || "mock-card-id-1",
    oracle_id: overrides.oracle_id || "mock-oracle-id-1",
    name: overrides.name || "Mock Card",
    set: overrides.set || "m21",
    collector_number: overrides.collector_number || "1",
    cmc: overrides.cmc || 2,
    type_line: overrides.type_line || "Creature — Human Wizard",
    oracle_text: overrides.oracle_text || "{T}: Draw a card.",
    colors: overrides.colors || ["U"],
    color_identity: overrides.color_identity || ["U"],
    rarity: overrides.rarity || "rare",
    power: overrides.power || "2",
    toughness: overrides.toughness || "2",
    legalities: {
      standard: "legal",
      modern: "legal",
      legacy: "legal",
      vintage: "legal",
      commander: "legal",
    },
    image_uris: {
      small: "https://cards.scryfall.io/small/front/m/o/mock-card-id-1.jpg",
      normal: "https://cards.scryfall.io/normal/front/m/o/mock-card-id-1.jpg",
      large: "https://cards.scryfall.io/large/front/m/o/mock-card-id-1.jpg",
      png: "https://cards.scryfall.io/png/front/m/o/mock-card-id-1.png",
      art_crop:
        "https://cards.scryfall.io/art_crop/front/m/o/mock-card-id-1.jpg",
      border_crop:
        "https://cards.scryfall.io/border_crop/front/m/o/mock-card-id-1.jpg",
    },
    mana_cost: "{2U}",
    flavor_text: "A mock card for testing.",
    artist: "Mock Artist",
  };
}

/**
 * Create a search response for Scryfall
 */
export function createMockSearchResponse(
  cards: ReturnType<typeof createMockScryfallCard>[],
  _query: string,
) {
  return {
    object: "search",
    total_cards: cards.length,
    has_more: false,
    data: cards,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/**
 * Handlers for Scryfall API
 */
export const scryfallHandlers = [
  // Card search endpoint
  http.get(`${SCRYFALL_BASE}/cards/search`, async ({ request }) => {
    await delay(100);

    const url = new URL(request.url);
    const query = url.searchParams.get("q") || "";

    // Return mock cards based on query
    const mockCards = [
      createMockScryfallCard({
        name: "Lightning Bolt",
        set: "m12",
        cmc: 1,
        type_line: "Instant",
        oracle_text: "Lightning Bolt deals 3 damage to any target.",
        colors: ["R"],
        rarity: "common",
      }),
      createMockScryfallCard({
        name: "Counterspell",
        set: "mh2",
        cmc: 2,
        type_line: "Instant",
        oracle_text: "Counter target spell.",
        colors: ["U"],
        rarity: "common",
      }),
      createMockScryfallCard({
        name: "Brainstorm",
        set: "ice",
        cmc: 1,
        type_line: "Instant",
        oracle_text:
          "Draw three cards, then put two cards from your hand on top of your library.",
        colors: ["U"],
        rarity: "common",
      }),
    ];

    return HttpResponse.json(createMockSearchResponse(mockCards, query));
  }),

  // Card lookup by name
  http.get(`${SCRYFALL_BASE}/cards/named`, async ({ request }) => {
    await delay(100);

    const url = new URL(request.url);
    const name =
      url.searchParams.get("exact") || url.searchParams.get("fuzzy") || "";

    const mockCard = createMockScryfallCard({ name });
    return HttpResponse.json(mockCard);
  }),

  // Card lookup by ID
  http.get(`${SCRYFALL_BASE}/cards/:id`, async ({ params }) => {
    await delay(100);

    const mockCard = createMockScryfallCard({ id: params.id as string });
    return HttpResponse.json(mockCard);
  }),

  // Random card
  http.get(`${SCRYFALL_BASE}/cards/random`, async () => {
    await delay(100);

    const mockCard = createMockScryfallCard();
    return HttpResponse.json(mockCard);
  }),

  // Set search
  http.get(`${SCRYFALL_BASE}/sets/:code`, async ({ params }) => {
    await delay(100);

    return HttpResponse.json({
      object: "set",
      id: `set-${params.code}`,
      code: params.code,
      name: `Mock Set ${params.code}`,
      released_at: "2024-01-01",
      card_count: 100,
      set_type: "expansion",
    });
  }),
];

/**
 * Default handlers array - export all handlers
 */
export const handlers = [...scryfallHandlers, ...aiHandlers];

/**
 * Create the MSW worker for browser
 */
export function createWorker() {
  return setupWorker(...handlers);
}

export { http, HttpResponse, delay, setupWorker };
