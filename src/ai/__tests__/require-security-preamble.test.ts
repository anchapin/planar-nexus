// @ts-check
import { RuleTester } from "@typescript-eslint/utils/ts-eslint";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const requireSecurityPreambleRule = require("../../../eslint/rules/require-security-preamble.cjs");

const ruleTester = new RuleTester();

describe("require-security-preamble rule (issue #2151)", () => {
  ruleTester.run("require-security-preamble", requireSecurityPreambleRule, {
    valid: [
      // Flow file that uses generateText WITH SECURITY_PREAMBLE
      {
        filename: "src/ai/flows/secure-flow.ts",
        code: `
            import { generateText } from "ai";
            import { SECURITY_PREAMBLE } from "@/ai/prompt-security";

            export async function askAI() {
              const result = await generateText({
                system: SECURITY_PREAMBLE + " You are a helpful assistant.",
                prompt: "Hello",
              });
              return result;
            }
          `,
      },
      // Flow file that uses buildSystemPrompt
      {
        filename: "src/ai/flows/secure-flow-2.ts",
        code: `
            import { generateText } from "ai";
            import { buildSystemPrompt } from "@/ai/prompt-security";

            export async function askAI() {
              const result = await generateText({
                system: buildSystemPrompt("You are a helpful assistant."),
                prompt: "Hello",
              });
              return result;
            }
          `,
      },
      // Flow file that doesn't call LLM providers (no preamble needed)
      {
        filename: "src/ai/flows/heuristic-flow.ts",
        code: `
            export function heuristicAnalysis(input) {
              return input.toUpperCase();
            }
          `,
      },
      // Flow file outside src/ai/flows/ - should pass even without preamble
      {
        filename: "src/components/my-component.tsx",
        code: `
            import { generateText } from "ai";
            export async function askAI() {
              const result = await generateText({
                system: "No preamble needed here",
                prompt: "Hello",
              });
              return result;
            }
          `,
      },
    ],
    invalid: [
      // Flow file that uses generateText WITHOUT SECURITY_PREAMBLE
      {
        filename: "src/ai/flows/insecure-flow.ts",
        code: `
            import { generateText } from "ai";

            export async function askAI() {
              const result = await generateText({
                system: "You are a helpful assistant.",
                prompt: "Hello",
              });
              return result;
            }
          `,
        errors: [{ messageId: "missingSecurityPreamble" }],
      },
      // Flow file that uses streamText WITHOUT SECURITY_PREAMBLE
      {
        filename: "src/ai/flows/insecure-stream.ts",
        code: `
            import { streamText } from "ai";

            export async function askAI() {
              const result = await streamText({
                system: "You are a helpful assistant.",
                prompt: "Hello",
              });
              return result;
            }
          `,
        errors: [{ messageId: "missingSecurityPreamble" }],
      },
    ],
  });
});
