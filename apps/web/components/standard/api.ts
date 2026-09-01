class WorkspaceRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly correlationId: string | null,
  ) {
    super(message);
  }
}

export async function workspaceJson<T>(
  url: string,
  init: RequestInit = {},
  csrfToken?: string,
): Promise<{
  body: T;
  etag: string | null;
  notModified: boolean;
  pollAfterMs: number | null;
}> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
      ...init.headers,
    },
  });
  if (response.status === 304) {
    return {
      body: undefined as T,
      etag: response.headers.get("ETag"),
      notModified: true,
      pollAfterMs: parsePollAfter(response.headers.get("MB-Poll-After-Ms")),
    };
  }
  const body = (await response.json().catch(() => ({}))) as T & {
    detail?: string;
    correlation_id?: string;
    error?: { detail?: string; correlation_id?: string };
  };
  if (!response.ok) {
    throw new WorkspaceRequestError(
      body.detail ??
        body.error?.detail ??
        "The workspace request could not be completed.",
      response.status,
      body.correlation_id ??
        body.error?.correlation_id ??
        response.headers.get("MB-Correlation-Id"),
    );
  }
  return {
    body,
    etag: response.headers.get("ETag"),
    notModified: false,
    pollAfterMs: parsePollAfter(response.headers.get("MB-Poll-After-Ms")),
  };
}

function parsePollAfter(value: string | null): number | null {
  if (!value || !/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 250 && parsed <= 60_000
    ? parsed
    : null;
}

export function idempotencyKey(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export { WorkspaceRequestError };
