import test from "node:test";
import assert from "node:assert/strict";
import { assinarSessao, verificarSessao } from "@/lib/auth/sessao";

const SEG = "segredo-de-teste-com-mais-de-16";

test("sessão válida volta com o uid; adulterada, expirada ou de outro segredo é recusada", async () => {
  const agora = 1_800_000_000;
  const t = await assinarSessao("u1", SEG, agora);
  assert.equal((await verificarSessao(t, SEG, agora + 10))?.uid, "u1");
  assert.equal(await verificarSessao(t, SEG, agora + 60 * 60 * 24 * 8), null, "expira em 7 dias");
  assert.equal(await verificarSessao(t, "outro-segredo-qualquer-16", agora + 10), null);
  const [corpo, mac] = t.split(".");
  const adulterado = Buffer.from(JSON.stringify({ uid: "admin", exp: agora + 99999 })).toString("base64url");
  assert.equal(await verificarSessao(`${adulterado}.${mac}`, SEG, agora + 10), null);
  assert.equal(await verificarSessao(`${corpo}.${mac}.x`, SEG, agora + 10), null);
  for (const lixo of [undefined, null, "", "abc", "a.b", "..."]) assert.equal(await verificarSessao(lixo, SEG, agora), null);
});
