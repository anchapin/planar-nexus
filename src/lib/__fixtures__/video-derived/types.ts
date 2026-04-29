import type { RecognizedBoardState } from "@/lib/pipeline/board-state-vision-types";

export interface VideoDerivedFixture {
  id: string;
  name: string;
  description: string;
  source: {
    videoId?: string;
    timestampMs: number;
    frameIndex: number;
    confidence: number;
  };
  gameState: RecognizedBoardState;
  expectedBehaviors: string[];
  tags: string[];
  difficulty: "basic" | "intermediate" | "advanced" | "expert";
}

export interface FixtureGenerationResult {
  totalFixtures: number;
  generated: number;
  skipped: number;
  errors: string[];
}
