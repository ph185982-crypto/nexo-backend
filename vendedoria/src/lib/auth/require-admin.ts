import { auth } from "@/lib/auth";

// Guarda compartilhada pras rotas de API que só o dono/admin do CRM pode
// chamar. Lança "Forbidden" — cada rota decide como responder (normalmente
// NextResponse.json({ error: "Forbidden" }, { status: 403 })).
export async function requireAdmin(): Promise<void> {
  const session = await auth();
  if (!session?.user || (session.user as { role?: string }).role !== "ADMIN") {
    throw new Error("Forbidden");
  }
}
