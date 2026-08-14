import { isAbsolute, relative, resolve, sep, win32 } from "node:path";

function differenceIsContained(difference, separator, differenceIsAbsolute) {
  return (
    difference === "" ||
    (!difference.startsWith(`..${separator}`) &&
      difference !== ".." &&
      !differenceIsAbsolute(difference))
  );
}

export function isPathWithinRoot(root, candidate) {
  if (win32.isAbsolute(root) && win32.isAbsolute(candidate)) {
    const difference = win32.relative(
      win32.normalize(root),
      win32.normalize(candidate),
    );
    return differenceIsContained(difference, win32.sep, win32.isAbsolute);
  }
  const difference = relative(resolve(root), resolve(candidate));
  return differenceIsContained(difference, sep, isAbsolute);
}

export function validateSourceReferenceShape(source, allowedRoots) {
  const windowsAbsolute = win32.isAbsolute(source?.path ?? "");
  const nativeAbsolute = isAbsolute(source?.path ?? "");
  if (!source?.sourceId || (!windowsAbsolute && !nativeAbsolute))
    throw new Error(`Relative source path: ${source?.path}`);
  const normalizedPath = windowsAbsolute
    ? win32.normalize(source.path)
    : resolve(source.path);
  const lexicalRoot = allowedRoots
    .filter((root) => win32.isAbsolute(root) === windowsAbsolute)
    .map((root) => (windowsAbsolute ? win32.normalize(root) : resolve(root)))
    .find((root) => isPathWithinRoot(root, normalizedPath));
  if (!lexicalRoot)
    throw new Error(`Source path outside allowlisted roots: ${source.path}`);
  if (!/^[A-Fa-f0-9]{64}$/.test(source.sha256 ?? ""))
    throw new Error(`Missing or invalid source hash: ${source.path}`);
  if (!source.observedAt || Number.isNaN(Date.parse(source.observedAt)))
    throw new Error(`Missing or invalid observation time: ${source.path}`);
  return { lexicalRoot, normalizedPath };
}
