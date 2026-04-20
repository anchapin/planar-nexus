import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Gamepad2, Users, Clock, Wifi, Shield, Share2, QrCode, MessageSquare } from "lucide-react";
import Link from "next/link";

export default function MultiplayerPage() {
  return (
    <div className="flex-1 p-4 md:p-6">
      <header className="mb-6">
        <h1 className="font-headline text-3xl font-bold">Multiplayer</h1>
        <p className="text-muted-foreground mt-1">
          Challenge others in peer-to-peer multiplayer battles.
        </p>
      </header>
      <main className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle>Host a Game</CardTitle>
                    <CardDescription>Create a P2P game and share connection code with your opponent</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <Link href="/multiplayer/p2p-host">
                        <Button className="w-full">
                            <Wifi className="w-4 h-4 mr-2" />
                            Create P2P Game
                        </Button>
                    </Link>
                </CardContent>
            </Card>
            <Card>
                <CardHeader>
                    <CardTitle>Join a Game</CardTitle>
                    <CardDescription>Enter a connection code to join your opponent's game</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <Link href="/multiplayer/p2p-join">
                        <Button variant="outline" className="w-full">
                            <QrCode className="w-4 h-4 mr-2" />
                            Scan QR Code
                        </Button>
                    </Link>
                    <Link href="/multiplayer/p2p-join">
                        <Button variant="outline" className="w-full">
                            <Gamepad2 className="w-4 h-4 mr-2" />
                            Enter Code Manually
                        </Button>
                    </Link>
                </CardContent>
            </Card>
        </div>
        <div className="lg:col-span-2">
            <Card>
                <CardHeader>
                    <CardTitle>Peer-to-Peer Multiplayer</CardTitle>
                    <CardDescription>Direct connections without any server</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="p-4 border rounded-lg bg-card">
                            <div className="flex items-center gap-2 mb-2">
                                <Shield className="w-5 h-5 text-green-500" />
                                <h3 className="font-semibold">Serverless</h3>
                            </div>
                            <p className="text-sm text-muted-foreground">
                                Direct P2P connection via WebRTC. No central server, no data collection.
                            </p>
                        </div>
                        <div className="p-4 border rounded-lg bg-card">
                            <div className="flex items-center gap-2 mb-2">
                                <Share2 className="w-5 h-5 text-primary" />
                                <h3 className="font-semibold">Easy Sharing</h3>
                            </div>
                            <p className="text-sm text-muted-foreground">
                                Share connection codes via QR code, Discord, or any messaging app.
                            </p>
                        </div>
                    </div>

                    <Separator />

                    <div>
                        <h3 className="font-semibold mb-4">How to Connect</h3>
                        <div className="space-y-4">
                            <div className="flex gap-4">
                                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">1</div>
                                <div>
                                    <h4 className="font-medium">Host Creates Game</h4>
                                    <p className="text-sm text-muted-foreground">
                                        Host creates a P2P game and generates a connection code
                                    </p>
                                </div>
                            </div>
                            <div className="flex gap-4">
                                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">2</div>
                                <div>
                                    <h4 className="font-medium">Share Connection Code</h4>
                                    <p className="text-sm text-muted-foreground">
                                        Host shares the QR code or connection string with opponent (Discord, text, etc.)
                                    </p>
                                </div>
                            </div>
                            <div className="flex gap-4">
                                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">3</div>
                                <div>
                                    <h4 className="font-medium">Opponent Joins</h4>
                                    <p className="text-sm text-muted-foreground">
                                        Opponent scans QR code or enters the connection code manually
                                    </p>
                                </div>
                            </div>
                            <div className="flex gap-4">
                                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">4</div>
                                <div>
                                    <h4 className="font-medium">Direct Connection</h4>
                                    <p className="text-sm text-muted-foreground">
                                        WebRTC establishes direct P2P connection for game play
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <Separator />

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

            <Card className="mt-6">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <MessageSquare className="w-5 h-5" />
                        Sharing Tips
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                    <div className="flex items-start gap-3">
                        <QrCode className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                        <div>
                            <h4 className="font-medium">QR Code</h4>
                            <p className="text-sm text-muted-foreground">
                                Best for in-person or screen sharing. Mobile users can scan directly.
                            </p>
                        </div>
                    </div>
                    <div className="flex items-start gap-3">
                        <Share2 className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                        <div>
                            <h4 className="font-medium">Copy & Paste</h4>
                            <p className="text-sm text-muted-foreground">
                                Copy the connection string and paste it into Discord, email, or any messaging app.
                            </p>
                        </div>
                    </div>
                    <div className="flex items-start gap-3">
                        <Users className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                        <div>
                            <h4 className="font-medium">Discord/Chat</h4>
                            <p className="text-sm text-muted-foreground">
                                The easiest way - send the code in any chat application.
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
      </main>
    </div>
  );
}
