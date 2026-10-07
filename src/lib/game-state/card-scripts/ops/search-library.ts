/** Per-op reference (epic #2487, phase 2.3). */
import type { CardOpReference } from "./types";
export const SearchLibraryReference: CardOpReference = {
  name: "SearchLibrary",
  reference:
    '{"op":"SearchLibrary","who":"you"|"target_player","filter":{"basic_land"|"land"|"creature"|"artifact"|"enchantment"|"instant_or_sorcery"|"mv_le"|"mv_eq"|"name"|"color":...},"destination":"hand"|"battlefield"|"library_top"|"library_bottom","shuffle":true,"count":1} ' +
    '(search that player\'s library for the first card matching every set filter key, move it to the destination, then shuffle the library. v1: count is always 1; filter is AND; reveal and "enters tapped" are not modeled.)',
};
