import { streamText } from 'ai';
import { getAIModel } from '@/ai/providers/factory';
import { searchCardsTool } from '@/ai/tools/card-search';

// Use force-dynamic to prevent response buffering
export const dynamic = 'force-dynamic';

/**
 * Unified Chat API Route
 * 
 * Supports streaming from multiple providers via the Vercel AI SDK.
 * 
 * POST /api/chat
 * Body: { messages: [], provider: 'openai' | 'anthropic' | 'google', modelId?: string }
 */
export async function POST(req: Request) {
  try {
    const { messages, provider, modelId } = await req.json();

    if (!messages || !Array.isArray(messages)) {
      return new Response(
        JSON.stringify({ error: 'Missing or invalid messages' }), 
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Default to openai if not specified
    const selectedProvider = provider || 'openai';
    
    // Get the model instance from our factory
    const model = getAIModel(selectedProvider, modelId);

    // Create a streaming response using Vercel AI SDK
    const result = streamText({
      model,
      messages,
      tools: {
        searchCards: searchCardsTool,
      },
      // Automatically execute server-side tools
      maxSteps: 5,
    });

    // Return the stream as a Data Stream (SSE)
    return result.toDataStreamResponse();
  } catch (error: any) {
    console.error('Chat API Error:', error);
    
    // Return a structured error response
    return new Response(
      JSON.stringify({ 
        error: error.message || 'An internal error occurred',
        provider: error.provider
      }),
      { 
        status: error.status || 500, 
        headers: { 'Content-Type': 'application/json' } 
      }
    );
  }
}
