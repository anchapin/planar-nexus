import {genkit} from 'genkit';

// Stub for Google AI plugin (dependency removed in Issue #446)
// This file is retained for backward compatibility but is no longer functional
const googleAiPluginStub: any = {
  name: 'google-ai',
  configure: () => ({})
};

export const googleAiPlugin = googleAiPluginStub;

export const ai = genkit({
  plugins: [googleAiPlugin],
});
