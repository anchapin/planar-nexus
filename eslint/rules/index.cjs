// @ts-check
/**
 * Custom ESLint plugin for Planar Nexus AI flows.
 *
 * Issue #2151: Enforce SECURITY_PREAMBLE in all AI flows
 *
 * This plugin ensures that all AI flow files that call LLM providers
 * include SECURITY_PREAMBLE to prevent prompt injection attacks.
 */
const requireSecurityPreambleRule = require("./require-security-preamble.cjs");

/** @type {import("eslint").FlatConfig.Plugin} */
const aiSecurityPlugin = {
  name: "ai",
  rules: {
    "require-security-preamble": requireSecurityPreambleRule,
  },
};

module.exports = { aiSecurityPlugin };
