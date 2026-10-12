/** Per-op reference (epic #2487, phase 2.3). */
import type { CardOpReference } from "./types";
export const CopyPermanentReference: CardOpReference = {
  name: "CopyPermanent",
  reference:
    '{"op":"CopyPermanent","target":"permanent"|"creature"|"artifact"|"enchantment"|"land","controller":"you"|"opponent"|"any"} (create a new permanent whose characteristics match a target permanent on the battlefield; CR 707.2 "all characteristics copied" semantics; v1 single-target; "until end of turn" copy / "copy a spell on the stack" / "copy a card in a graveyard" / "named-copy" / "choose-creature-type-copy" filters are follow-up lanes)',
};