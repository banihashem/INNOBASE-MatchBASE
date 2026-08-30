import type { Metadata } from "next";
import { AdminGovernanceQueue } from "../../../components/admin/AdminGovernanceQueue";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Requests and runs — MatchBASE Admin",
  description: "Read-only governance states for MatchBASE operators.",
};

export default function AdminRequestsPage() {
  return <AdminGovernanceQueue />;
}
