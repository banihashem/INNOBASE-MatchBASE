import { isAbsolute, relative, resolve, sep } from "node:path";

export function isPathWithinRoot(root, candidate) {
  const difference = relative(resolve(root), resolve(candidate));
  return (
    difference === "" ||
    (!difference.startsWith(`..${sep}`) &&
      difference !== ".." &&
      !isAbsolute(difference))
  );
}

export function validateSourceReferenceShape(source, allowedRoots) {
  if (!source?.sourceId || !isAbsolute(source.path))
    throw new Error(`Relative source path: ${source?.path}`);
  const normalizedPath = resolve(source.path);
  const lexicalRoot = allowedRoots
    .map((root) => resolve(root))
    .find((root) => isPathWithinRoot(root, normalizedPath));
  if (!lexicalRoot)
    throw new Error(`Source path outside allowlisted roots: ${source.path}`);
  if (!/^[A-Fa-f0-9]{64}$/.test(source.sha256 ?? ""))
    throw new Error(`Missing or invalid source hash: ${source.path}`);
  if (!source.observedAt || Number.isNaN(Date.parse(source.observedAt)))
    throw new Error(`Missing or invalid observation time: ${source.path}`);
  return { lexicalRoot, normalizedPath };
}
