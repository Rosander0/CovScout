import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { formatStubOutputSummary, resolveStubOutputPaths } from "../src/stub-output.js";

const outputRoot = path.resolve("covscout-output");
const stub = (className, packageName) => ({ className, packageName, source: "// generated source" });

test("uses package-qualified paths for same simple names in different packages", () => {
  const resolutions = resolveStubOutputPaths([
    stub("com.foo.Widget", "com.foo"),
    stub("com.bar.Widget", "com.bar"),
  ], outputRoot, { existsSync: () => false });

  assert.equal(resolutions[0].relativePath, path.join("com", "foo", "WidgetStubTest.java"));
  assert.equal(resolutions[1].relativePath, path.join("com", "bar", "WidgetStubTest.java"));
  assert.notEqual(resolutions[0].absolutePath, resolutions[1].absolutePath);
  assert.equal(resolutions[0].collision, false);
  assert.equal(resolutions[1].collision, false);
});

test("reports an existing target and checks fallback candidates", () => {
  const intended = path.resolve(outputRoot, "demo", "WidgetStubTest.java");
  const firstFallback = path.resolve(outputRoot, "demo", "WidgetStubTest-2.java");
  const checked = [];
  const resolutions = resolveStubOutputPaths([stub("demo.Widget", "demo")], outputRoot, {
    existsSync(candidate) {
      checked.push(candidate);
      return candidate === intended || candidate === firstFallback;
    },
  });

  assert.equal(resolutions[0].collision, true);
  assert.match(resolutions[0].collisionReason, /existing filesystem entry/i);
  assert.equal(resolutions[0].relativePath, path.join("demo", "WidgetStubTest-3.java"));
  assert.ok(checked.includes(firstFallback));
  assert.ok(checked.includes(resolutions[0].absolutePath));
});

test("flags every same-call duplicate and allocates separate fallback paths", () => {
  const resolutions = resolveStubOutputPaths([
    stub("demo.Widget", "demo"),
    stub("demo.Widget", "demo"),
  ], outputRoot, { existsSync: () => false });

  assert.equal(resolutions[0].collision, true);
  assert.equal(resolutions[1].collision, true);
  assert.match(resolutions[1].collisionReason, /stub #1.*stub #2/i);
  assert.equal(resolutions[0].relativePath, path.join("demo", "WidgetStubTest-2.java"));
  assert.equal(resolutions[1].relativePath, path.join("demo", "WidgetStubTest-3.java"));
});

test("puts default-package stubs directly below the output root", () => {
  const [resolution] = resolveStubOutputPaths([stub("Widget", null)], outputRoot, { existsSync: () => false });

  assert.equal(resolution.relativePath, "WidgetStubTest.java");
  assert.equal(resolution.absolutePath, path.resolve(outputRoot, "WidgetStubTest.java"));
  assert.equal(resolution.collision, false);
});

test("formats warnings with both intended and fallback paths", () => {
  const intended = path.resolve(outputRoot, "demo", "WidgetStubTest.java");
  const resolutions = resolveStubOutputPaths([stub("demo.Widget", "demo")], outputRoot, { existsSync: (candidate) => candidate === intended });
  const summary = formatStubOutputSummary(resolutions).join("\n");

  assert.match(summary, /WARNING:/);
  assert.match(summary, /WidgetStubTest\.java/);
  assert.match(summary, /WidgetStubTest-2\.java/);
});
