/**
 * Per-op reference (epic #2487, phase 2.3). Equipment attach (issue #2561):
 * `AttachEquipment` is the scripted form of the engine's `attachEquipment`.
 * The schema's `target` is always "creature"; `controller` is always "you"
 * because an Equipment can only attach to a creature its controller
 * controls (CR 301.5c).
 */
import type { CardOpReference } from "./types";
export const AttachEquipmentReference: CardOpReference = {
  name: "AttachEquipment",
  reference:
    '{"op":"AttachEquipment","target":"creature","controller":"you"}',
};
