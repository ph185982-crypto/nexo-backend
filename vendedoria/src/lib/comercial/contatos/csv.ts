// CSV mínimo e seguro: aspas, vírgula/ponto e vírgula/tab, BOM, CRLF. Sem dependências.

export function detectarSeparador(primeiraLinha: string): string {
  const conta = (c: string) => primeiraLinha.split(c).length - 1;
  const [melhor, vezes] = [";", ",", "\t"].map((c) => [c, conta(c)] as const).sort((a, b) => b[1] - a[1])[0];
  return vezes > 0 ? melhor : ",";
}

export function lerCsv(entrada: string): string[][] {
  const t = entrada.replace(/^﻿/, "");
  const sep = detectarSeparador(t.split(/\r?\n/, 1)[0] ?? "");
  const linhas: string[][] = [];
  let campo = "", linha: string[] = [], aspas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (aspas) {
      if (c === '"') { if (t[i + 1] === '"') { campo += '"'; i++; } else aspas = false; }
      else campo += c;
    } else if (c === '"' && campo === "") aspas = true;
    else if (c === sep) { linha.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      linha.push(campo); campo = "";
      if (linha.some((x) => x.trim() !== "")) linhas.push(linha);
      linha = [];
    } else campo += c;
  }
  linha.push(campo);
  if (linha.some((x) => x.trim() !== "")) linhas.push(linha);
  return linhas;
}

/** Célula que começa com = + - @ vira texto em Excel/Sheets e pode executar fórmula: prefixa com apóstrofo. */
const seguraParaPlanilha = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

export function gerarCsv(linhas: Array<Array<string | number | null | undefined>>, sep = ";"): string {
  const cel = (v: string | number | null | undefined) => {
    const s = seguraParaPlanilha(v === null || v === undefined ? "" : String(v));
    return /["\n\r;,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + linhas.map((l) => l.map(cel).join(sep)).join("\r\n") + "\r\n";
}
