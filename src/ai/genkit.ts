// Stub for Google AI plugin (dependency removed in Issue #446)
// This file is retained for backward compatibility but is no longer functional

interface GoogleAIPluginStub {
  name: string;
  configure: () => Record<string, unknown>;
}

const googleAiPluginStub: GoogleAIPluginStub = {
  name: "google-ai",
  configure: () => ({}),
};

export const googleAiPlugin = googleAiPluginStub;

// Genkit stub - typed as nullable to allow conditional usage
export interface GenkitAI {
  generate: (params: Record<string, unknown>) => Promise<{ text: string }>;
}

export const ai: GenkitAI | null = null;
