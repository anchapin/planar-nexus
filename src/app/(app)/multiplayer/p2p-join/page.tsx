/**
 * P2P Join Page
 * Issue #641: Legal P2P Multiplayer
 * Issue #1728: Implement the QR-code join flow
 * Issue #2284: Bundle size budget fix — P2P/WebRTC code split to client component
 *
 * This page is a thin client wrapper that dynamically loads P2P/WebRTC logic.
 * P2PJoinClient is only loaded when the user interacts with the page,
 * keeping the initial bundle under the engine-size-budget.
 */

"use client";

import { Suspense } from "react";
import dynamic from "next/dynamic";
import { ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

function PageLoading() {
  return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
    </div>
  );
}

const P2PJoinClient = dynamic(() => import("./P2PJoinClient"), {
  loading: () => <PageLoading />,
});

export default function P2PJoinPage() {
  return (
    <div className="flex-1 p-4 md:p-6 max-w-4xl mx-auto">
      <Button
        variant="ghost"
        onClick={() => (window.location.href = "/multiplayer")}
        className="mb-4"
      >
        <ArrowLeft className="w-4 h-4 mr-2" />
        Back
      </Button>

      <header className="mb-6">
        <h1 className="font-headline text-3xl font-bold">Join P2P Game</h1>
        <p className="text-muted-foreground mt-1">
          Enter your name and the host&apos;s connection code to join
        </p>
      </header>

      <Suspense fallback={<PageLoading />}>
        <P2PJoinClient />
      </Suspense>
    </div>
  );
}
