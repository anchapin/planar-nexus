/** Per-op reference (epic #2487, phase 2.3). */
import type { CardOpReference } from "./types";
export const CopyUntilEndOfTurnReference: CardOpReference = {
  name: "CopyUntilEndOfTurn",
  reference:
    '{"op":"CopyUntilEndOfTurn","chosen_permanent":"<card-instance-id>","until":"end_of_turn"} (create a new permanent whose characteristics match a chosen permanent on the battlefield until end of turn, CR 707.2 "all characteristics copied" semantics with EOT rollback; the new permanent carries `animatedUntilEndOfTurn` + `copyOfTargetId` so the existing lane 75 rollback paths restore the printed cardData at EOT; v1 single chosen target; multi-target copies, controller filters, narrower target filters, permanent copies, named-card copies (lane 75b), copy-with-exception (lane 75c), nested copies (lane 75e), and Aura-shaped copies (lane 75d) are follow-up lanes)',
};
