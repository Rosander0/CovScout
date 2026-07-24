import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { analyzeChurn, formatChurnSummary } from "../src/churn.js";

async function git(directory, arguments_, date) {
  await new Promise((resolve, reject) => {
    const child = spawn("git", arguments_, { cwd: directory, stdio: ["ignore", "ignore", "pipe"], env: date ? { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : process.env });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr)));
  });
}

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "covscout-churn-"));
  await git(directory, ["init"]);
  await git(directory, ["config", "user.email", "test@example.com"]);
  await git(directory, ["config", "user.name", "Covscout Test"]);
  await mkdir(path.join(directory, "demo"));
  await writeFile(path.join(directory, "demo", "Greeting.java"), "class Greeting {}\n");
  await writeFile(path.join(directory, "demo", "Stable.java"), "class Stable {}\n");
  await git(directory, ["add", "."]);
  await git(directory, ["commit", "-m", "initial"], "2026-01-01T00:00:00Z");
  await writeFile(path.join(directory, "demo", "Greeting.java"), "class Greeting { String hello() { return \"hi\"; } }\n");
  await git(directory, ["add", "."]);
  await git(directory, ["commit", "-m", "touch greeting"], "2026-07-01T00:00:00Z");
  return directory;
}

test("measures commit touches by coverage sourceFile, including confirmed zero-touch files", async () => {
  const directory = await fixture();
  try {
    const churn = await analyzeChurn(directory, [
      { sourceFile: "demo/Greeting.java" },
      { sourceFile: "demo/Stable.java" },
      { sourceFile: "demo/Missing.java" },
      { sourceFile: "demo/Greeting.java" },
    ], { now: new Date("2026-07-24T00:00:00Z") });
    assert.deepEqual(churn, [
      { sourceFile: "demo/Greeting.java", commitCount: 2, lastModified: "2026-07-01T00:00:00.000Z" },
      { sourceFile: "demo/Stable.java", commitCount: 1, lastModified: "2026-01-01T00:00:00.000Z" },
      { sourceFile: "demo/Missing.java", commitCount: 0, lastModified: null },
    ]);
    assert.equal(churn.window, "available-history");
    assert.match(formatChurnSummary(churn).join("\n"), /only 2 commits available/);
    assert.match(formatChurnSummary(churn).join("\n"), /Files with churn data: 3\/3/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("reports a confirmed zero touch as zero when churn data is available", async () => {
  const directory = await fixture();
  try {
    const churn = await analyzeChurn(directory, [{ sourceFile: "demo/NeverCommitted.java" }], { now: new Date("2026-07-24T00:00:00Z") });
    assert.equal(churn.status, "available");
    assert.deepEqual(churn, [{ sourceFile: "demo/NeverCommitted.java", commitCount: 0, lastModified: null }]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("caps a repository with more than 100 commits to its recent six-month churn window", async () => {
  const directory = await fixture();
  try {
    for (let commit = 0; commit < 99; commit += 1) {
      await writeFile(path.join(directory, "demo", "Greeting.java"), `class Greeting { int version() { return ${commit}; } }\n`);
      await git(directory, ["commit", "-am", `recent touch ${commit}`], "2026-07-01T00:00:00Z");
    }
    const churn = await analyzeChurn(directory, [{ sourceFile: "demo/Greeting.java" }], { now: new Date("2026-07-24T00:00:00Z") });
    const summary = formatChurnSummary(churn).join("\n");
    assert.equal(churn.window, "six-months-or-100-commits");
    assert.equal(churn.commitsAnalyzed, 100);
    assert.deepEqual(churn, [{ sourceFile: "demo/Greeting.java", commitCount: 100, lastModified: "2026-07-01T00:00:00.000Z" }]);
    assert.match(summary, /WARNING: Analyzed the most recent 100 commits within the last six months\./);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("reports git failures loudly without inventing zero churn", async () => {
  const churn = await analyzeChurn(path.join(os.tmpdir(), "covscout-missing-repository"), [{ sourceFile: "demo/Greeting.java" }]);
  assert.deepEqual(churn, [{ sourceFile: "demo/Greeting.java", commitCount: null, lastModified: null }]);
  assert.equal(churn.status, "unavailable");
  assert.match(formatChurnSummary(churn).join("\n"), /WARNING: Git churn data unavailable/);
});
