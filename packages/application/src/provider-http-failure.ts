export type ProviderRequestFormat = "json_schema" | "json_object" | "text";

/** Controlled diagnostics only. Provider bodies can echo private request data. */
export interface ProviderHttpFailure {
  readonly http_status: number;
  readonly request_format: ProviderRequestFormat;
  readonly category:
    | "authentication"
    | "billing"
    | "permission"
    | "privacy"
    | "refusal"
    | "context_limit"
    | "schema_compatibility"
    | "unsupported_parameters"
    | "rate_limit"
    | "endpoint_unavailable"
    | "web_unavailable"
    | "unknown";
  readonly schema_issue?:
    "complexity" | "unsupported_feature" | "invalid_schema";
}

function errorDiagnostics(body: string): {
  text: string;
  typed: string;
  complete: boolean;
  recognizedTypes: boolean;
} {
  const messages: string[] = [];
  const types: string[] = [];
  let complete = body.length <= 65536;
  let messageBytes = 0;
  let typeBytes = 0;
  let inspected = 0;
  const addMessage = (message: string): void => {
    const remaining = Math.max(0, 32768 - messageBytes);
    if (message.length > remaining) complete = false;
    messages.push(message.slice(0, remaining));
    messageBytes += Math.min(message.length, remaining);
  };
  const addType = (value: unknown): void => {
    if (value === undefined || value === null) return;
    if (typeof value !== "string" && typeof value !== "number") {
      complete = false;
      return;
    }
    const item = String(value).toLowerCase();
    if (item.length > 256 || typeBytes + item.length > 8192) {
      complete = false;
      return;
    }
    types.push(item);
    typeBytes += item.length;
  };
  const inspect = (value: unknown, depth: number): void => {
    if (value === undefined || value === null) return;
    if (
      depth > 6 ||
      ++inspected > 32 ||
      typeof value !== "object" ||
      Array.isArray(value)
    ) {
      complete = false;
      return;
    }
    const record = value as Record<string, unknown>;
    // Unmodelled diagnostic containers may contain a restriction we cannot
    // safely classify. They cannot authorize a compatibility substitution.
    if (record.details !== undefined || record.errors !== undefined)
      complete = false;
    // Typed restrictions have their own budget; verbose prose cannot hide them.
    for (const key of ["status", "code", "type"]) addType(record[key]);
    if (typeof record.message === "string") addMessage(record.message);
    else if (record.message !== undefined && record.message !== null)
      complete = false;
    inspect(record.error, depth + 1);
    if (
      record.metadata &&
      typeof record.metadata === "object" &&
      !Array.isArray(record.metadata)
    ) {
      const metadata = record.metadata as Record<string, unknown>;
      if (metadata.details !== undefined || metadata.errors !== undefined)
        complete = false;
      for (const key of ["error_type", "provider_code", "error_code"]) {
        addType(metadata[key]);
      }
      inspect(metadata.error, depth + 1);
      const raw = metadata.raw;
      if (typeof raw === "string") {
        try {
          inspect(JSON.parse(raw), depth + 1);
        } catch {
          // Some upstream APIs return a plain diagnostic in metadata.raw.
          if (/^\s*[[{"]/.test(raw)) complete = false;
          else addMessage(raw);
        }
      } else inspect(raw, depth + 1);
    } else if (record.metadata !== undefined && record.metadata !== null)
      complete = false;
  };
  try {
    if (complete) inspect(JSON.parse(body), 0);
  } catch {
    // An unstructured response cannot establish safe schema compatibility.
    complete = false;
  }
  const allowedTypes =
    /^(?:400|422|invalid_argument|bad_request|invalid_request|invalid_request_error|invalid_schema|invalid_json_schema|schema_error|schema_validation_error|unsupported_schema|schema_too_complex)$/;
  return {
    text: messages.join("\n").toLowerCase(),
    typed: types.join("\n"),
    complete,
    recognizedTypes: types.every((value) => allowedTypes.test(value)),
  };
}

export function classifyProviderHttpFailure(
  body: string,
  status: number,
  requestFormat: ProviderRequestFormat,
): ProviderHttpFailure {
  const diagnostics = errorDiagnostics(body);
  const text = `${diagnostics.typed}\n${diagnostics.text}`;
  const numericCodes = new Set(diagnostics.typed.split("\n"));
  const base = { http_status: status, request_format: requestFormat };
  const result = (
    category: ProviderHttpFailure["category"],
  ): ProviderHttpFailure => ({
    ...base,
    category,
  });
  // Restrictions win even when an upstream message also mentions a schema.
  if (
    status === 401 ||
    numericCodes.has("401") ||
    /api[ _-]?key|authenticat|unauthori|invalid[_ ]credential/.test(text)
  )
    return result("authentication");
  if (
    status === 402 ||
    numericCodes.has("402") ||
    /insufficient.*(?:credit|fund)|payment|required.*credit|billing|spending.limit/.test(
      text,
    )
  )
    return result("billing");
  if (/zero.?data.?retention|\bzdr\b|privacy|data.*polic/.test(text))
    return result("privacy");
  if (
    /\brefus(?:al|ed)\b|safety|content.?polic|prohibited|recitation/.test(text)
  )
    return result("refusal");
  if (
    status === 403 ||
    numericCodes.has("403") ||
    /permission|forbidden|access.denied|disabled for (?:this|your) organization/.test(
      text,
    )
  )
    return result("permission");
  if (
    status === 413 ||
    numericCodes.has("413") ||
    /context.(?:length|window|limit)|maximum.*(?:input|prompt).*(?:token|length)|(?:input|prompt).*(?:too long|too large|exceeds.*token)/.test(
      text,
    )
  )
    return result("context_limit");
  if (
    diagnostics.complete &&
    diagnostics.recognizedTypes &&
    requestFormat === "json_schema" &&
    [400, 422].includes(status)
  ) {
    const schemaNamed =
      /\bschema\b|response[_ ]schema|response[_ ]json[_ ]schema|structured[_ ]outputs?/.test(
        text,
      );
    const issue = !schemaNamed
      ? undefined
      : /too (?:many states|complex|large)|complexity|nesting.*(?:limit|deep)|(?:grammar|automaton).*(?:limit|complex)/.test(
            text,
          )
        ? "complexity"
        : /(?:unsupported|not supported|does not support|not allowed|not permitted).*(?:schema|keyword|pattern|maxlength|minlength|enum|structured)|(?:schema|keyword|pattern|maxlength|minlength|enum|structured).*(?:unsupported|not supported|not allowed|not permitted)|unknown (?:name|field).*(?:response_schema|response_json_schema)|(?:response_schema|response_json_schema).*cannot find field/.test(
              text,
            )
          ? "unsupported_feature"
          : /invalid (?:json )?schema|schema.*(?:is invalid|must (?:be|have)|validation (?:error|failed))/.test(
                text,
              )
            ? "invalid_schema"
            : undefined;
    if (issue)
      return { ...base, category: "schema_compatibility", schema_issue: issue };
  }
  if (
    /unsupported.*param|parameter.*not.*support|require.parameters/.test(text)
  )
    return result("unsupported_parameters");
  if (status === 429 || /rate.limit|too.many.requests/.test(text))
    return result("rate_limit");
  if (/native.*search|web.*search.*support/.test(text))
    return result("web_unavailable");
  if (
    status === 404 ||
    /no.endpoints|model.*unavailable|model.*not.found/.test(text)
  )
    return result("endpoint_unavailable");
  return result("unknown");
}
