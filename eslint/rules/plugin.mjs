/**
 * Custom ESLint plugin for Planar Nexus AI flow security rules.
 * Currently exports the ai-flow-security-preamble rule.
 */
import securityPreambleRule from "./ai-flow-security-preamble.mjs";

const plugin = {
  meta: {
    name: "@planar-nexus/ai-security",
    version: "1.0.0",
  },
  rules: {
    "ai-flow-security-preamble": securityPreambleRule,
  },
  configs: {},
};

export default plugin;
