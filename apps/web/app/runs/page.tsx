import { ProductRouter } from "../../components/ProductRouter";

export const dynamic = "force-dynamic";

export default function RunsHistoryPage() {
  const signedOutResearchMode =
    process.env.MATCHBASE_LIVE_RESEARCH_ENABLED === "true" &&
    process.env.MATCHBASE_LIVE_RESEARCH_CREDENTIALS_VERIFIED === "true" &&
    process.env.MATCHBASE_SYNTHETIC_FIXTURE !== "true"
      ? {
          id: "qualified_live_research" as const,
          label: "Qualified live research" as const,
          live_qualified: true,
        }
      : {
          id: "synthetic_reference" as const,
          label: "Synthetic reference" as const,
          live_qualified: false,
        };
  const authPath =
    process.env.MATCHBASE_OIDC_SIMULATOR === "true"
      ? "/auth/simulator/start"
      : "/auth/google/start";

  return (
    <ProductRouter
      authPath={authPath}
      signedOutResearchMode={signedOutResearchMode}
      initialView="runs"
    />
  );
}
