/** Per-op reference (epic #2487, phase 2.3). The op's zod schema lives in
 * schema.ts; this is the LLM-facing one-line description. */
import type { CardOpReference } from "./types";
export const DealDamageReference: CardOpReference = {
  name: "DealDamage",
  reference:
    '{"op":"DealDamage","amount":N|"X","target":"any"|"creature"|"player"|"each_opponent","controller":"you"|"opponent"} (controller optional, target creature only: "target creature you control" is "you", "an opponent controls" or "you don\'t control" is "opponent")',
};
