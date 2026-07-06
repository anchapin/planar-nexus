/**
 * Host game lobby page
 * Allows players to create and manage a game lobby
 */

"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Copy,
  Check,
  Users,
  Play,
  X,
  Crown,
  Clock,
  Eye,
  Info,
  Ban,
  UserMinus,
  Pause,
  PlayCircle,
} from "lucide-react";
import { useLobby } from "@/hooks/use-lobby";
import { HostGameConfig, PlayerStatus } from "@/lib/multiplayer-types";
import { FormatRulesDisplay } from "@/components/format-rules-display";
import { DeckSelectorWithValidation } from "@/components/deck-selector-with-validation";
import { TeamAssignment } from "@/components/team-assignment";
import { SavedDeck } from "@/app/actions";
import {
  createHostConnection,
  type ConnectionData,
  type DirectConnectionState,
} from "@/lib/p2p-direct-connection";
import { QRCodeDisplay } from "@/components/qr-code-display";
import { P2PStatusBanner } from "@/components/p2p-status-banner";
import { useConfirmDialog } from "@/hooks/use-confirm-dialog";

export default function HostLobbyPage() {
  const {
    lobby,
    isHost,
    isLoading,
    error,
    createLobby,
    updatePlayerStatus,
    updatePlayerDeck,
    canStartGame,
    canForceStart,
    startGame,
    forceStartGame,
    closeLobby,
    getGameCode,
    validateDeckForFormat,
    // Team management
    isTeamMode,
    assignPlayerToTeam,
    autoAssignTeams,
    areTeamsValid,
    updateTeamSettings,
    updateTeamName,
    // Issue #1257 — host moderation controls (kick/ban/pause)
    kickPeer,
    banPeer,
    pauseGame,
    resumeGame,
    isPaused,
    // Issue #1255 — lobby state machine + ready-check + seat-hold
    lobbyState,
    activeReadyCheck,
    beginReadyCheck,
    recordReadyResponse,
    cancelReadyCheck,
    advanceToStarting,
    evaluateReadyCheck,
  } = useLobby();
  const { confirm, confirmDialog } = useConfirmDialog();

  // Form state
  const [gameName, setGameName] = useState("");
  const [gameFormat, setGameFormat] = useState<
    | "commander"
    | "modern"
    | "standard"
    | "pioneer"
    | "legacy"
    | "vintage"
    | "pauper"
  >("commander");
  const [playerCount, setPlayerCount] = useState<"2" | "3" | "4">("4");
  const [allowSpectators, setAllowSpectators] = useState(true);
  const [timerEnabled, setTimerEnabled] = useState(false);
  const [timerMinutes, setTimerMinutes] = useState(30);
  const [isPublic, setIsPublic] = useState(false);
  const [selectedDeck, setSelectedDeck] = useState<SavedDeck | null>(null);

  // UI state
  const [copied, setCopied] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(true);
  const [p2pConnectionData, setP2pConnectionData] =
    useState<ConnectionData | null>(null);
  const [p2pConnectionState, setP2pConnectionState] =
    useState<DirectConnectionState>("idle");
  const [showP2pSetup, setShowP2pSetup] = useState(false);
  // Issue #1255 — ready-check countdown state. We tick once per second
  // while a session is active so the UI shows a live remaining-time
  // indicator. The tick is also the auto-advance trigger: when the
  // window elapses we evaluate the check and force-advance if the host
  // has opted in (or we just cancel back to WAITING).
  const [readyCheckRemainingMs, setReadyCheckRemainingMs] = useState<
    number | null
  >(null);
  const readyCheckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );

  const gameCode = getGameCode();

  useEffect(() => {
    if (copied) {
      const timeout = setTimeout(() => setCopied(false), 2000);
      return () => clearTimeout(timeout);
    }
  }, [copied]);

  // Issue #1255 — drive the ready-check countdown UI. When a session
  // is active, tick every 250 ms (snappier than 1 s for the visible
  // countdown), recompute the remaining window, and auto-advance when
  // the window expires. The interval is torn down on session change.
  useEffect(() => {
    if (!activeReadyCheck) {
      setReadyCheckRemainingMs(null);
      if (readyCheckIntervalRef.current) {
        clearInterval(readyCheckIntervalRef.current);
        readyCheckIntervalRef.current = null;
      }
      return;
    }
    const tick = () => {
      const evalResult = evaluateReadyCheck();
      if (!evalResult) {
        setReadyCheckRemainingMs(null);
        return;
      }
      setReadyCheckRemainingMs(evalResult.remainingMs);
      if (evalResult.windowExpired && !evalResult.quorumReached) {
        // Window elapsed without quorum. Auto-advance (the host can
        // still cancel from the UI if they prefer). This is the
        // single source of truth for "the 15 s timer expired".
        advanceToStarting({ force: true });
        if (readyCheckIntervalRef.current) {
          clearInterval(readyCheckIntervalRef.current);
          readyCheckIntervalRef.current = null;
        }
      }
    };
    tick();
    readyCheckIntervalRef.current = setInterval(tick, 250);
    return () => {
      if (readyCheckIntervalRef.current) {
        clearInterval(readyCheckIntervalRef.current);
        readyCheckIntervalRef.current = null;
      }
    };
  }, [activeReadyCheck, evaluateReadyCheck, advanceToStarting]);

  // Issue #1255 — host-side handler for the "Start Ready Check" button.
  // Opens a full-roster check (15 s window) and the host is implicitly
  // marked as having affirmed ready (peers are expected to respond over
  // the signaling channel; for now we record the host's `ready: true`
  // immediately so the UI shows their indicator).
  const handleStartReadyCheck = useCallback(() => {
    if (!lobby) return;
    const result = beginReadyCheck();
    if (result.started && result.sessionId) {
      // The host is implicitly ready by clicking the button; this also
      // makes the per-host ready indicator in the player list flip from
      // "pending" to "answered" without waiting for a round-trip.
      recordReadyResponse(result.sessionId, lobby.hostId, true);
    }
  }, [lobby, beginReadyCheck, recordReadyResponse]);

  // Issue #1255 — host-side handler for the "Cancel Ready Check" button.
  // Drops the in-flight session and returns the lobby to WAITING so the
  // host can re-open the check or address the missing peer.
  const handleCancelReadyCheck = useCallback(() => {
    cancelReadyCheck("host-cancelled");
  }, [cancelReadyCheck]);

  const handleCreateLobby = () => {
    if (!gameName.trim()) {
      return;
    }

    const config: HostGameConfig = {
      name: gameName,
      format: gameFormat,
      maxPlayers: playerCount,
      settings: {
        allowSpectators,
        isPublic,
        timerEnabled,
        timerMinutes: timerEnabled ? timerMinutes : undefined,
      },
    };

    // Get player name from localStorage or use default
    const hostName =
      localStorage.getItem("planar_nexus_player_name") || "Host Player";

    createLobby(config, hostName);
    setShowCreateForm(false);

    // Auto-select first valid deck if available
    const [savedDecks] = getStoredDecks();
    const validDeck = savedDecks.find((deck: SavedDeck) => {
      const validation = validateDeckForFormat(deck);
      return validation.isValid;
    });
    if (validDeck && lobby) {
      handleDeckSelect(validDeck);
    }

    // Setup P2P connection for direct peer-to-peer
    setupP2PConnection(hostName);
  };

  // Setup P2P connection with QR code
  const setupP2PConnection = async (hostName: string) => {
    try {
      const playerId =
        localStorage.getItem("planar_nexus_player_id") || `host-${Date.now()}`;

      await createHostConnection({
        playerId,
        playerName: hostName,
        isHost: true,
        gameCode: getGameCode(),
        onQRCodeGenerated: (qrDataUrl, connectionData) => {
          setP2pConnectionData(connectionData);
          setP2pConnectionState("waiting-for-answer");
          setShowP2pSetup(true);
        },
        onICECandidate: () => {},
      });
    } catch (error) {
      console.error("[P2P Host] Failed to setup connection:", error);
    }
  };

  // Refresh P2P connection
  const refreshP2PConnection = async () => {
    const hostName =
      localStorage.getItem("planar_nexus_player_name") || "Host Player";
    setShowP2pSetup(false);
    setP2pConnectionData(null);
    setP2pConnectionState("idle");
    await setupP2PConnection(hostName);
  };

  // Helper to get stored decks
  const getStoredDecks = () => {
    const stored = localStorage.getItem("saved-decks");
    return stored ? JSON.parse(stored) : [];
  };

  // Handle deck selection with validation
  const handleDeckSelect = (
    deck: SavedDeck,
    validation?: { isValid: boolean; errors: string[] },
  ) => {
    setSelectedDeck(deck);
    // Validation is handled by the deck selector component
    if (!validation) {
      validateDeckForFormat(deck);
    }

    // Update player deck in lobby
    if (lobby) {
      const hostPlayer = lobby.players.find((p) => p.id === lobby.hostId);
      if (hostPlayer) {
        updatePlayerDeck(lobby.hostId, deck.id, deck.name, deck);
      }
    }
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(lobby?.gameCode || "");
    setCopied(true);
  };

  const handleReadyToggle = () => {
    if (!lobby) return;

    const hostPlayer = lobby.players.find((p) => p.id === lobby.hostId);
    if (hostPlayer) {
      const newStatus: PlayerStatus =
        hostPlayer.status === "ready" ? "not-ready" : "ready";
      updatePlayerStatus(lobby.hostId, newStatus);
    }
  };

  const handleStartGame = () => {
    // Issue #1255 — the host's "Start Game" button drives the state
    // machine. In WAITING, the first click opens a full ready check;
    // in READY_CHECK, the button is disabled until quorum is reached
    // (the auto-advance path on window-expiry handles the timeout).
    // In STARTING, the button is enabled and flips the lobby to
    // IN_GAME via `startGame` (which now goes through the state
    // machine).
    if (lobbyState === "WAITING") {
      handleStartReadyCheck();
      return;
    }
    const success = startGame();
    if (success) {
      // Navigate to game board
      window.location.href = "/game-board";
    }
  };

  const handleCloseLobby = async () => {
    const confirmed = await confirm({
      title: "Close lobby?",
      description:
        "Are you sure you want to close the lobby? This will disconnect all players.",
      confirmLabel: "Close Lobby",
      destructive: true,
    });
    if (confirmed) {
      closeLobby();
      window.location.href = "/multiplayer";
    }
  };

  const handleLeaveLobby = async () => {
    const confirmed = await confirm({
      title: "Leave lobby?",
      description:
        "Are you sure you want to leave? The lobby will be closed for all players.",
      confirmLabel: "Leave",
      destructive: true,
    });
    if (confirmed) {
      closeLobby();
      window.location.href = "/multiplayer";
    }
  };

  // Issue #1257 — host moderation handlers. The Kick action removes the
  // peer from the lobby roster AND session-bans them for 30 minutes so
  // they cannot immediately rejoin via the same game code. The Ban action
  // adds the entry without a roster change (useful for banning a peer who
  // already disconnected). Pause/Resume drive the priority-timer freeze.
  const handleKickPeer = async (peerId: string, peerName: string) => {
    const reasonInput = window.prompt(
      `Reason for kicking ${peerName}? (sent to the kicked player)`,
      "",
    );
    // Window.prompt can return null (cancelled) — treat as cancel without
    // forcing a default. Empty string is allowed (no reason).
    if (reasonInput === null) return;
    const result = kickPeer(peerId, reasonInput || undefined);
    if (!result.removed && !result.banned && result.reason) {
      window.alert(result.reason);
    }
  };

  const handleBanPeer = async (peerId: string, peerName: string) => {
    const confirmed = await confirm({
      title: `Ban ${peerName}?`,
      description:
        `${peerName} will be unable to rejoin this game code for 30 minutes. ` +
        `Use this for repeat offenders — kick is sufficient for a single removal.`,
      confirmLabel: "Ban (30 min)",
      destructive: true,
    });
    if (confirmed) {
      banPeer(peerId, "session");
    }
  };

  const handleTogglePause = () => {
    if (isPaused) {
      resumeGame();
    } else {
      pauseGame();
    }
  };

  // Format display name
  const formatDisplayNames: Record<string, string> = {
    commander: "Commander",
    modern: "Modern",
    standard: "Standard",
    pioneer: "Pioneer",
    legacy: "Legacy",
    vintage: "Vintage",
    pauper: "Pauper",
  };

  if (showCreateForm && !lobby) {
    return (
      <div className="flex-1 p-4 md:p-6 max-w-4xl mx-auto">
        <header className="mb-6">
          <Button
            variant="ghost"
            onClick={() => (window.location.href = "/multiplayer")}
            className="mb-4"
          >
            ← Back
          </Button>
          <h1 className="font-headline text-3xl font-bold">Host a Game</h1>
          <p className="text-muted-foreground mt-1">
            Create a new lobby and invite your friends to play.
          </p>
        </header>

        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Lobby Settings</CardTitle>
              <CardDescription>Configure your game lobby</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Game Name */}
              <div className="space-y-2">
                <Label htmlFor="game-name">Game Name *</Label>
                <Input
                  id="game-name"
                  placeholder="e.g., Friday Night Commander"
                  value={gameName}
                  onChange={(e) => setGameName(e.target.value)}
                />
              </div>

              {/* Game Format */}
              <div className="space-y-2">
                <Label htmlFor="format">Format *</Label>
                <Select
                  value={gameFormat}
                  onValueChange={(value: typeof gameFormat) =>
                    setGameFormat(value)
                  }
                >
                  <SelectTrigger id="format">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="commander">Commander</SelectItem>
                    <SelectItem value="modern">Modern</SelectItem>
                    <SelectItem value="standard">Standard</SelectItem>
                    <SelectItem value="pioneer">Pioneer</SelectItem>
                    <SelectItem value="legacy">Legacy</SelectItem>
                    <SelectItem value="vintage">Vintage</SelectItem>
                    <SelectItem value="pauper">Pauper</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Player Count */}
              <div className="space-y-2">
                <Label htmlFor="players">Max Players</Label>
                <Select
                  value={playerCount}
                  onValueChange={(value: typeof playerCount) =>
                    setPlayerCount(value)
                  }
                >
                  <SelectTrigger id="players">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="2">2 Players (1v1)</SelectItem>
                    <SelectItem value="3">3 Players (Free-for-all)</SelectItem>
                    <SelectItem value="4">4 Players (Free-for-all)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Format Rules Display */}
              <FormatRulesDisplay format={gameFormat} className="mt-4" />

              <Separator />

              {/* Additional Settings */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Public Game</Label>
                    <p className="text-xs text-muted-foreground">
                      Allow others to see your game in the browser
                    </p>
                  </div>
                  <Switch checked={isPublic} onCheckedChange={setIsPublic} />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Allow Spectators</Label>
                    <p className="text-xs text-muted-foreground">
                      Let others watch your game
                    </p>
                  </div>
                  <Switch
                    checked={allowSpectators}
                    onCheckedChange={setAllowSpectators}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Enable Timer</Label>
                    <p className="text-xs text-muted-foreground">
                      Add a turn timer for competitive play
                    </p>
                  </div>
                  <Switch
                    checked={timerEnabled}
                    onCheckedChange={setTimerEnabled}
                  />
                </div>

                {timerEnabled && (
                  <div className="space-y-2">
                    <Label htmlFor="timer-minutes">Turn Timer (minutes)</Label>
                    <Input
                      id="timer-minutes"
                      type="number"
                      min={1}
                      max={60}
                      value={timerMinutes}
                      onChange={(e) =>
                        setTimerMinutes(parseInt(e.target.value) || 30)
                      }
                    />
                  </div>
                )}
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button
                onClick={handleCreateLobby}
                disabled={!gameName.trim() || isLoading}
                className="w-full"
                size="lg"
              >
                {isLoading ? "Creating..." : "Create Lobby"}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (lobby) {
    const maxPlayers = parseInt(lobby.maxPlayers);
    const playerSlots = maxPlayers - lobby.players.length;

    return (
      <div className="flex-1 p-4 md:p-6 max-w-5xl mx-auto">
        {confirmDialog}
        <header className="mb-6">
          <Button variant="ghost" onClick={handleLeaveLobby} className="mb-4">
            ← Leave Lobby
          </Button>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="font-headline text-3xl font-bold flex items-center gap-2">
                {lobby.name}
                <Badge variant="secondary">
                  {formatDisplayNames[lobby.format]}
                </Badge>
              </h1>
              <p className="text-muted-foreground mt-1">
                Waiting for players to join...
              </p>
            </div>
            <Button variant="destructive" onClick={handleCloseLobby} size="sm">
              Close Lobby
            </Button>
          </div>
        </header>

        <div className="grid gap-6 md:grid-cols-3">
          {/* Game Code Card */}
          <Card className="md:col-span-1">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5" />
                Invite Players
              </CardTitle>
              <CardDescription>
                Share this code with your friends
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-center">
                <div className="text-4xl font-mono font-bold tracking-wider mb-2">
                  {gameCode}
                </div>
                <Button
                  onClick={handleCopyCode}
                  variant={copied ? "default" : "outline"}
                  className="w-full"
                >
                  {copied ? (
                    <>
                      <Check className="w-4 h-4 mr-2" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4 mr-2" />
                      Copy Code
                    </>
                  )}
                </Button>
              </div>

              <Separator />

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Format:</span>
                  <span className="font-medium">
                    {formatDisplayNames[lobby.format]}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Players:</span>
                  <span className="font-medium">
                    {lobby.players.length} / {maxPlayers}
                  </span>
                </div>
                {lobby.settings.timerEnabled && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Timer:
                    </span>
                    <span className="font-medium">
                      {lobby.settings.timerMinutes} min turns
                    </span>
                  </div>
                )}
                {lobby.settings.allowSpectators && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <Eye className="w-3 h-3" />
                      Spectators:
                    </span>
                    <span className="font-medium">Allowed</span>
                  </div>
                )}
              </div>

              {playerSlots > 0 && (
                <Alert>
                  <AlertDescription className="text-center">
                    Waiting for {playerSlots} more player
                    {playerSlots > 1 ? "s" : ""}...
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          {/* P2P Connection Setup */}
          {showP2pSetup && p2pConnectionData && (
            <div className="md:col-span-3">
              <QRCodeDisplay
                gameCode={p2pConnectionData.gameCode}
                gameName={lobby.name}
                onCopy={() => {
                  const connectionString = JSON.stringify(p2pConnectionData);
                  navigator.clipboard.writeText(connectionString);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              />
              <div className="mt-4 flex gap-3">
                <Button
                  onClick={refreshP2PConnection}
                  variant="outline"
                  className="flex-1"
                >
                  Generate New Connection Code
                </Button>
                <Button onClick={() => setShowP2pSetup(false)} variant="ghost">
                  Hide
                </Button>
              </div>
            </div>
          )}

          {/* Show P2P Setup Button */}
          {!showP2pSetup && (
            <div className="md:col-span-3">
              <Button
                onClick={() => setShowP2pSetup(true)}
                variant="outline"
                className="w-full"
              >
                Show P2P Connection Code
              </Button>
            </div>
          )}

          {/* Format Rules */}
          <FormatRulesDisplay format={lobby.format} className="md:col-span-3" />

          {/* Team Assignment for 2v2 mode */}
          {isTeamMode && lobby.teams && (
            <div className="md:col-span-3">
              <TeamAssignment
                teams={lobby.teams}
                players={lobby.players}
                teamSettings={lobby.teamSettings}
                onAssignPlayer={assignPlayerToTeam}
                onAutoAssign={autoAssignTeams}
                onUpdateTeamName={updateTeamName}
                onUpdateTeamSettings={updateTeamSettings}
                areTeamsValid={areTeamsValid}
                isHost={isHost}
              />
            </div>
          )}

          {/* Deck Selection for Host */}
          <Card className="md:col-span-3">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Info className="w-5 h-5" />
                Deck Selection
              </CardTitle>
              <CardDescription>
                Select a valid {formatDisplayNames[lobby.format]} deck to play
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DeckSelectorWithValidation
                lobbyFormat={lobby.format}
                onDeckSelect={handleDeckSelect}
                selectedDeckId={selectedDeck?.id}
                className="max-w-md"
              />
            </CardContent>
          </Card>

          {/* Players List */}
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>Players in Lobby</CardTitle>
              <CardDescription>
                All players must be ready and have valid decks before starting
              </CardDescription>
            </CardHeader>
            <CardContent>
              {/* Issue #1255 — ready-check countdown banner. Rendered
                  only when an active ready check is in flight. Shows
                  the remaining window (15 s for a full check, 10 s for
                  a late-joiner check) and lets the host cancel. */}
              {activeReadyCheck && (
                <Alert
                  className="mb-4"
                  data-testid="ready-check-banner"
                  role="status"
                  aria-live="polite"
                >
                  <Clock className="w-4 h-4" />
                  <AlertDescription className="flex items-center justify-between gap-2">
                    <span>
                      <strong>
                        {activeReadyCheck.kind === "late-joiner"
                          ? "Late joiner ready check"
                          : "Ready check"}
                      </strong>{" "}
                      in progress — waiting on{" "}
                      {activeReadyCheck.targetPeerIds.filter(
                        (id) => !activeReadyCheck.responses[id],
                      ).length}{" "}
                      of {activeReadyCheck.targetPeerIds.length} peer
                      {activeReadyCheck.targetPeerIds.length === 1 ? "" : "s"}
                      {readyCheckRemainingMs !== null && (
                        <>
                          {" "}
                          ·{" "}
                          <span
                            className="font-mono"
                            data-testid="ready-check-countdown"
                          >
                            {Math.max(
                              0,
                              Math.ceil(readyCheckRemainingMs / 1000),
                            )}
                            s
                          </span>{" "}
                          remaining
                        </>
                      )}
                    </span>
                    {isHost && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleCancelReadyCheck}
                        aria-label="Cancel ready check"
                      >
                        Cancel
                      </Button>
                    )}
                  </AlertDescription>
                </Alert>
              )}

              <div className="space-y-2">
                {lobby.players.map((player) => (
                  <div
                    key={player.id}
                    className="flex items-center justify-between p-4 border rounded-lg bg-card"
                  >
                    <div className="flex items-center gap-3">
                      {player.id === lobby.hostId && (
                        <Crown className="w-5 h-5 text-yellow-500" />
                      )}
                      <div>
                        <div className="font-medium">
                          {player.name}
                          {player.id === lobby.hostId && (
                            <Badge variant="outline" className="ml-2">
                              Host
                            </Badge>
                          )}
                        </div>
                        {player.deckName && (
                          <div className="text-sm text-muted-foreground">
                            Deck: {player.deckName}
                            {player.deckFormat &&
                              player.deckFormat !== lobby.format && (
                                <span className="text-yellow-600 ml-2">
                                  ({player.deckFormat} deck)
                                </span>
                              )}
                          </div>
                        )}
                        {player.deckValidationErrors &&
                          player.deckValidationErrors.length > 0 && (
                            <div className="text-xs text-red-500 mt-1">
                              {player.deckValidationErrors[0]}
                            </div>
                          )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Issue #1257 — host-only moderation controls. Visible
                          only when the local user IS the host and the row is
                          a non-host peer. Non-hosts see neither button. */}
                      {isHost && player.id !== lobby.hostId && (
                        <>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleKickPeer(player.id, player.name)}
                            aria-label={`Kick ${player.name}`}
                            title={`Remove ${player.name} from the lobby and ban them for 30 minutes`}
                          >
                            <UserMinus className="w-4 h-4 mr-1" />
                            Kick
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleBanPeer(player.id, player.name)}
                            aria-label={`Ban ${player.name}`}
                            title={`Ban ${player.name} from re-joining this game code for 30 minutes`}
                          >
                            <Ban className="w-4 h-4 mr-1" />
                            Ban
                          </Button>
                        </>
                      )}
                      <Badge
                        variant={
                          player.status === "ready" || player.status === "host"
                            ? "default"
                            : "secondary"
                        }
                      >
                        {player.status === "ready"
                          ? "Ready"
                          : player.status === "host"
                            ? "Host"
                            : "Not Ready"}
                      </Badge>
                      {/* Issue #1255 — per-player ready-check indicator.
                          When a ready check is active and this player is
                          a target, render a small ✓ / ⏳ badge so the
                          host can see at a glance who has answered. */}
                      {activeReadyCheck &&
                        activeReadyCheck.targetPeerIds.includes(player.id) && (
                          <Badge
                            variant="outline"
                            data-testid={`ready-check-status-${player.id}`}
                            aria-label={
                              activeReadyCheck.responses[player.id]
                                ? `${player.name} answered ready check`
                                : `${player.name} pending ready check`
                            }
                            className="text-xs"
                          >
                            {activeReadyCheck.responses[player.id]
                              ? activeReadyCheck.responses[player.id].ready
                                ? "✓ answered"
                                : "✗ declined"
                              : "⏳ pending"}
                          </Badge>
                        )}
                    </div>
                  </div>
                ))}

                {/* Empty slots */}
                {Array.from({ length: playerSlots }).map((_, i) => (
                  <div
                    key={`empty-${i}`}
                    className="flex items-center justify-center p-4 border-2 border-dashed rounded-lg bg-muted/20"
                  >
                    <span className="text-sm text-muted-foreground">
                      Waiting for player...
                    </span>
                  </div>
                ))}
              </div>

              <Separator className="my-4" />

              <div className="flex gap-3">
                {isHost ? (
                  <>
                    <Button
                      onClick={handleStartGame}
                      disabled={
                        lobbyState === "READY_CHECK" ||
                        (lobbyState === "WAITING" &&
                          (lobby.players.length < 2 ||
                            !lobby.players.every(
                              (p) =>
                                p.deckId && p.deckName &&
                                (!p.deckValidationErrors ||
                                  p.deckValidationErrors.length === 0),
                            )))
                      }
                      className="flex-1"
                      size="lg"
                      data-testid="start-game-button"
                    >
                      <Play className="w-4 h-4 mr-2" />
                      {lobbyState === "WAITING"
                        ? "Start Ready Check"
                        : lobbyState === "READY_CHECK"
                          ? "Waiting for peers…"
                          : "Start Game"}
                    </Button>
                    {canForceStart && !canStartGame && (
                      <Button
                        onClick={forceStartGame}
                        variant="secondary"
                        className="flex-1"
                        size="lg"
                        title="Force start with ready players only"
                      >
                        <Play className="w-4 h-4 mr-2" />
                        Force Start
                      </Button>
                    )}
                    {/* Issue #1257 — host-only pause/resume. Freezes all
                        peer priority timers via a `lobby-control` pause
                        broadcast (see p2p-game-connection.ts). */}
                    <Button
                      type="button"
                      onClick={handleTogglePause}
                      variant={isPaused ? "default" : "outline"}
                      size="lg"
                      aria-label={isPaused ? "Resume game" : "Pause game"}
                      aria-pressed={isPaused}
                      title={
                        isPaused
                          ? "Resume the priority timer"
                          : "Pause the priority timer for all peers"
                      }
                    >
                      {isPaused ? (
                        <>
                          <PlayCircle className="w-4 h-4 mr-2" />
                          Resume
                        </>
                      ) : (
                        <>
                          <Pause className="w-4 h-4 mr-2" />
                          Pause
                        </>
                      )}
                    </Button>
                  </>
                ) : (
                  <Button
                    onClick={handleReadyToggle}
                    variant={
                      lobby.players.find((p) => p.id === lobby.hostId)
                        ?.status === "ready"
                        ? "outline"
                        : "default"
                    }
                    className="flex-1"
                    size="lg"
                  >
                    {lobby.players.find((p) => p.id === lobby.hostId)
                      ?.status === "ready" ? (
                      <>
                        <X className="w-4 h-4 mr-2" />
                        Not Ready
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4 mr-2" />
                        Ready Up
                      </>
                    )}
                  </Button>
                )}
              </div>

              {!canStartGame && !canForceStart && (
                <p className="text-xs text-center text-muted-foreground mt-2">
                  {lobby.players.length < 2
                    ? "Need at least 2 players to start"
                    : lobby.players.some((p) => !p.deckId)
                      ? "All players must select a deck"
                      : "All players must have valid decks and be ready to start"}
                </p>
              )}

              {canForceStart && !canStartGame && (
                <p className="text-xs text-center text-amber-600 mt-2">
                  Not all players are ready. Use "Force Start" to begin with
                  ready players only.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        <P2PStatusBanner
          className="mt-6"
          status="in-development"
          title="P2P Lobby (Prototype)"
          description="This lobby uses WebRTC peer-to-peer networking. Connections are local during the prototype phase — full cross-player sync is arriving in a future release."
        />
      </div>
    );
  }

  return null;
}
