/**
 * Merge Conflict Detection and Resolution
 * Handles merge conflict detection, severity analysis, and automated resolution
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

/**
 * Execute git command and return result
 */
async function execGit(command) {
  try {
    const { stdout, stderr } = await execAsync(`git ${command}`, {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024 // 10MB buffer
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
 * Simulate a merge without committing to detect conflicts
 */
async function simulateMerge(sourceBranch, targetBranch = 'main') {
  console.log(`Simulating merge of ${sourceBranch} into ${targetBranch}...`);

  // Save current branch
  const currentBranch = (await execGit('rev-parse --abbrev-ref HEAD')).stdout;

  try {
    // Ensure we're on the target branch
    if (currentBranch !== targetBranch) {
      console.log(`Switching to ${targetBranch}...`);
      const checkoutResult = await execGit(`checkout ${targetBranch}`);
      if (!checkoutResult.success) {
        throw new Error(`Failed to checkout ${targetBranch}: ${checkoutResult.message}`);
      }
    }

    // Ensure target branch is up to date
    console.log('Updating target branch...');
    const pullResult = await execGit(`pull origin ${targetBranch}`);
    if (!pullResult.success) {
      console.warn(`Failed to pull ${targetBranch}: ${pullResult.message}`);
    }

    // Attempt merge without committing
    console.log(`Attempting merge ${sourceBranch}...`);
    const mergeResult = await execGit(
      `merge --no-commit --no-ff ${sourceBranch}`
    );

    // Check for conflicts
    const statusResult = await execGit('status --porcelain');
    const conflictFiles = parseConflicts(statusResult.stdout);

    if (conflictFiles.length > 0) {
      console.log(`⚠️  Found ${conflictFiles.length} conflict(s)`);

      // Abort the merge
      await execGit('merge --abort');

      return {
        hasConflicts: true,
        conflictFiles: conflictFiles,
        severity: analyzeConflictSeverity(conflictFiles),
        sourceBranch,
        targetBranch
      };
    }

    // No conflicts - abort the merge since we're just simulating
    await execGit('merge --abort');

    console.log(`✓ No conflicts detected`);

    return {
      hasConflicts: false,
      conflictFiles: [],
      severity: 'none',
      sourceBranch,
      targetBranch
    };

  } catch (error) {
    // Clean up by aborting any in-progress merge
    try {
      await execGit('merge --abort');
    } catch (abortError) {
      // Ignore abort errors
    }

    // Return to original branch
    try {
      if (currentBranch !== targetBranch) {
        await execGit(`checkout ${currentBranch}`);
      }
    } catch (checkoutError) {
      console.error(`Failed to return to original branch: ${checkoutError.message}`);
    }

    console.error(`Merge simulation failed: ${error.message}`);

    return {
      hasConflicts: true,
      conflictFiles: [],
      severity: 'error',
      error: error.message,
      sourceBranch,
      targetBranch
    };
  } finally {
    // Return to original branch
    try {
      const finalBranch = (await execGit('rev-parse --abbrev-ref HEAD')).stdout;
      if (finalBranch !== currentBranch) {
        await execGit(`checkout ${currentBranch}`);
      }
    } catch (error) {
      console.error(`Failed to return to original branch: ${error.message}`);
    }
  }
}

/**
 * Parse git status output to identify conflicted files
 */
function parseConflicts(statusOutput) {
  const conflicts = [];
  const lines = statusOutput.split('\n');

  for (const line of lines) {
    // Conflicted files have 'UU', 'AA', 'DD', etc. as the status
    if (line.match(/^(UU|AA|DD|AU|UA|DU|UD|DA)\s+/)) {
      const filePath = line.substring(3).trim();
      conflicts.push(filePath);
    }
  }

  return conflicts;
}

/**
 * Analyze the severity of merge conflicts
 */
function analyzeConflictSeverity(conflictFiles) {
  if (!conflictFiles || conflictFiles.length === 0) {
    return 'none';
  }

  const count = conflictFiles.length;
  const fileTypes = {
    code: 0,
    config: 0,
    docs: 0,
    tests: 0,
    other: 0
  };

  // Categorize files by type
  for (const file of conflictFiles) {
    const ext = file.split('.').pop().toLowerCase();
    const path = file.toLowerCase();

    if (['js', 'jsx', 'ts', 'tsx', 'vue', 'py', 'rb', 'go'].includes(ext)) {
      fileTypes.code++;
    } else if (['json', 'yaml', 'yml', 'toml', 'xml', 'ini', 'conf'].includes(ext) ||
               path.includes('config') || path.includes('.env')) {
      fileTypes.config++;
    } else if (['md', 'rst', 'txt'].includes(ext) ||
               path.includes('readme') || path.includes('doc')) {
      fileTypes.docs++;
    } else if (path.includes('test') || path.includes('spec') || ext === 'test') {
      fileTypes.tests++;
    } else {
      fileTypes.other++;
    }
  }

  // Determine severity based on count and types
  if (fileTypes.config > 0) {
    // Config file conflicts are high severity
    return 'high';
  } else if (count >= 10) {
    // Many conflicts = high severity
    return 'high';
  } else if (count >= 5) {
    // Moderate number of conflicts = medium severity
    return 'medium';
  } else if (fileTypes.code > 0 && count > 2) {
    // Multiple code conflicts = medium severity
    return 'medium';
  } else if (fileTypes.tests > 0 && count <= 2) {
    // Only test conflicts = low severity
    return 'low';
  } else if (count <= 2 && fileTypes.docs > 0) {
    // Only doc conflicts = low severity
    return 'low';
  } else if (count <= 3) {
    // Few conflicts = low severity
    return 'low';
  }

  return 'medium';
}

/**
 * Detect merge conflicts between branches
 */
async function detectMergeConflicts(sourceBranch, targetBranch = 'main') {
  return await simulateMerge(sourceBranch, targetBranch);
}

/**
 * Attempt to resolve conflicts automatically using heuristics
 */
async function attemptAutoResolution(conflictFiles) {
  console.log(`Attempting automatic resolution for ${conflictFiles.length} conflict(s)...`);

  const results = {
    total: conflictFiles.length,
    resolved: 0,
    failed: 0,
    manual: [],
    details: []
  };

  for (const file of conflictFiles) {
    try {
      const result = await resolveSingleConflict(file);
      results.details.push({ file, ...result });

      if (result.resolved) {
        results.resolved++;
        console.log(`✓ Auto-resolved: ${file}`);
      } else {
        results.failed++;
        results.manual.push(file);
        console.log(`✗ Could not auto-resolve: ${file} (${result.reason})`);
      }
    } catch (error) {
      results.failed++;
      results.manual.push(file);
      results.details.push({
        file,
        resolved: false,
        reason: error.message
      });
      console.error(`Error resolving ${file}: ${error.message}`);
    }
  }

  console.log(`Auto-resolution complete: ${results.resolved}/${results.total} resolved`);

  return results;
}

/**
 * Attempt to resolve a single conflicted file
 */
async function resolveSingleConflict(filePath) {
  try {
    // Check file type
    const ext = filePath.split('.').pop().toLowerCase();

    // Strategy 1: Accept current version (for docs, comments)
    if (['md', 'rst', 'txt'].includes(ext)) {
      return await resolveWithAcceptance(filePath, 'ours');
    }

    // Strategy 2: Accept incoming version (for imports, dependencies)
    if (['json', 'yaml', 'yml'].includes(ext) &&
        (filePath.includes('package.json') || filePath.includes('dependencies'))) {
      return await resolveWithAcceptance(filePath, 'theirs');
    }

    // Default: Mark as requiring manual resolution
    return {
      resolved: false,
      reason: 'Requires manual resolution'
    };

  } catch (error) {
    return {
      resolved: false,
      reason: error.message
    };
  }
}

/**
 * Resolve conflict by accepting one version
 */
async function resolveWithAcceptance(filePath, version) {
  try {
    const result = await execGit(`checkout --${version} -- ${filePath}`);
    if (result.success) {
      await execGit(`add ${filePath}`);
      return {
        resolved: true,
        strategy: `accept-${version}`
      };
    }
    return {
      resolved: false,
      reason: 'Failed to accept version'
    };
  } catch (error) {
    return {
      resolved: false,
      reason: error.message
    };
  }
}

/**
 * Resolve conflicts in a merge
 */
async function resolveConflicts(sourceBranch, targetBranch = 'main', options = {}) {
  const config = {
    autoResolve: options.autoResolve !== false, // Default to true
    fallbackStrategy: options.fallbackStrategy || 'manual',
    ...options
  };

  console.log(`Attempting to resolve conflicts between ${sourceBranch} and ${targetBranch}...`);

  // First, detect conflicts
  const conflictResult = await simulateMerge(sourceBranch, targetBranch);

  if (!conflictResult.hasConflicts) {
    return {
      success: true,
      message: 'No conflicts to resolve',
      resolutionDetails: conflictResult
    };
  }

  if (!config.autoResolve) {
    return {
      success: false,
      message: 'Auto-resolution disabled',
      conflictFiles: conflictResult.conflictFiles,
      severity: conflictResult.severity
    };
  }

  // Attempt auto-resolution
  const autoResult = await attemptAutoResolution(conflictResult.conflictFiles);

  if (autoResult.resolved > 0 && autoResult.manual.length === 0) {
    return {
      success: true,
      message: 'All conflicts resolved automatically',
      resolved: autoResult.resolved,
      total: autoResult.total,
      details: autoResult.details
    };
  }

  // Partial success or failure
  return {
    success: autoResult.resolved > 0,
    message: `${autoResult.resolved}/${autoResult.total} conflicts resolved automatically`,
    resolved: autoResult.resolved,
    total: autoResult.total,
    manual: autoResult.manual,
    details: autoResult.details,
    requiresManual: autoResult.manual.length > 0
  };
}

/**
 * Analyze conflict severity for batch decision making
 */
async function analyzeConflictSeverityDetailed(conflictFiles) {
  if (!conflictFiles || conflictFiles.length === 0) {
    return {
      severity: 'none',
      count: 0,
      recommendation: 'safe to merge'
    };
  }

  const severity = analyzeConflictSeverity(conflictFiles);

  let recommendation;
  switch (severity) {
    case 'low':
      recommendation = 'attempt auto-resolution or proceed';
      break;
    case 'medium':
      recommendation = 'split batch or process individually';
      break;
    case 'high':
      recommendation = 'fall back to individual processing';
      break;
    case 'error':
      recommendation = 'requires manual intervention';
      break;
    default:
      recommendation = 'review conflicts manually';
  }

  return {
    severity,
    count: conflictFiles.length,
    files: conflictFiles,
    recommendation
  };
}

/**
 * Get current merge status
 */
async function getMergeStatus() {
  const statusResult = await execGit('status --porcelain');
  const conflicts = parseConflicts(statusResult.stdout);

  return {
    hasConflicts: conflicts.length > 0,
    conflictFiles: conflicts,
    inMerge: (await execGit('rev-parse --abbrev-ref HEAD')).stdout.includes('MERGE_HEAD')
  };
}

/**
 * Abort current merge
 */
async function abortMerge() {
  const result = await execGit('merge --abort');
  return result.success;
}

// Export functions
module.exports = {
  simulateMerge,
  detectMergeConflicts,
  resolveConflicts,
  attemptAutoResolution,
  analyzeConflictSeverity,
  analyzeConflictSeverityDetailed,
  parseConflicts,
  getMergeStatus,
  abortMerge,
  resolveSingleConflict,
  resolveWithAcceptance
};