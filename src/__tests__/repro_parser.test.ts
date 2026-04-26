
import { parseOracleText } from '../lib/game-state/oracle-text-parser';

const mockCard = (text: string) => ({
  name: 'Mock Card',
  oracle_text: text,
  type_line: 'Creature',
  mana_cost: '{1}',
});

describe('Repro Parser', () => {
  it('debugs triggered abilities', () => {
    const testCases = [
      "When this creature enters the battlefield, draw a card.",
      "Whenever you cast a spell, create a 1/1 blue Spirit token with flying.",
      "At the beginning of your upkeep, lose 1 life.",
    ];

    testCases.forEach(text => {
      const result = parseOracleText(mockCard(text) as any);
      console.log(`Text: "${text}"`);
      console.log(`Triggered Abilities: ${result.triggeredAbilities.length}`);
      
      const sentences = text.split(/\.\s*/).filter(s => s.length > 0);
      sentences.forEach(sentence => {
        const whenMatch = sentence.match(/\b(when|whenever)\s+(.+?),\s+(.+)/i);
        const atMatch = sentence.match(/\bat\s+(?:the\s+)?(.+?),\s+(.+)/i);
        console.log(`  Sentence: "${sentence}"`);
        console.log(`  whenMatch: ${!!whenMatch}`);
        if (whenMatch) {
          console.log(`    Group 2 (trigger): "${whenMatch[2]}"`);
          console.log(`    Group 3 (effect): "${whenMatch[3]}"`);
        }
        console.log(`  atMatch: ${!!atMatch}`);
        if (atMatch) {
          console.log(`    Group 1 (trigger): "${atMatch[1]}"`);
          console.log(`    Group 2 (effect): "${atMatch[2]}"`);
        }
      });
    });
  });
});
