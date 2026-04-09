/**
 * Diagnóstico de passagem de bastão para uma conversa específica
 * GET /api/debug/passagem-diag?conversationId=xxx&secret=<CRON_SECRET>
 * POST /api/debug/passagem-diag  body: { conversationId } — autenticado por sessão
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma/client";
import { auth } from "@/lib/auth";

interface CollectedData {
  localizacao?: string;
  endereco?: string;
  pagamento?: string;
  horario?: string;
  nome?: string;
}

function extractCollectedData(messages: Array<{ role: string; content: string }>): CollectedData {
  const data: CollectedData = {};
  const allText = messages.map((m) => m.content).join("\n").toLowerCase();

  const locMsg = messages.find((m) =>
    /\[Localiza[çc][aã]o\s+recebida\]/.test(m.content) ||
    /lat:[-\d.]+\s+lng:[-\d.]+/.test(m.content) ||
    /maps\.google\.com/.test(m.content) ||
    /maps\.app\.goo\.gl/.test(m.content) ||
    /goo\.gl\/maps/.test(m.content) ||
    /\bwaze\.com\b/.test(m.content)
  );
  if (locMsg) {
    data.localizacao = locMsg.content.substring(0, 120);
    data.endereco = locMsg.content.substring(0, 120);
  } else {
    const endMsg = messages.find((m) =>
      m.role === "USER" && (
        /\b(rua|av\.?|avenida|travessa|alameda|setor|quadra|lote)\b.{3,}/i.test(m.content) ||
        /\b\d{5}[-\s]?\d{3}\b/.test(m.content) ||
        /\b(goiania|goiânia|aparecida|senador|trindade|anapolis|anapolís)\b/i.test(m.content)
      ) && m.content.length > 10
    );
    if (endMsg) {
      data.localizacao = endMsg.content.substring(0, 120);
      data.endereco = endMsg.content.substring(0, 120);
    }
  }

  if (/\bdinheiro\b/.test(allText)) data.pagamento = "dinheiro";
  else if (/\bpix\b/.test(allText)) data.pagamento = "pix";
  else if (/\bcart[aã]o\b/.test(allText)) data.pagamento = "cartão";

  const horarioMsg = messages.find((m) =>
    m.role === "USER" && /\b(\d{1,2})\s*[h:]\s*(\d{0,2})|(até|ate)\s+\d/.test(m.content)
  );
  if (horarioMsg) data.horario = horarioMsg.content.substring(0, 120);

  const nomePatterns = [
    /(?:meu\s+nome\s+[eé]|nome\s+[eé]|pode\s+colocar\s+no\s+nome\s+(?:de|do|da)?|chamo[-\s]+me\s+|me\s+chamo\s+|sou\s+o?\s+)\s*([A-Za-záéíóúãõâêôçÁÉÍÓÚÃÕÂÊÔÇ][a-záéíóúãõâêôç]{1,}(?:\s+[A-Za-záéíóúãõâêôçÁÉÍÓÚÃÕÂÊÔÇ][a-záéíóúãõâêôç]{1,})*)/i,
  ];
  let nomeFound: string | undefined;
  for (const m of messages) {
    if (m.role !== "USER") continue;
    for (const re of nomePatterns) {
      const match = re.exec(m.content);
      if (match?.[1]) { nomeFound = match[1].trim(); break; }
    }
    if (nomeFound) break;
    const trimmed = m.content.trim();
    if (/^[A-Za-záéíóúãõâêôçÁÉÍÓÚÃÕÂÊÔÇ]{2,}(\s+[A-Za-záéíóúãõâêôçÁÉÍÓÚÃÕÂÊÔÇ]{2,}){0,3}$/.test(trimmed) && trimmed.length >= 4 && trimmed.length <= 60) {
      nomeFound = trimmed; break;
    }
  }
  if (nomeFound) data.nome = nomeFound;

  return data;
}

async function runDiag(conversationId: string) {
  const conversation = await prisma.whatsappConversation.findUnique({
    where: { id: conversationId },
    include: { lead: true },
  });

  if (!conversation) return { error: `Conversa '${conversationId}' não encontrada` };

  const recentMessages = await prisma.whatsappMessage.findMany({
    where: { conversationId },
    orderBy: { sentAt: "desc" },
    take: 30,
    select: { id: true, role: true, content: true, sentAt: true, type: true },
  });

  const msgs = recentMessages.slice().reverse();
  const collectedData = extractCollectedData(msgs.map(m => ({ role: m.role, content: m.content })));

  const temEndereco  = !!(collectedData.endereco || collectedData.localizacao);
  const dadosCompletos = temEndereco && !!collectedData.horario && !!collectedData.pagamento && !!collectedData.nome;
  const passagemJaFeita = recentMessages.some((m) => /\[PASSAGEM\]/.test(m.content));

  // Últimas 15 msgs do cliente para inspeção
  const clientMsgs = msgs
    .filter(m => m.role === "USER")
    .slice(-15)
    .map(m => ({ sentAt: m.sentAt, content: m.content.substring(0, 150) }));

  return {
    conversationId,
    leadStatus: conversation.lead?.status ?? null,
    etapa: (conversation as typeof conversation & { etapa?: string }).etapa ?? "N/A",
    humanTakeover: (conversation as typeof conversation & { humanTakeover?: boolean }).humanTakeover ?? false,
    foraAreaEntrega: (conversation as typeof conversation & { foraAreaEntrega?: boolean }).foraAreaEntrega ?? false,
    resumoEnviado: (conversation as typeof conversation & { resumoEnviado?: boolean }).resumoEnviado ?? false,

    // Estado da passagem
    dadosCompletos,
    passagemJaFeita,
    camposFaltando: [
      !temEndereco && "❌ endereço/localização",
      !collectedData.horario && "❌ horário",
      !collectedData.pagamento && "❌ pagamento",
      !collectedData.nome && "❌ nome",
    ].filter(Boolean),
    camposDetectados: {
      endereco:    collectedData.endereco ?? null,
      localizacao: collectedData.localizacao ?? null,
      horario:     collectedData.horario ?? null,
      pagamento:   collectedData.pagamento ?? null,
      nome:        collectedData.nome ?? null,
    },

    // Mensagens do cliente para inspeção manual
    totalMensagens: recentMessages.length,
    mensagensCliente: clientMsgs,
  };
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json() as { conversationId?: string };
  if (!body.conversationId) return NextResponse.json({ error: "conversationId obrigatório" }, { status: 400 });
  return NextResponse.json(await runDiag(body.conversationId));
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (url.searchParams.get("secret") !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const conversationId = url.searchParams.get("conversationId") ?? "";
  if (!conversationId) return NextResponse.json({ error: "conversationId obrigatório" }, { status: 400 });
  return NextResponse.json(await runDiag(conversationId));
}
