// Pix "copia e cola" (BR Code estático, padrão EMV do Banco Central): com a chave e o
// valor, o app do banco já abre a transferência preenchida. O nome e a cidade são
// exigidos pelo padrão, mas o banco mostra o titular real da chave (DICT) na confirmação.

const campo = (id: string, valor: string) => `${id}${String(valor.length).padStart(2, "0")}${valor}`;

/** CRC16-CCITT (polinômio 0x1021, inicial 0xFFFF), como exige o BR Code. */
export function crc16(texto: string): string {
  let crc = 0xffff;
  for (const byte of Buffer.from(texto, "utf8")) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

const limpar = (s: string, max: number) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9 ]/g, "").trim().toUpperCase().slice(0, max) || "RESERVA";

export function pixCopiaECola(opts: { chave: string; valor?: number; nome?: string; cidade?: string; txid?: string }): string {
  const conta = campo("00", "br.gov.bcb.pix") + campo("01", opts.chave.trim());
  const partes = [
    campo("00", "01"),
    campo("26", conta),
    campo("52", "0000"),
    campo("53", "986"),
    ...(opts.valor && opts.valor > 0 ? [campo("54", opts.valor.toFixed(2))] : []),
    campo("58", "BR"),
    campo("59", limpar(opts.nome ?? "RESERVA", 25)),
    campo("60", limpar(opts.cidade ?? "GOIANIA", 15)),
    campo("62", campo("05", (opts.txid ?? "***").slice(0, 25))),
  ];
  const semCrc = partes.join("") + "6304";
  return semCrc + crc16(semCrc);
}
