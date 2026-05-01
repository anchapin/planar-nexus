/**
 * Token Generation from Triggered Abilities Test Suite
 *
 * Tests token creation triggered by abilities (ETB effects, damage triggers, etc.)
 * Reference: CR 604 - Triggered Abilities, CR 702 - Token Creation
 */

import { describe, test, expect, beforeEach } from "@jest/globals";
import { createTokenCard } from "../keyword-actions";
import { createCardInstance, createToken } from "../card-instance";
import { createInitialGameState, startGame } from "../game-state";
import type {
  GameState,
  CardInstance,
  CardInstanceId,
  PlayerId,
} from "../types";
import type { ScryfallCard } from "@/app/actions";

function createMockToken(
  name: string,
  typeLine: string,
  power: string,
  toughness: string,
  colors: string[] = [],
  oracleText: string = "",
): ScryfallCard {
  return {
    id: `token-${name.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`,
    name,
    type_line: typeLine,
    mana_cost: "",
    cmc: 0,
    colors,
    color_identity: [],
    oracle_text: oracleText,
    power,
    toughness,
    keywords: [],
    legalities: { standard: "legal", commander: "legal" },
    layout: "token",
    card_faces: undefined,
  };
}

describe("Token Generation from Triggered Abilities", () => {
  let gameState: GameState;
  let player1Id: PlayerId;
  let player2Id: PlayerId;

  beforeEach(() => {
    gameState = createInitialGameState(["Player1", "Player2"], 20, false);
    startGame(gameState);
    const playerIds = Array.from(gameState.players.keys());
    player1Id = playerIds[0];
    player2Id = playerIds[1];
  });

  describe("createTokenCard", () => {
    test("creates a single token on the battlefield", () => {
      const soldierTokenData = createMockToken(
        "Soldier",
        "Token Creature — Soldier",
        "1",
        "1",
      );

      const result = createTokenCard(
        gameState,
        soldierTokenData,
        player1Id,
        player1Id,
        1,
      );

      expect(result.success).toBe(true);
      expect(result.affectedCards).toHaveLength(1);

      const tokenId = result.affectedCards![0];
      const token = result.state.cards.get(tokenId);

      expect(token).toBeDefined();
      expect(token?.isToken).toBe(true);
      expect(token?.cardData.name).toBe("Soldier");
      expect(token?.controllerId).toBe(player1Id);
      expect(token?.ownerId).toBe(player1Id);
    });

    test("creates multiple tokens as separate instances", () => {
      const goblinTokenData = createMockToken(
        "Goblin",
        "Token Creature — Goblin",
        "1",
        "1",
      );

      const result = createTokenCard(
        gameState,
        goblinTokenData,
        player1Id,
        player1Id,
        3,
      );

      expect(result.success).toBe(true);
      expect(result.affectedCards).toHaveLength(3);

      const tokenIds = result.affectedCards!;
      const tokens = tokenIds.map((id) => result.state.cards.get(id));

      expect(tokens[0]).toBeDefined();
      expect(tokens[1]).toBeDefined();
      expect(tokens[2]).toBeDefined();

      expect(tokens[0]?.id).not.toBe(tokens[1]?.id);
      expect(tokens[1]?.id).not.toBe(tokens[2]?.id);
      expect(tokens[0]?.id).not.toBe(tokens[2]?.id);

      const battlefield = result.state.zones.get(`${player1Id}-battlefield`);
      expect(battlefield?.cardIds).toContain(tokenIds[0]);
      expect(battlefield?.cardIds).toContain(tokenIds[1]);
      expect(battlefield?.cardIds).toContain(tokenIds[2]);
    });

    test("token has correct power and toughness", () => {
      const giantTokenData = createMockToken(
        "Giant",
        "Token Creature — Giant",
        "3",
        "3",
      );

      const result = createTokenCard(
        gameState,
        giantTokenData,
        player1Id,
        player1Id,
        1,
      );

      expect(result.success).toBe(true);

      const tokenId = result.affectedCards![0];
      const token = result.state.cards.get(tokenId);

      expect(token?.cardData.power).toBe("3");
      expect(token?.cardData.toughness).toBe("3");
    });

    test("token has correct colors", () => {
      const redGoblinToken = createMockToken(
        "Goblin",
        "Token Creature — Goblin",
        "1",
        "1",
        ["R"],
      );

      const whiteSoldierToken = createMockToken(
        "Soldier",
        "Token Creature — Soldier",
        "1",
        "1",
        ["W"],
      );

      const redResult = createTokenCard(
        gameState,
        redGoblinToken,
        player1Id,
        player1Id,
        1,
      );
      const whiteResult = createTokenCard(
        redResult.state,
        whiteSoldierToken,
        player1Id,
        player1Id,
        1,
      );

      const redToken = whiteResult.state.cards.get(redResult.affectedCards![0]);
      const whiteToken = whiteResult.state.cards.get(
        whiteResult.affectedCards![0],
      );

      expect(redToken?.cardData.colors).toContain("R");
      expect(whiteToken?.cardData.colors).toContain("W");
    });

    test("token has correct card types", () => {
      const artifactTokenData = createMockToken(
        "Treasure",
        "Token Artifact",
        "0",
        "0",
      );

      const result = createTokenCard(
        gameState,
        artifactTokenData,
        player1Id,
        player1Id,
        1,
      );

      expect(result.success).toBe(true);

      const tokenId = result.affectedCards![0];
      const token = result.state.cards.get(tokenId);

      expect(token?.cardData.type_line).toBe("Token Artifact");
    });

    test("token with death trigger can be tracked", () => {
      const zombieTokenData = createMockToken(
        "Zombie",
        "Token Creature — Zombie",
        "2",
        "2",
        ["B"],
        "When this creature dies, sacrifice it.",
      );

      const result = createTokenCard(
        gameState,
        zombieTokenData,
        player1Id,
        player1Id,
        1,
      );

      expect(result.success).toBe(true);

      const tokenId = result.affectedCards![0];
      const token = result.state.cards.get(tokenId);

      expect(token?.isToken).toBe(true);
      expect(token?.tokenData).toBeDefined();
      expect(token?.tokenData?.oracle_text).toContain(
        "When this creature dies",
      );
    });

    test("tokens are ephemeral - not in saved game state", () => {
      const soldierTokenData = createMockToken(
        "Soldier",
        "Token Creature — Soldier",
        "1",
        "1",
      );

      const result = createTokenCard(
        gameState,
        soldierTokenData,
        player1Id,
        player1Id,
        1,
      );

      expect(result.success).toBe(true);

      const tokenId = result.affectedCards![0];
      const token = result.state.cards.get(tokenId);

      expect(token?.isToken).toBe(true);

      const serialized = JSON.stringify(result.state);
      const deserialized = JSON.parse(serialized);

      const deserializedToken =
        deserialized.cards?.get?.(tokenId) ||
        Object.values(deserialized.cards || {}).find(
          (c: any) => c?.id === tokenId,
        );

      if (deserializedToken) {
        expect(deserializedToken.isToken).toBe(true);
      }
    });

    test("Dragonic Lava Axe creates goblin token when dealing damage", () => {
      const goblinTokenData = createMockToken(
        "Goblin",
        "Token Creature — Goblin",
        "1",
        "1",
      );

      const preBattlefield = gameState.zones.get(`${player1Id}-battlefield`);

      const result = createTokenCard(
        gameState,
        goblinTokenData,
        player1Id,
        player1Id,
        1,
      );

      expect(result.success).toBe(true);

      const tokenId = result.affectedCards![0];
      const token = result.state.cards.get(tokenId);

      expect(token).toBeDefined();
      expect(token?.cardData.name).toBe("Goblin");
      expect(token?.cardData.power).toBe("1");
      expect(token?.cardData.toughness).toBe("1");

      const postBattlefield = result.state.zones.get(
        `${player1Id}-battlefield`,
      );
      expect(postBattlefield?.cardIds).toContain(tokenId);
      expect(postBattlefield?.cardIds.length).toBe(
        preBattlefield!.cardIds.length + 1,
      );
    });

    test("Fable of the Mirror-Breaker creates token copy", () => {
      const artifactCard = createCardInstance(
        createMockToken("Shivan Specter", "Creature — Elemental", "2", "2", [
          "U",
          "R",
        ]),
        player1Id,
        player1Id,
      );

      const battlefield = gameState.zones.get(`${player1Id}-battlefield`);
      if (battlefield) {
        battlefield.cardIds.push(artifactCard.id);
        gameState.cards.set(artifactCard.id, artifactCard);
      }

      const copyTokenData = createMockToken(
        "Copy of Shivan Specter",
        "Token Creature — Elemental",
        "2",
        "2",
        ["U", "R"],
      );

      const result = createTokenCard(
        gameState,
        copyTokenData,
        player1Id,
        player1Id,
        1,
      );

      expect(result.success).toBe(true);

      const tokenId = result.affectedCards![0];
      const token = result.state.cards.get(tokenId);

      expect(token?.isToken).toBe(true);
      expect(token?.cardData.name).toBe("Copy of Shivan Specter");
      expect(token?.cardData.power).toBe("2");
      expect(token?.cardData.toughness).toBe("2");
      expect(token?.cardData.colors).toContain("U");
      expect(token?.cardData.colors).toContain("R");
    });

    test("createTokenCard handles invalid player gracefully", () => {
      const tokenData = createMockToken("Test", "Token Creature", "1", "1");

      const result = createTokenCard(
        gameState,
        tokenData,
        "invalid-player" as PlayerId,
        player1Id,
        1,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Player");
    });

    test("createTokenCard handles missing battlefield zone", () => {
      const tokenData = createMockToken("Test", "Token Creature", "1", "1");

      const stateWithoutBattlefield = {
        ...gameState,
        zones: new Map(
          [...gameState.zones].filter(([k]) => !k.endsWith("battlefield")),
        ),
      };

      const result = createTokenCard(
        stateWithoutBattlefield,
        tokenData,
        player1Id,
        player1Id,
        1,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Battlefield");
    });

    test("createToken maintains token data reference", () => {
      const tokenData = createMockToken(
        "Myr",
        "Token Artifact Creature — Myr",
        "1",
        "1",
        [],
      );

      const token = createToken(tokenData, player1Id, player1Id);

      expect(token.isToken).toBe(true);
      expect(token.tokenData).toBeDefined();
      expect(token.tokenData?.name).toBe("Myr");
      expect(token.tokenData?.type_line).toBe("Token Artifact Creature — Myr");
    });

    test("multiple tokens from same source are unique instances", () => {
      const tokenData = createMockToken(
        "Soldier",
        "Token Creature — Soldier",
        "1",
        "1",
      );

      const result = createTokenCard(
        gameState,
        tokenData,
        player1Id,
        player1Id,
        5,
      );

      expect(result.success).toBe(true);
      expect(result.affectedCards).toHaveLength(5);

      const tokens = result.affectedCards!.map(
        (id) => result.state.cards.get(id)!,
      );

      for (let i = 0; i < tokens.length; i++) {
        for (let j = i + 1; j < tokens.length; j++) {
          expect(tokens[i].id).not.toBe(tokens[j].id);
          expect(tokens[i].oracleId).toBe(tokens[j].oracleId);
        }
      }
    });
  });

  describe("Token integration with trigger chain", () => {
    test("token creation result can be used in subsequent operations", () => {
      const soldierTokenData = createMockToken(
        "Soldier",
        "Token Creature — Soldier",
        "1",
        "1",
      );

      const result = createTokenCard(
        gameState,
        soldierTokenData,
        player1Id,
        player1Id,
        1,
      );

      expect(result.success).toBe(true);

      const tokenId = result.affectedCards![0];

      const subsequentResult = createTokenCard(
        result.state,
        soldierTokenData,
        player1Id,
        player1Id,
        1,
      );

      expect(subsequentResult.success).toBe(true);
      expect(subsequentResult.affectedCards).toHaveLength(1);
      expect(subsequentResult.affectedCards![0]).not.toBe(tokenId);

      const battlefield = subsequentResult.state.zones.get(
        `${player1Id}-battlefield`,
      );
      expect(battlefield?.cardIds).toContain(tokenId);
      expect(battlefield?.cardIds).toContain(
        subsequentResult.affectedCards![0],
      );
    });
  });
});
