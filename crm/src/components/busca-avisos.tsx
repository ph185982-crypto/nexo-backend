"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

interface Resultado { tipo: "OPORTUNIDADE" | "CONTATO"; id: string; titulo: string; detalhe: string; href: string }
interface Aviso { chave: string; nivel: "CRITICO" | "ATENCAO" | "INFO"; titulo: string; detalhe: string; href: string }

const botaoLateral = "flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-[13px] font-semibold text-bq/85 hover:bg-bq/10";
const icone = "h-[19px] w-[19px] flex-none fill-none stroke-current";

/** Ctrl+K (ou ⌘K) em qualquer tela: busca oportunidades e contatos por nome, código, telefone, e-mail ou documento. */
export function BuscaGlobal() {
  const [aberta, setAberta] = useState(false);
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Resultado[]>([]);
  const [sel, setSel] = useState(0);
  const [buscando, setBuscando] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const router = useRouter();

  useEffect(() => {
    // A barra lateral existe duas vezes (desktop e gaveta do celular): só a visível atende o atalho.
    const tecla = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k" && botao.current?.offsetParent) { e.preventDefault(); setAberta(true); } };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, []);
  useEffect(() => {
    const d = ref.current;
    if (aberta && d && !d.open) d.showModal();
    if (!aberta && d?.open) d.close();
  }, [aberta]);
  useEffect(() => {
    if (q.trim().length < 2) { setRes([]); return; }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setBuscando(true);
      try {
        const r = await fetch(`/api/busca?q=${encodeURIComponent(q)}`, { signal: ctl.signal });
        if (r.ok) { setRes((await r.json()).resultados); setSel(0); }
      } catch { /* cancelada */ } finally { setBuscando(false); }
    }, 200);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q]);

  const ir = (r: Resultado | undefined) => { if (!r) return; setAberta(false); setQ(""); router.push(r.href); };
  const teclas = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, res.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    if (e.key === "Enter") { e.preventDefault(); ir(res[sel]); }
  };

  return (
    <>
      <button ref={botao} onClick={() => setAberta(true)} className={botaoLateral} aria-keyshortcuts="Control+K">
        <svg viewBox="0 0 24 24" className={icone} strokeWidth="1.7" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
        Buscar <kbd className="ml-auto rounded border border-bq/30 px-1.5 text-[10px] font-semibold text-bq/70">Ctrl K</kbd>
      </button>
      <dialog ref={ref} onClose={() => setAberta(false)} onClick={(e) => { if (e.target === ref.current) setAberta(false); }}
        className="mt-[12vh] w-[min(560px,94vw)] rounded-[14px] bg-superficie p-0 text-grafite shadow-xl" aria-label="Buscar">
        <div className="border-b border-linha p-3">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={teclas} placeholder="Oportunidade, empresa, pessoa, telefone, e-mail ou código…"
            aria-label="Buscar" className="w-full bg-transparent px-2 py-1.5 text-[15px] outline-none" />
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-1.5" role="listbox">
          {q.trim().length >= 2 && !buscando && res.length === 0 && <li className="px-3 py-3 text-[13px] text-cinza">Nada encontrado.</li>}
          {q.trim().length < 2 && <li className="px-3 py-3 text-[12px] text-cinza">Digite ao menos 2 letras. Setas para escolher, Enter para abrir.</li>}
          {res.map((r, i) => (
            <li key={`${r.tipo}:${r.id}`} role="option" aria-selected={i === sel}>
              <button onMouseEnter={() => setSel(i)} onClick={() => ir(r)} className={`flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left ${i === sel ? "bg-azul-8" : ""}`}>
                <span className={`mt-0.5 flex-none rounded px-1.5 py-0.5 text-[10px] font-bold ${r.tipo === "OPORTUNIDADE" ? "bg-azul text-bq" : "border border-linha text-cinza"}`}>{r.tipo === "OPORTUNIDADE" ? "OPORT." : "CONTATO"}</span>
                <span className="min-w-0"><span className="block truncate text-[13.5px] font-semibold">{r.titulo}</span><span className="block truncate text-[12px] text-cinza">{r.detalhe}</span></span>
              </button>
            </li>
          ))}
        </ul>
      </dialog>
    </>
  );
}

const COR: Record<Aviso["nivel"], string> = { CRITICO: "bg-critico", ATENCAO: "bg-laranja", INFO: "bg-azul" };

/** Sino: o que pede ação agora. Recarrega ao trocar de tela e a cada 5 minutos. */
export function Avisos() {
  const [avisos, setAvisos] = useState<Aviso[] | null>(null);
  const [aberto, setAberto] = useState(false);
  const caminho = usePathname();
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let vivo = true;
    const carregar = () => fetch("/api/avisos").then((r) => (r.ok ? r.json() : null)).then((j) => { if (vivo && j) setAvisos(j.avisos); }).catch(() => {});
    void carregar();
    const t = setInterval(carregar, 5 * 60_000);
    return () => { vivo = false; clearInterval(t); };
  }, [caminho]);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setAberto(false); };
    document.addEventListener("mousedown", fora); window.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fora); window.removeEventListener("keydown", esc); };
  }, [aberto]);

  const criticos = avisos?.filter((a) => a.nivel === "CRITICO").length ?? 0;
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setAberto((x) => !x)} aria-expanded={aberto} className={botaoLateral}>
        <svg viewBox="0 0 24 24" className={icone} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20.5a2.2 2.2 0 0 0 4 0" /></svg>
        Avisos
        {!!avisos?.length && <span className={`ml-auto grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11px] font-bold ${criticos ? "bg-laranja text-grafite" : "bg-bq/20 text-bq"}`}>{avisos.length}</span>}
      </button>
      {aberto && (
        <div className="absolute left-0 top-full z-50 mt-1 w-[min(360px,86vw)] overflow-hidden rounded-xl border border-linha bg-superficie text-grafite shadow-xl lg:left-full lg:top-0 lg:ml-3 lg:mt-0">
          <p className="border-b border-linha px-4 py-2.5 text-[13px] font-extrabold">Avisos</p>
          <ul className="max-h-[60vh] overflow-y-auto">
            {avisos?.length === 0 && <li className="px-4 py-4 text-[13px] text-cinza">Nada pedindo ação agora.</li>}
            {avisos?.map((a) => (
              <li key={a.chave}>
                <button onClick={() => { setAberto(false); router.push(a.href); }} className="flex w-full items-start gap-2.5 border-b border-linha px-4 py-2.5 text-left last:border-0 hover:bg-bq">
                  <i className={`mt-1.5 h-2 w-2 flex-none rounded-full ${COR[a.nivel]}`} aria-hidden />
                  <span className="min-w-0"><span className="block truncate text-[13px] font-semibold">{a.titulo}</span><span className="block text-[12px] text-cinza">{a.detalhe}</span></span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
