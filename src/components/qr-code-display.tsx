"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { QrCode, Copy, Check } from "lucide-react";
import QRCode from "qrcode";

/**
 * QR Code Display Component
 * Issue #185: Used for sharing game codes in P2P multiplayer
 * Issue #1728: `payload` renders a QR encoding the raw connection code
 * (the serialized signaling offer) so opponents can scan to join.
 */
interface QRCodeDisplayProps {
  qrCode?: string;
  /**
   * Raw string to encode as a QR code (e.g. the serialized connection
   * code / signaling offer). Takes priority over the game-code URL.
   * Rendered with low error correction to maximize data capacity; if
   * the payload exceeds QR capacity the component explains that the
   * code must be shared manually instead.
   */
  payload?: string;
  gameCode: string;
  gameName?: string;
  onCopy?: () => void;
  size?: number;
  connectionInfo?: {
    hostName: string;
    timestamp: number;
  };
}

export function QRCodeDisplay({
  qrCode,
  payload,
  gameCode,
  gameName = "Planar Nexus Game",
  onCopy,
  size = 200,
  connectionInfo,
}: QRCodeDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payloadDataUrl, setPayloadDataUrl] = useState<string | null>(null);

  // Generate a QR from the raw connection-code payload (issue #1728).
  useEffect(() => {
    if (!payload) {
      setPayloadDataUrl(null);
      return;
    }

    let cancelled = false;

    const generatePayloadQR = async () => {
      try {
        const dataUrl = await QRCode.toDataURL(payload, {
          width: size,
          margin: 2,
          color: {
            dark: "#000000",
            light: "#ffffff",
          },
          // Low error correction maximizes capacity for long SDP payloads;
          // the code is shown on screen (not printed), so damage is unlikely.
          errorCorrectionLevel: "L",
        });
        if (!cancelled) {
          setPayloadDataUrl(dataUrl);
          setError(null);
        }
      } catch (err) {
        console.error("Error generating connection QR code:", err);
        if (!cancelled) {
          setPayloadDataUrl(null);
          setError(
            "This connection code is too long to display as a QR code. Share it manually using copy and paste instead.",
          );
        }
      }
    };

    void generatePayloadQR();

    return () => {
      cancelled = true;
    };
  }, [payload, size]);

  // Generate QR code when game code changes (if neither payload nor
  // pre-generated qrCode is provided).
  useEffect(() => {
    if (payload || qrCode) return; // payload / pre-generated QR take priority
    if (!canvasRef.current || !gameCode) return;

    const generateQR = async () => {
      try {
        // Create a URL that the app can handle
        const url = `planar-nexus://join?code=${encodeURIComponent(gameCode)}`;

        await QRCode.toCanvas(canvasRef.current, url, {
          width: size,
          margin: 2,
          color: {
            dark: "#000000",
            light: "#ffffff",
          },
          errorCorrectionLevel: "M",
        });

        setError(null);
      } catch (err) {
        console.error("Error generating QR code:", err);
        setError("Failed to generate QR code");
      }
    };

    generateQR();
  }, [gameCode, size, qrCode, payload]);

  const handleCopy = () => {
    navigator.clipboard.writeText(gameCode);
    setCopied(true);
    onCopy?.();

    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card className="w-full max-w-xs">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <QrCode className="w-5 h-5" />
          Join Game
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* QR Code Canvas or Image */}
        <div className="flex justify-center">
          {error ? (
            <div className="w-[200px] h-[200px] flex items-center justify-center bg-muted rounded-lg text-center p-4">
              <div>
                <QrCode className="w-12 h-12 mx-auto text-muted-foreground" />
                <p className="text-xs text-muted-foreground mt-2">{error}</p>
              </div>
            </div>
          ) : qrCode ? (
            <img
              src={qrCode}
              alt="QR Code"
              className="rounded-lg border-2 border-border"
              style={{ width: size, height: size }}
            />
          ) : payload || payloadDataUrl ? (
            payloadDataUrl ? (
              <img
                src={payloadDataUrl}
                alt="Connection QR code"
                className="rounded-lg border-2 border-border"
                style={{ width: size, height: size }}
              />
            ) : (
              <div
                className="flex items-center justify-center bg-muted rounded-lg"
                style={{ width: size, height: size }}
                aria-label="Generating connection QR code"
              >
                <QrCode className="w-12 h-12 text-muted-foreground animate-pulse" />
              </div>
            )
          ) : (
            <canvas
              ref={canvasRef}
              className="rounded-lg border-2 border-border"
            />
          )}
        </div>

        {/* Game Name */}
        <div className="text-center">
          <p className="font-medium text-sm">{gameName}</p>
          <p className="text-xs text-muted-foreground">Scan to join</p>
        </div>

        {/* Game Code */}
        <div className="space-y-2">
          <Label htmlFor="game-code" className="text-xs text-muted-foreground">
            Game Code
          </Label>
          <div className="flex gap-2">
            <Input
              id="game-code"
              value={gameCode}
              readOnly
              className="font-mono text-lg text-center tracking-widest"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={handleCopy}
              aria-label="Copy game code"
              title="Copy code"
            >
              {copied ? (
                <Check className="w-4 h-4 text-green-500" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>

        {/* Instructions */}
        <div className="text-xs text-muted-foreground text-center">
          <p>Or enter this code in the Join Game screen</p>
        </div>
      </CardContent>
    </Card>
  );
}

export default QRCodeDisplay;
