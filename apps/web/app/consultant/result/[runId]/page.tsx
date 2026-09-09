import { redirect } from "next/navigation";

export default async function ConsultantResultRedirectPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  redirect(`/runs/${encodeURIComponent(runId)}`);
}
