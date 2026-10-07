/**
 * Simple-mode screen (#2557, #2573): you play seat 0 against a manamind
 * opponent of the chosen strength.
 */
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import SimpleModePage from "../page";
import { loadSimplePolicyModel } from "@/ai/manamind/simple-model";

jest.mock("@/ai/manamind/simple-model", () => ({
  loadSimplePolicyModel: jest.fn(),
}));

jest.mock("@/ai/manamind/simple-rules", () => {
  const actual = jest.requireActual("@/ai/manamind/simple-rules");
  const library = [
    ...Array.from({ length: 17 }, () => "Forest"),
    ...Array.from({ length: 16 }, () => "Grizzly Bears"),
  ];
  const hand = [
    "Forest",
    "Forest",
    "Grizzly Bears",
    "Grizzly Bears",
    "Hill Giant",
    "Canopy Spider",
    "Runeclaw Bear",
  ];
  return {
    ...actual,
    createSimpleGame: () =>
      actual.createSimpleGameFromDeal([
        { hand, library },
        { hand, library },
      ]),
  };
});

const mockLoad = loadSimplePolicyModel as jest.MockedFunction<
  typeof loadSimplePolicyModel
>;

const fakeModel = {
  schema: {
    schema_version: "simple-v1",
    actions: [
      "play_land",
      "cast_spell",
      "declare_attackers",
      "declare_blockers",
      "pass_priority",
    ],
  },
  evaluate: jest.fn(async () => ({ logits: new Float32Array(23), value: 0 })),
} as unknown as Awaited<ReturnType<typeof loadSimplePolicyModel>>;

beforeEach(() => mockLoad.mockReset());

describe("SimpleModePage", () => {
  it("shows the board and your legal moves once the opponent loads", async () => {
    mockLoad.mockResolvedValue(fakeModel);
    render(<SimpleModePage />);
    expect(await screen.findByText("Play Forest")).toBeInTheDocument();
    expect(screen.getByTestId("simple-you-life")).toHaveTextContent("20");
    expect(screen.getByTestId("simple-opponent-life")).toHaveTextContent("20");
    expect(screen.getByText(/Hand: 7 cards/)).toBeInTheDocument();
  });

  it("plays your move, passes forced moves, then lets the opponent act", async () => {
    mockLoad.mockResolvedValue(fakeModel);
    render(<SimpleModePage />);
    fireEvent.click(await screen.findByText("Play Forest"));
    const log = await screen.findByTestId("simple-log");
    expect(log).toHaveTextContent("You: Play Forest");
    await waitFor(() => expect(log).toHaveTextContent("Easy:"), {
      timeout: 4000,
    });
  });

  it("starts on Easy and starts a new game when you pick another opponent", async () => {
    mockLoad.mockResolvedValue(fakeModel);
    render(<SimpleModePage />);
    fireEvent.click(await screen.findByText("Play Forest"));
    expect(await screen.findByTestId("simple-log")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Easy" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    fireEvent.click(screen.getByRole("radio", { name: "Expert" }));
    expect(screen.getByRole("radio", { name: "Expert" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.queryByTestId("simple-log")).not.toBeInTheDocument();
    expect(screen.getByText("Expert opponent")).toBeInTheDocument();
  });

  it("lets a searching opponent move", async () => {
    mockLoad.mockResolvedValue(fakeModel);
    render(<SimpleModePage />);
    fireEvent.click(await screen.findByRole("radio", { name: "Hard" }));
    fireEvent.click(await screen.findByText("Play Forest"));
    const log = await screen.findByTestId("simple-log");
    await waitFor(() => expect(log).toHaveTextContent("Hard:"), {
      timeout: 4000,
    });
  });

  it("offers a retry when the opponent fails to load", async () => {
    mockLoad.mockRejectedValueOnce(new Error("offline"));
    mockLoad.mockResolvedValueOnce(fakeModel);
    render(<SimpleModePage />);
    fireEvent.click(await screen.findByText("Try again"));
    await waitFor(() => expect(mockLoad).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
  });
});
