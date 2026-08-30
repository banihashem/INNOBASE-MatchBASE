import {
  readAdminUnprojectedResult,
  type ConnectionPool,
} from "@matchbase/data";
import { ApplicationFault, type RequestContext } from "./types.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export interface AdminUnprojectedReadDto {
  readonly run_id: string;
  readonly justification: string;
}

function schemaFault(): never {
  throw new ApplicationFault(
    422,
    "invalid-schema",
    "MB-422-SCHEMA",
    "Unprojected access request is invalid.",
  );
}

export function parseAdminUnprojectedReadDto(
  value: unknown,
): AdminUnprojectedReadDto {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return schemaFault();
  }
  const input = value as Record<string, unknown>;
  if (
    Object.keys(input).length !== 2 ||
    !Object.hasOwn(input, "run_id") ||
    !Object.hasOwn(input, "justification") ||
    typeof input.run_id !== "string" ||
    !UUID_PATTERN.test(input.run_id) ||
    typeof input.justification !== "string" ||
    input.justification !== input.justification.trim() ||
    input.justification.length < 1 ||
    input.justification.length > 2_000 ||
    [...input.justification].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 0x1f || code === 0x7f;
    })
  ) {
    return schemaFault();
  }
  return { run_id: input.run_id, justification: input.justification };
}

export class AdminUnprojectedApplication {
  constructor(private readonly pool: ConnectionPool) {}

  async read(context: RequestContext, input: AdminUnprojectedReadDto) {
    const result = await readAdminUnprojectedResult(this.pool, {
      accountId: context.accountId,
      actorUserId: context.userId,
      runId: input.run_id,
      justification: input.justification,
      correlationId: context.correlationId,
      deploymentId: context.deploymentId,
    });
    if (result.status === 403) {
      throw new ApplicationFault(
        403,
        "unprojected-role-required",
        "MB-403-UNPROJECTED",
        "The unprojected result is not visible.",
        false,
        {},
        true,
      );
    }
    return {
      ...result.body,
      assembled_at: result.body.assembled_at.toISOString(),
      disclosure_audit_id: result.disclosureAuditId,
    };
  }
}
