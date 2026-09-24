import type { CardInstanceId, GameState, ManaPool, PlayerId } from "../types";
import { isPriorityPlayer } from "../priority-guard";
import { addMana, formatManaPool } from "./mana-pool";

export interface ManaAbilityOption {
  description: string;
  mana: Partial<ManaPool>;
  activationCondition?: string;
}

function checkActivationCondition(
  condition: string,
  state: GameState,
  playerId: PlayerId,
): boolean {
  const battlefieldZone = state.zones.get(`${playerId}-battlefield`);
  if (!battlefieldZone) return false;

  const playerLands = battlefieldZone.cardIds
    .map((id) => state.cards.get(id))
    .filter((card): card is NonNullable<typeof card> => {
      if (!card) return false;
      const typeLine = card.cardData.type_line?.toLowerCase() || "";
      return typeLine.includes("land") && !card.isTapped;
    });

  const lowerCondition = condition.toLowerCase();

  const basicLandTypes = ["plains", "island", "swamp", "mountain", "forest"];
  for (const landType of basicLandTypes) {
    if (lowerCondition.includes(landType)) {
      const hasLandType = playerLands.some((card) => {
        const typeLine = card.cardData.type_line?.toLowerCase() || "";
        return (
          typeLine.includes(landType) ||
          card.chosenBasicLandType?.toLowerCase() === landType
        );
      });
      if (hasLandType) {
        return true;
      }
    }
  }

  return false;
}

function filterAvailableOptions(
  options: ManaAbilityOption[],
  state: GameState,
  playerId: PlayerId,
): ManaAbilityOption[] {
  return options.filter((option) => {
    if (!option.activationCondition) return true;
    return checkActivationCondition(
      option.activationCondition,
      state,
      playerId,
    );
  });
}

export function parseManaAbility(oracleText: string): ManaAbilityOption[] {
  const text = oracleText.toLowerCase();
  const options: ManaAbilityOption[] = [];

  const parseSymbols = (symbols: string): Partial<ManaPool> => {
    const mana: Partial<ManaPool> = {};
    const matches = symbols.match(/\{([^}]+)\}/g) || [];
    for (const m of matches) {
      const sym = m.slice(1, -1).toUpperCase();
      if (sym === "W") mana.white = (mana.white || 0) + 1;
      else if (sym === "U") mana.blue = (mana.blue || 0) + 1;
      else if (sym === "B") mana.black = (mana.black || 0) + 1;
      else if (sym === "R") mana.red = (mana.red || 0) + 1;
      else if (sym === "G") mana.green = (mana.green || 0) + 1;
      else if (sym === "C") mana.colorless = (mana.colorless || 0) + 1;
      else if (/^\d+$/.test(sym))
        mana.generic = (mana.generic || 0) + parseInt(sym, 10);
    }
    return mana;
  };

  const abilityStartRegex = /\{t\}:\s*add\s+/gi;
  const abilities: { manaClause: string; condition?: string }[] = [];

  let match;
  while ((match = abilityStartRegex.exec(text)) !== null) {
    const startIdx = match.index;
    let endIdx = text.length;
    const nextAbilityMatch = text.indexOf("{t}:", startIdx + 4);
    if (nextAbilityMatch !== -1) {
      endIdx = nextAbilityMatch;
    }

    const abilityText = text.substring(startIdx, endIdx).trim();
    const abilityContent = abilityText.replace(/^\{t\}:\s*add\s+/i, "").trim();

    const periodIdx = abilityContent.lastIndexOf(".");
    let manaClause = abilityContent;
    let condition: string | undefined;

    if (periodIdx !== -1) {
      const afterPeriod = abilityContent.substring(periodIdx + 1).trim();
      if (afterPeriod.toLowerCase().startsWith("activate only if")) {
        manaClause = abilityContent.substring(0, periodIdx);
        condition = afterPeriod;
      }
    }

    abilities.push({ manaClause: manaClause.trim(), condition });
  }

  for (const ability of abilities) {
    if (ability.manaClause.includes(" or ") && !ability.condition) {
      const parts = ability.manaClause.split(/,\s+or\s+|\s+or\s+/);
      for (const part of parts) {
        const mana = parseSymbols(part);
        if (Object.keys(mana).length > 0) {
          const desc = formatManaPool({
            ...{
              colorless: 0,
              white: 0,
              blue: 0,
              black: 0,
              red: 0,
              green: 0,
              generic: 0,
            },
            ...mana,
          });
          const option: ManaAbilityOption = {
            description: desc,
            mana,
          };
          if (ability.condition) {
            option.activationCondition = ability.condition;
          }
          options.push(option);
        }
      }
      continue;
    }

    const mana = parseSymbols(ability.manaClause);
    if (Object.keys(mana).length === 0) continue;

    const desc = formatManaPool({
      ...{
        colorless: 0,
        white: 0,
        blue: 0,
        black: 0,
        red: 0,
        green: 0,
        generic: 0,
      },
      ...mana,
    });
    const option: ManaAbilityOption = {
      description: desc || "Colorless",
      mana,
    };

    if (ability.condition) {
      option.activationCondition = ability.condition;
    }

    options.push(option);
  }

  if (options.length === 0) {
    const addMatch = text.match(/\{t\}:\s*add\s+([^.)]+)/i);
    if (!addMatch) return options;

    const manaClause = addMatch[1].trim();

    if (
      manaClause.includes("any color") ||
      manaClause.includes("any one color") ||
      manaClause.includes("mana of any color")
    ) {
      options.push({ description: "White", mana: { white: 1 } });
      options.push({ description: "Blue", mana: { blue: 1 } });
      options.push({ description: "Black", mana: { black: 1 } });
      options.push({ description: "Red", mana: { red: 1 } });
      options.push({ description: "Green", mana: { green: 1 } });
      return options;
    }

    if (manaClause.includes(" or ")) {
      const parts = manaClause.split(/,\s+or\s+|\s+or\s+/);
      for (const part of parts) {
        const mana = parseSymbols(part);
        if (Object.keys(mana).length > 0) {
          const desc = formatManaPool({
            ...{
              colorless: 0,
              white: 0,
              blue: 0,
              black: 0,
              red: 0,
              green: 0,
              generic: 0,
            },
            ...mana,
          });
          options.push({ description: desc, mana });
        }
      }
      return options;
    }

    const mana = parseSymbols(manaClause);
    if (Object.keys(mana).length > 0) {
      const desc = formatManaPool({
        ...{
          colorless: 0,
          white: 0,
          blue: 0,
          black: 0,
          red: 0,
          green: 0,
          generic: 0,
        },
        ...mana,
      });
      options.push({ description: desc || "Colorless", mana });
    }
  }

  return options;
}

export function activateManaAbility(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
  _abilityIndex: number,
  chosenOption?: ManaAbilityOption,
): { success: boolean; state: GameState; options?: ManaAbilityOption[] } {
  const card = state.cards.get(cardId);
  if (!card) {
    return { success: false, state };
  }

  if (!isPriorityPlayer(state, playerId)) {
    return { success: false, state };
  }

  if (card.isTapped) {
    return { success: false, state };
  }

  const oracleText = card.cardData.oracle_text || "";
  const options = parseManaAbility(oracleText);

  if (options.length === 0) {
    return { success: false, state };
  }

  const availableOptions = filterAvailableOptions(options, state, playerId);

  if (availableOptions.length === 0) {
    return { success: false, state };
  }

  if (availableOptions.length > 1 && !chosenOption) {
    return { success: true, state, options: availableOptions };
  }

  const option = chosenOption || availableOptions[0];

  if (option.activationCondition) {
    const conditionMet = checkActivationCondition(
      option.activationCondition,
      state,
      playerId,
    );
    if (!conditionMet) {
      return { success: false, state };
    }
  }

  let newState = addMana(state, playerId, option.mana);

  const updatedCards = new Map(newState.cards);
  updatedCards.set(cardId, { ...card, isTapped: true });
  newState = { ...newState, cards: updatedCards, lastModifiedAt: Date.now() };

  const updatedPlayers = new Map(newState.players);
  const player = updatedPlayers.get(playerId);
  if (player) {
    updatedPlayers.set(playerId, {
      ...player,
      hasActivatedManaAbility: true,
    });
  }

  return {
    success: true,
    state: {
      ...newState,
      players: updatedPlayers,
    },
  };
}

export function isManaAbility(
  _cardId: CardInstanceId,
  abilityText: string,
): boolean {
  const lowerText = abilityText.toLowerCase();

  const producesMana =
    lowerText.includes("{w}") ||
    lowerText.includes("{u}") ||
    lowerText.includes("{b}") ||
    lowerText.includes("{r}") ||
    lowerText.includes("{g}") ||
    lowerText.includes("{c}") ||
    lowerText.includes("add ") ||
    lowerText.includes("produces");

  return producesMana;
}
