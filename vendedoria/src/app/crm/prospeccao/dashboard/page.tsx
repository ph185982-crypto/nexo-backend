import { redirect } from "next/navigation";

// Rota antiga — os resultados agora são uma aba do hub de Prospecção.
export default function DashboardRedirect() {
  redirect("/crm/prospeccao?aba=resultados");
}
