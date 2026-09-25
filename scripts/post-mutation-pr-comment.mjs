#!/usr/bin/env node
/**
 * Post or update a PR comment with the mutation score for a rules-engine module.
 *
 * Called as the final step of `.github/workflows/mutation-pr.yml` after
 * `scripts/extract-mutation-score.mjs` has populated the score and status
 * via GITHUB_OUTPUT.
 *
 * Logic:
 *   - Fetch the PR node ID from `gh pr view --json id`
 *   - Find existing comment from "github-actions[bot]" on this PR
 *     (identified by the "## Mutation Score (<module>)" heading).
 *   - Update existing comment, or create a new one.
 *
 * The comment is informational only. This workflow is NON-BLOCKING:
 *   .github/workflows/mutation-pr.yml does NOT add the job to ci.yml's
 *   `build.needs`, so a low score does not prevent PR merge.
 *
 * Usage:
 *   node scripts/post-mutation-pr-comment.mjs
 *
 * Required env vars (set by mutation-pr.yml):
 *   GITHUB_TOKEN       — GITHUB_TOKEN secret (read by `gh`)
 *   MUTATION_SCORE     — score string, e.g. "56.5" (empty if timeout/error)
 *   MUTATION_STATUS    — "pass" | "fail" | "timeout" | "error"
 *   MUTATION_DETECTED  — number of detected mutants (string)
 *   MUTATION_CONSIDERED— number of counted mutants (string)
 *   MUTATION_BELOW_FLOOR — "true" | "false"
 *   PR_NUMBER          — pull request number
 *   TARGET_BRANCH      — base branch name (e.g. "main")
 *   MODULE_NAME        — module name, e.g. "layer-system", "combat"
 */

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { env } from "node:process";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const FLOOR_CONFIG = require(join(REPO_ROOT, "scripts", "mutation-floor.config.js"));

const {
  GITHUB_TOKEN,
  MUTATION_SCORE,
  MUTATION_STATUS,
  MUTATION_DETECTED,
  MUTATION_CONSIDERED,
  MUTATION_BELOW_FLOOR,
  PR_NUMBER,
  TARGET_BRANCH,
  MODULE_NAME = "layer-system",
} = env;

const FLOOR_MAP = {
  "layer-system": "src/lib/game-state/layer-system.ts",
  combat: "src/lib/game-state/combat.ts",
  mana: "src/lib/game-state/mana.ts",
  "trigger-system": "src/lib/game-state/trigger-system.ts",
  "replacement-effects": "src/lib/game-state/replacement-effects.ts",
  "spell-casting": "src/lib/game-state/spell-casting",
  "state-based-actions": "src/lib/game-state/state-based-actions.ts",
};

const FLOOR_KEY = FLOOR_MAP[MODULE_NAME];
const FLOOR =
  FLOOR_KEY && FLOOR_CONFIG.floors?.[FLOOR_KEY]
    ? FLOOR_CONFIG.floors[FLOOR_KEY]
    : FLOOR_CONFIG.defaultFloor ?? 55;

/**
 * Run `gh` with auth and return stdout, or empty string on failure.
 */
function gh(args) {
  try {
    return execSync(`gh ${args}`, {
      encoding: "utf8",
      env: { ...env, GITHUB_TOKEN },
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    console.error(`gh ${args}: ${err.message}`);
    return "";
  }
}

/**
 * Build the Markdown body for the score comment.
 */
function buildBody(score, status, detected, considered, belowFloor) {
  const now = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";

  let badge;
  if (status === "pass") {
    badge = "🟢 Pass";
  } else if (status === "fail") {
    badge = "🔴 Below floor";
  } else if (status === "timeout") {
    badge = "⏱️ Timed out";
  } else {
    badge = "⚠️ Error";
  }

  const scoreDisplay =
    score !== "" ? `${parseFloat(score).toFixed(1)}%` : "_not available_";

  const detail =
    status === "pass" || status === "fail"
      ? `| ${detected}/${considered} mutants detected |\n`
      : "";

  return `## Mutation Score (${MODULE_NAME}) — info only

| | |
| --- | --- |
| **Status** | ${badge} |
| **Score** | ${scoreDisplay} |
| **Floor** | ${FLOOR}% |
${detail}| **Generated** | ${now} |

${belowFloor === "true" && status === "fail" ? `⚠️ **Below floor** — the ${MODULE_NAME} score is under the ${FLOOR}% threshold. A full score will be reported by the nightly mutation run. Consider running \`npm run mutate:${MODULE_NAME}\` locally to investigate.\n` : ""}${status === "timeout" ? `⏱️ Stryker timed out after 2 minutes (the per-PR informational window). The full score will be reported by the nightly mutation run. If you need an immediate score, run \`npm run mutate:${MODULE_NAME}\` locally.\n` : ""}

> ⚠️ **This comment is informational only.** The mutation score does NOT gate PR merge. Full mutation coverage (all allowlisted rules-engine modules) runs nightly in [\`.github/workflows/mutation.yml\`](https://github.com/anchapin/planar-nexus/blob/main/.github/workflows/mutation.yml).`;
}

async function main() {
  if (!PR_NUMBER) {
    console.error("post-mutation-pr-comment: PR_NUMBER not set");
    return;
  }

  const body = buildBody(
    MUTATION_SCORE ?? "",
    MUTATION_STATUS ?? "error",
    MUTATION_DETECTED ?? "0",
    MUTATION_CONSIDERED ?? "0",
    MUTATION_BELOW_FLOOR ?? "false",
  );

  // Get PR node ID
  const prView = gh(`pr view ${PR_NUMBER} --json id --jq '.id'`);
  if (!prView) {
    console.error(`post-mutation-pr-comment: could not fetch PR #${PR_NUMBER}`);
    return;
  }

  // Find existing comment from github-actions[bot] with our heading
  const commentsRaw = gh(
    `api graphql -f query='
      query($prId: ID!) {
        node(id: $prId) {
          ... on PullRequest {
            comments(first: 50) {
              nodes {
                id
                body
                author { login }
              }
            }
          }
        }
      }
    ' -f prId=${prView}`,
  );

  let existingCommentId = "";
  try {
    const data = JSON.parse(commentsRaw);
    const comments =
      data?.data?.node?.comments?.nodes ?? [];
    for (const c of comments) {
      if (
        c.author?.login === "github-actions[bot]" &&
        c.body?.includes(`Mutation Score (${MODULE_NAME})`)
      ) {
        existingCommentId = c.id;
        break;
      }
    }
  } catch (err) {
    console.error("post-mutation-pr-comment: failed to parse comments:", err.message);
  }

  if (existingCommentId) {
    // Update existing comment
    gh(
      `api graphql -f query='
        mutation {
          updatePullRequestComment(input: {body: $body, commentId: $id}) {
            comment { id }
          }
        }
      ' -f body='${body.replace(/'/g, "'\"'\"'")}' -f id='${existingCommentId}'`,
    );
    console.log(
      `post-mutation-pr-comment: updated comment ${existingCommentId} on PR #${PR_NUMBER}`,
    );
  } else {
    // Create new comment
    gh(
      `api graphql -f query='
        mutation {
          addPullRequestComment(input: {body: $body, pullRequestId: $prId}) {
            comment { id }
          }
        }
      ' -f body='${body.replace(/'/g, "'\"'\"'")}' -f prId='${prView}'`,
    );
    console.log(
      `post-mutation-pr-comment: created comment on PR #${PR_NUMBER}`,
    );
  }
}

main();
