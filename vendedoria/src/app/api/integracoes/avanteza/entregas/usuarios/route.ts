import { comChaveAvanteza } from "@/lib/comercial/integracao/avanteza";
import { listarResponsaveis } from "@/lib/comercial/entrega/quadro";

export const dynamic = "force-dynamic";

/** Possíveis responsáveis dos cartões (só id e nome). */
export const GET = (req: Request) => comChaveAvanteza(req, async () => Response.json({ usuarios: await listarResponsaveis() }));
