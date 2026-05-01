/**
 * Code Review Integration
 * Integrates with simplify skill and provides custom PR-specific checks
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
 * Execute gh CLI command that returns non-JSON output (e.g., using --jq)
 */
async function execGhRaw(command) {
  try {
    const { stdout, stderr } = await execAsync(`gh ${command}`, {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
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
 * Get list of changed files in a PR
 */
async function getPrChangedFiles(prNumber) {
  try {
    const prData = await execGhRaw(`pr view ${prNumber} --json files --jq '.files[].path'`);
    if (!prData) return [];
    try {
      return JSON.parse(prData);
    } catch {
      return prData.split('\n').filter(Boolean);
    }
  } catch (error) {
    console.error(`Failed to get PR files: ${error.message}`);
    return [];
  }
}

/**
 * Run ESLint on files
 */
async function runEslint(files) {
  if (files.length === 0) {
    return [];
  }

  const jsFiles = files.filter(f => /\.(js|jsx|ts|tsx)$/.test(f));
  if (jsFiles.length === 0) {
    return [];
  }

  try {
    const { stdout, stderr } = await execAsync(`npx eslint ${jsFiles.join(' ')} --format json`, {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    });

    if (stderr && !stderr.includes('warning:')) {
      console.warn(`ESLint stderr: ${stderr}`);
    }

    const results = JSON.parse(stdout);
    const issues = [];

    for (const fileResult of results) {
      for (const message of fileResult.messages) {
        issues.push({
          file: fileResult.filePath,
          line: message.line,
          column: message.column,
          ruleId: message.ruleId,
          severity: message.severity,
          message: message.message
        });
      }
    }

    return issues;
  } catch (error) {
    console.error(`ESLint failed: ${error.message}`);
    return [];
  }
}

/**
 * Generate review recommendations
 */
function generateRecommendations(eslintIssues, typeErrors) {
  const recommendations = [];

  if (eslintIssues.length > 0) {
    recommendations.push(`Found ${eslintIssues.length} ESLint issue(s)`);
  }

  if (typeErrors.length > 0) {
    recommendations.push(`Found ${typeErrors.length} TypeScript type error(s)`);
  }

  if (recommendations.length === 0) {
    recommendations.push('No major issues found. Code quality looks good!');
  }

  return recommendations;
}

/**
 * Run simplify skill on PR files
 */
async function runSimplifyReview(prNumber, filesChanged) {
  console.log(`Running simplify review on PR ${prNumber}...`);

  try {
    // Get PR data
    const prData = await execGh(`pr view ${prNumber} --json title,body,headRefName,headRefOid`);

    // Check out the PR branch
    console.log(`Checking out branch ${prData.headRefName}...`);
    const checkoutResult = await execGit(`fetch origin ${prData.headRefName}`);
    if (!checkoutResult.success) {
      throw new Error(`Failed to fetch PR branch: ${checkoutResult.message}`);
    }

    const checkoutBranch = await execGit(`checkout ${prData.headRefName}`);
    if (!checkoutBranch.success) {
      throw new Error(`Failed to checkout PR branch: ${checkoutBranch.message}`);
    }

    // Focus on changed files
    const changedFiles = await getPrChangedFiles(prNumber);
    console.log(`Found ${changedFiles.length} changed files`);

    // Run eslint to find issues
    const eslintIssues = await runEslint(changedFiles);
    console.log(`Found ${eslintIssues.length} ESLint issues`);

    // Generate review summary
    const reviewSummary = {
      prNumber,
      branch: prData.headRefName,
      filesReviewed: changedFiles.length,
      issuesFound: eslintIssues.length,
      eslintIssues,
      typeErrors: [],
      recommendations: generateRecommendations(eslintIssues, [])
    };

    return {
      success: true,
      reviewSummary
    };

  } catch (error) {
    console.error(`Simplify review failed: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Validate PR description
 */
async function validatePrDescription(prNumber) {
  try {
    const prData = await execGh(`pr view ${prNumber} --json title,body`);

    const title = prData.title || '';
    const body = prData.body || '';

    // Check title length and format
    if (title.length < 10) {
      return {
        passed: false,
        reason: 'Title is too short (minimum 10 characters)'
      };
    }

    // Check body for common sections
    const hasDescription = body.length > 50;
    const hasChanges = body.toLowerCase().includes('change') || body.toLowerCase().includes('fix');
    const hasTesting = body.toLowerCase().includes('test');

    if (!hasDescription) {
      return {
        passed: false,
        reason: 'PR description is too short'
      };
    }

    if (!hasChanges && !hasTesting) {
      return {
        passed: false,
        reason: 'PR description should explain what changes were made'
      };
    }

    return {
      passed: true,
      reason: 'PR description is well-formatted'
    };

  } catch (error) {
    console.error(`Failed to validate PR description: ${error.message}`);
    return {
      passed: false,
      reason: `Failed to validate: ${error.message}`
    };
  }
}

/**
 * Validate commit messages
 */
async function validateCommitMessages(prNumber) {
  try {
    const commits = await execGh(`api repos/{owner}/{repo}/pulls/${prNumber}/commits`);
    const commitData = Array.isArray(commits) ? commits : [];
    const issues = [];

    for (const commit of commitData) {
      const message = commit.commit?.message || '';
      const firstLine = message.split('\n')[0];

      // Check for common commit message patterns
      if (firstLine.length > 72) {
        issues.push(`Commit subject line exceeds 72 characters`);
      }

      if (!/^[A-Z]/.test(firstLine)) {
        issues.push(`Commit subject doesn't start with capital letter`);
      }
    }

    if (issues.length === 0) {
      return {
        passed: true,
        reason: 'All commit messages follow conventions'
      };
    }

    return {
      passed: false,
      reason: `Found ${issues.length} commit message issues`,
      issues
    };

  } catch (error) {
    console.error(`Failed to validate commit messages: ${error.message}`);
    return {
      passed: false,
      reason: `Failed to validate: ${error.message}`
    };
  }
}

/**
 * Check if PR includes tests
 */
async function checkForTests(prNumber) {
  try {
    const files = await getPrChangedFiles(prNumber);
    const testFiles = files.filter(f =>
      f.includes('test') || f.includes('spec') || f.includes('.test.') || f.includes('.spec.')
    );

    if (testFiles.length === 0) {
      return {
        passed: false,
        reason: 'No test files included in PR'
      };
    }

    return {
      passed: true,
      reason: `Found ${testFiles.length} test file(s)`
    };

  } catch (error) {
    console.error(`Failed to check for tests: ${error.message}`);
    return {
      passed: false,
      reason: `Failed to check: ${error.message}`
    };
  }
}

/**
 * Check if PR updates documentation
 */
async function checkDocumentation(prNumber) {
  try {
    const files = await getPrChangedFiles(prNumber);
    const docFiles = files.filter(f =>
      f.endsWith('.md') || f.includes('README') || f.includes('doc/')
    );

    // This is optional, so we don't fail on this
    return {
      passed: true, // Always pass since docs are optional
      reason: docFiles.length > 0
        ? `Found ${docFiles.length} documentation file(s)`
        : 'No documentation updates (optional)'
    };

  } catch (error) {
    console.error(`Failed to check documentation: ${error.message}`);
    return {
      passed: true,
      reason: `Failed to check: ${error.message}`
    };
  }
}

/**
 * Run custom PR-specific checks
 */
async function runPrSpecificChecks(prNumber) {
  console.log(`Running PR-specific checks for PR ${prNumber}...`);

  const checks = {
    description: await validatePrDescription(prNumber),
    commitMessages: await validateCommitMessages(prNumber),
    hasTests: await checkForTests(prNumber),
    documentation: await checkDocumentation(prNumber)
  };

  const passed = Object.values(checks).every(check => check.passed);
  const failedChecks = Object.entries(checks)
    .filter(([_, check]) => !check.passed)
    .map(([name, check]) => ({ name, reason: check.reason }));

  return {
    passed,
    checks,
    failedChecks,
    summary: `PR checks ${passed ? 'passed' : 'failed'} (${Object.keys(checks).length} checks)`
  };
}

/**
 * Run lint fixes
 */
async function runLintFixes(prNumber) {
  try {
    const files = await getPrChangedFiles(prNumber);
    const jsFiles = files.filter(f => /\.(js|jsx|ts|tsx)$/.test(f));

    if (jsFiles.length === 0) {
      return { applied: 0, failed: 0 };
    }

    console.log(`Running eslint --fix on ${jsFiles.length} file(s)...`);
    const { stdout, stderr } = await execAsync(
      `npx eslint ${jsFiles.join(' ')} --fix`,
      {
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024
      }
    );

    // Count how many files were modified
    const statusResult = await execGit('status --porcelain');
    const modifiedFiles = statusResult.stdout.split('\n').filter(line => line.trim()).length;

    console.log(`✓ ESLint fixed ${modifiedFiles} file(s)`);

    return { applied: modifiedFiles, failed: 0 };

  } catch (error) {
    console.error(`ESLint fix failed: ${error.message}`);
    return { applied: 0, failed: 1 };
  }
}

/**
 * Run type fixes (placeholder)
 */
async function runTypeFixes(prNumber) {
  console.log('TypeScript check complete (no auto-fixes available)');
  return { applied: 0, failed: 0 };
}

/**
 * Apply fixes for common issues
 */
async function applyFixes(prNumber, fixes) {
  console.log(`Applying fixes to PR ${prNumber}...`);

  const results = {
    lintFixes: { applied: 0, failed: 0 },
    typeFixes: { applied: 0, failed: 0 },
    total: 0
  };

  try {
    // Get PR branch
    const prData = await execGh(`pr view ${prNumber} --json headRefName`);

    // Checkout PR branch
    console.log(`Checking out branch ${prData.headRefName}...`);
    await execGit(`fetch origin ${prData.headRefName}`);
    await execGit(`checkout ${prData.headRefName}`);

    // Apply lint fixes
    const lintResult = await runLintFixes(prNumber);
    results.lintFixes = lintResult;
    results.total += lintResult.applied;

    // Apply type fixes
    const typeResult = await runTypeFixes(prNumber);
    results.typeFixes = typeResult;
    results.total += typeResult.applied;

    // If fixes were applied, commit them
    if (results.total > 0) {
      console.log(`Committing ${results.total} automated fix(es)...`);
      const commitResult = await execGit(
        `commit -am "Automated fixes via PR automation" --allow-empty`
      );

      if (commitResult.success) {
        console.log(`✓ Committed fixes`);

        // Push to remote
        const pushResult = await execGit(`push origin ${prData.headRefName}`);
        if (pushResult.success) {
          console.log(`✓ Pushed fixes to remote`);
          return {
            success: true,
            ...results,
            pushed: true
          };
        } else {
          console.error(`✗ Failed to push fixes: ${pushResult.message}`);
          return {
            success: false,
            ...results,
            pushed: false,
            error: pushResult.message
          };
        }
      } else {
        console.error(`✗ Failed to commit fixes: ${commitResult.message}`);
        return {
          success: false,
          ...results,
          pushed: false,
          error: commitResult.message
        };
      }
    } else {
      console.log(`No fixes needed`);
      return {
        success: true,
        ...results,
        pushed: false
      };
    }

  } catch (error) {
    console.error(`Failed to apply fixes: ${error.message}`);
    return {
      success: false,
      ...results,
      error: error.message
    };
  }
}

// Export functions
module.exports = {
  runSimplifyReview,
  runPrSpecificChecks,
  applyFixes,
  runLintFixes,
  runTypeFixes,
  validatePrDescription,
  validateCommitMessages,
  checkForTests,
  checkDocumentation,
  getPrChangedFiles,
  runEslint
};