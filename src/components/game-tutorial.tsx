"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  X,
  ChevronRight,
  ChevronLeft,
  BookOpen,
  Lightbulb,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface TutorialStep {
  id: string;
  title: string;
  description: string;
  targetSelector?: string;
  position?: "top" | "bottom" | "left" | "right" | "center";
}

const DEFAULT_TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: "welcome",
    title: "Welcome to Single Player",
    description:
      "This is a quick guided tour of the game board. You can skip anytime, or access this tutorial later from the help button.",
    position: "center",
  },
  {
    id: "phase-info",
    title: "Turn & Phase",
    description:
      "The current turn number and game phase are displayed in the header. The active player is shown here too. Watch for 'AI Thinking...' when it's the computer's turn.",
    targetSelector: "[data-tutorial='phase-info']",
    position: "bottom",
  },
  {
    id: "your-hand",
    title: "Your Hand",
    description:
      "These are the cards in your hand. Click a land to play it. Click a spell to cast it. You can only play one land per turn.",
    targetSelector: "[data-tutorial='your-hand']",
    position: "top",
  },
  {
    id: "battlefield",
    title: "The Battlefield",
    description:
      "Creatures and lands you play appear here. Click a creature to tap or untap it. Tapped creatures can't attack or block.",
    targetSelector: "[data-tutorial='battlefield']",
    position: "bottom",
  },
  {
    id: "zones",
    title: "Game Zones",
    description:
      "Your Library (draw pile), Graveyard (discard pile), and Exile are shown here. Click them to see what's inside.",
    targetSelector: "[data-tutorial='zones']",
    position: "right",
  },
  {
    id: "life-total",
    title: "Life Total",
    description:
      "This shows your current life. If it reaches 0, you lose the game. You can also see your opponent's life total here.",
    targetSelector: "[data-tutorial='life-total']",
    position: "top",
  },
  {
    id: "actions",
    title: "Game Actions",
    description:
      "Use Pass Priority to move to the next step. Use Advance Phase to skip ahead. Concede if you want to end the game early. The Tutorial button is always available if you need a refresher.",
    targetSelector: "[data-tutorial='actions']",
    position: "top",
  },
  {
    id: "done",
    title: "You're Ready!",
    description:
      "That's the basics! Click cards in your hand to play them, tap creatures on the battlefield, and use the action buttons to advance the game. Good luck!",
    position: "center",
  },
];

interface GameTutorialProps {
  steps?: TutorialStep[];
  storageKey?: string;
  autoStart?: boolean;
  onComplete?: () => void;
  onSkip?: () => void;
  className?: string;
}

export function GameTutorial({
  steps = DEFAULT_TUTORIAL_STEPS,
  storageKey = "planar-nexus-game-tutorial-completed",
  autoStart = true,
  onComplete,
  onSkip,
  className,
}: GameTutorialProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [hasSeenTutorial, setHasSeenTutorial] = useState(true);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);

  const currentStep = steps[currentStepIndex];
  const isFirstStep = currentStepIndex === 0;
  const isLastStep = currentStepIndex === steps.length - 1;

  // Check if user has seen tutorial
  useEffect(() => {
    if (typeof window === "undefined") return;
    const seen = localStorage.getItem(storageKey);
    if (!seen && autoStart) {
      setHasSeenTutorial(false);
      // Small delay to let the page render before showing tutorial
      const timer = setTimeout(() => setIsOpen(true), 800);
      return () => clearTimeout(timer);
    }
    setHasSeenTutorial(!!seen);
  }, [storageKey, autoStart]);

  // Find target element position
  useEffect(() => {
    if (!isOpen || !currentStep?.targetSelector) {
      setTargetRect(null);
      return;
    }

    const updateTargetRect = () => {
      const el = document.querySelector(currentStep.targetSelector!);
      if (el) {
        setTargetRect(el.getBoundingClientRect());
      } else {
        setTargetRect(null);
      }
    };

    updateTargetRect();
    window.addEventListener("resize", updateTargetRect);
    window.addEventListener("scroll", updateTargetRect);

    // Retry after a short delay in case element is still mounting
    const retryTimer = setTimeout(updateTargetRect, 300);

    return () => {
      window.removeEventListener("resize", updateTargetRect);
      window.removeEventListener("scroll", updateTargetRect);
      clearTimeout(retryTimer);
    };
  }, [isOpen, currentStep]);

  const handleNext = useCallback(() => {
    if (isLastStep) {
      handleComplete();
    } else {
      setCurrentStepIndex((prev) => prev + 1);
    }
  }, [isLastStep]);

  const handlePrevious = useCallback(() => {
    setCurrentStepIndex((prev) => Math.max(0, prev - 1));
  }, []);

  const handleSkip = useCallback(() => {
    setIsOpen(false);
    onSkip?.();
  }, [onSkip]);

  const handleComplete = useCallback(() => {
    setIsOpen(false);
    if (typeof window !== "undefined") {
      localStorage.setItem(storageKey, "true");
    }
    setHasSeenTutorial(true);
    onComplete?.();
  }, [storageKey, onComplete]);

  const handleRestart = useCallback(() => {
    setCurrentStepIndex(0);
    setIsOpen(true);
  }, []);

  if (!isOpen) {
    // Show a small help button to restart tutorial
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={handleRestart}
        className={cn(
          "fixed bottom-20 right-4 z-50 gap-1.5 shadow-lg bg-card/90 backdrop-blur",
          className,
        )}
        aria-label="Restart tutorial"
      >
        <BookOpen className="h-4 w-4" />
        <span className="hidden sm:inline">Tutorial</span>
      </Button>
    );
  }

  // Calculate popup position
  const getPopupStyle = (): React.CSSProperties => {
    if (!targetRect || currentStep.position === "center") {
      return {
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        zIndex: 100,
        maxWidth: "380px",
        width: "calc(100vw - 2rem)",
      };
    }

    const padding = 12;
    const popupWidth = 340;
    const popupHeight = 180;

    let top = 0;
    let left = 0;

    switch (currentStep.position) {
      case "top":
        top = targetRect.top - popupHeight - padding;
        left = targetRect.left + targetRect.width / 2 - popupWidth / 2;
        break;
      case "bottom":
        top = targetRect.bottom + padding;
        left = targetRect.left + targetRect.width / 2 - popupWidth / 2;
        break;
      case "left":
        top = targetRect.top + targetRect.height / 2 - popupHeight / 2;
        left = targetRect.left - popupWidth - padding;
        break;
      case "right":
        top = targetRect.top + targetRect.height / 2 - popupHeight / 2;
        left = targetRect.right + padding;
        break;
      default:
        top = targetRect.bottom + padding;
        left = targetRect.left + targetRect.width / 2 - popupWidth / 2;
    }

    // Clamp to viewport
    top = Math.max(
      padding,
      Math.min(top, window.innerHeight - popupHeight - padding),
    );
    left = Math.max(
      padding,
      Math.min(left, window.innerWidth - popupWidth - padding),
    );

    return {
      position: "fixed",
      top,
      left,
      zIndex: 100,
      maxWidth: `${popupWidth}px`,
      width: "calc(100vw - 2rem)",
    };
  };

  return (
    <>
      {/* Dark overlay */}
      <div
        className="fixed inset-0 bg-black/40 z-50 transition-opacity"
        onClick={handleSkip}
        aria-hidden="true"
      />

      {/* Highlight box around target */}
      {targetRect && (
        <div
          className="fixed z-50 pointer-events-none border-2 border-primary rounded-lg shadow-[0_0_20px_rgba(var(--primary),0.3)] transition-all duration-300"
          style={{
            top: targetRect.top - 4,
            left: targetRect.left - 4,
            width: targetRect.width + 8,
            height: targetRect.height + 8,
          }}
        />
      )}

      {/* Tutorial popup */}
      <div style={getPopupStyle()} className="transition-all duration-300">
        <Card className="border-primary/30 shadow-xl">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold">
                  {currentStepIndex + 1}
                </div>
                <CardTitle className="text-sm">{currentStep.title}</CardTitle>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={handleSkip}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
            <CardDescription className="text-xs pt-1">
              Step {currentStepIndex + 1} of {steps.length}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-foreground">{currentStep.description}</p>

            {/* Progress dots */}
            <div className="flex items-center justify-center gap-1.5">
              {steps.map((_, idx) => (
                <div
                  key={idx}
                  className={cn(
                    "w-2 h-2 rounded-full transition-colors",
                    idx === currentStepIndex
                      ? "bg-primary"
                      : idx < currentStepIndex
                        ? "bg-primary/50"
                        : "bg-muted",
                  )}
                />
              ))}
            </div>

            {/* Navigation buttons */}
            <div className="flex items-center justify-between pt-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={handlePrevious}
                disabled={isFirstStep}
                className="h-8 text-xs"
              >
                <ChevronLeft className="h-3 w-3 mr-1" />
                Back
              </Button>

              <div className="flex items-center gap-2">
                {!isLastStep && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleSkip}
                    className="h-8 text-xs"
                  >
                    Skip Tour
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={handleNext}
                  className="h-8 text-xs gap-1"
                >
                  {isLastStep ? "Get Started" : "Next"}
                  {!isLastStep && <ChevronRight className="h-3 w-3" />}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

export function TutorialHintButton({
  onClick,
  className,
}: {
  onClick?: () => void;
  className?: string;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onClick}
      className={cn("gap-1.5", className)}
    >
      <Lightbulb className="h-4 w-4" />
      <span className="hidden sm:inline">How to Play</span>
    </Button>
  );
}
