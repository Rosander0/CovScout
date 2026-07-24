const DEFAULT_TOP_N = 5;

// For measured coverage and churn: score = (1 - lineCoverage) * ln(1 + commits).
// If exactly one measured dimension is available, its standalone signal is used:
// coverage gap = 1 - lineCoverage; churn signal = ln(1 + commits).  A static
// heuristic is a likely-gap signal, not a measured percentage: with churn it
// ranks by the real churn signal alone; without churn it retains score 1.
export function rankCoverageGaps(classes, churnResult, options = {}) {
  const topN = normalizeTopN(options.topN);
  const churnBySourceFile = new Map(Array.isArray(churnResult)
    ? churnResult.filter((record) => typeof record?.sourceFile === "string").map((record) => [record.sourceFile, record])
    : []);
  const ranked = [];
  const unrankable = [];

  for (const candidate of Array.isArray(classes) ? classes : []) {
    if (!candidate || typeof candidate !== "object") continue;
    const name = typeof candidate.name === "string" ? candidate.name : "Unnamed class";
    if (typeof candidate.sourceFile !== "string" || !candidate.sourceFile) {
      unrankable.push({ name, sourceFile: null, reason: "Source file could not be resolved, so churn data cannot be joined." });
      continue;
    }

    const linePercentage = candidate.coverage?.line?.percentage;
    const measuredCoverage = isPercentage(linePercentage);
    const heuristic = candidate.heuristic === true;
    const churn = churnBySourceFile.get(candidate.sourceFile);
    const commitCount = isCommitCount(churn?.commitCount) ? churn.commitCount : null;
    const hasCoverageSignal = measuredCoverage || heuristic;
    const hasChurnSignal = commitCount !== null;
    if (!hasCoverageSignal && !hasChurnSignal) {
      unrankable.push({ name, sourceFile: candidate.sourceFile, reason: "Coverage and churn are both unavailable for this class." });
      continue;
    }

    const coverageGap = measuredCoverage ? 1 - linePercentage : null;
    const churnSignal = hasChurnSignal ? Math.log1p(commitCount) : null;
    const score = scoreCandidate({ measuredCoverage, heuristic, hasChurnSignal, coverageGap, churnSignal });
    ranked.push({
      name,
      sourceFile: candidate.sourceFile,
      score,
      coveragePercentage: measuredCoverage ? linePercentage : null,
      coverageGap,
      heuristic,
      commitCount,
      churnSignal,
      status: measuredCoverage && hasChurnSignal ? "fully-known" : "partially-known",
      formula: formulaFor({ measuredCoverage, heuristic, hasChurnSignal }),
    });
  }

  const statusRank = { "fully-known": 0, "partially-known": 1 };
  ranked.sort((left, right) => statusRank[left.status] - statusRank[right.status]
    || right.score - left.score
    || left.name.localeCompare(right.name)
    || left.sourceFile.localeCompare(right.sourceFile));
  const totalCandidates = ranked.length;
  return { ranked: ranked.slice(0, topN), unrankable, unrankableCount: unrankable.length, totalCandidates, topN };
}

export function formatRankSummary(rankResult) {
  const result = rankResult && typeof rankResult === "object" ? rankResult : {};
  const ranked = Array.isArray(result.ranked) ? result.ranked : [];
  const unrankable = Array.isArray(result.unrankable) ? result.unrankable : [];
  const totalCandidates = Number.isInteger(result.totalCandidates) ? result.totalCandidates : ranked.length;
  const lines = [
    "Coverage gap ranking complete",
    "Score formula: measured coverage + churn = (1 - line coverage) * ln(1 + commit count); one known dimension uses its standalone signal.",
    `Ranked ${ranked.length} out of ${totalCandidates} candidates (top ${result.topN ?? DEFAULT_TOP_N}).`,
  ];
  for (const entry of ranked) {
    const coverage = entry.heuristic
      ? "coverage: static likely gap (no measured %)"
      : entry.coveragePercentage === null ? "coverage: unknown" : `coverage: ${(entry.coveragePercentage * 100).toFixed(2)}% (gap ${(entry.coverageGap * 100).toFixed(2)}%)`;
    const churn = entry.commitCount === null ? "churn: unknown" : `churn: ${entry.commitCount} commits`;
    lines.push(`${entry.name} [${entry.sourceFile}] — ${coverage}; ${churn}; score: ${entry.score.toFixed(6)} = ${entry.formula} (${entry.status}).`);
  }
  for (const entry of unrankable) lines.push(`WARNING: Unrankable ${entry.name} [${entry.sourceFile ?? "unresolved source file"}]: ${entry.reason}`);
  return lines;
}

function scoreCandidate({ measuredCoverage, heuristic, hasChurnSignal, coverageGap, churnSignal }) {
  if (measuredCoverage && hasChurnSignal) return coverageGap * churnSignal;
  if (measuredCoverage) return coverageGap;
  if (heuristic && hasChurnSignal) return churnSignal;
  if (heuristic) return 1;
  return churnSignal;
}

function formulaFor({ measuredCoverage, heuristic, hasChurnSignal }) {
  if (measuredCoverage && hasChurnSignal) return "(1 - line coverage) * ln(1 + commits)";
  if (measuredCoverage) return "1 - line coverage (churn unavailable)";
  if (heuristic && hasChurnSignal) return "ln(1 + commits) (static likely gap; no measured coverage)";
  if (heuristic) return "1 (static likely gap; churn unavailable)";
  return "ln(1 + commits) (coverage unavailable)";
}

function normalizeTopN(value) {
  if (value === undefined) return DEFAULT_TOP_N;
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError("topN must be a non-negative safe integer.");
  return value;
}

function isPercentage(value) { return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1; }
function isCommitCount(value) { return Number.isSafeInteger(value) && value >= 0; }
