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
  const obrigatorias = [
    "OWNER_WHATSAPP_NUMBER",
    "ANTHROPIC_API_KEY",
    "RENDER_EXTERNAL_URL",
    "CEP_ORIGEM",
  ];

  const faltando = obrigatorias.filter((k) => !process.env[k]);

  if (faltando.length > 0) {
    console.error(`[CONFIG] ❌ Variáveis obrigatórias faltando: ${faltando.join(", ")}`);
    console.error("[CONFIG] Configure essas variáveis no painel do Render antes de usar o sistema.");
  } else {
    console.log("[CONFIG] ✅ Todas as variáveis obrigatórias configuradas.");
  }
}
