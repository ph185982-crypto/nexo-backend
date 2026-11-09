// Google Meet → agente: OAuth, cifra do token, renovação, sincronização (vinculada, aguardando, sem transcrição,
// sem cliente), vínculo manual e rotas. O Google é falso: nenhuma chamada de rede.
import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { cenario } from "./_cenario";
import { prisma } from "@/lib/prisma";
import { criarOportunidade } from "@/lib/funil/mover";
import { apagarCredenciais, cifrar, credenciaisGoogle, decifrar, definirTransporteGoogle, emailDoIdToken, salvarCredenciais, urlDeAutorizacao, validarCredenciais } from "@/lib/google/cliente";
import { sincronizarConta, tokenDaConta, vincularReuniao } from "@/lib/google/reunioes";
import { assinarSessao, COOKIE_SESSAO } from "@/lib/auth/sessao";
import { GET as getCallback } from "@/app/api/google/callback/route";
import { GET as getConectar } from "@/app/api/google/conectar/route";
import { PATCH as patchReuniao } from "@/app/api/google/reunioes/[id]/route";

process.env.SESSION_SECRET = "segredo-de-teste-com-mais-de-16";
const H = 3_600_000;
const json = (dados: unknown, status = 200) => new Response(JSON.stringify(dados), { status, headers: { "content-type": "application/json" } });
const idToken = (email: string) => `x.${Buffer.from(JSON.stringify({ email })).toString("base64url")}.y`;

function comCredenciais<T>(f: () => Promise<T>): Promise<T> {
  const antes = [process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET];
  process.env.GOOGLE_CLIENT_ID = "cliente-teste"; process.env.GOOGLE_CLIENT_SECRET = "segredo-teste";
  return f().finally(() => {
    if (antes[0] === undefined) delete process.env.GOOGLE_CLIENT_ID; else process.env.GOOGLE_CLIENT_ID = antes[0];
    if (antes[1] === undefined) delete process.env.GOOGLE_CLIENT_SECRET; else process.env.GOOGLE_CLIENT_SECRET = antes[1];
    definirTransporteGoogle(null);
  });
}

test("cifra do refresh token, URL de autorização e e-mail do id_token", async () => {
  const c = cifrar("1//refresh-token");
  assert.notEqual(c, "1//refresh-token");
  assert.equal(decifrar(c), "1//refresh-token");
  const [iv, tag, dados] = c.split(".");
  assert.throws(() => decifrar([iv, tag, Buffer.from("adulterado").toString("base64url")].join(".")), "texto adulterado não decifra");
  assert.notEqual(cifrar("x"), cifrar("x"), "IV aleatório");
  const antes = process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_ID;
  await apagarCredenciais();
  await assert.rejects(urlDeAutorizacao("https://crm/api/google/callback", "s"), /Credenciais do Google não configuradas/);
  if (antes) process.env.GOOGLE_CLIENT_ID = antes;
  await comCredenciais(async () => {
    const u = new URL(await urlDeAutorizacao("https://crm.x/api/google/callback", "estado123"));
    assert.equal(u.searchParams.get("access_type"), "offline");
    assert.equal(u.searchParams.get("prompt"), "consent");
    assert.equal(u.searchParams.get("state"), "estado123");
    assert.match(u.searchParams.get("scope")!, /calendar\.readonly.*meetings\.space\.readonly/);
  });
  assert.equal(emailDoIdToken(idToken("pedro@avanteza.com")), "pedro@avanteza.com");
  assert.equal(emailDoIdToken("lixo"), null);
});

/** Google falso: responde por caminho e guarda as URLs chamadas. */
function googleFalso(rotas: Record<string, unknown | ((url: URL, init?: RequestInit) => Response)>) {
  const chamadas: string[] = [];
  definirTransporteGoogle(async (url, init) => {
    const u = new URL(url);
    chamadas.push(`${init?.method ?? "GET"} ${u.origin}${u.pathname}`);
    const chave = Object.keys(rotas).filter((k) => `${u.origin}${u.pathname}`.endsWith(k)).sort((a, b) => b.length - a.length)[0];
    if (!chave) return json({ error: { message: `sem rota ${u.pathname}` } }, 404);
    const r = rotas[chave];
    if (r instanceof Response) return r.clone();
    return typeof r === "function" ? (r as (u: URL, i?: RequestInit) => Response)(u, init) : json(r);
  });
  return chamadas;
}

test("token: usa o que está válido, renova o vencido; acesso revogado desativa a conta", async () => {
  const c = await cenario();
  const u = await prisma.usuario.create({ data: { nome: "G", email: `g1-${c.marca}@t.local`, senhaHash: "x" } });
  try {
    await comCredenciais(async () => {
      const agora = new Date();
      const conta = await prisma.contaGoogle.create({ data: { usuarioId: u.id, email: "pedro@avanteza.com", refreshTokenCifrado: cifrar("refresh-1"), accessToken: "ainda-vale", accessExpiraEm: new Date(agora.getTime() + 10 * 60_000), escopos: "" } });
      const chamadas = googleFalso({ "/token": (_u: URL, init?: RequestInit) => { assert.match(String(init?.body), /grant_type=refresh_token&refresh_token=refresh-1/); return json({ access_token: "novo", expires_in: 3600 }); } });
      assert.equal(await tokenDaConta(conta, agora), "ainda-vale");
      assert.equal(chamadas.length, 0);
      const vencida = await prisma.contaGoogle.update({ where: { id: conta.id }, data: { accessExpiraEm: new Date(agora.getTime() + 30_000) } });
      assert.equal(await tokenDaConta(vencida, agora), "novo");
      const salva = (await prisma.contaGoogle.findUnique({ where: { id: conta.id } }))!;
      assert.equal(salva.accessToken, "novo");
      assert.equal(salva.accessExpiraEm!.getTime(), agora.getTime() + 3600_000);

      googleFalso({ "/token": json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400) });
      await assert.rejects(tokenDaConta({ ...salva, accessExpiraEm: null }, agora), /revoked/);
      const off = (await prisma.contaGoogle.findUnique({ where: { id: conta.id } }))!;
      assert.equal(off.ativa, false);
      assert.match(off.erro!, /Conecte de novo/);
    });
  } finally { await prisma.usuario.delete({ where: { id: u.id } }); await c.limpar(); }
});

test("sincronizar: transcrição vai para o agente da oportunidade do convidado; aguarda, desiste, pede vínculo; não repete", async () => {
  const c = await cenario();
  const u = await prisma.usuario.create({ data: { nome: "G", email: `g2-${c.marca}@t.local`, senhaHash: "x" } });
  const emailCliente = `dono-${c.marca}@oficina.com.br`;
  const pessoa = await prisma.contato.create({ data: { tipo: "PESSOA", nome: `Dono ${c.marca}`, email: emailCliente.toUpperCase(), empresaId: c.contato.id } });
  try {
    await comCredenciais(async () => {
      const op = await criarOportunidade({ nome: `Oficina ${c.marca}`, contatoId: c.contato.id, pessoaId: pessoa.id, funilId: c.funil.id });
      const outra = await criarOportunidade({ nome: `Outra ${c.marca}`, contatoId: c.contato.id, funilId: c.funil.id });
      const agora = new Date("2026-11-09T18:00:00Z");
      const conta = await prisma.contaGoogle.create({ data: { usuarioId: u.id, email: "pedro@avanteza.com", refreshTokenCifrado: cifrar("r"), accessToken: "tk", accessExpiraEm: new Date(agora.getTime() + H), escopos: "" } });
      const iso = (h: number) => new Date(agora.getTime() - h * H).toISOString();
      let transcricaoBPronta = false;
      const chamadas = googleFalso({
        "/v2/conferenceRecords": (url: URL) => {
          assert.equal(url.searchParams.get("filter"), `end_time>="${new Date(agora.getTime() - 7 * 24 * H).toISOString()}"`, "1ª vez: últimos 7 dias");
          return json({ conferenceRecords: [
            { name: "conferenceRecords/A", startTime: iso(4), endTime: iso(3), space: "spaces/SA" }, // com cliente e transcrição
            { name: "conferenceRecords/B", startTime: iso(1.5), endTime: iso(0.5), space: "spaces/SB" }, // transcrição gerando
            { name: "conferenceRecords/C", startTime: iso(6), endTime: iso(5), space: "spaces/SC" }, // sem transcrição
            { name: "conferenceRecords/D", startTime: iso(9), endTime: iso(8), space: "spaces/SD" }, // convidado desconhecido
            { name: "conferenceRecords/E", startTime: iso(0.2), space: "spaces/SE" }, // ainda acontecendo
          ] });
        },
        "/conferenceRecords/A/transcripts": { transcripts: [{ name: "conferenceRecords/A/transcripts/T1", state: "FILE_GENERATED" }] },
        "/conferenceRecords/B/transcripts": () => json({ transcripts: [{ name: "conferenceRecords/B/transcripts/T2", state: transcricaoBPronta ? "FILE_GENERATED" : "ENDED" }] }),
        "/conferenceRecords/C/transcripts": { transcripts: [] },
        "/conferenceRecords/D/transcripts": { transcripts: [{ name: "conferenceRecords/D/transcripts/T4", state: "FILE_GENERATED" }] },
        "/conferenceRecords/A/participants": { participants: [{ name: "conferenceRecords/A/participants/p1", signedinUser: { displayName: "Pedro Martins" } }, { name: "conferenceRecords/A/participants/p2", anonymousUser: { displayName: "João (Oficina)" } }] },
        "/conferenceRecords/B/participants": { participants: [{ name: "conferenceRecords/B/participants/p1", signedinUser: { displayName: "Pedro Martins" } }] },
        "/conferenceRecords/D/participants": { participants: [{ name: "conferenceRecords/D/participants/p9", signedinUser: { displayName: "Alguém" } }] },
        "/transcripts/T1/entries": (url: URL) => url.searchParams.get("pageToken")
          ? json({ transcriptEntries: [{ participant: "conferenceRecords/A/participants/p2", text: "Combinado, até sexta mando os acessos do Meta.", startTime: iso(3.4) }] })
          : json({ transcriptEntries: [{ participant: "conferenceRecords/A/participants/p1", text: "Entrego o BI de vendas dia 20.", startTime: iso(3.5) }, { participant: "conferenceRecords/A/participants/p1", text: "   ", startTime: iso(3.45) }], nextPageToken: "pg2" }),
        "/transcripts/T2/entries": { transcriptEntries: [{ participant: "conferenceRecords/B/participants/p1", text: "Fechamos o escopo do tráfego pago.", startTime: iso(1) }] },
        "/transcripts/T4/entries": { transcriptEntries: [{ participant: "conferenceRecords/D/participants/p9", text: "Vamos marcar a próxima.", startTime: iso(8.5) }] },
        "/spaces/SA": { meetingCode: "abc-defg-hij" }, "/spaces/SB": { meetingCode: "bbb-bbbb-bbb" }, "/spaces/SD": { meetingCode: "ddd-dddd-ddd" },
        "/calendars/primary/events": (url: URL) => {
          assert.equal(url.searchParams.get("singleEvents"), "true");
          return json({ items: [
            { summary: "Kickoff Oficina", hangoutLink: "https://meet.google.com/abc-defg-hij", attendees: [{ email: "pedro@avanteza.com", self: true }, { email: emailCliente }, { email: "sala@resource.calendar.google.com", resource: true }] },
            { summary: "Tráfego Oficina", conferenceData: { conferenceId: "bbb-bbbb-bbb" }, attendees: [{ email: emailCliente }] },
            { summary: "Conversa com desconhecido", hangoutLink: "https://meet.google.com/ddd-dddd-ddd", attendees: [{ email: "fulano@desconhecido.com" }] },
          ] });
        },
      });

      const r1 = await sincronizarConta(conta.id, agora);
      assert.deepEqual(r1, { reunioes: 4, vinculadas: 1, semCliente: 1, aguardando: 1, semTranscricao: 1 });
      const porCodigo = async (n: string) => (await prisma.reuniaoGoogle.findUnique({ where: { conferenceRecord: `conferenceRecords/${n}` } }))!;
      const a = await porCodigo("A");
      assert.deepEqual([a.status, a.oportunidadeId, a.titulo, a.emails, a.meetingCode], ["VINCULADA", op.id, "Kickoff Oficina", [emailCliente], "abc-defg-hij"]);
      assert.equal(a.transcricao, "[11:30] Pedro Martins: Entrego o BI de vendas dia 20.\n[11:36] João (Oficina): Combinado, até sexta mando os acessos do Meta.", "falas em ordem, com nome e hora de Brasília; fala vazia fora; 2 páginas");
      const analise = (await prisma.analiseAgente.findUnique({ where: { id: a.analiseId! } }))!;
      assert.deepEqual([analise.oportunidadeId, analise.fonte, analise.fonteRef], [op.id, "REUNIAO", "conferenceRecords/A"]);
      assert.match(analise.texto, /^Reunião no Google Meet: Kickoff Oficina \(09\/11\/2026, 11:00\)\.\n\n\[11:30\] Pedro Martins/);
      const linha = await prisma.feedback.findFirst({ where: { oportunidadeId: op.id, autor: "google-meet" } });
      assert.match(linha!.texto, /Reunião no Google Meet: Kickoff Oficina \(60 min, 2 falas transcritas\)/);
      assert.equal(linha!.tipo, "REUNIAO");
      assert.equal((await porCodigo("B")).status, "AGUARDANDO");
      assert.equal((await porCodigo("C")).status, "SEM_TRANSCRICAO");
      assert.equal((await porCodigo("D")).status, "SEM_CLIENTE");
      assert.equal(await prisma.reuniaoGoogle.count({ where: { conferenceRecord: "conferenceRecords/E" } }), 0, "reunião em andamento fica para depois");
      assert.equal((await prisma.contaGoogle.findUnique({ where: { id: conta.id } }))!.ultimaSincronizacaoEm!.getTime(), agora.getTime());

      // Segunda rodada: a transcrição de B ficou pronta; A, C e D não são processadas de novo.
      transcricaoBPronta = true;
      const antes = chamadas.length;
      const depois = new Date(agora.getTime() + 20 * 60_000);
      googleFalso({}); // troca para garantir que o filtro da 2ª rodada seja conferido abaixo
      definirTransporteGoogle(null);
      const chamadas2 = googleFalso({
        "/v2/conferenceRecords": (url: URL) => {
          assert.match(url.searchParams.get("filter")!, /^end_time>="/);
          return json({ conferenceRecords: [{ name: "conferenceRecords/A", startTime: iso(4), endTime: iso(3), space: "spaces/SA" }, { name: "conferenceRecords/B", startTime: iso(1.5), endTime: iso(0.5), space: "spaces/SB" }, { name: "conferenceRecords/C", startTime: iso(6), endTime: iso(5), space: "spaces/SC" }] });
        },
        "/conferenceRecords/B/transcripts": { transcripts: [{ name: "conferenceRecords/B/transcripts/T2", state: "FILE_GENERATED" }] },
        "/conferenceRecords/B/participants": { participants: [{ name: "conferenceRecords/B/participants/p1", signedinUser: { displayName: "Pedro Martins" } }] },
        "/transcripts/T2/entries": { transcriptEntries: [{ participant: "conferenceRecords/B/participants/p1", text: "Fechamos o escopo do tráfego pago.", startTime: iso(1) }] },
        "/spaces/SB": { meetingCode: "bbb-bbbb-bbb" },
        "/calendars/primary/events": { items: [{ summary: "Tráfego Oficina", conferenceData: { conferenceId: "bbb-bbbb-bbb" }, attendees: [{ email: emailCliente }] }] },
      });
      const r2 = await sincronizarConta(conta.id, depois);
      assert.deepEqual(r2, { reunioes: 1, vinculadas: 1, semCliente: 0, aguardando: 0, semTranscricao: 0 });
      assert.ok(!chamadas2.some((x) => x.includes("/conferenceRecords/A/")), "A já vinculada: nem consulta");
      assert.equal((await porCodigo("B")).status, "VINCULADA");
      assert.ok(antes > 0);

      // D: vínculo à mão; vincular de novo não duplica a linha do tempo.
      const d = await porCodigo("D");
      await vincularReuniao(d.id, outra.id);
      await vincularReuniao(d.id, outra.id);
      assert.equal((await porCodigo("D")).status, "VINCULADA");
      assert.equal(await prisma.feedback.count({ where: { oportunidadeId: outra.id, autor: "google-meet" } }), 1);
      assert.equal(await prisma.analiseAgente.count({ where: { oportunidadeId: outra.id, fonte: "REUNIAO" } }), 1);
      await assert.rejects(vincularReuniao((await porCodigo("C")).id, outra.id), /sem transcrição/);

      // Google responde 403 (API não ativada): erro fica na conta, com a dica.
      googleFalso({ "/v2/conferenceRecords": json({ error: { message: "Google Meet REST API has not been used in project" } }, 403) });
      await assert.rejects(sincronizarConta(conta.id, depois), /403/);
      assert.match((await prisma.contaGoogle.findUnique({ where: { id: conta.id } }))!.erro!, /Google Meet REST API e a Google Calendar API/);
    });
  } finally {
    await prisma.usuario.delete({ where: { id: u.id } }); // conta e reuniões caem em cascata
    await c.limpar();
    await prisma.contato.deleteMany({ where: { id: pessoa.id } });
  }
});

test("rotas: conectar exige login e guarda o state; callback confere state e permissões; reunião de outro usuário não aparece", async () => {
  const c = await cenario();
  const u = await prisma.usuario.create({ data: { nome: "G", email: `g3-${c.marca}@t.local`, senhaHash: await bcrypt.hash("x", 4) } });
  const outro = await prisma.usuario.create({ data: { nome: "O", email: `g4-${c.marca}@t.local`, senhaHash: "x" } });
  const sessao = `${COOKIE_SESSAO}=${await assinarSessao(u.id, process.env.SESSION_SECRET!)}`;
  try {
    await comCredenciais(async () => {
      assert.equal((await getConectar(new Request("https://crm.x/api/google/conectar"))).status, 401);
      const r = await getConectar(new Request("https://crm.x/api/google/conectar", { headers: { cookie: sessao } }));
      assert.equal(r.status, 303);
      const destino = new URL(r.headers.get("location")!);
      assert.equal(destino.origin, "https://accounts.google.com");
      assert.equal(destino.searchParams.get("redirect_uri"), "https://crm.x/api/google/callback");
      const state = destino.searchParams.get("state")!;
      assert.match(r.headers.get("set-cookie")!, new RegExp(`google_oauth_state=${state}; Path=/api/google; HttpOnly`));

      const cb = (q: string, cookieState = state) => getCallback(new Request(`https://crm.x/api/google/callback?${q}`, { headers: { cookie: `${sessao}; google_oauth_state=${cookieState}` } }));
      const local = (res: Response) => new URL(res.headers.get("location")!).searchParams.get("google");
      assert.equal(local(await cb(`code=c1&state=${state}`, "outro")), "erro_state");
      assert.equal(local(await cb("error=access_denied")), "cancelado");
      googleFalso({ "/token": json({ access_token: "a", expires_in: 3600, refresh_token: "r1", scope: "openid email https://www.googleapis.com/auth/calendar.readonly", id_token: idToken("pedro@avanteza.com") }) });
      assert.equal(local(await cb(`code=c1&state=${state}`)), "escopos", "sem a permissão do Meet não conecta");
      googleFalso({ "/token": (_u: URL, init?: RequestInit) => {
        assert.match(String(init?.body), /redirect_uri=https%3A%2F%2Fcrm\.x%2Fapi%2Fgoogle%2Fcallback/);
        return json({ access_token: "a", expires_in: 3600, refresh_token: "r1", scope: "openid email https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/meetings.space.readonly", id_token: idToken("pedro@avanteza.com") });
      } });
      assert.equal(local(await cb(`code=c1&state=${state}`)), "ok");
      const conta = (await prisma.contaGoogle.findUnique({ where: { usuarioId: u.id } }))!;
      assert.deepEqual([conta.email, decifrar(conta.refreshTokenCifrado), conta.ativa], ["pedro@avanteza.com", "r1", true]);
      assert.ok(!conta.refreshTokenCifrado.includes("r1"));

      const contaOutro = await prisma.contaGoogle.create({ data: { usuarioId: outro.id, email: "o@x.com", refreshTokenCifrado: cifrar("z"), escopos: "" } });
      const alheia = await prisma.reuniaoGoogle.create({ data: { contaId: contaOutro.id, conferenceRecord: `conferenceRecords/X${c.marca}`, inicio: new Date(), status: "SEM_CLIENTE", emails: [], transcricao: "a" } });
      const pr = await patchReuniao(new Request("http://x", { method: "PATCH", headers: { cookie: sessao, "content-type": "application/json" }, body: JSON.stringify({ operacao: "ignorar" }) }), { params: Promise.resolve({ id: alheia.id }) });
      assert.equal(pr.status, 404);
    });
  } finally {
    await prisma.usuario.deleteMany({ where: { id: { in: [u.id, outro.id] } } });
    await c.limpar();
  }
});

test("credenciais salvas no CRM: validação, segredo cifrado no banco, variável de ambiente vale mais", async () => {
  const env = { id: process.env.GOOGLE_CLIENT_ID, segredo: process.env.GOOGLE_CLIENT_SECRET };
  delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_SECRET;
  try {
    assert.throws(() => validarCredenciais("123", "GOCSPX-abcdefghij"), /ID do cliente inválido/);
    assert.throws(() => validarCredenciais("1-ab.apps.googleusercontent.com", "curta"), /Chave secreta inválida/);
    await apagarCredenciais();
    assert.equal(await credenciaisGoogle(), null);
    await salvarCredenciais(validarCredenciais(" 1-ab.apps.googleusercontent.com ", "GOCSPX-segredo-teste"));
    const linha = await prisma.configuracao.findUniqueOrThrow({ where: { chave: "google.clientSecret" } });
    assert.ok(!linha.valor.includes("GOCSPX"), "segredo não fica em texto puro");
    assert.deepEqual(await credenciaisGoogle(), { clientId: "1-ab.apps.googleusercontent.com", clientSecret: "GOCSPX-segredo-teste", origem: "CONFIGURACAO" });
    process.env.GOOGLE_CLIENT_ID = "env.apps.googleusercontent.com"; process.env.GOOGLE_CLIENT_SECRET = "segredo-do-ambiente";
    assert.equal((await credenciaisGoogle())?.origem, "AMBIENTE");
  } finally {
    await apagarCredenciais();
    if (env.id) process.env.GOOGLE_CLIENT_ID = env.id; else delete process.env.GOOGLE_CLIENT_ID;
    if (env.segredo) process.env.GOOGLE_CLIENT_SECRET = env.segredo; else delete process.env.GOOGLE_CLIENT_SECRET;
  }
});
