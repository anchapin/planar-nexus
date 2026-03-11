/**
 * @fileOverview Connection Data Entry Component
 *
 * Unit 10: Client-Side Multiplayer Signaling
 *
 * Allows manual entry of connection data for P2P establishment
 */

'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Link, RefreshCw, AlertTriangle } from 'lucide-react';
import {
  ConnectionData,
  parseConnectionData,
  validateConnectionData,
  generateConnectionString,
} from '@/lib/p2p-direct-connection';

interface ConnectionDataEntryProps {
  onConnect: (data: ConnectionData) => void;
  className?: string;
}

export function ConnectionDataEntry({ onConnect, className = '' }: ConnectionDataEntryProps) {
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [parsedData, setParsedData] = useState<ConnectionData | null>(null);

  const handleInputChange = (value: string) => {
    setInput(value);
    setError(null);

    try {
      const data = parseConnectionData(value);
      if (data) {
        const isValid = validateConnectionData(data);
        if (isValid) {
          setParsedData(data);
          setError(null);
        } else {
          setParsedData(null);
          setError('Invalid or expired connection data');
        }
      } else {
        setParsedData(null);
      }
    } catch (err) {
      setParsedData(null);
    }
  };

  const handleConnect = () => {
    if (parsedData) {
      onConnect(parsedData);
    }
  };

  const handleClear = () => {
    setInput('');
    setParsedData(null);
    setError(null);
  };

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link className="w-5 h-5" />
          Enter Connection Data
        </CardTitle>
        <CardDescription>
          Paste the connection code from your opponent
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Instructions */}
        <div className="text-xs text-muted-foreground space-y-2 p-3 bg-muted/50 rounded-lg">
          <p className="font-medium">How to connect:</p>
          <ol className="list-decimal list-inside space-y-1">
            <li>Ask your opponent to share their connection code</li>
            <li>They can copy it or save the QR code image</li>
            <li>Paste the connection code below</li>
            <li>Connection will be established automatically</li>
          </ol>
          <p className="pt-2 border-t">
            <strong>Note:</strong> Connection codes expire after 1 hour for security.
          </p>
        </div>

        {/* Connection Data Input */}
        <div className="space-y-2">
          <label htmlFor="connection-data" className="text-sm font-medium">
            Connection Code
          </label>
          <Textarea
            id="connection-data"
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            placeholder='{"type":"offer","sessionId":"...","sdp":{...},"gameCode":"ABC123","hostName":"Player 1","format":"commander","timestamp":1234567890}'
            className="font-mono text-xs min-h-[120px]"
            spellCheck={false}
          />
        </div>

        {/* Validation Status */}
        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="w-4 h-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {parsedData && (
          <Alert>
            <AlertDescription className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-medium">Valid connection data</span>
                <span className="text-xs text-muted-foreground">
                  Host: {parsedData.hostName}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                Game Code: <span className="font-mono font-bold">{parsedData.gameCode}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                Type: <span className="font-semibold">{parsedData.type.toUpperCase()}</span>
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-3">
          <Button
            onClick={handleClear}
            variant="outline"
            className="flex items-center justify-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            Clear
          </Button>

          <Button
            onClick={handleConnect}
            disabled={!parsedData}
            className="flex items-center justify-center gap-2"
          >
            <Link className="w-4 h-4" />
            Connect
          </Button>
        </div>

        {/* Troubleshooting */}
        <details className="text-xs">
          <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">
            Troubleshooting
          </summary>
          <div className="mt-2 space-y-2 p-3 bg-muted/30 rounded-lg">
            <p><strong>Connection data invalid?</strong></p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>Make sure you copied the entire connection code</li>
              <li>Check that the code hasn't expired (1 hour limit)</li>
              <li>Ask your opponent to generate a new connection code</li>
            </ul>
            <p className="mt-2"><strong>Connection failing?</strong></p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>Check your internet connection</li>
              <li>Try disabling VPN or firewall temporarily</li>
              <li>Ensure both players are using the latest app version</li>
              <li>Try using manual code entry instead of QR code</li>
            </ul>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

/**
 * ICE Candidate Exchange Component
 *
 * For exchanging ICE candidates when manual connection requires it
 */
interface ICECandidateExchangeProps {
  sessionId: string;
  onSendCandidate?: (candidate: RTCIceCandidateInit) => void;
  onReceiveCandidate?: (candidate: RTCIceCandidateInit) => void;
  className?: string;
}

export function ICECandidateExchange({
  sessionId,
  onSendCandidate,
  onReceiveCandidate,
  className = '',
}: ICECandidateExchangeProps) {
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSendCandidate = () => {
    try {
      const parsed = JSON.parse(input);
      if (parsed.type === 'ice-candidate' && parsed.candidate) {
        onReceiveCandidate?.(parsed.candidate);
        setError(null);
      } else {
        setError('Invalid ICE candidate data');
      }
    } catch (err) {
      setError('Failed to parse ICE candidate data');
    }
  };

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-lg">ICE Candidate Exchange</CardTitle>
        <CardDescription>
          Exchange ICE candidates if automatic connection fails
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <Alert>
          <AlertDescription className="text-xs">
            This is a fallback option. Most connections should work automatically.
          </AlertDescription>
        </Alert>

        <div className="space-y-2">
          <label htmlFor="ice-candidate" className="text-sm font-medium">
            ICE Candidate Data
          </label>
          <Textarea
            id="ice-candidate"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder='{"type":"ice-candidate","sessionId":"...","candidate":{...}}'
            className="font-mono text-xs min-h-[80px]"
            spellCheck={false}
          />
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Button
          onClick={handleSendCandidate}
          disabled={!input.trim()}
          className="w-full"
          variant="outline"
        >
          Send ICE Candidate
        </Button>
      </CardContent>
    </Card>
  );
}
