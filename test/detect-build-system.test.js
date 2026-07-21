import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { detectBuildSystem } from "../src/detect-build-system.js";
import { formatIntakeSummary } from "../src/summary.js";

async function fixture(files) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "covscout-test-"));
  await Promise.all(files.map(async (file) => {
    const fullPath = path.join(directory, file);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, "fixture");
  }));
  return directory;
}

test("detects Maven only after finding pom.xml and Java source", async () => {
  const directory = await fixture(["pom.xml", "src/main/java/example/App.java"]);
  try { assert.deepEqual(await detectBuildSystem(directory), { buildSystem: "Maven", scanTruncated: false }); }
  finally { await rm(directory, { recursive: true, force: true }); }
});

test("rejects a repository without a supported build file", async () => {
  const directory = await fixture(["README.md", "src/main/java/example/App.java"]);
  try {
    await assert.rejects(() => detectBuildSystem(directory), {
      message: "No supported Java build file found at the repository root (expected pom.xml, build.gradle, or build.gradle.kts).",
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("rejects a supported build whose scanned source is not primarily Java", async () => {
  const directory = await fixture(["pom.xml", "src/main/java/example/App.java", "src/main/kotlin/example/App.kt", "src/main/kotlin/example/Other.kt"]);
  try {
    await assert.rejects(() => detectBuildSystem(directory), {
      message: "A supported build file was found, but the scanned source files are not primarily Java (1 Java, 2 other language files); covscout supports primarily Java projects only.",
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("keeps the complete-scan no-Java rejection message unchanged", async () => {
  const directory = await fixture(["pom.xml", "README.md"]);
  try {
    await assert.rejects(() => detectBuildSystem(directory), {
      message: "A supported build file was found, but no Java source files were detected in the repository; covscout supports primarily Java projects only.",
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("warns when a truncated scan causes a source-based rejection", async () => {
  const noJavaDirectory = await fixture(["pom.xml", "module-a/A.java", "module-b/B.java"]);
  const nonJavaDirectory = await fixture([
    "pom.xml",
    "module-w/Other.java",
    "module-x/Other.kt",
    "module-y/Another.kt",
    "module-z/App.java",
  ]);
  try {
    await assert.rejects(() => detectBuildSystem(noJavaDirectory, { scanLimit: 1 }), {
      message: /no Java source files were detected.*scan was incomplete.*rejection may not reflect the whole repository/,
    });
    await assert.rejects(() => detectBuildSystem(nonJavaDirectory, { scanLimit: 4 }), {
      message: /not primarily Java.*scan was incomplete.*rejection may not reflect the whole repository/,
    });
  } finally {
    await rm(noJavaDirectory, { recursive: true, force: true });
    await rm(nonJavaDirectory, { recursive: true, force: true });
  }
});

test("reports a capped source scan in the detection result and CLI summary", async () => {
  const directory = await fixture(["pom.xml", "module-a/A.java", "module-b/B.java", "module-c/C.java"]);
  try {
    const detection = await detectBuildSystem(directory, { scanLimit: 2 });
    assert.deepEqual(detection, { buildSystem: "Maven", scanTruncated: true });
    const summary = formatIntakeSummary({ repositoryName: "fixture", directory, ...detection }).join("\n");
    assert.match(summary, /WARNING: Java source scan was capped/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
