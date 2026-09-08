/**
 * QR Join Scanner
 * Issue #1728: Implement the QR-code join flow for P2P multiplayer
 *
 * Camera-based QR scanner built on the native BarcodeDetector API
 * (Shape Detection API). Continuously scans the camera feed for a QR
 * code and hands the decoded payload to the parent, which routes it
 * through the existing connection-code join path.
 *
 * Graceful fallback: when BarcodeDetector is unsupported, the camera is
 * denied, or no camera exists, the scanner renders a clear explanation
 * and offers the manual entry path instead of failing silently.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Camera, CameraOff, QrCode, ScanLine, Type } from "lucide-react";

type ScanStatus =
  "starting" | "scanning" | "detected" | "unsupported" | "camera-error";

/**
 * Whether QR scanning can run in this environment.
 *
 * Requires both the native BarcodeDetector API (Chromium-derived
 * browsers) and a getUserMedia implementation (camera access, secure
 * context). Callers use this to decide between opening the scanner and
 * explaining the manual fallback.
 */
export function isQrScanSupported(): boolean {
  if (typeof window === "undefined") return false;
  return (
    typeof window.BarcodeDetector !== "undefined" &&
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

interface QRJoinScannerProps {
  /** Called once with the decoded QR payload. */
  onDetect: (payload: string) => void;
  /** Called when the user dismisses the scanner (falls back to manual entry). */
  onCancel: () => void;
}

export function QRJoinScanner({ onDetect, onCancel }: QRJoinScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<ScanStatus>("starting");
  const [cameraErrorMessage, setCameraErrorMessage] = useState<string | null>(
    null,
  );

  // Keep the latest callback without restarting the camera effect.
  const onDetectRef = useRef(onDetect);
  useEffect(() => {
    onDetectRef.current = onDetect;
  }, [onDetect]);

  useEffect(() => {
    if (!isQrScanSupported()) {
      setStatus("unsupported");
      return;
    }

    let cancelled = false;
    let frame = 0;
    let stream: MediaStream | null = null;
    // Snapshot for the cleanup function — videoRef.current may have changed
    // (or be null) by the time cleanup runs.
    const videoEl = videoRef.current;

    const stopStream = () => {
      stream?.getTracks().forEach((track) => track.stop());
    };

    const run = async () => {
      const BarcodeDetectorCtor = window.BarcodeDetector;
      if (!BarcodeDetectorCtor) {
        setStatus("unsupported");
        return;
      }

      try {
        const detector = new BarcodeDetectorCtor({ formats: ["qr_code"] });

        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (cancelled) {
          stopStream();
          return;
        }

        const video = videoRef.current;
        if (!video) {
          stopStream();
          return;
        }
        video.srcObject = stream;
        await video.play();
        if (cancelled) {
          return;
        }
        setStatus("scanning");

        const detectFrame = async () => {
          if (cancelled || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            const hit = codes.find((code) => code.rawValue);
            if (hit) {
              setStatus("detected");
              onDetectRef.current(hit.rawValue);
              return;
            }
          } catch {
            // Transient decode error on a partially-ready frame — keep scanning.
          }
          frame = requestAnimationFrame(() => {
            void detectFrame();
          });
        };

        void detectFrame();
      } catch (err) {
        if (cancelled) return;
        stopStream();
        setCameraErrorMessage(
          err instanceof Error ? err.message : "Camera unavailable",
        );
        setStatus("camera-error");
      }
    };

    void run();

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      stopStream();
      if (videoEl) {
        videoEl.srcObject = null;
      }
    };
  }, []);

  // Unsupported: no BarcodeDetector or camera API — explain and offer manual entry.
  if (status === "unsupported") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CameraOff className="w-5 h-5" />
            QR Scanning Not Available
          </CardTitle>
          <CardDescription>
            This browser doesn&apos;t support the Barcode Detection API or has
            no camera access
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            QR scanning requires a Chromium-based browser with camera access
            (Chrome, Edge, or the Planar Nexus desktop app). You can still join
            by pasting the host&apos;s connection code manually.
          </p>
          <Button onClick={onCancel} className="w-full">
            <Type className="w-4 h-4 mr-2" />
            Enter Code Manually
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Camera error: permission denied or no camera — explain and offer manual entry.
  if (status === "camera-error") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CameraOff className="w-5 h-5" />
            Camera Unavailable
          </CardTitle>
          <CardDescription>
            QR scanning needs an accessible camera
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant="destructive">
            <AlertDescription>
              {cameraErrorMessage ?? "Could not start the camera."} Check your
              browser&apos;s camera permission for this site and that no other
              app is using the camera, then try again — or enter the connection
              code manually.
            </AlertDescription>
          </Alert>
          <Button onClick={onCancel} className="w-full">
            <Type className="w-4 h-4 mr-2" />
            Enter Code Manually
          </Button>
        </CardContent>
      </Card>
    );
  }

  const statusText =
    status === "detected"
      ? "QR code detected — joining…"
      : status === "scanning"
        ? "Point your camera at the host's QR code"
        : "Starting camera…";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <QrCode className="w-5 h-5" />
          Scan Connection QR
        </CardTitle>
        <CardDescription>
          Hold the host&apos;s QR code in view to join automatically
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="relative aspect-square max-w-sm bg-black rounded-lg overflow-hidden mx-auto">
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            playsInline
            muted
            autoPlay
            aria-label="Camera preview for QR code scanning"
          />
          {status !== "detected" && (
            <div
              className="absolute inset-0 pointer-events-none flex items-center justify-center"
              aria-hidden="true"
            >
              <ScanLine className="w-16 h-16 text-white/70" />
            </div>
          )}
        </div>

        <p
          role="status"
          aria-live="polite"
          className="text-sm text-center text-muted-foreground"
        >
          {statusText}
        </p>

        <Button variant="outline" onClick={onCancel} className="w-full">
          <Camera className="w-4 h-4 mr-2" />
          Stop Scanning
        </Button>
      </CardContent>
    </Card>
  );
}

export default QRJoinScanner;
