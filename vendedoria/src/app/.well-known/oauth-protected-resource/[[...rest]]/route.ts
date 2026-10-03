import { NextResponse } from "next/server";
import { origem } from "@/lib/mcp/oauth";

export function GET(req: Request) {
  const o = origem(req);
  return NextResponse.json(
    { resource: `${o}/api/mcp`, authorization_servers: [o], bearer_methods_supported: ["header"] },
    { headers: { "Access-Control-Allow-Origin": "*" } },
  );
}
