import { existsSync as filesystemExistsSync } from "node:fs";
import path from "node:path";

// This bound prevents a faulty existence check (or an unexpectedly crowded
// output directory) from turning collision handling into an endless search.
const MAX_FALLBACK_ATTEMPTS = 100;

/**
 * Resolves safe, package-qualified destinations for already-generated stubs.
 * This function never creates directories or writes files.
 */
export function resolveStubOutputPaths(stubs, outputRoot, { existsSync = filesystemExistsSync } = {}) {
  const entries = Array.isArray(stubs) ? stubs : [];
  const prepared = entries.map((stub, index) => {
    const className = typeof stub?.className === "string" ? stub.className : "Unnamed class";
    const packageName = typeof stub?.packageName === "string" && stub.packageName ? stub.packageName : null;
    const relativePath = stubRelativePath(className, packageName);
    return {
      index,
      className,
      packageName,
      intendedRelativePath: relativePath,
      intendedAbsolutePath: path.resolve(outputRoot, relativePath),
    };
  });
  const groups = new Map();
  for (const entry of prepared) {
    const group = groups.get(entry.intendedAbsolutePath) ?? [];
    group.push(entry);
    groups.set(entry.intendedAbsolutePath, group);
  }

  const reservedPaths = new Set();
  return prepared.map((entry) => {
    const sameCall = groups.get(entry.intendedAbsolutePath);
    const occupiedOnDisk = existsSync(entry.intendedAbsolutePath);
    const conflictsInCall = sameCall.length > 1;
    const collision = occupiedOnDisk || conflictsInCall;
    const collisionReason = collision ? describeCollision(entry, sameCall, occupiedOnDisk) : null;

    if (!collision) {
      reservedPaths.add(entry.intendedAbsolutePath);
      return resolution(entry, entry.intendedRelativePath, entry.intendedAbsolutePath, false, null);
    }

    const fallback = findFallback(entry, existsSync, reservedPaths);
    if (!fallback) {
      return {
        ...resolution(entry, null, null, true, `${collisionReason} No free fallback was found after ${MAX_FALLBACK_ATTEMPTS} suffix attempts.`),
        fallbackRelativePath: null,
        fallbackAbsolutePath: null,
      };
    }
    reservedPaths.add(fallback.absolutePath);
    return {
      ...resolution(entry, fallback.relativePath, fallback.absolutePath, true, collisionReason),
      fallbackRelativePath: fallback.relativePath,
      fallbackAbsolutePath: fallback.absolutePath,
    };
  });
}

export function formatStubOutputSummary(resolutions) {
  const lines = ["Stub output path resolution complete"];
  for (const resolution of Array.isArray(resolutions) ? resolutions : []) {
    const identity = `${resolution.className}${resolution.packageName ? ` (${resolution.packageName})` : ""}`;
    lines.push(`${identity}: ${resolution.relativePath ?? "NO AVAILABLE OUTPUT PATH"}`);
    if (resolution.collision) {
      lines.push(`WARNING: ${identity}: intended path ${resolution.intendedAbsolutePath}; fallback path ${resolution.absolutePath ?? "unavailable"}. ${resolution.collisionReason}`);
    }
  }
  return lines;
}

function stubRelativePath(className, packageName) {
  const simpleClassName = className.split(".").at(-1) || "Unnamed";
  const filename = `${simpleClassName}StubTest.java`;
  return packageName ? path.join(...packageName.split("."), filename) : filename;
}

function findFallback(entry, existsSync, reservedPaths) {
  const parsed = path.parse(entry.intendedRelativePath);
  for (let suffix = 2; suffix < MAX_FALLBACK_ATTEMPTS + 2; suffix += 1) {
    const relativePath = path.join(parsed.dir, `${parsed.name}-${suffix}${parsed.ext}`);
    const absolutePath = path.join(path.dirname(entry.intendedAbsolutePath), `${parsed.name}-${suffix}${parsed.ext}`);
    if (!existsSync(absolutePath) && !reservedPaths.has(absolutePath)) return { relativePath, absolutePath };
  }
  return null;
}

function describeCollision(entry, sameCall, occupiedOnDisk) {
  const reasons = [];
  if (occupiedOnDisk) reasons.push(`An existing filesystem entry occupies ${entry.intendedAbsolutePath}.`);
  if (sameCall.length > 1) {
    const identities = sameCall.map((candidate) => `stub #${candidate.index + 1} (${candidate.className})`).join(", ");
    reasons.push(`The same call contains colliding stubs: ${identities}.`);
  }
  return reasons.join(" ");
}

function resolution(entry, relativePath, absolutePath, collision, collisionReason) {
  return {
    className: entry.className,
    packageName: entry.packageName,
    relativePath,
    absolutePath,
    intendedRelativePath: entry.intendedRelativePath,
    intendedAbsolutePath: entry.intendedAbsolutePath,
    collision,
    collisionReason,
  };
}
