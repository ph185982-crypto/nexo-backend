"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface CheckoutData {
  id: string;
  nomeCliente: string;
  produto: string;
  valorProduto: number;
  status: string;
  expiradoEm: string;
}

type Etapa = "inicial" | "pix" | "parcelado" | "pago" | "expirado" | "erro";

interface PixData {
  pixCopiaECola: string;
  qrCodeBase64: string;
  pagamentoId: string;
  valor: number;
}

interface ParceladoData {
  linkParcelado: string;
  pagamentoId: string;
  valor: number;
}

export default function CheckoutPage() {
  const params = useParams();
  const id = params.id as string;

  const [checkout, setCheckout] = useState<CheckoutData | null>(null);
  const [etapa, setEtapa] = useState<Etapa>("inicial");
  const [pixData, setPixData] = useState<PixData | null>(null);
  const [parceladoData, setParceladoData] = useState<ParceladoData | null>(null);
  const [loading, setLoading] = useState(true);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    fetch(`/api/checkout/${id}`)
      .then((res) => {
        if (res.status === 410) {
          setEtapa("expirado");
          return null;
        }
        if (!res.ok) {
          setEtapa("erro");
          return null;
        }
        return res.json();
      })
      .then((data: CheckoutData | null) => {
        if (!data) return;
        setCheckout(data);
        if (data.status === "PAGO") setEtapa("pago");
      })
      .finally(() => setLoading(false));
  }, [id]);

  const handlePix = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/checkout/${id}/pix`, { method: "POST" });
      if (!res.ok) throw new Error();
      const data: PixData = await res.json();
      setPixData(data);
      setEtapa("pix");
    } catch {
      alert("Erro ao gerar Pix. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  const handleParcelado = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/checkout/${id}/parcelado`, { method: "POST" });
      if (!res.ok) throw new Error();
      const data: ParceladoData = await res.json();
      setParceladoData(data);
      setEtapa("parcelado");
    } catch {
      alert("Erro ao gerar link. Tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  const copiarPix = async () => {
    if (!pixData?.pixCopiaECola) return;
    await navigator.clipboard.writeText(pixData.pixCopiaECola);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2500);
  };

  const primeiroNome = checkout?.nomeCliente?.split(" ")[0] ?? "";

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#1A1A2E",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "16px",
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <div
        style={{
          backgroundColor: "#FFFFFF",
          borderRadius: "20px",
          maxWidth: "420px",
          width: "100%",
          padding: "28px 24px",
          boxShadow: "0 8px 40px rgba(0,0,0,0.35)",
        }}
      >
        {/* Loading */}
        {loading && (
          <div style={{ textAlign: "center", padding: "40px 0", color: "#888" }}>
            <div style={{ fontSize: "32px", marginBottom: "12px" }}>⏳</div>
            <p>Carregando...</p>
          </div>
        )}

        {/* Expirado */}
        {!loading && etapa === "expirado" && (
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ fontSize: "48px", marginBottom: "12px" }}>⏰</div>
            <h2 style={{ color: "#E53E3E", marginBottom: "8px" }}>Link expirado</h2>
            <p style={{ color: "#666", fontSize: "14px" }}>
              Este link de pagamento não está mais disponível.
              <br />Entre em contato pelo WhatsApp para gerar um novo.
            </p>
          </div>
        )}

        {/* Erro */}
        {!loading && etapa === "erro" && (
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ fontSize: "48px", marginBottom: "12px" }}>❌</div>
            <h2 style={{ color: "#E53E3E", marginBottom: "8px" }}>Link inválido</h2>
            <p style={{ color: "#666", fontSize: "14px" }}>
              Não encontramos este pedido. Verifique o link ou contate o suporte.
            </p>
          </div>
        )}

        {/* Pago */}
        {!loading && etapa === "pago" && (
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ fontSize: "48px", marginBottom: "12px" }}>✅</div>
            <h2 style={{ color: "#00B894", marginBottom: "8px" }}>Pagamento confirmado!</h2>
            <p style={{ color: "#555", fontSize: "14px" }}>
              Seu pedido está sendo preparado para envio.
              <br />Você receberá o código de rastreamento em breve.
            </p>
          </div>
        )}

        {/* Inicial — escolha de pagamento */}
        {!loading && etapa === "inicial" && checkout && (
          <>
            <div style={{ marginBottom: "24px" }}>
              <p style={{ color: "#555", fontSize: "14px", marginBottom: "4px" }}>
                Olá, {primeiroNome}! 👋
              </p>
              <h1 style={{ fontSize: "20px", fontWeight: 700, color: "#1A1A2E", marginBottom: "4px" }}>
                {checkout.produto}
              </h1>
              <p style={{ fontSize: "28px", fontWeight: 800, color: "#00B894" }}>
                R$ {checkout.valorProduto.toFixed(2).replace(".", ",")}
              </p>
              <p style={{ color: "#888", fontSize: "12px" }}>Frete grátis • Entrega em todo o Brasil</p>
            </div>

            <div style={{ marginBottom: "12px" }}>
              <p style={{ color: "#333", fontWeight: 600, marginBottom: "12px", fontSize: "14px" }}>
                Escolha como quer pagar:
              </p>

              <button
                onClick={handlePix}
                style={{
                  width: "100%",
                  padding: "16px",
                  backgroundColor: "#00B894",
                  color: "#fff",
                  border: "none",
                  borderRadius: "12px",
                  fontSize: "16px",
                  fontWeight: 700,
                  cursor: "pointer",
                  marginBottom: "10px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                }}
              >
                <span>⚡</span> Pix — à vista
              </button>

              <button
                onClick={handleParcelado}
                style={{
                  width: "100%",
                  padding: "16px",
                  backgroundColor: "#0070BA",
                  color: "#fff",
                  border: "none",
                  borderRadius: "12px",
                  fontSize: "16px",
                  fontWeight: 700,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "8px",
                }}
              >
                <span>💳</span> Cartão — até 10x sem juros
              </button>
            </div>

            <p style={{ textAlign: "center", color: "#aaa", fontSize: "11px", marginTop: "16px" }}>
              🔒 Pagamento 100% seguro via Mercado Pago
            </p>
          </>
        )}

        {/* Pix — exibe QR code e copia-e-cola */}
        {!loading && etapa === "pix" && pixData && checkout && (
          <>
            <div style={{ marginBottom: "20px" }}>
              <button
                onClick={() => setEtapa("inicial")}
                style={{
                  background: "none",
                  border: "none",
                  color: "#888",
                  cursor: "pointer",
                  fontSize: "13px",
                  padding: "0",
                  marginBottom: "12px",
                }}
              >
                ← Voltar
              </button>
              <h2 style={{ fontSize: "18px", fontWeight: 700, color: "#1A1A2E", marginBottom: "4px" }}>
                Pague com Pix
              </h2>
              <p style={{ color: "#555", fontSize: "14px" }}>
                Valor: <strong>R$ {pixData.valor.toFixed(2).replace(".", ",")}</strong>
              </p>
            </div>

            {pixData.qrCodeBase64 && (
              <div style={{ textAlign: "center", marginBottom: "20px" }}>
                <img
                  src={`data:image/png;base64,${pixData.qrCodeBase64}`}
                  alt="QR Code Pix"
                  style={{
                    width: "200px",
                    height: "200px",
                    borderRadius: "12px",
                    border: "2px solid #E2E8F0",
                  }}
                />
              </div>
            )}

            <p style={{ color: "#555", fontSize: "13px", marginBottom: "8px", textAlign: "center" }}>
              Ou copie o código Pix:
            </p>

            <div
              style={{
                backgroundColor: "#F7F7F7",
                border: "1px solid #E2E8F0",
                borderRadius: "10px",
                padding: "12px",
                fontSize: "11px",
                wordBreak: "break-all",
                color: "#444",
                marginBottom: "12px",
                fontFamily: "monospace",
              }}
            >
              {pixData.pixCopiaECola}
            </div>

            <button
              onClick={copiarPix}
              style={{
                width: "100%",
                padding: "14px",
                backgroundColor: copiado ? "#27AE60" : "#00B894",
                color: "#fff",
                border: "none",
                borderRadius: "12px",
                fontSize: "15px",
                fontWeight: 700,
                cursor: "pointer",
                transition: "background-color 0.2s",
              }}
            >
              {copiado ? "✅ Copiado!" : "📋 Copiar código Pix"}
            </button>

            <p style={{ textAlign: "center", color: "#aaa", fontSize: "11px", marginTop: "16px" }}>
              Após o pagamento, você receberá confirmação via WhatsApp 📱
            </p>
          </>
        )}

        {/* Parcelado — redireciona para link do MP */}
        {!loading && etapa === "parcelado" && parceladoData && checkout && (
          <>
            <div style={{ marginBottom: "20px" }}>
              <button
                onClick={() => setEtapa("inicial")}
                style={{
                  background: "none",
                  border: "none",
                  color: "#888",
                  cursor: "pointer",
                  fontSize: "13px",
                  padding: "0",
                  marginBottom: "12px",
                }}
              >
                ← Voltar
              </button>
              <h2 style={{ fontSize: "18px", fontWeight: 700, color: "#1A1A2E", marginBottom: "4px" }}>
                Pague com cartão
              </h2>
              <p style={{ color: "#555", fontSize: "14px" }}>
                Valor: <strong>R$ {parceladoData.valor.toFixed(2).replace(".", ",")}</strong> em até 10x
              </p>
            </div>

            <div style={{ textAlign: "center", marginBottom: "20px" }}>
              <div style={{ fontSize: "48px", marginBottom: "12px" }}>💳</div>
              <p style={{ color: "#555", fontSize: "14px" }}>
                Clique abaixo para ir ao checkout seguro do Mercado Pago.
              </p>
            </div>

            <a
              href={parceladoData.linkParcelado}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "block",
                width: "100%",
                padding: "16px",
                backgroundColor: "#0070BA",
                color: "#fff",
                border: "none",
                borderRadius: "12px",
                fontSize: "16px",
                fontWeight: 700,
                cursor: "pointer",
                textDecoration: "none",
                textAlign: "center",
              }}
            >
              💳 Pagar com cartão
            </a>

            <p style={{ textAlign: "center", color: "#aaa", fontSize: "11px", marginTop: "16px" }}>
              Após o pagamento, você receberá confirmação via WhatsApp 📱
            </p>
          </>
        )}

        {/* Footer */}
        {!loading && (etapa === "inicial" || etapa === "pix" || etapa === "parcelado") && (
          <div
            style={{
              marginTop: "20px",
              paddingTop: "16px",
              borderTop: "1px solid #F0F0F0",
              textAlign: "center",
            }}
          >
            <p style={{ color: "#CCC", fontSize: "10px" }}>
              Powered by Nexo Vendas
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
