#!/usr/bin/env node

import { intakeRepository } from "../src/intake.js";
import { formatCoverageSummary, generateCoverageReport } from "../src/coverage.js";
import { formatParsedCoverageSummary, parseCoverageReport } from "../src/coverage-parser.js";
import { formatIntakeSummary } from "../src/summary.js";

function usage() {
  return "Usage: covscout <github-url>";
}

async function main(arguments_) {
  if (arguments_.length !== 1 || arguments_[0] === "--help" || arguments_[0] === "-h") {
    console.error(usage());
    return arguments_[0] === "--help" || arguments_[0] === "-h" ? 0 : 2;
  }

  const result = await intakeRepository(arguments_[0]);
  for (const line of formatIntakeSummary(result)) console.log(line);
  const coverage = await generateCoverageReport(result);
  for (const line of formatCoverageSummary(coverage)) console.log(line);
  const parsedCoverage = await parseCoverageReport(coverage);
  for (const line of formatParsedCoverageSummary(parsedCoverage)) console.log(line);
  return 0;
}

main(process.argv.slice(2)).then(
  (exitCode) => { process.exitCode = exitCode; },
  (error) => {
    console.error(`covscout: ${error.message}`);
    process.exitCode = 1;
  },
);
