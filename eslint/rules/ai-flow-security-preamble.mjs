/**
 * ESLint rule for issue #2151: SECURITY_PREAMBLE must be imported in all AI
 * flow files that build LLM prompts. Prevents prompt injection attacks by
 * ensuring every prompt builder prepends the preamble.
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
        "AI flow '{{ filename }}' builds an LLM prompt but does not import " +
        "SECURITY_PREAMBLE from '@/ai/prompt-security'. " +
        "Add: import { SECURITY_PREAMBLE } from '@/ai/prompt-security'; " +
        "and prepend it to every prompt string to prevent prompt injection.",
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

    let hasSecurityPreamble = false;
    let hasPromptBuilding = false;
    let promptLine = 0;

    function checkString(str, line) {
      if (/You are\s/i.test(str)) {
        hasPromptBuilding = true;
        if (promptLine === 0) promptLine = line;
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
              spec.imported.type === "Identifier" &&
              spec.imported.name === "SECURITY_PREAMBLE"
            ) {
              hasSecurityPreamble = true;
            }
          }
        }
      },
      TemplateLiteral(node) {
        if (hasPromptBuilding) return;
        for (const quasi of node.quasis) {
          checkString(quasi.value.raw, quasi.loc?.start.line ?? 0);
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
        const left = src.getText(node.left);
        const right = src.getText(node.right);
        checkString(left + right, node.loc?.start.line ?? 0);
      },
      "Program:exit"() {
        if (hasPromptBuilding && !hasSecurityPreamble) {
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
