import {
  AdminResearchApplication,
  parseAdminResearchQuery,
  type RequestContext,
} from "@matchbase/application";

export async function handleAdminResearchRoute(input: {
  readonly method: string;
  readonly pathname: string;
  readonly searchParams: URLSearchParams;
  readonly context: RequestContext;
  readonly application: Pick<AdminResearchApplication, "read">;
}): Promise<{
  readonly status: 200;
  readonly body: Awaited<ReturnType<AdminResearchApplication["read"]>>;
  readonly headers: Readonly<Record<string, string>>;
} | null> {
  if (input.method !== "GET" || input.pathname !== "/api/v1/admin/research")
    return null;
  return {
    status: 200,
    body: await input.application.read(
      input.context,
      parseAdminResearchQuery([...input.searchParams.entries()]),
    ),
    headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
  };
}
