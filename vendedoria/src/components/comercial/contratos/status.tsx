import { ROTULO_STATUS } from "@/lib/comercial/contratos/modelo";

/** Selo do status do contrato (cores do tema; laranja só como preenchimento com texto marinho). */
export function StatusContrato({ status }: { status: string }) {
  const cor = status === "ASSINADO" ? "bg-primary text-primary-foreground"
    : status === "ENVIADO" || status === "ASSINADO_PARCIAL" ? "bg-laranja text-marinho"
    : status === "ERRO" || status === "RECUSADO" ? "border border-destructive text-destructive"
    : "bg-secondary text-secondary-foreground";
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${cor}`}>{ROTULO_STATUS[status] ?? status}</span>;
}
