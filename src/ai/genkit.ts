import {genkit} from 'genkit';
import {googleAI} from '@genkit-ai/google-genai';

export const googleAiPlugin = googleAI({apiVersion: 'v1'});

export const ai = genkit({
  plugins: [googleAiPlugin],
});
