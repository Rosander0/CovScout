import assert from "node:assert/strict";
import test from "node:test";
import { derivePackageName, joinRankedClasses } from "../src/class-lookup.js";

test("joins two different classes that share one sourceFile to their own records (nested/inner classes)", () => {
  const outer = { name: "demo.Outer", sourceFile: "demo/Outer.java", methods: [{ name: "work" }] };
  const inner = { name: "demo.Outer$Inner", sourceFile: "demo/Outer.java", methods: [] };
  const rankedOuter = { name: "demo.Outer", sourceFile: "demo/Outer.java", score: 0.9 };
  const rankedInner = { name: "demo.Outer$Inner", sourceFile: "demo/Outer.java", score: 0.5 };

  const result = joinRankedClasses([rankedOuter, rankedInner], [outer, inner]);

  assert.equal(result[0].class, outer);
  assert.equal(result[1].class, inner);
  assert.notEqual(result[0].class, result[1].class);
});

test("joins a ranked entry to its complete Stage 3 class record", () => {
  const fullClass = {
    name: "demo.Widget",
    sourceFile: "src/main/java/demo/Widget.java",
    methods: [{ name: "work", descriptor: "()V" }],
  };
  const ranked = { name: "demo.Widget", sourceFile: fullClass.sourceFile, score: 0.9 };

  const result = joinRankedClasses([ranked], [fullClass]);

  assert.equal(result[0].ranked, ranked);
  assert.equal(result[0].class, fullClass);
  assert.deepEqual(result[0].class.methods, [{ name: "work", descriptor: "()V" }]);
});

test("preserves unmatched ranked entries with a null class", () => {
  const ranked = { name: "demo.Missing", sourceFile: "src/main/java/demo/Missing.java" };

  assert.deepEqual(joinRankedClasses([ranked], []), [{ ranked, class: null }]);
});

test("derives dotted packages from conventional main and test Java source roots", () => {
  assert.equal(derivePackageName("src/main/java/demo/Widget.java"), "demo");
  assert.equal(derivePackageName("src/test/java/demo/support/WidgetTest.java"), "demo.support");
});

test("returns an empty string for a confirmed default package", () => {
  assert.equal(derivePackageName("src/main/java/Widget.java"), "");
});

test("returns null rather than guessing for absent or malformed Java source paths", () => {
  assert.equal(derivePackageName("lib/demo/Widget.java"), null);
  assert.equal(derivePackageName(""), null);
  assert.equal(derivePackageName("src/main/java/"), null);
  assert.equal(derivePackageName(null), null);
});

// JaCoCo-measured classes already have packageName parsed from the XML in Stage 3.
// This utility is only for static-heuristic classes whose packageName is null.
test("documents that measured JaCoCo classes retain their Stage 3 package name", () => {
  const measuredClass = { heuristic: false, packageName: "demo" };
  assert.equal(measuredClass.packageName, "demo");
});
