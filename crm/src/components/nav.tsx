"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const ITENS = [
  {
    href: "/oportunidades", rotulo: "Oportunidades",
    icone: <><circle cx="12" cy="12" r="9" /><path d="M14.5 9.2c-.6-.8-1.5-1.2-2.5-1.2-1.4 0-2.5.8-2.5 1.9 0 2.6 5 1.2 5 3.9 0 1.1-1.1 1.9-2.5 1.9-1.1 0-2-.5-2.6-1.3M12 6.5V8m0 8v1.5" /></>,
  },
  {
    href: "/tarefas", rotulo: "Tarefas",
    icone: <><circle cx="12" cy="12" r="9" /><path d="m8 12.5 2.8 2.8L16 9.5" /></>,
  },
  {
    href: "/agenda", rotulo: "Agenda",
    icone: <><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M8 3v4m8-4v4M3.5 10h17" /></>,
  },
  {
    href: "/entrega", rotulo: "Entrega",
    icone: <path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5zM3 7.5 12 12l9-4.5M12 12v9" />,
  },
  {
    href: "/relatorios", rotulo: "Relatórios",
    icone: <path d="M4 20V10m6 10V4m6 16v-7m5 7H3" />,
  },
  {
    href: "/automacoes", rotulo: "Automações",
    icone: <path d="M13 2 4 14h7l-1 8 9-12h-7z" />,
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
