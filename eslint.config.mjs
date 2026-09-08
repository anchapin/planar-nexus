// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";

const eslintConfig = [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs,jsx,ts,tsx}"],
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
    },
    languageOptions: {
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: "module",
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-empty-function": "warn", // Changed to warn for callback interfaces
      "no-empty": ["error", { allowEmptyCatch: false }],
      // New in @eslint/js v10's recommended config. The repo's existing code
      // trips these in many places; we keep them as warnings (visible via
      // --max-warnings 1000) rather than errors so the v10 bump does not
      // gate CI. A follow-up can either fix the underlying patterns or
      // promote these to errors.
      "no-useless-assignment": "warn",
      "preserve-caught-error": "warn",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // Issue #1276: Forbid new dangerouslySetInnerHTML uses. The existing
      // chart.tsx site is allow-listed via overrides below; all other code
      // must sanitize text via `src/lib/security/sanitize-text.ts`.
      "react/no-danger": "error",
      // Prevent console.log in production code (use logger utility instead)
      "no-console": ["warn", { allow: ["warn", "error", "info"] }],
      // Prevent direct API calls with Authorization headers in client code (security)
      "no-restricted-syntax": [
        "warn",
        {
          selector: "CallExpression[callee.name='fetch']",
          message:
            "Use safeFetch or AI proxy client instead of direct fetch calls",
        },
      ],
    },
    settings: {
      react: {
        version: "detect",
      },
    },
  },
  {
    // Test files can use console and have relaxed rules
    files: ["**/__tests__/**/*", "**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-function": "off",
    },
  },
  {
    // The Recharts chart primitive is the only existing
    // dangerouslySetInnerHTML user and is allow-listed for that sink.
    // All other new uses must route through `sanitizeMarkdown` (issue #1276).
    files: ["src/components/ui/chart.tsx"],
    rules: {
      "react/no-danger": "off",
    },
  },
  // Issue #1710: the game-state barrel (src/lib/game-state/index.ts) is the
  // engine's sole public API. Deep imports (`@/lib/game-state/<module>`)
  // bypass the curated surface and fan internal churn out to consumers —
  // error on them everywhere OUTSIDE the engine directory (relative
  // intra-engine imports are exempt via the ignores pattern).
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/lib/game-state/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/lib/game-state/*"],
              message:
                'Import from "@/lib/game-state" (the barrel), not from individual engine modules — the barrel is the engine\'s only public API (issue #1710).',
            },
          ],
        },
      ],
    },
  },
  {
    ignores: [
      "next-env.d.ts",
      ".next/**",
      "node_modules/**",
      "jest.setup.js",
      "jest.config.js",
      "commitlint.config.js",
      "stryker.config.js",
      // Plain Node CommonJS tooling (uses require/module/process globals that
      // the flat config has no Node environment for), same class of file as
      // jest.config.js above.
      "scripts/ratchet-coverage.js",
      // Plain Node CommonJS tooling for the issue #1598 per-module mutation
      // floor gate (checker CLI + shared lib + floor config).
      "scripts/mutation-floor.js",
      "scripts/mutation-floor-lib.js",
      "scripts/mutation-floor.config.js",
      // Plain Node CommonJS tooling for the issue #1395 score breakdown.
      "scripts/mutation-summary.js",
      // Plain Node ESM tooling for the issue #1397 fixture regenerator.
      "scripts/regen-video-fixtures.mjs",
      // Plain Node ESM tooling for the issue #1430 updater-config guard.
      "scripts/check-tauri-updater-config.mjs",
      // Plain Node ESM tooling for the issue #1725 engine size-budget gate.
      "scripts/check-engine-size-budget.mjs",
      ".claude/skills/pr-automation/**",
    ],
  },
];

export default eslintConfig;
