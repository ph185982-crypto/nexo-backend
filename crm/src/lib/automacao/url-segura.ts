// Webhook de automação só chama a internet pública: bloqueia loopback, rede privada, link-local, CGNAT e metadados de nuvem.
import { lookup } from "node:dns/promises";
import { lookup as lookupCallback, type LookupAddress } from "node:dns";
import https from "node:https";
import { isIP } from "node:net";

export function ipPrivado(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    if (x === "::" || x === "::1") return true;
    const mapeado = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x);
    if (mapeado) return ipPrivado(mapeado[1]);
    return /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || x.startsWith("ff");
  }
  return true; // não é IP válido: trata como inseguro
}

/**
 * lookup usado na CONEXÃO: confere o IP que será realmente usado. A checagem prévia (verificarUrlWebhook)
 * não basta sozinha: um DNS malicioso responde um IP público na checagem e um interno na conexão (rebinding).
 */
export function lookupSeguro(hostname: string, opcoes: { all?: boolean; family?: number }, cb: (err: Error | null, endereco?: string | LookupAddress[], familia?: number) => void): void {
  lookupCallback(hostname, { ...opcoes, all: true } as never, (err, enderecos) => {
    if (err) return cb(err);
    const lista = enderecos as unknown as LookupAddress[];
    if (lista.length === 0 || lista.some((e) => ipPrivado(e.address))) return cb(new Error("Endereço interno não permitido"));
    if (opcoes.all) cb(null, lista); else cb(null, lista[0].address, lista[0].family);
  });
}

/** POST JSON para um webhook. Sem redirecionamento (3xx vale como falha); o IP é validado na conexão. */
export function enviarWebhook(url: string, corpo: string, timeoutMs = 8000): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: "POST", lookup: lookupSeguro as never, timeout: timeoutMs, headers: { "content-type": "application/json", "content-length": Buffer.byteLength(corpo), "user-agent": "avanteza-crm" } }, (res) => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode ?? 0 }));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("O webhook demorou demais")));
    req.on("error", reject);
    req.end(corpo);
  });
}

export async function verificarUrlWebhook(url: string): Promise<void> {
  const u = new URL(url);
  if (u.protocol !== "https:") throw new Error("Webhook precisa usar https");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) throw new Error("Endereço interno não permitido");
  const enderecos = isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true }).catch(() => { throw new Error("Não foi possível resolver o endereço do webhook"); });
  if (enderecos.length === 0 || enderecos.some((e) => ipPrivado(e.address))) throw new Error("Endereço interno não permitido");
}
