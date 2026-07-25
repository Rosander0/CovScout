import assert from "node:assert/strict";
import test from "node:test";
import { formatStubSummary, generateTestStubs } from "../src/stubs.js";

function rankedFor(classRecord) {
  return { ranked: [{ name: classRecord.name, sourceFile: classRecord.sourceFile }] };
}

test("generates a stub only for a measured zero-coverage method", () => {
  const classRecord = {
    name: "demo.Widget", sourceFile: "src/main/java/demo/Widget.java", heuristic: false,
    methods: [
      { name: "untested", coverage: { line: { percentage: 0 } } },
      { name: "partlyTested", coverage: { line: { percentage: 0.5 } } },
    ],
  };

  const result = generateTestStubs(rankedFor(classRecord), [classRecord]);

  assert.match(result.stubs[0].source, /void testUntested_todo\(\)/);
  assert.doesNotMatch(result.stubs[0].source, /partlyTested/);
  assert.deepEqual(result.stubs[0].methods[1], { name: "partlyTested", status: "skipped", reason: "Method has partial measured line coverage." });
});

test("skips unknown measured coverage rather than calling it untested", () => {
  const classRecord = {
    name: "demo.Unknown", sourceFile: "src/main/java/demo/Unknown.java", heuristic: false,
    methods: [{ name: "synthetic", coverage: { line: { percentage: null } } }],
  };

  const result = generateTestStubs(rankedFor(classRecord), [classRecord]);

  assert.equal(result.stubs.length, 0);
  assert.match(result.skippedClasses[0].reason, /unknown, not confirmed untested/);
});

test("generates every static-heuristic method and retains its gap reason", () => {
  const classRecord = {
    name: "demo.Heuristic", sourceFile: "src/main/java/demo/Heuristic.java", heuristic: true,
    methods: [
      { name: "firstGap", gapReason: "No similarly named test method was found." },
      { name: "secondGap", gapReason: "Public API lacked test evidence." },
    ],
  };

  const result = generateTestStubs(rankedFor(classRecord), [classRecord]);

  assert.match(result.stubs[0].source, /testFirstGap_todo/);
  assert.match(result.stubs[0].source, /No similarly named test method was found\./);
  assert.match(result.stubs[0].source, /Public API lacked test evidence\./);
});

test("reports a ranked class with no stubbable methods instead of dropping it", () => {
  const classRecord = {
    name: "demo.Covered", sourceFile: "src/main/java/demo/Covered.java", heuristic: false,
    methods: [{ name: "covered", coverage: { line: { percentage: 1 } } }],
  };

  const result = generateTestStubs(rankedFor(classRecord), [classRecord]);

  assert.equal(result.stubs.length, 0);
  assert.equal(result.skippedClasses[0].className, "demo.Covered");
  assert.match(result.skippedClasses[0].reason, /No stubs|All 1 method/);
});

test("derives a conventional package and loudly omits an unknown package", () => {
  const packaged = {
    name: "demo.Widget", sourceFile: "module/src/test/java/demo/Widget.java", heuristic: true,
    methods: [{ name: "gap", gapReason: "Likely gap." }],
  };
  const unrooted = {
    name: "FlatWidget", sourceFile: "lib/FlatWidget.java", heuristic: true,
    methods: [{ name: "gap", gapReason: "Likely gap." }],
  };

  const result = generateTestStubs({ ranked: [
    { name: packaged.name, sourceFile: packaged.sourceFile },
    { name: unrooted.name, sourceFile: unrooted.sourceFile },
  ] }, [packaged, unrooted]);

  assert.match(result.stubs[0].source, /^package demo;/);
  assert.doesNotMatch(result.stubs[1].source, /^package /m);
  assert.match(result.stubs[1].packageReason, /could not be determined/);
});

test("uses the measured JaCoCo package name instead of deriving one from the source path", () => {
  const classRecord = {
    name: "actual.xml.package.Widget", sourceFile: "src/main/java/path/that/disagrees/Widget.java",
    packageName: "actual.xml.package", heuristic: false,
    methods: [{ name: "gap", coverage: { line: { percentage: 0 } } }],
  };

  const result = generateTestStubs(rankedFor(classRecord), [classRecord]);

  assert.equal(result.stubs[0].packageName, "actual.xml.package");
  assert.match(result.stubs[0].source, /^package actual\.xml\.package;/);
  assert.doesNotMatch(result.stubs[0].source, /^package path\.that\.disagrees;/m);
});

test("recognizes an empty measured package name as the known Java default package", () => {
  const classRecord = {
    name: "DefaultPackageWidget", sourceFile: "nonstandard/DefaultPackageWidget.java",
    packageName: "", heuristic: false,
    methods: [{ name: "gap", coverage: { line: { percentage: 0 } } }],
  };

  const result = generateTestStubs(rankedFor(classRecord), [classRecord]);

  assert.equal(result.stubs[0].packageName, "");
  assert.equal(result.stubs[0].packageReason, null);
  assert.doesNotMatch(result.stubs[0].source, /^package /m);
});

test("uses the StubTest suffix and never turns a constructor into a test", () => {
  const classRecord = {
    name: "demo.Widget", sourceFile: "src/main/java/demo/Widget.java", heuristic: false,
    methods: [
      { name: "<init>", coverage: { line: { percentage: 0 } } },
      { name: "work", coverage: { line: { percentage: 0 } } },
    ],
  };

  const result = generateTestStubs(rankedFor(classRecord), [classRecord]);

  assert.match(result.stubs[0].source, /class WidgetStubTest/);
  assert.doesNotMatch(result.stubs[0].source, /class WidgetTest/);
  assert.doesNotMatch(result.stubs[0].source, /<init>/);
  assert.equal(result.stubs[0].methods[0].reason, "Constructors are not stubbed.");
});

test("formats per-class method counts and skipped-method reasons", () => {
  const classRecord = {
    name: "demo.Widget", sourceFile: "src/main/java/demo/Widget.java", heuristic: false,
    methods: [
      { name: "gap", coverage: { line: { percentage: 0 } } },
      { name: "partial", coverage: { line: { percentage: 0.5 } } },
    ],
  };
  const summary = formatStubSummary(generateTestStubs(rankedFor(classRecord), [classRecord])).join("\n");

  assert.match(summary, /1 methods stubbed; 1 skipped/);
  assert.match(summary, /Skipped partial: Method has partial measured line coverage/);
});
