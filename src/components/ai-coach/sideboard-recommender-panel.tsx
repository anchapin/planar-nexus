'use client';

import { useSideboardRecommender } from '@/hooks/use-sideboard-recommender';
import type { MagicFormat } from '@/lib/meta';
import type { SideboardSwap, MatchupSideboardGuide } from '@/lib/sideboard-recommender';

function ConfidenceBadge({ confidence }: { confidence: SideboardSwap['confidence'] }) {
  const colors: Record<SideboardSwap['confidence'], string> = {
    high: 'bg-green-100 text-green-800 border-green-200',
    medium: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    low: 'bg-red-100 text-red-800 border-red-200',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium border ${colors[confidence]}`}>
      {confidence}
    </span>
  );
}

function SwapList({
  swaps,
  direction,
}: {
  swaps: SideboardSwap[];
  direction: 'in' | 'out';
}) {
  const icon = direction === 'in' ? '↑' : '↓';
  const label = direction === 'in' ? 'Bring In' : 'Take Out';

  if (swaps.length === 0) {
    return (
      <div className="text-sm text-gray-400 italic">
        No {direction === 'in' ? 'cards to bring in' : 'cards to take out'}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold text-gray-700">
        {icon} {label} ({swaps.reduce((sum, s) => sum + s.count, 0)} cards)
      </h4>
      <ul className="space-y-1">
        {swaps.map((swap, i) => (
          <li key={`${swap.cardName}-${i}`} className="flex items-start gap-2 text-sm">
            <span className="font-mono text-xs bg-gray-100 rounded px-1.5 py-0.5 shrink-0">
              {swap.count}x
            </span>
            <div className="flex-1 min-w-0">
              <span className="font-medium">{swap.cardName}</span>
              <span className="text-gray-500 ml-2">{swap.reason}</span>
            </div>
            <ConfidenceBadge confidence={swap.confidence} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function SourceBadges({ sources }: { sources: MatchupSideboardGuide['sources'] }) {
  const typeLabels: Record<string, string> = {
    'pro-tour': 'Pro Tour',
    'scg-tour': 'SCG Tour',
    'tournament-recap': 'Tournament',
    'meta-analysis': 'Meta Data',
  };

  return (
    <div className="flex flex-wrap gap-1 mt-2">
      {sources.map((source, i) => (
        <span
          key={i}
          className="inline-block px-2 py-0.5 rounded-full text-xs bg-blue-50 text-blue-700 border border-blue-200"
          title={source.description}
        >
          {typeLabels[source.type] ?? source.type}
        </span>
      ))}
    </div>
  );
}

function RecommendationView({
  guide,
}: {
  guide: MatchupSideboardGuide;
}) {
  const delta = guide.estimatedWinRateDelta;
  const deltaColor =
    delta >= 8
      ? 'text-green-600'
      : delta >= 4
        ? 'text-green-500'
        : 'text-yellow-500';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">{guide.matchup}</h3>
        <span className={`text-sm font-medium ${deltaColor}`}>
          {delta >= 0 ? '+' : ''}
          {delta}% est. win rate delta
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-green-50 border border-green-200 rounded-lg p-3">
          <SwapList swaps={guide.bringIn} direction="in" />
        </div>
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <SwapList swaps={guide.takeOut} direction="out" />
        </div>
      </div>

      <div className="bg-gray-50 rounded-lg p-3">
        <h4 className="text-sm font-semibold text-gray-700 mb-1">Strategy Notes</h4>
        <p className="text-sm text-gray-600 whitespace-pre-line">
          {guide.generalNotes}
        </p>
      </div>

      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-1">Sources</h4>
        <SourceBadges sources={guide.sources} />
      </div>
    </div>
  );
}

interface SideboardRecommenderPanelProps {
  format?: MagicFormat;
  playerArchetype?: string;
  opponentArchetype?: string;
  currentSideboard?: string[];
  onRecommendationSelect?: (guide: MatchupSideboardGuide) => void;
}

export function SideboardRecommenderPanel({
  format = 'standard',
  playerArchetype: initialPlayer,
  opponentArchetype: initialOpponent,
  currentSideboard = [],
  onRecommendationSelect,
}: SideboardRecommenderPanelProps) {
  const {
    recommendation,
    availableMatchups,
    isLoading,
    error,
    getPlayerArchetypes,
    getOpponentArchetypes,
    fetchRecommendation,
  } = useSideboardRecommender({ format });

  const playerArchetypes = getPlayerArchetypes();
  const opponentArchetypes = initialPlayer
    ? getOpponentArchetypes(initialPlayer)
    : [];

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const player = (form.elements.namedItem('playerArchetype') as HTMLSelectElement).value;
    const opponent = (form.elements.namedItem('opponentArchetype') as HTMLSelectElement).value;
    if (player && opponent) {
      fetchRecommendation(player, opponent, currentSideboard);
    }
  }

  function handleSelectRecommendation(guide: MatchupSideboardGuide) {
    onRecommendationSelect?.(guide);
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="playerArchetype" className="block text-sm font-medium text-gray-700 mb-1">
              Your Deck
            </label>
            <select
              id="playerArchetype"
              name="playerArchetype"
              defaultValue={initialPlayer ?? ''}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            >
              <option value="">Select archetype...</option>
              {playerArchetypes.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="opponentArchetype" className="block text-sm font-medium text-gray-700 mb-1">
              Opponent
            </label>
            <select
              id="opponentArchetype"
              name="opponentArchetype"
              defaultValue={initialOpponent ?? ''}
              disabled={!initialPlayer}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
            >
              <option value="">Select opponent...</option>
              {opponentArchetypes.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button
          type="submit"
          disabled={isLoading}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {isLoading ? 'Loading...' : 'Get Recommendations'}
        </button>
      </form>

      {error && (
        <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-md text-sm text-yellow-800">
          {error}
        </div>
      )}

      {recommendation && (
        <div
          className="border border-gray-200 rounded-lg p-4 cursor-pointer hover:border-blue-300 transition-colors"
          onClick={() => handleSelectRecommendation(recommendation)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSelectRecommendation(recommendation);
          }}
        >
          <RecommendationView guide={recommendation} />
        </div>
      )}

      {availableMatchups.length > 0 && !recommendation && (
        <div className="text-xs text-gray-400">
          {availableMatchups.length} matchup guides available for {format}
        </div>
      )}
    </div>
  );
}
