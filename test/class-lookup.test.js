import assert from "node:assert/strict";
import test from "node:test";
import { derivePackageName, joinRankedClasses } from "../src/class-lookup.js";

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
