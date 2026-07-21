import { readdir } from "node:fs/promises";
import path from "node:path";
import { IntakeError } from "./errors.js";

const JAVA_SCAN_LIMIT = 5_000;
const IGNORED_DIRECTORIES = new Set([".git", ".gradle", "build", "target", "node_modules", "out"]);

export async function detectBuildSystem(repositoryDirectory, { scanLimit = JAVA_SCAN_LIMIT } = {}) {
  const rootEntries = await readdir(repositoryDirectory, { withFileTypes: true });
  const names = new Set(rootEntries.filter((entry) => entry.isFile()).map((entry) => entry.name));
  const hasMaven = names.has("pom.xml");
  const hasGradle = names.has("build.gradle") || names.has("build.gradle.kts");

  if (hasMaven && hasGradle) {
    throw new IntakeError("Both Maven (pom.xml) and Gradle build files were found at the repository root; covscout will not guess which build system to use.");
  }
  if (!hasMaven && !hasGradle) {
    throw new IntakeError("No supported Java build file found at the repository root (expected pom.xml, build.gradle, or build.gradle.kts).");
  }

  const sourceFiles = await inspectSourceFiles(repositoryDirectory, scanLimit);
  if (sourceFiles.java === 0) {
    throw new IntakeError(`A supported build file was found, but no Java source files were detected in the repository; covscout supports primarily Java projects only.${incompleteScanWarning(sourceFiles)}`);
  }
  if (sourceFiles.java < sourceFiles.nonJava) {
    throw new IntakeError(`A supported build file was found, but the scanned source files are not primarily Java (${sourceFiles.java} Java, ${sourceFiles.nonJava} other language files); covscout supports primarily Java projects only.${incompleteScanWarning(sourceFiles)}`);
  }
  return {
    buildSystem: hasMaven ? "Maven" : "Gradle",
    scanTruncated: sourceFiles.truncated,
  };
}

function incompleteScanWarning(sourceFiles) {
  return sourceFiles.truncated
    ? " The Java source scan was incomplete because it reached its file limit; this rejection may not reflect the whole repository."
    : "";
}

async function inspectSourceFiles(rootDirectory, scanLimit) {
  const pending = [rootDirectory];
  let visited = 0;
  let java = 0;
  let nonJava = 0;
  let truncated = false;
  while (pending.length > 0 && visited < scanLimit) {
    const directory = pending.pop();
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && !IGNORED_DIRECTORIES.has(entry.name)) pending.push(path.join(directory, entry.name));
      if (entry.isFile()) {
        visited += 1;
        if (entry.name.endsWith(".java")) java += 1;
        else if (/\.(kt|kts|groovy|scala|clj|js|jsx|ts|tsx|py|rb|go|rs|cs|c|cc|cpp|h|hpp|php|swift)$/i.test(entry.name)) nonJava += 1;
        if (visited >= scanLimit) {
          truncated = pending.length > 0;
          break;
        }
      }
    }
  }
  return { java, nonJava, truncated };
}
