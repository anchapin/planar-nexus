import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Gamepad2, Users, Clock } from "lucide-react";
import Link from "next/link";

export default function MultiplayerPage() {
  return (
    <div className="flex-1 p-4 md:p-6">
      <header className="mb-6">
        <h1 className="font-headline text-3xl font-bold">Multiplayer</h1>
        <p className="text-muted-foreground mt-1">
          Challenge others in multiplayer battles.
        </p>
      </header>
      <main className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>Host a Game</CardTitle>
                    <CardDescription>Create a new game lobby and invite your friends.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <Link href="/multiplayer/host">
                        <Button className="w-full">Create Lobby</Button>
                    </Link>
                </CardContent>
            </Card>
            <Card>
                <CardHeader>
                    <CardTitle>Browse Games</CardTitle>
                    <CardDescription>Find and join public games waiting for players.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <Link href="/multiplayer/browse">
                        <Button variant="outline" className="w-full">
                            <Gamepad2 className="w-4 h-4 mr-2" />
                            Browse Public Games
                        </Button>
                    </Link>
                </CardContent>
            </Card>
            <Card>
                <CardHeader>
                    <CardTitle>Join with Code</CardTitle>
                    <CardDescription>Have an invite code? Join a private game directly.</CardDescription>
                </CardHeader>
                <CardContent className="flex gap-2">
                    <Input placeholder="Enter game code..." />
                    <Button>Join</Button>
                </CardContent>
            </Card>
        </div>
        <div className="lg:col-span-2">
            <Card>
                <CardHeader>
                    <CardTitle>Getting Started</CardTitle>
                    <CardDescription>Choose how you want to play</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="grid gap-4 md:grid-cols-3">
                        <div className="p-4 border rounded-lg bg-card">
                            <div className="flex items-center gap-2 mb-2">
                                <Gamepad2 className="w-5 h-5 text-primary" />
                                <h3 className="font-semibold">Host Game</h3>
                            </div>
                            <p className="text-sm text-muted-foreground">
                                Create your own lobby and invite friends with a shareable code.
                            </p>
                        </div>
                        <div className="p-4 border rounded-lg bg-card">
                            <div className="flex items-center gap-2 mb-2">
                                <Users className="w-5 h-5 text-primary" />
                                <h3 className="font-semibold">Browse Games</h3>
                            </div>
                            <p className="text-sm text-muted-foreground">
                                Find public games looking for players and join instantly.
                            </p>
                        </div>
                        <div className="p-4 border rounded-lg bg-card">
                            <div className="flex items-center gap-2 mb-2">
                                <Clock className="w-5 h-5 text-primary" />
                                <h3 className="font-semibold">Join with Code</h3>
                            </div>
                            <p className="text-sm text-muted-foreground">
                                Enter a game code from a friend to join their private lobby.
                            </p>
                        </div>
                    </div>

                    <div className="border-t pt-6">
                        <h3 className="font-semibold mb-4">Quick Stats</h3>
                        <div className="grid grid-cols-3 gap-4 text-center">
                            <div className="p-4 bg-muted/50 rounded-lg">
                                <div className="text-2xl font-bold">Prototype</div>
                                <div className="text-xs text-muted-foreground">Current Status</div>
                            </div>
                            <div className="p-4 bg-muted/50 rounded-lg">
                                <div className="text-2xl font-bold">Local</div>
                                <div className="text-xs text-muted-foreground">Game Discovery</div>
                            </div>
                            <div className="p-4 bg-muted/50 rounded-lg">
                                <div className="text-2xl font-bold">Coming Soon</div>
                                <div className="text-xs text-muted-foreground">P2P Networking</div>
                            </div>
                        </div>
                    </div>

                    <div className="bg-muted/50 p-4 rounded-lg">
                        <h4 className="font-semibold mb-2">Supported Formats</h4>
                        <div className="flex flex-wrap gap-2">
                            <Badge variant="outline">Commander</Badge>
                            <Badge variant="outline">Modern</Badge>
                            <Badge variant="outline">Standard</Badge>
                            <Badge variant="outline">Pioneer</Badge>
                            <Badge variant="outline">Legacy</Badge>
                            <Badge variant="outline">Vintage</Badge>
                            <Badge variant="outline">Pauper</Badge>
                        </div>
                    </div>
                </CardContent>
            </Card>
            <p className="text-xs text-muted-foreground mt-2 text-center">
                Note: Multiplayer functionality is a prototype. Game connection logic (P2P via WebRTC) is not implemented.
                Public games are stored locally in your browser for demonstration purposes.
            </p>
        </div>
      </main>
    </div>
  );
}
