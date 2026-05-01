/**
 * CI Monitoring Utilities
 * Handles GitHub Actions workflow status monitoring and validation
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// Default configuration
const DEFAULT_CONFIG = {
  pollInterval: 30000, // 30 seconds
  timeout: 1800000,    // 30 minutes
  workflowName: 'CI',
  requiredJobs: ['lint', 'typecheck', 'build']
};

/**
 * Execute gh CLI command and return parsed JSON
 */
async function execGh(command) {
  try {
    const { stdout, stderr } = await execAsync(`gh ${command}`, {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024 // 10MB buffer
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
        // If output isn't JSON, throw the original error
      }
    }
    throw new Error(`GH command failed: ${error.message}`);
  }
}

/**
 * Execute gh CLI command that returns non-JSON output (e.g., using --jq)
 */
async function execGhRaw(command) {
  try {
    const { stdout, stderr } = await execAsync(`gh ${command}`, {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024 // 10MB buffer
    });

    if (stderr && !stderr.includes('warning:')) {
      console.warn(`GH Warning: ${stderr}`);
    }

    return stdout.trim();
  } catch (error) {
    throw new Error(`GH command failed: ${error.message}`);
  }
}

/**
 * Get workflow runs for a specific workflow and branch
 */
async function getWorkflowRuns(workflowName = DEFAULT_CONFIG.workflowName, branch = null, limit = 10) {
  try {
    const filters = branch ? `--branch ${branch}` : '';
    const command = `run list --workflow="${workflowName}" --json databaseId,name,status,conclusion,headBranch,event,createdAt,url --limit ${limit} ${filters}`;
    return await execGh(command);
  } catch (error) {
    console.error(`Failed to get workflow runs: ${error.message}`);
    throw error;
  }
}

/**
 * Get workflow run details including job statuses
 */
async function getWorkflowRunDetails(runId) {
  try {
    const runInfo = await execGh(`run view ${runId} --json databaseId,name,status,conclusion,headBranch,event,createdAt,url`);

    // Get jobs using --jq - this returns newline-delimited JSON, not a JSON array
    const { stdout: jobsOutput } = await execAsync(
      `gh run view ${runId} --json jobs --jq '.jobs[] | {name: .name, status: .status, conclusion: .conclusion, databaseId: .databaseId}'`,
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
    );

    // Parse each line as a separate JSON object
    const jobs = jobsOutput.trim().split('\n').filter(line => line.trim()).map(line => JSON.parse(line));

    return {
      ...runInfo,
      jobs
    };
  } catch (error) {
    console.error(`Failed to get workflow run details: ${error.message}`);
    throw error;
  }
}

/**
 * Check if a workflow run is complete
 */
function isWorkflowComplete(runDetails) {
  return runDetails.status === 'completed';
}

/**
 * Check if a workflow run was successful
 */
function isWorkflowSuccessful(runDetails) {
  return runDetails.status === 'completed' && runDetails.conclusion === 'success';
}

/**
 * Wait for a workflow run to complete
 */
async function waitForWorkflowCompletion(runId, options = {}) {
  const config = {
    pollInterval: options.pollInterval || DEFAULT_CONFIG.pollInterval,
    timeout: options.timeout || DEFAULT_CONFIG.timeout,
    onProgress: options.onProgress || null,
    ...options
  };

  const startTime = Date.now();
  let pollCount = 0;

  console.log(`Waiting for workflow run ${runId} to complete...`);

  while (true) {
    pollCount++;
    const elapsed = Date.now() - startTime;

    // Check timeout
    if (elapsed > config.timeout) {
      throw new Error(`Workflow run ${runId} timed out after ${formatDuration(elapsed)}`);
    }

    // Get current status
    const runDetails = await getWorkflowRunDetails(runId);

    // Report progress
    if (config.onProgress) {
      config.onProgress(runDetails, elapsed, pollCount);
    }

    // Check if complete
    if (isWorkflowComplete(runDetails)) {
      console.log(`Workflow run ${runId} completed in ${formatDuration(elapsed)} (${pollCount} polls)`);
      return runDetails;
    }

    // Wait before next poll
    console.log(`Workflow status: ${runDetails.status} (${formatDuration(elapsed)} elapsed)...`);
    await sleep(config.pollInterval);
  }
}

/**
 * Poll workflow status at regular intervals
 */
async function pollWorkflowStatus(runId, timeout, interval, callback) {
  return waitForWorkflowCompletion(runId, {
    timeout,
    pollInterval: interval,
    onProgress: callback
  });
}

/**
 * Validate that required CI jobs passed for a PR
 */
async function validateCiChecks(prNumber, requiredJobs = DEFAULT_CONFIG.requiredJobs) {
  try {
    // Get the latest workflow run for the PR's branch
    const prData = await execGh(`pr view ${prNumber} --json headRefName`);
    const branchName = prData.headRefName;

    const runs = await getWorkflowRuns(DEFAULT_CONFIG.workflowName, branchName, 1);

    if (!runs || runs.length === 0) {
      return {
        valid: false,
        reason: 'No CI workflow runs found for this PR',
        jobs: {}
      };
    }

    const latestRun = runs[0];
    const runDetails = await getWorkflowRunDetails(latestRun.databaseId);

    // Check if workflow is complete
    if (!isWorkflowComplete(runDetails)) {
      return {
        valid: false,
        reason: 'CI workflow is still running',
        status: runDetails.status,
        jobs: {}
      };
    }

    // Check required jobs
    const jobResults = {};
    let allPassed = true;
    const failedJobs = [];
    const missingJobs = [];

    for (const jobName of requiredJobs) {
      const normalizedJobName = jobName.toLowerCase().replace(/\s+/g, '');
      const job = runDetails.jobs.find(j => j.name.toLowerCase().replace(/\s+/g, '') === normalizedJobName);

      if (!job) {
        missingJobs.push(jobName);
        jobResults[jobName] = {
          found: false,
          status: 'missing',
          conclusion: null
        };
        allPassed = false;
        continue;
      }

      const jobPassed = job.status === 'completed' && job.conclusion === 'success';
      jobResults[jobName] = {
        found: true,
        status: job.status,
        conclusion: job.conclusion,
        passed: jobPassed
      };

      if (!jobPassed) {
        failedJobs.push(jobName);
        allPassed = false;
      }
    }

    if (!allPassed) {
      let reason = 'CI checks failed';
      if (missingJobs.length > 0) {
        reason += `. Missing jobs: ${missingJobs.join(', ')}`;
      }
      if (failedJobs.length > 0) {
        reason += `. Failed jobs: ${failedJobs.join(', ')}`;
      }

      return {
        valid: false,
        reason,
        status: runDetails.status,
        conclusion: runDetails.conclusion,
        jobs: jobResults
      };
    }

    // All checks passed
    return {
      valid: true,
      reason: 'All CI checks passed',
      status: runDetails.status,
      conclusion: runDetails.conclusion,
      jobs: jobResults
    };

  } catch (error) {
    console.error(`Failed to validate CI checks for PR ${prNumber}: ${error.message}`);
    return {
      valid: false,
      reason: `Failed to validate CI checks: ${error.message}`,
      jobs: {}
    };
  }
}

/**
 * Get the latest workflow run for a branch
 */
async function getLatestWorkflowRun(branchName, workflowName = DEFAULT_CONFIG.workflowName) {
  const runs = await getWorkflowRuns(workflowName, branchName, 1);
  return runs && runs.length > 0 ? runs[0] : null;
}

/**
 * Monitor CI for a PR and wait for completion
 */
async function monitorPrCI(prNumber, options = {}) {
  try {
    const config = {
      requiredJobs: options.requiredJobs || DEFAULT_CONFIG.requiredJobs,
      pollInterval: options.pollInterval || DEFAULT_CONFIG.pollInterval,
      timeout: options.timeout || DEFAULT_CONFIG.timeout,
      onProgress: options.onProgress || null,
      ...options
    };

    console.log(`Monitoring CI for PR ${prNumber}...`);

    // Get PR branch
    const prData = await execGh(`pr view ${prNumber} --json headRefName`);
    const branchName = prData.headRefName;

    // Get latest workflow run
    let latestRun = await getLatestWorkflowRun(branchName);

    if (!latestRun) {
      return {
        valid: false,
        reason: 'No CI workflow runs found for this PR'
      };
    }

    // If already complete, return immediately
    if (isWorkflowComplete(latestRun)) {
      console.log(`CI for PR ${prNumber} already complete: ${latestRun.conclusion}`);
      return await validateCiChecks(prNumber, config.requiredJobs);
    }

    // Wait for completion
    const runDetails = await waitForWorkflowCompletion(latestRun.databaseId, {
      pollInterval: config.pollInterval,
      timeout: config.timeout,
      onProgress: config.onProgress
    });

    // Validate results
    return await validateCiChecks(prNumber, config.requiredJobs);

  } catch (error) {
    console.error(`Failed to monitor CI for PR ${prNumber}: ${error.message}`);
    return {
      valid: false,
      reason: `CI monitoring failed: ${error.message}`
    };
  }
}

/**
 * Format duration in milliseconds to human-readable string
 */
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

/**
 * Sleep for specified duration
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Export functions
module.exports = {
  getWorkflowRuns,
  getWorkflowRunDetails,
  waitForWorkflowCompletion,
  pollWorkflowStatus,
  validateCiChecks,
  getLatestWorkflowRun,
  monitorPrCI,
  isWorkflowComplete,
  isWorkflowSuccessful,
  DEFAULT_CONFIG
};