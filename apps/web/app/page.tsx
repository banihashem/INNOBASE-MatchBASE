import { ProductFlow } from "../components/ProductFlow";

export const dynamic = "force-dynamic";

export default function Page() {
  const authPath =
    process.env.MATCHBASE_OIDC_SIMULATOR === "true"
      ? "/auth/simulator/start"
      : "/auth/google/start";
  return <ProductFlow authPath={authPath} />;
}
