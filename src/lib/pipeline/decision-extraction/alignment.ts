import type { DecisionMomentType, TranscriptAlignment } from "./types";

const DECISION_KEYWORDS: Record<DecisionMomentType, string[]> = {
  attack_declaration: [
    "attacks with",
    "goes to combat",
    "declares attackers",
    "swings with",
    "send in",
    "attacks",
    "combat phase",
    "going wide",
    "swinging",
  ],
  block_declaration: [
    "blocks with",
    "declares blockers",
    "chump block",
    "double block",
    "blocks",
    "trading",
    "take the damage",
    "let it through",
  ],
  spell_cast: [
    "casts",
    "plays",
    "resolve",
    "on the stack",
    "counter",
    "targeting",
    "sorcery",
    "instant",
    "discard",
  ],
  ability_activation: [
    "activates",
    "triggers",
    "taps for",
    "sac",
    "sacrifice",
    "pays life",
    "uses",
    "ability",
    "activate",
    "equip",
  ],
  priority_pass: [
    "pass priority",
    "passes",
    "pass turn",
    "end step",
    "move to",
    "goes to combat",
    "passes the turn",
    "done",
  ],
  mulligan: [
    "mulligan",
    "keep",
    "scry",
    "opening hand",
    "mull to",
    "partial mulligan",
    "london mulligan",
  ],
  other: [],
};

export function alignTranscriptToFrame(
  frame_timestamp_ms: number,
  transcript_segments: Array<{
    start_ms: number;
    end_ms: number;
    text: string;
    confidence: number;
  }>,
  window_radius_ms: number = 15000,
): TranscriptAlignment {
  const window_start_ms = frame_timestamp_ms - window_radius_ms;
  const window_end_ms = frame_timestamp_ms + window_radius_ms;

  const matching_segments = transcript_segments.filter(
    (seg) => seg.start_ms >= window_start_ms && seg.end_ms <= window_end_ms,
  );

  const sorted = [...matching_segments].sort((a, b) => a.start_ms - b.start_ms);

  return {
    frame_timestamp_ms,
    transcript_segments: sorted,
    window_start_ms,
    window_end_ms,
  };
}

export function buildTranscriptText(alignment: TranscriptAlignment): string {
  return alignment.transcript_segments
    .map((seg) => `[${formatTimestamp(seg.start_ms)}] ${seg.text}`)
    .join("\n");
}

export function detectDecisionMoments(
  transcript_text: string,
): DecisionMomentType[] {
  const lower = transcript_text.toLowerCase();
  const detected: DecisionMomentType[] = [];

  for (const [moment_type, keywords] of Object.entries(DECISION_KEYWORDS)) {
    if (moment_type === "other") continue;
    for (const keyword of keywords) {
      if (lower.includes(keyword.toLowerCase())) {
        detected.push(moment_type as DecisionMomentType);
        break;
      }
    }
  }

  if (detected.length === 0) {
    return [];
  }

  return [...new Set(detected)];
}

export function formatTimestamp(ms: number): string {
  const total_seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(total_seconds / 60);
  const seconds = total_seconds % 60;
  const milliseconds = ms % 1000;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}.${milliseconds.toString().padStart(3, "0")}`;
}
