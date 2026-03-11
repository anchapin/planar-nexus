/**
 * Signaling Exchange Component
 * Issue #444: Unit 10: Client-Side Multiplayer Signaling
 *
 * Provides UI for manual WebRTC signaling data exchange between peers
 */

'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Copy, Check, ArrowRight, ArrowLeft, Upload, Download } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Signaling Exchange Props
 */
export interface SignalingExchangeProps {
  /** Current handshake step */
  step: 'idle' | 'waiting-for-offer' | 'waiting-for-answer' | 'waiting-for-candidates' | 'completed' | 'failed';
  /** Local offer/answer data to share */
  localData: string | null;
  /** Handler for receiving remote data */
  onReceiveData: (data: string) => Promise<void>;
  /** Handler for generating local data */
  onGenerateData?: () => Promise<string>;
  /** Custom className */
  className?: string;
  /** Mode: 'host' or 'client' */
  mode: 'host' | 'client';
}

/**
 * Signaling Exchange Component
 *
 * Provides a user-friendly interface for exchanging WebRTC signaling data
 * between two peers via copy-paste
 */
export function SignalingExchange({
  step,
  localData,
  onReceiveData,
  onGenerateData,
  className,
  mode,
}: SignalingExchangeProps) {
  const [copied, setCopied] = useState(false);
  const [remoteData, setRemoteData] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleCopy = async () => {
    if (!localData) return;

    try {
      await navigator.clipboard.writeText(localData);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
      setError('Failed to copy to clipboard');
    }
  };

  const handleReceive = async () => {
    if (!remoteData.trim()) {
      setError('Please enter the data from your opponent');
      return;
    }

    try {
      setError(null);
      await onReceiveData(remoteData.trim());
      setRemoteData('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to process data';
      setError(message);
    }
  };

  const handleGenerate = async () => {
    if (!onGenerateData) return;

    try {
      setError(null);
      await onGenerateData();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate data';
      setError(message);
    }
  };

  const getStepTitle = () => {
    switch (step) {
      case 'idle':
        return 'Initialize Connection';
      case 'waiting-for-offer':
        return mode === 'host' ? 'Generate Offer' : 'Waiting for Offer';
      case 'waiting-for-answer':
        return mode === 'host' ? 'Waiting for Answer' : 'Generate Answer';
      case 'waiting-for-candidates':
        return 'Exchanging ICE Candidates';
      case 'completed':
        return 'Connected!';
      case 'failed':
        return 'Connection Failed';
      default:
        return 'Unknown Step';
    }
  };

  const getStepDescription = () => {
    switch (step) {
      case 'idle':
        return 'Click below to start the connection process';
      case 'waiting-for-offer':
        return mode === 'host'
          ? 'Generate your offer and share it with your opponent'
          : 'Enter the offer from your opponent below';
      case 'waiting-for-answer':
        return mode === 'host'
          ? 'Enter the answer from your opponent below'
          : 'Generate your answer and share it with your opponent';
      case 'waiting-for-candidates':
        return 'Exchanging ICE candidates for NAT traversal...';
      case 'completed':
        return 'Connection established! You can now play together.';
      case 'failed':
        return 'Connection failed. Please try again.';
      default:
        return '';
    }
  };

  const canGenerate = mode === 'host' && step === 'waiting-for-offer';
  const canReceive = mode === 'client' && step === 'waiting-for-offer';
  const canReceiveAnswer = mode === 'host' && step === 'waiting-for-answer';
  const canGenerateAnswer = mode === 'client' && step === 'waiting-for-answer';

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {mode === 'host' ? <ArrowRight className="w-5 h-5" /> : <ArrowLeft className="w-5 h-5" />}
          {getStepTitle()}
        </CardTitle>
        <CardDescription>{getStepDescription()}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Error Alert */}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Success State */}
        {step === 'completed' && (
          <div className="text-center py-8">
            <div className="text-green-500 text-4xl mb-4">✓</div>
            <p className="text-lg font-medium">Successfully Connected!</p>
            <p className="text-sm text-muted-foreground mt-2">
              You can now start playing with your opponent.
            </p>
          </div>
        )}

        {/* Failed State */}
        {step === 'failed' && (
          <div className="text-center py-8">
            <div className="text-red-500 text-4xl mb-4">✗</div>
            <p className="text-lg font-medium">Connection Failed</p>
            <p className="text-sm text-muted-foreground mt-2">
              Please check your network connection and try again.
            </p>
          </div>
        )}

        {/* Active Steps */}
        {step !== 'completed' && step !== 'failed' && (
          <>
            {/* Local Data Section */}
            {localData && (canGenerate || canGenerateAnswer) && (
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Download className="w-4 h-4" />
                  Your {mode === 'host' ? 'Offer' : 'Answer'} to Share
                </Label>
                <div className="space-y-2">
                  <textarea
                    value={localData}
                    readOnly
                    className="w-full min-h-32 p-3 border rounded-md font-mono text-xs bg-muted resize-none"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleCopy}
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
                        Copy to Clipboard
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}

            {/* Generate Button */}
            {canGenerate && onGenerateData && (
              <Button
                type="button"
                onClick={handleGenerate}
                className="w-full"
                size="lg"
              >
                <Download className="w-4 h-4 mr-2" />
                Generate Offer
              </Button>
            )}

            {canGenerateAnswer && onGenerateData && (
              <Button
                type="button"
                onClick={handleGenerate}
                className="w-full"
                size="lg"
              >
                <Download className="w-4 h-4 mr-2" />
                Generate Answer
              </Button>
            )}

            {/* Remote Data Section */}
            {(canReceive || canReceiveAnswer) && (
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Upload className="w-4 h-4" />
                  Enter {mode === 'host' ? 'Answer' : 'Offer'} from Opponent
                </Label>
                <div className="space-y-2">
                  <textarea
                    value={remoteData}
                    onChange={(e) => setRemoteData(e.target.value)}
                    placeholder={`Paste the ${mode === 'host' ? 'answer' : 'offer'} from your opponent here...`}
                    className="w-full min-h-32 p-3 border rounded-md font-mono text-xs resize-none"
                  />
                  <Button
                    type="button"
                    onClick={handleReceive}
                    disabled={!remoteData.trim()}
                    className="w-full"
                  >
                    <Upload className="w-4 h-4 mr-2" />
                    Process {mode === 'host' ? 'Answer' : 'Offer'}
                  </Button>
                </div>
              </div>
            )}

            {/* Instructions */}
            <div className="text-xs text-muted-foreground space-y-2 bg-muted p-4 rounded-lg">
              <p className="font-medium">Instructions:</p>
              <ol className="list-decimal list-inside space-y-1">
                {mode === 'host' ? (
                  <>
                    <li>Generate your offer above</li>
                    <li>Copy the offer and send it to your opponent</li>
                    <li>Wait for your opponent to send you their answer</li>
                    <li>Paste the answer below and process it</li>
                  </>
                ) : (
                  <>
                    <li>Get the offer from your opponent</li>
                    <li>Paste the offer below and process it</li>
                    <li>Generate your answer</li>
                    <li>Copy the answer and send it to your opponent</li>
                  </>
                )}
              </ol>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
