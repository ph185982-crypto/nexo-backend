"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const ITENS = [
  {
    href: "/oportunidades", rotulo: "Oportunidades",
    icone: <><circle cx="12" cy="12" r="9" /><path d="M14.5 9.2c-.6-.8-1.5-1.2-2.5-1.2-1.4 0-2.5.8-2.5 1.9 0 2.6 5 1.2 5 3.9 0 1.1-1.1 1.9-2.5 1.9-1.1 0-2-.5-2.6-1.3M12 6.5V8m0 8v1.5" /></>,
  },
  {
    href: "/contatos", rotulo: "Contatos",
    icone: <path d="M4 21V6l8-3 8 3v15M9 21v-4h6v4M8 9h2m4 0h2m-8 4h2m4 0h2" />,
  },
];

export function Nav({ nome }: { nome: string }) {
  const caminho = usePathname();
  const router = useRouter();
  const sair = async () => {
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  };
  return (
    <>
      <nav className="flex flex-col gap-1" aria-label="Módulos">
        {ITENS.map((i) => {
          const ativo = caminho.startsWith(i.href);
          return (
            <Link
              key={i.href}
              href={i.href}
              aria-current={ativo ? "page" : undefined}
              className={`flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-[13px] font-semibold ${ativo ? "bg-laranja text-grafite" : "text-bq/85 hover:bg-bq/10"}`}
            >
              <svg viewBox="0 0 24 24" className="h-[19px] w-[19px] flex-none fill-none stroke-current" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{i.icone}</svg>
              {i.rotulo}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto border-t border-bq/20 pt-4">
        <p className="truncate text-[12px] font-semibold text-bq">{nome}</p>
        <button onClick={sair} className="mt-1 text-[12px] text-bq/80 underline-offset-2 hover:underline">Sair</button>
      </div>
    </>
  );
}
