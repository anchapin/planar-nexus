import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

const mockGames = [
    { id: '1', name: "Casual Commander", host: "PlayerOne", players: "3/4", status: "Waiting" },
    { id: '2', name: "cEDH Practice", host: "SpikeMaster", players: "2/4", status: "Waiting" },
    { id: '3', name: "Battlecruiser Fun", host: "Timmy", players: "4/4", status: "In Progress" },
    { id: '4', name: "LFG Modern", host: "Newbie", players: "1/2", status: "Waiting" },
];

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
                    <Input placeholder="Game Name (e.g., 'Friday Night Magic')" />
                    <Button className="w-full">Create Lobby</Button>
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
                    <CardTitle>Game Browser</CardTitle>
                    <CardDescription>Find and join public games.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Name</TableHead>
                                <TableHead>Host</TableHead>
                                <TableHead>Players</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-right">Action</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {mockGames.map(game => (
                                <TableRow key={game.id}>
                                    <TableCell className="font-medium">{game.name}</TableCell>
                                    <TableCell>{game.host}</TableCell>
                                    <TableCell>
                                        <Badge variant={game.players === "4/4" || game.players === "2/2" ? "secondary" : "default"}>{game.players}</Badge>
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant={game.status === 'In Progress' ? 'outline' : 'secondary'}>{game.status}</Badge>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Button size="sm" disabled={game.status === 'In Progress'}>Join</Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
            <p className="text-xs text-muted-foreground mt-2 text-center">
                Note: Multiplayer functionality is a prototype. Game connection logic (P2P via WebRTC) is not implemented.
            </p>
        </div>
      </main>
    </div>
  );
}
