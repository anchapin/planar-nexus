/**
 * @fileoverview Telemetry & privacy consent toggle (issue #1112).
 *
 * A strictly opt-in control: telemetry is OFF unless the user flips this
 * Switch on. See docs/PRIVACY.md for the full data policy.
 */

"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { isTelemetryEnabled, setTelemetryConsent } from "@/lib/telemetry";

interface TelemetrySettingsProps {
  className?: string;
}

export function TelemetrySettings({ className }: TelemetrySettingsProps) {
  const [enabled, setEnabled] = useState(false);

  // Load the persisted consent flag on mount (client-only).
  useEffect(() => {
    setEnabled(isTelemetryEnabled());
  }, []);

  const handleToggle = (checked: boolean) => {
    setTelemetryConsent(checked);
    setEnabled(checked);
  };

  return (
    <div className={className}>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {enabled ? (
              <ShieldCheck className="h-5 w-5" />
            ) : (
              <ShieldAlert className="h-5 w-5" />
            )}
            Crash &amp; Error Reporting
          </CardTitle>
          <CardDescription>
            Help improve Planar Nexus by sending anonymous crash and error
            reports. This is strictly opt-in and off by default.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="telemetry-enabled">Enable Crash Reporting</Label>
              <p className="text-sm text-muted-foreground">
                {enabled
                  ? "Reports are being sent when errors occur."
                  : "Nothing is sent. Enable to help diagnose crashes."}
              </p>
            </div>
            <Switch
              id="telemetry-enabled"
              checked={enabled}
              onCheckedChange={handleToggle}
              aria-label="Enable anonymous crash and error reporting"
            />
          </div>

          <Separator />

          <Alert>
            <ShieldCheck className="h-4 w-4" />
            <AlertTitle>What we collect (and don&apos;t)</AlertTitle>
            <AlertDescription>
              <p className="mb-2">
                When enabled, we send only: the error type and message, a stack
                trace, a coarse surface tag (e.g. &quot;P2P&quot;), the app
                version, and a timestamp.
              </p>
              <p className="mb-2">
                We <strong>never</strong> collect card data, deck contents, peer
                identities, room codes, IP addresses, or any other personal
                information. Sensitive substrings are scrubbed before anything
                leaves your device.
              </p>
              <p>
                Reports are stored only locally until you opt in, and you can
                turn this off at any time to stop reporting immediately. See the
                full policy in <code>docs/PRIVACY.md</code>.
              </p>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </div>
  );
}
