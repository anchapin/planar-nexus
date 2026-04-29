import { promises as fs } from "fs";
import path from "path";
import { generateText } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
  BOARD_STATE_SYSTEM_PROMPT,
} from "./board-state-prompt";
import {
  RecognizedBoardStateSchema,
  type VisionProcessingOptions,
  type VisionProcessingResult,
  type BatchProcessingResult,
} from "./board-state-vision-types";
import { validateCardNames } from "./card-name-validator";

const DEFAULT_MODEL = "gemini-2.0-flash";
const DEFAULT_TEMPERATURE = 0.1;
const DEFAULT_MAX_RETRIES = 2;

function readImageAsBase64(imagePath: string): Promise<string> {
  return fs.readFile(imagePath).then((buf) => buf.toString("base64"));
}

function guessMimeType(imagePath: string): string {
  const ext = path.extname(imagePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

export async function analyzeFrame(
  framePath: string,
  cardDatabase?: Map<string, string[]>,
  options?: VisionProcessingOptions,
): Promise<VisionProcessingResult> {
  const startTime = Date.now();
  const modelId = options?.model ?? DEFAULT_MODEL;
  const temperature = options?.temperature ?? DEFAULT_TEMPERATURE;
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const confidenceThreshold = options?.confidenceThreshold ?? 0.0;

  const apiKey =
    process.env.GOOGLE_AI_API_KEY ?? process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    return {
      success: false,
      boardState: null,
      rawResponse: null,
      validatedCards: [],
      error: "GOOGLE_AI_API_KEY not configured",
      processingTimeMs: Date.now() - startTime,
      modelUsed: modelId,
    };
  }

  let base64Image: string;
  try {
    base64Image = await readImageAsBase64(framePath);
  } catch {
    return {
      success: false,
      boardState: null,
      rawResponse: null,
      validatedCards: [],
      error: `Failed to read image: ${framePath}`,
      processingTimeMs: Date.now() - startTime,
      modelUsed: modelId,
    };
  }

  const mimeType = guessMimeType(framePath);
  const dataUri = `data:${mimeType};base64,${base64Image}`;

  let lastError: Error | null = null;
  let rawResponse: string | null = null;
  let tokensUsed: { input: number; output: number } | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const google = createGoogleGenerativeAI({ apiKey });
      const model = google(modelId);

      const result = await generateText({
        model,
        system: BOARD_STATE_SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", image: dataUri },
              {
                type: "text",
                text: "Analyze this game board screenshot and extract the board state as JSON.",
              },
            ],
          },
        ],
        temperature,
      });

      rawResponse = result.text;
      const usage = await result.usage;
      tokensUsed = {
        input: usage.inputTokens ?? 0,
        output: usage.outputTokens ?? 0,
      };
      break;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }

  if (!rawResponse) {
    return {
      success: false,
      boardState: null,
      rawResponse,
      validatedCards: [],
      error: lastError?.message ?? "Unknown error",
      processingTimeMs: Date.now() - startTime,
      modelUsed: modelId,
      tokensUsed,
    };
  }

  const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      success: false,
      boardState: null,
      rawResponse,
      validatedCards: [],
      error: "No JSON object found in response",
      processingTimeMs: Date.now() - startTime,
      modelUsed: modelId,
      tokensUsed,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return {
      success: false,
      boardState: null,
      rawResponse,
      validatedCards: [],
      error: "Invalid JSON in response",
      processingTimeMs: Date.now() - startTime,
      modelUsed: modelId,
      tokensUsed,
    };
  }

  const result = RecognizedBoardStateSchema.safeParse(parsed);
  if (!result.success) {
    return {
      success: false,
      boardState: null,
      rawResponse,
      validatedCards: [],
      error: `Schema validation failed: ${result.error.message}`,
      processingTimeMs: Date.now() - startTime,
      modelUsed: modelId,
      tokensUsed,
    };
  }

  const boardState = result.data;
  const validatedCards = validateCardNames(boardState, cardDatabase);

  const validCount = validatedCards.filter((c) => c.valid).length;
  const totalCount = validatedCards.length;
  const accuracy = totalCount > 0 ? validCount / totalCount : 1;

  if (accuracy < confidenceThreshold && confidenceThreshold > 0) {
    return {
      success: false,
      boardState,
      rawResponse,
      validatedCards,
      error: `Card accuracy ${accuracy.toFixed(2)} below threshold ${confidenceThreshold}`,
      processingTimeMs: Date.now() - startTime,
      modelUsed: modelId,
      tokensUsed,
    };
  }

  return {
    success: true,
    boardState,
    rawResponse,
    validatedCards,
    processingTimeMs: Date.now() - startTime,
    modelUsed: modelId,
    tokensUsed,
  };
}

export async function analyzeFramesBatch(
  frames: string[],
  cardDatabase?: Map<string, string[]>,
  options?: VisionProcessingOptions & {
    concurrency?: number;
    onProgress?: (current: number, total: number) => void;
  },
): Promise<BatchProcessingResult> {
  const concurrency = options?.concurrency ?? 3;
  const onProgress = options?.onProgress;
  const results: VisionProcessingResult[] = [];

  let completed = 0;
  const total = frames.length;

  async function processFrame(framePath: string): Promise<VisionProcessingResult> {
    const result = await analyzeFrame(framePath, cardDatabase, options);
    completed++;
    onProgress?.(completed, total);
    return result;
  }

  for (let i = 0; i < frames.length; i += concurrency) {
    const batch = frames.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(processFrame));
    results.push(...batchResults);
  }

  const successfulFrames = results.filter((r) => r.success).length;
  const failedFrames = results.filter((r) => !r.success).length;
  const totalProcessingTimeMs = results.reduce((sum, r) => sum + r.processingTimeMs, 0);

  let totalValid = 0;
  let totalCards = 0;
  for (const r of results) {
    for (const vc of r.validatedCards) {
      totalCards++;
      if (vc.valid) totalValid++;
    }
  }
  const averageCardAccuracy = totalCards > 0 ? totalValid / totalCards : 0;

  return {
    results,
    totalFrames: total,
    successfulFrames,
    failedFrames,
    averageCardAccuracy,
    totalProcessingTimeMs,
  };
}
