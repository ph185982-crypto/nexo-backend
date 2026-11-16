// Max ↔ Central Avanteza (Inbox de combinados): cliente HTTP com zod, timeout e retentativa só na leitura; ferramentas
// registrar_para_cliente, pendencias_do_cliente, concluir_acao e importar_conversa com fetch SIMULADO (sem rede, chave falsa).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CentralErro, criarClienteCentral, opcoesDoAmbiente, CENTRAL_URL_PADRAO } from "@/lib/integracoes/avanteza-central";
import { concluirAcao, ehConversaExportada, importarConversa, pendenciasDoCliente, registrarParaCliente } from "@/lib/max/tools/central";
import { MAX_TOOLS } from "@/lib/max/tools/definitions";

const CHAVE = "chave-captura-falsa-123";
type Chamada = { url: string; metodo: string; headers: Headers; corpo: unknown; bruto: Uint8Array | null };

function simular(fn: (c: Chamada, n: number) => Response | Promise<Response>) {
  const chamadas: Chamada[] = [];
  const f = (async (url: string | URL, init?: RequestInit) => {
    const b = init?.body;
    const c: Chamada = {
      url: String(url), metodo: init?.method ?? "GET", headers: new Headers(init?.headers as HeadersInit),
      corpo: typeof b === "string" ? JSON.parse(b) : null, bruto: b instanceof Uint8Array ? b : null,
    };
    chamadas.push(c);
    return fn(c, chamadas.length);
  }) as typeof fetch;
  return { chamadas, central: criarClienteCentral({ baseUrl: "https://central.test/", chave: CHAVE, fetchImpl: f, sleep: async () => {} }) };
}
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const acao = (id: string, titulo: string, extra: Record<string, unknown> = {}) => ({ id, titulo, prazo: "2026-11-20", status: "planejada", responsavel: "avanteza", atrasada: false, ...extra });

test("ambiente: CENTRAL_URL padrão app.avanteza.com.br; sem AVANTEZA_CAPTURE_KEY não chama a rede", async () => {
  assert.equal(opcoesDoAmbiente({}).baseUrl, CENTRAL_URL_PADRAO);
  assert.equal(CENTRAL_URL_PADRAO, "https://app.avanteza.com.br");
  assert.equal(opcoesDoAmbiente({ CENTRAL_URL: "https://x.test", AVANTEZA_CAPTURE_KEY: " k " }).chave, "k");
  let chamou = false;
  const c = criarClienteCentral({ chave: null, fetchImpl: (async () => { chamou = true; return json({}); }) as typeof fetch });
  await assert.rejects(c.pendencias("Ladies"), (e: unknown) => e instanceof CentralErro && e.codigo === "nao-configurado");
  assert.equal(chamou, false);
  const msg = await pendenciasDoCliente({ cliente: "Ladies" }, { central: c });
  assert.match(msg, /nao esta configurada/);
});

test("registrar_para_cliente: POST /api/capturas com Bearer, origem whatsapp_max; áudio vai como transcrição; lista as ações", async () => {
  const s = simular(() => json({ capturaId: "k1", duplicada: false, status: "processada", acoesCriadas: 2, acoes: [
    { id: "a1", titulo: "Enviar fotos novas", responsavel: "cliente", prazo: "2026-11-20" },
    { id: "a2", titulo: "Subir campanha", responsavel: "avanteza", prazo: "2026-11-19" },
  ] }, 201));
  const r = await registrarParaCliente({ cliente: "Showman", conteudo: "quero aumentar a verba em 20%", tipo: "audio" }, { central: s.central });
  const c = s.chamadas[0];
  assert.equal(c.url, "https://central.test/api/capturas");
  assert.equal(c.metodo, "POST");
  assert.equal(c.headers.get("authorization"), `Bearer ${CHAVE}`);
  assert.deepEqual(c.corpo, { clienteNome: "Showman", origem: "whatsapp_max", autor: "Pedro (via Max)", texto: null, transcricao: "quero aumentar a verba em 20%", data: null });
  assert.match(r, /Registrado para Showman\. 2 acao/);
  assert.match(r, /Enviar fotos novas \(cliente, 20\/11\/2026\)/);
  await registrarParaCliente({ cliente: "Showman", conteudo: "olha isso", tipo: "encaminhada", data: "2026-11-10" }, { central: s.central });
  assert.equal((s.chamadas[1].corpo as any).texto, "[mensagem encaminhada] olha isso");
  assert.equal((s.chamadas[1].corpo as any).data, "2026-11-10");
  assert.match(await registrarParaCliente({ cliente: "S", conteudo: "x" }, { central: s.central }), /Faltou o cliente/);
  assert.match(await registrarParaCliente({ cliente: "Showman" }, { central: s.central }), /Faltou o conteudo/);
  assert.equal(s.chamadas.length, 2, "sem cliente/conteúdo não chama a Central");
});

test("cliente ambíguo (409) → o Max pergunta com as opções; 404; 401/503 sem vazar a chave; escrita NÃO é repetida em 5xx", async () => {
  const amb = simular(() => json({ error: "Mais de um cliente com esse nome: diga qual", candidatos: ["Barbearia Centro", "Barbearia Showman"] }, 409));
  const r = await registrarParaCliente({ cliente: "barbearia", conteudo: "x" }, { central: amb.central });
  assert.match(r, /CLIENTE AMBIGUO/);
  assert.match(r, /Barbearia Centro, Barbearia Showman/);
  const nf = simular(() => json({ error: "Cliente não encontrado" }, 404));
  assert.match(await pendenciasDoCliente({ cliente: "Zeta" }, { central: nf.central }), /nao encontrado na Central/);
  for (const st of [401, 503]) {
    const s = simular(() => json({ error: "x" }, st));
    const m = await registrarParaCliente({ cliente: "Ladies", conteudo: "x" }, { central: s.central });
    assert.match(m, /nao esta configurada/);
    assert.ok(!m.includes(CHAVE));
  }
  const e5 = simular(() => json({ error: "boom" }, 502));
  assert.match(await registrarParaCliente({ cliente: "Ladies", conteudo: "x" }, { central: e5.central }), /Nao deu certo/);
  assert.equal(e5.chamadas.length, 1, "POST nunca repete");
  const rede = simular(() => { throw new TypeError("fetch failed"); });
  assert.match(await concluirAcao({ cliente: "Ladies", acao: "x" }, { central: rede.central }), /consegui falar com a Central/);
  assert.equal(rede.chamadas.length, 1);
});

test("pendencias_do_cliente: GET com retentativa (só leitura), formato validado, lista com ids e atrasadas", async () => {
  const s = simular((_c, n) => n === 1 ? json({ error: "x" }, 503) : json({}));
  // 503 = não configurado: não repete
  await pendenciasDoCliente({ cliente: "Ladies" }, { central: s.central });
  assert.equal(s.chamadas.length, 1);
  const t = simular((_c, n) => n === 1 ? json({ error: "instável" }, 502) : json({
    cliente: { id: "c1", nome: "Ladies" }, total: 30, atrasadas: 1, doCliente: 2,
    acoes: [acao("a1", "Enviar custos e margens", { responsavel: "cliente", atrasada: true, prazo: "2026-11-10" }), acao("a2", "Reunião de kickoff", { status: "bloqueada" })],
  }));
  const r = await pendenciasDoCliente({ cliente: "Lâdies & Cia" }, { central: t.central });
  assert.equal(t.chamadas.length, 2, "GET repete uma vez em 5xx");
  assert.equal(t.chamadas[1].url, "https://central.test/api/capturas/pendencias?cliente=L%C3%A2dies%20%26%20Cia");
  assert.match(r, /^Ladies: 30 acao\(oes\) aberta\(s\), 1 atrasada\(s\), 2 dependem do cliente\./);
  assert.match(r, /\[id:a1\] Enviar custos e margens — cliente, 10\/11\/2026 \(ATRASADA\)/);
  assert.match(r, /\(bloqueada\)/);
  assert.match(r, /\+28 mais adiante/);
  const fora = simular(() => json({ cliente: "formato errado" }));
  assert.match(await pendenciasDoCliente({ cliente: "Ladies" }, { central: fora.central }), /formato inesperado/);
});

test("concluir_acao: clara conclui; parecida → opções numeradas com acao_id (não conclui); depois por id", async () => {
  const s = simular((c) => {
    const b = c.corpo as { acao?: string; acaoId?: string };
    if (b.acaoId) return json({ cliente: { id: "c1", nome: "Showman" }, concluida: { id: b.acaoId, titulo: "Otimizar campanhas de ADS" } });
    if (/campanha/.test(b.acao ?? "")) return json({ error: "Mais de uma ação parecida: confirme qual", opcoes: [acao("a1", "Estruturar campanhas de ADS"), acao("a2", "Otimizar campanhas de ADS")] }, 409);
    if (/pão/.test(b.acao ?? "")) return json({ error: "Nenhuma ação aberta parecida com isso" }, 404);
    return json({ cliente: { id: "c1", nome: "Showman" }, concluida: { id: "k", titulo: "Reunião de kickoff e alinhamento de metas" } });
  });
  assert.match(await concluirAcao({ cliente: "Showman", acao: "fiz o kickoff" }, { central: s.central }), /Concluida na Central: "Reunião de kickoff/);
  const amb = await concluirAcao({ cliente: "Showman", acao: "as campanhas" }, { central: s.central });
  assert.match(amb, /MAIS DE UMA ACAO PARECIDA/);
  assert.match(amb, /1\) \[acao_id:a1\] Estruturar campanhas de ADS/);
  assert.match(amb, /2\) \[acao_id:a2\] Otimizar/);
  const porId = await concluirAcao({ cliente: "Showman", acao_id: "a2" }, { central: s.central });
  assert.match(porId, /Otimizar campanhas de ADS/);
  assert.deepEqual(s.chamadas.at(-1)!.corpo, { cliente: "Showman", acaoId: "a2" });
  assert.match(await concluirAcao({ cliente: "Showman", acao: "comprei pão" }, { central: s.central }), /Nao achei acao aberta parecida/);
  assert.match(await concluirAcao({ cliente: "Showman" }, { central: s.central }), /Faltou dizer qual acao/);
});

test("importar_conversa: baixa a mídia pendente, manda o arquivo cru (zip/txt), limpa a pendência; cliente desconhecido → pergunta", async () => {
  let limpou = 0;
  const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("resto")]);
  const s = simular((c) => {
    if (!new URL(c.url).searchParams.get("cliente")) return json({ error: "Diga de qual cliente é esta conversa", titulo: null }, 400);
    return json({ clientId: "c1", titulo: "Showman Barbearia", mensagens: 10, novas: 7, duplicadas: 3, blocos: 2, acoesCriadas: 2, audiosTranscritos: 0, audiosNaoTranscritos: 1, semIa: false, erros: [] }, 201);
  });
  const deps = {
    central: s.central,
    lerPendente: async () => ({ mediaId: "m-1", arquivo: "WhatsApp Chat - Showman Barbearia.zip", recebidoEm: "2026-11-16T10:00:00Z" }),
    limparPendente: async () => { limpou++; },
    baixar: async (id: string) => { assert.equal(id, "m-1"); return zip; },
  };
  const semCliente = await importarConversa({}, deps);
  assert.match(semCliente, /nao sabe de qual cliente/);
  assert.equal(limpou, 0, "pendência fica até importar");
  const ok = await importarConversa({ cliente: "Showman" }, deps);
  assert.match(ok, /importada: 7 mensagem\(ns\) nova\(s\) \(3 ja estavam\), 2 acao/);
  assert.match(ok, /1 audio\(s\) nao transcrito/);
  assert.equal(limpou, 1);
  const c = s.chamadas.at(-1)!;
  assert.equal(c.headers.get("content-type"), "application/zip");
  assert.ok(c.bruto && Buffer.from(c.bruto).equals(zip));
  assert.match(c.url, /\/api\/capturas\/importar\?arquivo=WhatsApp\+Chat\+-\+Showman\+Barbearia\.zip&cliente=Showman$/);
  assert.match(await importarConversa({}, { ...deps, lerPendente: async () => null }), /Nao ha conversa exportada pendente/);
  assert.match(await importarConversa({ cliente: "x" }, { ...deps, baixar: async () => { throw new Error("expirou"); } }), /Nao consegui baixar/);
  const grande = await importarConversa({ cliente: "Showman" }, { ...deps, baixar: async () => Buffer.alloc(4 * 1024 * 1024 + 1) });
  assert.match(grande, /4 MB/);
});

test("documento .txt/.zip é conversa exportada (não comprovante); ferramentas registradas; prompt reconhece os pedidos sem tirar o financeiro", () => {
  assert.ok(ehConversaExportada("Conversa do WhatsApp com Ladies.txt", "text/plain"));
  assert.ok(ehConversaExportada("WhatsApp Chat - Showman.zip", "application/zip"));
  assert.ok(!ehConversaExportada("boleto.pdf", "application/pdf"));
  assert.ok(ehConversaExportada(null, "application/zip"));
  const nomes = MAX_TOOLS.map((t) => t.function.name);
  for (const n of ["registrar_para_cliente", "pendencias_do_cliente", "concluir_acao", "importar_conversa", "registrar_transacao", "gerenciar_receita_prevista"]) assert.ok(nomes.includes(n), n);
  assert.equal(new Set(nomes).size, nomes.length, "sem ferramenta duplicada");
  const exec = readFileSync("src/lib/max/tools/executors.ts", "utf8");
  for (const n of ["registrar_para_cliente", "pendencias_do_cliente", "concluir_acao", "importar_conversa"]) assert.match(exec, new RegExp(`case "${n}"`));
  const prompt = readFileSync("src/lib/max/prompt.ts", "utf8");
  assert.match(prompt, /o que falta para a <cliente>\?/);
  assert.match(prompt, /REGRA CRITICA — NUNCA FACA CONTA DE CABECA/, "regras financeiras continuam");
  assert.match(prompt, /"a Ladies pagou" = receita prevista/);
  const resp = readFileSync("src/lib/max/responder.ts", "utf8");
  assert.match(resp, /ehConversaExportada\(input\.media\.filename, input\.media\.mimeType\)/);
});
