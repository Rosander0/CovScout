import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { appendRunHistory, formatOutputSummary, MAX_HISTORY_ENTRIES, NO_HISTORY_YET, readRunHistory, writeOutput } from "../src/output.js";

const root = path.resolve("test-output");
const stub = (className, packageName, source) => ({ className, packageName, source });
const summaries = { "Repository intake": ["Repository intake complete"], "Coverage analysis": ["Coverage analysis complete"] };

test("writes all resolved stubs and a report built from stage summaries", async () => {
  const writes = [];
  const result = await writeOutput({}, { stubs: [stub("demo.Widget", "demo", "widget source"), stub("Flat", null, "flat source")] }, summaries, {
    outputRoot: root,
    mkdir: async () => {},
    writeFile: async (...args) => { writes.push(args); },
    resolvePaths: (stubs, outputRoot) => [
      { className: stubs[0].className, absolutePath: path.join(outputRoot, "demo", "WidgetStubTest.java") },
      { className: stubs[1].className, absolutePath: path.join(outputRoot, "FlatStubTest.java") },
    ],
  });

  assert.deepEqual(writes.slice(0, 2).map(([file, source]) => [file, source]), [
    [path.join(root, "demo", "WidgetStubTest.java"), "widget source"],
    [path.join(root, "FlatStubTest.java"), "flat source"],
  ]);
  const [reportPath, report] = writes[2];
  assert.equal(reportPath, path.join(root, "REPORT.md"));
  assert.match(report, /## Repository intake\n```text\nRepository intake complete/);
  assert.match(report, /## Coverage analysis\n```text\nCoverage analysis complete/);
  assert.deepEqual(result.writtenFiles, writes.slice(0, 3).map(([file]) => file));
});

test("skips an exhausted collision while writing remaining stubs and the report", async () => {
  const writes = [];
  const result = await writeOutput({}, { stubs: [stub("demo.Blocked", "demo", "blocked"), stub("demo.Open", "demo", "open")] }, summaries, {
    outputRoot: root, mkdir: async () => {}, writeFile: async (...args) => { writes.push(args); },
    resolvePaths: (stubs, outputRoot) => [
      { className: stubs[0].className, intendedAbsolutePath: path.join(outputRoot, "demo", "BlockedStubTest.java"), absolutePath: null, collisionReason: "No free fallback was found." },
      { className: stubs[1].className, absolutePath: path.join(outputRoot, "demo", "OpenStubTest.java") },
    ],
  });

  assert.equal(writes.some(([file]) => /BlockedStubTest/.test(file)), false);
  assert.equal(writes.some(([file]) => /OpenStubTest/.test(file)), true);
  assert.equal(writes.some(([file]) => /REPORT\.md$/.test(file)), true);
  assert.match(result.skipped[0].reason, /No free fallback/);
});

test("records only successfully written stubs in run history", async () => {
  const files = new Map();
  const readFile = async (file) => {
    if (!files.has(file)) { const error = new Error("missing"); error.code = "ENOENT"; throw error; }
    return files.get(file);
  };
  const writeFile = async (file, content) => { files.set(file, content); };
  const result = await writeOutput({}, { stubs: [stub("demo.Blocked", "demo", "blocked"), stub("demo.Open", "demo", "open")] }, summaries, {
    outputRoot: root, mkdir: async () => {}, readFile, writeFile,
    resolvePaths: (stubs, outputRoot) => [
      { className: stubs[0].className, intendedAbsolutePath: path.join(outputRoot, "demo", "BlockedStubTest.java"), absolutePath: null, collisionReason: "No free fallback was found." },
      { className: stubs[1].className, absolutePath: path.join(outputRoot, "demo", "OpenStubTest.java") },
    ],
    historyEntry: { stubsWritten: 2, skippedCount: 0 },
  });

  assert.equal(result.writtenFiles.length - 1, 1);
  assert.match(files.get(result.historyPath), /Stubs written: 1/);
  assert.doesNotMatch(files.get(result.historyPath), /Stubs written: 2/);
});

test("continues after an individual stub write failure and reports its error", async () => {
  const failedPath = path.join(root, "demo", "BrokenStubTest.java");
  const writes = [];
  const result = await writeOutput({}, { stubs: [stub("demo.Broken", "demo", "broken"), stub("demo.Working", "demo", "working")] }, summaries, {
    outputRoot: root, mkdir: async () => {},
    writeFile: async (file, content) => { if (file === failedPath) throw new Error("disk full"); writes.push([file, content]); },
    resolvePaths: (stubs, outputRoot) => [
      { className: stubs[0].className, absolutePath: failedPath },
      { className: stubs[1].className, absolutePath: path.join(outputRoot, "demo", "WorkingStubTest.java") },
    ],
  });

  assert.equal(writes.some(([file]) => /WorkingStubTest/.test(file)), true);
  assert.equal(writes.some(([file]) => /REPORT\.md$/.test(file)), true);
  assert.match(result.skipped[0].reason, /disk full/);
});

test("reports an output-root mkdir failure without attempting writes", async () => {
  let writeAttempted = false;
  const result = await writeOutput({}, { stubs: [stub("demo.Widget", "demo", "source")] }, summaries, {
    outputRoot: root,
    mkdir: async () => { throw new Error("permission denied"); },
    writeFile: async () => { writeAttempted = true; },
  });

  assert.equal(writeAttempted, false);
  assert.equal(result.writtenFiles.length, 0);
  assert.match(result.failures[0].reason, /Unable to create output root: permission denied/);
});

test("formats each written path and every warning", () => {
  const summary = formatOutputSummary({
    outputRoot: root,
    writtenFiles: [path.join(root, "WidgetStubTest.java"), path.join(root, "REPORT.md")],
    skipped: [{ className: "demo.Blocked", path: "blocked.java", reason: "collision exhausted" }],
    failures: [{ path: root, reason: "permission denied" }],
  }).join("\n");

  assert.match(summary, /WidgetStubTest\.java/);
  assert.match(summary, /REPORT\.md/);
  assert.match(summary, /collision exhausted/);
  assert.match(summary, /permission denied/);
});

test("appends newest-first run history and caps it at the most recent 20 entries", async () => {
  const files = new Map();
  const readFile = async (file) => {
    if (!files.has(file)) { const error = new Error("missing"); error.code = "ENOENT"; throw error; }
    return files.get(file);
  };
  const writeFile = async (file, content) => { files.set(file, content); };
  const entry = (number) => ({ timestamp: `2026-01-${String(number).padStart(2, "0")}T00:00:00.000Z`, repositoryName: "demo", buildSystem: "Maven", coverageKind: "jacoco-report", coverageConfidence: "high", churnStatus: "available", rankedGapCount: number, stubsWritten: 1, skippedCount: 0 });
  const historyPath = await appendRunHistory(entry(1), { outputRoot: root, readFile, writeFile });
  assert.match(files.get(historyPath), /Ranked gaps: 1/);
  await appendRunHistory(entry(2), { outputRoot: root, readFile, writeFile });
  assert.ok(files.get(historyPath).indexOf("Ranked gaps: 2") < files.get(historyPath).indexOf("Ranked gaps: 1"));
  for (let number = 3; number <= 21; number += 1) await appendRunHistory(entry(number), { outputRoot: root, readFile, writeFile });
  const history = files.get(historyPath);
  assert.equal((history.match(/^### Run /gm) ?? []).length, MAX_HISTORY_ENTRIES);
  assert.match(history, /Ranked gaps: 21/);
  assert.doesNotMatch(history, /Ranked gaps: 1\n/);
  const entries = history.trim().split("\n\n---\n\n");
  assert.equal(entries.length, MAX_HISTORY_ENTRIES);
  assert.equal(entries.every((entryText) => !entryText.includes("---")), true);
});

test("preserves four entries without accumulating delimiters across appends", async () => {
  const files = new Map();
  const readFile = async (file) => {
    if (!files.has(file)) { const error = new Error("missing"); error.code = "ENOENT"; throw error; }
    return files.get(file);
  };
  const writeFile = async (file, content) => { files.set(file, content); };
  const entry = (number) => ({ timestamp: `2026-02-0${number}T00:00:00.000Z`, repositoryName: "demo", buildSystem: "Maven", coverageKind: "jacoco-report", coverageConfidence: "high", churnStatus: "available", rankedGapCount: number, stubsWritten: 1, skippedCount: 0 });
  let historyPath;
  for (let number = 1; number <= 4; number += 1) historyPath = await appendRunHistory(entry(number), { outputRoot: root, readFile, writeFile });
  const entries = files.get(historyPath).trim().split("\n\n---\n\n");
  assert.equal(entries.length, 4);
  assert.equal(entries.every((entryText) => !entryText.includes("---")), true);
  assert.deepEqual(entries, [4, 3, 2, 1].map((number) => [
    `### Run 2026-02-0${number}T00:00:00.000Z`,
    "Repository: demo",
    "Build system: Maven",
    "Coverage: jacoco-report (high confidence)",
    "Churn status: available",
    `Ranked gaps: ${number}`,
    "Stubs written: 1",
    "Stubs/files skipped: 0",
  ].join("\n")));
});

test("reads run history or reports an explicit no-history-yet status", async () => {
  const history = await readRunHistory({ outputRoot: root, readFile: async () => "### Run now\nRepository: demo\n" });
  assert.equal(history.status, "found");
  assert.equal(history.content, "### Run now\nRepository: demo\n");
  const missing = await readRunHistory({ outputRoot: root, readFile: async () => { const error = new Error("missing"); error.code = "ENOENT"; throw error; } });
  assert.equal(missing.status, NO_HISTORY_YET);
  assert.equal(missing.content, null);
});

test("summary reveals only the history path, not its entry content", () => {
  const secretEntry = "### Run 2026-01-01T00:00:00.000Z\\nRepository: private";
  const summary = formatOutputSummary({ outputRoot: root, writtenFiles: [], skipped: [], failures: [], historyPath: path.join(root, "HISTORY.md"), historyContent: secretEntry }).join("\n");
  assert.match(summary, /HISTORY\.md/);
  assert.doesNotMatch(summary, /Repository: private/);
  assert.doesNotMatch(summary, /### Run/);
});
