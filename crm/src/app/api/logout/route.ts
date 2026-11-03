import { COOKIE_SESSAO } from "@/lib/auth/sessao";

export async function POST() {
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json", "set-cookie": `${COOKIE_SESSAO}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` },
  });
}
