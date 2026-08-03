import assert from "node:assert/strict";
import test from "node:test";
import { main } from "../bin/covscout.js";

function fakeDependencies(overrides = {}) {
  const calls = { generateCoverageReport: [] };
  const deps = {
    intakeRepository: async () => ({ directory: "/tmp/demo", repositoryName: "demo", buildSystem: "Maven" }),
    formatIntakeSummary: () => ["intake"],
    generateCoverageReport: async (intake, options) => {
      calls.generateCoverageReport.push(options);
      return { kind: "static-heuristic", confidence: "low", reason: "test", buildSystem: "Maven", command: ["mvn"], gaps: [] };
    },
    formatCoverageSummary: () => ["coverage"],
    parseCoverageReport: async () => ({ classes: [] }),
    formatParsedCoverageSummary: () => ["parsed"],
    analyzeChurn: async () => ({ status: "unavailable" }),
    formatChurnSummary: () => ["churn"],
    rankCoverageGaps: () => ({ ranked: [] }),
    formatRankSummary: () => ["rank"],
    generateTestStubs: () => ({ stubs: [], skippedClasses: [] }),
    formatStubSummary: () => ["stubs"],
    writeOutput: async () => ({}),
    formatOutputSummary: () => ["output"],
    rm: async () => {},
    outputRootForRepository: () => "/tmp/out",
    ...overrides,
  };
  return { deps, calls };
}

test("--build-timeout <minutes> is converted to ms and passed to generateCoverageReport", async () => {
  const { deps, calls } = fakeDependencies();
  const code = await main(["--build-timeout", "20", "https://github.com/demo/demo"], deps);
  assert.equal(code, 0);
  assert.deepEqual(calls.generateCoverageReport, [{ timeoutMs: 20 * 60 * 1000 }]);
});

test("without --build-timeout, generateCoverageReport gets no options override (uses its own default)", async () => {
  const { deps, calls } = fakeDependencies();
  const code = await main(["https://github.com/demo/demo"], deps);
  assert.equal(code, 0);
  assert.deepEqual(calls.generateCoverageReport, [undefined]);
});

test("rejects a non-positive or non-numeric --build-timeout without running the pipeline", async () => {
  const { deps, calls } = fakeDependencies();
  const code = await main(["--build-timeout", "not-a-number", "https://github.com/demo/demo"], deps);
  assert.equal(code, 2);
  assert.deepEqual(calls.generateCoverageReport, []);
});

test("--build-timeout works regardless of position relative to the URL", async () => {
  const { deps, calls } = fakeDependencies();
  const code = await main(["https://github.com/demo/demo", "--build-timeout", "10"], deps);
  assert.equal(code, 0);
  assert.deepEqual(calls.generateCoverageReport, [{ timeoutMs: 10 * 60 * 1000 }]);
});
