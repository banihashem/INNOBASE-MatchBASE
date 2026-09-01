import { AdminProductGate } from "../../../components/admin/AdminProductGate";

export const dynamic = "force-dynamic";

export default function AdminProductPage() {
  return <AdminProductGate view="product" />;
}
