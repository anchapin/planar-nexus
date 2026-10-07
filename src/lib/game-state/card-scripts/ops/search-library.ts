/** Per-op reference (epic #2487, phase 2.3). */
import type { CardOpReference } from "./types";
export const SearchLibraryReference: CardOpReference = {
  name: "SearchLibrary",
  reference:
    '{"op":"SearchLibrary","who":"you"|"target_player","filter":{"basic_land"|"land"|"creature"|"artifact"|"enchantment"|"instant_or_sorcery"|"mv_le"|"mv_eq"|"name"|"color":...},"destination":"hand"|"battlefield"|"library_top"|"library_bottom","shuffle":true,"count":1|2,"tapped":true} ' +
    '(search that player\'s library for the first `count` cards ("up to N", max 2) matching every set filter key, move them to the destination, then shuffle the library. filter is AND; `tapped` puts battlefield cards in tapped; the player does not choose which cards and reveal is not modeled.)',
};
