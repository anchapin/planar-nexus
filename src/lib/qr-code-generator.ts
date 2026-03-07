/**
 * QR Code Generation Utility
 * Issue #444: Implement QR code generation for connection codes
 *
 * This module provides QR code generation functionality for sharing connection data.
 */

import QRCode from 'qrcode';
import { ConnectionData, encodeConnectionData } from './client-signaling';

/**
 * QR code generation options
 */
export interface QRCodeOptions {
  width?: number;
  margin?: number;
  color?: {
    dark?: string;
    light?: string;
  };
  errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
}

/**
 * Default QR code options
 */
const DEFAULT_OPTIONS: QRCodeOptions = {
  width: 300,
  margin: 2,
  color: {
    dark: '#000000',
    light: '#ffffff',
  },
  errorCorrectionLevel: 'M',
};

/**
 * Generate QR code data URL from connection data
 */
export async function generateQRCode(
  data: ConnectionData,
  options: QRCodeOptions = {}
): Promise<string> {
  const mergedOptions = { ...DEFAULT_OPTIONS, ...options };

  try {
    // Encode connection data to base64
    const encodedData = encodeConnectionData(data);

    // Generate QR code
    const qrDataURL = await QRCode.toDataURL(encodedData, mergedOptions);

    return qrDataURL;
  } catch (error) {
    console.error('[QRCode] Failed to generate QR code:', error);
    throw new Error('Failed to generate QR code');
  }
}

/**
 * Generate QR code as SVG from connection data
 */
export async function generateQRCodeSVG(
  data: ConnectionData,
  options: QRCodeOptions = {}
): Promise<string> {
  const mergedOptions = { ...DEFAULT_OPTIONS, ...options };

  try {
    // Encode connection data to base64
    const encodedData = encodeConnectionData(data);

    // Generate QR code as SVG
    const svgString = await QRCode.toString(encodedData, {
      ...mergedOptions,
      type: 'svg',
    });

    return svgString;
  } catch (error) {
    console.error('[QRCode] Failed to generate QR code SVG:', error);
    throw new Error('Failed to generate QR code SVG');
  }
}

/**
 * Generate QR code data URL from encoded string
 */
export async function generateQRCodeFromEncoded(
  encodedData: string,
  options: QRCodeOptions = {}
): Promise<string> {
  const mergedOptions = { ...DEFAULT_OPTIONS, ...options };

  try {
    const qrDataURL = await QRCode.toDataURL(encodedData, mergedOptions);
    return qrDataURL;
  } catch (error) {
    console.error('[QRCode] Failed to generate QR code:', error);
    throw new Error('Failed to generate QR code');
  }
}

/**
 * Download QR code as PNG image
 */
export function downloadQRCode(dataURL: string, filename: string = 'connection-qr.png'): void {
  try {
    const link = document.createElement('a');
    link.href = dataURL;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (error) {
    console.error('[QRCode] Failed to download QR code:', error);
    throw new Error('Failed to download QR code');
  }
}

/**
 * Copy connection data to clipboard
 */
export async function copyConnectionData(data: ConnectionData): Promise<void> {
  try {
    const encodedData = encodeConnectionData(data);
    await navigator.clipboard.writeText(encodedData);
  } catch (error) {
    console.error('[QRCode] Failed to copy connection data:', error);
    throw new Error('Failed to copy connection data to clipboard');
  }
}

/**
 * Paste connection data from clipboard
 */
export async function pasteConnectionData(): Promise<string> {
  try {
    const text = await navigator.clipboard.readText();
    return text;
  } catch (error) {
    console.error('[QRCode] Failed to paste connection data:', error);
    throw new Error('Failed to paste connection data from clipboard');
  }
}

/**
 * Check if browser supports clipboard API
 */
export function supportsClipboardAPI(): boolean {
  return typeof navigator !== 'undefined' &&
         typeof navigator.clipboard !== 'undefined' &&
         typeof navigator.clipboard.writeText === 'function' &&
         typeof navigator.clipboard.readText === 'function';
}
