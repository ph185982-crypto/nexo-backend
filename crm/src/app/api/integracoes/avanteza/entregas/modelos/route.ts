import { comChaveAvanteza } from "@/lib/integracao/avanteza";
import { listarModelos } from "@/lib/entrega/modelo";

export const dynamic = "force-dynamic";

export const GET = (req: Request) => comChaveAvanteza(req, async () => Response.json({ modelos: await listarModelos() }));
