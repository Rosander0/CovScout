import { classifyMethods, derivePackageName, joinRankedClasses } from "./class-lookup.js";

export function generateTestStubs(rankedResult, classes, options = {}) {
  void options;
  const joined = joinRankedClasses(rankedResult?.ranked, classes);
  const stubs = [];
  const skippedClasses = [];

  for (const { ranked, class: classRecord } of joined) {
    const className = classRecord?.name ?? ranked?.name ?? "Unnamed class";
    const sourceFile = ranked?.sourceFile ?? classRecord?.sourceFile ?? null;
    if (!classRecord) {
      skippedClasses.push({ className, sourceFile, reason: "No matching full class object was found for this ranked source file.", methods: [] });
      continue;
    }

    const methods = classifyMethods(classRecord);
    const stubbable = methods.filter((method) => method.status === "stubbed");
    if (!stubbable.length) {
      skippedClasses.push({
        className,
        sourceFile,
        reason: noStubsReason(methods),
        methods,
      });
      continue;
    }

    const hasMeasuredPackageName = classRecord.heuristic !== true && typeof classRecord.packageName === "string";
    const packageName = hasMeasuredPackageName ? classRecord.packageName : derivePackageName(sourceFile);
    const packageReason = !hasMeasuredPackageName && packageName === null
      ? "Package could not be determined from the resolved source path; no package declaration was generated."
      : null;
    stubs.push({
      className,
      sourceFile,
      packageName,
      packageReason,
      source: renderStubSource(className, packageName, stubbable),
      methods,
    });
  }

  return { stubs, skippedClasses };
}

export function formatStubSummary(stubResult) {
  const result = stubResult && typeof stubResult === "object" ? stubResult : {};
  const lines = ["JUnit 5 test stub generation complete"];
  for (const stub of Array.isArray(result.stubs) ? result.stubs : []) {
    const methods = Array.isArray(stub.methods) ? stub.methods : [];
    const stubbed = methods.filter((method) => method.status === "stubbed");
    const skipped = methods.filter((method) => method.status === "skipped");
    lines.push(`${stub.className} [${stub.sourceFile}]: ${stubbed.length} methods stubbed; ${skipped.length} skipped.`);
    for (const method of skipped) lines.push(`  Skipped ${method.name}: ${method.reason}`);
    if (stub.packageReason) lines.push(`  ${stub.packageReason}`);
  }
  for (const skippedClass of Array.isArray(result.skippedClasses) ? result.skippedClasses : []) {
    lines.push(`WARNING: No stubs generated for ${skippedClass.className} [${skippedClass.sourceFile ?? "unresolved source file"}]: ${skippedClass.reason}`);
    for (const method of skippedClass.methods ?? []) lines.push(`  Skipped ${method.name}: ${method.reason}`);
  }
  return lines;
}

function noStubsReason(methods) {
  if (!methods.length) return "No methods were available in the matched class record.";
  return `All ${methods.length} method(s) were skipped; ${methods.map((method) => `${method.name}: ${method.reason}`).join(" ")}`;
}

function renderStubSource(className, packageName, methods) {
  const simpleClassName = className.split(".").at(-1);
  const packageDeclaration = packageName ? `package ${packageName};\n\n` : "";
  const testMethods = methods.map((method) => `  @Test\n  void test${capitalize(method.name)}_todo() {\n    // TODO: instantiate ${simpleClassName} (constructor arguments are unknown from coverage data).\n    // TODO: ${oneLine(method.reason)}\n    fail("Not implemented");\n  }`).join("\n\n");
  return `${packageDeclaration}import org.junit.jupiter.api.Test;\nimport static org.junit.jupiter.api.Assertions.*;\n\nclass ${simpleClassName}StubTest {\n${testMethods}\n}\n`;
}

function capitalize(value) { return `${value.charAt(0).toUpperCase()}${value.slice(1)}`; }
function oneLine(value) { return value.replace(/[\r\n]+/g, " "); }
