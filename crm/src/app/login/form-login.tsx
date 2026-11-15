"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/logo";

/**
 * Entrada principal: login único da Avanteza (link para a Central). O formulário de e-mail e senha continua
 * como alternativa — é a reserva até o login único estar provado.
 */
export function FormLogin({ entrarComAvanteza, voltar, erroInicial }: { entrarComAvanteza: string; voltar: string; erroInicial: string | null }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(erroInicial);
  const [enviando, setEnviando] = useState(false);

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    setErro(null);
    try {
      const r = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, senha }) });
      if (r.ok) { router.push(voltar === "/" ? "/oportunidades" : voltar); router.refresh(); return; }
      setErro(((await r.json().catch(() => null)) as { erro?: string } | null)?.erro ?? "Não foi possível entrar");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
      <section className="flex flex-col justify-between bg-azul p-10 text-bq lg:p-16">
        <Logo variante="bq" largura={180} />
        <div>
          <h1 className="text-[44px] font-extrabold leading-[1.05] tracking-tight lg:text-[64px]">
            Visão para <span className="text-bq">[</span>ir além<span className="text-bq">]</span>.
          </h1>
          <p className="mt-4 max-w-md text-[16px] text-bq/90">Funil, contatos e entrega no mesmo lugar, ligados ao Vendedor IA.</p>
        </div>
        <p className="text-[12px] text-bq/80">Consultoria e Estratégia</p>
      </section>
      <section className="flex items-center justify-center p-10">
        <form onSubmit={entrar} className="w-full max-w-sm space-y-5" noValidate>
          <h2 className="text-[24px] font-extrabold">Entrar</h2>
          <a href={entrarComAvanteza} className="block w-full rounded-[10px] bg-azul py-3 text-center text-[14px] font-bold text-bq">
            Entrar com Avanteza
          </a>
          <p className="flex items-center gap-3 text-[12px] text-cinza">
            <span className="h-px flex-1 bg-linha" />ou com e-mail e senha<span className="h-px flex-1 bg-linha" />
          </p>
          <label className="block">
            <span className="mb-1 block text-[12px] font-semibold text-cinza">E-mail</span>
            <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-[10px] border border-linha bg-superficie px-3 py-2.5 text-[14px]" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-semibold text-cinza">Senha</span>
            <input type="password" autoComplete="current-password" required value={senha} onChange={(e) => setSenha(e.target.value)}
              className="w-full rounded-[10px] border border-linha bg-superficie px-3 py-2.5 text-[14px]" />
          </label>
          {erro && <p role="alert" className="text-[13px] font-semibold text-critico">{erro}</p>}
          <button type="submit" disabled={enviando || !email || !senha}
            className="w-full rounded-[10px] border border-azul bg-superficie py-3 text-[14px] font-bold text-azul disabled:opacity-50">
            {enviando ? "Entrando…" : "Entrar com senha"}
          </button>
        </form>
      </section>
    </div>
  );
}
