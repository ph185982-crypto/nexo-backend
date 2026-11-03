import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Logo } from "@/components/logo";
import { Nav } from "@/components/nav";
import { prisma } from "@/lib/prisma";
import { COOKIE_SESSAO, segredoDaSessao, verificarSessao } from "@/lib/auth/sessao";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const sessao = await verificarSessao((await cookies()).get(COOKIE_SESSAO)?.value, segredoDaSessao());
  const usuario = sessao ? await prisma.usuario.findUnique({ where: { id: sessao.uid }, select: { nome: true, ativo: true } }) : null;
  if (!usuario?.ativo) redirect("/login");

  return (
    <div className="grid h-screen min-w-[1100px] grid-cols-[232px_1fr]">
      <aside className="flex flex-col gap-8 bg-azul px-4 py-5">
        <div className="px-2"><Logo variante="bq" largura={150} /></div>
        <Nav nome={usuario.nome} />
      </aside>
      <main className="min-w-0 overflow-hidden">{children}</main>
    </div>
  );
}
