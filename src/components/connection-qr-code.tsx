/**
 * Connection QR Code Component
 * Issue #444: Implement QR code generation for connection codes
 *
 * This component displays a QR code for sharing connection data
 * and provides options for manual code entry.
 */

'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Copy, Check, Download, QrCode, Keyboard, RefreshCw } from 'lucide-react';
import { generateQRCode, downloadQRCode, copyConnectionData, supportsClipboardAPI } from '@/lib/qr-code-generator';
import type { ConnectionData } from '@/lib/client-signaling';

interface ConnectionQRCodeProps {
  connectionData: ConnectionData | null;
  isLoading?: boolean;
  onManualEntry?: (data: string) => void;
  onRefresh?: () => void;
  isHost?: boolean;
}

export function ConnectionQRCode({
  connectionData,
  isLoading = false,
  onManualEntry,
  onRefresh,
  isHost = false,
}: ConnectionQRCodeProps) {
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isGeneratingQR, setIsGeneratingQR] = useState(false);

  // Generate QR code when connection data changes
  useEffect(() => {
    async function generateQR() {
      if (!connectionData) {
        setQrCodeDataUrl(null);
        return;
      }

      setIsGeneratingQR(true);
      try {
        const dataUrl = await generateQRCode(connectionData);
        setQrCodeDataUrl(dataUrl);
        setError(null);
      } catch (err) {
        console.error('Failed to generate QR code:', err);
        setError('Failed to generate QR code');
      } finally {
        setIsGeneratingQR(false);
      }
    }

    generateQR();
  }, [connectionData]);

  // Reset copied state after 2 seconds
  useEffect(() => {
    if (copied) {
      const timeout = setTimeout(() => setCopied(false), 2000);
      return () => clearTimeout(timeout);
    }
  }, [copied]);

  const handleCopy = async () => {
    if (!connectionData) return;

    try {
      await copyConnectionData(connectionData);
      setCopied(true);
      setError(null);
    } catch (err) {
      console.error('Failed to copy:', err);
      setError('Failed to copy to clipboard');
    }
  };

  const handleDownload = () => {
    if (!qrCodeDataUrl) return;

    try {
      downloadQRCode(qrCodeDataUrl, 'planar-nexus-connection.png');
      setError(null);
    } catch (err) {
      console.error('Failed to download:', err);
      setError('Failed to download QR code');
    }
  };

  const handleManualSubmit = () => {
    if (!manualCode.trim()) return;

    setError(null);
    if (onManualEntry) {
      onManualEntry(manualCode.trim());
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Connection Setup</CardTitle>
          <CardDescription>
            {isHost ? 'Creating connection...' : 'Waiting for connection...'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {isHost ? 'Share Connection' : 'Join Game'}
          {onRefresh && (
            <Button variant="ghost" size="sm" onClick={onRefresh} className="ml-auto">
              <RefreshCw className="w-4 h-4" />
            </Button>
          )}
        </CardTitle>
        <CardDescription>
          {isHost
            ? 'Share this QR code or connection string with your opponent'
            : 'Scan the QR code or enter the connection string'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="qr" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="qr" className="flex items-center gap-2">
              <QrCode className="w-4 h-4" />
              QR Code
            </TabsTrigger>
            <TabsTrigger value="manual" className="flex items-center gap-2">
              <Keyboard className="w-4 h-4" />
              Manual Entry
            </TabsTrigger>
          </TabsList>

          <TabsContent value="qr" className="mt-4">
            {isGeneratingQR && (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            )}

            {!isGeneratingQR && qrCodeDataUrl && (
              <div className="flex flex-col items-center space-y-4">
                <div className="p-4 bg-white rounded-lg border">
                  <img
                    src={qrCodeDataUrl}
                    alt="Connection QR Code"
                    className="w-64 h-64"
                  />
                </div>

                <div className="flex gap-2">
                  {supportsClipboardAPI() && (
                    <Button onClick={handleCopy} variant="outline" size="sm">
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
                  )}

                  <Button onClick={handleDownload} variant="outline" size="sm">
                    <Download className="w-4 h-4 mr-2" />
                    Download
                  </Button>
                </div>

                <p className="text-xs text-muted-foreground text-center max-w-md">
                  Share this QR code with your opponent to connect. You can also scan
                  their QR code or enter their connection string manually.
                </p>
              </div>
            )}

            {!qrCodeDataUrl && !isGeneratingQR && connectionData && (
              <Alert>
                <AlertDescription>
                  Connection data is ready, but QR code generation failed.
                  Please use manual entry instead.
                </AlertDescription>
              </Alert>
            )}
          </TabsContent>

          <TabsContent value="manual" className="mt-4">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="manual-code">
                  {isHost ? 'Your Connection Code' : 'Enter Connection Code'}
                </Label>
                <Input
                  id="manual-code"
                  value={manualCode}
                  onChange={(e) => setManualCode(e.target.value)}
                  placeholder={isHost ? 'Generated automatically' : 'Paste connection code here...'}
                  disabled={isHost}
                  className="font-mono text-sm"
                  readOnly={isHost}
                />
              </div>

              {isHost && connectionData && (
                <Button
                  onClick={handleCopy}
                  variant="outline"
                  className="w-full"
                  disabled={!supportsClipboardAPI()}
                >
                  {copied ? (
                    <>
                      <Check className="w-4 h-4 mr-2" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4 mr-2" />
                      Copy Connection Code
                    </>
                  )}
                </Button>
              )}

              {!isHost && onManualEntry && (
                <Button
                  onClick={handleManualSubmit}
                  className="w-full"
                  disabled={!manualCode.trim()}
                >
                  Connect
                </Button>
              )}

              <p className="text-xs text-muted-foreground text-center">
                {isHost
                  ? 'Copy this code and share it with your opponent'
                  : 'Paste the connection code from your opponent'}
              </p>
            </div>
          </TabsContent>
        </Tabs>

        {error && (
          <Alert variant="destructive" className="mt-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
