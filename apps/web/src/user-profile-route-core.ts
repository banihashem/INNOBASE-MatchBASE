import {
  ApplicationFault,
  type RequestContext,
  type UserProfileApplication,
} from "@matchbase/application";
import type { UserProfileHistoryV2 } from "@matchbase/contracts";

export interface UserProfileRouteResult {
  readonly status: 200;
  readonly body: UserProfileHistoryV2;
  readonly headers: Readonly<Record<string, string>>;
}

export async function handleUserProfileRoute(input: {
  readonly method: string;
  readonly pathname: string;
  readonly searchParams: URLSearchParams;
  readonly context: RequestContext;
  readonly application: Pick<UserProfileApplication, "getHistory">;
}): Promise<UserProfileRouteResult | null> {
  if (input.method !== "GET" || input.pathname !== "/api/v1/profile/history")
    return null;
  const entries = [...input.searchParams.entries()];
  if (
    entries.some(([key, value]) => key !== "cursor" || value.length === 0) ||
    entries.filter(([key]) => key === "cursor").length > 1
  )
    throw new ApplicationFault(
      400,
      "invalid-query",
      "MB-400-PROFILE",
      "Profile history query is invalid.",
    );
  return {
    status: 200,
    body: await input.application.getHistory(
      input.context,
      input.searchParams.get("cursor") ?? undefined,
    ),
    headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
  };
}
