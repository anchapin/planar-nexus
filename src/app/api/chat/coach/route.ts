import { NextRequest, NextResponse } from "next/server";
import { coachFlow } from "@/ai/flows/genkit-coach-flow";
import type { DeckCard } from "@/app/actions";
import {
  buildStructuredDeckAnalysis,
  formatStructuredAnalysisForLLM,
} from "@/ai/flows/coach-deck-analysis";

/**
 * API Route for the Conversational AI Coach using Genkit.
 *
 * NOTE: The Genkit dependency was removed in Issue #446. The coach flow
 * is currently a stub that returns an unavailability message. This route
 * still validates input and streams the stub response for forward
 * compatibility — when Genkit is re-added, this route will work as-is.
 */

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    // 1. Parse request body
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid JSON body" },
        { status: 400 },
      );
    }

    const { messages, deckCards, digestedContext, format } = body;

    // 2. Validate required fields
    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { success: false, error: "Messages are required and must be an array" },
        { status: 400 },
      );
    }

    if (!deckCards && !digestedContext) {
      return NextResponse.json(
        {
          success: false,
          error: "Either deckCards or digestedContext is required",
        },
        { status: 400 },
      );
    }

    if (!format) {
      return NextResponse.json(
        { success: false, error: "Format is required" },
        { status: 400 },
      );
    }

    // 3. Build a STRUCTURED deck analysis (issue #923) so the coach reasons
    //    about archetype, synergy clusters, curve and roles instead of a raw
    //    card-by-card list. When the client already supplied a digested context
    //    we keep it, but enrich with structured analysis whenever raw cards are
    //    available.
    let structuredAnalysis: string | undefined;
    if (deckCards && Array.isArray(deckCards) && deckCards.length > 0) {
      try {
        const analysis = buildStructuredDeckAnalysis(deckCards as DeckCard[]);
        structuredAnalysis = formatStructuredAnalysisForLLM(analysis);
      } catch (error) {
        console.error("Structured deck analysis failed:", error);
      }
    }

    // 4. Execute the coach flow (currently a stub — streams an unavailability message)
    const stream = coachFlow.stream({
      messages,
      deckCards: deckCards || undefined,
      digestedContext: digestedContext || undefined,
      structuredAnalysis,
      format,
      archetype: body.archetype,
      strategy: body.strategy,
      provider: body.provider,
      modelId: body.modelId,
    });

    // 5. Create a ReadableStream to pipe chunks to the client
    const responseStream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        try {
          for await (const chunk of stream) {
            if (chunk.content) {
              const text = chunk.content
                .map((c: { text: string }) => c.text || "")
                .join("");
              if (text) {
                controller.enqueue(encoder.encode(text));
              }
            }
          }
          controller.close();
        } catch (error) {
          console.error("Streaming error:", error);
          controller.error(error);
        }
      },
    });

    return new Response(responseStream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
      },
    });
  } catch (error) {
    console.error("Conversational Coach API error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
