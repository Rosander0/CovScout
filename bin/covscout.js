#!/usr/bin/env node

import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { intakeRepository } from "../src/intake.js";
import { formatCoverageSummary, generateCoverageReport } from "../src/coverage.js";
import { formatParsedCoverageSummary, parseCoverageReport } from "../src/coverage-parser.js";
import { analyzeChurn, formatChurnSummary } from "../src/churn.js";
import { formatRankSummary, rankCoverageGaps } from "../src/rank.js";
import { formatStubSummary, generateTestStubs } from "../src/stubs.js";
import { formatOutputSummary, readRunHistory, writeOutput } from "../src/output.js";
import { formatIntakeSummary } from "../src/summary.js";
import { parseGitHubUrl } from "../src/github-url.js";

function usage() {
  return "Usage: covscout <github-url>\n       covscout --history <github-url>";
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
  generateTestStubs,
  formatStubSummary,
  writeOutput,
  formatOutputSummary,
  readRunHistory,
  parseGitHubUrl,
  outputRootForRepository: (repositoryName) => path.join(process.cwd(), "covscout-output", repositoryName),
};

export async function main(arguments_, dependencies = defaultDependencies) {
  const pipeline = { ...defaultDependencies, ...dependencies };
  const historyRequested = arguments_[0] === "--history" || arguments_[0] === "-H";
  if (historyRequested) {
    if (arguments_.length !== 2) {
      console.error(usage());
      return 2;
    }
    const repository = pipeline.parseGitHubUrl(arguments_[1]);
    const history = await pipeline.readRunHistory({ outputRoot: pipeline.outputRootForRepository(repository.repositoryName) });
    console.log(history.status === "no-history-yet" ? `No run history yet for ${repository.repositoryName}.` : history.content);
    return 0;
  }
  if (arguments_.length !== 1 || arguments_[0] === "--help" || arguments_[0] === "-h") {
    console.error(usage());
    return arguments_[0] === "--help" || arguments_[0] === "-h" ? 0 : 2;
  }

  const result = await pipeline.intakeRepository(arguments_[0]);
  try {
    const intakeSummary = pipeline.formatIntakeSummary(result);
    for (const line of intakeSummary) console.log(line);
    const coverage = await pipeline.generateCoverageReport(result);
    const coverageSummary = pipeline.formatCoverageSummary(coverage);
    for (const line of coverageSummary) console.log(line);
    const parsedCoverage = await pipeline.parseCoverageReport(coverage, result.directory);
    const parsedCoverageSummary = pipeline.formatParsedCoverageSummary(parsedCoverage);
    for (const line of parsedCoverageSummary) console.log(line);
    const churn = await pipeline.analyzeChurn(result.directory, parsedCoverage.classes);
    const churnSummary = pipeline.formatChurnSummary(churn);
    for (const line of churnSummary) console.log(line);
    const ranking = pipeline.rankCoverageGaps(parsedCoverage.classes, churn);
    const rankSummary = pipeline.formatRankSummary(ranking);
    for (const line of rankSummary) console.log(line);
    const stubs = pipeline.generateTestStubs(ranking, parsedCoverage.classes);
    const stubSummary = pipeline.formatStubSummary(stubs);
    for (const line of stubSummary) console.log(line);
    const output = await pipeline.writeOutput(ranking, stubs, {
      "Repository intake": intakeSummary,
      "Coverage analysis": coverageSummary,
      "Coverage report parsing": parsedCoverageSummary,
      "Git churn analysis": churnSummary,
      "Coverage gap ranking": rankSummary,
      "JUnit 5 test stub generation": stubSummary,
    }, {
      outputRoot: pipeline.outputRootForRepository(result.repositoryName),
      historyEntry: {
        timestamp: new Date().toISOString(),
        repositoryName: result.repositoryName,
        buildSystem: result.buildSystem,
        coverageKind: coverage.kind,
        coverageConfidence: coverage.confidence,
        churnStatus: churn.status,
        rankedGapCount: ranking.ranked?.length ?? 0,
        stubsWritten: stubs.stubs?.length ?? 0,
        skippedCount: (stubs.skippedClasses?.length ?? 0),
      },
    });
    for (const line of pipeline.formatOutputSummary(output)) console.log(line);
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
