import { existsSync } from "node:fs";
import { access, copyFile, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const OUTPUT_TAIL_LENGTH = 4_000;
const SKIPPED_DIRECTORIES = new Set([".git", ".gradle", "build", "target", "node_modules", "out"]);

/**
 * Runs a Java build and makes a JaCoCo XML report available for Stage 3.
 * It deliberately returns a low-confidence, static result on build failures
 * instead of throwing: downstream stages must preserve that distinction.
 */
export async function generateCoverageReport(intake, {
  timeoutMs = DEFAULT_TIMEOUT_MS,
  commandRunner = runCommand,
} = {}) {
  const build = await inspectBuildFile(intake.directory, intake.buildSystem);
  let buildDirectory = intake.directory;

  if (!build.jacocoConfigured) {
    buildDirectory = await createTemporaryJacocoWorkspace(intake.directory, build);
  }

  const command = chooseBuildCommand(build, buildDirectory);
  const execution = await commandRunner({ ...command, cwd: buildDirectory, timeoutMs });
  let reportPath = execution.code === 0 && !execution.timedOut
    ? await findJacocoXml(buildDirectory, intake.buildSystem)
    : undefined;

  if (reportPath) {
    if (buildDirectory !== intake.directory) {
      try {
        reportPath = await persistTemporaryReport(reportPath, intake.directory);
      } finally {
        await rm(path.dirname(buildDirectory), { recursive: true, force: true });
      }
    }
    return {
      kind: "jacoco-report",
      confidence: "high",
      reportPath,
      buildSystem: intake.buildSystem,
      jacocoConfigured: build.jacocoConfigured,
      command: [command.command, ...command.args],
    };
  }

  if (buildDirectory !== intake.directory) await rm(path.dirname(buildDirectory), { recursive: true, force: true });

  const reason = execution.timedOut
    ? `Build timed out after ${timeoutMs}ms.`
    : execution.code !== 0
      ? `Build command exited with code ${execution.code}.`
      : "Build completed but no JaCoCo XML report was found.";
  return {
    kind: "static-heuristic",
    confidence: "low",
    reason,
    buildSystem: intake.buildSystem,
    jacocoConfigured: build.jacocoConfigured,
    command: [command.command, ...command.args],
    outputTail: tail(`${execution.stdout ?? ""}${execution.stderr ?? ""}`),
    gaps: await findLikelyUntestedPublicMethods(intake.directory),
  };
}

export async function inspectBuildFile(directory, buildSystem) {
  const filename = buildSystem === "Maven" ? "pom.xml" : await gradleBuildFilename(directory);
  const file = path.join(directory, filename);
  const content = await readFile(file, "utf8");
  if (buildSystem === "Maven") {
    // pluginManagement supplies defaults to children; it does not activate a
    // plugin in this project. Inspect only active plugin declarations.
    const activeContent = content.replace(/<pluginManagement\b[^>]*>[\s\S]*?<\/pluginManagement>/gi, "");
    const plugins = pluginBlocks(activeContent).filter((plugin) =>
      /<artifactId>\s*jacoco-maven-plugin\s*<\/artifactId>/i.test(plugin));
    const pluginManagementOnly = plugins.length === 0
      && /<pluginManagement\b[^>]*>[\s\S]*?<artifactId>\s*jacoco-maven-plugin\s*<\/artifactId>[\s\S]*?<\/pluginManagement>/i.test(content);
    const reportExecutions = plugins.flatMap(executionsFor).filter((execution) =>
      execution.goals.includes("report") || execution.goals.includes("report-aggregate"));
    const reportExecution = reportExecutions.find((execution) => execution.phase) ?? reportExecutions[0];
    return {
      buildSystem,
      filename,
      file,
      content,
      jacocoConfigured: plugins.length > 0,
      configurationLocation: plugins.length > 0 ? "active-plugin" : pluginManagementOnly ? "plugin-management-only" : "absent",
      reportExecution,
    };
  }
  return {
    buildSystem,
    filename,
    file,
    content,
    jacocoConfigured: /(?:id\s*[('\"]jacoco[)'\"]|apply\s+plugin:\s*["']jacoco["']|apply\s*\(\s*plugin\s*=\s*["']jacoco["']\s*\))/i.test(content),
    reportWiredToTest: /jacocoTestReport[\s\S]{0,500}(?:finalizedBy|dependsOn)/i.test(content),
  };
}

function chooseBuildCommand(build, directory) {
  if (build.buildSystem === "Maven") {
    if (build.reportExecution?.phase) {
      return { command: mavenCommand(directory), args: [build.reportExecution.phase] };
    }
    if (build.reportExecution) {
      const reportGoal = build.reportExecution.goals.find((goal) => goal === "report" || goal === "report-aggregate");
      return { command: mavenCommand(directory), args: ["test", `jacoco:${reportGoal}`] };
    }
    return { command: mavenCommand(directory), args: ["test", "jacoco:report"] };
  }
  return { command: gradleCommand(directory), args: ["test", "jacocoTestReport"] };
}

function pluginBlocks(content) {
  return [...content.matchAll(/<plugin\b[^>]*>([\s\S]*?)<\/plugin>/gi)].map((match) => match[0]);
}

function executionsFor(plugin) {
  return [...plugin.matchAll(/<execution\b[^>]*>([\s\S]*?)<\/execution>/gi)].map((match) => {
    const execution = match[0];
    return {
      id: tagValue(execution, "id"),
      phase: tagValue(execution, "phase"),
      goals: [...execution.matchAll(/<goal>\s*([^<\s]+)\s*<\/goal>/gi)].map((goal) => goal[1].toLowerCase()),
    };
  });
}

function tagValue(content, tag) {
  return new RegExp(`<${tag}>\\s*([^<]+?)\\s*</${tag}>`, "i").exec(content)?.[1]?.trim();
}

async function createTemporaryJacocoWorkspace(sourceDirectory, build) {
  const copyDirectory = await mkdtemp(path.join(os.tmpdir(), "covscout-jacoco-"));
  const destination = path.join(copyDirectory, path.basename(sourceDirectory));
  await cp(sourceDirectory, destination, {
    recursive: true,
    filter: (from) => !SKIPPED_DIRECTORIES.has(path.basename(from)),
  });
  const buildFile = path.join(destination, build.filename);
  const original = await readFile(buildFile, "utf8");
  await writeFile(buildFile, addTemporaryJacoco(build, original), "utf8");
  return destination;
}

function addTemporaryJacoco(build, content) {
  const marker = "\n<!-- covscout temporary JaCoCo configuration -->\n";
  if (build.buildSystem === "Maven") {
    const plugin = `<plugin><groupId>org.jacoco</groupId><artifactId>jacoco-maven-plugin</artifactId><version>0.8.12</version><executions><execution><goals><goal>prepare-agent</goal><goal>report</goal></goals></execution></executions></plugin>`;
    if (/<\/plugins>/i.test(content)) return content.replace(/<\/plugins>/i, `${plugin}</plugins>${marker}`);
    if (/<\/build>/i.test(content)) return content.replace(/<\/build>/i, `<plugins>${plugin}</plugins></build>${marker}`);
    return content.replace(/<\/project>/i, `<build><plugins>${plugin}</plugins></build></project>${marker}`);
  }
  return build.filename.endsWith(".kts")
    ? `${content}\n// covscout temporary JaCoCo configuration\napply(plugin = "jacoco")\ntasks.jacocoTestReport { reports { xml.required.set(true) } }\n`
    : `${content}\n// covscout temporary JaCoCo configuration\napply plugin: 'jacoco'\njacocoTestReport { reports { xml.required = true } }\n`;
}

async function findJacocoXml(directory, buildSystem) {
  const candidates = buildSystem === "Maven"
    ? ["target/site/jacoco/jacoco.xml", "target/site/jacoco-aggregate/jacoco.xml"]
    : ["build/reports/jacoco/test/jacocoTestReport.xml"];
  for (const candidate of candidates) {
    const report = path.join(directory, candidate);
    try { await access(report); return report; } catch { /* keep looking */ }
  }
  return undefined;
}

async function persistTemporaryReport(reportPath, repositoryDirectory) {
  const destinationDirectory = path.join(repositoryDirectory, "covscout-output", "coverage");
  const destination = path.join(destinationDirectory, "jacoco.xml");
  await mkdir(destinationDirectory, { recursive: true });
  await copyFile(reportPath, destination);
  return destination;
}

function mavenCommand(directory) {
  if (process.platform === "win32") return hasFile(directory, "mvnw.cmd") ? "mvnw.cmd" : "mvn.cmd";
  return hasFile(directory, "mvnw") ? "./mvnw" : "mvn";
}

function gradleCommand(directory) {
  return process.platform === "win32" && hasFile(directory, "gradlew.bat") ? "gradlew.bat" : hasFile(directory, "gradlew") ? "./gradlew" : "gradle";
}

function hasFile(directory, filename) {
  return existsSync(path.join(directory, filename));
}

async function gradleBuildFilename(directory) {
  try { await access(path.join(directory, "build.gradle")); return "build.gradle"; }
  catch { return "build.gradle.kts"; }
}

function runCommand({ command, args, cwd, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32" && /\.(?:bat|cmd)$/i.test(command),
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { stderr += error.message; finish({ code: 1, stdout, stderr, timedOut }); });
    child.on("close", (code) => finish({ code: code ?? 1, stdout, stderr, timedOut }));
  });
}

async function findLikelyUntestedPublicMethods(directory) {
  const javaFiles = await collectJavaFiles(directory);
  const tests = javaFiles.filter((file) => /[\\/]src[\\/]test[\\/]/i.test(file));
  const gaps = [];
  for (const file of javaFiles.filter((file) => /[\\/]src[\\/]main[\\/]/i.test(file))) {
    const text = await readFile(file, "utf8");
    const className = path.basename(file, ".java");
    const matchingTestFiles = tests.filter((testFile) => new RegExp(`${escapeRegExp(className)}(?:Test|Tests|IT)?\\.java$`, "i").test(testFile));
    const testText = (await Promise.all(matchingTestFiles.map((testFile) => readFile(testFile, "utf8")))).join("\n").toLowerCase();
    for (const match of text.matchAll(/\bpublic\s+(?:static\s+)?[\w<>\[\], ?]+\s+(\w+)\s*\([^;{}]*\)\s*(?:throws\s+[^{]+)?\{/g)) {
      const method = match[1];
      if (method === className || testText.includes(method.toLowerCase())) continue;
      gaps.push({ file: path.relative(directory, file).split(path.sep).join("/"), className, method, reason: "No similarly named test method was found in src/test." });
    }
  }
  return gaps;
}

async function collectJavaFiles(directory, files = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name)) await collectJavaFiles(path.join(directory, entry.name), files);
    if (entry.isFile() && entry.name.endsWith(".java")) files.push(path.join(directory, entry.name));
  }
  return files;
}

function tail(value) { return value.trim().slice(-OUTPUT_TAIL_LENGTH); }
function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

export function formatCoverageSummary(result) {
  const lines = ["Coverage analysis complete", `Build command: ${result.command.join(" ")}`, `Coverage confidence: ${result.confidence}`];
  if (result.kind === "jacoco-report") {
    lines.push("Coverage path: JaCoCo XML report", `JaCoCo report: ${result.reportPath}`);
  } else {
    lines.push("Coverage path: static-heuristic fallback", `Reason: ${result.reason}`, `Likely coverage gaps: ${result.gaps.length}`);
    if (result.outputTail) lines.push(`Build output (tail):\n${result.outputTail}`);
  }
  return lines;
}
