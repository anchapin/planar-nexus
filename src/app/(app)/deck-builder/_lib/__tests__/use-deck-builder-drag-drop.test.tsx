/**
 * @fileOverview Integration tests for the deck-builder drag-and-drop hook
 * (issue #1545). The reducer is unit-tested separately
 * (`deck-builder-drag-drop.test.ts`); this file exercises the React hook's
 * keyboard handler, programmatic API, and HTML5 drag-and-drop wiring
 * end-to-end against jsdom.
 *
 * What we assert:
 *   1. `pickUp(card, copies)` enters the carry state and sets `isCarrying`.
 *   2. Pressing Enter while carrying invokes `onDrop` with the right target
 *      and copy count (Shift+Enter = 4 copies).
 *   3. Pressing ArrowDown while carrying switches the target.
 *   4. Pressing Escape while carrying cancels and does NOT call `onDrop`.
 *   5. Pressing `M` while a card-result-tile-shaped button has focus picks up
 *      the card (Shift+M = 4 copies).
 *   6. For formats without a sideboard, the target never becomes "sideboard".
 *   7. The pointer drag-and-drop flow (dragstart → drop) calls `onDrop` with
 *      the right target and copy count (Shift = 4 copies).
 *   8. Dragging without dropping (dragend without drop) cancels the carry.
 *   9. The ARIA live region receives the announcement text on each
 *      state transition.
 */

import {
  describe,
  expect,
  it,
  jest,
  beforeEach,
  afterEach,
} from "@jest/globals";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import "@testing-library/jest-dom/jest-globals";
import {
  attachCardToElement,
  useDeckBuilderDragDrop,
} from "../use-deck-builder-drag-drop";
import type { ScryfallCard } from "@/lib/card-database";

const bolt: ScryfallCard = {
  id: "bolt-1",
  name: "Lightning Bolt",
  set: "m21",
  collector_number: "162",
  cmc: 1,
  type_line: "Instant",
  oracle_text: "Lightning Bolt deals 3 damage to any target.",
  colors: ["R"],
  color_identity: ["R"],
  rarity: "common",
  legalities: { modern: "legal", standard: "legal" },
} as unknown as ScryfallCard;

const island: ScryfallCard = {
  id: "island-1",
  name: "Island",
  set: "m21",
  collector_number: "311",
  cmc: 0,
  type_line: "Basic Land — Island",
  oracle_text: "{T}: Add {U}.",
  colors: [],
  color_identity: ["U"],
  rarity: "common",
  legalities: { modern: "legal", standard: "legal" },
} as unknown as ScryfallCard;

/** Build a KeyboardEvent with the supplied key + modifiers. */
function keyEvent(
  key: string,
  opts: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {},
): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    key,
    shiftKey: !!opts.shiftKey,
    ctrlKey: !!opts.ctrlKey,
    metaKey: !!opts.metaKey,
    bubbles: true,
    cancelable: true,
  });
}

describe("useDeckBuilderDragDrop — keyboard carry flow (#1545)", () => {
  let onDrop: jest.Mock;
  let onCancel: jest.Mock;

  beforeEach(() => {
    onDrop = jest.fn();
    onCancel = jest.fn();
  });

  it("starts idle with no carried card", () => {
    const { result } = renderHook(() =>
      useDeckBuilderDragDrop({
        supportsSideboard: true,
        onDrop,
      }),
    );
    expect(result.current.isCarrying).toBe(false);
    expect(result.current.carriedCard).toBeNull();
    expect(result.current.target).toBe("mainboard");
    expect(result.current.announcement).toBe("");
  });

  it("pickUp(card, copies) enters carry state and announces", () => {
    const { result } = renderHook(() =>
      useDeckBuilderDragDrop({
        supportsSideboard: true,
        onDrop,
      }),
    );
    act(() => result.current.pickUp(bolt, 1));
    expect(result.current.isCarrying).toBe(true);
    expect(result.current.carriedCard).toEqual(bolt);
    expect(result.current.copies).toBe(1);
    expect(result.current.target).toBe("mainboard");
    expect(result.current.announcement).toContain("Lightning Bolt");
    expect(result.current.announcement).toContain("Mainboard");
  });

  it("pickUp(card, 4) sets copies to 4 and announces the count", () => {
    const { result } = renderHook(() =>
      useDeckBuilderDragDrop({
        supportsSideboard: true,
        onDrop,
      }),
    );
    act(() => result.current.pickUp(bolt, 4));
    expect(result.current.copies).toBe(4);
    expect(result.current.announcement).toContain("4 copies");
  });

  it("pressing Enter while carrying invokes onDrop with the current target", () => {
    const { result } = renderHook(() =>
      useDeckBuilderDragDrop({
        supportsSideboard: true,
        onDrop,
      }),
    );
    act(() => result.current.pickUp(bolt, 1));
    act(() => {
      result.current.handleKeyDown(keyEvent("Enter"));
    });
    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onDrop).toHaveBeenCalledWith({
      card: bolt,
      copies: 1,
      target: "mainboard",
    });
    // Carry clears after drop.
    expect(result.current.isCarrying).toBe(false);
  });

  it("pressing Shift+Enter while carrying adds 4 copies", () => {
    const { result } = renderHook(() =>
      useDeckBuilderDragDrop({
        supportsSideboard: true,
        onDrop,
      }),
    );
    act(() => result.current.pickUp(bolt, 4));
    act(() => {
      result.current.handleKeyDown(keyEvent("Enter", { shiftKey: true }));
    });
    expect(onDrop).toHaveBeenCalledWith({
      card: bolt,
      copies: 4,
      target: "mainboard",
    });
  });

  it("pressing Space while carrying drops the card (WAI-ARIA standard)", () => {
    const { result } = renderHook(() =>
      useDeckBuilderDragDrop({
        supportsSideboard: true,
        onDrop,
      }),
    );
    act(() => result.current.pickUp(bolt, 1));
    act(() => {
      result.current.handleKeyDown(keyEvent(" "));
    });
    expect(onDrop).toHaveBeenCalledWith({
      card: bolt,
      copies: 1,
      target: "mainboard",
    });
  });

  it("pressing Escape while carrying cancels the carry without dropping", () => {
    const { result } = renderHook(() =>
      useDeckBuilderDragDrop({
        supportsSideboard: true,
        onDrop,
        onCancel,
      }),
    );
    act(() => result.current.pickUp(bolt, 1));
    act(() => {
      result.current.handleKeyDown(keyEvent("Escape"));
    });
    expect(onDrop).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(result.current.isCarrying).toBe(false);
  });

  it("pressing ArrowDown while carrying switches the target to sideboard", () => {
    const { result } = renderHook(() =>
      useDeckBuilderDragDrop({
        supportsSideboard: true,
        onDrop,
      }),
    );
    act(() => result.current.pickUp(bolt, 1));
    expect(result.current.target).toBe("mainboard");
    act(() => {
      result.current.handleKeyDown(keyEvent("ArrowDown"));
    });
    expect(result.current.target).toBe("sideboard");
    expect(result.current.announcement).toContain("Sideboard");
  });

  it("pressing ArrowUp while carrying switches the target back to mainboard", () => {
    const { result } = renderHook(() =>
      useDeckBuilderDragDrop({
        supportsSideboard: true,
        onDrop,
      }),
    );
    act(() => result.current.pickUp(bolt, 1));
    act(() => {
      result.current.handleKeyDown(keyEvent("ArrowDown"));
    });
    expect(result.current.target).toBe("sideboard");
    act(() => {
      result.current.handleKeyDown(keyEvent("ArrowUp"));
    });
    expect(result.current.target).toBe("mainboard");
  });

  it("does not switch to sideboard when the format does not support one", () => {
    const { result } = renderHook(() =>
      useDeckBuilderDragDrop({
        supportsSideboard: false,
        onDrop,
      }),
    );
    act(() => result.current.pickUp(bolt, 1));
    expect(result.current.target).toBe("mainboard");
    act(() => {
      result.current.handleKeyDown(keyEvent("ArrowDown"));
    });
    // Even after pressing ArrowDown, the target should remain mainboard.
    expect(result.current.target).toBe("mainboard");
  });

  it("switchTarget API cycles the target", () => {
    const { result } = renderHook(() =>
      useDeckBuilderDragDrop({
        supportsSideboard: true,
        onDrop,
      }),
    );
    act(() => result.current.pickUp(bolt, 1));
    act(() => result.current.switchTarget("next"));
    expect(result.current.target).toBe("sideboard");
    act(() => result.current.switchTarget("previous"));
    expect(result.current.target).toBe("mainboard");
  });

  it("cancel() clears the carry programmatically", () => {
    const { result } = renderHook(() =>
      useDeckBuilderDragDrop({
        supportsSideboard: true,
        onDrop,
        onCancel,
      }),
    );
    act(() => result.current.pickUp(bolt, 1));
    act(() => result.current.cancel());
    expect(result.current.isCarrying).toBe(false);
    expect(onDrop).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("ignores Ctrl/Cmd modifiers (those belong to other handlers)", () => {
    const { result } = renderHook(() =>
      useDeckBuilderDragDrop({
        supportsSideboard: true,
        onDrop,
      }),
    );
    act(() => result.current.pickUp(bolt, 1));
    const consumed = result.current.handleKeyDown(
      keyEvent("Enter", { ctrlKey: true }),
    );
    // Ctrl+Enter is reserved for other page-level shortcuts; the hook must
    // not consume it (returns false from handleKeyDown).
    expect(consumed).toBe(false);
    expect(onDrop).not.toHaveBeenCalled();
    expect(result.current.isCarrying).toBe(true);
  });

  it("suppresses key handling while typing in form fields", () => {
    const { result } = renderHook(() =>
      useDeckBuilderDragDrop({
        supportsSideboard: true,
        onDrop,
      }),
    );
    act(() => result.current.pickUp(bolt, 1));
    const input = document.createElement("input");
    document.body.appendChild(input);
    const event = keyEvent("Enter");
    Object.defineProperty(event, "target", { value: input });
    const consumed = result.current.handleKeyDown(event);
    expect(consumed).toBe(false);
    expect(onDrop).not.toHaveBeenCalled();
    expect(result.current.isCarrying).toBe(true);
    document.body.removeChild(input);
  });
});

describe("useDeckBuilderDragDrop — keyboard pick-up via 'M' key", () => {
  let onDrop: jest.Mock;

  beforeEach(() => {
    onDrop = jest.fn();
  });

  afterEach(() => {
    // Reset focus between tests so the previous test's focused element
    // doesn't leak into the next one.
    if (document.body.contains(document.activeElement)) {
      (document.activeElement as HTMLElement)?.blur?.();
    }
  });

  it("pressing 'M' while a card-result-tile button is focused picks it up", () => {
    render(
      <div>
        <button data-card-index="0" data-testid="tile">
          Lightning Bolt
        </button>
      </div>,
    );
    const tile = screen.getByTestId("tile");
    attachCardToElement(tile, bolt);
    tile.focus();
    expect(document.activeElement).toBe(tile);

    const { result } = renderHook(() =>
      useDeckBuilderDragDrop({ supportsSideboard: true, onDrop }),
    );

    act(() => {
      result.current.handleKeyDown(keyEvent("m"));
    });
    expect(result.current.isCarrying).toBe(true);
    expect(result.current.carriedCard).toEqual(bolt);
    expect(result.current.announcement).toContain("Lightning Bolt");
  });

  it("pressing 'Shift+M' picks up with 4-copy intent", () => {
    render(
      <div>
        <button data-testid="tile">Lightning Bolt</button>
      </div>,
    );
    const tile = screen.getByTestId("tile");
    attachCardToElement(tile, bolt);
    tile.focus();

    const { result } = renderHook(() =>
      useDeckBuilderDragDrop({ supportsSideboard: true, onDrop }),
    );

    act(() => {
      result.current.handleKeyDown(keyEvent("M", { shiftKey: true }));
    });
    expect(result.current.copies).toBe(4);
  });

  it("'M' is a no-op when no card-tile-shaped element has focus", () => {
    render(
      <div>
        <button data-testid="unrelated">Unrelated</button>
      </div>,
    );
    screen.getByTestId("unrelated").focus();

    const { result } = renderHook(() =>
      useDeckBuilderDragDrop({ supportsSideboard: true, onDrop }),
    );

    act(() => {
      result.current.handleKeyDown(keyEvent("m"));
    });
    expect(result.current.isCarrying).toBe(false);
  });

  it("'M' is a no-op when already carrying (avoids stomping an active carry)", () => {
    render(
      <div>
        <button data-testid="tile-a">Bolt</button>
        <button data-testid="tile-b">Island</button>
      </div>,
    );
    const tileA = screen.getByTestId("tile-a");
    const tileB = screen.getByTestId("tile-b");
    attachCardToElement(tileA, bolt);
    attachCardToElement(tileB, island);
    tileA.focus();

    const { result } = renderHook(() =>
      useDeckBuilderDragDrop({ supportsSideboard: true, onDrop }),
    );

    act(() => result.current.pickUp(bolt, 1));
    expect(result.current.carriedCard).toEqual(bolt);

    // Focus island, press M. The hook should ignore it because we're already
    // carrying bolt (letting the user cancel first instead of swapping).
    tileB.focus();
    act(() => {
      result.current.handleKeyDown(keyEvent("m"));
    });
    expect(result.current.carriedCard).toEqual(bolt);
  });
});

describe("useDeckBuilderDragDrop — HTML5 drag-and-drop pointer path", () => {
  let onDrop: jest.Mock;

  beforeEach(() => {
    onDrop = jest.fn();
  });

  /**
   * Render a minimal harness with a source tile and a drop zone so we can
   * exercise the HTML5 drag-and-drop event wiring end-to-end. jsdom doesn't
   * implement full DataTransfer, so we provide the bare minimum shim the
   * hook's onDragStart/onDrop handlers consult.
   */
  function Harness({
    supportsSideboard,
    onShiftRef,
  }: {
    supportsSideboard: boolean;
    onShiftRef?: (handlers: ReturnType<typeof useDeckBuilderDragDrop>) => void;
  }) {
    const result = useDeckBuilderDragDrop({
      supportsSideboard,
      onDrop,
    });
    if (onShiftRef) onShiftRef(result);
    return (
      <div>
        <button data-testid="source" {...result.sourceDragHandlers}>
          {bolt.name}
        </button>
        <div
          data-testid="deck-drop"
          data-target="mainboard"
          {...result.targetDropHandlers}
        >
          Drop here (deck)
        </div>
        {supportsSideboard && (
          <div
            data-testid="sideboard-drop"
            data-target="sideboard"
            {...result.targetDropHandlers}
          >
            Drop here (sideboard)
          </div>
        )}
        <div data-testid="announcement">{result.announcement}</div>
      </div>
    );
  }

  /**
   * Build a DataTransfer-shaped object with the methods the hook calls.
   * jsdom's DataTransfer constructor is missing effectAllowed/dropEffect
   * getters, so we stub them with plain properties.
   */
  function makeDataTransfer(): any {
    const store: Record<string, string> = {};
    return {
      _store: store,
      getData: (type: string) => store[type] ?? "",
      setData: (type: string, value: string) => {
        store[type] = value;
      },
      effectAllowed: "copy",
      dropEffect: "none",
    };
  }

  it("dragstart on the source enters carry state with 1 copy", () => {
    render(<Harness supportsSideboard={true} />);
    const source = screen.getByTestId("source");
    attachCardToElement(source, bolt);
    const dt = makeDataTransfer();
    fireEvent.dragStart(source, { dataTransfer: dt });
    expect(screen.getByTestId("announcement")).toHaveTextContent(
      /Lightning Bolt/,
    );
  });

  it("dragstart without shift defaults to 1 copy", () => {
    render(<Harness supportsSideboard={true} />);
    const source = screen.getByTestId("source");
    attachCardToElement(source, bolt);
    const dt = makeDataTransfer();
    fireEvent.dragStart(source, { dataTransfer: dt });
    fireEvent.drop(screen.getByTestId("deck-drop"), { dataTransfer: dt });
    expect(onDrop).toHaveBeenCalledWith({
      card: bolt,
      copies: 1,
      target: "mainboard",
    });
  });

  it("Shift+dragstart sets the carry to 4 copies", () => {
    let handlers: ReturnType<typeof useDeckBuilderDragDrop> | undefined;
    render(
      <Harness
        supportsSideboard={true}
        onShiftRef={(h) => {
          handlers = h;
        }}
      />,
    );
    const source = screen.getByTestId("source");
    attachCardToElement(source, bolt);
    const dt = makeDataTransfer();
    // jsdom's fireEvent.dragStart doesn't surface `shiftKey` to the React
    // synthetic event consistently across versions; we drive the handler
    // directly with a minimal DragEvent-shaped object so the test is
    // deterministic.
    const dragStartEvent = {
      currentTarget: source,
      dataTransfer: dt,
      shiftKey: true,
    } as unknown as React.DragEvent<HTMLElement>;
    act(() => {
      handlers!.sourceDragHandlers.onDragStart(dragStartEvent);
    });
    const dropEvent = {
      currentTarget: screen.getByTestId("deck-drop"),
      dataTransfer: dt,
      preventDefault: jest.fn(),
    } as unknown as React.DragEvent<HTMLElement>;
    act(() => {
      handlers!.targetDropHandlers.onDrop(dropEvent);
    });
    expect(onDrop).toHaveBeenCalledWith({
      card: bolt,
      copies: 4,
      target: "mainboard",
    });
  });

  it("dropping on the deck zone adds to mainboard", () => {
    render(<Harness supportsSideboard={true} />);
    const source = screen.getByTestId("source");
    attachCardToElement(source, bolt);
    const dt = makeDataTransfer();
    fireEvent.dragStart(source, { dataTransfer: dt });
    fireEvent.drop(screen.getByTestId("deck-drop"), { dataTransfer: dt });
    expect(onDrop).toHaveBeenCalledWith({
      card: bolt,
      copies: 1,
      target: "mainboard",
    });
  });

  it("dropping on the sideboard zone (when supported) adds to sideboard", () => {
    render(<Harness supportsSideboard={true} />);
    const source = screen.getByTestId("source");
    attachCardToElement(source, bolt);
    const dt = makeDataTransfer();
    fireEvent.dragStart(source, { dataTransfer: dt });
    fireEvent.drop(screen.getByTestId("sideboard-drop"), { dataTransfer: dt });
    expect(onDrop).toHaveBeenCalledWith({
      card: bolt,
      copies: 1,
      target: "sideboard",
    });
  });

  it("dragend without a preceding drop cancels the carry", () => {
    render(<Harness supportsSideboard={true} />);
    const source = screen.getByTestId("source");
    attachCardToElement(source, bolt);
    const dt = makeDataTransfer();
    fireEvent.dragStart(source, { dataTransfer: dt });
    // No drop fires; just dragend (e.g. user released outside any zone).
    fireEvent.dragEnd(source, { dataTransfer: dt });
    expect(onDrop).not.toHaveBeenCalled();
    // Announcement region should be empty again.
    expect(screen.getByTestId("announcement")).toHaveTextContent("");
  });
});
