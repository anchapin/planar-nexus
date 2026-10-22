/**
 * Jest's node environment with the host realm's typed arrays (#2557).
 *
 * onnxruntime-node hands back output tensors built from the host realm's
 * Float32Array, and onnxruntime-common checks them with `instanceof` against
 * the test sandbox's Float32Array, which is a different constructor (Jest
 * issue #2549). Sharing the host constructors makes the check pass.
 */
/* global require, module */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- Jest loads environments as CommonJS
const { TestEnvironment } = require("jest-environment-node");

class OnnxNodeEnvironment extends TestEnvironment {
  constructor(config, context) {
    super(config, context);
    for (const name of [
      "ArrayBuffer",
      "Float32Array",
      "Float64Array",
      "Int32Array",
      "Uint8Array",
      "BigInt64Array",
    ]) {
      this.global[name] = globalThis[name];
    }
  }
}

// Stryker's coverageAnalysis "perTest" needs every test file to report coverage,
// and it only does that for environments it wraps with `mixinJestEnvironment`
// (#2646: the Mutation Testing nightly aborted with "Missing coverage results"
// for every file using this environment). The mixin is required lazily so a
// plain `npm test` still works when Stryker is not installed.
let Environment = OnnxNodeEnvironment;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Stryker is an optional dependency here
  const { mixinJestEnvironment } = require("@stryker-mutator/jest-runner");
  Environment = mixinJestEnvironment(OnnxNodeEnvironment);
} catch {
  // Stryker not present (normal test runs) — use the environment as-is.
}

module.exports = Environment;
