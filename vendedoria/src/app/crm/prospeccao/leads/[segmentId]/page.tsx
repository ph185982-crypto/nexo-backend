import { redirect } from "next/navigation";

// Rota antiga — as empresas de uma busca agora ficam na aba Empresas, filtradas.
export default async function LeadsSegmentoRedirect({ params }: { params: Promise<{ segmentId: string }> }) {
  const { segmentId } = await params;
  redirect(`/crm/prospeccao?aba=empresas&segmentId=${encodeURIComponent(segmentId)}`);
}
