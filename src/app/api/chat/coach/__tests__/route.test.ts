/**
 * @jest-environment node
 */
import { POST } from "../route";
import { clearCoachContextCache } from "@/ai/flows/coach-context-prefetch";

// Capture the input handed to the coach flow so we can assert the route builds
// and forwards a STRUCTURED deck analysis (issue #923) instead of raw cards,
// and that the analysis is PRE-FETCHED before the flow runs (issue #928).
let lastFlowInput: Record<string, unknown> | undefined;

jest.mock("@/ai/flows/genkit-coach-flow", () => ({
  coachFlow: {
    stream: (input: Record<string, unknown>) => {
      lastFlowInput = input;
      return (async function* () {
        yield { content: [{ text: "ok" }] };
      })();
    },
  },
}));

// Next's NextResponse.json depends on the static Response.json web spec method,
// which is absent in some jest node environments. Provide a minimal stub so the
// route's error branches don't blow up — we only assert the success path here.
jest.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    }),
  },
}));

/** Minimal request double — the route only calls `await request.json()`. */
function buildRequest(body: unknown): any {
  return {
    json: async () => body,
  };
}

async function readStream(response: Response): Promise<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

const deckCards = [
  {
    id: "llanowar-elves",
    name: "Llanowar Elves",
    cmc: 1,
    type_line: "Creature — Elf Druid",
    colors: ["G"],
    color_identity: ["G"],
    legalities: {},
    count: 4,
    oracle_text: "Tap: Add G.",
  },
  {
    id: "forest",
    name: "Forest",
    cmc: 0,
    type_line: "Basic Land — Forest",
    colors: [],
    color_identity: ["G"],
    legalities: {},
    count: 20,
  },
];

describe("POST /api/chat/coach — structured analysis wiring (#923)", () => {
  beforeEach(() => {
    lastFlowInput = undefined;
    clearCoachContextCache();
  });

  afterEach(() => {
    clearCoachContextCache();
  });

  it("builds a structured deck analysis and forwards it to the coach flow", async () => {
    const res = await POST(
      buildRequest({
        messages: [{ id: "1", role: "user", content: "analyze my deck" }],
        deckCards,
        format: "commander",
      }),
    );

    expect(res.status).toBe(200);
    await readStream(res);

    expect(lastFlowInput).toBeDefined();
    expect(lastFlowInput).toHaveProperty("structuredAnalysis");
    const analysis = lastFlowInput!.structuredAnalysis as string;
    expect(typeof analysis).toBe("string");
    expect(analysis).toContain("### Structured Deck Analysis");
    expect(analysis).toContain("**Archetype**");
    expect(analysis).toContain("**Mana Curve**");
    expect(analysis).toContain("**Role Mix**");
    // The raw deck is still passed for the search tool, but the PRIMARY context
    // the coach reasons about is the structured analysis, not a card list.
    expect(lastFlowInput!.deckCards).toEqual(deckCards);
  });

  it("pre-fetches context before invoking the flow and serves repeats from cache (#928)", async () => {
    // First request: pre-fetch computes + populates the cache.
    await POST(
      buildRequest({
        messages: [{ id: "1", role: "user", content: "analyze" }],
        deckCards,
        format: "commander",
      }),
    );
    expect(lastFlowInput!.structuredAnalysis).toBeDefined();

    // Second request for the SAME deck: the analysis is still forwarded, served
    // from the pre-fetch cache (no re-computation path difference observable
    // here, but the structured analysis must remain present and stable).
    await POST(
      buildRequest({
        messages: [{ id: "2", role: "user", content: "what should I cut?" }],
        deckCards,
        format: "commander",
      }),
    );
    expect(lastFlowInput!.structuredAnalysis).toBeDefined();
    expect(lastFlowInput!.structuredAnalysis).toContain(
      "### Structured Deck Analysis",
    );
  });

  it("omits structuredAnalysis when no deck cards are supplied", async () => {
    const res = await POST(
      buildRequest({
        messages: [{ id: "1", role: "user", content: "hi" }],
        digestedContext: {
          deckSummary: {
            totalCards: 60,
            typeCounts: { Creature: 20 },
            averageCmc: 2.5,
            keyCards: ["Sol Ring"],
            manaCurve: [0, 10, 10, 10, 10, 10, 5, 5],
            colors: ["G"],
          },
          timestamp: Date.now(),
        },
        format: "commander",
      }),
    );

    expect(res.status).toBe(200);
    await readStream(res);

    expect(lastFlowInput).toBeDefined();
    expect(lastFlowInput!.structuredAnalysis).toBeUndefined();
  });
});
