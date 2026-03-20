/**
 * @fileOverview Context builder for the conversational AI coach.
 * Converts deck data and metadata into LLM-friendly formats.
 */

import { ChatMessage } from '@/types/chat';

// Reuse types from actions.ts to avoid duplication or circular deps
export interface MinimalCard {
  id: string;
  name: string;
  cmc: number;
  type_line: string;
  colors: string[];
  color_identity: string[];
  legalities: Record<string, string>;
  oracle_text?: string;
  mana_cost?: string;
  image_uris?: {
    small: string;
    normal: string;
    large: string;
  };
}

export interface ScryfallCard extends MinimalCard {
  power?: string;
  toughness?: string;
  keywords?: string[];
  faces?: number;
}

export interface DeckCard extends ScryfallCard {
  count: number;
}

/**
 * Formats a decklist into a concise text representation for the LLM.
 * Groups cards by type and includes key info like CMC.
 */
export function formatDeckForLLM(cards: DeckCard[]): string {
  if (!cards || cards.length === 0) {
    return 'No cards in deck yet.';
  }

  // Group by type
  const grouped: Record<string, DeckCard[]> = {
    'Creatures': [],
    'Planeswalkers': [],
    'Instants/Sorceries': [],
    'Artifacts/Enchantments': [],
    'Lands': [],
    'Other': []
  };

  cards.forEach(card => {
    const type = card.type_line.toLowerCase();
    if (type.includes('creature')) grouped['Creatures'].push(card);
    else if (type.includes('planeswalker')) grouped['Planeswalkers'].push(card);
    else if (type.includes('instant') || type.includes('sorcery')) grouped['Instants/Sorceries'].push(card);
    else if (type.includes('artifact') || type.includes('enchantment')) grouped['Artifacts/Enchantments'].push(card);
    else if (type.includes('land')) grouped['Lands'].push(card);
    else grouped['Other'].push(card);
  });

  let output = '';
  for (const [groupName, groupCards] of Object.entries(grouped)) {
    if (groupCards.length > 0) {
      output += `\n### ${groupName}\n`;
      output += groupCards
        .map(card => `${card.count}x ${card.name} (${card.mana_cost || 'No cost'})`)
        .join('\n');
      output += '\n';
    }
  }

  return output.trim();
}

/**
 * Formats a digested context into a concise text representation for the LLM.
 * This is used for payload reduction when the full deck/game state is too large.
 */
export function formatDigestedContextForLLM(context: any): string {
  if (!context) return '';
  
  let output = '### Digested Game Context\n';
  
  if (context.deckSummary) {
    const ds = context.deckSummary;
    output += `**Deck Stats**: ${ds.totalCards} cards, Avg CMC: ${ds.averageCmc.toFixed(2)}, Colors: ${ds.colors.join(', ')}\n`;
    output += `**Types**: ${Object.entries(ds.typeCounts).map(([type, count]) => `${count} ${type}`).join(', ')}\n`;
    output += `**Key Cards**: ${ds.keyCards.join(', ')}\n`;
    output += `**Mana Curve**: ${ds.manaCurve.join('/')}\n\n`;
  }
  
  if (context.gameSummary) {
    const gs = context.gameSummary;
    output += `**Current Game**: Turn ${gs.turn}, Phase: ${gs.phase}, Active: ${gs.activePlayerId}\n`;
    gs.players.forEach((p: any) => {
      output += `- **${p.id}**: Life: ${p.life}, Hand: ${p.handSize}, Mana: ${p.manaAvailable}`;
      if (p.keyPermanents && p.keyPermanents.length > 0) {
        output += `, Board: ${p.keyPermanents.join(', ')}`;
      }
      output += '\n';
    });
  }
  
  return output.trim();
}

/**
 * Builds the system context for the AI coach.
 * Includes format, archetype, and any specific constraints or strategy.
 */
export function buildCoachSystemPrompt(
  format: string,
  deckList: string,
  archetype?: string,
  strategy?: string,
  digestedContext?: string
): string {
  let prompt = `You are an expert Magic: The Gathering coach. You are helping a player improve their deck.\n\n`;
  prompt += `**Current Format**: ${format}\n`;
  
  if (archetype) {
    prompt += `**Detected Archetype**: ${archetype}\n`;
  }
  
  if (strategy) {
    prompt += `**General Strategy**: ${strategy}\n`;
  }

  if (digestedContext) {
    prompt += `\n${digestedContext}\n`;
  }

  if (deckList && deckList !== 'No cards in deck yet.') {
    prompt += `\n**Decklist**:\n${deckList}\n\n`;
  }

  prompt += `Your goal is to provide strategic advice, card recommendations, and answer questions about the deck's performance. `;
  prompt += `Be encouraging but honest about card quality and synergy. `;
  prompt += `When suggesting cards to cut, explain why (e.g., too expensive, off-plan, redundant). `;
  prompt += `When suggesting cards to add, highlight their synergy with the existing cards.\n`;
  
  prompt += `\nYou have access to the searchCardsTool. Use it to find cards that might be better than the current choices or to explore new options. `;
  prompt += `Focus on identifying win conditions and ensuring the deck has a consistent game plan.\n\n`;

  prompt += `Handle the following intents based on user messages:\n`;
  prompt += `- **Analyze/Review**: Give a general overview of the deck's strengths and weaknesses.\n`;
  prompt += `- **Wincon**: Identify the primary and secondary ways the deck wins games.\n`;
  prompt += `- **Cut**: Recommend specific cards to remove, prioritizing those that don't fit the deck's goals.\n`;
  prompt += `- **Swap/Add**: Suggest new cards to add, either to fill holes or improve overall power level.\n`;
  prompt += `- **Card Analysis**: Provide a detailed breakdown of a specific card's role in the current deck context.`;

  return prompt;
}

/**
 * Prepares the conversation history for the LLM.
 * Ensures the most recent messages are prioritized within the context window.
 */
export function prepareConversationHistory(
  messages: ChatMessage[],
  maxMessages: number = 10
): Array<{ role: 'user' | 'assistant' | 'system'; content: string }> {
  // Map ChatMessage to Vercel AI SDK message format
  const mapped = messages.map(m => ({
    role: m.role as 'user' | 'assistant' | 'system',
    content: m.content
  }));

  // Take the last N messages
  return mapped.slice(-maxMessages);
}
