// Joins Stage 5's summary entries back to Stage 3's full class records.
export function joinRankedClasses(rankedEntries, classes) {
  const classesBySourceFile = new Map(
    (Array.isArray(classes) ? classes : [])
      .filter((candidate) => candidate && typeof candidate === "object" && typeof candidate.sourceFile === "string")
      .map((candidate) => [candidate.sourceFile, candidate]),
  );

  return (Array.isArray(rankedEntries) ? rankedEntries : []).map((ranked) => ({
    ranked,
    class: classesBySourceFile.get(ranked?.sourceFile) ?? null,
  }));
}

// This deliberately recognizes only the conventional Java source-root marker.
// It parses an already-resolved repository-relative path; it does not search disk.
export function derivePackageName(sourceFile) {
  if (typeof sourceFile !== "string" || !sourceFile.trim()) return null;

  const segments = sourceFile.split(/[\\/]/);
  if (segments.some((segment) => !segment)) return null;

  const javaIndex = segments.indexOf("java");
  if (javaIndex === -1 || javaIndex === segments.length - 1) return null;

  return segments.slice(javaIndex + 1, -1).join(".");
}
