import { redirect } from "next/navigation";

// Rota antiga — a fila de aprovação agora é a aba Revisão do hub de Prospecção.
export default function FilaRedirect() {
  redirect("/crm/prospeccao?aba=revisao");
}
