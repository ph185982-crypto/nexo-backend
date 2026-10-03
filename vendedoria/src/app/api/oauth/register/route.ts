// Registro dinâmico de cliente (RFC 7591), sem estado: o client_id é um
// payload assinado que carrega os redirect_uris registrados.
import { NextResponse } from "next/server";
import { assinar, agora } from "@/lib/mcp/oauth";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...CORS, "Access-Control-Allow-Methods": "POST" } });
}

export async function POST(req: Request) {
  if (!process.env.MCP_SECRET) {
    return NextResponse.json({ error: "server_error", error_description: "MCP_SECRET não configurado" }, { status: 500, headers: CORS });
  }
  const body = (await req.json().catch(() => ({}))) as { redirect_uris?: unknown; client_name?: unknown };
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u): u is string => typeof u === "string") : [];
  const validos = uris.filter((u) => {
    try {
      const p = new URL(u);
      return p.protocol === "https:" || p.hostname === "localhost" || p.hostname === "127.0.0.1";
    } catch { return false; }
  });
  if (!validos.length || validos.length > 10) {
    return NextResponse.json({ error: "invalid_redirect_uri" }, { status: 400, headers: CORS });
  }
  const nome = typeof body.client_name === "string" ? body.client_name.slice(0, 80) : "Cliente MCP";
  const client_id = assinar({ t: "client", exp: agora() + 60 * 60 * 24 * 365, uris: validos, nome });
  return NextResponse.json(
    {
      client_id, client_name: nome, redirect_uris: validos,
      grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    { status: 201, headers: CORS },
  );
}
