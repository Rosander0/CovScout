import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { main } from "../bin/covscout.js";

async function temporaryClone() {
  const root = await mkdtemp(path.join(os.tmpdir(), "covscout-cleanup-test-"));
  const directory = path.join(root, "fixture-repository");
  await mkdir(directory);
  return { root, directory };
}

function successfulPipeline(directory) {
  return {
    intakeRepository: async () => ({ repositoryName: "fixture-repository", buildSystem: "Maven", directory, scanTruncated: false }),
    formatIntakeSummary: () => [],
    generateCoverageReport: async () => ({ reportPath: "coverage.xml" }),
    formatCoverageSummary: () => [],
    parseCoverageReport: async () => ({ classes: [] }),
    formatParsedCoverageSummary: () => [],
    analyzeChurn: async () => ({}),
    formatChurnSummary: () => [],
    rankCoverageGaps: () => ({ ranked: [], unrankable: [], totalCandidates: 0, topN: 5 }),
    formatRankSummary: () => [],
    generateTestStubs: () => ({ stubs: [], skippedClasses: [] }),
    formatStubSummary: () => [],
    outputRootForRepository: () => "unused-output-root",
    writeOutput: async () => ({ outputRoot: "unused-output-root", writtenFiles: [], skipped: [], failures: [] }),
    formatOutputSummary: () => [],
  };
}

async function assertDoesNotExist(target) {
  await assert.rejects(() => access(target));
}

test("removes the temporary clone after a successful pipeline", async () => {
  const { root, directory } = await temporaryClone();
  try {
    assert.equal(await main(["https://github.com/owner/repository.git"], successfulPipeline(directory)), 0);
    await assertDoesNotExist(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("removes the temporary clone when a later pipeline stage throws", async () => {
  const { root, directory } = await temporaryClone();
  try {
    const pipeline = successfulPipeline(directory);
    pipeline.generateCoverageReport = async () => { throw new Error("coverage failed"); };
    await assert.rejects(() => main(["https://github.com/owner/repository.git"], pipeline), { message: "coverage failed" });
    await assertDoesNotExist(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports a temporary clone cleanup failure without changing the pipeline result", async () => {
  const { root, directory } = await temporaryClone();
  const errors = [];
  const originalError = console.error;
  console.error = (line) => { errors.push(line); };
  try {
    const pipeline = successfulPipeline(directory);
    pipeline.rm = async () => { throw new Error("cleanup permission denied"); };
    assert.equal(await main(["https://github.com/owner/repository.git"], pipeline), 0);
  } finally {
    console.error = originalError;
    await rm(root, { recursive: true, force: true });
  }
  assert.equal(errors.length, 1);
  assert.match(errors[0], /cleanup permission denied/);
});

test("--history prints saved history without invoking repository intake", async () => {
  let intakeCalled = false;
  const printed = [];
  const originalLog = console.log;
  console.log = (line) => { printed.push(line); };
  try {
    const exitCode = await main(["--history", "https://github.com/owner/repository.git"], {
      intakeRepository: async () => { intakeCalled = true; },
      parseGitHubUrl: () => ({ repositoryName: "repository" }),
      outputRootForRepository: (name) => `history-root/${name}`,
      readRunHistory: async ({ outputRoot }) => ({ status: "found", content: `### Run saved at ${outputRoot}` }),
    });
    assert.equal(exitCode, 0);
  } finally {
    console.log = originalLog;
  }
  assert.equal(intakeCalled, false);
  assert.deepEqual(printed, ["### Run saved at history-root/repository"]);
});
