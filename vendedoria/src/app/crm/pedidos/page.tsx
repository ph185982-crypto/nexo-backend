"use client";

import { useEffect, useState, useCallback } from "react";
import { Package, Truck, RefreshCw, Send } from "lucide-react";

interface PedidoNacional {
  id: string;
  nomeCliente: string;
  produto: string;
  cepDestino: string;
  enderecoCompleto: string;
  valorProduto: number;
  valorFrete: number;
  valorTotal: number;
  transportadora: string;
  prazoFrete: number;
  formaPagamento: string;
  etapaEnvio: string;
  urlEtiqueta: string | null;
  codigoRastreamento: string | null;
  pagamentoStatus: string;
  telefoneCliente: string;
  criadoEm: string;
}

const COLUNAS: { key: string; label: string; cor: string }[] = [
  { key: "AGUARDANDO_PAGAMENTO", label: "Aguardando Pagamento", cor: "border-yellow-400" },
  { key: "PAGO",                 label: "Pago",                 cor: "border-green-400" },
  { key: "ENVIADO",              label: "Enviado",              cor: "border-blue-400" },
  { key: "ENTREGUE",             label: "Entregue",             cor: "border-emerald-400" },
];

export default function PedidosNacionaisPage() {
  const [pedidos, setPedidos] = useState<PedidoNacional[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);
  const [enviando, setEnviando] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const fetchPedidos = useCallback(async () => {
    try {
      const res = await fetch("/api/pedidos/nacionais");
      const data = await res.json();
      setPedidos(data.pedidos ?? []);
    } catch {
      // silencioso
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPedidos();
    const interval = setInterval(fetchPedidos, 15_000);
    return () => clearInterval(interval);
  }, [fetchPedidos]);

  const handleEnviar = async (id: string, codigo: string) => {
    setEnviando(id);
    try {
      const res = await fetch(`/api/pedidos/nacional/${id}/despachar`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigoRastreamento: codigo }),
      });
      if (res.ok) {
        showToast("Pedido marcado como enviado ✅");
        await fetchPedidos();
      } else {
        showToast("Erro ao marcar como enviado ❌");
      }
    } catch {
      showToast("Erro de conexão ❌");
    } finally {
      setEnviando(null);
    }
  };

  const pedidosPorEtapa = (etapa: string) =>
    pedidos.filter((p) => p.etapaEnvio === etapa);

  return (
    <div className="h-full flex flex-col overflow-hidden bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-3">
          <Package className="w-5 h-5 text-emerald-500" />
          <h1 className="text-lg font-semibold text-foreground">Pedidos Nacionais</h1>
          <span className="text-sm text-muted-foreground">({pedidos.length} pedidos)</span>
        </div>
        <button
          onClick={fetchPedidos}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Atualizar
        </button>
      </div>

      {/* Kanban board */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          Carregando pedidos…
        </div>
      ) : (
        <div className="flex-1 overflow-x-auto p-4">
          <div className="flex gap-4 h-full min-w-max">
            {COLUNAS.map((col) => {
              const itens = pedidosPorEtapa(col.key);
              return (
                <div
                  key={col.key}
                  className={`flex flex-col w-72 flex-shrink-0 bg-muted/40 rounded-xl border-t-2 ${col.cor}`}
                >
                  {/* Column header */}
                  <div className="px-3 py-2.5 border-b border-border flex-shrink-0">
                    <span className="text-xs font-semibold text-foreground uppercase tracking-wide">
                      {col.label}
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground">({itens.length})</span>
                  </div>

                  {/* Cards */}
                  <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    {itens.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-6">Nenhum pedido</p>
                    )}
                    {itens.map((pedido) => (
                      <PedidoCard
                        key={pedido.id}
                        pedido={pedido}
                        onEnviar={handleEnviar}
                        enviando={enviando === pedido.id}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-foreground text-background text-sm px-4 py-2.5 rounded-xl shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
}

function PedidoCard({
  pedido,
  onEnviar,
  enviando,
}: {
  pedido: PedidoNacional;
  onEnviar: (id: string, codigo: string) => void;
  enviando: boolean;
}) {
  const [showEnvio, setShowEnvio] = useState(false);
  const [rastreio, setRastreio] = useState("");

  const estadoCep = pedido.enderecoCompleto.split(",").slice(-1)[0]?.trim() ?? pedido.cepDestino;

  const confirmarEnvio = () => {
    onEnviar(pedido.id, rastreio);
    setShowEnvio(false);
    setRastreio("");
  };

  return (
    <div className="bg-background rounded-lg border border-border p-3 space-y-2 shadow-sm text-sm">
      {/* Nome e localização */}
      <div>
        <p className="font-semibold text-foreground truncate">{pedido.nomeCliente}</p>
        <p className="text-xs text-muted-foreground truncate">{estadoCep}</p>
      </div>

      {/* Produto */}
      <p className="text-xs text-foreground/80 truncate">{pedido.produto}</p>

      {/* CEP */}
      <p className="text-xs text-muted-foreground">📍 CEP: {pedido.cepDestino}</p>

      {/* Endereço */}
      <p className="text-xs text-muted-foreground truncate">📮 {pedido.enderecoCompleto}</p>

      {/* Valor */}
      <div className="text-xs font-semibold text-foreground">
        Total: R$ {pedido.valorTotal.toFixed(2)} — Frete grátis
      </div>

      {/* Pagamento */}
      <div className="flex items-center gap-1.5">
        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
          pedido.formaPagamento === 'pix'
            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
            : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
        }`}>
          {pedido.formaPagamento === 'pix' ? 'Pix' : 'Parcelado'}
        </span>
        <a
          href={`https://wa.me/${pedido.telefoneCliente}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-emerald-500 hover:underline"
        >
          {pedido.telefoneCliente}
        </a>
      </div>

      {/* Rastreamento */}
      {pedido.codigoRastreamento && (
        <div className="text-xs bg-muted rounded px-2 py-1 font-mono">
          📦 {pedido.codigoRastreamento}
        </div>
      )}

      {/* Botão Marcar como enviado — aparece apenas no status PAGO */}
      {pedido.etapaEnvio === 'PAGO' && !showEnvio && (
        <button
          onClick={() => setShowEnvio(true)}
          disabled={enviando}
          className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        >
          <Truck className="w-3.5 h-3.5" />
          Marcar como enviado
        </button>
      )}

      {/* Input de rastreamento inline */}
      {pedido.etapaEnvio === 'PAGO' && showEnvio && (
        <div className="space-y-1.5">
          <input
            type="text"
            value={rastreio}
            onChange={(e) => setRastreio(e.target.value)}
            placeholder="Código de rastreamento (opcional)"
            className="w-full text-xs px-2 py-1.5 rounded-lg border border-border bg-muted focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
          <div className="flex gap-1.5">
            <button
              onClick={confirmarEnvio}
              disabled={enviando}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60 transition-colors"
            >
              <Send className="w-3 h-3" />
              {enviando ? "Enviando…" : "Confirmar"}
            </button>
            <button
              onClick={() => { setShowEnvio(false); setRastreio(""); }}
              className="px-2 py-1.5 text-xs rounded-lg bg-muted hover:bg-muted/80 text-muted-foreground border border-border transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Data */}
      <p className="text-[10px] text-muted-foreground">
        {new Date(pedido.criadoEm).toLocaleString("pt-BR", {
          day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
        })}
      </p>
    </div>
  );
}
