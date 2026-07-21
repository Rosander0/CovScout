import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { generateCoverageReport, inspectBuildFile } from "../src/coverage.js";

async function fixture(files) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "covscout-coverage-"));
  await Promise.all(Object.entries(files).map(async ([file, content]) => {
    const fullPath = path.join(directory, file);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content);
  }));
  return directory;
}

test("inspects a Maven JaCoCo execution and uses its configured lifecycle", async () => {
  const directory = await fixture({
    "pom.xml": `<project><build><plugins><plugin><artifactId>jacoco-maven-plugin</artifactId><executions><execution><phase>test</phase><goals><goal>report</goal></goals></execution></executions></plugin></plugins></build></project>`,
    "src/main/java/demo/Calculator.java": "public class Calculator { public int add(int a, int b) { return a + b; } }",
  });
  try {
    const inspected = await inspectBuildFile(directory, "Maven");
    assert.equal(inspected.jacocoConfigured, true);
    assert.equal(inspected.reportExecution.phase, "test");
    const result = await generateCoverageReport({ directory, buildSystem: "Maven" }, {
      commandRunner: async ({ command, args, cwd }) => {
        assert.deepEqual(args, ["test"]);
        assert.match(command, /mvn/);
        await mkdir(path.join(cwd, "target/site/jacoco"), { recursive: true });
        await writeFile(path.join(cwd, "target/site/jacoco/jacoco.xml"), "<report/>");
        return { code: 0, stdout: "tests passed", stderr: "" };
      },
    });
    assert.equal(result.kind, "jacoco-report");
    assert.equal(result.confidence, "high");
    await access(result.reportPath);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("does not treat a Maven pluginManagement declaration as active JaCoCo configuration", async () => {
  const directory = await fixture({
    "pom.xml": "<project><build><pluginManagement><plugins><plugin><artifactId>jacoco-maven-plugin</artifactId></plugin></plugins></pluginManagement></build></project>",
  });
  try {
    const inspected = await inspectBuildFile(directory, "Maven");
    assert.equal(inspected.jacocoConfigured, false);
    assert.equal(inspected.configurationLocation, "plugin-management-only");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("uses Gradle's jacocoTestReport task when the plugin is actually applied", async () => {
  const directory = await fixture({
    "build.gradle": "plugins { id 'java'; id 'jacoco' }",
    "src/main/java/demo/Widget.java": "public class Widget { public void run() {} }",
  });
  try {
    const result = await generateCoverageReport({ directory, buildSystem: "Gradle" }, {
      commandRunner: async ({ args, cwd }) => {
        assert.deepEqual(args, ["test", "jacocoTestReport"]);
        await mkdir(path.join(cwd, "build/reports/jacoco/test"), { recursive: true });
        await writeFile(path.join(cwd, "build/reports/jacoco/test/jacocoTestReport.xml"), "<report/>");
        return { code: 0, stdout: "BUILD SUCCESSFUL", stderr: "" };
      },
    });
    assert.equal(result.kind, "jacoco-report");
    assert.equal(result.jacocoConfigured, true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("adds JaCoCo only to a temporary Maven copy when absent", async () => {
  const directory = await fixture({
    "pom.xml": "<project><modelVersion>4.0.0</modelVersion></project>",
    "src/main/java/demo/Widget.java": "public class Widget { public void run() {} }",
  });
  try {
    const result = await generateCoverageReport({ directory, buildSystem: "Maven" }, {
      commandRunner: async ({ cwd }) => {
        assert.notEqual(cwd, directory);
        const copiedPom = await (await import("node:fs/promises")).readFile(path.join(cwd, "pom.xml"), "utf8");
        assert.match(copiedPom, /covscout temporary JaCoCo configuration/);
        await mkdir(path.join(cwd, "target/site/jacoco"), { recursive: true });
        await writeFile(path.join(cwd, "target/site/jacoco/jacoco.xml"), "<report/>");
        return { code: 0, stdout: "", stderr: "" };
      },
    });
    assert.equal(result.kind, "jacoco-report");
    assert.equal(result.jacocoConfigured, false);
    assert.doesNotMatch(await (await import("node:fs/promises")).readFile(path.join(directory, "pom.xml"), "utf8"), /covscout temporary/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("removes the temporary workspace after successfully persisting its JaCoCo report", async () => {
  const directory = await fixture({
    "pom.xml": "<project><modelVersion>4.0.0</modelVersion></project>",
    "src/main/java/demo/Widget.java": "public class Widget { public void run() {} }",
  });
  let temporaryRoot;
  try {
    const result = await generateCoverageReport({ directory, buildSystem: "Maven" }, {
      commandRunner: async ({ cwd }) => {
        temporaryRoot = path.dirname(cwd);
        await mkdir(path.join(cwd, "target/site/jacoco"), { recursive: true });
        await writeFile(path.join(cwd, "target/site/jacoco/jacoco.xml"), "<report/>");
        return { code: 0, stdout: "", stderr: "" };
      },
    });
    await access(result.reportPath);
    await assert.rejects(() => access(temporaryRoot));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("falls back loudly to static heuristics after a failed build", async () => {
  const directory = await fixture({
    "pom.xml": "<project><modelVersion>4.0.0</modelVersion></project>",
    "src/main/java/demo/Widget.java": "public class Widget { public void uncovered() {} public void covered() {} }",
    "src/test/java/demo/WidgetTest.java": "class WidgetTest { void testCovered() {} }",
  });
  try {
    const result = await generateCoverageReport({ directory, buildSystem: "Maven" }, {
      commandRunner: async () => ({ code: 1, stdout: "Downloading dependencies", stderr: "JDK 21 is required" }),
    });
    assert.deepEqual({ kind: result.kind, confidence: result.confidence }, { kind: "static-heuristic", confidence: "low" });
    assert.match(result.reason, /exited with code 1/);
    assert.match(result.outputTail, /JDK 21 is required/);
    assert.deepEqual(result.gaps.map((gap) => gap.method), ["uncovered"]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
