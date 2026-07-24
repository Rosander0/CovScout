#!/usr/bin/env node

import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { intakeRepository } from "../src/intake.js";
import { formatCoverageSummary, generateCoverageReport } from "../src/coverage.js";
import { formatParsedCoverageSummary, parseCoverageReport } from "../src/coverage-parser.js";
import { analyzeChurn, formatChurnSummary } from "../src/churn.js";
import { formatRankSummary, rankCoverageGaps } from "../src/rank.js";
import { formatIntakeSummary } from "../src/summary.js";

function usage() {
  return "Usage: covscout <github-url>";
}

const defaultDependencies = {
  intakeRepository,
  formatIntakeSummary,
  generateCoverageReport,
  formatCoverageSummary,
  parseCoverageReport,
  formatParsedCoverageSummary,
  analyzeChurn,
  formatChurnSummary,
  rankCoverageGaps,
  formatRankSummary,
};

export async function main(arguments_, dependencies = defaultDependencies) {
  const pipeline = { ...defaultDependencies, ...dependencies };
  if (arguments_.length !== 1 || arguments_[0] === "--help" || arguments_[0] === "-h") {
    console.error(usage());
    return arguments_[0] === "--help" || arguments_[0] === "-h" ? 0 : 2;
  }

  const result = await pipeline.intakeRepository(arguments_[0]);
  try {
    for (const line of pipeline.formatIntakeSummary(result)) console.log(line);
    const coverage = await pipeline.generateCoverageReport(result);
    for (const line of pipeline.formatCoverageSummary(coverage)) console.log(line);
    const parsedCoverage = await pipeline.parseCoverageReport(coverage, result.directory);
    for (const line of pipeline.formatParsedCoverageSummary(parsedCoverage)) console.log(line);
    const churn = await pipeline.analyzeChurn(result.directory, parsedCoverage.classes);
    for (const line of pipeline.formatChurnSummary(churn)) console.log(line);
    const ranking = pipeline.rankCoverageGaps(parsedCoverage.classes, churn);
    for (const line of pipeline.formatRankSummary(ranking)) console.log(line);
    return 0;
  } finally {
    await rm(path.dirname(result.directory), { recursive: true, force: true }).catch(() => {});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (exitCode) => { process.exitCode = exitCode; },
    (error) => {
      console.error(`covscout: ${error.message}`);
      process.exitCode = 1;
    },
  );
}
