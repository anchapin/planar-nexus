import { Suspense } from "react";
import type { Metadata } from "next";
import { GameLoading } from "./_components/GameLoading";
import { GameBoardContent } from "./GameBoardContent";

interface GamePageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    id?: string;
    mode?: string;
    difficulty?: string;
    deckId?: string;
    theme?: string;
  }>;
}

export const metadata: Metadata = {
  title: "Game | Planar Nexus",
};

export default async function GamePage({
  params,
  searchParams,
}: GamePageProps) {
  const [{ id: pageId }, sp] = await Promise.all([params, searchParams]);
  const gameId = sp.id ?? pageId;

  return (
    <Suspense fallback={<GameLoading />}>
      <GameBoardContent initialGameId={gameId} />
    </Suspense>
  );
}
