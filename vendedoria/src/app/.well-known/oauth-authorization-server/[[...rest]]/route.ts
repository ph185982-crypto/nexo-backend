import { NextResponse } from "next/server";
import { origem } from "@/lib/mcp/oauth";

export function GET(req: Request) {
  const o = origem(req);
  return NextResponse.json(
    {
      issuer: o,
      authorization_endpoint: `${o}/api/oauth/authorize`,
      token_endpoint: `${o}/api/oauth/token`,
      registration_endpoint: `${o}/api/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    },
    { headers: { "Access-Control-Allow-Origin": "*" } },
  );
}
