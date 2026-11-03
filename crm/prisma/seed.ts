// Seed idempotente: usuário administrador, funil "Vendas" com etapas e orientações, motivos padrão.
// SEED_DEMO=true cria algumas oportunidades fictícias para ver o kanban preenchido.
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { garantirMotivosPadrao } from "../src/lib/funil/motivos";
import { criarOportunidade, moverOportunidade } from "../src/lib/funil/mover";
import { criarTarefa } from "../src/lib/atividades/tarefas";
import { criarCompromisso } from "../src/lib/atividades/compromissos";

const ETAPAS = [
  { nome: "Leads", tipo: "ABERTA", descricao: "Contato novo, ainda sem conversa qualificada. AÇÃO: confirmar se o Vendedor IA já abriu a conversa; se não, abordar em até 1 hora." },
  { nome: "Qualificação", tipo: "ABERTA", descricao: "Vendedor IA ou vendedor levantando segmento, faturamento, CNPJ e a dor principal. AÇÃO: ler a conversa e decidir: vira reunião ou encerra com motivo." },
  { nome: "Proposta e negociação", tipo: "ABERTA", descricao: "Solução e proposta apresentadas; aguardando retorno. AÇÃO: enviar a proposta, alinhar escopo, prazo, valor e condições." },
  { nome: "Contrato", tipo: "ABERTA", descricao: "Proposta aceita; contrato em assinatura e primeiro pagamento. AÇÃO: acompanhar assinatura e pagamento. Ao ganhar, abrir a entrega." },
  { nome: "Ganha", tipo: "GANHA", descricao: null },
  { nome: "Perdida", tipo: "PERDIDA", descricao: null },
] as const;

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  if (!email) throw new Error("Defina SEED_ADMIN_EMAIL");
  let senha = process.env.SEED_ADMIN_SENHA;
  const gerada = !senha;
  if (!senha) senha = randomBytes(9).toString("base64url");
  if (senha.length < 10) throw new Error("SEED_ADMIN_SENHA precisa ter ao menos 10 caracteres");

  const existente = await prisma.usuario.findUnique({ where: { email } });
  const admin = existente ?? await prisma.usuario.create({
    data: { nome: process.env.SEED_ADMIN_NOME?.trim() || "Administrador", email, senhaHash: await bcrypt.hash(senha, 10), papel: "ADMIN" },
  });
  console.log(existente ? `Usuário ${email} já existia (senha mantida).` : `Usuário ${email} criado.${gerada ? ` Senha gerada (aparece só agora): ${senha}` : ""}`);

  const funil = await prisma.funil.upsert({ where: { nome: "Vendas" }, update: {}, create: { nome: "Vendas", ordem: 0, padrao: true } });
  for (const [i, e] of ETAPAS.entries()) {
    await prisma.etapa.upsert({
      where: { funilId_nome: { funilId: funil.id, nome: e.nome } },
      update: {},
      create: { funilId: funil.id, nome: e.nome, ordem: i, tipo: e.tipo, descricao: e.descricao },
    });
  }
  await garantirMotivosPadrao();
  console.log("Funil Vendas e motivos padrão prontos.");

  if (process.env.SEED_DEMO === "true" && (await prisma.oportunidade.count({ where: { funilId: funil.id } })) === 0) {
    const etapas = await prisma.etapa.findMany({ where: { funilId: funil.id } });
    const porNome = (n: string) => etapas.find((e) => e.nome === n)!;
    const demo: Array<[string, string, string, number, string, number]> = [
      ["Padaria Estrela — gestão", "Padaria Estrela", "Leads", 0, "MORNA", 2],
      ["Oficina Rocha — vendas e processos", "Oficina Rocha", "Qualificação", 30_000, "MORNA", 17],
      ["Casa & Cia — marketing", "Casa & Cia Móveis", "Qualificação", 20_000, "FRIA", 9],
      ["Clínica Vitta — implantação", "Clínica Vitta", "Qualificação", 38_000, "RISCO_ALTO", 26],
      ["Mercado União — gestão", "Mercado União", "Contrato", 3_000, "QUENTE", 3],
    ];
    let i = 0;
    for (const [nome, empresa, etapa, valor, prob, dias] of demo) {
      i++;
      const contato = await prisma.contato.create({ data: { tipo: "EMPRESA", nome: empresa, responsavelId: admin.id, origem: "Demo" } });
      const op = await criarOportunidade({ nome, contatoId: contato.id, funilId: funil.id, etapaId: porNome("Leads").id, responsavelId: admin.id, valorUnico: valor, probabilidade: prob, origem: "Demo", tags: ["demo"], ator: "seed" });
      if (etapa !== "Leads") await moverOportunidade({ oportunidadeId: op.id, etapaId: porNome(etapa).id, origem: "MANUAL", ator: "seed", quando: new Date(Date.now() - dias * 86_400_000) });
      // Datas coerentes: criada alguns dias antes de entrar na etapa atual.
      const criadaEm = new Date(Date.now() - (dias + 3) * 86_400_000);
      await prisma.oportunidade.update({ where: { id: op.id }, data: { criadoEm: criadaEm, etapaDesdeEm: new Date(Date.now() - dias * 86_400_000), ultimaAtividadeEm: new Date(Date.now() - Math.floor(dias * 0.8) * 86_400_000) } });
      await prisma.historicoEtapa.updateMany({ where: { oportunidadeId: op.id, deEtapaId: null }, data: { entrouEm: criadaEm } });
      // Duas oportunidades com próxima atividade; as outras ficam "sem próxima atividade" (é o aviso que o cartão mostra).
      if (i === 2) await criarTarefa({ titulo: "Ligar para o dono e confirmar a proposta", tipo: "LIGACAO", prioridade: "ALTA", prazoEm: new Date(Date.now() + 3 * 3_600_000), oportunidadeId: op.id, responsavelId: admin.id, checklist: [{ texto: "Revisar a conversa do Vendedor IA", feito: true }, { texto: "Levar o diagnóstico de margem", feito: false }] });
      if (i === 5) await criarCompromisso({ assunto: "Reunião de assinatura do contrato", inicio: new Date(Date.now() + 26 * 3_600_000), fim: new Date(Date.now() + 27 * 3_600_000), oportunidadeId: op.id, responsavelId: admin.id, local: "Google Meet" });
    }
    console.log("Oportunidades fictícias criadas (SEED_DEMO).");
  }
}

main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
