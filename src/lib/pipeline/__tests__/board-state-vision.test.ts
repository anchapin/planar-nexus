import {
  RecognizedBoardStateSchema,
  BoardCardSchema,
} from "@/lib/pipeline/board-state-vision-types";
import {
  validateCardNames,
} from "@/lib/pipeline/card-name-validator";
import {
  BOARD_STATE_SYSTEM_PROMPT,
  BOARD_STATE_VALIDATION_PROMPT,
} from "@/lib/pipeline/board-state-prompt";


describe("RecognizedBoardStateSchema", () => {
  it("parses a minimal valid board state", () => {
    const input = {
      player_life: 20,
      opponent_life: 20,
    };
    const result = RecognizedBoardStateSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.player_life).toBe(20);
      expect(result.data.opponent_life).toBe(20);
      expect(result.data.battlefield_player).toEqual([]);
      expect(result.data.hand_size).toBe(0);
      expect(result.data.phase).toBe("main");
      expect(result.data.turn_number).toBe(0);
    }
  });

  it("parses a full board state", () => {
    const input = {
      player_life: 15,
      opponent_life: 8,
      battlefield_player: [
        { name: "Sol Ring", is_tapped: true, power: 0, toughness: 0 },
        { name: "Grizzly Bears", is_tapped: false, power: 2, toughness: 2 },
      ],
      battlefield_opponent: [
        { name: "Counterspell" },
      ],
      hand_size: 5,
      graveyard: ["Lightning Bolt", "Forest"],
      stack: ["Counterspell"],
      phase: "combat",
      turn_number: 7,
    };
    const result = RecognizedBoardStateSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.player_life).toBe(15);
      expect(result.data.battlefield_player).toHaveLength(2);
      expect(result.data.battlefield_player[0].name).toBe("Sol Ring");
      expect(result.data.battlefield_player[0].is_tapped).toBe(true);
      expect(result.data.battlefield_opponent).toHaveLength(1);
      expect(result.data.hand_size).toBe(5);
      expect(result.data.graveyard).toHaveLength(2);
      expect(result.data.stack).toHaveLength(1);
      expect(result.data.phase).toBe("combat");
      expect(result.data.turn_number).toBe(7);
    }
  });

  it("coerces string numbers to integers", () => {
    const input = {
      player_life: "20",
      opponent_life: "18",
      hand_size: "6",
      turn_number: "3",
    };
    const result = RecognizedBoardStateSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.player_life).toBe(20);
      expect(result.data.opponent_life).toBe(18);
      expect(result.data.hand_size).toBe(6);
      expect(result.data.turn_number).toBe(3);
    }
  });

  it("rejects completely invalid input", () => {
    const input = { invalid: "data" };
    const result = RecognizedBoardStateSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("accepts face-down cards", () => {
    const input = {
      player_life: 20,
      opponent_life: 20,
      battlefield_player: [{ name: "Unknown Card", is_face_down: true }],
    };
    const result = RecognizedBoardStateSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.battlefield_player[0].is_face_down).toBe(true);
    }
  });

  it("accepts cards with counters", () => {
    const input = {
      player_life: 20,
      opponent_life: 20,
      battlefield_player: [
        { name: "Questing Beast", counters: { "+1/+1": 2, loyalty: 1 } },
      ],
    };
    const result = RecognizedBoardStateSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.battlefield_player[0].counters).toEqual({
        "+1/+1": 2,
        loyalty: 1,
      });
    }
  });
});

describe("BoardCardSchema", () => {
  it("defaults is_tapped to false", () => {
    const result = BoardCardSchema.safeParse({ name: "Sol Ring" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.is_tapped).toBe(false);
    }
  });
});

describe("validateCardNames", () => {
  const cardDatabase = new Map<string, string[]>([
    ["sol ring", ["Sol Ring", "Ring of Sol"]],
    ["lightning bolt", ["Lightning Bolt", "Bolt"]],
    ["counterspell", ["Counterspell"]],
    ["grizzly bears", ["Grizzly Bears"]],
    ["forest", ["Forest"]],
    ["island", ["Island"]],
    ["mountain", ["Mountain"]],
    ["plains", ["Plains"]],
    ["swamp", ["Swamp"]],
    ["questing beast", ["Questing Beast"]],
  ]);

  function makeBoardState(overrides: Record<string, unknown> = {}) {
    return RecognizedBoardStateSchema.parse({
      player_life: 20,
      opponent_life: 20,
      battlefield_player: [],
      battlefield_opponent: [],
      hand_size: 0,
      graveyard: [],
      stack: [],
      phase: "main",
      turn_number: 1,
      ...overrides,
    });
  }

  it("validates exact match card names", () => {
    const boardState = makeBoardState({
      battlefield_player: [{ name: "Sol Ring" }],
    });

    const results = validateCardNames(boardState, cardDatabase);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Sol Ring");
    expect(results[0].valid).toBe(true);
  });

  it("suggests corrections for misspelled cards", () => {
    const boardState = makeBoardState({
      battlefield_player: [{ name: "Grizzli Bears" }],
    });

    const results = validateCardNames(boardState, cardDatabase);
    expect(results).toHaveLength(1);
    expect(results[0].valid).toBe(false);
    expect(results[0].suggestion).toBeTruthy();
  });

  it("handles Unknown Card as invalid", () => {
    const boardState = makeBoardState({
      battlefield_player: [{ name: "Unknown Card", is_face_down: true }],
    });

    const results = validateCardNames(boardState, cardDatabase);
    expect(results).toHaveLength(1);
    expect(results[0].valid).toBe(false);
  });

  it("deduplicates card names across zones", () => {
    const boardState = makeBoardState({
      battlefield_player: [{ name: "Sol Ring" }],
      graveyard: ["Sol Ring"],
    });

    const results = validateCardNames(boardState, cardDatabase);
    expect(results).toHaveLength(1);
    expect(results[0].valid).toBe(true);
  });

  it("works without a card database", () => {
    const boardState = makeBoardState({
      battlefield_player: [{ name: "Sol Ring" }],
    });

    const results = validateCardNames(boardState);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Sol Ring");
  });

  it("collects cards from all zones", () => {
    const boardState = makeBoardState({
      battlefield_player: [{ name: "Sol Ring" }],
      battlefield_opponent: [{ name: "Forest" }],
      graveyard: ["Lightning Bolt"],
      stack: ["Counterspell"],
    });

    const results = validateCardNames(boardState, cardDatabase);
    expect(results).toHaveLength(4);
    const validCount = results.filter((r) => r.valid).length;
    expect(validCount).toBe(4);
  });
});

describe("BOARD_STATE_SYSTEM_PROMPT", () => {
  it("contains required extraction instructions", () => {
    expect(BOARD_STATE_SYSTEM_PROMPT).toContain("life totals");
    expect(BOARD_STATE_SYSTEM_PROMPT).toContain("tapped");
    expect(BOARD_STATE_SYSTEM_PROMPT).toContain("power");
    expect(BOARD_STATE_SYSTEM_PROMPT).toContain("toughness");
    expect(BOARD_STATE_SYSTEM_PROMPT).toContain("phase");
    expect(BOARD_STATE_SYSTEM_PROMPT).toContain("JSON");
    expect(BOARD_STATE_SYSTEM_PROMPT).toContain("hand_size");
    expect(BOARD_STATE_SYSTEM_PROMPT).toContain("graveyard");
    expect(BOARD_STATE_SYSTEM_PROMPT).toContain("stack");
  });
});

describe("BOARD_STATE_VALIDATION_PROMPT", () => {
  it("contains validation instructions", () => {
    expect(BOARD_STATE_VALIDATION_PROMPT).toContain("valid");
    expect(BOARD_STATE_VALIDATION_PROMPT).toContain("suggested_name");
    expect(BOARD_STATE_VALIDATION_PROMPT).toContain("JSON");
  });
});
