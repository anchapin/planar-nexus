/** Per-op reference (epic #2487, phase 2.3). The op's zod schema lives in
 * schema.ts; this is the LLM-facing one-line description. */
import type { CardOpReference } from "./types";
export const DrawReference: CardOpReference = {
  name: "Draw",
  reference: '{"op":"Draw","amount":N|"X","who":"you"|"target_player"}',
};
