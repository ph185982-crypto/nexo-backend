import { NextResponse } from "next/server";
import { verificar, emitirTokens, pkceConfere } from "@/lib/mcp/oauth";

const H = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };
const erro = (e: string, status = 400) => NextResponse.json({ error: e }, { status, headers: H });

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...H, "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "POST" } });
}

export async function POST(req: Request) {
  if (!process.env.MCP_SECRET) return erro("server_error", 500);
  const f = new URLSearchParams(await req.text());
  const grant = f.get("grant_type");

  if (grant === "authorization_code") {
    const c = verificar(f.get("code"), "code");
    const verifier = f.get("code_verifier") ?? "";
    if (!c || f.get("redirect_uri") !== c.uri || f.get("client_id") !== c.cid) return erro("invalid_grant");
    if (!verifier || !pkceConfere(verifier, String(c.ch))) return erro("invalid_grant");
    return NextResponse.json(emitirTokens(String(c.cid)), { headers: H });
  }
  if (grant === "refresh_token") {
    const r = verificar(f.get("refresh_token"), "refresh");
    if (!r) return erro("invalid_grant");
    return NextResponse.json(emitirTokens(String(r.cid)), { headers: H });
  }
  return erro("unsupported_grant_type");
}
