import {
  resolveDeckBuilderShortcut,
  isEditableTarget,
} from "../deck-builder-shortcuts";
import type { ScryfallCard } from "@/app/actions";

const card: ScryfallCard = {
  id: "card-1",
  name: "Sol Ring",
  set: "cmr",
  collector_number: "1",
  cmc: 1,
  type_line: "Artifact",
  oracle_text: "Tap for 2.",
  colors: [],
  color_identity: [],
  rarity: "uncommon",
  legalities: {},
} as unknown as ScryfallCard;

/** Build a KeyboardEvent with an overridable target (jsdom-friendly). */
function keyEvent(
  key: string,
  opts: {
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
    target?: EventTarget | null;
  } = {},
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    ctrlKey: !!opts.ctrlKey,
    metaKey: !!opts.metaKey,
    shiftKey: !!opts.shiftKey,
    bubbles: true,
    cancelable: true,
  });
  if (opts.target !== undefined) {
    Object.defineProperty(event, "target", { value: opts.target });
  }
  return event;
}

describe("resolveDeckBuilderShortcut", () => {
  describe("add card (+ / =)", () => {
    it("treats unshifted '=' as add-one", () => {
      const action = resolveDeckBuilderShortcut(keyEvent("="), {
        selectedCard: card,
      });
      expect(action).toEqual({ type: "addCard", card, max: false });
    });

    it("treats shifted '+' (Shift+=) as add-maximum", () => {
      const action = resolveDeckBuilderShortcut(
        keyEvent("+", { shiftKey: true }),
        {
          selectedCard: card,
        },
      );
      expect(action).toEqual({ type: "addCard", card, max: true });
    });

    it("does nothing when no card is selected", () => {
      expect(
        resolveDeckBuilderShortcut(keyEvent("="), { selectedCard: null }),
      ).toEqual({ type: "none" });
    });
  });

  describe("remove card (- / _)", () => {
    it("treats unshifted '-' as remove-one", () => {
      const action = resolveDeckBuilderShortcut(keyEvent("-"), {
        selectedCard: card,
      });
      expect(action).toEqual({ type: "removeCard", card, all: false });
    });

    it("treats shifted '_' (Shift+-) as remove-all", () => {
      const action = resolveDeckBuilderShortcut(
        keyEvent("_", { shiftKey: true }),
        {
          selectedCard: card,
        },
      );
      expect(action).toEqual({ type: "removeCard", card, all: true });
    });

    it("does nothing when no card is selected", () => {
      expect(
        resolveDeckBuilderShortcut(keyEvent("-"), { selectedCard: null }),
      ).toEqual({ type: "none" });
    });
  });

  describe("Enter", () => {
    it("adds the focused card (confirm)", () => {
      const action = resolveDeckBuilderShortcut(keyEvent("Enter"), {
        selectedCard: card,
      });
      expect(action).toEqual({ type: "addCard", card, max: false });
    });

    it("does nothing when no card is selected", () => {
      expect(
        resolveDeckBuilderShortcut(keyEvent("Enter"), { selectedCard: null }),
      ).toEqual({ type: "none" });
    });
  });

  describe("Ctrl/Cmd+N — new deck", () => {
    it("triggers new deck on Ctrl+N", () => {
      expect(
        resolveDeckBuilderShortcut(keyEvent("n", { ctrlKey: true }), {
          selectedCard: null,
        }),
      ).toEqual({ type: "newDeck" });
    });

    it("triggers new deck on Cmd+N (mac) with uppercase key", () => {
      expect(
        resolveDeckBuilderShortcut(keyEvent("N", { metaKey: true }), {
          selectedCard: card,
        }),
      ).toEqual({ type: "newDeck" });
    });

    it("ignores lone 'n' without a modifier", () => {
      expect(
        resolveDeckBuilderShortcut(keyEvent("n"), { selectedCard: card }),
      ).toEqual({ type: "none" });
    });
  });

  describe("modifier passthrough", () => {
    it("leaves Ctrl+S to its own listener", () => {
      expect(
        resolveDeckBuilderShortcut(keyEvent("s", { ctrlKey: true }), {
          selectedCard: card,
        }),
      ).toEqual({ type: "none" });
    });

    it("leaves Ctrl+F to its own listener", () => {
      expect(
        resolveDeckBuilderShortcut(keyEvent("f", { ctrlKey: true }), {
          selectedCard: card,
        }),
      ).toEqual({ type: "none" });
    });
  });

  describe("unrelated keys", () => {
    it("ignores keys that are not shortcuts", () => {
      for (const key of ["a", "x", "1", "ArrowLeft", " "]) {
        expect(
          resolveDeckBuilderShortcut(keyEvent(key), { selectedCard: card }),
        ).toEqual({ type: "none" });
      }
    });
  });

  describe("suppresses shortcuts while typing", () => {
    it.each(["INPUT", "TEXTAREA", "SELECT"])(
      "ignores '+' from a %s element",
      (tagName) => {
        const el = document.createElement(tagName);
        expect(
          resolveDeckBuilderShortcut(keyEvent("+", { target: el }), {
            selectedCard: card,
          }),
        ).toEqual({ type: "none" });
      },
    );

    it("ignores Ctrl+N from an input element", () => {
      const input = document.createElement("input");
      expect(
        resolveDeckBuilderShortcut(
          keyEvent("n", { ctrlKey: true, target: input }),
          { selectedCard: card },
        ),
      ).toEqual({ type: "none" });
    });

    it("ignores Enter from a contentEditable element", () => {
      const div = document.createElement("div");
      div.setAttribute("contenteditable", "true");
      expect(
        resolveDeckBuilderShortcut(keyEvent("Enter", { target: div }), {
          selectedCard: card,
        }),
      ).toEqual({ type: "none" });
    });
  });
});

describe("isEditableTarget", () => {
  it("returns false for non-element targets", () => {
    expect(isEditableTarget(null)).toBe(false);
  });

  it("returns true for form fields", () => {
    expect(isEditableTarget(document.createElement("input"))).toBe(true);
    expect(isEditableTarget(document.createElement("textarea"))).toBe(true);
    expect(isEditableTarget(document.createElement("select"))).toBe(true);
  });

  it("returns true for contentEditable regions", () => {
    const div = document.createElement("div");
    div.setAttribute("contenteditable", "true");
    expect(isEditableTarget(div)).toBe(true);
  });

  it("returns false for generic elements", () => {
    expect(isEditableTarget(document.createElement("div"))).toBe(false);
    expect(isEditableTarget(document.createElement("button"))).toBe(false);
  });
});
