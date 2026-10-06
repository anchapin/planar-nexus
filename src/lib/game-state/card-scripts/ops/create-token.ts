/** Per-op reference (epic #2487, phase 2.3). */
import type { CardOpReference } from "./types";
export const CreateTokenReference: CardOpReference = {
  name: "CreateToken",
  reference:
    '{"op":"CreateToken","count":N|"X","power":N,"toughness":N,"color":"white"|"blue"|"black"|"red"|"green"|"colorless" OR "colors":["white","black"],"subtypes":["Thopter"],"artifact":true,"keywords":["flying"]} (creature tokens; exactly one of color/colors; artifact and keywords optional; evergreen keywords only; no enchantment tokens or token abilities)',
};
