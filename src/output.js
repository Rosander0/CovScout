import { mkdir as filesystemMkdir, readFile as filesystemReadFile, writeFile as filesystemWriteFile } from "node:fs/promises";
import path from "node:path";
import { formatStubOutputSummary, resolveStubOutputPaths } from "./stub-output.js";

export const HISTORY_FILENAME = "HISTORY.md";
export const MAX_HISTORY_ENTRIES = 20;
export const NO_HISTORY_YET = "no-history-yet";
const HISTORY_ENTRY_DELIMITER = "\n\n---\n\n";

export async function writeOutput(rankedResult, stubResult, stageSummaries, {
  outputRoot = path.join(process.cwd(), "covscout-output"),
  mkdir = filesystemMkdir,
  readFile = filesystemReadFile,
  writeFile = filesystemWriteFile,
  resolvePaths = resolveStubOutputPaths,
  historyEntry,
} = {}) {
  void rankedResult;
  const result = { outputRoot, writtenFiles: [], skipped: [], failures: [] };

  try {
    await mkdir(outputRoot, { recursive: true });
  } catch (error) {
    const reason = `Unable to create output root: ${error.message}`;
    result.failures.push({ path: outputRoot, reason });
    return result;
  }

  const stubs = Array.isArray(stubResult?.stubs) ? stubResult.stubs : [];
  const resolutions = resolvePaths(stubs, outputRoot);
  for (const [index, resolution] of resolutions.entries()) {
    const stub = stubs[index];
    if (!resolution.absolutePath) {
      result.skipped.push({
        className: resolution.className,
        path: resolution.intendedAbsolutePath,
        reason: resolution.collisionReason ?? "No available output path was resolved.",
      });
      continue;
    }
    try {
      await mkdir(path.dirname(resolution.absolutePath), { recursive: true });
      await writeFile(resolution.absolutePath, stub?.source ?? "", "utf8");
      result.writtenFiles.push(resolution.absolutePath);
    } catch (error) {
      result.skipped.push({
        className: resolution.className,
        path: resolution.absolutePath,
        reason: `Unable to write stub: ${error.message}`,
      });
    }
  }

  const reportPath = path.join(outputRoot, "REPORT.md");
  try {
    await writeFile(reportPath, markdownReport(stageSummaries, formatStubOutputSummary(resolutions)), "utf8");
    result.writtenFiles.push(reportPath);
  } catch (error) {
    result.failures.push({ path: reportPath, reason: `Unable to write report: ${error.message}` });
  }
  try {
    result.historyPath = await appendRunHistory({
      ...(historyEntry ?? {}),
      skippedCount: (historyEntry?.skippedCount ?? 0) + result.skipped.length,
    }, { outputRoot, readFile, writeFile });
  } catch (error) {
    const historyPath = path.join(outputRoot, HISTORY_FILENAME);
    result.failures.push({ path: historyPath, reason: `Unable to update run history: ${error.message}` });
  }
  return result;
}

// Entries are newest-first, so retaining the first MAX_HISTORY_ENTRIES keeps
// the most recent runs and drops the oldest entries from the end of the file.
export async function appendRunHistory(entry, {
  outputRoot = path.join(process.cwd(), "covscout-output"),
  readFile = filesystemReadFile,
  writeFile = filesystemWriteFile,
} = {}) {
  const historyPath = path.join(outputRoot, HISTORY_FILENAME);
  let prior = "";
  try {
    prior = await readFile(historyPath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  // writeFile adds one trailing newline; trim only the whole file to remove it
  // before splitting, preserving every stored entry exactly as it was written.
  const entries = prior.trim().split(HISTORY_ENTRY_DELIMITER).filter(Boolean);
  const content = [formatHistoryEntry(entry), ...entries].slice(0, MAX_HISTORY_ENTRIES).join(HISTORY_ENTRY_DELIMITER);
  await writeFile(historyPath, `${content}\n`, "utf8");
  return historyPath;
}

export async function readRunHistory({
  outputRoot = path.join(process.cwd(), "covscout-output"),
  readFile = filesystemReadFile,
} = {}) {
  const historyPath = path.join(outputRoot, HISTORY_FILENAME);
  try {
    return { status: "found", content: await readFile(historyPath, "utf8"), path: historyPath };
  } catch (error) {
    if (error?.code === "ENOENT") return { status: NO_HISTORY_YET, content: null, path: historyPath };
    throw error;
  }
}

export function formatOutputSummary(outputResult) {
  const result = outputResult && typeof outputResult === "object" ? outputResult : {};
  const lines = ["Output writing complete", `Output root: ${result.outputRoot ?? "unavailable"}`];
  for (const file of result.writtenFiles ?? []) lines.push(`Wrote: ${file}`);
  for (const skipped of result.skipped ?? []) lines.push(`WARNING: Skipped ${skipped.className ?? "file"} at ${skipped.path ?? "unavailable path"}: ${skipped.reason}`);
  for (const failure of result.failures ?? []) lines.push(`WARNING: Failed ${failure.path ?? "output"}: ${failure.reason}`);
  if (result.historyPath) lines.push(`Run history updated: ${result.historyPath}`);
  return lines;
}

function formatHistoryEntry(entry) {
  const value = entry && typeof entry === "object" ? entry : {};
  return [
    `### Run ${value.timestamp ?? new Date().toISOString()}`,
    `Repository: ${value.repositoryName ?? "unavailable"}`,
    `Build system: ${value.buildSystem ?? "unavailable"}`,
    `Coverage: ${value.coverageKind ?? "unavailable"} (${value.coverageConfidence ?? "unavailable"} confidence)`,
    `Churn status: ${value.churnStatus ?? "unavailable"}`,
    `Ranked gaps: ${value.rankedGapCount ?? 0}`,
    `Stubs written: ${value.stubsWritten ?? 0}`,
    `Stubs/files skipped: ${value.skippedCount ?? 0}`,
  ].join("\n");
}

function markdownReport(stageSummaries, stubOutputLines) {
  const sections = Object.entries(stageSummaries && typeof stageSummaries === "object" ? stageSummaries : {});
  sections.push(["Stub output path resolution", stubOutputLines]);
  return ["# covscout report", ...sections.flatMap(([stageName, lines]) => [
    `## ${stageName}`,
    "```text",
    ...(Array.isArray(lines) ? lines : []),
    "```",
    "",
  ])].join("\n");
}
