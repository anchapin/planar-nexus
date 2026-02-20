'use client';

import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { QrCode, Copy, Check } from 'lucide-react';
import QRCode from 'qrcode';

/**
 * QR Code Display Component
 * Issue #185: Used for sharing game codes in P2P multiplayer
 */
interface QRCodeDisplayProps {
  gameCode: string;
  gameName?: string;
  onCopy?: () => void;
  size?: number;
}

export function QRCodeDisplay({ 
  gameCode, 
  gameName = 'Planar Nexus Game',
  onCopy,
  size = 200 
}: QRCodeDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Generate QR code when game code changes
  useEffect(() => {
    if (!canvasRef.current || !gameCode) return;

    const generateQR = async () => {
      try {
        // Create a URL that the app can handle
        const url = `planar-nexus://join?code=${encodeURIComponent(gameCode)}`;
        
        await QRCode.toCanvas(canvasRef.current, url, {
          width: size,
          margin: 2,
          color: {
            dark: '#000000',
            light: '#ffffff',
          },
          errorCorrectionLevel: 'M',
        });
        
        setError(null);
      } catch (err) {
        console.error('Error generating QR code:', err);
        setError('Failed to generate QR code');
      }
    };

    generateQR();
  }, [gameCode, size]);

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
        {/* QR Code Canvas */}
        <div className="flex justify-center">
          {error ? (
            <div className="w-[200px] h-[200px] flex items-center justify-center bg-muted rounded-lg">
              <QrCode className="w-12 h-12 text-muted-foreground" />
            </div>
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

/**
 * QR Code Scanner Props
 */
interface QRCodeScannerProps {
  onScan: (data: string) => void;
  onError?: (error: Error) => void;
}

/**
 * QR Code Scanner Component
 * Uses device camera to scan QR codes
 * Note: Requires camera permissions and HTTPS
 */
export function QRCodeScanner({ onScan, onError }: QRCodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasCamera, setHasCamera] = useState<boolean | null>(null);
  const [scanning, setScanning] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [showManual, setShowManual] = useState(false);

  // Check for camera availability
  useEffect(() => {
    async function checkCamera() {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cameras = devices.filter(d => d.kind === 'videoinput');
        setHasCamera(cameras.length > 0);
      } catch (err) {
        console.error('Error checking camera:', err);
        setHasCamera(false);
      }
    }
    
    checkCamera();
  }, []);

  const startScanning = async () => {
    if (!videoRef.current) return;
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } 
      });
      
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setScanning(true);
      
      // Note: Full QR scanning would require additional library like jsQR
      // For now, this shows camera preview
    } catch (err) {
      console.error('Error starting camera:', err);
      onError?.(err instanceof Error ? err : new Error('Camera error'));
      setShowManual(true);
    }
  };

  const stopScanning = () => {
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
    }
    setScanning(false);
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualCode.trim()) {
      onScan(manualCode.trim().toUpperCase());
    }
  };

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <QrCode className="w-5 h-5" />
          Scan QR Code
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Camera Preview */}
        <div className="relative aspect-square bg-black rounded-lg overflow-hidden">
          <video 
            ref={videoRef}
            className="w-full h-full object-cover"
            playsInline
            muted
          />
          
          {!scanning && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
              <Button onClick={startScanning} variant="secondary">
                <QrCode className="w-4 h-4 mr-2" />
                Start Scanning
              </Button>
            </div>
          )}
          
          {scanning && (
            <div className="absolute bottom-4 left-4 right-4">
              <Button 
                onClick={stopScanning} 
                variant="destructive"
                className="w-full"
              >
                Stop Scanning
              </Button>
            </div>
          )}
        </div>

        {/* Manual Entry Toggle */}
        <div className="text-center">
          <Button 
            variant="link" 
            onClick={() => setShowManual(!showManual)}
            className="text-sm"
          >
            {showManual ? 'Hide' : 'Enter code manually'}
          </Button>
        </div>

        {/* Manual Code Entry */}
        {showManual && (
          <form onSubmit={handleManualSubmit} className="space-y-2">
            <Label htmlFor="manual-code">Game Code</Label>
            <div className="flex gap-2">
              <Input
                id="manual-code"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value.toUpperCase())}
                placeholder="ABCD12"
                className="font-mono text-lg text-center tracking-widest"
                maxLength={6}
              />
              <Button type="submit" disabled={!manualCode.trim()}>
                Join
              </Button>
            </div>
          </form>
        )}

        {/* Camera Not Available */}
        {hasCamera === false && !showManual && (
          <div className="text-center text-sm text-muted-foreground">
            <p>No camera detected</p>
            <p>Please enter the code manually</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default QRCodeDisplay;
