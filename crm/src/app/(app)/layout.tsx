import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Shell } from "@/components/shell";
import { prisma } from "@/lib/prisma";
import { COOKIE_SESSAO, segredoDaSessao, verificarSessao } from "@/lib/auth/sessao";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const sessao = await verificarSessao((await cookies()).get(COOKIE_SESSAO)?.value, segredoDaSessao());
  const usuario = sessao ? await prisma.usuario.findUnique({ where: { id: sessao.uid }, select: { nome: true, ativo: true, papel: true } }) : null;
  if (!usuario?.ativo) redirect("/login");

  return <Shell nome={usuario.nome} admin={usuario.papel === "ADMIN"}>{children}</Shell>;
}
