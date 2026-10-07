/** Per-op reference (epic #2487, phase 2.3). */
import type { CardOpReference } from "./types";
export const ReturnFromZoneReference: CardOpReference = {
  name: "ReturnFromZone",
  reference:
    '{"op":"ReturnFromZone","from":"graveyard","to":"battlefield","target":"card","filter":{"creature":true,"mv_le":N,"controller":"you"|"opponent"},"count":N|"X"} (return a card from a graveyard to the battlefield; filter optional — creature/mv_le/controller narrow which cards the player may pick, controller defaults to "you"; count optional, default 1)',
};
