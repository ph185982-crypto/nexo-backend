import { comChaveAvanteza } from "@/lib/integracao/avanteza";
import { listarResponsaveis } from "@/lib/entrega/quadro";

export const dynamic = "force-dynamic";

/** Possíveis responsáveis dos cartões (só id e nome). */
export const GET = (req: Request) => comChaveAvanteza(req, async () => Response.json({ usuarios: await listarResponsaveis() }));
