import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "@playwright/test";

/**
 * The Easy manamind model in a real browser (#2557).
 *
 * Jest checks the exported model through onnxruntime-node. These tests cover
 * what only a browser can: that /simple-mode loads the opponent through the
 * bundled onnxruntime-web, and that onnxruntime-web's WASM backend reproduces
 * the logits manamind's Python host recorded in the replay fixture.
 */

const ROOT = join(__dirname, "..");
const ORT_DIST = join(ROOT, "node_modules", "onnxruntime-web", "dist");
const FIXTURE = join(
  ROOT,
  "src",
  "ai",
  "manamind",
  "__tests__",
  "fixtures",
  "simple_v1_replays.json",
);
const ORT_PREFIX = "/__e2e/ort/";

interface FixtureStep {
  obs: number[];
  logits?: number[];
}

function recordedSteps(): { obs: number[]; logits: number[] }[] {
  const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as {
    games: { steps: FixtureStep[] }[];
  };
  return fixture.games.flatMap((g) =>
    g.steps
      .filter((s): s is Required<FixtureStep> => Array.isArray(s.logits))
      .map((s) => ({ obs: s.obs, logits: s.logits })),
  );
}

test.describe("manamind simple-v1 in the browser", () => {
  test("simple mode loads the Easy opponent", async ({ page }) => {
    await page.goto("/simple-mode");
    await expect(
      page.getByRole("heading", { name: "Simple mode", level: 1 }),
    ).toBeVisible({ timeout: 60000 });
    await expect(page.getByText("Loading the Easy opponent…")).toBeHidden({
      timeout: 60000,
    });
    // Scope to the page's own error message: the app shell keeps a separate
    // role="alert" live region (the route announcer) mounted on every route.
    await expect(page.getByText(/Easy opponent couldn.t load/)).toHaveCount(0);
    await expect(page.getByTestId("simple-moves")).toBeVisible();
    await expect(page.getByTestId("simple-you-life")).toHaveText("20");
  });

  test("onnxruntime-web reproduces the Python host's logits", async ({
    page,
  }) => {
    test.setTimeout(120000);
    const steps = recordedSteps();
    expect(steps.length).toBeGreaterThan(200);

    // Serve onnxruntime-web's own WASM build from node_modules, so the check
    // runs the same package version the app bundles.
    await page.route(`**${ORT_PREFIX}*`, async (route) => {
      const name = new URL(route.request().url()).pathname.slice(
        ORT_PREFIX.length,
      );
      const contentType = name.endsWith(".wasm")
        ? "application/wasm"
        : "text/javascript";
      await route.fulfill({
        body: readFileSync(join(ORT_DIST, name)),
        contentType,
      });
    });

    await page.goto("/simple-mode");
    await page.addScriptTag({ url: `${ORT_PREFIX}ort.wasm.min.js` });

    const browserLogits = await page.evaluate(
      async ({ observations, prefix }) => {
        const ort = (
          window as unknown as { ort: typeof import("onnxruntime-web") }
        ).ort;
        ort.env.wasm.wasmPaths = prefix;
        ort.env.wasm.numThreads = 1;
        // Runs inside the page, where the app's safeFetch is not in scope.
        // eslint-disable-next-line no-restricted-syntax
        const response = await fetch("/models/manamind/simple-v1/model.onnx");
        const bytes = new Uint8Array(await response.arrayBuffer());
        const session = await ort.InferenceSession.create(bytes);
        const out: number[][] = [];
        for (const obs of observations) {
          const result = await session.run({
            observation: new ort.Tensor("float32", Float32Array.from(obs), [
              1,
              obs.length,
            ]),
          });
          out.push(Array.from(result.policy_logits.data as Float32Array));
        }
        return out;
      },
      { observations: steps.map((s) => s.obs), prefix: ORT_PREFIX },
    );

    expect(browserLogits).toHaveLength(steps.length);
    let maxDiff = 0;
    steps.forEach((step, i) => {
      step.logits.forEach((z, j) => {
        maxDiff = Math.max(maxDiff, Math.abs(browserLogits[i][j] - z));
      });
    });
    expect(maxDiff).toBeLessThan(1e-4);
  });
});
