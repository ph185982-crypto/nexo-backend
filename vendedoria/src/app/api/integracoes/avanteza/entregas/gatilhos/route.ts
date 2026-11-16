import { comChaveAvanteza } from "@/lib/comercial/integracao/avanteza";
import { gatilhosDeEntrega } from "@/lib/comercial/entrega/quadro";

export const dynamic = "force-dynamic";

/** Automações dos gatilhos de entrega (somente leitura; quem edita é o CRM). */
export const GET = (req: Request) => comChaveAvanteza(req, async () => Response.json(await gatilhosDeEntrega()));
