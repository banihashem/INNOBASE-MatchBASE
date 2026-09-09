import { ProductRouter } from "../components/ProductRouter";

export const dynamic = "force-dynamic";

export default function Page() {
  const authPath =
    process.env.MATCHBASE_OIDC_SIMULATOR === "true"
      ? "/auth/simulator/start?fixture=consultant"
      : "/auth/google/start";
  return <ProductRouter consultantOnly authPath={authPath} />;
}
