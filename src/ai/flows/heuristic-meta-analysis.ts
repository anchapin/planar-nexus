'use server';
/**
 * @fileOverview Heuristic Meta Analysis
 *
 * This module provides metagame analysis using rule-based heuristics
 * instead of AI generation. It offers insights based on deck archetypes
 * and established Magic principles.
 */

export interface MetaAnalysisInput {
  format: string;
  deckList?: string;
  metagameData?: Array<{
    archetype: string;
    prevalence: number;
    strengths: string[];
    weaknesses: string[];
  }>;
}

export interface MetaAnalysisOutput {
  metagameSummary: string;
  topArchetypes: Array<{
    name: string;
    prevalence: string;
    strengths: string[];
    weaknesses: string[];
    goodMatchups: string[];
    badMatchups: string[];
  }>;
  recommendations: string[];
}

/**
 * Get archetype data for formats
 */
function getArchetypeData(format: string): MetaAnalysisOutput['topArchetypes'] {
  const commonArchetypes = [
    {
      name: 'Aggro',
      prevalence: '25%',
      strengths: [
        'Fast clock',
        'Cheap creatures',
        'Good against control',
      ],
      weaknesses: [
        'Vulnerable to sweepers',
        'Struggles against midrange',
        'Runs out of gas',
      ],
      goodMatchups: ['Control', 'Combo'],
      badMatchups: ['Midrange', 'Stabilized Board'],
    },
    {
      name: 'Control',
      prevalence: '20%',
      strengths: [
        'Strong late game',
        'Lots of interaction',
        'Good against midrange',
      ],
      weaknesses: [
        'Slow clock',
        'Vulnerable to aggro',
        'Needs specific answers',
      ],
      goodMatchups: ['Midrange', 'Combo'],
      badMatchups: ['Aggro', 'Aggressive Control'],
    },
    {
      name: 'Midrange',
      prevalence: '20%',
      strengths: [
        'Flexible answers',
        'Good threats',
        'Balanced approach',
      ],
      weaknesses: [
        'Can be too slow',
        'Vulnerable to specialized strategies',
      ],
      goodMatchups: ['Aggro', 'Control'],
      badMatchups: ['Combo', 'Specialized Midrange'],
    },
    {
      name: 'Combo',
      prevalence: '15%',
      strengths: [
        'Very fast wins',
        'Unpredictable',
        'Bypasses normal interaction',
      ],
      weaknesses: [
        'Vulnerable to disruption',
        'Inconsistent',
        'Weak to aggro',
      ],
      goodMatchups: ['Control', 'Slow Midrange'],
      badMatchups: ['Aggro', 'Disruption'],
    },
    {
      name: 'Tempo',
      prevalence: '10%',
      strengths: [
        'Early pressure',
        'Disruption',
        'Efficient threats',
      ],
      weaknesses: [
        'Fades late game',
        'Vulnerable to established boards',
      ],
      goodMatchups: ['Combo', 'Slow Strategies'],
      badMatchups: ['Midrange', 'Aggro'],
    },
    {
      name: 'Ramp',
      prevalence: '10%',
      strengths: [
        'Powerful threats',
        'Accelerates',
        'Good late game',
      ],
      weaknesses: [
        'Slow start',
        'Vulnerable to aggro',
      ],
      goodMatchups: ['Control', 'Midrange'],
      badMatchups: ['Aggro', 'Counterspells'],
    },
  ];

  return commonArchetypes;
}

/**
 * Generate metagame analysis
 */
export async function provideMetaAnalysis(
  input: MetaAnalysisInput
): Promise<MetaAnalysisOutput> {
  const { format, deckList } = input;

  const topArchetypes = input.metagameData || getArchetypeData(format);

  const metagameSummary = `The ${format} metagame is diverse with several competitive archetypes. ${
    topArchetypes[0].name
  } is currently the most popular at ${topArchetypes[0].prevalence}, followed by ${
    topArchetypes[1].name
  } and ${topArchetypes[2].name}.`;

  const recommendations: string[] = [
    'Prepare your deck for the most common archetypes',
    'Include flexible answers that handle multiple strategies',
    'Consider your deck\'s positioning in the current metagame',
    'Test against various matchups to understand your strengths and weaknesses',
  ];

  if (deckList) {
    recommendations.push('Review your deck\'s performance against top archetypes');
    recommendations.push('Adjust sideboard plans based on metagame composition');
  }

  return {
    metagameSummary,
    topArchetypes,
    recommendations,
  };
}
