import type { Metadata } from "next";
import { AdminEntitlementManager } from "../../../components/admin/AdminEntitlementManager";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Entitlements — MatchBASE Admin",
  description: "Super-admin entitlement grant and revoke control.",
};

export default function AdminEntitlementsPage() {
  return <AdminEntitlementManager />;
}
