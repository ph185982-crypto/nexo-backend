import { ROTULO_SAUDE_ENTREGA, type RotuloSaudeEntrega } from "@/lib/entrega/saude";

/** Saudável: ponto verde; Atenção: preenchimento laranja com texto marinho; Em risco: preenchimento vermelho com texto claro. */
export function SaudeChip({ rotulo, nota }: { rotulo: RotuloSaudeEntrega; nota: number }) {
  const estilo = rotulo === "SAUDAVEL" ? "border border-areia bg-superficie text-marinho" : rotulo === "ATENCAO" ? "bg-laranja text-marinho" : "bg-perigo text-superficie";
  return (
    <span title={`Saúde do cliente: ${nota}/100`} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${estilo}`}>
      {rotulo === "SAUDAVEL" && <i className="h-2 w-2 rounded-full bg-ok" aria-hidden />}
      {ROTULO_SAUDE_ENTREGA[rotulo]}
    </span>
  );
}
