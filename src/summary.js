export function formatIntakeSummary(result) {
  const lines = [
    "Repository intake complete",
    `Repository: ${result.repositoryName}`,
    `Build system: ${result.buildSystem}`,
    `Cloned copy: ${result.directory}`,
  ];
  if (result.scanTruncated) {
    lines.push("WARNING: Java source scan was capped before the repository tree was fully inspected; the build-system verdict may be unreliable.");
  }
  return lines;
}
