// Busca global da Central (Ctrl+K) no Comercial. Só leitura.
// GET /api/integracoes/avanteza/busca?q=<texto>&limite=<1..10>&tipos=oportunidades,contatos,contratos
// Authorization: Bearer <AVANTEZA_CRM_KEY> (sem a variável: 503; chave errada: 401; comparação em tempo constante).
// Resposta: { oportunidades?: Item[], contatos?: Item[], contratos?: Item[] } — só os tipos pedidos (padrão: todos),
// Item = { id, titulo, detalhe?, caminho } com caminho relativo sob /comercial/. Regras em src/lib/comercial/integracao/busca.ts.
import { comChaveAvanteza } from "@/lib/comercial/integracao/avanteza";
import { buscarParaCentral, lerParametros } from "@/lib/comercial/integracao/busca";

export const dynamic = "force-dynamic";

export const GET = (req: Request) => comChaveAvanteza(req, async () => {
  const { q, limite, tipos } = lerParametros(new URL(req.url));
  return Response.json(await buscarParaCentral(q, limite, tipos), { headers: { "Cache-Control": "no-store" } });
});
