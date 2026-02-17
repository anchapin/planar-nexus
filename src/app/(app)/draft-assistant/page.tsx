"use client";

import { useState, useTransition } from "react";
import { useToast } from "@/hooks/use-toast";
import { getDraftPickRecommendation, buildSealedDeck, analyzeLimitedPool } from "@/ai/flows/ai-draft-assistant";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

// Types for the AI responses
interface DraftPick {
  recommendedPick: number;
  reasoning: string;
  alternativeOptions: Array<{ index: number; reason: string }>;
  synergies: string[];
  colorAlignment: { primary?: string; secondary?: string };
}

interface SealedBuild {
  suggestedDeck: Array<{ name: string; quantity: number; reason: string }>;
  colorRecommendation: { primary: string; secondary?: string; reasoning: string };
  curveAnalysis: { assessment: string };
  sideboard: Array<{ name: string; reason: string }>;
  archetypes: Array<{ name: string; score: number; cards: string[] }>;
}

interface PoolAnalysis {
  colorBreakdown: Record<string, number>;
  curveBreakdown: Record<number, number>;
  recommendedColors: { first: string; second?: string; reasoning: string };
  archetypeSuggestions: Array<{ name: string; suitability: number; keyCards: string[] }>;
  powerCards: Array<{ name: string; rating: number; reason: string }>;
}

export default function DraftAssistantPage() {
  const { toast } = useToast();
  const [isAnalyzing, startAnalysis] = useTransition();
  
  // Draft mode state
  const [poolText, setPoolText] = useState("");
  const [packText, setPackText] = useState("");
  const [pickNumber, setPickNumber] = useState(1);
  const [draftResult, setDraftResult] = useState<DraftPick | null>(null);
  
  // Sealed mode state
  const [sealedPoolText, setSealedPoolText] = useState("");
  const [sealedResult, setSealedResult] = useState<SealedBuild | null>(null);
  
  // Analysis mode state
  const [analysisPoolText, setAnalysisPoolText] = useState("");
  const [analysisResult, setAnalysisResult] = useState<PoolAnalysis | null>(null);
  
  // Parse card text into structured format
  const parseCardPool = (text: string): Array<{ name: string; colors?: string[]; cmc?: number; type?: string }> => {
    const lines = text.trim().split('\n').filter(line => line.trim());
    return lines.map(line => {
      // Try to extract basic info from line
      // Format: "Card Name" or "4 Lightning Bolt" or "Card Name (Red)"
      const match = line.match(/^(\d+)?\s*([^([]+)/);
      const name = match ? match[2].trim() : line.trim();
      
      // Extract color hints from parentheses like (W) or (Red)
      const colorMatch = line.match(/\((W|U|B|R|G|White|Blue|Black|Red|Green)\)/i);
      const colors = colorMatch ? [colorMatch[1].charAt(0).toUpperCase()] : undefined;
      
      // Try to extract CMC from types like "2UU" or "3"
      const cmcMatch = line.match(/\b(\d+)\b/);
      const cmc = cmcMatch ? parseInt(cmcMatch[1]) : undefined;
      
      return { name, colors, cmc };
    }).filter(card => card.name);
  };

  const handleDraftAnalysis = () => {
    if (!poolText.trim() || !packText.trim()) {
      toast({
        variant: "destructive",
        title: "Missing Information",
        description: "Please enter both your pool and the pack cards.",
      });
      return;
    }

    startAnalysis(async () => {
      try {
        const pool = parseCardPool(poolText);
        const packCards = parseCardPool(packText);
        
        const result = await getDraftPickRecommendation({
          pool,
          pickNumber,
          packCards,
          format: "draft",
        });
        
        setDraftResult(result);
        toast({
          title: "Analysis Complete",
          description: "Your draft pick recommendation is ready.",
        });
      } catch (error) {
        console.error(error);
        toast({
          variant: "destructive",
          title: "Analysis Failed",
          description: "Failed to get draft recommendation. Please try again.",
        });
      }
    });
  };

  const handleSealedBuild = () => {
    if (!sealedPoolText.trim()) {
      toast({
        variant: "destructive",
        title: "Missing Information",
        description: "Please enter your sealed pool.",
      });
      return;
    }

    startAnalysis(async () => {
      try {
        const pool = parseCardPool(sealedPoolText);
        
        const result = await buildSealedDeck({
          pool,
          format: "sealed",
        });
        
        setSealedResult(result);
        toast({
          title: "Deck Built",
          description: "Your sealed deck recommendation is ready.",
        });
      } catch (error) {
        console.error(error);
        toast({
          variant: "destructive",
          title: "Build Failed",
          description: "Failed to build sealed deck. Please try again.",
        });
      }
    });
  };

  const handlePoolAnalysis = () => {
    if (!analysisPoolText.trim()) {
      toast({
        variant: "destructive",
        title: "Missing Information",
        description: "Please enter your card pool.",
      });
      return;
    }

    startAnalysis(async () => {
      try {
        const pool = parseCardPool(analysisPoolText);
        
        const result = await analyzeLimitedPool({
          pool,
          format: "draft",
        });
        
        setAnalysisResult(result);
        toast({
          title: "Analysis Complete",
          description: "Your pool analysis is ready.",
        });
      } catch (error) {
        console.error(error);
        toast({
          variant: "destructive",
          title: "Analysis Failed",
          description: "Failed to analyze pool. Please try again.",
        });
      }
    });
  };

  return (
    <div className="flex h-full min-h-svh w-full flex-col p-4 md:p-6">
      <div className="mb-6">
        <h1 className="font-headline text-3xl font-bold">Draft & Sealed Assistant</h1>
        <p className="text-muted-foreground mt-2">
          Get AI-powered recommendations for your draft picks and sealed deck builds.
        </p>
      </div>

      <Tabs defaultValue="draft" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="draft">Draft Pick</TabsTrigger>
          <TabsTrigger value="sealed">Sealed Build</TabsTrigger>
          <TabsTrigger value="analyze">Pool Analysis</TabsTrigger>
        </TabsList>

        {/* Draft Pick Tab */}
        <TabsContent value="draft">
          <Card>
            <CardHeader>
              <CardTitle>Draft Pick Assistant</CardTitle>
              <CardDescription>
                Enter your current pool and the cards in the pack to get AI recommendations.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="pool">Your Current Pool</Label>
                  <Textarea
                    id="pool"
                    placeholder="Enter cards in your pool (one per line)&#10;Lightning Bolt&#10;Counterspell&#10;Hill Giant"
                    value={poolText}
                    onChange={(e) => setPoolText(e.target.value)}
                    className="min-h-[200px]"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pack">Pack Cards</Label>
                  <Textarea
                    id="pack"
                    placeholder="Enter cards in the pack (one per line)&#10;Fireball&#10;Divination&#10;Giant Growth"
                    value={packText}
                    onChange={(e) => setPackText(e.target.value)}
                    className="min-h-[200px]"
                  />
                </div>
              </div>
              
              <div className="flex items-center gap-4">
                <div className="space-y-2">
                  <Label htmlFor="pickNumber">Pick Number</Label>
                  <input
                    id="pickNumber"
                    type="number"
                    min="1"
                    max="15"
                    value={pickNumber}
                    onChange={(e) => setPickNumber(parseInt(e.target.value) || 1)}
                    className="flex h-10 w-20 rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>
                <Button 
                  onClick={handleDraftAnalysis} 
                  disabled={isAnalyzing}
                  className="mt-5"
                >
                  {isAnalyzing ? "Analyzing..." : "Get Recommendation"}
                </Button>
              </div>

              {draftResult && (
                <Alert className="mt-4">
                  <AlertTitle>Recommended Pick</AlertTitle>
                  <AlertDescription>
                    <p className="mb-2">{draftResult.reasoning}</p>
                    {draftResult.synergies.length > 0 && (
                      <p className="text-sm text-muted-foreground">
                        <strong>Synergies:</strong> {draftResult.synergies.join(", ")}
                      </p>
                    )}
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Sealed Build Tab */}
        <TabsContent value="sealed">
          <Card>
            <CardHeader>
              <CardTitle>Sealed Deck Builder</CardTitle>
              <CardDescription>
                Enter all cards from your sealed pool to get an optimized deck build.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="sealedPool">Sealed Pool</Label>
                <Textarea
                  id="sealedPool"
                  placeholder="Enter all cards in your sealed pool (one per line)&#10;Lightning Bolt&#10;Counterspell&#10;Hill Giant&#10;..."
                  value={sealedPoolText}
                  onChange={(e) => setSealedPoolText(e.target.value)}
                  className="min-h-[300px]"
                />
              </div>
              
              <Button 
                onClick={handleSealedBuild} 
                disabled={isAnalyzing}
              >
                {isAnalyzing ? "Building Deck..." : "Build My Deck"}
              </Button>

              {sealedResult && (
                <div className="mt-4 space-y-4">
                  <Alert>
                    <AlertTitle>Color Recommendation</AlertTitle>
                    <AlertDescription>
                      {sealedResult.colorRecommendation.primary}
                      {sealedResult.colorRecommendation.secondary && 
                        `/${sealedResult.colorRecommendation.secondary}`}
                      {" - "}{sealedResult.colorRecommendation.reasoning}
                    </AlertDescription>
                  </Alert>
                  
                  {sealedResult.archetypes.length > 0 && (
                    <div>
                      <h4 className="font-semibold mb-2">Detected Archetypes</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {sealedResult.archetypes.map((arch, i) => (
                          <div key={i} className="p-2 rounded bg-muted">
                            <strong>{arch.name}</strong> (Score: {arch.score})
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Pool Analysis Tab */}
        <TabsContent value="analyze">
          <Card>
            <CardHeader>
              <CardTitle>Pool Analysis</CardTitle>
              <CardDescription>
                Analyze your card pool for color distribution, mana curve, and power cards.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="analysisPool">Card Pool</Label>
                <Textarea
                  id="analysisPool"
                  placeholder="Enter cards to analyze (one per line)&#10;Lightning Bolt&#10;Counterspell&#10;Hill Giant&#10;..."
                  value={analysisPoolText}
                  onChange={(e) => setAnalysisPoolText(e.target.value)}
                  className="min-h-[300px]"
                />
              </div>
              
              <Button 
                onClick={handlePoolAnalysis} 
                disabled={isAnalyzing}
              >
                {isAnalyzing ? "Analyzing..." : "Analyze Pool"}
              </Button>

              {analysisResult && (
                <div className="mt-4 space-y-4">
                  <Alert>
                    <AlertTitle>Recommended Colors</AlertTitle>
                    <AlertDescription>
                      {analysisResult.recommendedColors.first}
                      {analysisResult.recommendedColors.second && 
                        `/${analysisResult.recommendedColors.second}`}
                      {" - "}{analysisResult.recommendedColors.reasoning}
                    </AlertDescription>
                  </Alert>
                  
                  {analysisResult.powerCards.length > 0 && (
                    <div>
                      <h4 className="font-semibold mb-2">Power Cards (Bombs)</h4>
                      <div className="space-y-1">
                        {analysisResult.powerCards.slice(0, 5).map((card, i) => (
                          <div key={i} className="p-2 rounded bg-muted text-sm">
                            <strong>{card.name}</strong> - {card.reason}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
