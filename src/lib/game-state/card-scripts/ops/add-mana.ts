/** Per-op reference (epic #2487, phase 2.3). */
import type { CardOpReference } from "./types";
export const AddManaReference: CardOpReference = {
  name: "AddMana",
  reference:
    '{"op":"AddMana","amount":N,"colors":["W"|"U"|"B"|"R"|"G"|"C",...]|"any"} (add mana to your pool; "Add {G}" is amount 1 colors ["G"], "Add {G}{G}" is amount 2 colors ["G"], "Add {R} or {G}" is amount 1 colors ["R","G"], "Add one mana of any color" is amount 1 colors "any"; an activated ability with this op is a mana ability and needs no flag; not for "spend this mana only on" restrictions, "for each" counts, or mixed symbols like "{R}{G}")',
};
