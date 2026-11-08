/**
 * The five basic land types the player can choose from when a land asks for
 * a basic land type (issue #2903).
 *
 * This lives in its own module (instead of inside `BasicLandTypeDialog.tsx`)
 * so the board can import the constant without pulling the dialog itself
 * into the route's first-load payload: the dialog is loaded lazily through
 * `next/dynamic`, the constant is not.
 *
 * The options are built once at module load so the `options` prop of the
 * memoized dialog keeps a stable identity for the whole lifetime of the board.
 */
import { BASIC_LAND_NAMES } from "@/lib/basic-land-data";

/**
 * Human readable description of every basic land type, used by the dialog to
 * explain what each choice produces.
 */
const BASIC_LAND_TYPE_DESCRIPTIONS: Readonly<Record<string, string>> = {
  Plains: "Produces white mana",
  Island: "Produces blue mana",
  Swamp: "Produces black mana",
  Mountain: "Produces red mana",
  Forest: "Produces green mana",
};

/** A single choice of the dialog: one basic land type. */
export interface BasicLandTypeOptionView {
  /** The basic land name (e.g. "Plains"). */
  name: string;
  /** Human readable description of the choice (e.g. "Produces white mana"). */
  description: string;
}

/**
 * The five basic land types the player can choose from.
 */
export const BASIC_LAND_TYPE_OPTIONS: BasicLandTypeOptionView[] =
  BASIC_LAND_NAMES.map((name) => ({
    name,
    description: BASIC_LAND_TYPE_DESCRIPTIONS[name] ?? "",
  }));
