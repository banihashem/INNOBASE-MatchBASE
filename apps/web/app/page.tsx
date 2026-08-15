import { ProductRouter } from "../components/ProductRouter";

export const dynamic = "force-dynamic";

export default function Page() {
  const authPath =
    process.env.MATCHBASE_OIDC_SIMULATOR === "true"
      ? "/auth/simulator/start"
      : "/auth/google/start";
  return <ProductRouter authPath={authPath} />;
}
