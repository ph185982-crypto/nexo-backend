// npm run whatsapp:nome — mostra o status do nome de exibição do WhatsApp da Júlia e, se a Meta já aprovou "Avanteza",
// registra o número de novo (pede confirmação antes). Precisa de DATABASE_URL e do token (no banco ou em
// META_WHATSAPP_ACCESS_TOKEN); o registro precisa de WHATSAPP_2FA_PIN. Nunca imprime token nem PIN.
import { createInterface } from "node:readline/promises";
import { registrarNumero, statusDoNome } from "../src/lib/whatsapp/perfil-avanteza";

async function main() {
  const s = await statusDoNome();
  if (!s) { console.log("Conta da Júlia não encontrada no banco."); return; }
  if (s.erro) { console.log(`Não consegui ler o status: ${s.erro}`); return; }
  console.log(`Nome verificado hoje: ${s.verified_name ?? "?"} (${s.name_status ?? "?"})`);
  console.log(`Nome pedido: ${s.new_display_name ?? "—"} | status do pedido: ${s.new_name_status ?? "—"}`);
  if (!/APPROVED/i.test(String(s.new_name_status ?? ""))) { console.log("Ainda não aprovado: nada a fazer (registrar antes da aprovação não tem efeito)."); return; }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const r = (await rl.question("Nome aprovado. Registrar o número agora? (digite SIM) ")).trim();
  rl.close();
  if (r !== "SIM") { console.log("Cancelado."); return; }
  const out = await registrarNumero();
  console.log(out.ok ? "Número registrado. O nome \"Avanteza\" passa a aparecer." : `Falhou: ${out.erro}`);
}
main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
