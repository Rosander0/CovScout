import { spawn } from "node:child_process";

const COMMIT_LIMIT = 100;
const SIX_MONTHS_MS = 183 * 24 * 60 * 60 * 1000;

// Returns an array keyed by the Stage 3 sourceFile value.  Metadata is kept
// on the array for the CLI summary without changing the Stage 5 join shape.
export async function analyzeChurn(directory, classes, { now = new Date() } = {}) {
  const sourceFiles = coverageSourceFiles(classes);
  const unavailable = (warning) => churnResult(sourceFiles.map((sourceFile) => ({ sourceFile, commitCount: null, lastModified: null })), {
    status: "unavailable",
    window: "unavailable",
    commitsAnalyzed: 0,
    warnings: [warning],
  });

  let output;
  try {
    output = await runGitLog(directory);
  } catch (error) {
    return unavailable(`Git churn data unavailable: ${error.message}`);
  }

  let commits;
  try {
    commits = parseGitLog(output);
  } catch (error) {
    return unavailable(`Git churn data unavailable: unable to parse git log output (${error.message}).`);
  }

  const cutoff = new Date(now.getTime() - SIX_MONTHS_MS);
  const repositoryHasFewerThanLimit = commits.length <= COMMIT_LIMIT;
  const selected = repositoryHasFewerThanLimit
    ? commits
    : commits.filter((commit) => commit.date >= cutoff).slice(0, COMMIT_LIMIT);
  const warnings = [];
  const window = repositoryHasFewerThanLimit ? "available-history" : "six-months-or-100-commits";
  if (repositoryHasFewerThanLimit) {
    warnings.push(`Repository has only ${commits.length} commit${commits.length === 1 ? "" : "s"} available; analyzed all available history.`);
  } else if (selected.length === 0) {
    warnings.push("No commits fell within the last six months; churn measurements are unavailable for this bounded window.");
  } else if (selected.length < COMMIT_LIMIT) {
    warnings.push(`Analyzed ${selected.length} commits from the last six months (fewer than the 100-commit cap).`);
  } else {
    warnings.push("Analyzed the most recent 100 commits within the last six months.");
  }

  const measurements = new Map(sourceFiles.map((sourceFile) => [sourceFile, { sourceFile, commitCount: 0, lastModified: null }]));
  for (const commit of selected) {
    for (const sourceFile of commit.files) {
      const measurement = measurements.get(sourceFile);
      if (!measurement) continue;
      measurement.commitCount += 1;
      if (!measurement.lastModified) measurement.lastModified = commit.date.toISOString();
    }
  }
  // In an available result every sourceFile has a measured count; null is reserved for unavailable results.
  const records = sourceFiles.map((sourceFile) => measurements.get(sourceFile));
  return churnResult(records, { status: "available", window, commitsAnalyzed: selected.length, warnings });
}

export function formatChurnSummary(churnResult_) {
  const lines = [
    "Git churn analysis complete",
    `Churn status: ${churnResult_.status ?? "unavailable"}`,
    `Churn window: ${churnResult_.window ?? "unavailable"}`,
    `Commits analyzed: ${churnResult_.commitsAnalyzed ?? 0}`,
    `Files with churn data: ${churnResult_.filter((file) => file.commitCount !== null).length}/${churnResult_.length}`,
  ];
  for (const warning of churnResult_.warnings ?? []) lines.push(`WARNING: ${warning}`);
  return lines;
}

function coverageSourceFiles(classes) {
  return [...new Set((Array.isArray(classes) ? classes : [])
    .map((entry) => entry?.sourceFile)
    .filter((sourceFile) => typeof sourceFile === "string" && sourceFile.length > 0))];
}

function churnResult(records, metadata) {
  Object.defineProperties(records, Object.fromEntries(Object.entries(metadata).map(([key, value]) => [key, {
    value,
    enumerable: false,
    writable: false,
  }])));
  return records;
}

function runGitLog(directory) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["log", "--max-count=101", "--format=%H%x09%cI", "--name-only"], {
      cwd: directory,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => reject(new Error(error.message)));
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `git log exited with code ${code}`));
    });
  });
}

function parseGitLog(output) {
  const commits = [];
  let current;
  for (const line of output.replaceAll("\r\n", "\n").split("\n")) {
    const match = /^([0-9a-f]{40})\t(.+)$/.exec(line);
    if (match) {
      const date = new Date(match[2]);
      if (Number.isNaN(date.getTime())) throw new Error(`invalid commit date ${match[2]}`);
      current = { date, files: [] };
      commits.push(current);
    } else if (current && line) {
      current.files.push(line);
    }
  }
  return commits;
}
