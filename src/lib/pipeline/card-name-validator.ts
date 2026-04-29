import type { RecognizedBoardState } from "./board-state-vision-types";

const COMMON_CORRECTIONS: Record<string, string> = {
  "sol ring": "Sol Ring",
  "lightning bolt": "Lightning Bolt",
  "counterspell": "Counterspell",
  "dark ritual": "Dark Ritual",
  "forest": "Forest",
  "island": "Island",
  "mountain": "Mountain",
  "plains": "Plains",
  "swamp": "Swamp",
  "unknown card": "Unknown Card",
};

function normalizeForMatch(name: string): string {
  return name.toLowerCase().trim().replace(/['']/g, "'").replace(/\s+/g, " ");
}

function findBestMatch(
  query: string,
  database: Map<string, string[]>,
): { match: string | null; exact: boolean } {
  const normalized = normalizeForMatch(query);

  if (normalized === "unknown card" || normalized === "") {
    return { match: null, exact: false };
  }

  for (const [normalizedName, aliases] of database) {
    if (normalizedName === normalized) {
      return { match: normalizedName, exact: true };
    }
    if (aliases.some((a) => normalizeForMatch(a) === normalized)) {
      return { match: normalizedName, exact: true };
    }
  }

  let bestMatch: string | null = null;
  let bestDistance = Infinity;
  const threshold = 3;

  for (const [normalizedName] of database) {
    const dist = levenshteinDistance(normalized, normalized);
    if (dist < bestDistance && dist <= threshold) {
      bestDistance = dist;
      bestMatch = normalizedName;
    }
  }

  return { match: bestMatch, exact: false };
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0),
  );

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] =
          1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  return dp[m][n];
}

export interface ValidatedCard {
  name: string;
  valid: boolean;
  suggestion?: string;
}

export function validateCardNames(
  boardState: RecognizedBoardState,
  cardDatabase?: Map<string, string[]>,
): ValidatedCard[] {
  const allNames: string[] = [];

  for (const card of boardState.battlefield_player) {
    allNames.push(card.name);
  }
  for (const card of boardState.battlefield_opponent) {
    allNames.push(card.name);
  }
  for (const name of boardState.graveyard) {
    allNames.push(name);
  }
  for (const name of boardState.stack) {
    allNames.push(name);
  }

  if (!cardDatabase || cardDatabase.size === 0) {
    return allNames.map((name) => ({
      name,
      valid: name !== "Unknown Card",
      suggestion: COMMON_CORRECTIONS[normalizeForMatch(name)],
    }));
  }

  const seen = new Set<string>();
  const results: ValidatedCard[] = [];

  for (const name of allNames) {
    if (seen.has(name)) continue;
    seen.add(name);

    const { match, exact } = findBestMatch(name, cardDatabase);
    const isKnownCard = name !== "Unknown Card";

    if (exact) {
      results.push({ name, valid: true });
    } else if (match && !exact && isKnownCard) {
      const capitalized = capitalizeWords(match);
      results.push({ name, valid: false, suggestion: capitalized });
    } else {
      const commonCorrection = COMMON_CORRECTIONS[normalizeForMatch(name)];
      results.push({
        name,
        valid: isKnownCard ? (commonCorrection !== undefined) : false,
        suggestion: commonCorrection,
      });
    }
  }

  return results;
}

function capitalizeWords(str: string): string {
  return str
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
