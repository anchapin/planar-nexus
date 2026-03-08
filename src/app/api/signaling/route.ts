/**
 * Signaling Server API Route
 * Issue #285: Implement signaling server for WebRTC handshake
 *
 * IMPORTANT: This API route requires a server and is NOT supported in static export mode.
 * For client-side only deployment, use the serverless P2P direct connection
 * implemented in `src/lib/p2p-direct-connection.ts` instead.
 *
 * This is a lightweight signaling server implemented as a Next.js API route
 * that enables WebRTC connections between players when a server is available.
 *
 * Features:
 * - Session establishment between peers
 * - Game code generation and lookup
 * - Minimal state (only for connection establishment)
 * - Offer/Answer/ICE candidate exchange
 *
 * Note: In static export mode (client-side only), this route will not function.
 * Use the QR code/manual code entry P2P system instead.
 */

import { NextRequest, NextResponse } from 'next/server';

/**
 * In-memory session storage
 * In production, this would be replaced with Redis or similar
 * Sessions are short-lived (only for connection establishment)
 */
interface SignalingSession {
  id: string;
  gameCode: string;
  hostId: string;
  hostName: string;
  createdAt: number;
  expiresAt: number;
  offer?: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
  hostCandidates: RTCIceCandidateInit[];
  clientCandidates: RTCIceCandidateInit[];
  clientId?: string;
  clientName?: string;
}

interface SignalingMessage {
  type: 'offer' | 'answer' | 'ice-candidate' | 'join' | 'create' | 'poll' | 'close';
  payload: unknown;
}

// In-memory storage - sessions expire after 5 minutes
const sessions = new Map<string, SignalingSession>();
const SESSION_TIMEOUT = 5 * 60 * 1000; // 5 minutes

/**
 * Clean up expired sessions
 */
function cleanupExpiredSessions(): void {
  const now = Date.now();
  sessions.forEach((session, id) => {
    if (session.expiresAt < now) {
      sessions.delete(id);
    }
  });
}

/**
 * Generate a short game code
 */
function generateGameCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Generate a unique session ID
 */
function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * GET /api/signaling - Poll for session updates
 * Query params: gameCode or sessionId
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  cleanupExpiredSessions();
  
  const { searchParams } = new URL(request.url);
  const gameCode = searchParams.get('gameCode');
  const sessionId = searchParams.get('sessionId');
  const role = searchParams.get('role'); // 'host' or 'client'
  
  if (!gameCode && !sessionId) {
    return NextResponse.json(
      { error: 'gameCode or sessionId required' },
      { status: 400 }
    );
  }
  
  // Find session by game code or session ID
  let session: SignalingSession | undefined;
  if (gameCode) {
    session = Array.from(sessions.values()).find(s => s.gameCode === gameCode);
  } else if (sessionId) {
    session = sessions.get(sessionId);
  }
  
  if (!session) {
    return NextResponse.json(
      { error: 'Session not found' },
      { status: 404 }
    );
  }
  
  // Return session state based on role
  const response: Record<string, unknown> = {
    sessionId: session.id,
    gameCode: session.gameCode,
    hostName: session.hostName,
    clientName: session.clientName,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
  };
  
  if (role === 'host') {
    // Host wants to know about client connection and answer
    response.answer = session.answer;
    response.clientCandidates = session.clientCandidates;
    response.clientId = session.clientId;
    response.clientName = session.clientName;
  } else {
    // Client wants offer and host candidates
    response.offer = session.offer;
    response.hostCandidates = session.hostCandidates;
    response.hostId = session.hostId;
  }
  
  return NextResponse.json(response);
}

/**
 * POST /api/signaling - Create session, join session, or exchange signaling data
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  cleanupExpiredSessions();
  
  let body: SignalingMessage;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 }
    );
  }
  
  const { type, payload } = body;
  
  switch (type) {
    case 'create':
      return handleCreateSession(payload as {
        hostId: string;
        hostName: string;
        offer?: RTCSessionDescriptionInit;
      });
    
    case 'join':
      return handleJoinSession(payload as {
        gameCode: string;
        clientId: string;
        clientName: string;
      });
    
    case 'offer':
      return handleOffer(payload as {
        sessionId: string;
        offer: RTCSessionDescriptionInit;
      });
    
    case 'answer':
      return handleAnswer(payload as {
        sessionId: string;
        answer: RTCSessionDescriptionInit;
      });
    
    case 'ice-candidate':
      return handleIceCandidate(payload as {
        sessionId: string;
        candidate: RTCIceCandidateInit;
        role: 'host' | 'client';
      });
    
    case 'close':
      return handleCloseSession(payload as { sessionId: string });
    
    default:
      return NextResponse.json(
        { error: 'Unknown message type' },
        { status: 400 }
      );
  }
}

/**
 * Handle session creation
 */
function handleCreateSession(payload: {
  hostId: string;
  hostName: string;
  offer?: RTCSessionDescriptionInit;
}): NextResponse {
  const { hostId, hostName, offer } = payload;
  
  if (!hostId || !hostName) {
    return NextResponse.json(
      { error: 'hostId and hostName required' },
      { status: 400 }
    );
  }
  
  // Generate unique game code
  let gameCode = generateGameCode();
  let attempts = 0;
  while (Array.from(sessions.values()).some(s => s.gameCode === gameCode)) {
    gameCode = generateGameCode();
    attempts++;
    if (attempts > 10) {
      return NextResponse.json(
        { error: 'Failed to generate unique game code' },
        { status: 500 }
      );
    }
  }
  
  const now = Date.now();
  const session: SignalingSession = {
    id: generateSessionId(),
    gameCode,
    hostId,
    hostName,
    createdAt: now,
    expiresAt: now + SESSION_TIMEOUT,
    offer,
    hostCandidates: [],
    clientCandidates: [],
  };
  
  sessions.set(session.id, session);
  
  return NextResponse.json({
    success: true,
    sessionId: session.id,
    gameCode: session.gameCode,
    expiresAt: session.expiresAt,
  });
}

/**
 * Handle joining a session
 */
function handleJoinSession(payload: {
  gameCode: string;
  clientId: string;
  clientName: string;
}): NextResponse {
  const { gameCode, clientId, clientName } = payload;
  
  if (!gameCode || !clientId || !clientName) {
    return NextResponse.json(
      { error: 'gameCode, clientId, and clientName required' },
      { status: 400 }
    );
  }
  
  const session = Array.from(sessions.values()).find(s => s.gameCode === gameCode);
  
  if (!session) {
    return NextResponse.json(
      { error: 'Session not found' },
      { status: 404 }
    );
  }
  
  if (session.expiresAt < Date.now()) {
    sessions.delete(session.id);
    return NextResponse.json(
      { error: 'Session expired' },
      { status: 410 }
    );
  }
  
  // Check if session already has a client
  if (session.clientId && session.clientId !== clientId) {
    return NextResponse.json(
      { error: 'Session already has a client' },
      { status: 409 }
    );
  }
  
  // Register client
  session.clientId = clientId;
  session.clientName = clientName;
  
  return NextResponse.json({
    success: true,
    sessionId: session.id,
    hostId: session.hostId,
    hostName: session.hostName,
    offer: session.offer,
    hostCandidates: session.hostCandidates,
  });
}

/**
 * Handle offer update from host
 */
function handleOffer(payload: {
  sessionId: string;
  offer: RTCSessionDescriptionInit;
}): NextResponse {
  const { sessionId, offer } = payload;
  
  const session = sessions.get(sessionId);
  if (!session) {
    return NextResponse.json(
      { error: 'Session not found' },
      { status: 404 }
    );
  }
  
  session.offer = offer;
  
  return NextResponse.json({ success: true });
}

/**
 * Handle answer from client
 */
function handleAnswer(payload: {
  sessionId: string;
  answer: RTCSessionDescriptionInit;
}): NextResponse {
  const { sessionId, answer } = payload;
  
  const session = sessions.get(sessionId);
  if (!session) {
    return NextResponse.json(
      { error: 'Session not found' },
      { status: 404 }
    );
  }
  
  session.answer = answer;
  
  return NextResponse.json({ success: true });
}

/**
 * Handle ICE candidate
 */
function handleIceCandidate(payload: {
  sessionId: string;
  candidate: RTCIceCandidateInit;
  role: 'host' | 'client';
}): NextResponse {
  const { sessionId, candidate, role } = payload;
  
  const session = sessions.get(sessionId);
  if (!session) {
    return NextResponse.json(
      { error: 'Session not found' },
      { status: 404 }
    );
  }
  
  if (role === 'host') {
    session.hostCandidates.push(candidate);
  } else {
    session.clientCandidates.push(candidate);
  }
  
  return NextResponse.json({ success: true });
}

/**
 * Handle session close
 */
function handleCloseSession(payload: { sessionId: string }): NextResponse {
  const { sessionId } = payload;
  
  if (sessions.has(sessionId)) {
    sessions.delete(sessionId);
    return NextResponse.json({ success: true });
  }
  
  return NextResponse.json(
    { error: 'Session not found' },
    { status: 404 }
  );
}

/**
 * DELETE /api/signaling - Clean up a session
 */
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('sessionId');
  
  if (!sessionId) {
    return NextResponse.json(
      { error: 'sessionId required' },
      { status: 400 }
    );
  }
  
  if (sessions.has(sessionId)) {
    sessions.delete(sessionId);
    return NextResponse.json({ success: true });
  }
  
  return NextResponse.json(
    { error: 'Session not found' },
    { status: 404 }
  );
}