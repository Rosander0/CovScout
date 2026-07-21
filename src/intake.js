import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { detectBuildSystem } from "./detect-build-system.js";
import { IntakeError } from "./errors.js";
import { parseGitHubUrl } from "./github-url.js";

export async function intakeRepository(githubUrl) {
  const { cloneUrl, repositoryName } = parseGitHubUrl(githubUrl);
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "covscout-"));
  const destination = path.join(temporaryRoot, repositoryName);
  try {
    await runGit(["clone", "--depth", "10", cloneUrl, destination]);
    const detection = await detectBuildSystem(destination);
    return { repositoryName, ...detection, directory: destination };
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

function runGit(arguments_) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", arguments_, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", () => reject(new IntakeError("Unable to run git. Install Git and ensure it is available on PATH.")));
    child.on("close", (code) => code === 0 ? resolve() : reject(new IntakeError(`Git clone failed${stderr.trim() ? `: ${stderr.trim()}` : ""}`)));
  });
}
