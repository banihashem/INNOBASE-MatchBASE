import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const IMAGE =
  /^(me-central1|europe-west2)-docker\.pkg\.dev\/innobase-matchbase-stg\/matchbase\/([a-z0-9][a-z0-9._-]{0,127})@(sha256:[a-f0-9]{64})$/u;
export function deriveGovernedSourceImage(image) {
  const match = IMAGE.exec(image);
  if (!match)
    throw new Error(
      "Deploy image source binding rejected: image identity is outside the governed repositories.",
    );
  return `me-central1-docker.pkg.dev/innobase-matchbase-stg/matchbase/${match[2]}@${match[3]}`;
}
export function validateEuTargetImageIdentity(value, expectedImage) {
  const match = IMAGE.exec(expectedImage);
  if (!match || match[1] !== "europe-west2")
    throw new Error(
      "Deploy image source binding rejected: expected image is not an EU target.",
    );
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(
      "Deploy image source binding rejected: target image response is absent.",
    );
  if (
    value.image_summary?.fully_qualified_digest !== expectedImage ||
    value.image_summary?.digest !== match[3] ||
    value.image_summary?.repository !== "matchbase" ||
    value.image_summary?.registry !== "europe-west2-docker.pkg.dev"
  )
    throw new Error(
      "Deploy image source binding rejected: EU target identity or digest is forged.",
    );
  return Object.freeze({
    target_image: expectedImage,
    source_image: deriveGovernedSourceImage(expectedImage),
  });
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const get = (name) => {
    const index = process.argv.indexOf(name);
    if (index < 0 || !process.argv[index + 1])
      throw new Error(`${name} is required`);
    return process.argv[index + 1];
  };
  const image = get("--image");
  const fileIndex = process.argv.indexOf("--file");
  const result =
    fileIndex < 0
      ? { source_image: deriveGovernedSourceImage(image) }
      : validateEuTargetImageIdentity(
          JSON.parse(await readFile(process.argv[fileIndex + 1], "utf8")),
          image,
        );
  process.stdout.write(JSON.stringify(result));
}
