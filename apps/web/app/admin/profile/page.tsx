import { AdminProductGate } from "../../../components/admin/AdminProductGate";

export const dynamic = "force-dynamic";

export default function AdminProfilePage() {
  return <AdminProductGate view="profile" />;
}
