/**
 * @fileoverview Register-page autofill hints (issue #2963).
 *
 * Browser password managers need the right `autocomplete` tokens to offer
 * autofill on a sign-up form:
 *   - the e-mail / user-name fields carry `username` (they identify the
 *     account the password belongs to),
 *   - the new-password and confirm-password fields carry `new-password`, so a
 *     manager generates a new password instead of filling in an existing one.
 */

import { describe, it, expect, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/jest-globals";
import RegisterPage from "../page";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock("@/lib/client-api-session", () => ({
  syncApiSession: jest.fn().mockResolvedValue(undefined),
}));

describe("RegisterPage — autofill hints (issue #2963)", () => {
  it("marks the e-mail field as a username field", () => {
    render(<RegisterPage />);
    expect(screen.getByLabelText("Email")).toHaveAttribute(
      "autocomplete",
      "username",
    );
  });

  it("marks the username field as a username field", () => {
    render(<RegisterPage />);
    expect(screen.getByLabelText("Username")).toHaveAttribute(
      "autocomplete",
      "username",
    );
  });

  it("marks the password field as a new-password field", () => {
    render(<RegisterPage />);
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
  });

  it("marks the confirm-password field as a new-password field", () => {
    render(<RegisterPage />);
    expect(screen.getByLabelText("Confirm Password")).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
  });
});
