import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseCoverageReport, parseJacocoXml } from "../src/coverage-parser.js";

const REPORT = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE report PUBLIC "-//JACOCO//DTD Report 1.1//EN" "report.dtd"><report name="demo"><sessioninfo id="x" start="1" dump="2"/><package name="demo"><class name="demo/Greeting" sourcefilename="Greeting.java"><method name="hello" desc="()Ljava/lang/String;" line="3"><counter type="INSTRUCTION" missed="0" covered="2"/><counter type="LINE" missed="0" covered="1"/><counter type="METHOD" missed="0" covered="1"/></method><method name="choose" desc="(Z)Ljava/lang/String;" line="4"><counter type="INSTRUCTION" missed="2" covered="2"/><counter type="BRANCH" missed="1" covered="1"/><counter type="LINE" missed="1" covered="1"/><counter type="METHOD" missed="0" covered="1"/></method><counter type="INSTRUCTION" missed="2" covered="4"/><counter type="BRANCH" missed="1" covered="1"/><counter type="LINE" missed="1" covered="2"/><counter type="METHOD" missed="0" covered="2"/><counter type="CLASS" missed="0" covered="1"/></class><sourcefile name="Greeting.java"><line nr="3" mi="0" ci="2" mb="0" cb="0"/><line nr="4" mi="0" ci="2" mb="1" cb="1"/><line nr="5" mi="2" ci="0" mb="0" cb="0"/><counter type="INSTRUCTION" missed="2" covered="4"/><counter type="BRANCH" missed="1" covered="1"/><counter type="LINE" missed="1" covered="2"/></sourcefile></package></report>`;

test("parses JaCoCo's class, method, line, and branch counters", () => {
  const parsed = parseJacocoXml(REPORT, { confidence: "high", reportPath: "jacoco.xml" });
  assert.equal(parsed.status, "available");
  assert.equal(parsed.classes[0].name, "demo.Greeting");
  assert.deepEqual(parsed.classes[0].coverage.line, { missed: 1, covered: 2, total: 3, percentage: 2 / 3 });
  assert.deepEqual(parsed.classes[0].methods[1].coverage.branch, { missed: 1, covered: 1, total: 2, percentage: 0.5 });
  assert.equal(parsed.classes[0].lines[1].number, 4);
  assert.deepEqual(parsed.summary.line, { missed: 1, covered: 2, total: 3, percentage: 2 / 3 });
});

test("normalizes static heuristic gaps without inventing coverage", async () => {
  const parsed = await parseCoverageReport({ kind: "static-heuristic", confidence: "low", reason: "Build failed.", gaps: [{ file: "src/main/java/demo/Greeting.java", className: "Greeting", method: "hello", reason: "No similarly named test method was found in src/test." }] });
  assert.equal(parsed.source, "static-heuristic");
  assert.equal(parsed.heuristic, true);
  assert.equal(parsed.classes[0].methods[0].coverage.line.percentage, null);
});

test("returns explicit unavailable data for malformed JaCoCo XML", () => {
  const parsed = parseJacocoXml("<report><package></report>");
  assert.equal(parsed.status, "unavailable");
  assert.match(parsed.warnings[0], /Malformed or unexpected/);
});

test("rejects XML that is well formed but not part of the JaCoCo report schema", () => {
  const parsed = parseJacocoXml('<report name="demo"><package name="demo"><unexpected/></package></report>');
  assert.equal(parsed.status, "unavailable");
  assert.match(parsed.warnings[0], /Unexpected <unexpected>/);
});

test("returns explicit unavailable data when its report cannot be read", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "covscout-parser-"));
  try {
    const parsed = await parseCoverageReport({ kind: "jacoco-report", confidence: "high", reportPath: path.join(directory, "missing.xml") });
    assert.equal(parsed.status, "unavailable");
    assert.match(parsed.warnings[0], /Unable to read/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
