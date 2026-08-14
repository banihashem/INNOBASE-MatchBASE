import { isAbsolute, posix, relative, resolve, sep, win32 } from "node:path";

function differenceIsContained(difference, separator, differenceIsAbsolute) {
  return (
    difference === "" ||
    (!difference.startsWith(`..${separator}`) &&
      difference !== ".." &&
      !differenceIsAbsolute(difference))
  );
}

export function isPathWithinRoot(root, candidate) {
  if (posix.isAbsolute(root) || posix.isAbsolute(candidate)) {
    if (!posix.isAbsolute(root) || !posix.isAbsolute(candidate)) return false;
    const difference = posix.relative(
      posix.normalize(root),
      posix.normalize(candidate),
    );
    return differenceIsContained(difference, posix.sep, posix.isAbsolute);
  }
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
  const posixAbsolute = posix.isAbsolute(source?.path ?? "");
  const windowsAbsolute =
    !posixAbsolute && win32.isAbsolute(source?.path ?? "");
  if (!source?.sourceId || (!windowsAbsolute && !posixAbsolute))
    throw new Error(`Relative source path: ${source?.path}`);
  const normalizedPath = posixAbsolute
    ? posix.normalize(source.path)
    : win32.normalize(source.path);
  const lexicalRoot = allowedRoots
    .filter(
      (root) =>
        (posixAbsolute && posix.isAbsolute(root)) ||
        (windowsAbsolute && !posix.isAbsolute(root) && win32.isAbsolute(root)),
    )
    .map((root) =>
      posixAbsolute ? posix.normalize(root) : win32.normalize(root),
    )
    .find((root) => isPathWithinRoot(root, normalizedPath));
  if (!lexicalRoot)
    throw new Error(`Source path outside allowlisted roots: ${source.path}`);
  if (!/^[A-Fa-f0-9]{64}$/.test(source.sha256 ?? ""))
    throw new Error(`Missing or invalid source hash: ${source.path}`);
  if (!source.observedAt || Number.isNaN(Date.parse(source.observedAt)))
    throw new Error(`Missing or invalid observation time: ${source.path}`);
  return { lexicalRoot, normalizedPath };
}
