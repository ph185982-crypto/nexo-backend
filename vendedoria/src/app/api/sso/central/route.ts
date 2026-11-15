// Atalho "Central" do cabeçalho: leva ao painel da Central da Avanteza. Fica numa rota porque o endereço
// vem de AVANTEZA_HUB_URL (variável só do servidor) e o cabeçalho é componente de cliente.
import { centralUrl } from "@/lib/avanteza-sso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return new Response(null, { status: 302, headers: { Location: centralUrl(), "Cache-Control": "no-store" } });
}
