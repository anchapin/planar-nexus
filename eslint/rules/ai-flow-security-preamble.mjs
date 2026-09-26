/**
 * ESLint rule for issue #2151: SECURITY_PREAMBLE must be prepended to all AI
 * flow prompts. Prevents prompt injection attacks by ensuring every prompt
 * builder uses prependSecurityPreamble(), buildSystemPrompt(), or direct
 * SECURITY_PREAMBLE concatenation so the security preamble cannot be
 * accidentally omitted.
 */
import { ESLintUtils } from "@typescript-eslint/utils";

const RULE_ID = "ai-flow-security-preamble";

const creator = ESLintUtils.RuleCreator(
  (ruleName) =>
    `https://github.com/anomalyco/planar-nexus/issues/2151`,
);

const rule = creator({
  meta: {
    type: "problem",
    docs: {
      description:
        "Enforce SECURITY_PREAMBLE in AI flow files that build LLM prompts",
    },
    messages: {
      missing:
        "AI flow '{{ filename }}' builds an LLM prompt but does not use prependSecurityPreamble(), buildSystemPrompt(), or SECURITY_PREAMBLE directly. " +
        "Use prependSecurityPreamble(prompt), buildSystemPrompt(...parts), or prepend SECURITY_PREAMBLE via template literal " +
        "to ensure the security preamble is always present and cannot be accidentally omitted.",
    },
    fix: null,
  },
  name: RULE_ID,
  defaultOptions: [],
  create(context) {
    const filename = context.filename ?? "";
    const normalised = filename.replace(/\\/g, "/");

    if (
      !normalised.includes("src/ai/flows/") ||
      normalised.includes(".test.") ||
      normalised.endsWith("__tests__/index.ts")
    ) {
      return {};
    }

    let hasSecurityPreambleImport = false;
    let hasPrependHelper = false;
    let hasDirectPreambleUsage = false;
    let hasPromptBuilding = false;
    let promptLine = 0;

    function checkString(str, line) {
      if (/You are\s/i.test(str)) {
        hasPromptBuilding = true;
        if (promptLine === 0) promptLine = line;
      }
    }

    function checkIdentifier(name) {
      if (name === "SECURITY_PREAMBLE") {
        hasDirectPreambleUsage = true;
      }
    }

    return {
      ImportDeclaration(node) {
        if (
          typeof node.source.value === "string" &&
          (node.source.value === "@/ai/prompt-security" ||
            node.source.value === "~/ai/prompt-security")
        ) {
          for (const spec of node.specifiers) {
            if (
              spec.type === "ImportSpecifier" &&
              spec.imported.type === "Identifier"
            ) {
              if (
                spec.imported.name === "prependSecurityPreamble" ||
                spec.imported.name === "buildSystemPrompt"
              ) {
                hasPrependHelper = true;
              }
              if (spec.imported.name === "SECURITY_PREAMBLE") {
                hasSecurityPreambleImport = true;
              }
            }
          }
        }
      },
      TemplateLiteral(node) {
        if (hasPromptBuilding) return;
        for (const quasi of node.quasis) {
          checkString(quasi.value.raw, quasi.loc?.start.line ?? 0);
        }
        for (const expr of node.expressions) {
          if (expr.type === "Identifier") {
            checkIdentifier(expr.name);
          }
        }
      },
      Literal(node) {
        if (hasPromptBuilding) return;
        if (typeof node.value === "string") {
          checkString(node.value, node.loc?.start.line ?? 0);
        }
      },
      "BinaryExpression[operator='+']"(node) {
        if (hasPromptBuilding) return;
        const src = context.sourceCode;
        const leftText = src.getText(node.left);
        const rightText = src.getText(node.right);
        checkString(leftText + rightText, node.loc?.start.line ?? 0);

        function extractIdentifiers(n) {
          if (n.type === "Identifier") {
            checkIdentifier(n.name);
          } else if (n.type === "TemplateLiteral") {
            for (const quasi of n.quasis) {
              if (quasi.value.raw.includes("SECURITY_PREAMBLE")) {
                hasDirectPreambleUsage = true;
              }
            }
            for (const expr of n.expressions) {
              extractIdentifiers(expr);
            }
          } else if (n.left) {
            extractIdentifiers(n.left);
          }
          if (n.right) {
            extractIdentifiers(n.right);
          }
        }
        extractIdentifiers(node);
      },
      Identifier(node) {
        if (node.name === "SECURITY_PREAMBLE") {
          const parent = node.parent;
          if (
            parent &&
            (parent.type === "BinaryExpression" ||
              parent.type === "TemplateLiteral")
          ) {
            hasDirectPreambleUsage = true;
          }
        }
      },
      "Program:exit"() {
        const hasValidSecurityPattern =
          hasPrependHelper ||
          (hasSecurityPreambleImport && hasDirectPreambleUsage);

        if (hasPromptBuilding && !hasValidSecurityPattern) {
          context.report({
            loc: {
              start: {
                line: promptLine > 0 ? promptLine : 1,
                column: 0,
              },
              end: {
                line: promptLine > 0 ? promptLine : 1,
                column: 0,
              },
            },
            messageId: "missing",
            data: {
              filename: normalised.split("/").pop() ?? normalised,
            },
          });
        }
      },
    };
  },
});

export default rule;
