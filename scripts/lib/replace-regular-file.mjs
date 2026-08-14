import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import { assertSafeOutputPath } from "./snapshot-path-policy.mjs";

export async function replaceRegularFileTransactionally(
  target,
  contents,
  expected = target,
) {
  await assertSafeOutputPath(target, expected);
  const nonce = randomUUID();
  const temporary = `${target}.${nonce}.tmp`;
  const backup = `${target}.${nonce}.backup`;
  let previousMoved = false;
  let committed = false;

  try {
    await writeFile(temporary, contents, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    try {
      await rename(target, backup);
      previousMoved = true;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }

    try {
      await rename(temporary, target);
      committed = true;
    } catch (error) {
      if (previousMoved) {
        try {
          await rename(backup, target);
          previousMoved = false;
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            `Snapshot replacement and rollback failed; prior bytes remain at ${backup}`,
          );
        }
      }
      throw error;
    }
  } finally {
    await rm(temporary, { force: true });
    if (committed && previousMoved) await rm(backup, { force: true });
  }
}
