// Lê o arquivo do "Exportar conversa" do WhatsApp (sem mídia). Dois formatos comuns:
//   Android: "20/11/2026 14:35 - Pedro: texto"      (ou "20/11/26 14:35 - …")
//   iPhone:  "[20/11/2026, 14:35:12] Pedro: texto"
// Linhas sem cabeçalho continuam a mensagem anterior (mensagem com quebra de linha).
// Avisos do sistema ("Mensagens e chamadas são protegidas…", "Fulano mudou o número") ficam de fora.
// Sem dependências de servidor: roda na tela (prévia) e no servidor (testes).

export interface MensagemLida { autor: string; texto: string; em: string /* ISO */ }

const ANDROID = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),? (\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s?([ap])\.?\s?m\.?)? - ([^:]+?): ([\s\S]*)$/i;
const IPHONE = /^‎?\[(\d{1,2})\/(\d{1,2})\/(\d{2,4}),? (\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s?([ap])\.?\s?m\.?)?\] ([^:]+?): ([\s\S]*)$/i;
const CABECALHO_SEM_AUTOR = /^‎?\[?\d{1,2}\/\d{1,2}\/\d{2,4},? \d{1,2}:\d{2}/;
const MIDIA = /^‎?(<M[ií]dia oculta>|<Media omitted>|imagem ocultada|figurinha omitida|áudio ocultado|vídeo omitido|documento omitido)$/i;

function quando(d: string, m: string, a: string, h: string, min: string, s: string | undefined, ampm: string | undefined): string {
  let ano = Number(a);
  if (ano < 100) ano += 2000;
  let hora = Number(h);
  if (ampm) { const pm = ampm.toLowerCase() === "p"; if (pm && hora < 12) hora += 12; if (!pm && hora === 12) hora = 0; }
  // O arquivo traz o horário do celular; para o CRM, Brasília.
  const iso = `${ano}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T${String(hora).padStart(2, "0")}:${min}:${(s ?? "00").padStart(2, "0")}-03:00`;
  return new Date(iso).toISOString();
}

export function lerArquivoWhatsapp(conteudo: string): { mensagens: MensagemLida[]; autores: string[] } {
  const mensagens: MensagemLida[] = [];
  let atual: MensagemLida | null = null;
  for (const bruta of conteudo.replace(/\r\n?/g, "\n").split("\n")) {
    const linha = bruta.replace(/^﻿/, "");
    const m = ANDROID.exec(linha) ?? IPHONE.exec(linha);
    if (m) {
      const [, d, mes, a, h, min, s, ampm, autor, texto] = m;
      atual = { autor: autor.replace(/^‎/, "").trim(), texto: texto.trim(), em: quando(d, mes, a, h, min, s, ampm) };
      mensagens.push(atual);
    } else if (CABECALHO_SEM_AUTOR.test(linha)) {
      atual = null; // aviso do sistema: não continua a mensagem anterior
    } else if (atual && linha.trim()) {
      atual.texto += `\n${linha}`;
    }
  }
  const uteis = mensagens.filter((x) => x.texto && !MIDIA.test(x.texto.trim()));
  return { mensagens: uteis, autores: [...new Set(uteis.map((x) => x.autor))] };
}
