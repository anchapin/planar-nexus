// Ambient declaration to register @testing-library/jest-dom matcher
// augmentations for TypeScript.
//
// Background:
//   In Jest 30, `expect` lives in the `@jest/expect` package and is re-exported
//   from `@jest/globals`. The `JestMatchers` type inside `@jest/expect` is
//   defined as `Matchers<R, T> & SnapshotMatchers<R, T>` where `Matchers` is
//   imported from the `expect` package. So to augment `expect()` results we
//   must augment the `Matchers` interface in the `expect` package itself.
//
//   The `jest-globals` subpath of `@testing-library/jest-dom@6` only augments
//   `@jest/expect.Machers` (which is never referenced by `JestExpect`), so
//   its augmentation has no effect at the call site. The matchers ARE
//   registered at runtime via `jest.setup.js`'s
//   `require("@testing-library/jest-dom/jest-globals")`; this .d.ts just keeps
//   TypeScript in sync.
//
// This file MUST be a script (no top-level imports/exports) so its
// `declare module` augmentation applies globally to every test file.

declare module "expect" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface Matchers<R extends void | Promise<void>, T = unknown> {
    toBeDisabled(): R;
    toBeEnabled(): R;
    toBeEmptyDOMElement(): R;
    toBeInTheDocument(): R;
    toBeInvalid(): R;
    toBeRequired(): R;
    toBeValid(): R;
    toBeVisible(): R;
    toContainElement(element: HTMLElement | null): R;
    toContainHTML(htmlText: string): R;
    toHaveAccessibleDescription(
      expectedAccessibleDescription?: string | RegExp,
    ): R;
    toHaveAccessibleErrorMessage(
      expectedAccessibleErrorMessage?: string | RegExp,
    ): R;
    toHaveAccessibleName(expectedAccessibleName?: string | RegExp): R;
    toHaveAttribute(attr: string, value?: unknown): R;
    toHaveClass(...classNames: Array<string | RegExp>): R;
    toHaveFocus(): R;
    toHaveFormValues(expectedValues: Record<string, unknown>): R;
    toHaveStyle(css: string | Record<string, unknown>): R;
    toHaveTextContent(
      text: string | RegExp,
      options?: { normalizeWhitespace: boolean },
    ): R;
    toHaveValue(value: string | string[] | number | null): R;
    toHaveDisplayValue(value: string | RegExp | Array<string | RegExp>): R;
    toBeChecked(): R;
    toBePartiallyChecked(): R;
    toHaveRole(expectedRole: string): R;
    toHaveErrorMessage(text: string | RegExp): R;
    toBePressed(): R;
    toBePartiallyPressed(): R;
    toAppearBefore(other: HTMLElement | null): R;
    toAppearAfter(other: HTMLElement | null): R;
  }
}
