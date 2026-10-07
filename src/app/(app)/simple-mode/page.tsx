"use client";

/**
 * Simple mode (#2557): manamind's simple ruleset (Forests and vanilla
 * creatures, no stack, two identical 40-card decks) against a manamind
 * opponent: Easy, Medium, Hard or Expert (#2573). You are player 0; the
 * opponent is player 1 and searches only what it can see.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  applySimpleMove,
  availableMana,
  createSimpleGame,
  isSimpleGameOver,
  simpleLegalMoves,
  simpleWinner,
  type SimpleCard,
  type SimpleGameState,
  type SimpleMove,
  type SimplePlayer,
} from "@/ai/manamind/simple-rules";
import {
  loadSimplePolicyModel,
  type SimplePolicyModel,
} from "@/ai/manamind/simple-model";
import {
  chooseTierMove,
  SIMPLE_TIER_ORDER,
  SIMPLE_TIERS,
  type SimpleTier,
} from "@/ai/manamind/simple-tiers";
import { describeSimpleMove } from "@/ai/manamind/describe-move";

const HUMAN = 0 as const;
const OPPONENT = 1 as const;
/** Pause before the opponent acts, so its moves can be followed. */
export const OPPONENT_DELAY_MS = 400;
const MAX_LOG = 12;

type ModelStatus = "loading" | "ready" | "error";

function CardChip({ card }: { card: SimpleCard }) {
  const stats = card.isLand ? "" : ` ${card.power}/${card.toughness}`;
  const flags = [
    card.tapped ? "tapped" : null,
    card.summoningSick && !card.isLand ? "sick" : null,
    card.attacking ? "attacking" : null,
  ].filter(Boolean);
  return (
    <span
      className={`inline-block rounded border px-2 py-1 text-xs ${
        card.tapped ? "opacity-60" : ""
      }`}
    >
      {card.name}
      {stats}
      {flags.length > 0 ? ` (${flags.join(", ")})` : ""}
    </span>
  );
}

function Zone({ title, cards }: { title: string; cards: SimpleCard[] }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">
        {title} ({cards.length})
      </p>
      <div className="flex flex-wrap gap-1">
        {cards.map((c, i) => (
          <CardChip key={`${c.name}-${i}`} card={c} />
        ))}
      </div>
    </div>
  );
}

function PlayerPanel({
  label,
  player,
  showHand,
  testId,
}: {
  label: string;
  player: SimplePlayer;
  showHand: boolean;
  testId: string;
}) {
  return (
    <Card data-testid={testId}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-base">
          <span>{label}</span>
          <span>
            Life <span data-testid={`${testId}-life`}>{player.life}</span>
          </span>
        </CardTitle>
        <CardDescription>
          Library {player.library.length} · Graveyard {player.graveyard.length}{" "}
          · Mana available {availableMana(player)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Zone
          title="Battlefield"
          cards={player.battlefield.filter((c) => !c.isLand)}
        />
        <Zone
          title="Lands"
          cards={player.battlefield.filter((c) => c.isLand)}
        />
        {showHand ? (
          <Zone title="Hand" cards={player.hand} />
        ) : (
          <p className="text-xs text-muted-foreground">
            Hand: {player.hand.length} cards
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function SimpleModePage() {
  // Dealt on the client only: a server-side shuffle would not match the
  // client's and break hydration.
  const [game, setGame] = useState<SimpleGameState | null>(null);
  const [model, setModel] = useState<SimplePolicyModel | null>(null);
  const [status, setStatus] = useState<ModelStatus>("loading");
  const [log, setLog] = useState<string[]>([]);
  const [tier, setTier] = useState<SimpleTier>("easy");
  const spec = SIMPLE_TIERS[tier];
  const thinking = useRef(false);

  const load = useCallback(() => {
    setStatus("loading");
    loadSimplePolicyModel()
      .then((m) => {
        setModel(m);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }, []);

  useEffect(() => {
    load();
    setGame(createSimpleGame());
  }, [load]);

  const play = useCallback(
    (state: SimpleGameState, who: string, move: SimpleMove) => {
      const label = describeSimpleMove(state, move);
      setLog((l) => [`${who}: ${label}`, ...l].slice(0, MAX_LOG));
      setGame(applySimpleMove(state, move));
    },
    [],
  );

  const over = game ? isSimpleGameOver(game) : false;
  const legal = game && !over ? simpleLegalMoves(game) : [];
  const humanToAct = !!game && !over && game.priorityPlayer === HUMAN;

  // The opponent acts when it has priority.
  useEffect(() => {
    if (!game || over || game.priorityPlayer !== OPPONENT || !model) return;
    if (thinking.current) return;
    thinking.current = true;
    const timer = setTimeout(() => {
      chooseTierMove(game, model, tier)
        .then(({ move }) => {
          play(game, SIMPLE_TIERS[tier].label, move);
        })
        .finally(() => {
          thinking.current = false;
        });
    }, OPPONENT_DELAY_MS);
    return () => {
      clearTimeout(timer);
      thinking.current = false;
    };
  }, [game, model, over, play, tier]);

  // A move you have no choice about is made for you.
  useEffect(() => {
    if (!game || !humanToAct || legal.length !== 1) return;
    play(game, "You", legal[0]);
  }, [game, humanToAct, legal, play]);

  const newGame = () => {
    setGame(createSimpleGame());
    setLog([]);
  };

  const chooseTier = (next: SimpleTier) => {
    if (next === tier) return;
    setTier(next);
    newGame();
  };

  const winner = game && over ? simpleWinner(game) : null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4 md:p-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">Simple mode</h1>
        <p className="text-sm text-muted-foreground">
          Forests and vanilla creatures against a manamind opponent. No stack,
          no abilities: play lands, cast creatures, attack and block.
        </p>
      </div>

      <div className="space-y-2">
        <div
          role="radiogroup"
          aria-label="Opponent strength"
          className="flex flex-wrap gap-2"
          data-testid="simple-tiers"
        >
          {SIMPLE_TIER_ORDER.map((t) => (
            <Button
              key={t}
              size="sm"
              role="radio"
              aria-checked={t === tier}
              variant={t === tier ? "default" : "outline"}
              onClick={() => chooseTier(t)}
            >
              {SIMPLE_TIERS[t].label}
            </Button>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          {spec.description} Changing the opponent starts a new game.
        </p>
      </div>

      {status === "loading" && <p role="status">Loading the opponent…</p>}
      {status === "error" && (
        <div role="alert" className="flex items-center gap-2">
          <span>The opponent couldn&apos;t load.</span>
          <Button size="sm" variant="outline" onClick={load}>
            Try again
          </Button>
        </div>
      )}

      {game && (
        <>
          <PlayerPanel
            label={`${spec.label} opponent`}
            player={game.players[OPPONENT]}
            showHand={false}
            testId="simple-opponent"
          />

          <Card>
            <CardContent className="flex flex-wrap items-center gap-2 pt-4">
              <Badge variant="secondary">Turn {game.turn}</Badge>
              <Badge variant="secondary" data-testid="simple-phase">
                {game.phase}
              </Badge>
              <Badge>
                {game.activePlayer === HUMAN ? "Your turn" : "Opponent's turn"}
              </Badge>
              {over ? (
                <span className="font-semibold" data-testid="simple-result">
                  {winner === HUMAN
                    ? "You win!"
                    : winner === OPPONENT
                      ? `${spec.label} wins.`
                      : "Draw."}
                </span>
              ) : !humanToAct ? (
                <span className="text-sm text-muted-foreground">
                  {spec.label} is thinking…
                </span>
              ) : null}
              <Button
                size="sm"
                variant="outline"
                className="ml-auto"
                onClick={newGame}
              >
                New game
              </Button>
            </CardContent>
          </Card>

          {humanToAct && legal.length > 1 && (
            <div className="flex flex-wrap gap-2" data-testid="simple-moves">
              {legal.map((move, i) => {
                const label = describeSimpleMove(game, move);
                return (
                  <Button
                    key={`${i}-${label}`}
                    size="sm"
                    onClick={() => play(game, "You", move)}
                  >
                    {label}
                  </Button>
                );
              })}
            </div>
          )}

          <PlayerPanel
            label="You"
            player={game.players[HUMAN]}
            showHand
            testId="simple-you"
          />
        </>
      )}

      {log.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Recent moves</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-1 text-sm" data-testid="simple-log">
              {log.map((entry, i) => (
                <li key={`${i}-${entry}`}>{entry}</li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
