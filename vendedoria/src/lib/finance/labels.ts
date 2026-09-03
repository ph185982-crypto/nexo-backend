export const TIPO_NEGOCIO_OPTIONS = [
  { value: "pessoal", label: "Pessoal" },
  { value: "nexo", label: "Nexo" },
  { value: "lukaizen", label: "LuKaizen" },
  { value: "geral", label: "Geral" },
] as const;

export function formatTipoNegocio(v?: string | null): string {
  if (!v) return "-";
  const found = TIPO_NEGOCIO_OPTIONS.find((o) => o.value === v);
  return found ? found.label : v;
}
