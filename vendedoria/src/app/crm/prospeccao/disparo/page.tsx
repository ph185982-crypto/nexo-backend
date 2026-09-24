import { redirect } from "next/navigation";

// Rota antiga — o Disparo agora é uma aba do hub de Prospecção.
export default function DisparoRedirect() {
  redirect("/crm/prospeccao?aba=disparo");
}
