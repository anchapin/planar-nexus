#!/usr/bin/env node

/**
 * PR Automation Main Orchestrator
 * Main entry point for PR review, fixing, CI monitoring, and merging
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// Import modules
const ciMonitor = require('./ci-monitor');
const conflictHandler = require('./conflict-handler');
const reviewIntegration = require('./review-integration');
const batchManager = require('./batch-manager');

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
      } catch (e) {}
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
 * Parse command-line arguments
 */
function parseArguments() {
  const args = process.argv.slice(2);
  const options = {
    maxParallel: 3,
    batchSize: 10,
    dryRun: false,
    interactive: false,
    noBatch: false,
    noReview: false,
    noSimplify: false,
    confirmMerges: false,
    noAutoMerge: false,
    requireApproval: false,
    mergeMethod: 'squash',
    verbose: false,
    noRollback: false,
    force: false,
    ciTimeout: 1800000,
    ciPollInterval: 30000,
    requiredJobs: ['lint', 'typecheck', 'build'],
    prFilter: null,
    maxAge: null,
    minAge: null,
    excludePrs: [],
    fallbackThreshold: 3
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--max-parallel': options.maxParallel = parseInt(args[++i]); break;
      case '--batch-size': options.batchSize = parseInt(args[++i]); break;
      case '--dry-run': options.dryRun = true; break;
      case '--interactive': options.interactive = true; break;
      case '--no-batch': options.noBatch = true; break;
      case '--no-review': options.noReview = true; break;
      case '--no-simplify': options.noSimplify = true; break;
      case '--confirm-merges': options.confirmMerges = true; break;
      case '--no-auto-merge': options.noAutoMerge = true; break;
      case '--require-approval': options.requireApproval = true; break;
      case '--merge-method': options.mergeMethod = args[++i]; break;
      case '--verbose': options.verbose = true; break;
      case '--no-rollback': options.noRollback = true; break;
      case '--force': options.force = true; break;
      case '--ci-timeout': options.ciTimeout = parseDuration(args[++i]); break;
      case '--ci-poll-interval': options.ciPollInterval = parseDuration(args[++i]); break;
      case '--required-jobs': options.requiredJobs = args[++i].split(','); break;
      case '--pr-filter': options.prFilter = args[++i]; break;
      case '--max-age': options.maxAge = parseDuration(args[++i]); break;
      case '--min-age': options.minAge = parseDuration(args[++i]); break;
      case '--exclude-prs': options.excludePrs = args[++i].split(',').map(n => parseInt(n)); break;
      case '--fallback-threshold': options.fallbackThreshold = parseInt(args[++i]); break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        console.error(`Unknown option: ${arg}`);
        console.error('Use --help for usage information');
        process.exit(1);
    }
  }

  return options;
}

/**
 * Parse duration string to milliseconds
 */
function parseDuration(duration) {
  const match = duration.match(/^(\d+)([smhd])$/);
  if (!match) throw new Error(`Invalid duration format: ${duration}`);

  const value = parseInt(match[1]);
  const unit = match[2];

  switch (unit) {
    case 's': return value * 1000;
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default: throw new Error(`Unknown duration unit: ${unit}`);
  }
}

/**
 * Print help information
 */
function printHelp() {
  console.log(`
PR Automation Skill
===================

Automates PR review, fixing, CI monitoring, and merging.

USAGE:
  /pr-automation [options]

OPTIONS:
  PR Selection:
    --pr-filter LABEL       Only process PRs with specific labels
    --max-age DURATION      Maximum age of PRs to process (e.g., 7d, 24h)
    --min-age DURATION      Minimum age of PRs to process
    --exclude-prs NUM1,NUM2 Comma-separated PR numbers to exclude

  Processing Strategy:
    --max-parallel N        Maximum number of PRs to process in parallel (default: 3)
    --batch-size N          Number of PRs per batch (default: 10)
    --no-batch              Skip batch processing, go directly to individual
    --fallback-threshold N  Number of batch failures before fallback (default: 3)

  Review Options:
    --no-review              Skip code review step
    --no-simplify            Skip simplify skill, use only custom checks

  CI Configuration:
    --ci-timeout DURATION    Maximum time to wait for CI (default: 30m)
    --ci-poll-interval       Polling interval for CI status (default: 30s)
    --required-jobs JOBS     Comma-separated CI job names (default: lint,typecheck,build)

  Merge Options:
    --no-auto-merge          Don't auto-merge, only prepare PRs
    --confirm-merges         Require confirmation before each merge
    --merge-method METHOD    Merge method: squash, merge, rebase (default: squash)
    --require-approval       Require PR approval before merging

  Automation and Safety:
    --dry-run                Simulate operations without making changes
    --interactive            Interactive mode with prompts
    --verbose                Verbose output
    --no-rollback            Disable rollback capability
    --force                  Force operations despite warnings

  Other:
    --help, -h               Show this help message

EXAMPLES:
  /pr-automation
  /pr-automation --max-parallel 5 --dry-run --interactive
  /pr-automation --pr-filter "ready-for-merge" --max-age 7d
  /pr-automation --ci-timeout 45m --confirm-merges
`);
}

/**
 * Main entry point
 */
async function main() {
  console.log('🚀 PR Automation Skill Started');
  console.log('=================================\n');

  const options = parseArguments();

  if (options.verbose) {
    console.log('Options:', JSON.stringify(options, null, 2));
    console.log('');
  }

  // Perform pre-flight checks
  const preflightResult = await runPreflightChecks(options);
  if (!preflightResult.success) {
    console.error(`❌ Preflight checks failed: ${preflightResult.reason}`);
    process.exit(1);
  }

  console.log('✓ Preflight checks passed\n');

  // Discover open PRs
  const prs = await discoverOpenPrs(options);
  console.log(`Found ${prs.length} open PR(s)\n`);

  if (prs.length === 0) {
    console.log('No PRs to process');
    process.exit(0);
  }

  // Display PRs
  console.log('PRs to process:');
  prs.forEach(pr => {
    console.log(`  #${pr.number}: ${pr.title} (${pr.headRefName})`);
  });
  console.log('');

  // Interactive mode confirmation
  if (options.interactive) {
    const shouldProceed = await promptConfirm('Proceed with PR automation?');
    if (!shouldProceed) {
      console.log('Aborted by user');
      process.exit(0);
    }
  }

  // Process PRs using hybrid strategy
  const startTime = Date.now();
  const result = await processPrsHybrid(prs, options);
  const duration = Date.now() - startTime;

  // Generate summary report
  await generateSummaryReport(result, duration, options);

  // Cleanup
  if (!options.noRollback && !options.dryRun) {
    console.log('\nCleaning up...');
    await batchManager.cleanupBatchBranches();
  }

  // Exit with appropriate code
  process.exit(result.success ? 0 : 1);
}

/**
 * Run pre-flight checks
 */
async function runPreflightChecks(options) {
  console.log('Running pre-flight checks...');

  try {
    // Check git repository
    const gitResult = await execGit('rev-parse --git-dir');
    if (!gitResult.success) {
      return { success: false, reason: 'Not a git repository' };
    }

    // Check gh CLI availability
    try {
      const { exec: nodeExec } = require('child_process');
      const { promisify: nodePromisify } = require('util');
      const nodeExecAsync = nodePromisify(nodeExec);
      await nodeExecAsync('gh --version');
    } catch (error) {
      return { success: false, reason: 'GitHub CLI (gh) not available' };
    }

    // Check current branch
    const currentBranch = (await execGit('rev-parse --abbrev-ref HEAD')).stdout;
    if (currentBranch !== 'main') {
      console.warn(`⚠️  Not on main branch (currently on ${currentBranch})`);
    }

    // Check for uncommitted changes
    const statusResult = await execGit('status --porcelain');
    if (statusResult.stdout.trim()) {
      if (!options.force) {
        return {
          success: false,
          reason: 'Working directory has uncommitted changes. Use --force to proceed.'
        };
      } else {
        console.warn('⚠️  Proceeding with uncommitted changes (--force)');
      }
    }

    return {
      success: true,
      checks: {
        git: true,
        ghCli: true,
        branch: currentBranch,
        cleanWorkingDir: statusResult.stdout.trim().length === 0
      }
    };

  } catch (error) {
    return { success: false, reason: error.message };
  }
}

/**
 * Discover open PRs
 */
async function discoverOpenPrs(options) {
  console.log('Discovering open PRs...');

  try {
    let command = 'pr list --state open --json number,title,headRefName,author,createdAt,labels';

    if (options.prFilter) {
      command += ` --label "${options.prFilter}"`;
    }

    const prs = await execGh(command);

    // Filter by age if specified
    let filteredPrs = prs;
    const now = Date.now();

    if (options.maxAge) {
      filteredPrs = filteredPrs.filter(pr => {
        const prAge = now - new Date(pr.createdAt).getTime();
        return prAge <= options.maxAge;
      });
    }

    if (options.minAge) {
      filteredPrs = filteredPrs.filter(pr => {
        const prAge = now - new Date(pr.createdAt).getTime();
        return prAge >= options.minAge;
      });
    }

    // Exclude specific PRs
    if (options.excludePrs.length > 0) {
      filteredPrs = filteredPrs.filter(pr => !options.excludePrs.includes(pr.number));
    }

    return filteredPrs;

  } catch (error) {
    console.error(`Failed to discover PRs: ${error.message}`);
    return [];
  }
}

/**
 * Process PRs using hybrid strategy
 */
async function processPrsHybrid(prs, options) {
  console.log('Starting hybrid PR processing...\n');

  const result = {
    success: true,
    strategyUsed: 'none',
    processed: 0,
    succeeded: 0,
    failed: 0,
    prsProcessed: [],
    errors: []
  };

  // Try batch approach first
  if (!options.noBatch && prs.length > 1) {
    console.log('📦 Attempting batch PR approach...\n');
    const batchResult = await processBatchPr(prs, options);

    if (batchResult.success) {
      result.strategyUsed = 'batch';
      result.processed = batchResult.processed;
      result.succeeded = batchResult.succeeded;
      result.failed = batchResult.failed;
      result.prsProcessed = batchResult.prsProcessed;
      return result;
    } else {
      console.log(`⚠️  Batch approach failed: ${batchResult.reason}`);
      console.log('Falling back to individual processing...\n');
      await batchManager.cleanupBatchBranches();
    }
  }

  // Fall back to individual processing
  console.log('🔄 Processing PRs individually...\n');
  const individualResult = await processPrsIndividually(prs, options);

  result.strategyUsed = 'individual';
  result.processed = individualResult.processed;
  result.succeeded = individualResult.succeeded;
  result.failed = individualResult.failed;
  result.prsProcessed = individualResult.prsProcessed;
  result.errors = individualResult.errors;

  return result;
}

/**
 * Process PRs as a batch
 */
async function processBatchPr(prs, options) {
  const result = {
    success: false,
    processed: 0,
    succeeded: 0,
    failed: 0,
    prsProcessed: [],
    reason: ''
  };

  try {
    console.log(`Creating batch PR with ${prs.length} PR(s)...`);
    const batchPrResult = await batchManager.createBatchPr(prs, {
      dryRun: options.dryRun,
      batchSize: options.batchSize
    });

    if (!batchPrResult.success) {
      result.reason = batchPrResult.reason || 'Failed to create batch PR';
      return result;
    }

    const batchPrNumber = batchPrResult.prNumber;
    console.log(`✓ Batch PR created: #${batchPrNumber}\n`);

    if (options.dryRun) {
      console.log('[DRY RUN] Skipping review and CI checks');
      result.success = true;
      result.processed = prs.length;
      result.succeeded = prs.length;
      result.prsProcessed = prs;
      return result;
    }

    // Run review on batch PR
    if (!options.noReview) {
      console.log('Running code review on batch PR...');
      const reviewResult = await runBatchReview(batchPrNumber, options);
      if (!reviewResult.success) {
        result.reason = `Review failed: ${reviewResult.reason}`;
        return result;
      }
    }

    // Monitor CI for batch PR
    console.log('Monitoring CI for batch PR...');
    const ciResult = await ciMonitor.monitorPrCI(batchPrNumber, {
      requiredJobs: options.requiredJobs,
      pollInterval: options.ciPollInterval,
      timeout: options.ciTimeout,
      onProgress: (runDetails, elapsed, pollCount) => {
        console.log(`  Status: ${runDetails.status} (${formatDuration(elapsed)} elapsed, ${pollCount} polls)`);
      }
    });

    if (!ciResult.valid) {
      result.reason = `CI checks failed: ${ciResult.reason}`;
      return result;
    }

    console.log('✓ All CI checks passed\n');

    // Merge batch PR
    if (!options.noAutoMerge) {
      console.log('Merging batch PR...');
      const mergeResult = await mergePr(batchPrNumber, options.mergeMethod, options);
      if (!mergeResult.success) {
        result.reason = `Merge failed: ${mergeResult.reason}`;
        return result;
      }
      console.log('✓ Batch PR merged\n');
    }

    // Merge individual source PRs
    console.log('Merging individual source PRs...');
    for (const pr of prs) {
      const mergeResult = await mergePr(pr.number, options.mergeMethod, options);
      if (mergeResult.success) {
        result.succeeded++;
        result.prsProcessed.push({
          number: pr.number,
          title: pr.title,
          status: 'merged'
        });
      } else {
        result.failed++;
        result.prsProcessed.push({
          number: pr.number,
          title: pr.title,
          status: 'failed',
          error: mergeResult.reason
        });
      }
      result.processed++;
    }

    result.success = result.failed === 0;
    return result;

  } catch (error) {
    result.reason = error.message;
    return result;
  }
}

/**
 * Process PRs individually
 */
async function processPrsIndividually(prs, options) {
  const result = {
    success: true,
    processed: 0,
    succeeded: 0,
    failed: 0,
    prsProcessed: [],
    errors: []
  };

  console.log(`Processing ${prs.length} PR(s) individually...\n`);

  for (const pr of prs) {
    console.log(`\nProcessing PR #${pr.number}: ${pr.title}`);
    console.log('='.repeat(50));

    const prResult = await processIndividualPr(pr, options);

    result.prsProcessed.push({
      number: pr.number,
      title: pr.title,
      ...prResult
    });

    if (prResult.status === 'merged') {
      result.succeeded++;
    } else if (prResult.status === 'failed') {
      result.failed++;
      result.success = false;
      if (prResult.error) {
        result.errors.push({
          prNumber: pr.number,
          error: prResult.error
        });
      }
    }

    result.processed++;
    console.log(`\nProgress: ${result.processed}/${prs.length} PR(s) processed`);
  }

  console.log(`\n✓ Completed processing: ${result.succeeded} merged, ${result.failed} failed`);

  return result;
}

/**
 * Process a single PR
 */
async function processIndividualPr(pr, options) {
  const result = {
    status: 'pending',
    error: null
  };

  try {
    if (options.dryRun) {
      console.log('[DRY RUN] Would process PR');
      return { status: 'dry-run' };
    }

    // Step 1: Check for merge conflicts
    console.log('Checking for merge conflicts...');
    const conflictResult = await conflictHandler.detectMergeConflicts(pr.headRefName, 'main');

    if (conflictResult.hasConflicts) {
      console.warn(`⚠️  Merge conflicts detected in ${conflictResult.conflictFiles.length} file(s)`);
      console.log(`Severity: ${conflictResult.severity}`);

      const resolutionResult = await conflictHandler.resolveConflicts(
        pr.headRefName,
        'main',
        { autoResolve: true }
      );

      if (!resolutionResult.success || resolutionResult.requiresManual) {
        console.error('✗ Cannot automatically resolve conflicts');
        return {
          status: 'failed',
          error: 'Merge conflicts require manual resolution',
          severity: conflictResult.severity,
          conflictFiles: conflictResult.conflictFiles
        };
      }
    }
    console.log('✓ No conflicts or conflicts resolved');

    // Step 2: Run code review
    if (!options.noReview) {
      console.log('\nRunning code review...');
      const reviewResult = await runPrReview(pr.number, options);
      if (!reviewResult.success) {
        console.warn(`⚠️  Review had issues: ${reviewResult.reason}`);
      }
    }

    // Step 3: Apply fixes
    if (!options.noReview) {
      console.log('\nApplying automated fixes...');
      const fixResult = await reviewIntegration.applyFixes(pr.number, []);
      if (!fixResult.success) {
        console.warn(`⚠️  Fix application had issues: ${fixResult.error}`);
      } else if (fixResult.total > 0) {
        console.log(`✓ Applied ${fixResult.total} automated fix(es)`);
      } else {
        console.log('✓ No fixes needed');
      }
    }

    // Step 4: Monitor CI
    console.log('\nMonitoring CI checks...');
    const ciResult = await ciMonitor.monitorPrCI(pr.number, {
      requiredJobs: options.requiredJobs,
      pollInterval: options.ciPollInterval,
      timeout: options.ciTimeout,
      onProgress: (runDetails, elapsed, pollCount) => {
        console.log(`  CI Status: ${runDetails.status} (${formatDuration(elapsed)} elapsed)`);
      }
    });

    if (!ciResult.valid) {
      console.error(`✗ CI checks failed: ${ciResult.reason}`);
      return {
        status: 'failed',
        error: `CI checks failed: ${ciResult.reason}`,
        ciResult
      };
    }
    console.log('✓ All CI checks passed');

    // Step 5: Merge PR
    if (!options.noAutoMerge) {
      console.log('\nMerging PR...');
      const mergeResult = await mergePr(pr.number, options.mergeMethod, options);

      if (!mergeResult.success) {
        console.error(`✗ Merge failed: ${mergeResult.reason}`);
        return {
          status: 'failed',
          error: mergeResult.reason
        };
      }
      console.log('✓ PR merged successfully');
    }

    return { status: options.noAutoMerge ? 'ready' : 'merged' };

  } catch (error) {
    console.error(`✗ Error processing PR: ${error.message}`);
    return {
      status: 'failed',
      error: error.message
    };
  }
}

/**
 * Run review on batch PR
 */
async function runBatchReview(prNumber, options) {
  try {
    if (options.noSimplify) {
      console.log('Skipping simplify skill (--no-simplify)');
    } else {
      const simplifyResult = await reviewIntegration.runSimplifyReview(prNumber, []);
      if (!simplifyResult.success) {
        console.warn(`Simplify review had issues: ${simplifyResult.error}`);
      }
    }

    const prChecks = await reviewIntegration.runPrSpecificChecks(prNumber);
    if (!prChecks.passed) {
      console.warn(`PR checks failed: ${prChecks.summary}`);
      for (const check of prChecks.failedChecks) {
        console.warn(`  - ${check.name}: ${check.reason}`);
      }
    }

    return {
      success: true,
      prChecks
    };

  } catch (error) {
    return {
      success: false,
      reason: error.message
    };
  }
}

/**
 * Run review on individual PR
 */
async function runPrReview(prNumber, options) {
  try {
    if (options.noSimplify) {
      console.log('Skipping simplify skill (--no-simplify)');
    } else {
      const simplifyResult = await reviewIntegration.runSimplifyReview(prNumber, []);
      if (simplifyResult.success) {
        console.log(`✓ Simplify review completed: ${simplifyResult.reviewSummary.filesReviewed} files reviewed`);
        for (const rec of simplifyResult.reviewSummary.recommendations) {
          console.log(`  - ${rec}`);
        }
      } else {
        console.warn(`Simplify review had issues: ${simplifyResult.error}`);
      }
    }

    const prChecks = await reviewIntegration.runPrSpecificChecks(prNumber);
    console.log(`✓ PR checks: ${prChecks.summary}`);

    if (!prChecks.passed) {
      console.warn('Failed checks:');
      for (const check of prChecks.failedChecks) {
        console.warn(`  - ${check.name}: ${check.reason}`);
      }
    }

    return {
      success: true,
      prChecks
    };

  } catch (error) {
    return {
      success: false,
      reason: error.message
    };
  }
}

/**
 * Merge a PR
 */
async function mergePr(prNumber, mergeMethod, options) {
  try {
    if (options.requireApproval) {
      const prData = await execGh(`pr view ${prNumber} --json reviewDecision`);
      if (prData.reviewDecision !== 'APPROVED') {
        return {
          success: false,
          reason: `PR not approved (reviewDecision: ${prData.reviewDecision})`
        };
      }
    }

    if (options.confirmMerges) {
      const shouldMerge = await promptConfirm(`Merge PR #${prNumber}?`);
      if (!shouldMerge) {
        return {
          success: false,
          reason: 'Merge cancelled by user'
        };
      }
    }

    const command = `pr merge ${prNumber} --${mergeMethod} --delete-branch`;
    const { stdout, stderr } = await execAsync(`gh ${command}`, {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });

    if (stderr && !stderr.includes('warning:')) {
      console.warn(`Merge warning: ${stderr}`);
    }

    return {
      success: true,
      message: stdout.trim()
    };

  } catch (error) {
    return {
      success: false,
      reason: error.message
    };
  }
}

/**
 * Generate summary report
 */
async function generateSummaryReport(result, duration, options) {
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║                  PR AUTOMATION SUMMARY                    ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');

  console.log(`Strategy: ${result.strategyUsed.toUpperCase()}`);
  console.log(`Duration: ${formatDuration(duration)}`);
  console.log(`Mode: ${options.dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log('');

  console.log(`Processed: ${result.processed} PR(s)`);
  console.log(`Succeeded: ${result.succeeded} PR(s)`);
  console.log(`Failed: ${result.failed} PR(s)`);
  console.log('');

  if (result.prsProcessed.length > 0) {
    console.log('Details:');
    result.prsProcessed.forEach(pr => {
      const statusIcon = {
        'merged': '✓',
        'ready': '→',
        'failed': '✗',
        'dry-run': '○'
      }[pr.status] || '?';

      console.log(`  ${statusIcon} #${pr.number}: ${pr.title}`);
      console.log(`     Status: ${(pr.status || 'unknown').toUpperCase()}`);
      if (pr.error) {
        console.log(`     Error: ${pr.error}`);
      }
      console.log('');
    });
  }

  if (result.errors.length > 0) {
    console.log('Errors:');
    result.errors.forEach(err => {
      console.log(`  - PR #${err.prNumber}: ${err.error}`);
    });
    console.log('');
  }

  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║                   PROCESSING COMPLETE                     ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
}

/**
 * Prompt user for confirmation
 */
async function promptConfirm(message) {
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(`${message} [y/N]: `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
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

// Run main function
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

// Export for testing
module.exports = {
  main,
  parseArguments,
  runPreflightChecks,
  discoverOpenPrs,
  processPrsHybrid,
  processBatchPr,
  processPrsIndividually,
  processIndividualPr,
  mergePr,
  generateSummaryReport
};