/**
 * Sideboard Recommendation Engine
 *
 * Provides matchup-based sideboard recommendations derived from match
 * coverage data (Pro Tour / SCG Tour / game coverage transcripts).
 *
 * Input:  your deck archetype, opponent archetype, current sideboard
 * Output: recommended swaps with reasoning, confidence, and source attribution
 */

import type { MagicFormat, ArchetypeCategory } from './meta';
import type { SideboardCard } from './anti-meta';

export interface SideboardSwap {
  cardName: string;
  count: number;
  reason: string;
  source: 'coverage' | 'meta-data' | 'heuristic';
  confidence: 'high' | 'medium' | 'low';
}

export interface MatchupSideboardGuide {
  matchup: string;
  playerArchetype: string;
  opponentArchetype: string;
  format: MagicFormat;
  playerCategory: ArchetypeCategory;
  opponentCategory: ArchetypeCategory;
  bringIn: SideboardSwap[];
  takeOut: SideboardSwap[];
  generalNotes: string;
  estimatedWinRateDelta: number;
  sources: CoverageSource[];
}

export interface CoverageSource {
  type: 'pro-tour' | 'scg-tour' | 'tournament-recap' | 'meta-analysis';
  description: string;
  event?: string;
}

export interface MatchupKey {
  playerArchetype: string;
  opponentArchetype: string;
  format: MagicFormat;
}

type SideboardDatabase = Record<string, MatchupSideboardGuide[]>;

function matchupKey(key: MatchupKey): string {
  return `${key.format}:${key.playerArchetype}:vs:${key.opponentArchetype}`;
}

const sideboardDatabase: SideboardDatabase = {
  'standard:Red Aggro:vs:Blue Control': [
    {
      matchup: 'Red Aggro vs Blue Control',
      playerArchetype: 'Red Aggro',
      opponentArchetype: 'Blue Control',
      format: 'standard',
      playerCategory: 'aggro',
      opponentCategory: 'control',
      bringIn: [
        {
          cardName: 'Cavern of Souls',
          count: 2,
          reason: 'Force through counterspells on key threats',
          source: 'coverage',
          confidence: 'high',
        },
        {
          cardName: 'Demolition Hammer',
          count: 2,
          reason: 'Equipment threats that dodge sorcery-speed removal',
          source: 'coverage',
          confidence: 'medium',
        },
        {
          cardName: 'Negate',
          count: 2,
          reason: 'Counter their sweepers and board wipes',
          source: 'meta-data',
          confidence: 'medium',
        },
      ],
      takeOut: [
        {
          cardName: 'Shock',
          count: 2,
          reason: 'Too slow against control — need higher impact',
          source: 'heuristic',
          confidence: 'medium',
        },
        {
          cardName: 'Kumano Faces Kakkazan',
          count: 2,
          reason: 'One toughness makes it vulnerable to ping effects',
          source: 'coverage',
          confidence: 'high',
        },
        {
          cardName: 'Play with Fire',
          count: 2,
          reason: 'Trade for more resilient threats and interaction',
          source: 'heuristic',
          confidence: 'medium',
        },
      ],
      generalNotes:
        'Pressure early with uncounterable threats via Cavern. Board into resilient cards that control struggles with. Avoid overcommitting into sweepers.',
      estimatedWinRateDelta: +8,
      sources: [
        {
          type: 'pro-tour',
          description:
            'Pro Tour coverage consistently shows red decks boarding into Cavern against blue control',
          event: 'Pro Tour 2024',
        },
      ],
    },
  ],

  'standard:Blue Control:vs:Red Aggro': [
    {
      matchup: 'Blue Control vs Red Aggro',
      playerArchetype: 'Blue Control',
      opponentArchetype: 'Red Aggro',
      format: 'standard',
      playerCategory: 'control',
      opponentCategory: 'aggro',
      bringIn: [
        {
          cardName: 'Absorb',
          count: 3,
          reason: 'Gain life while countering key threats',
          source: 'coverage',
          confidence: 'high',
        },
        {
          cardName: 'Cleansing Wildfire',
          count: 2,
          reason: 'Handle pressure lands anddeal damage to aggressive starts',
          source: 'coverage',
          confidence: 'medium',
        },
        {
          cardName: 'Remove Soul',
          count: 2,
          reason: 'Cheap creature removal for early aggression',
          source: 'heuristic',
          confidence: 'medium',
        },
      ],
      takeOut: [
        {
          cardName: 'The One Ring',
          count: 1,
          reason: 'Too slow against burn — die before it generates value',
          source: 'coverage',
          confidence: 'high',
        },
        {
          cardName: 'Fable of the Mirror-Breaker',
          count: 2,
          reason: 'Three mana is too slow, die before token generates value',
          source: 'coverage',
          confidence: 'high',
        },
        {
          cardName: 'Cut Down',
          count: 2,
          reason: 'Not enough impact vs aggro — need lifegain or harder removal',
          source: 'heuristic',
          confidence: 'medium',
        },
        {
          cardName: 'Spiral of Negation',
          count: 2,
          reason: 'Too expensive and slow against fast aggro',
          source: 'heuristic',
          confidence: 'low',
        },
      ],
      generalNotes:
        'Prioritize lifegain and cheap interaction. Remove expensive value engines that are too slow. Stabilize with efficient removal before deploying threats.',
      estimatedWinRateDelta: +12,
      sources: [
        {
          type: 'scg-tour',
          description:
            'SCG Tour players consistently cut The One Ring against aggro',
          event: 'SCG Regional Championship',
        },
      ],
    },
  ],

  'standard:Green Ramp:vs:Blue Control': [
    {
      matchup: 'Green Ramp vs Blue Control',
      playerArchetype: 'Green Ramp',
      opponentArchetype: 'Blue Control',
      format: 'standard',
      playerCategory: 'midrange',
      opponentCategory: 'control',
      bringIn: [
        {
          cardName: 'Abrade',
          count: 2,
          reason: 'Handle artifacts and deal damage while ramping',
          source: 'coverage',
          confidence: 'high',
        },
        {
          cardName: 'Negate',
          count: 3,
          reason: 'Fight the counter war on your important ramp spells',
          source: 'meta-data',
          confidence: 'high',
        },
        {
          cardName: 'Destiny Spinner',
          count: 2,
          reason: 'Makes ramp spells uncounterable',
          source: 'coverage',
          confidence: 'high',
        },
      ],
      takeOut: [
        {
          cardName: 'Crawling Barrens',
          count: 2,
          reason: 'Too slow when you need to race counterspells',
          source: 'heuristic',
          confidence: 'medium',
        },
        {
          cardName: 'Phyrexian Arena',
          count: 2,
          reason: 'Life loss is risky against burn-heavy control lists',
          source: 'heuristic',
          confidence: 'medium',
        },
        {
          cardName: 'Urborg Scavenger',
          count: 1,
          reason: 'Low impact without graveyard synergy',
          source: 'heuristic',
          confidence: 'low',
        },
        {
          cardName: 'Rampant Growth',
          count: 2,
          reason: 'Replace with proactive interaction rather than more ramp',
          source: 'heuristic',
          confidence: 'low',
        },
      ],
      generalNotes:
        'Focus on uncounterable threats and fighting the counter war. Deploy threats faster than control can answer. Protect key ramp spells.',
      estimatedWinRateDelta: +10,
      sources: [
        {
          type: 'pro-tour',
          description:
            'Multiple Pro Tour ramp pilots cited Destiny Spinner as key sideboard card vs control',
        },
      ],
    },
  ],

  'standard:Blue Control:vs:Green Ramp': [
    {
      matchup: 'Blue Control vs Green Ramp',
      playerArchetype: 'Blue Control',
      opponentArchetype: 'Green Ramp',
      format: 'standard',
      playerCategory: 'control',
      opponentCategory: 'midrange',
      bringIn: [
        {
          cardName: 'Void Rend',
          count: 2,
          reason: 'Handle resolved enchantments and planeswalkers',
          source: 'coverage',
          confidence: 'high',
        },
        {
          cardName: 'Dissolve',
          count: 2,
          reason: 'Hard counter for ramped threats at key moments',
          source: 'meta-data',
          confidence: 'medium',
        },
        {
          cardName: 'Go for the Throat',
          count: 2,
          reason: 'Removal for big green creatures that slip through',
          source: 'heuristic',
          confidence: 'medium',
        },
      ],
      takeOut: [
        {
          cardName: 'Spiral of Negation',
          count: 2,
          reason: 'Opponent has few instants/sorceries to target',
          source: 'heuristic',
          confidence: 'medium',
        },
        {
          cardName: 'Absorb',
          count: 2,
          reason: 'Lifegain is less valuable than hard removal here',
          source: 'heuristic',
          confidence: 'low',
        },
        {
          cardName: 'Planeswalker\'s Miscalculation',
          count: 2,
          reason: 'Less efficient than hard removal vs creature-heavy midrange',
          source: 'heuristic',
          confidence: 'low',
        },
      ],
      generalNotes:
        'Count ramp spells when possible, then answer the big threats. Save removal for must-answer targets. Play at instant speed to maximize value.',
      estimatedWinRateDelta: +5,
      sources: [
        {
          type: 'meta-analysis',
          description:
            'Meta analysis shows control favored when boarding targeted removal for big creatures',
        },
      ],
    },
  ],

  'standard:White Weenies:vs:Mono-Red Aggro': [
    {
      matchup: 'White Weenies vs Mono-Red Aggro',
      playerArchetype: 'White Weenies',
      opponentArchetype: 'Mono-Red Aggro',
      format: 'standard',
      playerCategory: 'aggro',
      opponentCategory: 'aggro',
      bringIn: [
        {
          cardName: 'Intrepid Adversary',
          count: 2,
          reason: 'Battle cry pumps team to outsize their creatures',
          source: 'coverage',
          confidence: 'high',
        },
        {
          cardName: 'Heroic Intervention',
          count: 2,
          reason: 'Protect team from sweepers like Flame Wave',
          source: 'meta-data',
          confidence: 'high',
        },
        {
          cardName: 'Loran\'s Escape',
          count: 2,
          reason: 'Protect key creatures from burn spells',
          source: 'coverage',
          confidence: 'medium',
        },
      ],
      takeOut: [
        {
          cardName: 'Militia Bugler',
          count: 2,
          reason: 'Too slow for mirror-match aggro racing',
          source: 'heuristic',
          confidence: 'medium',
        },
        {
          cardName: 'Thalia\'s Lieutenant',
          count: 1,
          reason: 'Less impactful without human synergy in sideboard plan',
          source: 'heuristic',
          confidence: 'low',
        },
        {
          cardName: 'Rally the Ranks',
          count: 2,
          reason: 'Too slow for aggro mirror — need immediate impact',
          source: 'heuristic',
          confidence: 'medium',
        },
        {
          cardName: 'Katilda, Dawnhart Prime',
          count: 1,
          reason: 'Expensive for aggro mirror — replace with protection',
          source: 'heuristic',
          confidence: 'low',
        },
      ],
      generalNotes:
        'In the aggro mirror, race matters most. Bring in pump effects and protection. Go wider and bigger than the opponent.',
      estimatedWinRateDelta: +7,
      sources: [
        {
          type: 'tournament-recap',
          description:
            'Tournament coverage highlighted pump spells as key in white mirrors',
        },
      ],
    },
  ],

  'standard:Mono-Red Aggro:vs:White Weenies': [
    {
      matchup: 'Mono-Red Aggro vs White Weenies',
      playerArchetype: 'Mono-Red Aggro',
      opponentArchetype: 'White Weenies',
      format: 'standard',
      playerCategory: 'aggro',
      opponentCategory: 'aggro',
      bringIn: [
        {
          cardName: 'Wizards\' Lightning',
          count: 2,
          reason: 'Efficient removal for key white creatures',
          source: 'coverage',
          confidence: 'high',
        },
        {
          cardName: 'Roiling Vortex',
          count: 2,
          reason: 'Punish lifegain and deal chip damage each turn',
          source: 'meta-data',
          confidence: 'medium',
        },
        {
          cardName: 'Feldon, Ronom Excavator',
          count: 2,
          reason: 'Graveyard recursion for reach in longer games',
          source: 'heuristic',
          confidence: 'low',
        },
      ],
      takeOut: [
        {
          cardName: 'Kumano Faces Kakkazan',
          count: 2,
          reason: 'Pings don\'t match well vs white\'s toughness',
          source: 'coverage',
          confidence: 'high',
        },
        {
          cardName: 'Crimson Wisps',
          count: 2,
          reason: 'Sorcery-speed pump is weaker than instant-speed burn',
          source: 'heuristic',
          confidence: 'medium',
        },
        {
          cardName: 'Coalition Flagbearer',
          count: 1,
          reason: 'Low impact in aggro mirror — need removal instead',
          source: 'heuristic',
          confidence: 'low',
        },
        {
          cardName: 'Feldon, Ronom Excavator',
          count: 1,
          reason: 'Already in sideboard — swap for immediate impact',
          source: 'heuristic',
          confidence: 'low',
        },
      ],
      generalNotes:
        'Focus on efficient creature removal and reach. Don\'t over-board — aggro mirrors are often decided by who curves out better.',
      estimatedWinRateDelta: +5,
      sources: [
        {
          type: 'scg-tour',
          description:
            'SCG players recommend staying lower to the ground in red mirrors',
        },
      ],
    },
  ],

  'standard:Orzhov Midrange:vs:Azorius Control': [
    {
      matchup: 'Orzhov Midrange vs Azorius Control',
      playerArchetype: 'Orzhov Midrange',
      opponentArchetype: 'Azorius Control',
      format: 'standard',
      playerCategory: 'midrange',
      opponentCategory: 'control',
      bringIn: [
        {
          cardName: 'Duress',
          count: 3,
          reason: 'Strip counterspells and sweepers before they resolve',
          source: 'coverage',
          confidence: 'high',
        },
        {
          cardName: 'Thoughtseize',
          count: 2,
          reason: 'Peek at hand and disrupt their game plan',
          source: 'coverage',
          confidence: 'high',
        },
        {
          cardName: 'Rending Flame',
          count: 2,
          reason: 'Exile problematic creatures like Adeline',
          source: 'meta-data',
          confidence: 'medium',
        },
      ],
      takeOut: [
        {
          cardName: 'Fatal Push',
          count: 2,
          reason: 'Too few targets in control lists',
          source: 'heuristic',
          confidence: 'medium',
        },
        {
          cardName: 'Meatcleaver Imp',
          count: 2,
          reason: 'Easily blocked and removed by control',
          source: 'heuristic',
          confidence: 'medium',
        },
        {
          cardName: 'Undying Malice',
          count: 2,
          reason: 'Recursion is too slow when opponent has sweepers',
          source: 'heuristic',
          confidence: 'low',
        },
        {
          cardName: 'Sheoldred\'s Edict',
          count: 1,
          reason: 'Sacrifice effects less effective vs control with few creatures',
          source: 'heuristic',
          confidence: 'low',
        },
      ],
      generalNotes:
        'Discard is your best weapon. Strip their answers before they can use them. Deploy threats one at a time to avoid overextending into sweepers.',
      estimatedWinRateDelta: +9,
      sources: [
        {
          type: 'pro-tour',
          description:
            'Pro Tour Orzhov pilots consistently cite Duress as the key sideboard card vs control',
          event: 'Pro Tour 2024',
        },
      ],
    },
  ],

  'standard:Azorius Control:vs:Orzhov Midrange': [
    {
      matchup: 'Azorius Control vs Orzhov Midrange',
      playerArchetype: 'Azorius Control',
      opponentArchetype: 'Orzhov Midrange',
      format: 'standard',
      playerCategory: 'control',
      opponentCategory: 'midrange',
      bringIn: [
        {
          cardName: 'Fade from Existence',
          count: 2,
          reason: 'Exile enchantments and key midrange permanents',
          source: 'coverage',
          confidence: 'high',
        },
        {
          cardName: 'Binding the Old Gods',
          count: 2,
          reason: 'Remove problematic enchantments cleanly',
          source: 'meta-data',
          confidence: 'medium',
        },
        {
          cardName: 'Hallowed Moonlight',
          count: 2,
          reason: 'Shut down token generation and graveyard recursion',
          source: 'coverage',
          confidence: 'medium',
        },
      ],
      takeOut: [
        {
          cardName: 'Essence Scatter',
          count: 2,
          reason: 'Midrange threats come down before countermagic is online',
          source: 'heuristic',
          confidence: 'medium',
        },
        {
          cardName: 'Planeswalker\'s Miscalculation',
          count: 2,
          reason: 'Less effective when opponent uses discard to strip it',
          source: 'heuristic',
          confidence: 'low',
        },
        {
          cardName: 'Absorb',
          count: 2,
          reason: 'Lifegain less relevant against midrange than hard removal',
          source: 'heuristic',
          confidence: 'low',
        },
      ],
      generalNotes:
        'Use removal that exiles to handle recursive threats. Be wary of discard — keep redundant answers. Deploy threats that demand immediate answers.',
      estimatedWinRateDelta: +6,
      sources: [
        {
          type: 'meta-analysis',
          description:
            'Meta data shows exile effects overperform vs Orzhov recursion',
        },
      ],
    },
  ],
};

export function getSideboardRecommendation(
  playerArchetype: string,
  opponentArchetype: string,
  format: MagicFormat,
  currentSideboard: string[] = []
): MatchupSideboardGuide | null {
  const key = matchupKey({ playerArchetype, opponentArchetype, format });
  const guides = sideboardDatabase[key];

  if (!guides || guides.length === 0) return null;

  const guide = guides[0];

  return filterSwapsForCurrentSideboard(guide, currentSideboard);
}

function filterSwapsForCurrentSideboard(
  guide: MatchupSideboardGuide,
  currentSideboard: string[]
): MatchupSideboardGuide {
  if (currentSideboard.length === 0) return guide;

  const sideboardSet = new Set(currentSideboard);

  const bringIn = guide.bringIn.filter((swap) =>
    sideboardSet.has(swap.cardName)
  );
  const takeOut = guide.takeOut.filter((swap) =>
    sideboardSet.has(swap.cardName)
  );

  const missingInCards = guide.bringIn.filter(
    (swap) => !sideboardSet.has(swap.cardName)
  );
  const missingOutCards = guide.takeOut.filter(
    (swap) => !sideboardSet.has(swap.cardName)
  );

  const extraNotes: string[] = [];
  if (missingInCards.length > 0) {
    const names = missingInCards.map((c) => c.cardName).join(', ');
    extraNotes.push(`Missing from sideboard (bring in): ${names}`);
  }
  if (missingOutCards.length > 0) {
    const names = missingOutCards.map((c) => c.cardName).join(', ');
    extraNotes.push(`Missing from deck (take out): ${names}`);
  }

  const allMissing = [...missingInCards, ...missingOutCards];
  const adjustedDelta =
    guide.estimatedWinRateDelta -
    allMissing.reduce(
      (sum, card) =>
        sum + (card.confidence === 'high' ? 3 : card.confidence === 'medium' ? 2 : 1),
      0
    );

  return {
    ...guide,
    bringIn: [...bringIn, ...missingInCards.map((c) => ({ ...c, confidence: 'low' as const }))],
    takeOut: [...takeOut, ...missingOutCards.map((c) => ({ ...c, confidence: 'low' as const }))],
    generalNotes:
      extraNotes.length > 0
        ? `${guide.generalNotes}\n\n[Limitations] ${extraNotes.join(' | ')}`
        : guide.generalNotes,
    estimatedWinRateDelta: adjustedDelta,
  };
}

export function getAvailableMatchups(format: MagicFormat): Array<{
  playerArchetype: string;
  opponentArchetype: string;
  matchup: string;
}> {
  const matchups: Array<{
    playerArchetype: string;
    opponentArchetype: string;
    matchup: string;
  }> = [];
  const seen = new Set<string>();

  for (const [key, guides] of Object.entries(sideboardDatabase)) {
    if (!key.startsWith(`${format}:`)) continue;
    for (const guide of guides) {
      const pair = `${guide.playerArchetype}|${guide.opponentArchetype}`;
      if (seen.has(pair)) continue;
      seen.add(pair);
      matchups.push({
        playerArchetype: guide.playerArchetype,
        opponentArchetype: guide.opponentArchetype,
        matchup: guide.matchup,
      });
    }
  }

  return matchups;
}

export function getMatchupSideboardPlans(
  playerArchetype: string,
  format: MagicFormat
): MatchupSideboardGuide[] {
  const results: MatchupSideboardGuide[] = [];

  for (const [key, guides] of Object.entries(sideboardDatabase)) {
    if (!key.startsWith(`${format}:`)) continue;
    if (!key.includes(`:${playerArchetype}:`)) continue;
    results.push(...guides);
  }

  return results;
}

export function searchSideboardRecommendations(
  format: MagicFormat,
  query: string
): MatchupSideboardGuide[] {
  const lower = query.toLowerCase();
  const results: MatchupSideboardGuide[] = [];

  for (const [key, guides] of Object.entries(sideboardDatabase)) {
    if (!key.startsWith(`${format}:`)) continue;
    for (const guide of guides) {
      const matchesArchetype =
        guide.playerArchetype.toLowerCase().includes(lower) ||
        guide.opponentArchetype.toLowerCase().includes(lower);
      const matchesCard = guide.bringIn.some((s) =>
        s.cardName.toLowerCase().includes(lower)
      );
      const matchesCategory =
        guide.playerCategory.includes(lower) ||
        guide.opponentCategory.includes(lower);

      if (matchesArchetype || matchesCard || matchesCategory) {
        results.push(guide);
      }
    }
  }

  return results;
}

export function getHighConfidenceSwaps(
  guide: MatchupSideboardGuide | null
): { bringIn: SideboardSwap[]; takeOut: SideboardSwap[] } {
  if (!guide) return { bringIn: [], takeOut: [] };
  return {
    bringIn: guide.bringIn.filter((s) => s.confidence === 'high'),
    takeOut: guide.takeOut.filter((s) => s.confidence === 'high'),
  };
}

export function getUniqueRecommendedCards(
  format: MagicFormat,
  archetype: string
): Map<string, { cardName: string; count: number; reasons: string[] }> {
  const cardMap = new Map<
    string,
    { cardName: string; count: number; reasons: string[] }
  >();

  const guides = getMatchupSideboardPlans(archetype, format);
  for (const guide of guides) {
    for (const swap of guide.bringIn) {
      const existing = cardMap.get(swap.cardName);
      if (existing) {
        existing.count = Math.max(existing.count, swap.count);
        if (!existing.reasons.includes(swap.reason)) {
          existing.reasons.push(swap.reason);
        }
      } else {
        cardMap.set(swap.cardName, {
          cardName: swap.cardName,
          count: swap.count,
          reasons: [swap.reason],
        });
      }
    }
  }

  return cardMap;
}

export { type SideboardCard };
