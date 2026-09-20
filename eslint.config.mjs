// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";

// Issue #1724: the rules engine (src/lib/game-state/**) is self-contained.
// Engine files may import vendored/third-party modules and other engine
// files (relative or via the engine's own barrel) but NOTHING else under
// `@/*` — format/deck-construction rules and the card-data shape are
// engine-owned (format-rules.ts / types/card-data.ts) and root-level
// facades (@/lib/game-rules, @/lib/card-database) must not be imported
// from inside the engine. Relative imports that climb OUT of the engine
// directory are banned depth-aware (one `../` per directory level below
// the engine root would escape).
const ENGINE_OUTBOUND_IMPORT_MESSAGE =
  "The game-state engine is self-contained (issue #1724): imports must " +
  "resolve inside src/lib/game-state or to vendored/third-party modules. " +
  "Format/deck-construction rules are engine-owned " +
  "(src/lib/game-state/format-rules.ts); @/lib/game-rules and " +
  "@/lib/card-database are facades for OUTSIDE consumers only.";

// Bans every `@/…` alias import EXCEPT the engine's own barrel
// (`@/lib/game-state` and modules under it) — negative lookahead keeps
// the barrel importable from inside the engine while banning every other
// alias path (@/lib/game-rules, @/components, @/hooks, …).
const ENGINE_ALIAS_BAN_REGEX = "^@(?!/lib/game-state(?:$|/))/";

const engineOutboundBoundaryBlock = (filesGlob, escapeRegex) => ({
  files: filesGlob,
  rules: {
    "no-restricted-imports": [
      "error",
      {
        paths: [
          {
            name: "vitest",
            message:
              "This repo runs Jest; vitest imports silently break test discovery (issue #1784)",
          },
          {
            name: "@/lib/game-rules",
            message:
              "Format rules are engine-owned versioned input data " +
              "(src/lib/game-state/format-rules.ts, issue #1724); the " +
              "root-level facade is for app code, not the engine.",
          },
          {
            name: "@/lib/card-database",
            message:
              "The card-data shape is engine-owned " +
              "(src/lib/game-state/types/card-data.ts, issue #1724); " +
              "import ScryfallCard from the engine's own types instead.",
          },
        ],
        patterns: [
          {
            regex: ENGINE_ALIAS_BAN_REGEX,
            message: ENGINE_OUTBOUND_IMPORT_MESSAGE,
          },
          {
            // Depth-aware relative-escape ban: at this directory depth,
            // an import with this many leading `../` segments resolves
            // outside src/lib/game-state.
            regex: escapeRegex,
            message: ENGINE_OUTBOUND_IMPORT_MESSAGE,
          },
        ],
      },
    ],
  },
});

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
  // Issue #1710 + #1925: the game-state barrel is the engine's sole public API.
  // ALL patterns use `regex` (not `group`) so ESLint flat config MERGES them.
  // The barrel deep-import pattern and relative deep-import patterns all live
  // in the same rule entry to avoid ESLint replacing group-based options with
  // regex-based ones across overlapping file globs.
  //
  // Allowlisted files are excluded from this block (via `ignores`) so the
  // barrel rule does not apply to them. They are handled in the next block.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      // Exclude engine files — their outbound escapes are handled by the
      // engineOutboundBoundaryBlock rules (issue #1724).
      "src/lib/game-state/**",
      // Exclude test files (jest.mock boundary).
      "**/__tests__/**",
      "**/*.test.ts",
      "**/*.test.tsx",
      // Allowlisted: these files do relative deep imports into the engine
      // (mapReplacer/mapReviver, getStateAtPosition) not in the barrel.
      // They get the relative-import rule separately at WARNING level (below).
      "src/lib/saved-game-serialize-core.ts",
      "src/lib/saved-game-serialize-bridge.ts",
      "src/lib/replay-sharing.ts",
      "src/lib/saved-games.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "vitest",
              message:
                "This repo runs Jest; vitest imports silently break test discovery (issue #1784)",
            },
          ],
          patterns: [
            {
              // Barrel deep import: block `@/lib/game-state/<sub>` where <sub>
              // is a letter. Negative lookahead (?!$|[/]) permits the bare
              // barrel `@/lib/game-state` while blocking `@/lib/game-state/types` etc.
              regex: "^@/lib/game-state/[a-zA-Z](?!$|[/])",
              message:
                'Import from "@/lib/game-state" (the barrel), not from individual engine modules — the barrel is the engine\'s only public API (issue #1710).',
            },
            {
              // Relative deep import: block `./game-state/<sub>` (issue #1925).
              regex: "^\\./game-state/[a-z]",
              message:
                'Import from "@/lib/game-state" (the barrel) — relative deep imports bypass the barrel and are not allowed (issue #1925).',
            },
            {
              // Relative deep import: block `../game-state/<sub>` (issue #1925).
              regex: "^\\.\\./game-state/[a-z]",
              message:
                'Import from "@/lib/game-state" (the barrel) — relative deep imports bypass the barrel and are not allowed (issue #1925).',
            },
          ],
        },
      ],
    },
  },
  // Allowlisted files: receive only the relative-import rule at WARNING level
  // (they don't do barrel imports, only relative imports for internal helpers).
  // Using "warn" instead of "error" so these known exceptions don't fail CI
  // while still being visible in lint output.
  {
    files: [
      "src/lib/saved-game-serialize-core.ts",
      "src/lib/saved-game-serialize-bridge.ts",
      "src/lib/replay-sharing.ts",
      "src/lib/saved-games.ts",
    ],
    ignores: [
      "**/__tests__/**",
      "**/*.test.ts",
      "**/*.test.tsx",
    ],
    rules: {
      "no-restricted-imports": [
        "warn",
        {
          patterns: [
            {
              regex: "^\\./game-state/[a-z]",
              message:
                "Allowlisted: internal helpers not in barrel (issue #1925).",
            },
            {
              regex: "^\\.\\./game-state/[a-z]",
              message:
                "Allowlisted: internal helpers not in barrel (issue #1925).",
            },
          ],
        },
      ],
    },
  },
  // Issue #1724: inbound side of the engine boundary — files INSIDE
  // src/lib/game-state may not import application code outside it. The
  // three blocks below partition the engine tree by directory depth so
  // the relative-escape glob can stay exact at each level (a file N
  // levels deep escapes the engine at its (N+1)-th leading `../`).
  engineOutboundBoundaryBlock(["src/lib/game-state/*.{ts,tsx}"], "^\\.\\./"),
  engineOutboundBoundaryBlock(
    ["src/lib/game-state/*/*.{ts,tsx}"],
    "^\\.\\./\\.\\./",
  ),
  engineOutboundBoundaryBlock(
    ["src/lib/game-state/*/*/*.{ts,tsx}"],
    "^\\.\\./\\.\\./\\.\\./",
  ),
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
      // Plain Node ESM tooling for the issue #1712 coverage-docs sync guard.
      "scripts/check-coverage-docs-sync.mjs",
      // Plain Node ESM tooling for the issue #1725 engine size-budget gate.
      "scripts/check-engine-size-budget.mjs",
      // Plain Node ESM tooling for the issue #1896 broken-link gate.
      "scripts/check-broken-links.mjs",
      // Plain Node ESM tooling for the issue #1910 test-count-docs guard.
      "scripts/check-test-count-docs.mjs",
      // Plain Node ESM tooling for the issue #1910 test-count ratchet.
      "scripts/ratchet-test-count.mjs",
      ".claude/skills/pr-automation/**",
    ],
  },
];

export default eslintConfig;
