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

module.exports = OnnxNodeEnvironment;
