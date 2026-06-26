"use client";

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Users, Shuffle, Check, X, Edit2 } from "lucide-react";
import { Team, TeamId, Player, TeamSettings } from "@/lib/multiplayer-types";

interface TeamAssignmentProps {
  teams: Team[];
  players: Player[];
  teamSettings?: TeamSettings;
  onAssignPlayer: (playerId: string, teamId: TeamId) => boolean;
  onAutoAssign: () => void;
  onUpdateTeamName: (teamId: TeamId, name: string) => boolean;
  onUpdateTeamSettings: (settings: Partial<TeamSettings>) => boolean;
  areTeamsValid: boolean;
  isHost: boolean;
}

export function TeamAssignment({
  teams,
  players,
  teamSettings,
  onAssignPlayer,
  onAutoAssign,
  onUpdateTeamName,
  onUpdateTeamSettings,
  areTeamsValid,
  isHost,
}: TeamAssignmentProps) {
  const [editingTeam, setEditingTeam] = useState<TeamId | null>(null);
  const [teamNameInput, setTeamNameInput] = useState("");

  // Get unassigned players
  const unassignedPlayers = players.filter((p) => !p.teamId);

  // Handle team name edit
  const handleStartEdit = (team: Team) => {
    setEditingTeam(team.id);
    setTeamNameInput(team.name);
  };

  const handleSaveEdit = (teamId: TeamId) => {
    if (teamNameInput.trim()) {
      onUpdateTeamName(teamId, teamNameInput.trim());
    }
    setEditingTeam(null);
    setTeamNameInput("");
  };

  const handleCancelEdit = () => {
    setEditingTeam(null);
    setTeamNameInput("");
  };

  // Handle drag and drop for team assignment
  const handlePlayerDrop = (playerId: string, teamId: TeamId) => {
    onAssignPlayer(playerId, teamId);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              Team Assignment
            </CardTitle>
            <CardDescription>
              Assign players to teams for 2v2 mode
            </CardDescription>
          </div>
          {isHost && (
            <Button
              variant="outline"
              size="sm"
              onClick={onAutoAssign}
              className="flex items-center gap-2"
            >
              <Shuffle className="w-4 h-4" />
              Auto Assign
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Team Settings */}
        {isHost && teamSettings && (
          <div className="space-y-3 p-3 bg-muted/30 rounded-lg">
            <h4 className="text-sm font-medium">Team Settings</h4>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="shared-life" className="text-sm">
                  Shared Life
                </Label>
                <Switch
                  id="shared-life"
                  checked={teamSettings.sharedLife}
                  onCheckedChange={(checked) =>
                    onUpdateTeamSettings({ sharedLife: checked })
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="shared-blockers" className="text-sm">
                  Shared Blockers
                </Label>
                <Switch
                  id="shared-blockers"
                  checked={teamSettings.sharedBlockers}
                  onCheckedChange={(checked) =>
                    onUpdateTeamSettings({ sharedBlockers: checked })
                  }
                />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="team-chat" className="text-sm">
                  Team Chat
                </Label>
                <Switch
                  id="team-chat"
                  checked={teamSettings.teamChat}
                  onCheckedChange={(checked) =>
                    onUpdateTeamSettings({ teamChat: checked })
                  }
                />
              </div>
              {teamSettings.sharedLife && (
                <div className="flex items-center gap-2">
                  <Label htmlFor="starting-life" className="text-sm">
                    Starting Life
                  </Label>
                  <Input
                    id="starting-life"
                    type="number"
                    min={1}
                    max={100}
                    value={teamSettings.startingLifePerTeam}
                    onChange={(e) =>
                      onUpdateTeamSettings({
                        startingLifePerTeam: parseInt(e.target.value) || 30,
                      })
                    }
                    className="w-20 h-8"
                  />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Teams Display */}
        <div className="grid grid-cols-2 gap-4">
          {teams.map((team) => {
            const teamPlayers = players.filter((p) => p.teamId === team.id);
            const isEditing = editingTeam === team.id;

            return (
              <div
                key={team.id}
                className="border-2 rounded-lg p-4 transition-colors"
                style={{ borderColor: team.color }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const playerId = e.dataTransfer.getData("playerId");
                  if (playerId) {
                    handlePlayerDrop(playerId, team.id);
                  }
                }}
              >
                {/* Team Header */}
                <div className="flex items-center justify-between mb-3">
                  {isEditing ? (
                    <div className="flex items-center gap-2 flex-1">
                      <Input
                        value={teamNameInput}
                        onChange={(e) => setTeamNameInput(e.target.value)}
                        className="h-8"
                        autoFocus
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleSaveEdit(team.id)}
                        className="h-8 w-8"
                        aria-label="Save team name"
                      >
                        <Check className="w-4 h-4 text-green-500" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={handleCancelEdit}
                        className="h-8 w-8"
                        aria-label="Cancel edit"
                      >
                        <X className="w-4 h-4 text-red-500" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: team.color }}
                        />
                        <span className="font-semibold">{team.name}</span>
                        {teamPlayers.length === 2 && (
                          <Badge variant="secondary" className="text-xs">
                            Full
                          </Badge>
                        )}
                      </div>
                      {isHost && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => handleStartEdit(team)}
                          className="h-8 w-8"
                          aria-label="Edit team"
                        >
                          <Edit2 className="w-4 h-4" />
                        </Button>
                      )}
                    </>
                  )}
                </div>

                {/* Team Players */}
                <div className="space-y-2 min-h-[80px]">
                  {teamPlayers.length === 0 ? (
                    <div className="flex items-center justify-center h-20 border-2 border-dashed rounded-md text-muted-foreground text-sm">
                      Drop player here
                    </div>
                  ) : (
                    teamPlayers.map((player) => (
                      <div
                        key={player.id}
                        draggable={isHost}
                        onDragStart={(e) => {
                          e.dataTransfer.setData("playerId", player.id);
                        }}
                        className={`flex items-center justify-between p-2 rounded-md ${
                          isHost ? "cursor-move bg-muted/50" : "bg-muted/30"
                        }`}
                        style={{ borderLeft: `3px solid ${team.color}` }}
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{player.name}</span>
                          {player.status === "host" && (
                            <Badge variant="outline" className="text-xs">
                              Host
                            </Badge>
                          )}
                        </div>
                        <Badge
                          variant={
                            player.status === "ready" ||
                            player.status === "host"
                              ? "default"
                              : "secondary"
                          }
                          className="text-xs"
                        >
                          {player.status === "ready"
                            ? "Ready"
                            : player.status === "host"
                              ? "Host"
                              : "Not Ready"}
                        </Badge>
                      </div>
                    ))
                  )}
                </div>

                {/* Shared Life Display */}
                {teamSettings?.sharedLife && (
                  <div className="mt-3 pt-3 border-t">
                    <div className="text-sm text-muted-foreground">
                      Shared Life:{" "}
                      <span className="font-bold text-foreground">
                        {team.sharedLifeTotal ||
                          teamSettings.startingLifePerTeam}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Unassigned Players */}
        {unassignedPlayers.length > 0 && (
          <>
            <Separator />
            <div>
              <h4 className="text-sm font-medium mb-2">Unassigned Players</h4>
              <div className="flex flex-wrap gap-2">
                {unassignedPlayers.map((player) => (
                  <div
                    key={player.id}
                    draggable={isHost}
                    onDragStart={(e) => {
                      e.dataTransfer.setData("playerId", player.id);
                    }}
                    className={`flex items-center gap-2 p-2 rounded-md border ${
                      isHost ? "cursor-move" : ""
                    }`}
                  >
                    <span className="font-medium">{player.name}</span>
                    <Badge
                      variant={
                        player.status === "ready" || player.status === "host"
                          ? "default"
                          : "secondary"
                      }
                      className="text-xs"
                    >
                      {player.status === "ready"
                        ? "Ready"
                        : player.status === "host"
                          ? "Host"
                          : "Not Ready"}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Validation Status */}
        <div className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-2">
            {areTeamsValid ? (
              <>
                <Check className="w-5 h-5 text-green-500" />
                <span className="text-sm text-green-600">Teams are valid</span>
              </>
            ) : (
              <>
                <X className="w-5 h-5 text-red-500" />
                <span className="text-sm text-red-600">
                  Teams must be balanced
                </span>
              </>
            )}
          </div>
          {teamSettings?.sharedLife && (
            <Badge variant="outline">Two-Headed Giant Mode</Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
