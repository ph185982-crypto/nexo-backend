import { comChaveAvanteza } from "@/lib/comercial/integracao/avanteza";
import { listarModelos } from "@/lib/comercial/entrega/modelo";

export const dynamic = "force-dynamic";

export const GET = (req: Request) => comChaveAvanteza(req, async () => Response.json({ modelos: await listarModelos() }));
