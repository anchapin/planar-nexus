/**
 * ESLint rule: require-security-preamble
 *
 * Ensures that all AI flow files (in src/ai/flows/) that BUILD system prompts
 * for LLM providers (generateText, streamText, etc.) include SECURITY_PREAMBLE.
 *
 * Files that RECEIVE system prompts as parameters (and pass them through to
 * LLM providers) are exempt because the caller is expected to include the preamble.
 *
 * Issue #2151: A developer could add a new AI flow without SECURITY_PREAMBLE,
 * creating a security vulnerability. This rule makes the preamble mandatory by
 * construction - any flow that builds its own system prompts must include the
 * buildSystemPrompt helper or directly include SECURITY_PREAMBLE.
 */

/** @type {any} */
const ruleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Enforce SECURITY_PREAMBLE in all AI flow files that build their own system prompts",
    },
    messages: {
      missingSecurityPreamble:
        "AI flow file '{{ fileName }}' appears to BUILD its own system prompt for an LLM provider " +
        "(generateText/streamText) but does not include SECURITY_PREAMBLE or " +
        "buildSystemPrompt. All AI flows that build prompts must include the security preamble to " +
        "prevent prompt injection attacks. " +
        "Import buildSystemPrompt from '@/ai/prompt-security' and use it to " +
        "build system prompts, or import SECURITY_PREAMBLE directly and prepend " +
        "it to your prompt strings.",
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    const filename = context.filename ?? "";

    // Only apply to AI flow files (exclude test files)
    if (!filename.includes("src/ai/flows/") || filename.includes("__tests__")) {
      return {};
    }

    // Get the file content
    const sourceCode = context.sourceCode ?? context.getSourceCode?.();
    if (!sourceCode) return {};

    const fileText = sourceCode.getText() ?? "";

    // Skip empty files
    if (!fileText.trim()) return {};

    // Check if file uses LLM providers
    // These are the primary ways to call LLMs in this codebase
    const usesLLMProvider =
      /\bgenerateText\s*\(/.test(fileText) ||
      /\bstreamText\s*\(/.test(fileText) ||
      /\bgenerate\s*\(/.test(fileText) ||
      /\bstream\s*\(/.test(fileText) ||
      // Also check for imports from coach-stream that wraps streamText
      /(?:streamCoachResponse|streamAIResponse)\s*\(/.test(fileText);

    if (!usesLLMProvider) {
      // File doesn't call LLM providers, no need to enforce preamble
      return {};
    }

    // Check if the file RECEIVES system prompt as a parameter
    // If so, the caller is responsible for including the preamble
    const receivesSystemPrompt =
      // Function parameters named 'system' or 'systemPrompt'
      /\bfunction\s+\w+\s*\([^)]*\bsystem[\[\],)]/.test(fileText) ||
      /\bfunction\s+\w+\s*\([^)]*\bsystemPrompt[\[\],)]/.test(fileText) ||
      // Arrow functions with system/systemPrompt parameter
      /\([^)]*\bsystem[\[\],)]/.test(fileText) ||
      /\([^)]*\bsystemPrompt[\[\],)]/.test(fileText) ||
      // TypeScript parameter properties: system: string
      /\bsystem\s*:\s*string/.test(fileText) ||
      /\bsystemPrompt\s*:\s*string/.test(fileText);

    if (receivesSystemPrompt) {
      // File receives system prompt from callers - caller is responsible for preamble
      return {};
    }

    // Check if file includes SECURITY_PREAMBLE or buildSystemPrompt
    const hasSecurityPreamble =
      /\bSECURITY_PREAMBLE\b/.test(fileText) ||
      /\bbuildSystemPrompt\b/.test(fileText) ||
      // Also accept inline preamble content
      /SECURITY RULES.*untrusted_/.test(fileText) ||
      /untrusted_.*SECURITY RULES/.test(fileText);

    if (!hasSecurityPreamble) {
      // Find the first node to report on
      let reportNode = sourceCode.ast;
      if (reportNode?.body?.length > 0) {
        reportNode = reportNode.body[0];
      }

      context.report({
        node: reportNode,
        messageId: "missingSecurityPreamble",
        data: {
          fileName: filename.split("/").pop() ?? filename,
        },
      });
    }

    return {};
  },
};

module.exports = ruleModule;
