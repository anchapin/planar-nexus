/**
 * Ambient type declarations for the Shape Detection API's BarcodeDetector.
 *
 * Used by the P2P QR join flow (issue #1728) to scan the host's
 * connection-code QR with the device camera. The API is not part of
 * TypeScript's bundled lib.dom (it ships in Chromium-derived browsers
 * only), so we declare the minimal surface the app consumes.
 *
 * Always feature-detect before use — see `isQrScanSupported()` in
 * `src/components/qr-join-scanner.tsx`.
 */

interface BarcodeDetectorOptions {
  formats?: string[];
}

interface DetectedBarcode {
  /** Decoded payload of the detected barcode. */
  rawValue: string;
  /** Barcode format that was detected (e.g. "qr_code"). */
  format: string;
  boundingBox: DOMRectReadOnly;
  cornerPoints: Array<{ x: number; y: number }>;
}

declare class BarcodeDetector {
  constructor(options?: BarcodeDetectorOptions);
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
  static getSupportedFormats(): Promise<string[]>;
}

interface Window {
  BarcodeDetector?: typeof BarcodeDetector;
}
