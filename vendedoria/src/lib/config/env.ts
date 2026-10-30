export const config = {
  ownerWhatsapp:    process.env.OWNER_WHATSAPP_NUMBER!,
  businessName:     process.env.BUSINESS_NAME     || "Nexo",
  deliveryRegion:   process.env.DELIVERY_REGION   || "Goiânia",
  cepOrigem:        process.env.CEP_ORIGEM!,
  renderUrl:        process.env.RENDER_EXTERNAL_URL || process.env.NEXTAUTH_URL || "",
  anthropicKey:     process.env.ANTHROPIC_API_KEY!,
  mercadoPagoToken: process.env.MERCADO_PAGO_ACCESS_TOKEN!,
  melhorEnvioToken: process.env.MELHOR_ENVIO_TOKEN!,
};

export function validarConfig(): void {
  // Obrigatórias para o CRM/SDR funcionar.
  const obrigatorias = ["OWNER_WHATSAPP_NUMBER", "DATABASE_URL", "META_WHATSAPP_APP_SECRET"];
  const faltando = obrigatorias.filter((k) => !process.env[k]);
  if (faltando.length > 0) {
    console.error(`[CONFIG] ❌ Variáveis obrigatórias faltando: ${faltando.join(", ")}`);
  }
  // Só o fluxo antigo de e-commerce (checkout, frete, Mercado Pago) usa estas —
  // aviso, não erro: antes isso aparecia como erro a cada início de instância.
  const ecommerce = ["CEP_ORIGEM", "MERCADO_PAGO_ACCESS_TOKEN", "MELHOR_ENVIO_TOKEN"].filter((k) => !process.env[k]);
  if (ecommerce.length > 0) {
    console.log(`[CONFIG] e-commerce desativado (sem ${ecommerce.join(", ")})`);
  }
}
