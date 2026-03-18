/**
 * Draft Page
 *
 * Phase 15: Draft Core
 * Requirements: DRFT-04, DRFT-05, DRFT-06, DRFT-07, DRFT-08
 *
 * Features:
 * - Create new draft session (?set={code})
 * - Load existing draft (?session={id})
 * - Pick cards from packs
 * - View draft pool
 * - Session persistence
 * - Draft timer with color states (DRFT-06, DRFT-07)
 * - Auto-pick or skip dialog on timer expiry (DRFT-08)
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DraftPicker, useDraftPicker, pickCard, openCurrentPack, advanceToNextPack } from "@/components/draft-picker";
import { DraftPoolView } from "@/components/draft-pool-view";
import { DraftTimer } from "@/components/draft-timer";
import { SkipPickDialog } from "@/components/skip-pick-dialog";
import { useDraftTimer, DRAFT_TIMER_CONFIG } from "@/hooks/use-draft-timer";
import { createDraftSession, isDraftComplete } from "@/lib/limited/draft-generator";
import { getSession, saveDraftSession } from "@/lib/limited/pool-storage";
import { getSetDetails } from "@/lib/limited/set-service";
import type { DraftSession } from "@/lib/limited/types";
import { Loader2, Package, Play } from "lucide-react";

// ============================================================================
// Constants
// ============================================================================

const PACKS_PER_DRAFT = 3;
const CARDS_PER_PACK = 14;

// ============================================================================
// Component
// ============================================================================

export default function DraftPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Get URL params
  const sessionId = searchParams.get("session");
  const setCode = searchParams.get("set");

  // State
  const [session, setSession] = useState<DraftSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setName, setSetName] = useState<string>("");
  const [showSkipDialog, setShowSkipDialog] = useState(false);
  const [isTimerActive, setIsTimerActive] = useState(false);

  // Draft timer hook (DRFT-06, DRFT-07, DRFT-08)
  const {
    timeRemaining,
    colorState,
    start: startTimer,
    pause: pauseTimer,
    reset: resetTimer,
    handleExpire,
    lastHoveredCardId,
  } = useDraftTimer({
    initialSeconds: DRAFT_TIMER_CONFIG.defaultSeconds,
    autoStart: false,
    lastHoveredCardId: session?.lastHoveredCardId ?? null,
    onExpire: () => {
      // Timer expired - handle via handleExpire
    },
    onPickCard: (cardId) => {
      // Auto-pick the hovered card
      if (session) {
        const updatedSession = pickCard(session, cardId);
        setSession(updatedSession);
        resetTimer();
        // Check if draft is complete
        if (isDraftComplete(updatedSession)) {
          setIsTimerActive(false);
        }
      }
    },
    onShowSkipDialog: () => {
      setShowSkipDialog(true);
    },
  });

  // Draft picker hooks
  const {
    handlePickCard: draftPickerPick,
    handleOpenPack,
    handleHoverCard: draftPickerHover,
    handleAdvanceToNextPack,
  } = session ? useDraftPicker(session, setSession) : {
    handlePickCard: () => {},
    handleOpenPack: () => {},
    handleHoverCard: () => {},
    handleAdvanceToNextPack: () => {},
  };

  // Handle card pick - reset timer after pick
  const handleCardPick = useCallback((cardId: string) => {
    draftPickerPick(cardId);
    resetTimer();
    // Timer will be restarted when new pick starts
  }, [draftPickerPick, resetTimer]);

  // Handle card hover - track for auto-pick (DRFT-08)
  const handleHoverCard = useCallback((cardId: string | null) => {
    draftPickerHover(cardId);
    // Update session's lastHoveredCardId
    if (session) {
      setSession({
        ...session,
        lastHoveredCardId: cardId,
      });
    }
  }, [draftPickerHover, session]);

  // Handle skip dialog skip
  const handleSkip = useCallback(() => {
    setShowSkipDialog(false);
    // Advance to next pick/pack without picking a card
    if (session) {
      // For now, just skip to next pack or complete
      if (session.draftState === 'pack_complete') {
        // Move to next pack
        const updatedSession = advanceToNextPack(session);
        setSession(updatedSession);
        resetTimer();
        setIsTimerActive(true);
      } else {
        // Complete the draft or skip pick
        resetTimer();
      }
    }
  }, [session, resetTimer]);

  // Handle skip dialog cancel
  const handleCancelSkip = useCallback(() => {
    setShowSkipDialog(false);
    // Resume timer with remaining time
    setIsTimerActive(true);
    startTimer();
  }, [startTimer]);

  // Save session to IndexedDB on change (DRFT-10, DRFT-11)
  useEffect(() => {
    if (!session) return;

    const saveSession = async () => {
      try {
        // Save full draft session state for persistence/resume
        await saveDraftSession(session);
      } catch (err) {
        console.error("Failed to save session:", err);
      }
    };

    // Debounce saves
    const timeoutId = setTimeout(saveSession, 500);
    return () => clearTimeout(timeoutId);
  }, [session]);

  // Initialize session
  useEffect(() => {
    async function initSession() {
      setIsLoading(true);
      setError(null);

      try {
        if (sessionId) {
          // Load existing session
          const existingSession = await getSession(sessionId);
          if (!existingSession) {
            setError("Session not found");
            return;
          }
          if (existingSession.mode !== "draft") {
            setError("This is not a draft session");
            return;
          }
          setSession(existingSession as DraftSession);
          setSetName(existingSession.setName);
        } else if (setCode) {
          // Create new session
          setIsCreating(true);

          // Get set name
          let name = setCode.toUpperCase();
          try {
            const setDetails = await getSetDetails(setCode);
            if (setDetails) {
              name = setDetails.name;
              setSetName(name);
            }
          } catch {
            // Use set code as fallback
          }

          // Create draft session
          const newSession = await createDraftSession(
            setCode.toLowerCase(),
            name
          );

          setSession(newSession);

          // Redirect to session URL
          router.replace(`/draft?session=${newSession.id}`);
        } else {
          setError("No session ID or set code provided");
        }
      } catch (err) {
        console.error("Failed to initialize session:", err);
        setError(err instanceof Error ? err.message : "Failed to load session");
      } finally {
        setIsLoading(false);
        setIsCreating(false);
      }
    }

    initSession();
  }, [sessionId, setCode, router]);

  // Start draft
  const handleStartDraft = useCallback(() => {
    if (!session) return;

    // Open first pack
    const updatedSession = openCurrentPack(session);
    setSession(updatedSession);
    
    // Start timer when draft begins (DRFT-06)
    resetTimer();
    setIsTimerActive(true);
    startTimer();
  }, [session, setSession, resetTimer, startTimer]);

  // Loading state
  if (isLoading || isCreating) {
    return (
      <div className="flex h-full min-h-svh w-full flex-col items-center justify-center p-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
        <p className="text-muted-foreground">
          {isCreating ? "Creating draft..." : "Loading draft..."}
        </p>
      </div>
    );
  }

  // Error state
  if (error || !session) {
    return (
      <div className="flex h-full min-h-svh w-full flex-col items-center justify-center p-4">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="text-destructive">Error</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-4">
              {error || "Session not found"}
            </p>
            <Button onClick={() => router.push("/set-browser")}>
              Return to Set Browser
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Redirect to complete page when draft is finished (DRFT-09)
  useEffect(() => {
    if (session && isDraftComplete(session)) {
      // Update session status
      const updatedSession = {
        ...session,
        draftState: "draft_complete" as const,
        status: "completed" as const,
      };
      saveDraftSession(updatedSession);
      // Redirect to completion page
      router.replace(`/draft/complete?session=${session.id}`);
    }
  }, [session, router]);

  // Intro state - show start button
  if (session?.draftState === "intro") {
    return (
      <div className="flex h-full min-h-svh w-full flex-col items-center justify-center p-4">
        <Card className="max-w-lg w-full">
          <CardHeader className="text-center">
            <Package className="h-16 w-16 mx-auto mb-4 text-primary" />
            <CardTitle className="text-3xl">Draft: {setName}</CardTitle>
            <p className="text-muted-foreground mt-2">
              {PACKS_PER_DRAFT} packs • {CARDS_PER_PACK} cards per pack
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm text-muted-foreground space-y-2">
              <p>How Draft Works:</p>
              <ul className="list-disc list-inside space-y-1">
                <li>Open your pack to reveal {CARDS_PER_PACK} cards</li>
                <li>Pick one card to add to your pool</li>
                <li>Repeat until all {CARDS_PER_PACK} cards are picked</li>
                <li>Open your next pack and continue</li>
                <li>Build a {CARDS_PER_PACK * PACKS_PER_DRAFT}-card minimum deck</li>
              </ul>
            </div>
            <Button
              size="lg"
              className="w-full"
              onClick={handleStartDraft}
            >
              <Play className="h-5 w-5 mr-2" />
              Start Draft
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Drafting state - main UI
  return (
    <div className="flex h-full min-h-svh w-full flex-col">
      {/* Header with Timer (DRFT-06, DRFT-07) */}
      <DraftHeader
        session={session}
        onQuit={() => router.push("/set-browser")}
        timeRemaining={timeRemaining}
        colorState={colorState}
        isTimerActive={isTimerActive}
        onPauseTimer={pauseTimer}
        onResumeTimer={startTimer}
      />

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Pack View Area */}
        <div className="flex-1 overflow-auto p-4 lg:p-6">
          <DraftPicker
            session={session}
            onPickCard={handleCardPick}
            onHoverCard={handleHoverCard}
            onOpenPack={handleOpenPack}
          />
        </div>

        {/* Pool Sidebar */}
        <div className="hidden lg:block w-80 border-l">
          <DraftPoolView
            pool={session.pool}
            sessionId={session.id}
          />
        </div>
      </div>

      {/* Mobile Pool Bar */}
      <div className="lg:hidden border-t p-4 bg-card">
        <MobilePoolBar pool={session.pool} />
      </div>

      {/* Skip Pick Dialog (DRFT-08) */}
      <SkipPickDialog
        isOpen={showSkipDialog}
        onSkip={handleSkip}
        onCancel={handleCancelSkip}
      />
    </div>
  );
}

// ============================================================================
// Draft Header
// ============================================================================

interface DraftHeaderProps {
  session: DraftSession;
  onQuit: () => void;
  timeRemaining?: number;
  colorState?: 'green' | 'yellow' | 'red';
  isTimerActive?: boolean;
  onPauseTimer?: () => void;
  onResumeTimer?: () => void;
}

function DraftHeader({ 
  session, 
  onQuit, 
  timeRemaining, 
  colorState = 'green',
  isTimerActive = false,
  onPauseTimer,
  onResumeTimer,
}: DraftHeaderProps) {
  const currentPack = session.currentPackIndex + 1;
  const currentPick = session.currentPickIndex + 1;

  return (
    <div className="flex items-center justify-between p-4 border-b bg-card">
      <div className="flex items-center gap-4">
        <h1 className="font-headline text-xl font-bold flex items-center gap-2">
          <Package className="h-5 w-5" />
          Draft: {session.setName}
        </h1>

        <div className="flex items-center gap-2">
          <Badge variant="outline" className="font-mono">
            Pack {currentPack}/{PACKS_PER_DRAFT}
          </Badge>
          <Badge variant="outline" className="font-mono">
            Pick {currentPick}/{CARDS_PER_PACK}
          </Badge>
        </div>
      </div>

      {/* Timer (DRFT-06, DRFT-07) */}
      <div className="flex items-center gap-3">
        {timeRemaining !== undefined && isTimerActive && (
          <DraftTimer
            timeRemaining={timeRemaining}
            colorState={colorState}
            maxSeconds={DRAFT_TIMER_CONFIG.defaultSeconds}
            isPaused={!isTimerActive}
          />
        )}
        <Button variant="ghost" size="sm" onClick={onQuit}>
          Quit Draft
        </Button>
      </div>
    </div>
  );
}

// ============================================================================
// Mobile Pool Bar
// ============================================================================

interface MobilePoolBarProps {
  pool: DraftSession["pool"];
}

function MobilePoolBar({ pool }: MobilePoolBarProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Package className="h-5 w-5 text-muted-foreground" />
        <span className="font-medium">{pool.length} cards picked</span>
      </div>
      <Badge variant="secondary">
        {pool.length >= 40 ? "Ready to build" : `${40 - pool.length} more needed`}
      </Badge>
    </div>
  );
}

// ============================================================================
// Icon Re-export (for template)
// ============================================================================

function Layers({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  );
}
