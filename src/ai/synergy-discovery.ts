import type { SynergyType } from "./synergy-database";

export interface DiscoveredSynergy {
  cards: string[];
  synergy_description: string;
  archetype: string;
  format: string;
  confidence: "high" | "medium" | "low";
  source_text: string;
  source_channel?: string;
  reviewed: boolean;
  approved: boolean;
  id: string;
}

export type ReviewDecision = "approved" | "rejected" | "pending";

export interface ReviewGateEntry {
  synergy: DiscoveredSynergy;
  decision: ReviewDecision;
  reviewer_notes?: string;
  reviewed_at?: string;
}

export const SYNERGY_KEYWORDS: string[] = [
  "this combo",
  "these two cards together",
  "this enables",
  "pairs well with",
  "goes infinite with",
  "works really well with",
  "synergy between",
  "great combo",
  "these two cards",
  "this pairing",
  " synergizes with",
  "combo with",
  "enables a combo",
  "builds around",
  "pays off with",
  "triggers off of",
];

export const FORMAT_KEYWORDS: Record<string, string[]> = {
  standard: ["standard", "standard format", "standard legal"],
  pioneer: ["pioneer", "pioneer format"],
  modern: ["modern", "modern format", "modern legal"],
  legacy: ["legacy", "legacy format", "legacy legal"],
  vintage: ["vintage", "vintage format", "type 1"],
  commander: ["commander", "edh", "edh format", "cEDH", "cedh"],
  pauper: ["pauper", "pauper format"],
  limited: ["draft", "sealed", "limited"],
  brawl: ["brawl", "brawl format"],
};

export const ARCHETYPE_KEYWORDS: Record<string, string[]> = {
  aggro: ["aggro", "aggressive", "burn", "red deck wins", "rdw", "sligh"],
  control: ["control", "draw-go", "control deck", "tap-out control"],
  midrange: ["midrange", "goodstuff", "midrange deck"],
  combo: ["combo", "storm", "eggs", "ad nauseam", "storm deck"],
  tempo: ["tempo", "delver", "tempo deck", "fish"],
  ramp: ["ramp", "big mana", "green ramp"],
  tribal: [
    "tribal",
    "tribe",
    "elf ball",
    "goblin",
    "zombies",
    "vampires",
    "merfolk",
    "humans",
    "dragons",
  ],
  aristocrats: ["aristocrats", "sacrifice", "sacrifice deck", "drain"],
  tokens: ["tokens", "token deck", "token army", "make tokens"],
  reanimator: ["reanimator", "reanimate", "graveyard strategy", "reanimation"],
  mill: ["mill", "mill deck", "milling"],
  prison: ["prison", "stax", "lock deck", "stax deck"],
  blink: ["blink", "flicker", "etb", "enter the battlefield", "flicker deck"],
  heroic: ["heroic", "heroic deck", "heroic trigger"],
  enchantress: ["enchantress", "enchantment deck", "enchantress deck"],
  superfriends: ["superfriends", "planeswalker deck", "walker deck"],
  artifact: ["artifact", "affinity", "artifacts matter", "affinity deck"],
};

export function discoverSynergies(
  transcriptSegments: Array<{
    text: string;
    timestamp?: string;
    speaker?: string;
  }>,
  sourceChannel?: string,
): DiscoveredSynergy[] {
  const results: DiscoveredSynergy[] = [];

  for (const segment of transcriptSegments) {
    const text = segment.text.toLowerCase();

    for (const keyword of SYNERGY_KEYWORDS) {
      if (!text.includes(keyword)) continue;

      const nearbyCards = extractCardNames(segment.text);
      if (nearbyCards.length < 2) continue;

      const archetype = detectArchetype(text);
      const format = detectFormat(text);
      const confidence = scoreConfidence(segment.text, nearbyCards);

      const id = generateSynergyId(nearbyCards);

      results.push({
        cards: nearbyCards,
        synergy_description: extractSynergyDescription(segment.text, keyword),
        archetype,
        format,
        confidence,
        source_text: segment.text.trim(),
        source_channel: sourceChannel,
        reviewed: false,
        approved: false,
        id,
      });

      break;
    }
  }

  return deduplicateSynergies(results);
}

function extractCardNames(text: string): string[] {
  const cardPatterns = [
    /\b([A-Z][a-z]+(?:\s+[a-z]+)?\s+of\s+[A-Z][a-z]+)\b/g,
    /\b([A-Z][a-z]+(?: [A-Z][a-z]+)+(?:,? the [A-Z][a-z]+)?)\b/g,
    /\b([A-Z][a-z]+(?: [A-Z][a-z]+)?)\b/g,
  ];

  const knownCards = new Set<string>();
  const blacklist = new Set([
    "This",
    "That",
    "These",
    "Those",
    "The",
    "There",
    "Their",
    "Then",
    "When",
    "What",
    "Where",
    "Which",
    "While",
    "With",
    "From",
    "Have",
    "Just",
    "More",
    "Once",
    "Such",
    "Than",
    "Them",
    "Very",
    "Your",
    "So",
    "If",
    "Or",
    "No",
    "Not",
    "Can",
    "You",
    "All",
    "But",
    "And",
    "For",
    "Are",
    "Was",
    "How",
    "Out",
    "Get",
    "Got",
    "One",
    "Two",
    "Its",
    "His",
    "Her",
    "Our",
    "My",
    "Me",
    "We",
    "They",
    "It",
    "Being",
    "Every",
    "Into",
    "Over",
    "Only",
    "Other",
    "Should",
    "About",
    "Because",
    "Before",
    "After",
    "Since",
    "Through",
    "Between",
    "Under",
    "Again",
    "Still",
    "Even",
    "Much",
    "Also",
    "Back",
    "Could",
    "Would",
    "Will",
    "Each",
    "Make",
    "Like",
    "Many",
    "Most",
    "Some",
    "Well",
    "Long",
    "Look",
    "Come",
    "Made",
    "Find",
    "Here",
    "Thing",
    "Take",
    "Year",
    "Them",
    "New",
    "Now",
    "Way",
    "May",
    "Say",
    "Who",
    "Did",
    "Down",
    "Off",
    "Must",
    "Through",
    "Great",
    "Same",
    "Need",
    "Turn",
    "Right",
    "Left",
    "High",
    "Low",
    "End",
    "First",
    "Last",
    "Let",
    "Put",
    "Old",
    "Too",
    "Use",
    "Try",
    "Ask",
    "Own",
    "Why",
    "Did",
    "Going",
    "Getting",
    "Kind",
    "Know",
    "Think",
    "See",
    "Want",
    "Give",
    "Day",
    "Good",
    "Time",
    "Really",
    "Going",
    "Something",
    "Actually",
    "Basically",
    "Essentially",
    "Literally",
    "Obviously",
    "Generally",
    "Typically",
    "Usually",
    "Simply",
    "Especially",
    "Particularly",
    "Specifically",
    "Certainly",
    "Definitely",
    "Probably",
    "Possible",
    "Important",
    "Different",
    "Another",
    "Rather",
    "Instead",
    "However",
    "Therefore",
    "Finally",
    "Currently",
    "Recently",
    "Previously",
    "Originally",
  ]);

  const cardNames: string[] = [];

  for (const pattern of cardPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const name = match[1].trim();
      if (name.length < 3 || name.length > 60) continue;
      if (blacklist.has(name)) continue;
      if (knownCards.has(name)) continue;
      knownCards.add(name);

      if (name.split(" ").length >= 1) {
        cardNames.push(name);
      }
    }
  }

  return cardNames.slice(0, 6);
}

function detectArchetype(text: string): string {
  let bestArchetype = "unknown";
  let bestCount = 0;

  for (const [archetype, keywords] of Object.entries(ARCHETYPE_KEYWORDS)) {
    let count = 0;
    for (const kw of keywords) {
      if (text.includes(kw.toLowerCase())) {
        count++;
      }
    }
    if (count > bestCount) {
      bestCount = count;
      bestArchetype = archetype;
    }
  }

  return bestCount > 0 ? bestArchetype : "unknown";
}

function detectFormat(text: string): string {
  for (const [format, keywords] of Object.entries(FORMAT_KEYWORDS)) {
    for (const kw of keywords) {
      if (text.includes(kw.toLowerCase())) {
        return format;
      }
    }
  }
  return "unknown";
}

function scoreConfidence(
  text: string,
  cards: string[],
): "high" | "medium" | "low" {
  let score = 0;

  if (cards.length >= 3) score += 2;
  else if (cards.length >= 2) score += 1;

  const synergyIndicators = [
    "infinite",
    "win",
    "win condition",
    "game-winning",
    "broken",
    "overpowered",
    "op",
    "competitive",
    "top tier",
    "tier 1",
    "must-answer",
    "threat",
    "payoff",
    "engine",
  ];
  for (const indicator of synergyIndicators) {
    if (text.toLowerCase().includes(indicator)) {
      score += 1;
      break;
    }
  }

  const specificPhrases = [
    "goes infinite with",
    "enables a combo",
    "this combo",
    "these two cards together",
    "great combo",
  ];
  for (const phrase of specificPhrases) {
    if (text.toLowerCase().includes(phrase)) {
      score += 1;
      break;
    }
  }

  if (score >= 3) return "high";
  if (score >= 2) return "medium";
  return "low";
}

function extractSynergyDescription(text: string, keyword: string): string {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(keyword);
  if (idx === -1) return text.trim().slice(0, 200);

  const start = Math.max(0, idx - 60);
  const end = Math.min(text.length, idx + keyword.length + 120);
  return text.trim().slice(start, end).trim();
}

function generateSynergyId(cards: string[]): string {
  const sorted = [...cards].sort().join("-").toLowerCase().replace(/\s+/g, "-");
  const hash = simpleHash(sorted);
  return `nlp-${hash}`;
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function deduplicateSynergies(
  synergies: DiscoveredSynergy[],
): DiscoveredSynergy[] {
  const seen = new Set<string>();
  return synergies.filter((s) => {
    const key = s.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function createReviewGate(maxQueueSize: number = 50): {
  submit: (synergies: DiscoveredSynergy[]) => ReviewGateEntry[];
  review: (
    id: string,
    decision: ReviewDecision,
    notes?: string,
  ) => ReviewGateEntry | undefined;
  getPending: () => ReviewGateEntry[];
  getApproved: () => DiscoveredSynergy[];
  getRejected: () => ReviewGateEntry[];
  stats: () => {
    pending: number;
    approved: number;
    rejected: number;
    total: number;
  };
} {
  const queue: Map<string, ReviewGateEntry> = new Map();

  function submit(synergies: DiscoveredSynergy[]): ReviewGateEntry[] {
    const entries: ReviewGateEntry[] = [];

    for (const synergy of synergies) {
      if (synergy.reviewed) continue;

      const entry: ReviewGateEntry = {
        synergy: { ...synergy },
        decision: "pending",
      };
      queue.set(synergy.id, entry);
      entries.push(entry);
    }

    while (queue.size > maxQueueSize) {
      const firstKey = queue.keys().next().value;
      if (firstKey !== undefined) queue.delete(firstKey);
    }

    return entries;
  }

  function review(
    id: string,
    decision: ReviewDecision,
    notes?: string,
  ): ReviewGateEntry | undefined {
    const entry = queue.get(id);
    if (!entry) return undefined;

    entry.decision = decision;
    entry.reviewer_notes = notes;
    entry.reviewed_at = new Date().toISOString();
    entry.synergy.reviewed = true;
    entry.synergy.approved = decision === "approved";

    return entry;
  }

  function getPending(): ReviewGateEntry[] {
    return Array.from(queue.values()).filter((e) => e.decision === "pending");
  }

  function getApproved(): DiscoveredSynergy[] {
    return Array.from(queue.values())
      .filter((e) => e.decision === "approved")
      .map((e) => e.synergy);
  }

  function getRejected(): ReviewGateEntry[] {
    return Array.from(queue.values()).filter((e) => e.decision === "rejected");
  }

  function stats() {
    const all = Array.from(queue.values());
    return {
      pending: all.filter((e) => e.decision === "pending").length,
      approved: all.filter((e) => e.decision === "approved").length,
      rejected: all.filter((e) => e.decision === "rejected").length,
      total: all.length,
    };
  }

  return { submit, review, getPending, getApproved, getRejected, stats };
}
