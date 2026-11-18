/**
 * @fileoverview Tests for the chat input's IME-safe Enter handling and its
 * `field-sizing: content` progressive enhancement (issue #2963).
 *
 * While an IME (Japanese/Korean/Chinese) composition is active, the Enter key
 * confirms the candidate word — it must NOT send the message. The component
 * therefore ignores Enter when the composition is in progress, which is
 * signalled by `isComposing` on the keyboard event or by the legacy
 * `keyCode === 229`.
 *
 * The auto-resize behaviour is progressive enhancement: browsers that support
 * `field-sizing: content` size the textarea natively (CSS), and the
 * imperative `scrollHeight` resize is only the fallback for browsers without
 * support (still capped at 150px).
 */

import { describe, it, expect, jest, afterEach } from "@jest/globals";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/jest-globals";
import { ChatInput } from "../chat-input";

interface KeyInit {
  key?: string;
  keyCode?: number;
  isComposing?: boolean;
  shiftKey?: boolean;
}

/**
 * Dispatch a `keydown` event with full control over the legacy
 * `keyCode`/`isComposing` values. jsdom does not implement those as writable
 * `KeyboardEventInit` members, so they are installed as own properties on the
 * event instance (which shadows the prototype getters).
 */
function pressKey(element: HTMLElement, init: KeyInit = {}) {
  const event = new KeyboardEvent("keydown", {
    key: init.key ?? "Enter",
    code: init.key ?? "Enter",
    bubbles: true,
    cancelable: true,
    shiftKey: init.shiftKey ?? false,
  });
  if (init.keyCode !== undefined) {
    Object.defineProperty(event, "keyCode", {
      value: init.keyCode,
      configurable: true,
    });
  }
  if (init.isComposing !== undefined) {
    Object.defineProperty(event, "isComposing", {
      value: init.isComposing,
      configurable: true,
    });
  }
  element.dispatchEvent(event);
}

/** Replace `window.CSS` with a stub whose `supports()` returns `supported`. */
const originalCssDescriptor = Object.getOwnPropertyDescriptor(window, "CSS");

function stubCssSupports(supported: boolean) {
  Object.defineProperty(window, "CSS", {
    value: { supports: () => supported },
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  // Restore whatever jsdom provided (possibly nothing at all).
  if (originalCssDescriptor) {
    Object.defineProperty(window, "CSS", originalCssDescriptor);
  } else {
    Reflect.deleteProperty(window, "CSS");
  }
});

describe("ChatInput — IME-safe Enter (issue #2963)", () => {
  it("sends the message on a normal Enter", () => {
    const onSend = jest.fn();
    render(<ChatInput onSend={onSend} />);
    const textarea = screen.getByLabelText(
      "Chat message input",
    ) as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: "hello" } });
    pressKey(textarea, { key: "Enter" });

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("hello");
  });

  it("does not send while an IME composition is active", () => {
    const onSend = jest.fn();
    render(<ChatInput onSend={onSend} />);
    const textarea = screen.getByLabelText(
      "Chat message input",
    ) as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: "hello" } });
    pressKey(textarea, { key: "Enter", isComposing: true });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("does not send when the key event reports the legacy keyCode 229", () => {
    const onSend = jest.fn();
    render(<ChatInput onSend={onSend} />);
    const textarea = screen.getByLabelText(
      "Chat message input",
    ) as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: "hello" } });
    pressKey(textarea, { key: "Enter", keyCode: 229, isComposing: false });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("does not send on Shift+Enter (newline instead)", () => {
    const onSend = jest.fn();
    render(<ChatInput onSend={onSend} />);
    const textarea = screen.getByLabelText(
      "Chat message input",
    ) as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: "hello" } });
    pressKey(textarea, { key: "Enter", shiftKey: true });

    expect(onSend).not.toHaveBeenCalled();
  });
});

describe("ChatInput — field-sizing progressive enhancement (issue #2963)", () => {
  it("keeps the 44px floor, the 150px cap and the native field-sizing rule", () => {
    render(<ChatInput onSend={jest.fn()} />);
    const textarea = screen.getByLabelText(
      "Chat message input",
    ) as HTMLTextAreaElement;

    expect(textarea.className).toContain("min-h-[44px]");
    expect(textarea.className).toContain("max-h-[150px]");
    expect(textarea.className).toContain("field-sizing:content");
  });

  it("skips the imperative resize when the browser supports field-sizing", () => {
    stubCssSupports(true);
    const onSend = jest.fn();
    render(<ChatInput onSend={onSend} />);
    const textarea = screen.getByLabelText(
      "Chat message input",
    ) as HTMLTextAreaElement;

    fireEvent.change(textarea, { target: { value: "hello" } });

    expect(textarea.style.height).toBe("");
  });

  it("falls back to the imperative resize (capped at 150px) without support", () => {
    stubCssSupports(false);
    const onSend = jest.fn();
    render(<ChatInput onSend={onSend} />);
    const textarea = screen.getByLabelText(
      "Chat message input",
    ) as HTMLTextAreaElement;

    Object.defineProperty(textarea, "scrollHeight", {
      value: 500,
      configurable: true,
    });

    fireEvent.change(textarea, { target: { value: "hello" } });

    expect(textarea.style.height).toBe("150px");
  });
});
