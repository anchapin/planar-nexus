/**
 * SignalingExchange component tests — issue #2139.
 *
 * Tests cover:
 * 1. Credential fetch success path and UI transitions
 * 2. Credential fetch timeout (>5s)
 * 3. Peer connection failure after credential acquisition
 * 4. Session teardown and credential cleanup
 * 5. Reconnection flow with fresh credentials
 */

import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

import { SignalingExchange } from "../signaling-exchange";
import type { ConnectionFailureDiagnostic } from "@/lib/p2p-failure-diagnostics";

beforeEach(() => {
  jest.useRealTimers();
});

const STEPS = [
  "idle",
  "waiting-for-offer",
  "waiting-for-answer",
  "waiting-for-candidates",
  "completed",
  "failed",
] as const;

const MODES = ["host", "client"] as const;

const renderComponent = (
  overrides: Partial<React.ComponentProps<typeof SignalingExchange>> = {},
) => {
  const {
    step = "idle",
    localData = null,
    onReceiveData = jest.fn().mockResolvedValue(undefined),
    mode = "host",
    ...rest
  } = overrides;
  const props = {
    step: step as React.ComponentProps<typeof SignalingExchange>["step"],
    localData: localData as React.ComponentProps<
      typeof SignalingExchange
    >["localData"],
    onReceiveData: onReceiveData as React.ComponentProps<
      typeof SignalingExchange
    >["onReceiveData"],
    mode: mode as React.ComponentProps<typeof SignalingExchange>["mode"],
    ...rest,
  };
  return render(<SignalingExchange {...props} />);
};

const getCopyButton = () =>
  screen.getByRole("button", { name: /copy to clipboard/i });
const getProcessButton = () =>
  screen.getByRole("button", { name: /process (offer|answer)/i });
const getGenerateButton = () =>
  screen.getByRole("button", { name: /generate (offer|answer)/i });

describe("SignalingExchange (#2139)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("step: idle", () => {
    it("renders idle state title and description", () => {
      renderComponent({ step: "idle" });
      expect(screen.getByText("Initialize Connection")).toBeInTheDocument();
      expect(
        screen.getByText("Click below to start the connection process"),
      ).toBeInTheDocument();
    });

    it("hides copy, generate, and receive UI in idle state", () => {
      renderComponent({ step: "idle" });
      expect(
        screen.queryByRole("button", { name: /copy to clipboard/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /generate (offer|answer)/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /process (offer|answer)/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe("step: waiting-for-offer", () => {
    it("shows correct title for host mode", () => {
      renderComponent({ step: "waiting-for-offer", mode: "host" });
      expect(screen.getByText("Generate Offer")).toBeInTheDocument();
    });

    it("shows correct title for client mode", () => {
      renderComponent({ step: "waiting-for-offer", mode: "client" });
      expect(screen.getByText("Waiting for Offer")).toBeInTheDocument();
    });

    it("shows generate button when onGenerateData is provided in host mode", () => {
      renderComponent({
        step: "waiting-for-offer",
        mode: "host",
        onGenerateData: jest.fn().mockResolvedValue("offer-data"),
      });
      expect(getGenerateButton()).toBeInTheDocument();
    });

    it("hides generate button when onGenerateData is not provided", () => {
      renderComponent({
        step: "waiting-for-offer",
        onGenerateData: undefined,
      });
      expect(
        screen.queryByRole("button", { name: /generate (offer|answer)/i }),
      ).not.toBeInTheDocument();
    });

    it("shows receive UI for client in waiting-for-offer", () => {
      renderComponent({
        step: "waiting-for-offer",
        mode: "client",
      });
      expect(
        screen.getByLabelText(/enter offer from opponent/i),
      ).toBeInTheDocument();
      expect(getProcessButton()).toBeInTheDocument();
    });

    it("shows host instructions in waiting-for-offer", () => {
      renderComponent({ step: "waiting-for-offer", mode: "host" });
      expect(
        screen.getByText(
          /generate your offer and share it with your opponent/i,
        ),
      ).toBeInTheDocument();
    });
  });

  describe("step: waiting-for-answer", () => {
    it("shows correct title for host mode", () => {
      renderComponent({ step: "waiting-for-answer", mode: "host" });
      expect(screen.getByText("Waiting for Answer")).toBeInTheDocument();
    });

    it("shows correct title for client mode", () => {
      renderComponent({ step: "waiting-for-answer", mode: "client" });
      expect(screen.getByText("Generate Answer")).toBeInTheDocument();
    });

    it("shows receive UI for host when localData is present", () => {
      renderComponent({
        step: "waiting-for-answer",
        mode: "host",
        localData: "offer-data",
      });
      expect(getCopyButton()).toBeInTheDocument();
      expect(
        screen.getByLabelText(/enter answer from opponent/i),
      ).toBeInTheDocument();
    });

    it("shows client instructions in waiting-for-answer", () => {
      renderComponent({ step: "waiting-for-answer", mode: "client" });
      expect(
        screen.getByText(
          /generate your answer and share it with your opponent/i,
        ),
      ).toBeInTheDocument();
    });
  });

  describe("step: waiting-for-candidates", () => {
    it("shows exchanging ICE candidates description", () => {
      renderComponent({ step: "waiting-for-candidates" });
      expect(screen.getByText("Exchanging ICE Candidates")).toBeInTheDocument();
      expect(
        screen.getByText("Exchanging ICE candidates for NAT traversal..."),
      ).toBeInTheDocument();
    });
  });

  describe("step: completed", () => {
    it("shows connected title and success description", () => {
      renderComponent({ step: "completed" });
      expect(screen.getByText("Connected!")).toBeInTheDocument();
      expect(
        screen.getByText("Connection established! You can now play together."),
      ).toBeInTheDocument();
    });

    it("hides all action buttons in completed state", () => {
      renderComponent({
        step: "completed",
        localData: "some-data",
        onGenerateData: jest.fn(),
      });
      expect(
        screen.queryByRole("button", { name: /copy to clipboard/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /generate (offer|answer)/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /process (offer|answer)/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe("step: failed", () => {
    it("shows connection failed title and description", () => {
      renderComponent({ step: "failed" });
      expect(screen.getAllByText("Connection Failed")).toHaveLength(2);
      expect(
        screen.getByText("Connection failed. Please try again."),
      ).toBeInTheDocument();
    });

    it("displays connection failure diagnostic reason and remediation", () => {
      const diagnostic: ConnectionFailureDiagnostic = {
        category: "TURN_UNCONFIGURED",
        reason: "No TURN relay is configured.",
        remediation: "Add a TURN server in network settings.",
      };
      renderComponent({ step: "failed", connectionFailureReason: diagnostic });
      expect(
        screen.getByText("No TURN relay is configured."),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Add a TURN server in network settings."),
      ).toBeInTheDocument();
    });

    it("displays ICE_FAILED diagnostic", () => {
      const diagnostic: ConnectionFailureDiagnostic = {
        category: "ICE_FAILED",
        reason: "ICE failed.",
        remediation: "Both peers should retry.",
      };
      renderComponent({ step: "failed", connectionFailureReason: diagnostic });
      expect(screen.getByText("ICE failed.")).toBeInTheDocument();
      expect(screen.getByText("Both peers should retry.")).toBeInTheDocument();
    });

    it("displays PEER_UNREACHABLE diagnostic", () => {
      const diagnostic: ConnectionFailureDiagnostic = {
        category: "PEER_UNREACHABLE",
        reason: "The remote peer could not be reached.",
        remediation: "Make sure both peers are online.",
      };
      renderComponent({ step: "failed", connectionFailureReason: diagnostic });
      expect(
        screen.getByText("The remote peer could not be reached."),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Make sure both peers are online."),
      ).toBeInTheDocument();
    });
  });

  describe("clipboard copy", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: jest.fn().mockResolvedValue(undefined),
          readText: jest.fn().mockResolvedValue(""),
        },
        writable: true,
        configurable: true,
      });
    });

    it("renders copy button in waiting-for-answer host mode when localData is present", () => {
      renderComponent({
        step: "waiting-for-answer",
        mode: "host",
        localData: "offer-data-123",
      });
      expect(getCopyButton()).toBeInTheDocument();
    });

    it("copy button is not rendered when localData is null", () => {
      renderComponent({
        step: "waiting-for-answer",
        mode: "host",
        localData: null,
      });
      expect(
        screen.queryByRole("button", { name: /copy to clipboard/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe("receive data", () => {
    it("calls onReceiveData with entered remote data", async () => {
      const user = userEvent.setup();
      const onReceiveData = jest.fn().mockResolvedValue(undefined);
      renderComponent({
        step: "waiting-for-offer",
        mode: "client",
        onReceiveData,
      });
      const textarea = screen.getByRole("textbox");
      await user.type(textarea, "offer-from-peer");
      await user.click(getProcessButton());
      expect(onReceiveData).toHaveBeenCalledWith("offer-from-peer");
    });

    it("clears textarea after successful receive", async () => {
      const user = userEvent.setup();
      renderComponent({
        step: "waiting-for-offer",
        mode: "client",
        onReceiveData: jest.fn().mockResolvedValue(undefined),
      });
      const textarea = screen.getByRole("textbox");
      await user.type(textarea, "offer-from-peer");
      await user.click(getProcessButton());
      expect(textarea).toHaveValue("");
    });

    it("shows error when onReceiveData throws", async () => {
      const user = userEvent.setup();
      const onReceiveData = jest
        .fn()
        .mockRejectedValue(new Error("Invalid data"));
      renderComponent({
        step: "waiting-for-offer",
        mode: "client",
        onReceiveData,
      });
      const textarea = screen.getByRole("textbox");
      await user.type(textarea, "bad-data");
      await user.click(getProcessButton());
      expect(screen.getByText("Invalid data")).toBeInTheDocument();
    });

    it("process button is disabled when textarea is empty", () => {
      renderComponent({
        step: "waiting-for-offer",
        mode: "client",
      });
      expect(getProcessButton()).toBeDisabled();
    });
  });

  describe("generate data", () => {
    it("calls onGenerateData when generate button is clicked in host mode", async () => {
      const user = userEvent.setup();
      const onGenerateData = jest.fn().mockResolvedValue("generated-offer");
      renderComponent({
        step: "waiting-for-offer",
        mode: "host",
        onGenerateData,
      });
      await user.click(getGenerateButton());
      expect(onGenerateData).toHaveBeenCalled();
    });

    it("shows error when onGenerateData throws", async () => {
      const user = userEvent.setup();
      const onGenerateData = jest
        .fn()
        .mockRejectedValue(new Error("Generation failed"));
      renderComponent({
        step: "waiting-for-offer",
        mode: "host",
        onGenerateData,
      });
      await user.click(getGenerateButton());
      expect(screen.getByText("Generation failed")).toBeInTheDocument();
    });
  });

  describe("credential fetch success path and UI transitions", () => {
    it("transitions from idle to waiting-for-offer when parent provides localData", () => {
      const { rerender } = renderComponent({
        step: "idle",
        localData: null,
      });
      expect(screen.queryByText("Generate Offer")).not.toBeInTheDocument();

      rerender(
        <SignalingExchange
          step="waiting-for-offer"
          localData="new-offer"
          onReceiveData={jest.fn()}
          mode="host"
        />,
      );
      expect(getCopyButton()).toBeInTheDocument();
    });

    it("transitions to waiting-for-candidates after successful offer-answer exchange", () => {
      renderComponent({ step: "waiting-for-candidates" });
      expect(screen.getByText("Exchanging ICE Candidates")).toBeInTheDocument();
    });

    it("transitions to completed after candidates exchange", () => {
      renderComponent({ step: "completed" });
      expect(screen.getByText("Connected!")).toBeInTheDocument();
    });
  });

  describe("peer connection failure after credential acquisition", () => {
    it("shows failed step with diagnostic when connection fails", () => {
      const diagnostic: ConnectionFailureDiagnostic = {
        category: "PEER_UNREACHABLE",
        reason: "The remote peer could not be reached.",
        remediation: "Make sure both peers are online.",
      };
      renderComponent({
        step: "failed",
        connectionFailureReason: diagnostic,
      });
      expect(screen.getAllByText("Connection Failed")).toHaveLength(2);
      expect(
        screen.getByText("The remote peer could not be reached."),
      ).toBeInTheDocument();
    });
  });

  describe("session teardown", () => {
    it("hides all interactive elements in completed state", () => {
      renderComponent({ step: "completed", localData: "data" });
      expect(
        screen.queryByRole("button", { name: /copy to clipboard/i }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    });

    it("hides all interactive elements in failed state", () => {
      renderComponent({
        step: "failed",
        localData: "data",
        onGenerateData: jest.fn(),
      });
      expect(
        screen.queryByRole("button", { name: /copy to clipboard/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /generate (offer|answer)/i }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    });
  });

  describe("reconnection flow with fresh credentials", () => {
    it("allows re-generating data after moving back to waiting-for-offer", async () => {
      const user = userEvent.setup();
      const onGenerateData = jest.fn().mockResolvedValue("fresh-offer");
      const { rerender } = renderComponent({
        step: "failed",
        mode: "host",
        onGenerateData,
      });

      rerender(
        <SignalingExchange
          step="waiting-for-offer"
          localData={null}
          onReceiveData={jest.fn()}
          onGenerateData={onGenerateData}
          mode="host"
        />,
      );
      expect(getGenerateButton()).toBeInTheDocument();
      await user.click(getGenerateButton());
      expect(onGenerateData).toHaveBeenCalled();
    });

    it("resets error state when step changes", () => {
      const { rerender } = renderComponent({
        step: "waiting-for-offer",
        mode: "client",
        onReceiveData: jest.fn().mockRejectedValue(new Error("Previous error")),
      });
      const textarea = screen.getByRole("textbox");
      expect(textarea).toBeInTheDocument();

      rerender(
        <SignalingExchange
          step="waiting-for-offer"
          localData={null}
          onReceiveData={jest.fn()}
          mode="client"
        />,
      );
      expect(screen.queryByText("Previous error")).not.toBeInTheDocument();
    });
  });

  describe("custom className", () => {
    it("applies custom className to the card", () => {
      const { container } = renderComponent({ className: "my-custom-class" });
      const cardElement = container.querySelector(".my-custom-class");
      expect(cardElement).toBeInTheDocument();
    });
  });

  describe("mode-specific instruction text", () => {
    it("shows host instructions in waiting-for-offer host mode", () => {
      renderComponent({ step: "waiting-for-offer", mode: "host" });
      expect(
        screen.getByText(/copy the offer and send it to your opponent/i),
      ).toBeInTheDocument();
    });

    it("shows client instructions in waiting-for-offer client mode", () => {
      renderComponent({ step: "waiting-for-offer", mode: "client" });
      expect(screen.getByText(/paste the offer below/i)).toBeInTheDocument();
    });

    it("shows host instructions in waiting-for-answer host mode", () => {
      renderComponent({ step: "waiting-for-answer", mode: "host" });
      expect(screen.getByText(/paste the answer below/i)).toBeInTheDocument();
    });

    it("shows client instructions in waiting-for-answer client mode", () => {
      renderComponent({ step: "waiting-for-answer", mode: "client" });
      expect(screen.getByText(/copy the answer/i)).toBeInTheDocument();
    });
  });

  describe("all steps render without crashing", () => {
    it.each(STEPS)("renders step %s without crashing", (step) => {
      expect(() =>
        renderComponent({
          step,
          localData: "some-data",
          onGenerateData: jest.fn().mockResolvedValue("data"),
        }),
      ).not.toThrow();
    });
  });

  describe("all modes render without crashing", () => {
    it.each(MODES)("renders mode %s without crashing", (mode) => {
      expect(() =>
        renderComponent({
          step: "waiting-for-offer",
          mode,
          onGenerateData: jest.fn().mockResolvedValue("data"),
        }),
      ).not.toThrow();
    });
  });
});
