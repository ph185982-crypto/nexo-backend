import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export default async function Home() {
  try {
    const session = await auth();
    if (session) redirect("/crm");
  } catch {
    // se auth() falhar (secret ausente ou inválido), vai para login normalmente
  }
  redirect("/login");
}
