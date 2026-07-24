import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

// JaCoCo's report DTD defines report/package/class/method/counter and
// report/package/sourcefile/line. Method counter elements carry the method's
// aggregate LINE and BRANCH counters, so no source-range inference is needed.
// See https://www.jacoco.org/jacoco/trunk/coverage/report.dtd
const COUNTER_TYPES = new Set(["INSTRUCTION", "BRANCH", "LINE", "COMPLEXITY", "METHOD", "CLASS"]);
const SKIPPED_DIRECTORIES = new Set([".git", ".gradle", "build", "target", "node_modules", "out"]);
const SOURCE_FILE_SCAN_LIMIT = 5_000;

export async function parseCoverageReport(coverage, repositoryDirectory) {
  if (!coverage || typeof coverage !== "object") return unavailable("Coverage step returned no usable result.");
  if (coverage.kind === "static-heuristic") return normalizeStaticHeuristic(coverage, repositoryDirectory);
  if (coverage.kind !== "jacoco-report") return unavailable(`Unsupported coverage result kind: ${String(coverage.kind)}.`);
  if (!coverage.reportPath) return unavailable("JaCoCo coverage result did not provide a report path.", coverage);

  try {
    return parseJacocoXml(await readFile(coverage.reportPath, "utf8"), coverage, repositoryDirectory);
  } catch (error) {
    return unavailable(`Unable to read JaCoCo XML report: ${error.message}`, coverage);
  }
}

export function formatParsedCoverageSummary(parsed) {
  const lines = [
    "Coverage report parsing complete",
    `Parsed coverage status: ${parsed.status}`,
    `Parsed coverage source: ${parsed.source}`,
    `Parsed coverage confidence: ${parsed.confidence}`,
    `Classes: ${parsed.summary.classCount}`,
    `Methods: ${parsed.summary.methodCount}`,
    `Line coverage: ${formatMetric(parsed.summary.line)}`,
    `Branch coverage: ${formatMetric(parsed.summary.branch)}`,
  ];
  for (const warning of parsed.warnings) lines.push(`WARNING: ${warning}`);
  return lines;
}

export function parseJacocoXml(xml, coverage = {}, repositoryDirectory) {
  try {
    const root = parseXml(xml);
    if (root.name !== "report") throw new Error(`Expected <report> root element, found <${root.name}>.`);
    validateJacocoSchema(root);
    const classes = [];
    const warnings = [];
    const resolver = createSourceFileResolver(repositoryDirectory);
    for (const packageNode of children(root, "package")) {
      const packageName = requiredAttribute(packageNode, "name");
      const sourceFiles = new Map(children(packageNode, "sourcefile").map((sourceFile) => [sourceFile.attributes.name, sourceFile]));
      for (const classNode of children(packageNode, "class")) {
        const internalName = requiredAttribute(classNode, "name");
        const sourceFile = classNode.attributes.sourcefilename ?? null;
        const resolution = sourceFile ? resolver.resolve(sourcePath(packageName, sourceFile), internalName) : { sourceFile: null };
        if (resolution.warning) warnings.push(resolution.warning);
        const methods = children(classNode, "method").map((methodNode) => ({
          name: requiredAttribute(methodNode, "name"),
          descriptor: requiredAttribute(methodNode, "desc"),
          firstLine: optionalNumber(methodNode.attributes.line, "method line"),
          coverage: coverageFromCounters(children(methodNode, "counter")),
          heuristic: false,
        }));
        classes.push({
          name: internalName.replaceAll("/", "."),
          internalName,
          packageName: packageName.replaceAll("/", "."),
          sourceFile: resolution.sourceFile,
          coverage: coverageFromCounters(children(classNode, "counter")),
          methods,
          heuristic: false,
          // Retain JaCoCo's per-source-line branch details for a later ranking
          // or report stage without pretending a branch belongs to one method.
          lines: sourceLines(sourceFiles.get(sourceFile)),
        });
      }
    }
    return {
      kind: "coverage-data",
      source: "jacoco-xml",
      confidence: coverage.confidence ?? "high",
      heuristic: false,
      status: "available",
      warnings,
      classes,
      summary: summarize(classes),
      reportPath: coverage.reportPath,
    };
  } catch (error) {
    return unavailable(`Malformed or unexpected JaCoCo XML: ${error.message}`, coverage);
  }
}

function normalizeStaticHeuristic(coverage, repositoryDirectory) {
  const grouped = new Map();
  const warnings = [coverage.reason ?? "Coverage data unavailable; using static heuristic fallback."];
  const resolver = createSourceFileResolver(repositoryDirectory);
  for (const gap of Array.isArray(coverage.gaps) ? coverage.gaps : []) {
    if (!gap || typeof gap !== "object" || !gap.className || !gap.method) continue;
    const resolution = resolver.resolve(gap.file, gap.className);
    if (resolution.warning) warnings.push(resolution.warning);
    const key = `${resolution.sourceFile ?? ""}\u0000${gap.className}`;
    if (!grouped.has(key)) grouped.set(key, {
      name: gap.className,
      internalName: null,
      packageName: null,
      sourceFile: resolution.sourceFile,
      coverage: unknownCoverage(),
      methods: [],
      heuristic: true,
      lines: [],
    });
    grouped.get(key).methods.push({
      name: gap.method,
      descriptor: null,
      firstLine: null,
      coverage: unknownCoverage(),
      heuristic: true,
      gapReason: gap.reason ?? "Static analysis identified a likely untested public method.",
    });
  }
  const classes = [...grouped.values()];
  return {
    kind: "coverage-data",
    source: "static-heuristic",
    confidence: coverage.confidence ?? "low",
    heuristic: true,
    status: "fallback",
    warnings,
    classes,
    summary: summarize(classes),
    reportPath: null,
  };
}

function unavailable(reason, coverage = {}) {
  return {
    kind: "coverage-data", source: "unavailable", confidence: coverage.confidence ?? "low",
    heuristic: false, status: "unavailable", warnings: [reason], classes: [],
    summary: { classCount: 0, methodCount: 0, line: unknownMetric(), branch: unknownMetric() }, reportPath: coverage.reportPath ?? null,
  };
}

function coverageFromCounters(counterNodes) {
  const counters = new Map();
  for (const node of counterNodes) {
    const type = requiredAttribute(node, "type");
    if (!COUNTER_TYPES.has(type)) throw new Error(`Unsupported counter type "${type}".`);
    if (counters.has(type)) throw new Error(`Duplicate ${type} counter.`);
    counters.set(type, metric(requiredNumber(node.attributes.missed, `${type} missed`), requiredNumber(node.attributes.covered, `${type} covered`)));
  }
  return { line: counters.get("LINE") ?? unknownMetric(), branch: counters.get("BRANCH") ?? unknownMetric() };
}

function sourceLines(sourceFile) {
  if (!sourceFile) return [];
  return children(sourceFile, "line").map((line) => ({
    number: requiredNumber(line.attributes.nr, "line nr"),
    missedInstructions: requiredNumber(line.attributes.mi, "line mi"),
    coveredInstructions: requiredNumber(line.attributes.ci, "line ci"),
    missedBranches: requiredNumber(line.attributes.mb, "line mb"),
    coveredBranches: requiredNumber(line.attributes.cb, "line cb"),
  }));
}

function summarize(classes) {
  const methods = classes.flatMap((item) => item.methods);
  return {
    classCount: classes.length,
    methodCount: methods.length,
    line: mergeMetrics(classes.map((item) => item.coverage.line)),
    branch: mergeMetrics(classes.map((item) => item.coverage.branch)),
  };
}

function metric(missed, covered) { const total = missed + covered; return { missed, covered, total, percentage: total ? covered / total : null }; }
function unknownMetric() { return { missed: null, covered: null, total: null, percentage: null }; }
function unknownCoverage() { return { line: unknownMetric(), branch: unknownMetric() }; }
function mergeMetrics(metrics) {
  // JaCoCo omits LINE/BRANCH counters for classes where the counter is not
  // applicable (for example synthetic classes). Those classes must not erase
  // report-wide figures that are available for the remaining classes.
  const available = metrics.filter((item) => item.total !== null);
  if (!available.length) return unknownMetric();
  return metric(available.reduce((sum, item) => sum + item.missed, 0), available.reduce((sum, item) => sum + item.covered, 0));
}
function sourcePath(packageName, filename) { return packageName ? `${packageName}/${filename}` : filename; }
function createSourceFileResolver(repositoryDirectory) {
  if (!repositoryDirectory) return { resolve: (_, className) => ({ sourceFile: null, warning: `Unable to resolve source file for ${className}: repository directory was not provided.` }) };
  const files = [];
  let truncated = false;
  let scanError;
  try {
    const visit = (directory) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (!SKIPPED_DIRECTORIES.has(entry.name)) visit(path.join(directory, entry.name));
        } else if (entry.isFile()) {
          if (files.length >= SOURCE_FILE_SCAN_LIMIT) { truncated = true; return; }
          files.push(normalizePath(path.relative(repositoryDirectory, path.join(directory, entry.name))));
        }
        if (truncated) return;
      }
    };
    visit(repositoryDirectory);
  } catch (error) { scanError = error; }
  return {
    resolve(expectedPath, className) {
      if (!expectedPath) return { sourceFile: null };
      if (scanError) return { sourceFile: null, warning: `Unable to resolve source file for ${className} (expected ${expectedPath}): ${scanError.message}` };
      if (truncated) return { sourceFile: null, warning: `Unable to resolve source file for ${className} (expected ${expectedPath}): repository scan reached the ${SOURCE_FILE_SCAN_LIMIT}-file cap.` };
      const expected = normalizePath(path.isAbsolute(expectedPath) ? path.relative(repositoryDirectory, expectedPath) : expectedPath);
      const matches = files.filter((file) => file === expected || file.endsWith(`/${expected}`));
      if (matches.length === 1) return { sourceFile: matches[0] };
      if (matches.length === 0) return { sourceFile: null, warning: `Unable to resolve source file for ${className}: expected ${expected}.` };
      return { sourceFile: null, warning: `Ambiguous source file for ${className}: expected ${expected}; candidates: ${matches.join(", ")}.` };
    },
  };
}
function normalizePath(value) { return value.split(path.sep).join("/"); }
function children(node, name) { return node.children.filter((child) => child.name === name); }
function requiredAttribute(node, name) { if (!(name in node.attributes)) throw new Error(`<${node.name}> is missing required "${name}" attribute.`); return node.attributes[name]; }
function requiredNumber(value, label) { const number = Number(value); if (!Number.isSafeInteger(number) || number < 0) throw new Error(`Invalid ${label} counter value "${value}".`); return number; }
function optionalNumber(value, label) { return value === undefined ? null : requiredNumber(value, label); }

function parseXml(xml) {
  if (typeof xml !== "string" || !xml.trim()) throw new Error("Report is empty.");
  const stack = [];
  let root;
  const tokenPattern = /<!--[\s\S]*?-->|<\?[^]*?\?>|<!DOCTYPE[\s\S]*?>|<[^>]+>/g;
  let match; let cursor = 0;
  while ((match = tokenPattern.exec(xml))) {
    if (xml.slice(cursor, match.index).trim()) throw new Error("Unexpected text content.");
    cursor = tokenPattern.lastIndex;
    const token = match[0];
    if (token.startsWith("<?") || token.startsWith("<!--") || token.startsWith("<!DOCTYPE")) continue;
    if (token.startsWith("</")) {
      const name = token.slice(2, -1).trim();
      if (!stack.length || stack.at(-1).name !== name) throw new Error(`Unbalanced closing tag </${name}>.`);
      stack.pop();
      continue;
    }
    const selfClosing = /\/>$/.test(token);
    const body = token.slice(1, selfClosing ? -2 : -1).trim();
    const name = /^[-A-Za-z_:][-A-Za-z0-9_:.]*/.exec(body)?.[0];
    if (!name) throw new Error("Invalid opening tag.");
    const node = { name, attributes: parseAttributes(body.slice(name.length)), children: [] };
    if (stack.length) stack.at(-1).children.push(node); else if (root) throw new Error("Multiple root elements."); else root = node;
    if (!selfClosing) stack.push(node);
  }
  if (xml.slice(cursor).trim()) throw new Error("Unexpected text content.");
  if (!root) throw new Error("No root element.");
  if (stack.length) throw new Error(`Unclosed <${stack.at(-1).name}> element.`);
  return root;
}

function validateJacocoSchema(report) {
  requiredAttribute(report, "name");
  validateChildren(report, new Set(["sessioninfo", "package", "counter"]));
  for (const session of children(report, "sessioninfo")) {
    requiredAttribute(session, "id"); requiredNumber(session.attributes.start, "session start"); requiredNumber(session.attributes.dump, "session dump");
    validateChildren(session, new Set());
  }
  for (const packageNode of children(report, "package")) {
    requiredAttribute(packageNode, "name"); validateChildren(packageNode, new Set(["class", "sourcefile", "counter"]));
    for (const classNode of children(packageNode, "class")) {
      requiredAttribute(classNode, "name"); requiredAttribute(classNode, "sourcefilename"); validateChildren(classNode, new Set(["method", "counter"]));
      for (const method of children(classNode, "method")) {
        requiredAttribute(method, "name"); requiredAttribute(method, "desc"); optionalNumber(method.attributes.line, "method line"); validateChildren(method, new Set(["counter"]));
      }
    }
    for (const sourceFile of children(packageNode, "sourcefile")) {
      requiredAttribute(sourceFile, "name"); validateChildren(sourceFile, new Set(["line", "counter"]));
      for (const line of children(sourceFile, "line")) {
        requiredNumber(line.attributes.nr, "line nr"); requiredNumber(line.attributes.mi, "line mi"); requiredNumber(line.attributes.ci, "line ci"); requiredNumber(line.attributes.mb, "line mb"); requiredNumber(line.attributes.cb, "line cb");
      }
    }
  }
  for (const counter of allCounters(report)) coverageFromCounters([counter]);
}

function validateChildren(node, allowed) {
  for (const child of node.children) if (!allowed.has(child.name)) throw new Error(`Unexpected <${child.name}> inside <${node.name}>.`);
}

function allCounters(node) {
  const result = node.name === "counter" ? [node] : [];
  for (const child of node.children) result.push(...allCounters(child));
  return result;
}

function parseAttributes(text) {
  const attributes = {};
  const pattern = /\s+([-A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(["'])([\s\S]*?)\2/g;
  let match; let consumed = "";
  while ((match = pattern.exec(text))) {
    if (Object.hasOwn(attributes, match[1])) throw new Error(`Duplicate "${match[1]}" attribute.`);
    attributes[match[1]] = decodeXml(match[3]);
    consumed += match[0];
  }
  if (consumed.replace(/\s/g, "") !== text.replace(/\s/g, "")) throw new Error("Malformed attribute list.");
  return attributes;
}

function decodeXml(value) {
  return value.replace(/&(lt|gt|amp|quot|apos);/g, (_, entity) => ({ lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" })[entity]);
}

function formatMetric(metricValue) {
  return metricValue.total === null ? "unavailable" : `${(metricValue.percentage * 100).toFixed(2)}% (${metricValue.covered}/${metricValue.total})`;
}
