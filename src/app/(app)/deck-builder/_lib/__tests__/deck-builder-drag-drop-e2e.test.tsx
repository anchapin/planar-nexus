/**
 * @fileOverview End-to-end (within the React tree) test for the deck-builder
 * drag-and-drop flow (issue #1545).
 *
 * The issue's acceptance criterion #7 says:
 *   "A Playwright or Testing Library test exercises both the pointer
 *    drag-and-drop path and the keyboard-carry path end-to-end and asserts
 *    the deck count increments in both."
 *
 * The harness mounts a single `useDeckBuilderDragDrop` instance and exposes
 * its `handleKeyDown` callback via a ref so the test can drive the keyboard
 * flow while still observing the deck-count side effects. The pointer flow
 * uses the standard `fireEvent.dragStart` / `fireEvent.drop` API.
 */

import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/jest-globals";
import * as React from "react";
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

function keyEvent(
  key: string,
  opts: { shiftKey?: boolean } = {},
): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    key,
    shiftKey: !!opts.shiftKey,
    bubbles: true,
    cancelable: true,
  });
}

interface DeckStats {
  mainboardCount: number;
  sideboardCount: number;
  announcement: string;
}

/**
 * The single hook instance the test drives. Stores a ref to the latest
 * `handleKeyDown` so the test can fire keystrokes against the same hook
 * instance that owns the render's UI state.
 */
function Harness({
  supportsSideboard,
  apiRef,
  onStats,
}: {
  supportsSideboard: boolean;
  apiRef: React.MutableRefObject<{
    handleKeyDown: ((e: KeyboardEvent) => boolean) | null;
  }>;
  onStats: (stats: DeckStats) => void;
}) {
  // Maintain the deck / sideboard lists as refs so the harness's
  // `useDeckBuilderDragDrop` doesn't see a new onDrop reference every
  // render (which would invalidate the hook's internal memoisation).
  const mainboardRef = React.useRef<Map<string, number>>(new Map());
  const sideboardRef = React.useRef<Map<string, number>>(new Map());
  const [tick, setTick] = React.useState(0);

  const dragDrop = useDeckBuilderDragDrop({
    supportsSideboard,
    onDrop: ({ card, copies, target }) => {
      const target_map =
        target === "sideboard" ? sideboardRef.current : mainboardRef.current;
      target_map.set(card.id, (target_map.get(card.id) ?? 0) + copies);
      setTick((t) => t + 1);
    },
  });

  // Expose handleKeyDown to the test.
  React.useEffect(() => {
    apiRef.current.handleKeyDown = (e: KeyboardEvent) =>
      dragDrop.handleKeyDown(e);
  }, [apiRef, dragDrop]);

  // Compute the deck totals.
  const totals = React.useMemo(() => {
    let m = 0;
    mainboardRef.current.forEach((n) => {
      m += n;
    });
    let s = 0;
    sideboardRef.current.forEach((n) => {
      s += n;
    });
    return { mainboardCount: m, sideboardCount: s };
  }, [tick, dragDrop.announcement]);

  // Surface counts to the test (synchronously after render so the test
  // sees fresh numbers immediately after dispatching a key event).
  React.useEffect(() => {
    onStats({ ...totals, announcement: dragDrop.announcement });
  }, [totals, dragDrop.announcement, onStats]);

  return (
    <div>
      <button data-testid="source-bolt" {...dragDrop.sourceDragHandlers}>
        Lightning Bolt
      </button>
      <button data-testid="source-island" {...dragDrop.sourceDragHandlers}>
        Island
      </button>
      <div
        data-testid="deck-drop"
        data-target="mainboard"
        {...dragDrop.targetDropHandlers}
      >
        Drop here (deck)
      </div>
      {supportsSideboard && (
        <div
          data-testid="sideboard-drop"
          data-target="sideboard"
          {...dragDrop.targetDropHandlers}
        >
          Drop here (sideboard)
        </div>
      )}
      <div data-testid="announcement">{dragDrop.announcement}</div>
    </div>
  );
}

function renderHarness(
  opts: { supportsSideboard: boolean },
  apiRef: React.MutableRefObject<{
    handleKeyDown: ((e: KeyboardEvent) => boolean) | null;
  }>,
) {
  let stats: DeckStats = {
    mainboardCount: 0,
    sideboardCount: 0,
    announcement: "",
  };
  render(
    <Harness
      supportsSideboard={opts.supportsSideboard}
      apiRef={apiRef}
      onStats={(s) => {
        stats = s;
      }}
    />,
  );
  return {
    getStats: () => stats,
  };
}

describe("deck-builder drag-and-drop — end-to-end deck-count assertions (#1545)", () => {
  let apiRef: React.MutableRefObject<{
    handleKeyDown: ((e: KeyboardEvent) => boolean) | null;
  }>;

  beforeEach(() => {
    apiRef = { current: { handleKeyDown: null } };
  });

  it("keyboard pick-up + Enter drop increments the deck count by 1", () => {
    const { getStats } = renderHarness({ supportsSideboard: true }, apiRef);
    const source = screen.getByTestId("source-bolt");
    attachCardToElement(source, bolt);
    source.focus();

    act(() => apiRef.current.handleKeyDown!(keyEvent("m")));
    act(() => apiRef.current.handleKeyDown!(keyEvent("Enter")));

    expect(getStats().mainboardCount).toBe(1);
    expect(getStats().sideboardCount).toBe(0);
    expect(getStats().announcement).toBe("");
  });

  it("Shift+M pick-up + Shift+Enter drop increments the deck count by 4", () => {
    const { getStats } = renderHarness({ supportsSideboard: true }, apiRef);
    const source = screen.getByTestId("source-bolt");
    attachCardToElement(source, bolt);
    source.focus();

    act(() => apiRef.current.handleKeyDown!(keyEvent("M", { shiftKey: true })));
    act(() =>
      apiRef.current.handleKeyDown!(keyEvent("Enter", { shiftKey: true })),
    );

    expect(getStats().mainboardCount).toBe(4);
  });

  it("keyboard ArrowDown switches the target so drop lands on the sideboard", () => {
    const { getStats } = renderHarness({ supportsSideboard: true }, apiRef);
    const source = screen.getByTestId("source-bolt");
    attachCardToElement(source, bolt);
    source.focus();

    act(() => apiRef.current.handleKeyDown!(keyEvent("m")));
    act(() => apiRef.current.handleKeyDown!(keyEvent("ArrowDown")));
    expect(getStats().announcement).toContain("Sideboard");
    act(() => apiRef.current.handleKeyDown!(keyEvent("Enter")));

    expect(getStats().mainboardCount).toBe(0);
    expect(getStats().sideboardCount).toBe(1);
  });

  it("Escape cancels the keyboard carry so the deck count is unchanged", () => {
    const { getStats } = renderHarness({ supportsSideboard: true }, apiRef);
    const source = screen.getByTestId("source-bolt");
    attachCardToElement(source, bolt);
    source.focus();

    act(() => apiRef.current.handleKeyDown!(keyEvent("m")));
    act(() => apiRef.current.handleKeyDown!(keyEvent("Escape")));

    expect(getStats().mainboardCount).toBe(0);
    expect(getStats().sideboardCount).toBe(0);
  });

  it("pointer drag-and-drop increments the deck count by 1", () => {
    const { getStats } = renderHarness({ supportsSideboard: true }, apiRef);
    const source = screen.getByTestId("source-bolt");
    attachCardToElement(source, bolt);
    const dt: any = {
      _store: {} as Record<string, string>,
      getData: (type: string) => (dt._store[type] ?? "") as string,
      setData: (type: string, value: string) => {
        dt._store[type] = value;
      },
      effectAllowed: "copy",
      dropEffect: "none",
    };
    fireEvent.dragStart(source, { dataTransfer: dt });
    fireEvent.drop(screen.getByTestId("deck-drop"), { dataTransfer: dt });

    expect(getStats().mainboardCount).toBe(1);
  });

  it("Shift+pointer drag-and-drop increments the deck count by 4", () => {
    const { getStats } = renderHarness({ supportsSideboard: true }, apiRef);
    const source = screen.getByTestId("source-bolt");
    attachCardToElement(source, bolt);
    const dt: any = {
      _store: {} as Record<string, string>,
      getData: (type: string) => (dt._store[type] ?? "") as string,
      setData: (type: string, value: string) => {
        dt._store[type] = value;
      },
      effectAllowed: "copy",
      dropEffect: "none",
    };
    // jsdom's fireEvent.dragStart occasionally drops the shiftKey modifier on
    // the React synthetic event. Drive the React-attached onDragStart handler
    // directly so the modifier flag is deterministic — the same approach used
    // in use-deck-builder-drag-drop.test.tsx.
    const reactKey = Object.keys(source).find((k) =>
      k.startsWith("__reactProps$"),
    );
    const props = reactKey
      ? ((source as unknown as Record<string, unknown>)[reactKey] as Record<
          string,
          unknown
        > & {
          onDragStart?: (e: React.DragEvent<HTMLElement>) => void;
          onDrop?: (e: React.DragEvent<HTMLElement>) => void;
        })
      : null;
    const deckDrop = screen.getByTestId("deck-drop");
    const dropReactKey = Object.keys(deckDrop).find((k) =>
      k.startsWith("__reactProps$"),
    );
    const dropProps = dropReactKey
      ? ((deckDrop as unknown as Record<string, unknown>)[
          dropReactKey
        ] as Record<string, unknown> & {
          onDrop?: (e: React.DragEvent<HTMLElement>) => void;
        })
      : null;

    act(() => {
      props?.onDragStart?.({
        currentTarget: source,
        dataTransfer: dt,
        shiftKey: true,
      } as unknown as React.DragEvent<HTMLElement>);
    });
    act(() => {
      dropProps?.onDrop?.({
        currentTarget: deckDrop,
        dataTransfer: dt,
        preventDefault: jest.fn(),
      } as unknown as React.DragEvent<HTMLElement>);
    });

    expect(getStats().mainboardCount).toBe(4);
  });

  it("dropping on the sideboard zone increments the sideboard count", () => {
    const { getStats } = renderHarness({ supportsSideboard: true }, apiRef);
    const source = screen.getByTestId("source-island");
    attachCardToElement(source, island);
    const dt: any = {
      _store: {} as Record<string, string>,
      getData: (type: string) => (dt._store[type] ?? "") as string,
      setData: (type: string, value: string) => {
        dt._store[type] = value;
      },
      effectAllowed: "copy",
      dropEffect: "none",
    };
    fireEvent.dragStart(source, { dataTransfer: dt });
    fireEvent.drop(screen.getByTestId("sideboard-drop"), { dataTransfer: dt });

    expect(getStats().mainboardCount).toBe(0);
    expect(getStats().sideboardCount).toBe(1);
  });
});
