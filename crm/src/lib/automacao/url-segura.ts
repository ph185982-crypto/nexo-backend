// Webhook de automação só chama a internet pública: bloqueia loopback, rede privada, link-local, CGNAT e metadados de nuvem.
import { lookup } from "node:dns/promises";
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

export async function verificarUrlWebhook(url: string): Promise<void> {
  const u = new URL(url);
  if (u.protocol !== "https:") throw new Error("Webhook precisa usar https");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) throw new Error("Endereço interno não permitido");
  const enderecos = isIP(host) ? [{ address: host }] : await lookup(host, { all: true, verbatim: true }).catch(() => { throw new Error("Não foi possível resolver o endereço do webhook"); });
  if (enderecos.length === 0 || enderecos.some((e) => ipPrivado(e.address))) throw new Error("Endereço interno não permitido");
}
