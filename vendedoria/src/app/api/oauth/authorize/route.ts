// Tela de autorização: o dono digita a chave de acesso (MCP_SECRET) para
// liberar o Claude. Em seguida volta ao redirect_uri com um código de 5 min.
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { assinar, verificar, agora, iguais, redirectPermitido, TTL_CODIGO } from "@/lib/mcp/oauth";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

interface Params { client_id: string; redirect_uri: string; state: string; code_challenge: string; code_challenge_method: string; response_type: string }

function lerParams(get: (k: string) => string | null): Params {
  return {
    client_id: get("client_id") ?? "", redirect_uri: get("redirect_uri") ?? "", state: get("state") ?? "",
    code_challenge: get("code_challenge") ?? "", code_challenge_method: get("code_challenge_method") ?? "",
    response_type: get("response_type") ?? "",
  };
}

function validar(p: Params): { erro: string } | { uris: string[]; nome: string } {
  const c = verificar(p.client_id, "client");
  if (!c) return { erro: "Cliente não registrado ou expirado." };
  const uris = (c.uris as string[]) ?? [];
  if (!redirectPermitido(p.redirect_uri, uris)) return { erro: "redirect_uri não registrado." };
  if (p.response_type !== "code") return { erro: "response_type inválido." };
  if (!p.code_challenge || p.code_challenge_method !== "S256") return { erro: "PKCE (S256) é obrigatório." };
  return { uris, nome: String(c.nome ?? "Cliente MCP") };
}

async function ehAdmin(): Promise<boolean> {
  const s = await auth();
  return (s?.user as { role?: string } | undefined)?.role === "ADMIN";
}

function pagina(p: Params, nome: string, erro?: string, admin = false, retorno = "") {
  const hid = Object.entries(p).map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`).join("");
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Autorizar acesso</title>
<style>body{font-family:system-ui,sans-serif;background:#0b0b0f;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}
form{background:#16161d;border:1px solid #2a2a35;border-radius:12px;padding:24px;max-width:380px;width:100%}
h1{font-size:18px;margin:0 0 8px}p{font-size:14px;color:#aaa;margin:0 0 16px}input[type=password]{width:100%;box-sizing:border-box;padding:10px;border-radius:8px;border:1px solid #333;background:#0b0b0f;color:#eee;font-size:16px}
button{margin-top:12px;width:100%;padding:10px;border:0;border-radius:8px;background:#6d5efc;color:#fff;font-size:15px;cursor:pointer}.l{display:block;text-align:center;padding:10px;border:1px solid #6d5efc;border-radius:8px;color:#b7afff;text-decoration:none;font-size:15px}.e{color:#ff6b6b;font-size:13px;margin-top:8px}</style></head>
<body><form method="post"><h1>Autorizar acesso ao Nexo Vendedoria</h1>
<p><b>${esc(nome)}</b> quer consultar leads, funil, clientes e contratos (somente leitura). ${admin ? "Você está logado como administrador — basta tocar em Autorizar." : "Entre no Nexo como administrador ou digite a chave de acesso."}</p>
${hid}${admin ? "" : `<a class="l" href="/login?callbackUrl=${encodeURIComponent(retorno)}">Entrar no Nexo</a><p style="margin:14px 0 6px">Ou use a chave de acesso:</p><input type="password" name="chave" placeholder="Chave de acesso" required>`}
${erro ? `<div class="e">${esc(erro)}</div>` : ""}<button type="submit">Autorizar</button></form></body></html>`;
  return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY" } });
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  const p = lerParams((k) => u.searchParams.get(k));
  const v = validar(p);
  if ("erro" in v) return new NextResponse(v.erro, { status: 400 });
  return pagina(p, v.nome, undefined, await ehAdmin(), u.pathname + u.search);
}

export async function POST(req: Request) {
  const segredo = process.env.MCP_SECRET;
  if (!segredo) return new NextResponse("MCP_SECRET não configurado", { status: 500 });
  const f = await req.formData();
  const p = lerParams((k) => (typeof f.get(k) === "string" ? (f.get(k) as string) : null));
  const v = validar(p);
  if ("erro" in v) return new NextResponse(v.erro, { status: 400 });
  const admin = await ehAdmin();
  const chave = typeof f.get("chave") === "string" ? (f.get("chave") as string) : "";
  if (!admin && !iguais(chave, segredo)) {
    await new Promise((r) => setTimeout(r, 800)); // freia tentativa em massa
    const u = new URL(req.url);
    return pagina(p, v.nome, "Chave incorreta.", false, u.pathname + "?" + new URLSearchParams(p as unknown as Record<string, string>));
  }
  const code = assinar({
    t: "code", exp: agora() + TTL_CODIGO, cid: p.client_id, uri: p.redirect_uri, ch: p.code_challenge,
  });
  const dest = new URL(p.redirect_uri);
  dest.searchParams.set("code", code);
  if (p.state) dest.searchParams.set("state", p.state);
  return NextResponse.redirect(dest, 303);
}
