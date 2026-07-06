/**
 * Issue #1254 — surfaced reconnect tokens.
 *
 * Client component that renders the list of persisted reconnect tokens
 * on the multiplayer landing page. A returning peer who refreshed
 * mid-game can rejoin their previous seat with one click instead of
 * re-entering the game code manually.
 *
 * Hidden when the token store is empty so the panel does not add
 * visual noise on a fresh device. The "Resume" link carries the
 * `gameCode` to the p2p-join page; the page can then call
 * {@link import("@/hooks/use-reconnect-tokens").useReconnectToken} to
 * surface the token + playerName for a one-tap resume.
 */

"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { RotateCcw, X } from "lucide-react";
import { useReconnectTokens } from "@/hooks/use-reconnect-tokens";

function formatRelativeExpiry(expiresAt: number): string {
  const ms = expiresAt - Date.now();
  if (ms <= 0) return "expired";
  const minutes = Math.max(1, Math.round(ms / 60_000));
  return `expires in ${minutes}m`;
}

export function ReconnectTokenList() {
  const { tokens, loading, remove } = useReconnectTokens();

  if (loading && tokens.length === 0) return null;
  if (tokens.length === 0) return null;

  return (
    <section
      className="mt-6"
      aria-label="Games you can resume"
      data-testid="reconnect-token-list"
    >
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RotateCcw className="w-5 h-5" />
            Resume a Game
          </CardTitle>
          <CardDescription>
            We saved your seat from before the page reloaded. Pick a game
            below to drop back into it — no need to re-enter the code.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {tokens.map((token) => (
              <li
                key={token.id}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2"
                data-testid={`reconnect-token-row-${token.gameCode}`}
              >
                <div className="min-w-0">
                  <div className="font-mono text-sm font-medium">
                    {token.gameCode}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {token.playerName
                      ? `as ${token.playerName}`
                      : "anonymous seat"}{" "}
                    · {formatRelativeExpiry(token.expiresAt)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    asChild
                    size="sm"
                    data-testid={`reconnect-token-resume-${token.gameCode}`}
                  >
                    <Link
                      href={`/multiplayer/p2p-join?code=${encodeURIComponent(
                        token.gameCode,
                      )}&resume=1`}
                    >
                      Resume
                    </Link>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Dismiss reconnect token for ${token.gameCode}`}
                    onClick={() => remove(token.gameCode, token.peerId)}
                    data-testid={`reconnect-token-dismiss-${token.gameCode}`}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </section>
  );
}