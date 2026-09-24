/**
 * In-memory room-participant registry for the signaling server.
 *
 * Tracks which (userId, peerId) pairs are members of which game rooms.
 * Used by the TURN credentials endpoint to verify that a requesting
 * client is a legitimate participant in the room before minting relay
 * credentials (#2199).
 *
 * In a single-instance deployment this module-level Map is sufficient.
 * In a multi-instance deployment this state would need to be externalized
 * (e.g. Redis), but the TURN relay itself is the scarce resource so
 * an in-memory check is a meaningful improvement over no check at all.
 */

interface RoomParticipant {
  userId: string;
  joinedAt: number;
}

/**
 * roomId → peerId → RoomParticipant
 */
const roomParticipants = new Map<string, Map<string, RoomParticipant>>();

/**
 * How long a participant entry lives after the last explicit leave.
 * Peers that disconnect abruptly will be cleaned up on their next
 * TURN credential request if their entry is older than this window.
 */
const PARTICIPANT_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

function cleanStaleParticipants(roomId: string): void {
  const peers = roomParticipants.get(roomId);
  if (!peers) return;
  const now = Date.now();
  for (const [peerId, participant] of peers.entries()) {
    if (now - participant.joinedAt > PARTICIPANT_TTL_MS) {
      peers.delete(peerId);
    }
  }
  if (peers.size === 0) {
    roomParticipants.delete(roomId);
  }
}

export function registerRoomParticipant(params: {
  roomId: string;
  peerId: string;
  userId: string;
}): void {
  const { roomId, peerId, userId } = params;
  cleanStaleParticipants(roomId);
  let peers = roomParticipants.get(roomId);
  if (!peers) {
    peers = new Map();
    roomParticipants.set(roomId, peers);
  }
  peers.set(peerId, { userId, joinedAt: Date.now() });
}

export function unregisterRoomParticipant(params: {
  roomId: string;
  peerId: string;
}): void {
  const { roomId, peerId } = params;
  const peers = roomParticipants.get(roomId);
  if (!peers) return;
  peers.delete(peerId);
  if (peers.size === 0) {
    roomParticipants.delete(roomId);
  }
}

export interface VerifyRoomParticipantResult {
  valid: true;
  userId: string;
}

export type VerifyRoomParticipantError =
  "ROOM_NOT_FOUND" | "PEER_NOT_IN_ROOM" | "ENTRY_STALE";

export function verifyRoomParticipant(params: {
  roomId: string;
  peerId: string;
}):
  | VerifyRoomParticipantResult
  | { valid: false; error: VerifyRoomParticipantError } {
  const { roomId, peerId } = params;
  cleanStaleParticipants(roomId);
  const peers = roomParticipants.get(roomId);
  if (!peers) {
    return { valid: false, error: "ROOM_NOT_FOUND" };
  }
  const participant = peers.get(peerId);
  if (!participant) {
    return { valid: false, error: "PEER_NOT_IN_ROOM" };
  }
  return { valid: true, userId: participant.userId };
}
