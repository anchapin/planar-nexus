/** Per-op reference (epic #2487, phase 2.3). */
import type { CardOpReference } from "./types";
export const SearchLibraryReference: CardOpReference = {
  name: "SearchLibrary",
  reference:
    '{"op":"SearchLibrary","who":"you"|"target_player","filter":{"basic_land"|"land"|"creature"|"artifact"|"enchantment"|"instant_or_sorcery"|"mv_le"|"mv_eq"|"name"|"color":...,"or":[{"basic_land"|"land"|"creature"|"artifact"|"enchantment"|"instant_or_sorcery"|"mv_le"|"mv_eq"|"name"|"color"|"or":...},...]},"destination":"hand"|"battlefield"|"library_top"|"library_bottom","shuffle":true,"count":1|2,"tapped":true} ' +
    '(search that player\'s library for the first `count` cards ("up to N", max 2) matching the filter, move them to the destination, then shuffle the library. Filter keys AND together; the `or` arm holds an array of sub-filters (recursively the same shape) any of which may match — use it for "search for an artifact or land" style cards. `tapped` puts battlefield cards in tapped; the player does not choose which cards and reveal is not modeled. #2594 widens the schema with `or`.)',
};
