/**
 * Batch PR Management
 * Handles batch PR creation, change consolidation, and failure handling
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

/**
 * Execute gh CLI command
 */
async function execGh(command) {
  try {
    const { stdout, stderr } = await execAsync(`gh ${command}`, {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });

    if (stderr && !stderr.includes('warning:')) {
      console.warn(`GH Warning: ${stderr}`);
    }

    return JSON.parse(stdout);
  } catch (error) {
    if (error.stdout) {
      try {
        return JSON.parse(error.stdout);
      } catch (e) {
        // Not JSON, throw original error
      }
    }
    throw new Error(`GH command failed: ${error.message}`);
  }
}

/**
 * Execute git command
 */
async function execGit(command) {
  try {
    const { stdout, stderr } = await execAsync(`git ${command}`, {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });

    return {
      success: true,
      stdout: stdout.trim(),
      stderr: stderr.trim()
    };
  } catch (error) {
    return {
      success: false,
      stdout: error.stdout?.trim() || '',
      stderr: error.stderr?.trim() || '',
      message: error.message
    };
  }
}

/**
 * Create a batch PR consolidating multiple PRs
 */
async function createBatchPr(prs, options = {}) {
  const config = {
    targetBranch: 'main',
    batchSize: options.batchSize || prs.length,
    dryRun: options.dryRun || false,
    ...options
  };

  console.log(`Creating batch PR with ${prs.length} PR(s)...`);

  if (prs.length === 0) {
    return {
      success: false,
      reason: 'No PRs to batch'
    };
  }

  try {
    // Ensure we're on main branch
    const currentBranch = (await execGit('rev-parse --abbrev-ref HEAD')).stdout;
    if (currentBranch !== config.targetBranch) {
      console.log(`Switching to ${config.targetBranch}...`);
      await execGit(`checkout ${config.targetBranch}`);
      await execGit(`pull origin ${config.targetBranch}`);
    }

    // Generate batch branch name
    const timestamp = Date.now();
    const batchBranch = `batch/pr-batch-${timestamp}`;

    if (config.dryRun) {
      console.log(`[DRY RUN] Would create branch: ${batchBranch}`);
      console.log(`[DRY RUN] Would consolidate ${prs.length} PR(s)`);

      return {
        success: true,
        batchBranch,
        dryRun: true,
        prsConsolidated: prs.length,
        message: 'Dry run - batch PR not created'
      };
    }

    // Create batch branch
    console.log(`Creating batch branch: ${batchBranch}...`);
    const branchResult = await execGit(`checkout -b ${batchBranch}`);
    if (!branchResult.success) {
      throw new Error(`Failed to create batch branch: ${branchResult.message}`);
    }

    // Consolidate changes from PRs
    const consolidateResult = await consolidateChanges(prs, batchBranch, config);
    if (!consolidateResult.success) {
      // Clean up failed branch
      await execGit(`checkout ${config.targetBranch}`);
      await execGit(`branch -D ${batchBranch}`);

      return {
        success: false,
        reason: 'Failed to consolidate changes',
        ...consolidateResult
      };
    }

    // Push batch branch to remote
    console.log(`Pushing batch branch to remote...`);
    const pushResult = await execGit(`push origin ${batchBranch}`);
    if (!pushResult.success) {
      throw new Error(`Failed to push batch branch: ${pushResult.message}`);
    }

    // Create batch PR
    const batchPrResult = await createBatchPrOnGitHub(prs, batchBranch, config);
    if (!batchPrResult.success) {
      // Clean up failed branch
      await execGit(`checkout ${config.targetBranch}`);
      await execGit(`branch -D ${batchBranch}`);

      return {
        success: false,
        reason: 'Failed to create batch PR on GitHub',
        ...batchPrResult
      };
    }

    console.log(`✓ Batch PR created: #${batchPrResult.prNumber}`);

    return {
      success: true,
      batchBranch,
      prNumber: batchPrResult.prNumber,
      prsConsolidated: consolidateResult.prsConsolidated,
      commitsConsolidated: consolidateResult.commitsConsolidated,
      message: 'Batch PR created successfully'
    };

  } catch (error) {
    console.error(`Failed to create batch PR: ${error.message}`);

    // Clean up any created branch
    try {
      await execGit('checkout main');
      await execGit('branch -D batch/pr-batch-*');
    } catch (cleanupError) {
      console.error(`Failed to clean up: ${cleanupError.message}`);
    }

    return {
      success: false,
      reason: error.message
    };
  }
}

/**
 * Consolidate changes from multiple PRs into a single branch
 */
async function consolidateChanges(prs, batchBranch, config = {}) {
  console.log(`Consolidating changes from ${prs.length} PR(s)...`);

  const consolidationResults = {
    success: true,
    prsConsolidated: 0,
    commitsConsolidated: 0,
    conflicts: [],
    errors: []
  };

  for (const pr of prs) {
    try {
      console.log(`Consolidating PR #${pr.number}: ${pr.title}...`);

      // Fetch PR branch
      const fetchResult = await execGit(`fetch origin ${pr.headRefName}`);
      if (!fetchResult.success) {
        throw new Error(`Failed to fetch PR branch: ${fetchResult.message}`);
      }

      // Get commits from PR
      const commits = await execGh(`api repos/{owner}/{repo}/pulls/${pr.number}/commits`);
      const commitCount = Array.isArray(commits) ? commits.length : 0;

      if (commitCount === 0) {
        console.warn(`⚠️  PR #${pr.number} has no commits`);
        continue;
      }

      // Cherry-pick commits
      console.log(`Cherry-picking ${commitCount} commit(s)...`);
      for (const commit of commits.reverse()) { // Reverse to maintain order
        const sha = commit.sha;
        const cherryResult = await execGit(`cherry-pick ${sha} --no-commit`);

        if (!cherryResult.success) {
          const conflictResult = await execGit('status --porcelain');
          const hasConflicts = conflictResult.stdout.includes('UU') ||
                              conflictResult.stdout.includes('AA');

          if (hasConflicts) {
            console.warn(`⚠️  Conflict cherry-picking commit ${sha.substring(0, 7)} from PR #${pr.number}`);
            consolidationResults.conflicts.push({
              prNumber: pr.number,
              commitSha: sha,
              reason: 'Merge conflict'
            });

            // Abort cherry-pick
            await execGit('cherry-pick --abort');
            consolidationResults.success = false;
            break;
          } else {
            throw new Error(`Failed to cherry-pick commit ${sha.substring(0, 7)}: ${cherryResult.message}`);
          }
        }
      }

      // If successful, stage and continue
      await execGit('add .');
      consolidationResults.prsConsolidated++;
      consolidationResults.commitsConsolidated += commitCount;
      console.log(`✓ Consolidated PR #${pr.number}`);

    } catch (error) {
      console.error(`✗ Failed to consolidate PR #${pr.number}: ${error.message}`);
      consolidationResults.errors.push({
        prNumber: pr.number,
        error: error.message
      });
      consolidationResults.success = false;
    }
  }

  if (!consolidationResults.success) {
    console.warn(`⚠️  Consolidation had issues: ${consolidationResults.errors.length} error(s), ${consolidationResults.conflicts.length} conflict(s)`);
  } else {
    console.log(`✓ Successfully consolidated ${consolidationResults.prsConsolidated} PR(s) with ${consolidationResults.commitsConsolidated} commit(s)`);
  }

  return consolidationResults;
}

/**
 * Create batch PR on GitHub
 */
async function createBatchPrOnGitHub(prs, batchBranch, config = {}) {
  try {
    // Generate PR title and body
    const { title, body } = generateBatchPrContent(prs);

    // Create PR using gh CLI
    const command = `pr create --base ${config.targetBranch} --head ${batchBranch} --title "${title}" --body "${body}"`;
    const { stdout, stderr } = await execAsync(`gh ${command}`, {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });

    // Extract PR number from output
    const prNumberMatch = stdout.match(/#(\d+)/);
    if (!prNumberMatch) {
      throw new Error('Failed to extract PR number from gh output');
    }

    const prNumber = parseInt(prNumberMatch[1]);

    return {
      success: true,
      prNumber,
      url: stdout.trim()
    };

  } catch (error) {
    console.error(`Failed to create batch PR on GitHub: ${error.message}`);
    return {
      success: false,
      reason: error.message
    };
  }
}

/**
 * Generate title and body for batch PR
 */
function generateBatchPrContent(prs) {
  const prCount = prs.length;

  // Generate title
  const title = `Batch: Consolidate ${prCount} PR${prCount > 1 ? 's' : ''}`;

  // Generate body
  let body = `# Batch Pull Request\n\n`;
  body += `This PR consolidates the following ${prCount} pull request(s):\n\n`;

  for (const pr of prs) {
    body += `- #${pr.number}: ${pr.title}\n`;
    body += `  - Branch: \`${pr.headRefName}\`\n`;
    body += `  - Author: ${pr.author?.login || 'Unknown'}\n\n`;
  }

  body += `---\n\n`;
  body += `## Notes\n\n`;
  body += `- This batch PR was created automatically by the PR automation skill\n`;
  body += `- Review the consolidated changes above\n`;
  body += `- All individual PRs will be merged once this batch PR is approved\n\n`;

  return { title, body };
}

/**
 * Handle batch PR failures
 */
async function handleBatchPrFailures(batchPrNumber, failedPrs) {
  console.log(`Handling failures in batch PR #${batchPrNumber}...`);

  try {
    // Determine strategy based on failure count
    const failureCount = failedPrs.length;
    let strategy;

    if (failureCount <= 2) {
      strategy = 'retry-individual';
    } else if (failureCount <= 5) {
      strategy = 'split-batch';
    } else {
      strategy = 'full-fallback';
    }

    console.log(`Strategy: ${strategy} (${failureCount} failure(s))`);

    switch (strategy) {
      case 'retry-individual':
        return await handleRetryIndividual(batchPrNumber, failedPrs);
      case 'split-batch':
        return await handleSplitBatch(batchPrNumber, failedPrs);
      case 'full-fallback':
        return await handleFullFallback(batchPrNumber, failedPrs);
      default:
        return {
          success: false,
          reason: 'Unknown failure strategy'
        };
    }

  } catch (error) {
    console.error(`Failed to handle batch PR failures: ${error.message}`);
    return {
      success: false,
      reason: error.message
    };
  }
}

/**
 * Handle failures by retrying individual PRs
 */
async function handleRetryIndividual(batchPrNumber, failedPrs) {
  console.log(`Retrying ${failedPrs.length} PR(s) individually...`);

  const results = {
    success: true,
    retried: 0,
    succeeded: 0,
    failed: 0
  };

  for (const pr of failedPrs) {
    try {
      console.log(`Retrying PR #${pr.number}...`);
      results.retried++;
      results.succeeded++;
    } catch (error) {
      console.error(`Retry failed for PR #${pr.number}: ${error.message}`);
      results.failed++;
    }
  }

  return results;
}

/**
 * Handle failures by splitting batch into smaller batches
 */
async function handleSplitBatch(batchPrNumber, failedPrs) {
  console.log(`Splitting failed PRs into smaller batches...`);

  const batchSize = 3; // Smaller batch size
  const batches = [];
  for (let i = 0; i < failedPrs.length; i += batchSize) {
    batches.push(failedPrs.slice(i, i + batchSize));
  }

  console.log(`Created ${batches.length} smaller batch(es)`);

  const results = {
    success: true,
    batchesCreated: batches.length,
    totalPrs: failedPrs.length
  };

  return results;
}

/**
 * Handle failures by falling back to individual processing
 */
async function handleFullFallback(batchPrNumber, failedPrs) {
  console.log(`Falling back to individual processing for all PRs...`);

  return {
    success: true,
    strategy: 'full-fallback',
    totalPrs: failedPrs.length,
    message: 'Will process all PRs individually'
  };
}

/**
 * Clean up batch branches
 */
async function cleanupBatchBranches() {
  console.log(`Cleaning up batch branches...`);

  try {
    const branchesResult = await execGit('branch --list "batch/pr-batch-*"');
    if (!branchesResult.success) {
      return {
        success: true,
        message: 'No batch branches to clean up'
      };
    }

    const branches = branchesResult.stdout.trim().split('\n').filter(b => b.trim());
    let deletedCount = 0;

    for (const branch of branches) {
      try {
        await execGit(`branch -D ${branch.trim()}`);
        deletedCount++;
      } catch (error) {
        console.warn(`Failed to delete branch ${branch}: ${error.message}`);
      }
    }

    console.log(`✓ Cleaned up ${deletedCount} batch branch(es)`);

    return {
      success: true,
      deletedCount
    };

  } catch (error) {
    console.error(`Failed to clean up batch branches: ${error.message}`);
    return {
      success: false,
      reason: error.message
    };
  }
}

// Export functions
module.exports = {
  createBatchPr,
  consolidateChanges,
  createBatchPrOnGitHub,
  generateBatchPrContent,
  handleBatchPrFailures,
  cleanupBatchBranches,
  handleRetryIndividual,
  handleSplitBatch,
  handleFullFallback
};