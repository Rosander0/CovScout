// Single source of truth for "is this method stubbable" — used by both the
// ranking stage (to know whether a candidate can actually yield a stub before
// committing a topN slot to it) and the stub-generation stage (to build the
// stub source itself). Previously each stage computed this independently,
// which let ranking pick classes that stub generation could never use.
export function classifyMethods(classRecord) {
  const methods = Array.isArray(classRecord?.methods) ? classRecord.methods : [];
  return methods.map((method) => classifyMethod(method, classRecord?.heuristic === true));
}

export function classifyMethod(method, heuristic) {
  const name = typeof method?.name === "string" ? method.name : "Unnamed method";
  if (name === "<init>") return { name, status: "skipped", reason: "Constructors are not stubbed." };
  if (heuristic) {
    return {
      name,
      status: "stubbed",
      reason: typeof method?.gapReason === "string" ? method.gapReason : "Static analysis identified a likely untested public method.",
    };
  }

  const percentage = method?.coverage?.line?.percentage;
  if (percentage === 0) return { name, status: "stubbed", reason: "Confirmed measured 0% line coverage." };
  if (percentage === null || percentage === undefined) {
    return { name, status: "skipped", reason: "Method line coverage is unknown, not confirmed untested." };
  }
  if (typeof percentage === "number" && percentage > 0 && percentage < 1) {
    return { name, status: "skipped", reason: "Method has partial measured line coverage." };
  }
  return { name, status: "skipped", reason: "Method has measured line coverage and is not a confirmed zero-coverage gap." };
}

// Joins Stage 5's summary entries back to Stage 3's full class records.
// Keyed by name+sourceFile, not sourceFile alone: a single .java file can
// declare multiple classes (a top-level class plus nested/inner classes),
// so two different ranked entries can share one sourceFile. Keying on
// sourceFile alone let the second class silently overwrite the first in the
// lookup map, joining unrelated ranked entries to the wrong class record.
export function joinRankedClasses(rankedEntries, classes) {
  const joinKey = (name, sourceFile) => `${sourceFile ?? ""}::${name ?? ""}`;
  const classesByKey = new Map(
    (Array.isArray(classes) ? classes : [])
      .filter((candidate) => candidate && typeof candidate === "object" && typeof candidate.sourceFile === "string")
      .map((candidate) => [joinKey(candidate.name, candidate.sourceFile), candidate]),
  );

  return (Array.isArray(rankedEntries) ? rankedEntries : []).map((ranked) => ({
    ranked,
    class: classesByKey.get(joinKey(ranked?.name, ranked?.sourceFile)) ?? null,
  }));
}

// This deliberately recognizes only the conventional Java source-root marker.
// It parses an already-resolved repository-relative path; it does not search disk.
// An empty string confirms the default (no-subpackage) package, while null means
// the source-root marker could not be found. Callers currently treat both
// identically by design, unless a future need arises to distinguish them.
export function derivePackageName(sourceFile) {
  if (typeof sourceFile !== "string" || !sourceFile.trim()) return null;

  const segments = sourceFile.split(/[\\/]/);
  if (segments.some((segment) => !segment)) return null;

  const javaIndex = segments.indexOf("java");
  if (javaIndex === -1 || javaIndex === segments.length - 1) return null;

  return segments.slice(javaIndex + 1, -1).join(".");
}
