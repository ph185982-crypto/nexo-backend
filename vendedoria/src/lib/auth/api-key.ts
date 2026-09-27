// Chaves de API para integração externa (MCP server, automações, outros
// agentes de IA). Dão o mesmo acesso de um ADMIN logado, sem sessão de
// navegador — pensadas para "eu mando essa chave pra qualquer ferramenta e
// ela já consegue ler e editar o sistema".
//
// A chave (nexo_live_xxxxxxxx...) só existe em texto puro no momento da
// criação — daí em diante só o hash sha256 fica no banco.

import { randomBytes, createHash, timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma/client";
import type { NextRequest } from "next/server";

const PREFIXO = "nexo_live_";

function hash(chave: string): string {
  return createHash("sha256").update(chave).digest("hex");
}

export function gerarChaveApi(): { chave: string; prefixo: string; hash: string } {
  const chave = `${PREFIXO}${randomBytes(24).toString("hex")}`;
  return { chave, prefixo: chave.slice(0, 18), hash: hash(chave) };
}

function extrairChave(req: NextRequest): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  const header = req.headers.get("x-api-key");
  return header?.trim() || null;
}

export interface ApiKeyValida {
  id: string;
  nome: string;
}

/**
 * Valida o header Authorization/x-api-key contra as chaves cadastradas.
 * Devolve null quando não há chave, a chave é inválida ou foi revogada.
 * Atualiza `ultimoUsoEm` em segundo plano (não bloqueia a resposta).
 */
export async function validarChaveApi(req: NextRequest): Promise<ApiKeyValida | null> {
  const chave = extrairChave(req);
  if (!chave || !chave.startsWith(PREFIXO)) return null;

  const alvo = hash(chave);
  // Chaves são poucas (uso interno) — busca todas as ativas e compara em tempo
  // constante em vez de indexar por hash bruto exposto em query.
  const candidatas = await prisma.apiKey.findMany({
    where: { revogadaEm: null },
    select: { id: true, nome: true, hash: true },
  });
  const alvoBuf = Buffer.from(alvo, "hex");
  const encontrada = candidatas.find((c) => {
    const buf = Buffer.from(c.hash, "hex");
    return buf.length === alvoBuf.length && timingSafeEqual(buf, alvoBuf);
  });
  if (!encontrada) return null;

  void prisma.apiKey.update({ where: { id: encontrada.id }, data: { ultimoUsoEm: new Date() } }).catch(() => {});
  return { id: encontrada.id, nome: encontrada.nome };
}
